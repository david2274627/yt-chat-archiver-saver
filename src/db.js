// IndexedDB 資料層（SPEC 4.1、F-11、F-14、F-16、F-18、F-19）。
// 寫入只由 background.js 呼叫；viewer.js 只能使用唯讀查詢（SPEC 3.2 v21）。
// 不依賴 DOM 或 chrome.*，可在 Service Worker 與測試頁執行。
(function (root) {
  'use strict';

  const C = root.YTCAS_CONST;
  const T = C.MSG_TYPE;
  const TYPES = new Set(Object.values(T));
  const PHASES = new Set(['pre', 'live', 'post']);

  const cfg = { dbName: C.DB_NAME, legacyDbName: C.LEGACY_DB_NAME };
  let dbPromise = null;

  // ---------------------------------------------------------------- 基本工具
  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const union = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
  const approxSize = (o) => { try { return JSON.stringify(o).length; } catch (_) { return 0; } };

  // FNV-1a（兩組 32 位元）→ 16 位 hex。同步計算，可在 IndexedDB 交易內使用。
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
      h2 = (h2 ^ (h2 >>> 15)) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  // 訊息文字正規化（含表符 alt）：NFKC、小寫、空白收斂
  function normText(runs) {
    if (!Array.isArray(runs)) return '';
    const s = runs.map((r) => (r && r.emoji ? (r.emoji.alt || r.emoji.shortcut || '') : (r && r.text) || '')).join('');
    return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // F-14 後備去重指紋；offset 為 null 時不做（回傳 ''）
  function makeFp(m) {
    const off = num(m.videoOffsetSec);
    if (off === null) return '';
    const handle = (m.authorHandle || '').toLowerCase();
    const text = normText(m.runs);
    if (!handle && !text) return ''; // 沒有作者也沒有內容時不做（避免把不同人的貼圖併在一起）
    return hash([m.type || '', handle, text, Math.round(off / C.FP_BUCKET_SEC)].join('\u0001'));
  }

  // 置頂、降落橫幅等取不到 YouTube id 時的補救 id（SPEC 4.3）
  function fallbackId(m) {
    return 'ytcas-' + hash([m.type || '', m.authorHandle || m.authorChannelId || '', normText(m.runs), m.timestampAbs || ''].join('\u0001'));
  }

  // 收錄來源 → sources 類別（popout 與 live 同類，F-14 v28）
  const sourceCat = (s) => (s === 'popout' ? 'live' : s);

  // ---------------------------------------------------------------- IndexedDB 包裝
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('transaction aborted'));
  });

  function upgrade(db, tx, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('streams', { keyPath: 'videoId' });
      const m = db.createObjectStore('messages', { keyPath: 'id' });
      m.createIndex('videoId', 'videoId');
      m.createIndex('videoId_offset', ['videoId', 'videoOffsetSec']);
      m.createIndex('videoId_type', ['videoId', 'type']);
      const p = db.createObjectStore('pinned_messages', { keyPath: 'id' });
      p.createIndex('videoId', 'videoId');
      db.createObjectStore('channels', { keyPath: 'handleOrId' });
    }
    if (oldVersion < 3) {
      // v35（T3.7）F-20 診斷記錄：獨立資料表，不屬於聊天存檔（可自動清除）
      if (!db.objectStoreNames.contains('diag_log')) {
        const d = db.createObjectStore('diag_log', { keyPath: 'seq', autoIncrement: true });
        d.createIndex('ts', 'ts');
      }
    }
    if (oldVersion < 2) {
      const cs = db.createObjectStore('capture_sessions', { keyPath: 'id', autoIncrement: true });
      cs.createIndex('videoId', 'videoId');
      const m = tx.objectStore('messages');
      m.createIndex('videoId_fp', ['videoId', 'fp']);
      m.createIndex('aliasIds', 'aliasIds', { multiEntry: true });
      if (oldVersion >= 1) {
        // v1 → v2：既有紀錄補預設值（SPEC 4.1）
        for (const name of ['messages', 'pinned_messages']) {
          tx.objectStore(name).openCursor().onsuccess = (e) => {
            const cur = e.target.result;
            if (!cur) return;
            cur.update(upgradeMessage(cur.value));
            cur.continue();
          };
        }
        tx.objectStore('streams').openCursor().onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) return;
          cur.update(Object.assign(newStream(cur.value.videoId, 0), cur.value, fillStreamDefaults(cur.value)));
          cur.continue();
        };
      }
    }
  }

  function upgradeMessage(v) {
    const r = Object.assign({}, v);
    if (!Array.isArray(r.sources) || !r.sources.length) r.sources = ['live'];
    if (!PHASES.has(r.phase)) r.phase = 'live';
    if (r.offsetSource !== 'replay' && r.offsetSource !== 'estimated') r.offsetSource = 'estimated';
    if (typeof r.deleted !== 'boolean') r.deleted = false;
    if (!r.offsets || typeof r.offsets !== 'object') r.offsets = num(r.videoOffsetSec) !== null ? { v1: r.videoOffsetSec } : {};
    if (!Array.isArray(r.aliasIds)) r.aliasIds = [];
    if (r.firstSeenAt == null) r.firstSeenAt = r.timestampAbs || 0;
    if (r.lastSeenAt == null) r.lastSeenAt = r.firstSeenAt;
    r.fp = makeFp(r);
    return r;
  }

  function fillStreamDefaults(s) {
    const o = {};
    for (const k of ['versions', 'linkedVideos']) if (!Array.isArray(s[k])) o[k] = [];
    for (const k of ['liveCaptureCount', 'replayCaptureCount', 'popoutCaptureCount', 'approxBytes', 'messageCount']) if (num(s[k]) === null) o[k] = 0;
    return o;
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(cfg.dbName, C.DB_VERSION);
      r.onupgradeneeded = (e) => upgrade(r.result, r.transaction, e.oldVersion);
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      r.onerror = () => { dbPromise = null; reject(r.error); };
      r.onblocked = () => console.warn('[ytcas] 資料庫升級被其他分頁阻擋');
    });
    return dbPromise;
  }

  async function close() {
    avatarCache.clear(); // T5.1：關閉資料庫（測試重設）時一併清除同場次頭像快取
    if (!dbPromise) return;
    const p = dbPromise;
    dbPromise = null;
    try { (await p).close(); } catch (_) { /* ignore */ }
  }

  function configure(o) {
    if (o && o.dbName) cfg.dbName = o.dbName;
    if (o && o.legacyDbName) cfg.legacyDbName = o.legacyDbName;
  }

  // 以 videoId 為單位序列化寫入（F-14：兩個分頁同時開同一場）
  const locks = new Map();
  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    const tail = next.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return next;
  }

  // ---------------------------------------------------------------- 場次
  function newStream(videoId, now) {
    return {
      videoId, title: '', channelName: '', channelHandle: '', channelUrl: '', isLive: false,
      startedAt: null, scheduledStartAt: null, endedAt: null, lastMessageAt: null, messageCount: 0,
      startedAtSource: null, endedAtSource: null, startPending: false, // T3.6
      liveCaptureCount: 0, replayCaptureCount: 0, popoutCaptureCount: 0, approxBytes: 0,
      versions: [], linkedVideos: [], createdAt: now,
    };
  }

  // 場次資訊合併：只補空欄位；isLive 取最新值。回傳 startedAt／endedAt 是否新取得（需重算 phase）
  function mergeStreamMeta(s, meta) {
    let timesChanged = false;
    if (!meta || typeof meta !== 'object') return false;
    for (const k of ['title', 'channelName', 'channelHandle', 'channelUrl']) {
      if (isEmpty(s[k]) && typeof meta[k] === 'string' && meta[k]) s[k] = meta[k];
    }
    // T3.6：startedAt／endedAt 依來源等級覆蓋（C.START_SOURCE_RANK）；預定時間（scheduled）不得寫入 startedAt
    for (const k of ['startedAt', 'endedAt']) {
      const v = num(meta[k]);
      const srcKey = k + 'Source';
      const inc = typeof meta[srcKey] === 'string' ? meta[srcKey] : null;
      if (v === null || inc === 'scheduled') continue;
      const curRank = s[k] == null ? -1 : C.startRank(s[srcKey]);
      if (C.startRank(inc) > curRank && s[k] !== v) {
        s[k] = v;
        s[srcKey] = inc;
        timesChanged = true;
      } else if (s[k] === v && inc && C.startRank(inc) > C.startRank(s[srcKey])) {
        s[srcKey] = inc;
      }
    }
    if (s.scheduledStartAt == null && num(meta.scheduledStartAt) !== null) s.scheduledStartAt = meta.scheduledStartAt;
    if (s.startedAt != null) s.startPending = false;
    else if (typeof meta.startPending === 'boolean') s.startPending = meta.startPending;
    if (typeof meta.isLive === 'boolean') s.isLive = meta.isLive;
    if (Array.isArray(meta.versions)) {
      for (const v of meta.versions) if (v && v.id && !s.versions.some((x) => x.id === v.id)) s.versions.push(clone(v));
    }
    if (Array.isArray(meta.linkedVideos)) {
      for (const l of meta.linkedVideos) if (l && l.videoId && !s.linkedVideos.some((x) => x.videoId === l.videoId)) s.linkedVideos.push(clone(l));
    }
    return timesChanged;
  }

  // T3.6：場次的時間與來源（回傳給 content script，讓擷取端採用 background 確認的開播／結束時間）
  function pickStreamTimes(s) {
    if (!s) return null;
    return { startedAt: s.startedAt ?? null, startedAtSource: s.startedAtSource ?? null, endedAt: s.endedAt ?? null,
      endedAtSource: s.endedAtSource ?? null, scheduledStartAt: s.scheduledStartAt ?? null, startPending: !!s.startPending,
      channelHandle: s.channelHandle || '', isLive: !!s.isLive };
  }

  // F-18 版本偵測（會修改 versions）
  function resolveVersion(versions, duration, now) {
    const d = num(duration) !== null && duration > 0 ? Math.round(duration) : null;
    if (!versions.length) {
      versions.push({ id: 'v1', duration: d, firstSeenAt: now, label: '原始' });
      return 'v1';
    }
    if (d === null) return 'v1';
    const hit = versions.find((v) => v.duration != null && Math.abs(v.duration - d) <= C.VERSION_DURATION_TOLERANCE_SEC);
    if (hit) return hit.id;
    const v1 = versions.find((v) => v.id === 'v1');
    if (v1 && v1.duration == null) { v1.duration = d; return 'v1'; }
    const n = versions.length + 1;
    versions.push({ id: 'v' + n, duration: d, firstSeenAt: now, label: '剪輯版 ' + (n - 1) });
    return 'v' + n;
  }

  // ---------------------------------------------------------------- 訊息正規化與合併
  // ctx: { videoId, source, versionId, now, preserve }  preserve = 匯入／遷移：保留來源檔的 sources、offsets 等
  function normalizeIncoming(m, ctx) {
    const r = Object.assign({}, m);
    r.videoId = ctx.videoId;
    if (!TYPES.has(r.type)) r.type = T.SYSTEM;
    if (!Array.isArray(r.runs)) r.runs = [];
    if (!Array.isArray(r.authorBadges)) r.authorBadges = [];
    r.timestampAbs = num(r.timestampAbs) !== null ? r.timestampAbs : ctx.now;
    const off = num(r.videoOffsetSec);
    const cat = sourceCat(ctx.source);
    if (ctx.preserve) {
      r.sources = union(Array.isArray(m.sources) ? m.sources : [], [cat]);
      r.offsets = m.offsets && typeof m.offsets === 'object' ? clone(m.offsets) : {};
      if (off !== null && r.offsets.v1 == null) r.offsets.v1 = off;
      r.videoOffsetSec = num(r.offsets.v1);
      if (r.offsetSource !== 'replay' && r.offsetSource !== 'estimated') r.offsetSource = r.videoOffsetSec === null ? null : 'estimated';
      r.firstSeenAt = num(m.firstSeenAt) !== null ? m.firstSeenAt : r.timestampAbs;
      r.lastSeenAt = num(m.lastSeenAt) !== null ? m.lastSeenAt : r.firstSeenAt;
    } else {
      r.sources = [cat];
      r.offsets = {};
      const vid = ctx.versionId || 'v1';
      if (off !== null) r.offsets[vid] = off;
      r.videoOffsetSec = vid === 'v1' ? off : null; // 只在新版本出現的訊息，v1 offset 未知（F-18）
      r.offsetSource = off === null ? null : (ctx.source === 'replay' ? 'replay' : 'estimated');
      r.firstSeenAt = ctx.now;
      r.lastSeenAt = ctx.now;
    }
    r.phase = ctx.source === 'replay' ? 'live' : (PHASES.has(r.phase) ? r.phase : 'live');
    r.deleted = !!r.deleted;
    if (!r.deleted) delete r.deletedAt;
    r.aliasIds = Array.isArray(m.aliasIds) ? m.aliasIds.filter((a) => typeof a === 'string' && a && a !== r.id) : [];
    if (typeof r.id !== 'string' || !r.id) r.id = fallbackId(r);
    r.fp = makeFp(r);
    return r;
  }

  const SPECIAL = new Set(['id', 'videoId', 'type', 'sources', 'firstSeenAt', 'lastSeenAt', 'offsets', 'videoOffsetSec',
    'offsetSource', 'phase', 'deleted', 'deletedAt', 'aliasIds', 'fp']);

  // F-14 欄位合併（v28 依 F-18 修正）。ctx: { versionId, preserve }
  function mergeMessage(existing, inc, ctx) {
    const r = clone(existing);
    const before = JSON.stringify(existing);
    // system → 已知類型：採用新值的類型與欄位
    if (r.type === T.SYSTEM && inc.type !== T.SYSTEM) {
      r.type = inc.type;
      for (const k of Object.keys(inc)) if (!SPECIAL.has(k) && !isEmpty(inc[k])) r[k] = clone(inc[k]);
    }
    // 只補空欄位
    for (const k of Object.keys(inc)) {
      if (SPECIAL.has(k)) continue;
      if (isEmpty(r[k]) && !isEmpty(inc[k])) r[k] = clone(inc[k]);
    }
    r.sources = union(r.sources, inc.sources);
    r.firstSeenAt = Math.min(num(r.firstSeenAt) ?? Infinity, num(inc.firstSeenAt) ?? Infinity);
    if (!Number.isFinite(r.firstSeenAt)) r.firstSeenAt = inc.timestampAbs;
    r.lastSeenAt = Math.max(num(r.lastSeenAt) ?? 0, num(inc.lastSeenAt) ?? 0);
    // offset：原始收錄（v1）永不改寫；estimated 只在 v1 重播時升級為 replay
    r.offsets = Object.assign({}, r.offsets || {});
    const incOffsets = inc.offsets || {};
    const versionIds = ctx.preserve ? Object.keys(incOffsets) : [ctx.versionId || 'v1'];
    for (const vid of versionIds) {
      const o = num(incOffsets[vid]);
      if (o === null) continue;
      if (vid === 'v1') {
        if (num(r.videoOffsetSec) === null) {
          r.videoOffsetSec = o; r.offsets.v1 = o; r.offsetSource = inc.offsetSource || 'estimated';
        } else if (r.offsetSource !== 'replay' && inc.offsetSource === 'replay') {
          r.videoOffsetSec = o; r.offsets.v1 = o; r.offsetSource = 'replay'; r.phase = 'live';
        }
      } else if (num(r.offsets[vid]) === null) {
        r.offsets[vid] = o;
      }
    }
    if (!PHASES.has(r.phase)) r.phase = inc.phase;
    if (inc.deleted) {
      if (!r.deleted) { r.deleted = true; r.deletedAt = inc.deletedAt; }
      else if (num(inc.deletedAt) !== null) r.deletedAt = Math.min(num(r.deletedAt) ?? Infinity, inc.deletedAt);
    }
    r.aliasIds = union(r.aliasIds, inc.aliasIds).filter((a) => a !== r.id);
    if (inc.id !== r.id && !r.aliasIds.includes(inc.id)) r.aliasIds.push(inc.id);
    r.fp = makeFp(r);
    const changed = JSON.stringify(r) !== before;
    // significant：除了 lastSeenAt 以外有變動（決定是否計入 merged 與推播 NEW_MESSAGES）
    const significant = changed && JSON.stringify(Object.assign({}, r, { lastSeenAt: existing.lastSeenAt })) !== before;
    return { rec: r, changed, significant };
  }

  // 在交易內找既有紀錄：id → aliasIds 索引 → 新紀錄的別名 → fp（跨來源、只在 v1）
  async function findExisting(store, inc, ctx, stats) {
    let hit = await req(store.get(inc.id));
    if (hit) return hit;
    const aliasIdx = store.index('aliasIds');
    hit = await req(aliasIdx.get(inc.id));
    if (hit) return hit;
    for (const a of inc.aliasIds) {
      hit = (await req(store.get(a))) || (await req(aliasIdx.get(a)));
      if (hit) return hit;
    }
    if (!ctx.useFp || !inc.fp || (ctx.versionId && ctx.versionId !== 'v1')) return null;
    const cat = sourceCat(ctx.source);
    const cands = await req(store.index('videoId_fp').getAll([inc.videoId, inc.fp]));
    hit = cands.find((c) => c.id !== inc.id && !(c.sources || []).includes(cat)) || null;
    if (hit && stats) stats.fpMerged++;
    return hit;
  }

  // ---------------------------------------------------------------- 寫入：訊息
  // p: { videoId, stream?, messages[], source, captureSessionId?, versionId?, preserve? }
  // 回傳 { added, merged, unchanged, fpMerged, changed: 紀錄[] }
  function saveMessages(p) {
    const videoId = p.videoId;
    if (typeof videoId !== 'string' || !videoId) return Promise.reject(new Error('videoId required'));
    return withLock(videoId, async () => {
      const db = await open();
      const now = Date.now();
      const t = db.transaction(['messages', 'streams', 'capture_sessions'], 'readwrite');
      const store = t.objectStore('messages');
      const stats = { added: 0, merged: 0, unchanged: 0, fpMerged: 0 };
      const changed = [];
      let recalc = false;
      let session = null;
      let streamTimes = null;
      const work = (async () => {
        const sStore = t.objectStore('streams');
        const stream = (await req(sStore.get(videoId))) || newStream(videoId, now);
        Object.assign(stream, fillStreamDefaults(stream));
        recalc = mergeStreamMeta(stream, p.stream);
        const csStore = t.objectStore('capture_sessions');
        if (p.captureSessionId != null) session = (await req(csStore.get(p.captureSessionId))) || null;
        if (session && session.videoId !== videoId) session = null;
        const versionId = p.versionId || (session && session.versionId) || 'v1';
        const ctx = { videoId, source: p.source || 'live', versionId, now, preserve: !!p.preserve, useFp: true };
        let bytes = 0;
        for (const raw of p.messages || []) {
          if (!raw || typeof raw !== 'object') continue;
          const inc = normalizeIncoming(raw, ctx);
          // T5.1（審查十一第 10 節 2）：沒有頭像時，以同場次同作者已知的頭像補上（只在同一場次內）
          const ak = C.avatarAuthorKey(inc);
          if (ak) {
            const cache = avatarCacheFor(videoId);
            if (inc.authorAvatar) cache.set(ak, inc.authorAvatar);
            else if (cache.has(ak)) { inc.authorAvatar = cache.get(ak); stats.avatarFilled = (stats.avatarFilled || 0) + 1; }
          }
          const ex = await findExisting(store, inc, ctx, stats);
          let rec;
          if (ex) {
            const m = mergeMessage(ex, inc, ctx);
            rec = m.rec;
            if (m.changed) store.put(rec);
            if (m.significant) { changed.push(rec); stats.merged++; } else stats.unchanged++;
          } else {
            rec = inc;
            store.put(rec);
            changed.push(rec);
            stats.added++;
            bytes += approxSize(rec);
          }
          if (rec.timestampAbs != null) stream.lastMessageAt = Math.max(stream.lastMessageAt || 0, rec.timestampAbs);
          if (session) {
            const o = num(inc.offsets[versionId]);
            if (o !== null) {
              session.firstOffset = session.firstOffset == null ? o : Math.min(session.firstOffset, o);
              session.lastOffset = session.lastOffset == null ? o : Math.max(session.lastOffset, o);
            }
            session.firstTs = session.firstTs == null ? inc.timestampAbs : Math.min(session.firstTs, inc.timestampAbs);
            session.lastTs = session.lastTs == null ? inc.timestampAbs : Math.max(session.lastTs, inc.timestampAbs);
            if (!session.phases.includes(rec.phase)) session.phases.push(rec.phase);
          }
        }
        stream.messageCount += stats.added;
        stream.approxBytes += bytes;
        if (session) {
          session.added += stats.added;
          session.merged += stats.merged + stats.unchanged;
          session.lastWriteAt = now;
          csStore.put(session);
        }
        sStore.put(stream);
        recalc = recalc && stream.messageCount > 0;
        streamTimes = pickStreamTimes(stream);
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* already finished */ } });
      await Promise.all([work, done(t)]);
      if (recalc) await recomputePhasesUnlocked(videoId);
      return Object.assign(stats, { changed, stream: streamTimes });
    });
  }

  // 置頂訊息（不做 fp 後備去重）
  function savePinned(p) {
    const videoId = p.videoId;
    return withLock(videoId, async () => {
      const db = await open();
      const now = Date.now();
      const t = db.transaction(['pinned_messages', 'streams'], 'readwrite');
      const store = t.objectStore('pinned_messages');
      const stats = { added: 0, merged: 0, unchanged: 0 };
      const list = Array.isArray(p.messages) ? p.messages : (p.message ? [p.message] : []);
      const work = (async () => {
        const sStore = t.objectStore('streams');
        if (!(await req(sStore.get(videoId)))) sStore.put(newStream(videoId, now));
        let same = null; // 本場既有置頂（第一次需要時才讀）
        for (const raw of list) {
          const ctx = { videoId, source: p.source || 'live', versionId: p.versionId || 'v1', now, preserve: !!p.preserve, useFp: false };
          const inc = normalizeIncoming(raw, ctx);
          inc.pinnedAt = num(raw.pinnedAt) !== null ? raw.pinnedAt : inc.timestampAbs;
          let ex = (await req(store.get(inc.id))) || null;
          // T4.1（審查十一 5.1）：id 不同但同一則（作者＋正規化內容）→ 合併到既有那筆，不新增
          if (!ex) {
            if (!same) same = await req(store.index('videoId').getAll(videoId));
            ex = same.find((q) => C.samePinned(q, inc)) || null;
          }
          if (ex) {
            const m = mergeMessage(ex, inc, ctx);
            const rec = m.rec;
            const first = Math.min(num(ex.pinnedAt) ?? Infinity, inc.pinnedAt);
            const last = Math.max(C.pinnedTime(ex), inc.pinnedAt);
            const timesChanged = rec.pinnedAt !== first || rec.pinnedLastAt !== last;
            rec.pinnedAt = first; rec.pinnedLastAt = last;
            if (m.changed || timesChanged) store.put(rec);
            if (same) { const i = same.findIndex((q) => q.id === rec.id); if (i >= 0) same[i] = rec; }
            if (m.significant) stats.merged++; else stats.unchanged++;
          } else {
            inc.pinnedLastAt = inc.pinnedAt;
            store.put(inc); stats.added++;
            if (same) same.push(inc);
          }
        }
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* */ } });
      await Promise.all([work, done(t)]);
      return stats;
    });
  }

  // F-14 刪除訊息標記
  function markDeleted(p) {
    return withLock(p.videoId, async () => {
      const db = await open();
      const t = db.transaction('messages', 'readwrite');
      const store = t.objectStore('messages');
      let rec = null;
      const work = (async () => {
        const ex = (await req(store.get(p.id))) || (await req(store.index('aliasIds').get(p.id)));
        if (!ex || ex.videoId !== p.videoId || ex.deleted) { rec = ex && ex.videoId === p.videoId ? ex : null; return; }
        ex.deleted = true;
        ex.deletedAt = num(p.deletedAt) !== null ? p.deletedAt : Date.now();
        store.put(ex);
        rec = ex;
      })();
      await Promise.all([work, done(t)]);
      return { found: !!rec, record: rec };
    });
  }

  // ---------------------------------------------------------------- capture_sessions
  // p: { videoId, source, duration?, stream? } → { captureSessionId, versionId }
  function captureStart(p) {
    const videoId = p.videoId;
    const source = C.CAPTURE_SOURCES.includes(p.source) ? p.source : 'live';
    return withLock(videoId, async () => {
      await closeStaleSessions();
      const db = await open();
      const now = Date.now();
      const t = db.transaction(['streams', 'capture_sessions'], 'readwrite');
      let out;
      let recalc = false;
      const work = (async () => {
        const sStore = t.objectStore('streams');
        const stream = (await req(sStore.get(videoId))) || newStream(videoId, now);
        Object.assign(stream, fillStreamDefaults(stream));
        recalc = mergeStreamMeta(stream, p.stream) && stream.messageCount > 0;
        const versionId = source === 'replay'
          ? resolveVersion(stream.versions, p.duration, now)
          : (stream.versions.length ? 'v1' : resolveVersion(stream.versions, null, now));
        // T3.5（審查十追加三 F-1）：同一 videoId、同一 source、同一版本，上一筆在 60 秒內結束（或 60 秒內仍有寫入）
        // → 視為重新載入，沿用同一筆收錄紀錄，不算新的一次收錄
        const csStore = t.objectStore('capture_sessions');
        const prev = (await req(csStore.index('videoId').getAll(videoId)))
          .filter((x) => x.source === source && x.versionId === versionId)
          .sort((a, b) => b.startedAt - a.startedAt)[0];
        const lastAct = prev ? (prev.endedAt != null ? prev.endedAt : (prev.lastWriteAt || prev.startedAt)) : null;
        if (prev && now - lastAct <= C.CAPTURE_MERGE_GAP_MS) {
          prev.endedAt = null;
          prev.reloads = (prev.reloads || 0) + 1;
          csStore.put(prev);
          sStore.put(stream);
          out = { captureSessionId: prev.id, versionId, resumed: true };
          return;
        }
        stream[source + 'CaptureCount'] = (stream[source + 'CaptureCount'] || 0) + 1;
        sStore.put(stream);
        const session = {
          videoId, source, versionId, startedAt: now, endedAt: null, lastWriteAt: null,
          firstOffset: null, lastOffset: null, firstTs: null, lastTs: null, phases: [], added: 0, merged: 0,
        };
        const id = await req(t.objectStore('capture_sessions').add(session));
        out = { captureSessionId: id, versionId };
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* */ } });
      await Promise.all([work, done(t)]);
      if (recalc) await recomputePhasesUnlocked(videoId);
      return out;
    });
  }

  // T3.5（審查十追加三 B-1）：結束時一則都沒寫入（added + merged === 0）的收錄紀錄刪除，並扣回場次的收錄次數
  //（例如新聊天室載入時 YouTube 先建立又替換 iframe），避免後台「收錄次數」多算、覆蓋範圍出現空的 session
  function dropIfEmpty(session, csStore, sStore) {
    if (!session || (session.added || 0) + (session.merged || 0) > 0) return false;
    csStore.delete(session.id);
    const k = session.source + 'CaptureCount';
    const r = sStore.get(session.videoId);
    r.onsuccess = () => {
      const st = r.result;
      if (st && (st[k] || 0) > 0) { st[k]--; sStore.put(st); }
    };
    session.empty = true;
    return true;
  }

  async function captureEnd(p) {
    const db = await open();
    const t = db.transaction(['capture_sessions', 'streams'], 'readwrite');
    const s = t.objectStore('capture_sessions');
    let session = null;
    const work = (async () => {
      session = await req(s.get(p.captureSessionId));
      if (!session || session.endedAt != null) return;
      session.endedAt = num(p.endedAt) !== null ? p.endedAt : Date.now();
      if (!dropIfEmpty(session, s, t.objectStore('streams'))) s.put(session);
    })();
    await Promise.all([work, done(t)]);
    return session;
  }

  // 未收到 CAPTURE_END 的 session：超過 CAPTURE_STALE_MS 沒有寫入 → 以 lastWriteAt 補 endedAt（空的直接刪除）
  async function closeStaleSessions(now) {
    now = now || Date.now();
    const db = await open();
    const t = db.transaction(['capture_sessions', 'streams'], 'readwrite');
    const sStore = t.objectStore('streams');
    const csStore = t.objectStore('capture_sessions');
    let closed = 0;
    csStore.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      const v = cur.value;
      const last = v.lastWriteAt || v.startedAt;
      if (v.endedAt == null && last < now - C.CAPTURE_STALE_MS) {
        v.endedAt = last;
        if (!dropIfEmpty(v, csStore, sStore)) cur.update(v);
        closed++;
      }
      cur.continue();
    };
    await done(t);
    return closed;
  }

  // 區間合併（a 為 [start, end][]）
  function mergeIntervals(list, tol) {
    const a = list.filter((x) => x && x[0] != null && x[1] != null).map((x) => [Math.min(x[0], x[1]), Math.max(x[0], x[1])]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const x of a) {
      const last = out[out.length - 1];
      if (last && x[0] <= last[1] + (tol || 0)) last[1] = Math.max(last[1], x[1]);
      else out.push(x.slice());
    }
    return out;
  }

  // F-19 覆蓋範圍合併：live／popout 以時間（ms），replay 以各版本 offset（秒）；v1 重播在已知開播時間時換算成時間併入 all
  function coverage(sessions, stream, now) {
    now = now || Date.now();
    const liveIv = [];
    const replay = {};
    const allIv = [];
    for (const s of sessions) {
      if (s.source === 'replay') {
        if (s.firstOffset == null) continue;
        (replay[s.versionId] = replay[s.versionId] || []).push([s.firstOffset, s.lastOffset]);
        if (s.versionId === 'v1' && stream && stream.startedAt != null) {
          allIv.push([stream.startedAt + s.firstOffset * 1000, stream.startedAt + s.lastOffset * 1000]);
        }
      } else {
        const start = Math.min(s.startedAt, s.firstTs != null ? s.firstTs : Infinity);
        const end = Math.max(s.endedAt != null ? s.endedAt : (s.lastWriteAt || now), s.lastTs != null ? s.lastTs : -Infinity);
        liveIv.push([start, end]);
        allIv.push([start, end]);
      }
    }
    const tol = C.COVERAGE_GAP_TOLERANCE_MS;
    const all = mergeIntervals(allIv, tol);
    const gaps = [];
    for (let i = 1; i < all.length; i++) gaps.push([all[i - 1][1], all[i][0]]);
    const rep = {};
    for (const k of Object.keys(replay)) rep[k] = mergeIntervals(replay[k], tol / 1000);
    return { live: mergeIntervals(liveIv, tol), replay: rep, all, gaps };
  }

  async function listCaptureSessions(videoId) {
    const db = await open();
    const t = db.transaction(['capture_sessions', 'streams'], 'readonly');
    const [sessions, stream] = await Promise.all([
      req(t.objectStore('capture_sessions').index('videoId').getAll(videoId)),
      req(t.objectStore('streams').get(videoId)),
    ]);
    return { sessions, coverage: coverage(sessions, stream) };
  }

  // ---------------------------------------------------------------- phase 事後重算（F-14）
  // 開播／結束時間確定後：非重播紀錄依 timestampAbs 重算 phase 與 offset。單筆規則（純函式，預覽與實際重算共用）：
  //   重播精確值（offsetSource: replay）與只來自重播的紀錄不動；
  //   T3.6（追加五 E-2）本套件直播收錄的推算值（sources 含 live、estimated）一律以新的零點重算；
  //   遷移／匯入的 offset（不是由本套件的 startedAt 推算）只在為空時補上。
  // 回傳更新後的紀錄（複本），沒有變動回傳 null
  function recomputeRecord(rec, s) {
    if (!s || s.startedAt == null) return null;
    const fromLive = (rec.sources || []).some((x) => x === 'live' || x === 'legacy' || x === 'import');
    if (rec.offsetSource === 'replay' || !fromLive) return null;
    const v = clone(rec);
    const ts = v.timestampAbs;
    v.phase = ts < s.startedAt ? 'pre' : (s.endedAt != null && ts > s.endedAt ? 'post' : 'live');
    const ownEstimate = (v.sources || []).includes('live');
    if (num(v.videoOffsetSec) === null || ownEstimate) {
      v.videoOffsetSec = Math.round((ts - s.startedAt) / 100) / 10;
      v.offsets = Object.assign({}, v.offsets, { v1: v.videoOffsetSec });
      v.offsetSource = 'estimated';
    }
    v.fp = makeFp(v);
    return JSON.stringify(v) !== JSON.stringify(rec) ? v : null;
  }

  // T3.6 維護：以已知的實際開播／結束時間修正既有場次（例：延後開播、舊版以預定時間寫入 startedAt）
  // p: { startedAt?, endedAt?, dryRun（預設 true）, source（預設 'meta-actual'） }。不受來源等級限制（使用者明確指定）。
  // 預覽回傳前後的 phase 分布、offset 會改變的筆數；只回傳筆數
  async function recomputeStream(videoId, p) {
    p = p || {};
    const dryRun = p.dryRun !== false;
    const db = await open();
    const s0 = await getStream(videoId);
    if (!s0) return { ok: false, error: 'no-stream', videoId };
    const s = Object.assign({}, s0);
    if (num(p.startedAt) !== null) { s.startedAt = p.startedAt; s.startedAtSource = p.source || 'meta-actual'; s.startPending = false; }
    if (num(p.endedAt) !== null) { s.endedAt = p.endedAt; s.endedAtSource = p.source || 'meta-actual'; }
    const list = await req(db.transaction('messages').objectStore('messages').index('videoId').getAll(videoId));
    const tally = (arr) => arr.reduce((o, m) => { o[m.phase || '(無)'] = (o[m.phase || '(無)'] || 0) + 1; return o; }, {});
    const after = [];
    let changed = 0, offsetChanged = 0;
    for (const m of list) {
      const nv = recomputeRecord(m, s);
      if (nv) { changed++; if (nv.videoOffsetSec !== m.videoOffsetSec) offsetChanged++; }
      after.push(nv || m);
    }
    const out = { dryRun, videoId, messages: list.length, changed, offsetChanged,
      before: { startedAt: s0.startedAt ?? null, startedAtSource: s0.startedAtSource ?? null, endedAt: s0.endedAt ?? null, phases: tally(list) },
      after: { startedAt: s.startedAt ?? null, startedAtSource: s.startedAtSource ?? null, endedAt: s.endedAt ?? null, phases: tally(after) } };
    if (dryRun) return out;
    await withLock(videoId, async () => {
      const t = db.transaction(['streams'], 'readwrite');
      const cur = await req(t.objectStore('streams').get(videoId));
      for (const k of ['startedAt', 'startedAtSource', 'startPending', 'endedAt', 'endedAtSource']) cur[k] = s[k] ?? cur[k] ?? null;
      t.objectStore('streams').put(cur);
      await done(t);
      out.updated = await recomputePhasesUnlocked(videoId);
    });
    return out;
  }

  function recomputePhases(videoId) { return withLock(videoId, () => recomputePhasesUnlocked(videoId)); }
  async function recomputePhasesUnlocked(videoId) {
    const db = await open();
    const t = db.transaction(['messages', 'streams'], 'readwrite');
    let n = 0;
    const work = (async () => {
      const s = await req(t.objectStore('streams').get(videoId));
      if (!s || s.startedAt == null) return;
      await new Promise((res, rej) => {
        const r = t.objectStore('messages').index('videoId').openCursor(videoId);
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur) return res();
          const nv = recomputeRecord(cur.value, s);
          if (nv) { cur.update(nv); n++; }
          cur.continue();
        };
      });
    })();
    await Promise.all([work, done(t)]);
    return n;
  }

  // ---------------------------------------------------------------- 查詢
  async function getStream(videoId) {
    const db = await open();
    return req(db.transaction('streams').objectStore('streams').get(videoId));
  }

  async function listStreams() {
    const db = await open();
    const all = await req(db.transaction('streams').objectStore('streams').getAll());
    return all.sort((a, b) => (b.lastMessageAt || b.createdAt || 0) - (a.lastMessageAt || a.createdAt || 0));
  }

  // opts: { types?: string[], includeDeleted?: boolean (預設 true), offset?, limit? }
  async function queryMessages(videoId, opts) {
    opts = opts || {};
    const db = await open();
    let list = await req(db.transaction('messages').objectStore('messages').index('videoId').getAll(videoId));
    if (Array.isArray(opts.types) && opts.types.length) list = list.filter((m) => opts.types.includes(m.type));
    if (opts.includeDeleted === false) list = list.filter((m) => !m.deleted);
    list.sort((a, b) => (a.timestampAbs - b.timestampAbs) || ((a.videoOffsetSec ?? 0) - (b.videoOffsetSec ?? 0)));
    const start = opts.offset || 0;
    return opts.limit ? list.slice(start, start + opts.limit) : list.slice(start);
  }

  // T5.1（審查十一第 10 節）同場次的作者頭像快取（Service Worker 存活期間；最多 5 場、每場 5000 位作者）。
  // SW 重新啟動後清空：之前缺的頭像由 fillAvatars() 與檢視器的後備處理
  const avatarCache = new Map();
  function avatarCacheFor(videoId) {
    let c = avatarCache.get(videoId);
    if (!c) {
      c = new Map();
      avatarCache.set(videoId, c);
      while (avatarCache.size > 5) avatarCache.delete(avatarCache.keys().next().value);
    }
    if (c.size > 5000) c.delete(c.keys().next().value);
    return c;
  }
  // T5.1（審查十一第 10 節 4）既有紀錄的頭像補齊：同一場次同一作者（handle 或頻道 id）有任何一則有頭像，就補到其他缺頭像的訊息。
  // dryRun：只回傳筆數；{ dryRun: false } 才寫入
  async function fillAvatars(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const all = await req(db.transaction('messages').objectStore('messages').getAll());
    const byVid = new Map();
    for (const m of all) { if (!byVid.has(m.videoId)) byVid.set(m.videoId, []); byVid.get(m.videoId).push(m); }
    const out = { dryRun, messages: all.length, missing: 0, fillable: 0, filled: 0, streams: 0 };
    for (const [videoId, list] of byVid) {
      const known = new Map();
      for (const m of list) { const k = C.avatarAuthorKey(m); if (k && m.authorAvatar && !known.has(k)) known.set(k, m.authorAvatar); }
      const fix = [];
      for (const m of list) {
        if (m.authorAvatar || m.type === T.SYSTEM || m.type === T.RAID) continue;
        out.missing++;
        const k = C.avatarAuthorKey(m);
        if (k && known.has(k)) fix.push(Object.assign({}, m, { authorAvatar: known.get(k) }));
      }
      if (!fix.length) continue;
      out.fillable += fix.length;
      out.streams++;
      if (dryRun) continue;
      await withLock(videoId, async () => {
        const t = db.transaction('messages', 'readwrite');
        const s = t.objectStore('messages');
        for (const r of fix) {
          const cur = await req(s.get(r.id));
          if (cur && !cur.authorAvatar) { cur.authorAvatar = r.authorAvatar; s.put(cur); out.filled++; }
        }
        await done(t);
      });
    }
    return out;
  }

  // T5.1（審查十一 13.1 (B)）面板的補讀：offset ≥ minOffset 的訊息（videoId_offset 索引，不讀整場）。
  // offset 為 null 的訊息不在這個索引裡（開播時間未確認時），呼叫端需改用 queryMessages
  async function queryMessagesFromOffset(videoId, minOffset) {
    const db = await open();
    const range = IDBKeyRange.bound([videoId, minOffset], [videoId, Infinity]);
    const list = await req(db.transaction('messages').objectStore('messages').index('videoId_offset').getAll(range));
    list.sort((a, b) => (a.timestampAbs - b.timestampAbs) || ((a.videoOffsetSec ?? 0) - (b.videoOffsetSec ?? 0)));
    return list;
  }

  // v43（T5.2 (G)）場次的實際訊息筆數（videoId 索引的 count，不讀紀錄內容）。streams.messageCount 是寫入時累計的值，可能與實際不同
  async function countMessages(videoId) {
    const db = await open();
    return req(db.transaction('messages').objectStore('messages').index('videoId').count(videoId));
  }

  async function queryPinned(videoId) {
    const db = await open();
    return req(db.transaction('pinned_messages').objectStore('pinned_messages').index('videoId').getAll(videoId));
  }

  // T4.1（審查十一 5.1）既有置頂重複的整理：同一場、同一則（C.samePinned）的多筆合併成一筆
  //（保留最早置頂的那筆為主，pinnedAt 取最早、pinnedLastAt 取最晚，其他筆的 id 記入 aliasIds 後刪除）。
  // dryRun：只回傳筆數與「重複的各筆哪些欄位不同」（欄位名稱，不含內容），供確認原因
  const PIN_DIFF_FIELDS = ['id', 'authorHandle', 'authorName', 'authorChannelId', 'timestampAbs', 'source', 'type', 'authorBadges'];
  async function dedupePinnedStore(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const all = await req(db.transaction('pinned_messages').objectStore('pinned_messages').getAll());
    const byVid = new Map();
    for (const p of all) { if (!byVid.has(p.videoId)) byVid.set(p.videoId, []); byVid.get(p.videoId).push(p); }
    const out = { dryRun, records: all.length, streams: 0, groups: 0, removed: 0, perStream: [], diffFields: {} };
    for (const [videoId, list] of byVid) {
      const groups = [];
      for (const p of list.slice().sort((a, b) => (num(a.pinnedAt) ?? 0) - (num(b.pinnedAt) ?? 0))) {
        const g = groups.find((x) => C.samePinned(x[0], p));
        if (g) g.push(p); else groups.push([p]);
      }
      const dup = groups.filter((g) => g.length > 1);
      if (!dup.length) continue;
      out.streams++;
      out.groups += dup.length;
      const n = dup.reduce((s, g) => s + g.length - 1, 0);
      out.removed += n;
      out.perStream.push({ video: String(videoId).slice(0, 4) + '…', records: list.length, groups: dup.length, removed: n });
      for (const g of dup) {
        for (const f of PIN_DIFF_FIELDS) {
          if (new Set(g.map((x) => JSON.stringify(x[f] ?? null))).size > 1) out.diffFields[f] = (out.diffFields[f] || 0) + 1;
        }
        // 內容只差空白（原始文字不同、正規化後相同）
        const raw = new Set(g.map((x) => JSON.stringify((x.runs || []).map((r) => (r && (r.text || (r.emoji && r.emoji.alt))) || ''))));
        if (raw.size > 1) out.diffFields.runsRaw = (out.diffFields.runsRaw || 0) + 1;
      }
      if (dryRun) continue;
      await withLock(videoId, async () => {
        const t = db.transaction('pinned_messages', 'readwrite');
        const store = t.objectStore('pinned_messages');
        for (const g of dup) {
          let rec = g[0];
          let first = num(rec.pinnedAt) ?? Infinity, last = C.pinnedTime(rec);
          for (const o of g.slice(1)) {
            rec = mergeMessage(rec, o, { videoId, versionId: 'v1', preserve: true }).rec;
            first = Math.min(first, num(o.pinnedAt) ?? Infinity);
            last = Math.max(last, C.pinnedTime(o));
            store.delete(o.id);
          }
          rec.pinnedAt = Number.isFinite(first) ? first : rec.pinnedAt;
          rec.pinnedLastAt = last;
          store.put(rec);
        }
        await done(t);
      });
    }
    return out;
  }

  // T4.1（審查十一 2.2）頭像網址的網域分布：只回傳 類型 → 網域 → 筆數（不含網址），以游標逐筆讀
  async function avatarHostStats() {
    const db = await open();
    const out = {};
    await new Promise((res, rej) => {
      const r = db.transaction('messages').objectStore('messages').openCursor();
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return res();
        const m = cur.value;
        let host = '(none)';
        if (m.authorAvatar) { try { host = new URL(m.authorAvatar).hostname; } catch (_) { host = '(invalid)'; } }
        const b = out[m.type] || (out[m.type] = {});
        b[host] = (b[host] || 0) + 1;
        cur.continue();
      };
    });
    return out;
  }

  async function countAll() {
    const db = await open();
    const t = db.transaction(['streams', 'messages', 'pinned_messages', 'capture_sessions', 'channels']);
    const out = {};
    for (const n of ['streams', 'messages', 'pinned_messages', 'capture_sessions', 'channels']) out[n] = await req(t.objectStore(n).count());
    return out;
  }

  // ---------------------------------------------------------------- 刪除與重設
  function deleteByIndex(store, videoId) {
    return new Promise((res, rej) => {
      let n = 0;
      const r = store.index('videoId').openKeyCursor(videoId);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return res(n);
        store.delete(cur.primaryKey);
        n++;
        cur.continue();
      };
    });
  }

  async function wipe(videoId, keepStream) {
    const db = await open();
    const t = db.transaction(['streams', 'messages', 'pinned_messages', 'capture_sessions'], 'readwrite');
    const out = {};
    const work = (async () => {
      out.messages = await deleteByIndex(t.objectStore('messages'), videoId);
      out.pinned = await deleteByIndex(t.objectStore('pinned_messages'), videoId);
      out.sessions = await deleteByIndex(t.objectStore('capture_sessions'), videoId);
      const sStore = t.objectStore('streams');
      if (keepStream) {
        const s = await req(sStore.get(videoId));
        if (s) {
          // RESET_STREAM：保留基本資料與 linkedVideos；versions 由收錄產生，一併清空
          Object.assign(s, { messageCount: 0, approxBytes: 0, lastMessageAt: null, liveCaptureCount: 0,
            replayCaptureCount: 0, popoutCaptureCount: 0, versions: [] });
          sStore.put(s);
        }
      } else {
        sStore.delete(videoId);
      }
    })();
    await Promise.all([work, done(t)]);
    return out;
  }

  const resetStream = (videoId) => withLock(videoId, () => wipe(videoId, true));
  async function deleteStreams(videoIds) {
    const out = {};
    for (const v of videoIds || []) out[v] = await withLock(v, () => wipe(v, false));
    return out;
  }

  // 重新計算訊息數與估計大小（F-16）
  function recountStream(videoId) {
    return withLock(videoId, async () => {
      const db = await open();
      const t = db.transaction(['messages', 'streams'], 'readwrite');
      let res;
      const work = (async () => {
        const list = await req(t.objectStore('messages').index('videoId').getAll(videoId));
        const s = await req(t.objectStore('streams').get(videoId));
        if (!s) return;
        s.messageCount = list.length;
        s.approxBytes = list.reduce((a, m) => a + approxSize(m), 0);
        s.lastMessageAt = list.reduce((a, m) => Math.max(a, m.timestampAbs || 0), 0) || null;
        t.objectStore('streams').put(s);
        res = { messageCount: s.messageCount, approxBytes: s.approxBytes };
      })();
      await Promise.all([work, done(t)]);
      return res;
    });
  }

  // F-16：各場次大小（總用量由 background 以 navigator.storage.estimate() 取得）
  async function storageSummary() {
    const streams = await listStreams();
    return streams.map((s) => ({ videoId: s.videoId, title: s.title, messageCount: s.messageCount || 0, approxBytes: s.approxBytes || 0 }));
  }

  // ---------------------------------------------------------------- F-20 診斷記錄（T3.7）
  // 環狀：超過 maxRecords 筆或 maxBytes 時丟最舊的。紀錄由 background 消毒後寫入（只有筆數、標籤、屬性名稱、時間）
  let diagBytes = null; // 目前總大小（估計）；null = 尚未計算
  async function diagTotals(db) {
    let n = 0, bytes = 0;
    await new Promise((res, rej) => {
      const r = db.transaction('diag_log').objectStore('diag_log').openCursor();
      r.onerror = () => rej(r.error);
      r.onsuccess = () => { const c = r.result; if (!c) return res(); n++; bytes += c.value.sz || 0; c.continue(); };
    });
    return { n, bytes };
  }
  async function diagAppend(records, limits) {
    if (!Array.isArray(records) || !records.length) return { added: 0 };
    const db = await open();
    const maxN = (limits && limits.maxRecords) || 50000;
    const maxB = (limits && limits.maxBytes) || 20 * 1024 * 1024;
    if (diagBytes === null) diagBytes = (await diagTotals(db)).bytes;
    const t = db.transaction('diag_log', 'readwrite');
    const s = t.objectStore('diag_log');
    for (const r of records) {
      const rec = Object.assign({}, r);
      delete rec.seq;
      rec.sz = approxSize(rec);
      diagBytes += rec.sz;
      s.add(rec);
    }
    await done(t);
    // 環狀上限
    let count = await req(db.transaction('diag_log').objectStore('diag_log').count());
    let dropped = 0;
    if (count > maxN || diagBytes > maxB) {
      const t2 = db.transaction('diag_log', 'readwrite');
      await new Promise((res, rej) => {
        const r = t2.objectStore('diag_log').openCursor();
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const c = r.result;
          if (!c || (count <= maxN && diagBytes <= maxB)) return res();
          diagBytes -= c.value.sz || 0;
          c.delete();
          count--; dropped++;
          c.continue();
        };
      });
      await done(t2);
    }
    return { added: records.length, dropped, count };
  }
  async function diagAll() {
    const db = await open();
    return req(db.transaction('diag_log').objectStore('diag_log').getAll());
  }
  async function diagCount() {
    const db = await open();
    return req(db.transaction('diag_log').objectStore('diag_log').count());
  }
  async function diagClear() {
    const db = await open();
    const t = db.transaction('diag_log', 'readwrite');
    t.objectStore('diag_log').clear();
    await done(t);
    diagBytes = 0;
  }

  // ---------------------------------------------------------------- T3.6 欄位完整度統計（只回傳筆數）
  // p: { since（firstSeenAt 下限，ms）, videoId?, sources?（預設只算收錄來源 live／popout／replay） }
  // 解析若出錯會「靜默缺欄位」（不報錯），以此檢查各類型的欄位是否有值（審查十追加四 B、追加五 B）
  async function fieldStats(p) {
    p = p || {};
    const since = num(p.since) ?? 0;
    const srcSet = new Set(p.sources || ['live', 'popout', 'replay']);
    const db = await open();
    const out = {};
    const has = (v) => !isEmpty(v);
    await new Promise((res, rej) => {
      const store = db.transaction('messages', 'readonly').objectStore('messages');
      const r = p.videoId ? store.index('videoId').openCursor(p.videoId) : store.openCursor();
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return res();
        const m = cur.value;
        const src = Array.isArray(m.sources) ? m.sources : [];
        if ((num(m.firstSeenAt) ?? 0) >= since && src.some((s) => srcSet.has(s))) {
          const t = out[m.type] || (out[m.type] = { n: 0, author: 0, avatar: 0, time: 0, offset: 0, badges: 0, emoji: 0,
            amount: 0, color: 0, sticker: 0, giftImage: 0, deleted: 0, partial: 0, pre: 0, live: 0, post: 0 });
          t.n++;
          if (has(m.authorHandle) || has(m.authorName)) t.author++;
          if (has(m.authorAvatar)) t.avatar++;
          if (num(m.timestampAbs) !== null) t.time++;
          if (num(m.videoOffsetSec) !== null) t.offset++;
          if (Array.isArray(m.authorBadges) && m.authorBadges.length) t.badges++;
          if (Array.isArray(m.runs) && m.runs.some((x) => x && x.emoji)) t.emoji++;
          if (has(m.amount)) t.amount++;
          if (has(m.color)) t.color++;
          if (has(m.stickerSrc)) t.sticker++;
          if (has(m.giftImage)) t.giftImage++;
          if (m.deleted) t.deleted++;
          if (m.partial) t.partial++;
          if (PHASES.has(m.phase)) t[m.phase]++;
        }
        cur.continue();
      };
    });
    return out;
  }

  // ---------------------------------------------------------------- T3.4 清除垃圾 system 紀錄
  // v31 以前的擷取把訊息內部的子元件（徽章、yt-icon、span…）當成訊息存成 system。
  // p: { dryRun（預設 true）, isJunkTag(tag) → bool, since（firstSeenAt 下限，ms） }
  // 只動「type 為 system、rawTag 判定為垃圾、sources 只含 live／popout／replay、firstSeenAt ≥ since」的紀錄；
  // 遷移（legacy）與匯入（import）的紀錄一律不動。回傳只有筆數。
  const CAPTURE_ONLY = new Set(['live', 'popout', 'replay']);
  async function cleanupJunkSystem(p) {
    p = p || {};
    const dryRun = p.dryRun !== false;
    const since = num(p.since) ?? 0;
    const until = num(p.until) ?? Infinity;
    const isJunk = typeof p.isJunkTag === 'function' ? p.isJunkTag : () => false;
    const db = await open();
    const byVideo = new Map();
    const veGroups = new Map(); // T3.5：viewer-engagement 重複（同一場、同內容）→ 保留最早一筆
    const out = { dryRun, since, scanned: 0, matched: 0, byTag: {}, keptByTag: {}, streams: 0, deleted: 0,
      veGroups: 0, veDuplicates: 0, veMerged: 0, veRekeyed: 0 };
    await new Promise((res, rej) => {
      const r = db.transaction('messages', 'readonly').objectStore('messages').openCursor();
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return res();
        const v = cur.value;
        if (v.type === T.SYSTEM) {
          out.scanned++;
          const src = Array.isArray(v.sources) ? v.sources : [];
          const fs = num(v.firstSeenAt) ?? 0;
          const inScope = src.length && src.every((s) => CAPTURE_ONLY.has(s)) && fs >= since;
          // T3.6：子元件垃圾只清 until 之前（T3.4 部署前）首次收錄的；歡迎提示去重不受 until 限制
          if (v.rawTag && isJunk(v.rawTag) && inScope && fs < until) {
            out.matched++;
            out.byTag[v.rawTag] = (out.byTag[v.rawTag] || 0) + 1;
            if (!byVideo.has(v.videoId)) byVideo.set(v.videoId, []);
            byVideo.get(v.videoId).push(v.id);
          } else {
            // T3.5（審查十追加三 B-2）：保留的 system 紀錄也列出各 rawTag 筆數，方便檢查是否還有漏網的子元件
            const tag = v.rawTag || '(無 rawTag)';
            out.keptByTag[tag] = (out.keptByTag[tag] || 0) + 1;
            if (p.veTag && v.rawTag === p.veTag && inScope) {
              const key = C.viewerEngagementId(v.videoId, v.runs);
              if (!veGroups.has(key)) veGroups.set(key, []);
              veGroups.get(key).push(v);
            }
          }
        }
        cur.continue();
      };
    });
    // viewer-engagement：每組保留 firstSeenAt 最早的一筆，改用內容 id（之後收錄的同內容直接以 id 合併）
    const vePlan = []; // { videoId, keep, drop[], key }
    for (const [key, list] of veGroups) {
      list.sort((a, b) => (num(a.firstSeenAt) ?? 0) - (num(b.firstSeenAt) ?? 0));
      const keep = list[0];
      const drop = list.slice(1);
      if (!drop.length && keep.id === key) continue;
      vePlan.push({ videoId: keep.videoId, keep, drop, key });
      out.veGroups++;
      out.veDuplicates += drop.length;
    }
    out.streams = new Set([...byVideo.keys(), ...vePlan.map((x) => x.videoId)]).size;
    if (dryRun) return out;
    const touched = new Set();
    for (const [videoId, ids] of byVideo) {
      await withLock(videoId, async () => {
        const t = db.transaction('messages', 'readwrite');
        const s = t.objectStore('messages');
        for (const id of ids) s.delete(id);
        await done(t);
      });
      out.deleted += ids.length;
      touched.add(videoId);
    }
    for (const g of vePlan) {
      await withLock(g.videoId, async () => {
        const t = db.transaction('messages', 'readwrite');
        const s = t.objectStore('messages');
        for (const d of g.drop) s.delete(d.id);
        if (g.keep.id !== g.key) {
          s.delete(g.keep.id);
          const rec = Object.assign({}, g.keep, { id: g.key, aliasIds: union(g.keep.aliasIds, [g.keep.id]).filter((a) => a !== g.key) });
          s.put(rec);
          out.veRekeyed++;
        }
        await done(t);
      });
      out.veMerged += g.drop.length;
      touched.add(g.videoId);
    }
    for (const videoId of touched) await recountStream(videoId);
    return out;
  }

  // ---------------------------------------------------------------- F-13 重新分類
  // tagMap：selectors.js 的 messageTypeByTag；只依 rawTag 判斷，不重新解析文字
  async function reclassifySystem(p) {
    const tagMap = p.tagMap || {};
    const db = await open();
    const t = db.transaction('messages', 'readwrite');
    const store = t.objectStore('messages');
    const out = { scanned: 0, changed: 0, byType: {} };
    const r = p.videoId
      ? store.index('videoId_type').openCursor(IDBKeyRange.only([p.videoId, T.SYSTEM]))
      : store.openCursor();
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) return;
      const v = cur.value;
      if (v.type === T.SYSTEM) {
        out.scanned++;
        const nt = v.rawTag && tagMap[v.rawTag];
        if (nt && nt !== T.SYSTEM && TYPES.has(nt)) {
          v.type = nt;
          // T3.6：只依 rawTag 改類型，該類型的專屬欄位（禮物名稱、金額等）當初沒有解析 → 標記為部分資料
          v.partial = true;
          v.fp = makeFp(v);
          cur.update(v);
          out.changed++;
          out.byType[nt] = (out.byType[nt] || 0) + 1;
        }
      }
      cur.continue();
    };
    await done(t);
    return out;
  }

  // ---------------------------------------------------------------- F-18 版本標籤與連結影片
  function updateStream(videoId, fn) {
    return withLock(videoId, async () => {
      const db = await open();
      const t = db.transaction('streams', 'readwrite');
      let s;
      const work = (async () => {
        s = await req(t.objectStore('streams').get(videoId));
        if (!s) throw new Error('stream not found');
        Object.assign(s, fillStreamDefaults(s));
        fn(s);
        t.objectStore('streams').put(s);
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* */ } });
      await Promise.all([work, done(t)]);
      return s;
    });
  }

  const setVersionLabel = (p) => updateStream(p.videoId, (s) => {
    const v = s.versions.find((x) => x.id === p.versionId);
    if (!v) throw new Error('version not found');
    v.label = String(p.label || '').slice(0, 60) || v.label;
  });
  const linkVideo = (p) => updateStream(p.videoId, (s) => {
    if (!/^[\w-]{6,20}$/.test(p.linkedVideoId || '')) throw new Error('invalid linkedVideoId');
    const ex = s.linkedVideos.find((x) => x.videoId === p.linkedVideoId);
    const rec = { videoId: p.linkedVideoId, label: String(p.label || (ex && ex.label) || '剪輯版影片').slice(0, 60),
      offsetShift: num(p.offsetShift) !== null ? p.offsetShift : (ex ? ex.offsetShift : 0) };
    if (ex) Object.assign(ex, rec); else s.linkedVideos.push(rec);
  });
  const unlinkVideo = (p) => updateStream(p.videoId, (s) => { s.linkedVideos = s.linkedVideos.filter((x) => x.videoId !== p.linkedVideoId); });

  // ---------------------------------------------------------------- channels（F-03）
  async function getChannel(handleOrId) {
    const db = await open();
    return req(db.transaction('channels').objectStore('channels').get(handleOrId));
  }
  // T4 viewer：一次唯讀交易取多個頻道（回傳 Map，只含有 displayName 的紀錄）
  async function getChannels(keys) {
    const db = await open();
    const st = db.transaction('channels').objectStore('channels');
    const uniq = Array.from(new Set((keys || []).filter(Boolean)));
    const recs = await Promise.all(uniq.map((k) => req(st.get(k))));
    const out = new Map();
    recs.forEach((r, i) => { if (r && r.displayName) out.set(uniq[i], r); });
    return out;
  }
  async function putChannel(rec) {
    const db = await open();
    const t = db.transaction('channels', 'readwrite');
    t.objectStore('channels').put(rec);
    await done(t);
  }
  // T4.2（審查十一 9）頻道名稱解析的成功／失敗統計：只回傳筆數與原因分布（不含 handle 與名稱）
  async function channelStats() {
    const db = await open();
    const all = await req(db.transaction('channels').objectStore('channels').getAll());
    const out = { total: all.length, ok: 0, okNoAvatar: 0, failed: 0, empty: 0, byCredentials: {}, failReasons: {}, failDetail: {} };
    const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
    for (const c of all) {
      if (c.displayName) {
        out.ok++;
        if (!c.avatar) out.okNoAvatar++;
        inc(out.byCredentials, c.credentialsUsed || 'before-T4.2'); // T4.2 以前解析或從 v2.6.0 遷移的沒有此欄位
      } else if (c.failed) {
        out.failed++;
        inc(out.failReasons, c.failReason || 'before-T4.2');
        const f = c.failInfo;
        if (f) {
          const k = ['status ' + f.status, f.consent ? 'consent' : '', f.offSite ? 'offSite' : '', f.ogTitle ? 'ogTitle' : 'noOgTitle',
            f.retry ? 'retry:' + (f.retry.error ? 'error' : 'status ' + f.retry.status + (f.retry.ogTitle ? ' ogTitle' : ' noOgTitle')) : ''].filter(Boolean).join(' ');
          inc(out.failDetail, k);
        }
      } else out.empty++;
    }
    return out;
  }
  // 只在沒有紀錄或既有紀錄較舊時寫入（遷移與匯入用）
  async function putChannelIfNewer(rec) {
    const db = await open();
    const t = db.transaction('channels', 'readwrite');
    const s = t.objectStore('channels');
    const work = (async () => {
      const ex = await req(s.get(rec.handleOrId));
      if (!ex || (ex.fetchedAt || 0) < (rec.fetchedAt || 0)) s.put(rec);
    })();
    await Promise.all([work, done(t)]);
  }

  // ---------------------------------------------------------------- 匯出（F-11 v3 格式）
  async function exportData(p) {
    p = p || {};
    const db = await open();
    const t = db.transaction(['streams', 'messages', 'pinned_messages', 'capture_sessions']);
    let streams;
    if (p.videoId) {
      const s = await req(t.objectStore('streams').get(p.videoId));
      streams = s ? [s] : [];
    } else streams = await req(t.objectStore('streams').getAll());
    const out = { formatVersion: C.EXPORT_FORMAT_VERSION, app: C.EXPORT_APP, exportedAt: Date.now(),
      streams, messages: [], pinnedMessages: [], captureSessions: [] };
    for (const s of streams) {
      out.messages.push(...await req(t.objectStore('messages').index('videoId').getAll(s.videoId)));
      out.pinnedMessages.push(...await req(t.objectStore('pinned_messages').index('videoId').getAll(s.videoId)));
      out.captureSessions.push(...await req(t.objectStore('capture_sessions').index('videoId').getAll(s.videoId)));
    }
    return out;
  }

  // ---------------------------------------------------------------- v2.6.0 轉換（docs/legacy-v2.6.0-data.md）
  const LEGACY_TYPE = {
    'yt-live-chat-text-message-renderer': T.TEXT,
    'yt-live-chat-paid-message-renderer': T.SUPERCHAT,
    'yt-live-chat-paid-sticker-renderer': T.SUPERSTICKER,
    'yt-live-chat-membership-item-renderer': T.MEMBERSHIP,
    'yt-live-chat-viewer-engagement-message-renderer': T.RAID,
    'yt-live-chat-banner-redirect-renderer': T.RAID,
  };

  function convertLegacyMessage(o) {
    const videoId = o.videoId;
    const type = LEGACY_TYPE[o.type] || T.SYSTEM;
    const badges = [];
    if (o.isOwner) badges.push('owner');
    if (o.isCreatorLanding && type !== T.RAID) badges.push('verified');
    let authorHandle = '';
    let authorChannelId = '';
    const aid = typeof o.authorId === 'string' ? o.authorId : '';
    if (aid.startsWith('@')) authorHandle = aid;
    else if (aid.startsWith('channel/')) authorChannelId = aid.slice(8);
    if (!authorHandle && typeof o.authorName === 'string' && o.authorName.startsWith('@')) authorHandle = o.authorName;
    const runs = Array.isArray(o.parts)
      ? o.parts.map((p) => (p && p.type === 'emoji' ? { emoji: { src: p.src || '', alt: p.alt || '', shortcut: '' } } : { text: (p && p.text) || '' }))
      : (o.plainText ? [{ text: String(o.plainText) }] : []);
    const id = typeof o.id === 'string' && o.id ? o.id : null;
    const aliasIds = [];
    // 舊 id = `${videoId}_${元素 id}`；元素 id 即 YouTube 訊息 id（元素沒有 id 時是 `${Date.now()}_${亂數}`，不作別名）
    if (id && videoId && id.startsWith(videoId + '_')) {
      const rest = id.slice(videoId.length + 1);
      if (rest && !/^\d{13}_/.test(rest)) aliasIds.push(rest);
    }
    const m = {
      id, type, authorHandle, authorChannelId, authorUrl: o.authorUrl || '', authorAvatar: o.avatarUrl || '',
      authorBadges: badges, runs, timestampAbs: num(o.timestamp), videoOffsetSec: num(o.videoOffsetSec),
      phase: 'live', offsetSource: num(o.videoOffsetSec) === null ? null : 'estimated', aliasIds,
    };
    if (typeof o.authorName === 'string' && o.authorName && !o.authorName.startsWith('@')) m.authorName = o.authorName;
    else if (o.resolvedChannelName) m.authorName = String(o.resolvedChannelName);
    if (o.amount) m.amount = String(o.amount);
    if (type === T.SYSTEM && o.type) m.rawTag = String(o.type);
    if (!m.id) delete m.id;
    return m;
  }

  function convertLegacyStream(s, videoId) {
    s = s || {};
    return { title: s.title || '', channelName: s.channelName || '', isLive: false,
      startedAt: num(s.streamStartEpochMs) ?? num(s.createdAt), lastMessageAt: num(s.lastMessageTime) };
  }

  function convertLegacyChannel(c) {
    if (!c || typeof c.key !== 'string') return null;
    const key = c.key.startsWith('channel/') ? c.key.slice(8) : c.key;
    if (!key || key.startsWith('unknown:')) return null;
    return { handleOrId: key, displayName: c.displayName || '', avatar: c.avatarUrl || '', fetchedAt: num(c.updatedAt) || 0 };
  }

  // ---------------------------------------------------------------- 匯入（F-11：v2.6.0、v3 formatVersion 1/2）
  // 先完整驗證並轉成 { videoId → { stream, messages, pinned, sessions } }；格式錯誤時拋錯，不寫入任何資料
  function parseImport(data) {
    if (!data || typeof data !== 'object') throw new Error('格式錯誤：不是 JSON 物件');
    const groups = new Map();
    const g = (vid) => {
      if (typeof vid !== 'string' || !vid) throw new Error('格式錯誤：缺少 videoId');
      if (!groups.has(vid)) groups.set(vid, { stream: null, messages: [], pinned: [], sessions: [] });
      return groups.get(vid);
    };
    if (data.app === C.EXPORT_APP && (data.formatVersion === 1 || data.formatVersion === 2)) {
      if (!Array.isArray(data.streams) || !Array.isArray(data.messages)) throw new Error('格式錯誤：缺少 streams／messages');
      for (const s of data.streams) g(s && s.videoId).stream = s;
      for (const m of data.messages) { if (!m || typeof m.id !== 'string') throw new Error('格式錯誤：訊息缺少 id'); g(m.videoId).messages.push(m); }
      for (const m of data.pinnedMessages || []) g(m && m.videoId).pinned.push(m);
      for (const s of data.captureSessions || []) g(s && s.videoId).sessions.push(s);
      return { format: 'v3', formatVersion: data.formatVersion, groups, channels: [] };
    }
    if (data.formatVersion !== undefined) throw new Error('格式錯誤：不支援的 formatVersion ' + data.formatVersion);
    if (typeof data.videoId === 'string' && Array.isArray(data.messages)) {
      const ok = data.messages.every((m) => m && (Array.isArray(m.parts) || typeof m.plainText === 'string'));
      if (!ok) throw new Error('格式錯誤：不是 v2.6.0 匯出格式');
      const grp = g(data.videoId);
      grp.stream = convertLegacyStream(data.streamMeta, data.videoId);
      for (const m of data.messages) grp.messages.push(convertLegacyMessage(Object.assign({}, m, { videoId: data.videoId })));
      for (const m of data.pinnedMessages || []) {
        const c = convertLegacyMessage(Object.assign({}, m, { videoId: data.videoId }));
        c.type = T.TEXT; c.pinnedAt = c.timestampAbs;
        grp.pinned.push(c);
      }
      return { format: 'v2.6.0', groups, channels: [] };
    }
    throw new Error('格式錯誤：無法辨識的檔案格式');
  }

  // 預覽：以 id／別名判斷重複（不做 fp）
  async function previewGroups(parsed) {
    const db = await open();
    const t = db.transaction('messages');
    const store = t.objectStore('messages');
    let messages = 0, duplicates = 0;
    for (const [, grp] of parsed.groups) {
      for (const m of grp.messages) {
        messages++;
        const keys = [m.id, ...(m.aliasIds || [])].filter(Boolean);
        let hit = false;
        for (const k of keys) if ((await req(store.get(k))) || (await req(store.index('aliasIds').get(k)))) { hit = true; break; }
        if (hit) duplicates++;
      }
    }
    return { format: parsed.format, streams: parsed.groups.size, messages, duplicates };
  }

  async function importData(data, opts) {
    opts = opts || {};
    const parsed = parseImport(data);
    if (opts.dryRun) return previewGroups(parsed);
    const source = parsed.format === 'v2.6.0' ? 'legacy' : 'import';
    return applyGroups(parsed.groups, source);
  }

  async function applyGroups(groups, source) {
    const res = { streams: groups.size, messages: 0, added: 0, merged: 0, unchanged: 0, fpMerged: 0, pinnedAdded: 0, sessionsAdded: 0 };
    for (const [videoId, grp] of groups) {
      for (let i = 0; i < Math.max(1, grp.messages.length); i += C.LEGACY_BATCH) {
        const r = await saveMessages({ videoId, stream: grp.stream, messages: grp.messages.slice(i, i + C.LEGACY_BATCH), source, preserve: true });
        res.messages += grp.messages.slice(i, i + C.LEGACY_BATCH).length;
        res.added += r.added; res.merged += r.merged; res.unchanged += r.unchanged; res.fpMerged += r.fpMerged;
      }
      if (grp.pinned.length) res.pinnedAdded += (await savePinned({ videoId, messages: grp.pinned, source, preserve: true })).added;
      if (grp.sessions.length) res.sessionsAdded += await importSessions(videoId, grp.sessions);
    }
    return res;
  }

  // 收錄紀錄：以 (source, startedAt) 去重
  function importSessions(videoId, sessions) {
    return withLock(videoId, async () => {
      const db = await open();
      const t = db.transaction('capture_sessions', 'readwrite');
      const s = t.objectStore('capture_sessions');
      let n = 0;
      const work = (async () => {
        const ex = await req(s.index('videoId').getAll(videoId));
        const seen = new Set(ex.map((x) => x.source + '|' + x.startedAt));
        for (const x of sessions) {
          const key = x.source + '|' + x.startedAt;
          if (seen.has(key)) continue;
          seen.add(key);
          const rec = Object.assign({}, x, { videoId });
          delete rec.id;
          s.add(rec);
          n++;
        }
      })();
      await Promise.all([work, done(t)]);
      return n;
    });
  }

  // ---------------------------------------------------------------- F-11 舊資料庫唯讀遷移
  // 不指定版本開啟；觸發 onupgradeneeded 代表舊庫不存在 → abort，不建立空庫。只使用 readonly 交易。
  function openLegacy() {
    return new Promise((resolve, reject) => {
      let missing = false;
      const r = indexedDB.open(cfg.legacyDbName);
      r.onupgradeneeded = () => { missing = true; r.transaction.abort(); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = (e) => { if (missing) { e.preventDefault(); resolve(null); } else reject(r.error); };
      r.onblocked = () => reject(new Error('legacy db blocked'));
    });
  }

  async function legacyCounts(ldb) {
    const names = ['streams', 'messages', 'pinned_messages', 'channels'].filter((n) => ldb.objectStoreNames.contains(n));
    const t = ldb.transaction(names, 'readonly');
    const out = {};
    for (const n of names) out[n] = await req(t.objectStore(n).count());
    return out;
  }

  async function migrateLegacy(opts) {
    opts = opts || {};
    const batch = opts.batchSize || C.LEGACY_BATCH;
    const ldb = await openLegacy();
    if (!ldb) return { exists: false };
    try {
      const has = (n) => ldb.objectStoreNames.contains(n);
      const counts = await legacyCounts(ldb);
      const migrated = { streams: 0, messages: { added: 0, merged: 0, unchanged: 0, fpMerged: 0 }, pinned: { added: 0, merged: 0, unchanged: 0 }, channels: 0 };
      const getAll = (n, range, count) => req(ldb.transaction(n, 'readonly').objectStore(n).getAll(range, count));
      const legacyStreams = has('streams') ? await getAll('streams') : [];
      const streamMeta = new Map(legacyStreams.map((s) => [s.videoId, convertLegacyStream(s, s.videoId)]));
      for (const [videoId, meta] of streamMeta) {
        await saveMessages({ videoId, stream: meta, messages: [], source: 'legacy', preserve: true });
        migrated.streams++;
      }
      if (has('messages')) {
        let lastKey = null;
        for (;;) {
          const range = lastKey === null ? undefined : IDBKeyRange.lowerBound(lastKey, true);
          const rows = await getAll('messages', range, batch);
          if (!rows.length) break;
          lastKey = rows[rows.length - 1].id;
          const byVid = new Map();
          for (const o of rows) {
            if (!o || typeof o.videoId !== 'string' || !o.videoId) continue;
            if (!byVid.has(o.videoId)) byVid.set(o.videoId, []);
            byVid.get(o.videoId).push(convertLegacyMessage(o));
          }
          for (const [videoId, msgs] of byVid) {
            const r = await saveMessages({ videoId, stream: streamMeta.get(videoId), messages: msgs, source: 'legacy', preserve: true });
            for (const k of ['added', 'merged', 'unchanged', 'fpMerged']) migrated.messages[k] += r[k];
          }
          if (opts.onProgress) opts.onProgress({ lastKey, migrated });
          if (rows.length < batch) break;
        }
      }
      if (has('pinned_messages')) {
        const rows = await getAll('pinned_messages');
        const byVid = new Map();
        for (const o of rows) {
          if (!o || !o.videoId) continue;
          const c = convertLegacyMessage(o);
          c.type = T.TEXT; c.pinnedAt = c.timestampAbs;
          if (!byVid.has(o.videoId)) byVid.set(o.videoId, []);
          byVid.get(o.videoId).push(c);
        }
        for (const [videoId, msgs] of byVid) {
          const r = await savePinned({ videoId, messages: msgs, source: 'legacy', preserve: true });
          for (const k of ['added', 'merged', 'unchanged']) migrated.pinned[k] += r[k];
        }
      }
      if (has('channels')) {
        for (const c of await getAll('channels')) {
          const rec = convertLegacyChannel(c);
          if (rec) { await putChannelIfNewer(rec); migrated.channels++; }
        }
      }
      return { exists: true, legacyCounts: counts, migratedCounts: migrated, legacyCountsAfter: await legacyCounts(ldb) };
    } finally {
      ldb.close();
    }
  }

  root.YTCAS_DB = {
    configure, open, close,
    saveMessages, savePinned, markDeleted,
    captureStart, captureEnd, closeStaleSessions, listCaptureSessions,
    recomputePhases, recomputeStream, recountStream, cleanupJunkSystem, fieldStats, pickStreamTimes,
    diagAppend, diagAll, diagCount, diagClear,
    getStream, listStreams, queryMessages, queryMessagesFromOffset, countMessages, fillAvatars, queryPinned, countAll, storageSummary, dedupePinnedStore, avatarHostStats,
    resetStream, deleteStreams, reclassifySystem,
    setVersionLabel, linkVideo, unlinkVideo,
    getChannel, getChannels, putChannel, putChannelIfNewer, channelStats,
    exportData, importData, parseImport, migrateLegacy,
    // 純函式（測試用）
    util: { hash, normText, makeFp, fallbackId, normalizeIncoming, mergeMessage, resolveVersion, mergeIntervals, coverage,
      convertLegacyMessage, convertLegacyChannel, isEmpty },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
