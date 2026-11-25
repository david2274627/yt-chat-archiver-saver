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

  function safeHttpUrl(u) {
    if (typeof u !== 'string' || !u) return '';
    try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href.slice(0, 2000) : ''; } catch (_) { return ''; }
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
    // v47（T5.6，審查十一 26.1）頁面 meta 說預定開播時間在未來（scheduledFuture）→ 待機室：預定時間以最新的為準（延期），
    // 已有的 startedAt（重播來源除外）降級為 startedAtSuspect（視同沒有，C.effectiveStart）；說已開播／已結束 → 解除
    // v48（T5.7，審查十一 27 第 1 點）已由重新抓取確認正在直播（liveConfirmedAt）→ 分頁上沒重新整理的舊 meta 說「在未來」一律忽略
    if (meta.scheduledFuture === true && num(meta.scheduledStartAt) !== null && !s.liveConfirmedAt && !num(meta.liveConfirmedAt)) {
      s.scheduledStartAt = meta.scheduledStartAt;
      s.scheduledFuture = true;
      if (s.startedAt != null && s.endedAt == null && s.startedAtSource !== 'replay' && !s.startedAtSuspect) {
        s.startedAtSuspect = true;
        timesChanged = true;
      }
    } else if (meta.scheduledFuture === false || num(meta.endedAt) !== null) s.scheduledFuture = false;
    // T3.6：startedAt／endedAt 依來源等級覆蓋（C.START_SOURCE_RANK）；預定時間（scheduled）不得寫入 startedAt
    // v47：待機室中（預定時間在未來）不接受重播以外的開播時間；已降級的 startedAt 視同沒有（任何來源都可覆蓋）
    const future = C.isFutureScheduled(s);
    for (const k of ['startedAt', 'endedAt']) {
      const v = num(meta[k]);
      const srcKey = k + 'Source';
      const inc = typeof meta[srcKey] === 'string' ? meta[srcKey] : null;
      if (v === null || inc === 'scheduled') continue;
      if (k === 'startedAt' && future && inc !== 'replay') continue;
      // v53（34.2.1）撤銷過的降落暫定結束：擷取端（還沒收到撤銷）再送來同一個或更早的 raid 結束時間 → 不採用
      if (k === 'endedAt' && inc === 'raid' && num(s.raidEndRevokedAt) !== null && v <= s.raidEndRevokedAt) continue;
      const suspect = k === 'startedAt' && s.startedAtSuspect;
      const curRank = s[k] == null || suspect ? -1 : C.startRank(s[srcKey]);
      if (C.startRank(inc) > curRank && (s[k] !== v || suspect)) {
        s[k] = v;
        s[srcKey] = inc;
        if (k === 'startedAt') {
          s.startedAtSuspect = false; s.scheduledFuture = false;
          // v51（T6.2，審查十一 32.8）第一次得知開播的來源與時間（之後被較高等級的來源覆蓋也保留）：判讀「待機室→開播」是哪條路徑觸發
          if (!s.startFirstSource) { s.startFirstSource = inc; s.startFirstAt = Date.now(); }
        }
        timesChanged = true;
      } else if (s[k] === v && inc && C.startRank(inc) > C.startRank(s[srcKey])) {
        s[srcKey] = inc;
      }
    }
    if (s.scheduledStartAt == null && num(meta.scheduledStartAt) !== null) s.scheduledStartAt = meta.scheduledStartAt;
    // v48：重新抓取確認正在直播，且這次的開播時間已採用（或與現值相同）→ 記下
    if (num(meta.liveConfirmedAt) !== null && s.startedAt != null && s.startedAt === num(meta.startedAt) && !s.startedAtSuspect) {
      s.liveConfirmedAt = meta.liveConfirmedAt; s.scheduledFuture = false;
    }
    if (C.effectiveStart(s) != null) s.startPending = false;
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
    // v47（26.1）startedAt 回傳「實際採用」的值（待機室或已降級 → null），擷取端不會再採用錯誤的開播時間
    const eff = C.effectiveStart(s);
    return { startedAt: eff, startedAtSource: eff == null ? null : s.startedAtSource ?? null, endedAt: s.endedAt ?? null,
      endedAtSource: s.endedAtSource ?? null, scheduledStartAt: s.scheduledStartAt ?? null, startPending: !!s.startPending,
      scheduledFuture: !!s.scheduledFuture, startedAtSuspect: !!s.startedAtSuspect, liveConfirmedAt: s.liveConfirmedAt ?? null,
      suspectSource: s.startedAt != null && eff == null ? s.startedAtSource ?? '(無)' : null, // 診斷：被降級的 startedAt 的來源
      channelHandle: s.channelHandle || '', isLive: !!s.isLive,
      raidEndRevokedAt: s.raidEndRevokedAt ?? null }; // v53（34.2.1）擷取端據此撤銷本分頁的降落暫定結束
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
    // v44（17.1）連結 run：只保留 http／https 的完整網址，其他協定只留文字（擷取、匯入、遷移都經過這裡）
    else r.runs = r.runs.map((x) => (x && x.link ? (safeHttpUrl(x.link.url) ? { text: String(x.text || ''), link: { url: safeHttpUrl(x.link.url) } } : { text: String(x.text || '') }) : x));
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
    // v54（35.6）重播：負的影片時間（開播前的聊天）→ pre
    r.phase = ctx.source === 'replay' ? C.replayPhase(off) : (PHASES.has(r.phase) ? r.phase : 'live');
    r.deleted = !!r.deleted;
    if (!r.deleted) delete r.deletedAt;
    r.aliasIds = Array.isArray(m.aliasIds) ? m.aliasIds.filter((a) => typeof a === 'string' && a && a !== r.id) : [];
    if (typeof r.id !== 'string' || !r.id) r.id = fallbackId(r);
    // v50（30.5）擷取端的替換提示只在寫入當下使用，不存
    delete r.replacesId;
    delete r.replaceInPlace;
    delete r.replacesFallback;
    r.fp = makeFp(r);
    return r;
  }

  // ---------------------------------------------------------------- v50（T6.1，審查十一 30.5）自己送出的訊息重複
  // 暫時節點（送出中）與正式節點各存了一筆。合併規則：
  //   1. 擷取端帶 replacesId（看得出前一筆是暫時節點）→ 同作者同內容（原地改 id 時不比對）就合併；
  //   2. 沒有提示時：同場次、同作者、同內容（C.ownKey）、時間差 ≤ 90 秒，而且**其中一筆是暫時 id**（S.isTempChatId）才合併。
  //      兩筆都是正式 id 一律不合併（同一個人連續送出相同內容、不同人的「8888」）。
  // 合併後以正式 id 為主、暫時 id 記入 aliasIds；時間取到達時間那一筆（通常是暫時節點），offset／phase 跟著時間
  const isTempId = (id) => { const s = root.YTCAS_SEL; return !!(s && typeof s.isTempChatId === 'function' && s.isTempChatId(id)); };
  const hasTempAlias = (r) => (r.aliasIds || []).some(isTempId);
  // v52（T6.3，審查十一 33.6）id 形狀符合還不夠（實機 tempIds 803、pairs 155，重播來源等也有這種形狀的 id）：
  // 暫時節點的紀錄＝形狀符合＋**只有直播來源**（live／popout；重播、遷移、匯入不會有「送出中」的節點）＋一般文字＋到達時間
  const TEMP_PAIR_MS = 30 * 1000; // 暫時 → 正式的時間差上限（v51 為 90 秒）
  function isTempRec(m) {
    if (!m || !isTempId(m.id) || m.type !== 'text' || m.tsSource !== 'arrival') return false;
    const src = Array.isArray(m.sources) ? m.sources : [];
    return src.length > 0 && src.every((x) => x === 'live' || x === 'popout');
  }
  const TIME_KEYS = ['timestampAbs', 'tsSource', 'videoOffsetSec', 'offsetSource', 'phase'];
  function foldTwin(real, temp) {
    const r = clone(real);
    for (const k of Object.keys(temp)) if (!SPECIAL.has(k) && !TIME_KEYS.includes(k) && isEmpty(r[k]) && !isEmpty(temp[k])) r[k] = clone(temp[k]);
    const tA = temp.tsSource === 'arrival', rA = real.tsSource === 'arrival';
    const useTemp = real.offsetSource !== 'replay' && num(temp.timestampAbs) !== null &&
      (tA && !rA ? true : rA && !tA ? false : temp.timestampAbs < (num(real.timestampAbs) ?? Infinity));
    if (useTemp) {
      for (const k of TIME_KEYS) { if (temp[k] === undefined) delete r[k]; else r[k] = clone(temp[k]); }
      r.offsets = Object.assign({}, real.offsets || {}, temp.offsets || {});
      if (num(temp.videoOffsetSec) === null) delete r.offsets.v1;
    }
    r.sources = union(real.sources, temp.sources);
    r.firstSeenAt = Math.min(num(real.firstSeenAt) ?? Infinity, num(temp.firstSeenAt) ?? Infinity);
    if (!Number.isFinite(r.firstSeenAt)) r.firstSeenAt = r.timestampAbs;
    r.lastSeenAt = Math.max(num(real.lastSeenAt) ?? 0, num(temp.lastSeenAt) ?? 0);
    if (temp.deleted && !r.deleted) { r.deleted = true; r.deletedAt = temp.deletedAt; }
    r.aliasIds = union(union(real.aliasIds, temp.aliasIds), [temp.id]).filter((a) => a && a !== r.id);
    r.fp = makeFp(r);
    return r;
  }
  // 寫入中的同場次最近文字訊息（只在 background 記憶體；Service Worker 重啟後由 fixOwnDuplicates 處理遺漏）
  const twinCaches = new Map();
  // v51（T6.2）依 key／id 建索引（v50 每則訊息線性掃描最多 3,000 筆兩次，壓力測試 P95 49 → 68ms）
  function twinCacheFor(videoId) {
    let c = twinCaches.get(videoId);
    if (!c) {
      if (twinCaches.size > 20) twinCaches.delete(twinCaches.keys().next().value);
      c = { order: [], byId: new Map(), byKey: new Map() };
      twinCaches.set(videoId, c);
    }
    return c;
  }
  function dropTwin(c, e) {
    c.byId.delete(e.id);
    const arr = c.byKey.get(e.key);
    if (arr) { const i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1); if (!arr.length) c.byKey.delete(e.key); }
    e.gone = true;
  }
  function rememberTwin(videoId, rec, now) {
    const key = C.ownKey(rec);
    if (!key) return;
    const c = twinCacheFor(videoId);
    const t = now - 10 * 60 * 1000;
    while (c.order.length && (c.order[0].at < t || c.order.length > 3000)) { const e = c.order.shift(); if (!e.gone) dropTwin(c, e); }
    const e = c.byId.get(rec.id);
    if (e) { e.ts = rec.timestampAbs; return; }
    const ne = { id: rec.id, key, ts: rec.timestampAbs, temp: isTempRec(rec), at: now };
    c.order.push(ne); c.byId.set(rec.id, ne);
    if (!c.byKey.has(key)) c.byKey.set(key, []);
    c.byKey.get(key).push(ne);
  }
  function forgetTwin(videoId, id) {
    const c = twinCaches.get(videoId);
    const e = c && c.byId.get(id);
    if (e) dropTwin(c, e);
  }
  // 回傳 { other, realIsRec } 或 null
  async function findTwin(store, rec, hint) {
    if (hint.replacesId && hint.replacesId !== rec.id) {
      const o = await req(store.get(hint.replacesId));
      // v51（T6.2，32.2）原地改 id 也要同作者同內容（v50 不比對）；非文字訊息（ownKey 空）只在原地改 id 時以作者與內容比對
      const ko = C.ownKey(o || {}), kr = C.ownKey(rec);
      const same = ko ? ko === kr : (hint.inPlace && !kr && o && (o.authorHandle || '') === (rec.authorHandle || '') && normText(o.runs) === normText(rec.runs) && o.type === rec.type);
      if (o && o.videoId === rec.videoId && same) return { other: o, realIsRec: true };
    }
    const key = C.ownKey(rec);
    if (!key) return null;
    const recTemp = isTempRec(rec);
    if (!recTemp && hasTempAlias(rec)) return null; // 已經合併過
    const W = TEMP_PAIR_MS; // v52（33.6）30 秒
    const cands = (twinCacheFor(rec.videoId).byKey.get(key) || [])
      .filter((e) => e.id !== rec.id && e.temp !== recTemp && Math.abs(e.ts - rec.timestampAbs) <= W)
      .sort((a, b) => Math.abs(a.ts - rec.timestampAbs) - Math.abs(b.ts - rec.timestampAbs));
    for (const c of cands) {
      const o = await req(store.get(c.id));
      if (!o || C.ownKey(o) !== key) continue;
      if (recTemp && hasTempAlias(o)) continue; // 這筆正式訊息已配過暫時節點
      return { other: o, realIsRec: !recTemp };
    }
    return null;
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
          r.videoOffsetSec = o; r.offsets.v1 = o; r.offsetSource = 'replay';
          // v54（35.6）live／replay 合併：本套件直播收錄過的那筆，phase 以 live 的絕對時間與開播時間判斷（寫入時已依此計算，不改）；
          // 只有重播的才看影片時間正負（v53 以前一律改成 live → 開播前的訊息被放進「直播中」）
          if (!(existing.sources || []).includes('live')) r.phase = C.replayPhase(o);
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
        const effStart = C.effectiveStart(stream);
        const csStore = t.objectStore('capture_sessions');
        if (p.captureSessionId != null) session = (await req(csStore.get(p.captureSessionId))) || null;
        if (session && session.videoId !== videoId) session = null;
        const versionId = p.versionId || (session && session.versionId) || 'v1';
        const ctx = { videoId, source: p.source || 'live', versionId, now, preserve: !!p.preserve, useFp: true };
        let bytes = 0, ownRemoved = 0;
        for (const raw of p.messages || []) {
          if (!raw || typeof raw !== 'object') continue;
          let inc = normalizeIncoming(raw, ctx);
          // v51（T6.2，32.7）保底：還沒重新注入的舊版擷取端可能送來未來的時間 → 寫入前往前推整天（新版擷取端不會發生）
          if (!ctx.preserve && ctx.source !== 'replay') {
            const ff = futureFix(inc, stream, now, true);
            if (ff) { inc = ff; stats.futureFixed = (stats.futureFixed || 0) + 1; }
          }
          // T5.1（審查十一第 10 節 2）：沒有頭像時，以同場次同作者已知的頭像補上（只在同一場次內）
          const ak = C.avatarAuthorKey(inc);
          if (ak) {
            const cache = avatarCacheFor(videoId);
            if (inc.authorAvatar) cache.set(ak, inc.authorAvatar);
            else if (cache.has(ak)) { inc.authorAvatar = cache.get(ak); stats.avatarFilled = (stats.avatarFilled || 0) + 1; }
          }
          const ex = await findExisting(store, inc, ctx, stats);
          // v52（T6.3，審查十一 33.1）id 全域唯一：已存在**別的場次**（例：降落時舊聊天室的訊息被存進新場次，之後原場次的彈出視窗又收到同一則）
          // → 照 F-14 合併到既有那筆（場次不變），但記下跨場次的次數（streamCompare 用；只存次數）
          if (ex && ex.videoId !== videoId) {
            stats.crossVideo = (stats.crossVideo || 0) + 1;
            const cv = stream.crossVideo && typeof stream.crossVideo === 'object' ? stream.crossVideo : (stream.crossVideo = {});
            cv[ex.videoId] = (cv[ex.videoId] || 0) + 1;
          }
          let rec;
          // v48（T5.7，審查十一 27 第 1 點）擷取端還不知道開播時間（待機室→開播、不重新整理），background 已經知道：
          // 送來的 pre／offset 空的直播訊息依已知的開播時間重算（pre→live），不必等下一次 startedAt 變動
          const fix = (r) => {
            // v54（T6.4，審查十一 35.4 第 1 點）待機室保底：擷取端還不知道預定時間（例：頁面 meta 沒有 startDate、
            // 預定時間由 background 重新抓取才得知）時，livePhase 的預設是 live → 待機室中自己送出的訊息被放進「直播中」。
            // background 的場次在待機室（C.isWaitingAt）→ 直播來源的 live 一律改 pre（自己送出、暫時節點、合併都經過這裡）
            if (effStart == null && ctx.source !== 'replay') {
              const w = waitingLiveFix(r, stream, now);
              if (w) { stats.waitingFixed = (stats.waitingFixed || 0) + 1; return w; }
              return r;
            }
            if (effStart == null || ctx.source === 'replay' || !(r.phase === 'pre' || num(r.videoOffsetSec) === null)) return r;
            const nv = recomputeRecord(r, stream);
            if (nv) stats.phaseFixed = (stats.phaseFixed || 0) + 1;
            return nv || r;
          };
          let pushedAt = -1;
          if (ex) {
            const m = mergeMessage(ex, inc, ctx);
            rec = fix(m.rec);
            if (m.changed || rec !== m.rec) store.put(rec);
            if (m.significant) { pushedAt = changed.push(rec) - 1; stats.merged++; } else stats.unchanged++;
          } else {
            rec = fix(inc);
            store.put(rec);
            pushedAt = changed.push(rec) - 1;
            stats.added++;
            bytes += approxSize(rec);
          }
          // v50（T6.1，審查十一 30.5）自己送出的訊息：暫時節點與正式節點合併成一筆（以正式 id 為主）
          if (ctx.source !== 'replay' && !ctx.preserve) {
            // v51（32.2）replacesFallback：舊節點擷取時還沒有 id（存成後備 id）→ 依同一套規則算出那筆的後備 id
            const rf = raw.replacesFallback && typeof raw.replacesFallback === 'object' ? fallbackId(raw.replacesFallback) : '';
            const tw = await findTwin(store, rec, { replacesId: typeof raw.replacesId === 'string' && raw.replacesId ? raw.replacesId : rf, inPlace: !!raw.replaceInPlace });
            if (tw) {
              const real = tw.realIsRec ? rec : tw.other, temp = tw.realIsRec ? tw.other : rec;
              const folded = fix(foldTwin(real, temp));
              store.delete(temp.id);
              store.put(folded);
              forgetTwin(videoId, temp.id);
              if (ex) ownRemoved++; else { stats.added--; bytes -= approxSize(rec); }
              stats.ownMerged = (stats.ownMerged || 0) + 1;
              if (pushedAt >= 0) changed[pushedAt] = folded; else changed.push(folded);
              rec = folded;
            }
          }
          if (ctx.source !== 'replay') rememberTwin(videoId, rec, now);
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
        stream.messageCount = Math.max(0, stream.messageCount + stats.added - ownRemoved);
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

  // v52（T6.3，審查十一 33.3 第 1 點）取消置頂：擷取端看到原生置頂橫幅消失（或換成別則）超過 3 秒 → unpinnedAt。
  // 以 id 或別名找；之後同一則再被置頂（savePinned 的 pinnedAt 晚於 unpinnedAt）就清掉。回傳 { found, changed }
  function unpinPinned(p) {
    const videoId = p.videoId;
    return withLock(videoId, async () => {
      const db = await open();
      const t = db.transaction('pinned_messages', 'readwrite');
      const store = t.objectStore('pinned_messages');
      let found = false, changed = false;
      const work = (async () => {
        let rec = await req(store.get(p.id));
        if (!rec || rec.videoId !== videoId) rec = (await req(store.index('videoId').getAll(videoId))).find((q) => (q.aliasIds || []).includes(p.id)) || null;
        if (!rec) return;
        found = true;
        const at = num(p.unpinnedAt) ?? Date.now();
        // v53（34 第 4 點）unpinnedAtSource：gone＝收錄中看到它從置頂列消失、absent＝開始收錄後置頂列確定沒有它（取消的實際時間更早）
        if (at >= C.pinnedTime(rec) && rec.unpinnedAt !== at && num(rec.unpinnedAt) === null) { rec.unpinnedAt = at; rec.unpinnedAtSource = p.source === 'absent' ? 'absent' : 'gone'; store.put(rec); changed = true; }
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* */ } });
      await Promise.all([work, done(t)]);
      return { found, changed };
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
            let timesChanged = rec.pinnedAt !== first || rec.pinnedLastAt !== last;
            rec.pinnedAt = first; rec.pinnedLastAt = last;
            // v52（T6.3，33.3）取消後又置頂 → 清掉 unpinnedAt
            if (num(rec.unpinnedAt) !== null && inc.pinnedAt > rec.unpinnedAt) { delete rec.unpinnedAt; delete rec.unpinnedAtSource; timesChanged = true; stats.repinned = (stats.repinned || 0) + 1; }
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
  // v54（T6.4，審查十一 35.6）重播來源也重算 phase（offset 不動）：
  //   只來自重播 → 依影片時間正負（C.replayPhase：負的＝開播前的聊天 → pre）；
  //   live／replay 合併（offsetSource replay、sources 含 live）→ 依 live 的絕對時間與開播時間
  //   （v53 以前重播合併時一律改成 live，fixPhases 也跳過重播 → 開播前的訊息留在「直播中」段）
  function recomputeRecord(rec, s) {
    if (C.isNotice(rec)) return null; // v45（21.3）頁面狀態提示不參與 phase
    const fromLive = (rec.sources || []).some((x) => x === 'live' || x === 'legacy' || x === 'import');
    const hasReplay = (rec.sources || []).includes('replay');
    if (!fromLive && hasReplay) {
      const ph = C.replayPhase(num(rec.videoOffsetSec));
      if (num(rec.videoOffsetSec) === null || ph === rec.phase) return null;
      const v = clone(rec); v.phase = ph; v.fp = makeFp(v);
      return v;
    }
    const st0 = C.effectiveStart(s); // v47（26.1）待機室或已降級的 startedAt 不重算
    if (st0 == null) return null;
    if (!fromLive) return null;
    if (rec.offsetSource === 'replay') {
      const ts = num(rec.timestampAbs);
      if (ts === null || !(rec.sources || []).includes('live')) return null;
      const ph = ts < st0 ? 'pre' : (s.endedAt != null && ts > s.endedAt ? 'post' : 'live');
      if (ph === rec.phase) return null;
      const v = clone(rec); v.phase = ph; v.fp = makeFp(v);
      return v;
    }
    const v = clone(rec);
    const ts = v.timestampAbs;
    v.phase = ts < st0 ? 'pre' : (s.endedAt != null && ts > s.endedAt ? 'post' : 'live');
    const ownEstimate = (v.sources || []).includes('live');
    if (num(v.videoOffsetSec) === null || ownEstimate) {
      v.videoOffsetSec = Math.round((ts - st0) / 100) / 10;
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
    if (num(p.startedAt) !== null) { s.startedAt = p.startedAt; s.startedAtSource = p.source || 'meta-actual'; s.startPending = false; s.startedAtSuspect = false; s.scheduledFuture = false; }
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
      for (const k of ['startedAt', 'startedAtSource', 'startPending', 'endedAt', 'endedAtSource', 'startedAtSuspect', 'scheduledFuture']) cur[k] = s[k] ?? cur[k] ?? null;
      t.objectStore('streams').put(cur);
      await done(t);
      out.updated = await recomputePhasesUnlocked(videoId);
    });
    return out;
  }

  // v51（T6.2，審查十一 32.7）直播／待機室訊息的時間晚於寫入時間（＋1 分鐘）＝顯示時間被當成「今天」而落在未來
  // （進入頁面時載入的前幾天訊息）。往前推整天到不晚於寫入時間，phase／offset 依場次重算。
  // 寫入時只有顯示時間的訊息（不是到達時間）才會發生；舊資料沒有保存原始文字與 DOM 順序 → 以「不晚於寫入時間的最近一天」推算，
  // 標 tsSource 'clock-ambiguous'（面板「≈」說明日期可能不準）
  // clockOnly：寫入時的保底只處理擷取端明確標為顯示時間（clock）的訊息；維護函式另含沒有 tsSource 的舊資料（v42 以前）
  function futureFix(rec, s, writeAt, clockOnly) {
    if (!rec || rec.offsetSource === 'replay' || rec.tsSource === 'arrival' || rec.tsSource === 'capture' || C.isNotice(rec)) return null;
    if (clockOnly && rec.tsSource !== 'clock' && rec.tsSource !== 'clock-ambiguous') return null;
    const ts = num(rec.timestampAbs), w = num(writeAt);
    if (ts === null || w === null || ts <= w + C.CLOCK_FUTURE_TOL_MS) return null;
    const DAY = 24 * 3600 * 1000;
    const v = clone(rec);
    v.timestampAbs = ts - Math.ceil((ts - (w + C.CLOCK_FUTURE_TOL_MS)) / DAY) * DAY;
    v.tsSource = 'clock-ambiguous';
    const st0 = s ? C.effectiveStart(s) : null;
    if (st0 != null) {
      v.phase = v.timestampAbs < st0 ? 'pre' : (s.endedAt != null && v.timestampAbs > s.endedAt ? 'post' : 'live');
      if ((v.sources || []).includes('live') && v.offsetSource !== 'replay') {
        v.videoOffsetSec = Math.round((v.timestampAbs - st0) / 100) / 10;
        v.offsets = Object.assign({}, v.offsets, { v1: v.videoOffsetSec });
        v.offsetSource = 'estimated';
      }
    } else if (s && (s.startPending || (typeof s.scheduledStartAt === 'number' && v.timestampAbs < s.scheduledStartAt) || C.isFutureScheduled(s, w))) {
      v.phase = 'pre';
    }
    v.fp = makeFp(v);
    return v;
  }
  async function fixFutureTimes(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const [all, streams] = await Promise.all([req(db.transaction('messages').objectStore('messages').getAll()), req(db.transaction('streams').objectStore('streams').getAll())]);
    const sMap = new Map(streams.map((s) => [s.videoId, s]));
    const byVid = new Map();
    let maxAhead = 0, phaseChanged = 0;
    for (const m of all) {
      const r = futureFix(m, sMap.get(m.videoId), m.firstSeenAt);
      if (!r) continue;
      maxAhead = Math.max(maxAhead, m.timestampAbs - m.firstSeenAt);
      if (r.phase !== m.phase) phaseChanged++;
      if (!byVid.has(m.videoId)) byVid.set(m.videoId, []);
      byVid.get(m.videoId).push(m.id);
    }
    const out = { dryRun, messages: Array.from(byVid.values()).reduce((a, x) => a + x.length, 0), phaseChanged,
      maxAheadMin: Math.round(maxAhead / 60000), streams: Array.from(byVid, ([v, ids]) => ({ v: String(v).slice(0, 4), n: ids.length })), fixed: 0 };
    if (dryRun) return out;
    for (const [videoId, ids] of byVid) {
      await withLock(videoId, async () => {
        const t = db.transaction(['messages', 'streams'], 'readwrite');
        const ms = t.objectStore('messages');
        const s = await req(t.objectStore('streams').get(videoId));
        for (const id of ids) {
          const cur = await req(ms.get(id));
          const r = futureFix(cur, s, cur && cur.firstSeenAt);
          if (r) { ms.put(r); out.fixed++; }
        }
        await done(t);
      });
      await recountStream(videoId); // lastMessageAt 也可能在未來
    }
    return out;
  }

  // v45（T5.4，審查十一 21.2 第 1 點）既有資料：所有已知開播時間的場次，依目前的 startedAt／endedAt 重算 phase（與寫入時的自動重算同一規則）。
  // dryRun：只回傳各場會改變的筆數與 phase 分布（videoId 只留 4 碼）；{ dryRun: false } 才寫入
  // v47（T5.6，審查十一 26.1）一併處理「待機室被記了開播時間」：startedAtSuspect，或預定時間在未來、還沒結束、
  // startedAt 不是重播來源 → 清除 startedAt，本套件直播收錄的訊息改回 pre、推算的 offset 清空（waiting 清單）。
  // 例外：meta-actual（頁面 meta 說已開播）且最近一次 meta 沒有說「在未來」＝提早開播，不動
  function waitingWrongStart(s, now) {
    if (!s || s.startedAt == null || s.endedAt != null || s.startedAtSource === 'replay') return false;
    if (s.startedAtSuspect || C.isFutureScheduled(s, now)) return true;
    return typeof s.scheduledStartAt === 'number' && s.scheduledStartAt > now && s.startedAtSource !== 'meta-actual';
  }
  function toWaitingRecord(rec) {
    if (C.isNotice(rec) || rec.offsetSource === 'replay' || !(rec.sources || []).includes('live')) return null;
    const v = clone(rec);
    v.phase = 'pre';
    if (v.offsetSource === 'estimated' || v.offsetSource == null) {
      v.videoOffsetSec = null;
      if (v.offsets) { v.offsets = Object.assign({}, v.offsets); delete v.offsets.v1; }
      delete v.offsetSource;
    }
    v.fp = makeFp(v);
    return JSON.stringify(v) !== JSON.stringify(rec) ? v : null;
  }
  async function recomputeAllPhases(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const all = await req(db.transaction('streams').objectStore('streams').getAll());
    const now = Date.now();
    const out = { dryRun, streams: 0, changed: 0, updated: 0, list: [], waiting: [] };
    for (const s of all.filter((x) => waitingWrongStart(x, now))) {
      const msgs = await req(db.transaction('messages').objectStore('messages').index('videoId').getAll(s.videoId));
      const moves = {};
      let n = 0;
      for (const m of msgs) {
        const nv = toWaitingRecord(m);
        if (!nv) continue;
        n++;
        if (nv.phase !== m.phase) { const k = (m.phase || '(無)') + '→pre'; moves[k] = (moves[k] || 0) + 1; }
      }
      out.waiting.push({ vid: String(s.videoId).slice(0, 4), startedAtSource: s.startedAtSource || '(無)', suspect: !!s.startedAtSuspect,
        scheduledInHours: typeof s.scheduledStartAt === 'number' ? Math.round((s.scheduledStartAt - now) / 360000) / 10 : null, changed: n, moves });
      if (dryRun) continue;
      await withLock(s.videoId, async () => {
        const t = db.transaction(['messages', 'streams'], 'readwrite');
        const work = (async () => {
          const cur = await req(t.objectStore('streams').get(s.videoId));
          if (!cur || !waitingWrongStart(cur, now)) return;
          cur.startedAt = null; cur.startedAtSource = null; cur.startedAtSuspect = false;
          if (typeof cur.scheduledStartAt === 'number' && cur.scheduledStartAt > now) cur.scheduledFuture = true;
          t.objectStore('streams').put(cur);
          await new Promise((res, rej) => {
            const r = t.objectStore('messages').index('videoId').openCursor(s.videoId);
            r.onerror = () => rej(r.error);
            r.onsuccess = () => {
              const c = r.result;
              if (!c) return res();
              const nv = toWaitingRecord(c.value);
              if (nv) { c.update(nv); out.updated++; }
              c.continue();
            };
          });
        })();
        await Promise.all([work, done(t)]);
      });
    }
    const streams = (dryRun ? all.filter((x) => !waitingWrongStart(x, now)) : await req(db.transaction('streams').objectStore('streams').getAll()))
      .filter((s) => C.effectiveStart(s) != null);
    for (const s of streams) {
      const msgs = await req(db.transaction('messages').objectStore('messages').index('videoId').getAll(s.videoId));
      const moves = {};
      let n = 0, replay = 0, merged = 0;
      for (const m of msgs) {
        const nv = recomputeRecord(m, s);
        if (!nv) continue;
        n++;
        // v54（35.6）重播來源的改動：只來自重播（replay）／live 與 replay 合併（merged）
        const src = m.sources || [];
        if (src.includes('replay')) { if (src.includes('live')) merged++; else replay++; }
        if (nv.phase !== m.phase) { const k = (m.phase || '(無)') + '→' + nv.phase; moves[k] = (moves[k] || 0) + 1; }
      }
      if (!n) continue;
      out.streams++; out.changed += n;
      out.list.push({ vid: String(s.videoId).slice(0, 4), ended: s.endedAt != null, changed: n, replay, merged, moves });
      if (!dryRun) out.updated += await recomputePhases(s.videoId);
    }
    // v54（T6.4，審查十一 35.4 第 1 點）待機室中（還沒有開播時間）被存成 live 的直播訊息 → pre（waitingLive）。
    // 已開播的場次由上面依開播時間重算（早於開播 → pre），這裡只處理還在待機室的
    out.waitingLive = [];
    for (const s of all.filter((x) => C.effectiveStart(x, now) == null && x.endedAt == null && !waitingWrongStart(x, now))) {
      const msgs = await req(db.transaction('messages').objectStore('messages').index('videoId').getAll(s.videoId));
      const ids = msgs.filter((m) => waitingLiveFix(m, s, now)).map((m) => m.id);
      if (!ids.length) continue;
      out.waitingLive.push({ vid: String(s.videoId).slice(0, 4), changed: ids.length });
      out.changed += ids.length;
      if (dryRun) continue;
      await withLock(s.videoId, async () => {
        const t = db.transaction(['messages', 'streams'], 'readwrite');
        const work = (async () => {
          const cur = await req(t.objectStore('streams').get(s.videoId));
          for (const id of ids) {
            const m = await req(t.objectStore('messages').get(id));
            const nv = m && waitingLiveFix(m, cur, now);
            if (nv) { t.objectStore('messages').put(nv); out.updated++; }
          }
        })();
        await Promise.all([work, done(t)]);
      });
    }
    return out;
  }
  // v54（35.4 第 1 點）待機室保底：直播來源、不是提示、phase live、場次在待機室（C.isWaitingAt）→ pre（複本）；否則 null
  function waitingLiveFix(rec, s, now) {
    if (!rec || rec.phase !== 'live' || C.isNotice(rec) || rec.offsetSource === 'replay') return null;
    const src = rec.sources || [];
    if (!src.length || !src.every((x) => x === 'live' || x === 'popout')) return null;
    if (!C.isWaitingAt(s, num(rec.timestampAbs), now)) return null;
    const v = clone(rec);
    v.phase = 'pre';
    v.fp = makeFp(v);
    return v;
  }

  // v45（21.3）system 紀錄的元件標籤統計（只有標籤與筆數，不含文字）：找出「頁面狀態提示」用的是哪個元件
  async function systemTagStats() {
    const db = await open();
    const all = await req(db.transaction('messages').objectStore('messages').getAll());
    const out = { system: 0, notice: 0, byTag: {} };
    for (const m of all) {
      if (m.type !== T.SYSTEM) continue;
      out.system++;
      if (C.isNotice(m)) out.notice++;
      const k = (m.rawTag || '(無 rawTag)') + (C.isNotice(m) ? '（提示）' : '');
      out.byTag[k] = (out.byTag[k] || 0) + 1;
    }
    return out;
  }

  // v53（T6.3.1，審查十一 34.2.1 第 3 點）撤銷降落暫定的結束時間（endedAtSource 'raid'）：重新抓取確認仍在直播（isLiveNow、
  // 沒有 endDate）時呼叫。v52 把進場卡也當成降落橫幅，被降落的直播會被提前判為結束。只動來源是 raid 的結束時間；
  // 撤銷後依時間重算 phase（post → live）。回傳 { revoked, changed }
  async function revokeRaidEnd(videoId) {
    return withLock(videoId, async () => {
      const db = await open();
      const t = db.transaction('streams', 'readwrite');
      let revoked = false;
      const work = (async () => {
        const s = await req(t.objectStore('streams').get(videoId));
        if (!s || s.endedAt == null || s.endedAtSource !== 'raid') return;
        s.endedAt = null; s.endedAtSource = null; s.raidEndRevokedAt = Date.now();
        t.objectStore('streams').put(s);
        revoked = true;
      })();
      await Promise.all([work, done(t)]);
      const changed = revoked ? await recomputePhasesUnlocked(videoId) : 0;
      return { revoked, changed };
    });
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

  // v45（T5.4，審查十一 20.4 第 5 點）既有禮物的重新解析（結構確認前能做的部分）：
  // 作者空白、內文開頭是 @handle → 補 authorHandle／authorUrl、authorSource: 'text'；文字是 @handle 的連結 → 網址改為 https://www.youtube.com/@handle。
  // 禮物名稱、禮物圖片需要原始 DOM（沒有保存），無法重新解析。dryRun：只回傳筆數；{ dryRun: false } 才寫入
  function giftFix(m) {
    if (!m || m.type !== T.GIFT) return null;
    const r = clone(m);
    let changed = false;
    if (!r.authorHandle && !r.authorName && !r.authorChannelId) {
      const first = (r.runs || []).find((x) => x && typeof x.text === 'string' && x.text.trim());
      const h = first ? C.handleOf(first.text) : '';
      if (h) { r.authorHandle = h; r.authorUrl = C.handleUrl(h); r.authorSource = 'text'; changed = true; }
    }
    r.runs = (r.runs || []).map((x) => {
      if (!x || !x.link || typeof x.text !== 'string') return x;
      const h = C.domHandle(x.text); // v48（28.2）連結文字＝DOM 給的 handle
      if (!h || x.link.url === C.handleUrl(h)) return x;
      changed = true;
      return { text: x.text, link: { url: C.handleUrl(h) } };
    });
    if (!changed) return null;
    r.fp = makeFp(r);
    return r;
  }
  async function fixGiftAuthors(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const all = await req(db.transaction('messages').objectStore('messages').getAll());
    const out = { dryRun, gifts: 0, unknownAuthor: 0, fillable: 0, links: 0, fixed: 0, streams: 0 };
    const byVid = new Map();
    for (const m of all) {
      if (m.type !== T.GIFT) continue;
      out.gifts++;
      if (!m.authorHandle && !m.authorName && !m.authorChannelId) out.unknownAuthor++;
      const r = giftFix(m);
      if (!r) continue;
      if (r.authorSource === 'text' && m.authorSource !== 'text') out.fillable++;
      if (JSON.stringify(r.runs) !== JSON.stringify(m.runs)) out.links++;
      if (!byVid.has(m.videoId)) byVid.set(m.videoId, []);
      byVid.get(m.videoId).push(m.id);
    }
    out.streams = byVid.size;
    if (dryRun) return out;
    for (const [videoId, ids] of byVid) {
      await withLock(videoId, async () => {
        const t = db.transaction('messages', 'readwrite');
        const s = t.objectStore('messages');
        for (const id of ids) {
          const cur = await req(s.get(id));
          const r = giftFix(cur);
          if (r) { s.put(r); out.fixed++; }
        }
        await done(t);
      });
    }
    return out;
  }

  // v50（T6.1，審查十一 30.5 第 4 點）既有資料：自己送出的訊息被存成兩筆（暫時 id＋正式 id）。
  // 規則同寫入時的第 2 條：同場次、同作者同內容、時間差 ≤ 90 秒、其中一筆是暫時 id → 合併（每筆正式訊息最多配一筆暫時訊息，取時間最近）。
  // dryRun（預設）：只回傳筆數、各場筆數（videoId 4 碼）、暫時 id 總數；
  //   另列「同作者同內容 90 秒內、兩筆都是正式 id」的組數與 id 形狀（前 4 碼＋長度），用來核對暫時 id 的格式（不一定是重複、不會合併）。
  // { dryRun: false } 才寫入，寫入後重新計算各場筆數
  // v52（T6.3，33.6）暫時那筆用 isTempRec（直播來源、文字、到達時間），時間差 ≤ 30 秒
  function ownPairs(list) {
    const W = TEMP_PAIR_MS;
    const isTempId = isTempRec; // 本函式內的「暫時」一律指暫時節點的紀錄
    const groups = new Map();
    for (const m of list) {
      if (m.videoId == null) continue;
      const k = C.ownKey(m);
      if (!k) continue;
      const g = m.videoId + '\u0002' + k;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    const pairs = [], suspects = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => (a.timestampAbs || 0) - (b.timestampAbs || 0));
      const used = new Set(arr.filter(hasTempAlias).map((m) => m.id)); // 已配過暫時節點的正式訊息
      for (const t of arr.filter((m) => isTempId(m))) {
        let best = null;
        for (const r of arr) {
          if (isTempId(r) || used.has(r.id)) continue;
          const d = Math.abs((r.timestampAbs || 0) - (t.timestampAbs || 0));
          if (d <= W && (!best || d < best.d)) best = { r, d };
        }
        if (best) { used.add(best.r.id); pairs.push({ real: best.r, temp: t, d: best.d }); }
      }
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i];
        if (!isTempId(a) && !isTempId(b) && (b.timestampAbs || 0) - (a.timestampAbs || 0) <= W) suspects.push([a, b]);
      }
    }
    return { pairs, suspects };
  }
  async function fixOwnDuplicates(opts) {
    const dryRun = !opts || opts.dryRun !== false;
    const db = await open();
    const all = await req(db.transaction('messages').objectStore('messages').getAll());
    const { pairs, suspects } = ownPairs(all);
    const byVid = new Map();
    for (const p of pairs) { if (!byVid.has(p.real.videoId)) byVid.set(p.real.videoId, []); byVid.get(p.real.videoId).push(p); }
    const shape = (id) => String(id || '').slice(0, 4) + '|' + String(id || '').length;
    const shapes = new Map();
    // v51（31.1 第 3 點）來源類別（live／replay／legacy／import）一併列出：例如 `N-Lv|52` 是 v2.6.0 遷移資料（`videoId_元素 id`）
    const srcOf = (m) => (Array.isArray(m.sources) && m.sources.length ? m.sources.slice().sort().join('/') : '?');
    for (const [a, b] of suspects) { const k = [shape(a.id), shape(b.id)].sort().join(' + ') + ' @ ' + [srcOf(a), srcOf(b)].sort().join(' + '); shapes.set(k, (shapes.get(k) || 0) + 1); }
    // v52（T6.3，33.6）形狀符合的 id 依「形狀＋來源＋類型＋時間來源」分組（v51 的 tempIds 803 是哪些）；pairs 的形狀與時間差分布
    const tally = (arr, keyOf) => { const m = new Map(); for (const x of arr) { const k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); } return Array.from(m, ([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 12); };
    const shapeMatch = all.filter((m) => isTempId(m.id));
    const tempRecs = shapeMatch.filter(isTempRec);
    const out = { dryRun, pairs: pairs.length, tempIds: tempRecs.length, tempShapeMatches: shapeMatch.length,
      tempShapes: tally(shapeMatch, (m) => shape(m.id) + ' @ ' + srcOf(m) + ' · ' + (m.type || '?') + ' · ' + (m.tsSource || '?') + (isTempRec(m) ? ' ✓' : '')),
      pairShapes: tally(pairs, (p) => shape(p.temp.id) + ' → ' + shape(p.real.id) + ' @ ' + srcOf(p.real) + ' · ' + (p.real.type || '?')),
      pairDt: { le10s: pairs.filter((p) => p.d <= 10000).length, le30s: pairs.filter((p) => p.d > 10000 && p.d <= 30000).length },
      streams: Array.from(byVid, ([v, ps]) => ({ v: String(v).slice(0, 4), n: ps.length })),
      sameTextBothReal: { pairs: suspects.length, idShapes: Array.from(shapes, ([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 5) },
      merged: 0 };
    // v53（T6.3.1，審查十一 34.1）作者數（只有數字，不含 handle）：tempAuthors＝符合條件的暫時節點紀錄的作者數、
    // pairAuthors＝配對的作者數；大於 1 時列各作者的筆數分布（多到少，最多 20 個）。
    // 沒有配對的暫時節點紀錄為什麼沒配對：noTwin＝同場次沒有同作者同內容的正式紀錄（大多是正式節點只改 id、沒有另存一筆）、
    // twinFar＝有但時間差 > 30 秒、twinUsed＝30 秒內的正式紀錄已配給別筆（或已合併過）、noKey＝沒有作者或內容
    const authorOf = (m) => (m.authorHandle || '').toLowerCase() || m.authorChannelId || m.authorName || '';
    const dist = (arr) => { const m = new Map(); for (const a of arr) m.set(a, (m.get(a) || 0) + 1); return Array.from(m.values()).sort((x, y) => y - x); };
    const tA = dist(tempRecs.map(authorOf)), pA = dist(pairs.map((p) => authorOf(p.temp)));
    out.tempAuthors = tA.length; out.pairAuthors = pA.length;
    if (tA.length > 1) out.tempAuthorDist = tA.slice(0, 20);
    if (pA.length > 1) out.pairAuthorDist = pA.slice(0, 20);
    const pairedTemp = new Set(pairs.map((p) => p.temp.id));
    const realByKey = new Map();
    for (const m of all) {
      if (isTempRec(m) || m.videoId == null) continue;
      const k = C.ownKey(m);
      if (!k) continue;
      const g = m.videoId + '\u0002' + k;
      if (!realByKey.has(g)) realByKey.set(g, []);
      realByKey.get(g).push(m.timestampAbs || 0);
    }
    const why = { noTwin: 0, twinFar: 0, twinUsed: 0, noKey: 0 };
    for (const m of tempRecs) {
      if (pairedTemp.has(m.id)) continue;
      const k = C.ownKey(m);
      if (!k || m.videoId == null) { why.noKey++; continue; }
      const ts = realByKey.get(m.videoId + '\u0002' + k);
      if (!ts) { why.noTwin++; continue; }
      const d = Math.min(...ts.map((x) => Math.abs(x - (m.timestampAbs || 0))));
      if (d > TEMP_PAIR_MS) why.twinFar++; else why.twinUsed++;
    }
    out.tempUnpaired = why;
    if (dryRun) return out;
    for (const [videoId, ps] of byVid) {
      await withLock(videoId, async () => {
        const t = db.transaction('messages', 'readwrite');
        const s = t.objectStore('messages');
        for (const p of ps) {
          const real = await req(s.get(p.real.id)), temp = await req(s.get(p.temp.id));
          if (!real || !temp || C.ownKey(real) !== C.ownKey(temp)) continue;
          s.delete(temp.id);
          s.put(foldTwin(real, temp));
          out.merged++;
        }
        await done(t);
      });
      await recountStream(videoId);
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

  // v52（T6.3，審查十一 33.1 第 5 點）把訊息從 from 場次搬到 to 場次（fixRaidLeak）：videoId 改為 to、phase 依 to 的開播／結束時間重算
  //（to 已結束或降落暫定結束 → 結束後 post），推算的 offset 依 to 的開播時間重算；to 已有同 id → 依 F-14 合併。兩場的筆數重算
  async function moveMessages(fromVid, toVid, ids) {
    const db = await open();
    let moved = 0;
    const merged = 0;
    await withLock(fromVid, () => withLock(toVid, async () => {
      const t = db.transaction(['messages', 'streams'], 'readwrite');
      const ms = t.objectStore('messages');
      const work = (async () => {
        const to = await req(t.objectStore('streams').get(toVid));
        if (!to) throw new Error('stream not found');
        const st0 = C.effectiveStart(to);
        for (const id of ids) {
          const cur = await req(ms.get(id));
          if (!cur || cur.videoId !== fromVid) continue;
          const v = clone(cur);
          v.videoId = toVid;
          const ts = num(v.timestampAbs);
          if (st0 != null && ts !== null) {
            v.phase = ts < st0 ? 'pre' : (to.endedAt != null && ts > to.endedAt ? 'post' : 'live');
            if (v.offsetSource !== 'replay') { v.videoOffsetSec = Math.round((ts - st0) / 100) / 10; v.offsets = { v1: v.videoOffsetSec }; v.offsetSource = 'estimated'; }
          } else { v.videoOffsetSec = null; v.offsets = {}; }
          v.fp = makeFp(v);
          // messages 的 keyPath 是 id（全域唯一）：同一筆紀錄改掉 videoId 即可
          ms.put(v); moved++;
        }
      })();
      work.catch(() => { try { t.abort(); } catch (_) { /* */ } });
      await Promise.all([work, done(t)]);
    }));
    await recountStream(fromVid);
    await recountStream(toVid);
    return { moved, merged };
  }

  // v53（T6.3.1，審查十一 34.2.2）從某一場刪除指定 id 的訊息（只刪 videoId 相符的；fixRaidLeak 用：原場次已經有的重複）
  async function deleteMessagesIn(videoId, ids) {
    const db = await open();
    let deleted = 0;
    await withLock(videoId, async () => {
      const t = db.transaction('messages', 'readwrite');
      const ms = t.objectStore('messages');
      const work = (async () => {
        for (const id of ids) {
          const cur = await req(ms.get(id));
          if (!cur || cur.videoId !== videoId) continue;
          ms.delete(id); deleted++;
          forgetTwin(videoId, id);
        }
      })();
      await Promise.all([work, done(t)]);
    });
    await recountStream(videoId);
    return { deleted };
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
      ? o.parts.map((p) => (p && p.type === 'emoji' ? { emoji: { src: p.src || '', alt: p.alt || '', shortcut: '' } }
        // v44（17.1）舊版若有連結資料（type 'link'、url／href）一併轉入；網址在 normalizeIncoming 檢查
        : p && p.type === 'link' && (p.url || p.href) ? { text: p.text || p.url || p.href, link: { url: String(p.url || p.href) } }
          : { text: (p && p.text) || '' }))
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
    saveMessages, savePinned, unpinPinned, markDeleted,
    captureStart, captureEnd, closeStaleSessions, listCaptureSessions,
    recomputePhases, recomputeAllPhases, systemTagStats, recomputeStream, recountStream, cleanupJunkSystem, fieldStats, pickStreamTimes,
    diagAppend, diagAll, diagCount, diagClear,
    getStream, listStreams, queryMessages, queryMessagesFromOffset, countMessages, fillAvatars, fixGiftAuthors, fixOwnDuplicates, fixFutureTimes, moveMessages, deleteMessagesIn, updateStream, revokeRaidEnd, queryPinned, countAll, storageSummary, dedupePinnedStore, avatarHostStats,
    resetStream, deleteStreams, reclassifySystem,
    setVersionLabel, linkVideo, unlinkVideo,
    getChannel, getChannels, putChannel, putChannelIfNewer, channelStats,
    exportData, importData, parseImport, migrateLegacy,
    // 純函式（測試用）
    util: { hash, normText, makeFp, fallbackId, normalizeIncoming, mergeMessage, resolveVersion, mergeIntervals, coverage,
      convertLegacyMessage, convertLegacyChannel, isEmpty, foldTwin, ownPairs, isTempId, _resetTwins: () => twinCaches.clear() },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
