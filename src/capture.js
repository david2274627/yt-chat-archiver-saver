// 擷取引擎（SPEC F-01、F-02、F-14、F-15、F-19、3.2）：嵌入式 chat frame 與彈出式聊天室共用。
// 不依賴 chrome.*：送出函式由呼叫端提供（content.js 包 chrome.runtime.sendMessage；測試頁用假函式）。
// 選擇器一律取自 selectors.js；未在 docs/youtube-dom-notes.md 確認的結構在 selectors.js 標「待實機確認」。
// 輸出到 console 的內容只有標籤名稱與筆數，不含任何訊息文字。
(function (root) {
  'use strict';
  const C = root.YTCAS_CONST;
  const S = root.YTCAS_SEL;
  const T = C.MSG_TYPE;
  const RT = C.RT;
  const SAVED = 'ytcasSaved'; // dataset 鍵：data-ytcas-saved="1"（已擷取）／"skip"（不擷取，可修剪）

  // ---------------------------------------------------------------- 工具
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
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const httpsOnly = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : '');

  // 直播 #timestamp（當地時間，只到分鐘；例「下午10:23」「10:23 PM」「22:23」）→ ms。
  // 擷取時間夾在該分鐘範圍內（SPEC F-02 v29）；比擷取時間晚超過 12 小時視為前一天；解析失敗回傳 null。
  const CLOCK_RE = /(上午|下午|午前|午後|AM|PM|a\.m\.|p\.m\.)?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?\s*(上午|下午|AM|PM|a\.m\.|p\.m\.)?/i;
  function parseClock(text, now) {
    const m = CLOCK_RE.exec(String(text || ''));
    if (!m) return null;
    let h = Number(m[2]);
    const min = Number(m[3]);
    const sec = m[4] != null ? Number(m[4]) : null;
    if (h > 23 || min > 59 || (sec != null && sec > 59)) return null;
    const ap = (m[1] || m[5] || '').toLowerCase();
    const pm = ap === '下午' || ap === '午後' || ap === 'pm' || ap === 'p.m.';
    const am = ap === '上午' || ap === '午前' || ap === 'am' || ap === 'a.m.';
    if ((pm || am) && h > 12) return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, sec == null ? 0 : sec, 0);
    let base = d.getTime();
    if (base - now > 12 * 3600 * 1000) base -= 24 * 3600 * 1000;
    const span = sec == null ? 59999 : 999;
    return Math.min(Math.max(now, base), base + span);
  }

  // 重播 #timestamp（影片時間，如 1:23、1:02:03、-0:05）→ 秒；解析失敗回傳 null
  function parseOffset(text) {
    const m = /^\s*(-)?(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''));
    if (!m) return null;
    const s = (Number(m[2] || 0) * 3600) + Number(m[3]) * 60 + Number(m[4]);
    return m[1] ? -s : s;
  }

  // 訊息內容 → runs（文字與表符）。相鄰文字合併。
  function runsOf(el) {
    const out = [];
    if (!el) return out;
    const push = (t) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && last.text != null) last.text += t; else out.push({ text: t });
    };
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) push(n.nodeValue);
        else if (n.nodeType === 1) {
          if (n.tagName === 'IMG') {
            out.push({ emoji: { src: httpsOnly(n.getAttribute('src') || n.src), alt: n.getAttribute('alt') || '',
              shortcut: n.getAttribute(S.chat.emojiShortcutAttr) || '' } });
          } else walk(n);
        }
      }
    };
    walk(el);
    return out;
  }
  const textRuns = (s) => (s ? [{ text: s }] : []);

  // 作者名稱：只取 #author-name 自己的文字（不含 #chip-badges 等子元素）
  function authorNameOf(el) {
    const n = el.querySelector(S.chat.author.name);
    if (!n) return '';
    let s = '';
    for (const c of n.childNodes) if (c.nodeType === 3) s += c.nodeValue;
    return clean(s) || clean(n.textContent);
  }

  const BADGES = new Set(['owner', 'moderator', 'member', 'verified']);
  function badgesOf(el) {
    const out = [];
    const t = (el.getAttribute(S.chat.authorTypeAttr) || '').toLowerCase();
    if (BADGES.has(t)) out.push(t);
    el.querySelectorAll(S.chat.author.badges).forEach((b) => {
      const v = (b.getAttribute(S.chat.badgeTypeAttr) || '').toLowerCase();
      if (BADGES.has(v) && !out.includes(v)) out.push(v);
    });
    return out;
  }

  function cssVar(el, names) {
    try {
      const cs = getComputedStyle(el);
      for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) return v; }
    } catch (_) { /* 測試環境 */ }
    return '';
  }

  // 刪除狀態（待實機確認：屬性名稱與 #deleted-state 內容）
  function isDeletedEl(el) {
    const D = S.chat.deleted;
    if (D.attr && el.hasAttribute(D.attr)) return true;
    const st = el.querySelector(D.stateEl);
    return !!(st && clean(st.textContent));
  }

  // ---------------------------------------------------------------- 解析單一訊息元件
  // ctx: { source, now, startedAt, endedAt, scheduledStartAt }
  // 回傳 null 表示不擷取（佔位元素、跑馬燈項目等）
  const SKIP_TAGS = new Set([S.chat.placeholderItem, S.chat.tickerSponsorItem]);
  const KNOWN_SYSTEM_TAGS = new Set([S.chat.viewerEngagement]);
  const unknownLogged = new Set();

  function parseMessage(el, ctx) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    let type = S.messageTypeByTag[tag] || T.SYSTEM;
    if (type === T.SYSTEM && !KNOWN_SYSTEM_TAGS.has(tag) && !unknownLogged.has(tag)) {
      unknownLogged.add(tag);
      console.info('[ytcas] 未知訊息元件', tag);
    }
    const name = authorNameOf(el);
    const handle = name.startsWith('@') ? name : '';
    const photo = el.querySelector(S.chat.author.photo);
    const m = {
      id: el.id || '',
      type,
      authorHandle: handle,
      authorChannelId: '',
      authorUrl: handle ? 'https://www.youtube.com/' + handle : '',
      authorAvatar: photo ? httpsOnly(photo.getAttribute('src') || photo.src) : '',
      authorBadges: badgesOf(el),
      runs: [],
    };
    if (name && !handle) m.authorName = name;
    const msgEl = el.querySelector(S.chat.message);

    if (tag === S.chat.membershipItem) {
      const P = S.chat.membership;
      const head = [clean((el.querySelector(P.primaryText) || {}).textContent), clean((el.querySelector(P.subtext) || {}).textContent)].filter(Boolean).join(' ');
      m.runs = textRuns(head);
      const body = runsOf(msgEl);
      if (body.length && m.runs.length) m.runs.push({ text: '\n' });
      m.runs.push(...body);
    } else if (type === T.SUPERCHAT || type === T.SUPERSTICKER) {
      m.amount = clean((el.querySelector(S.chat.purchaseAmount) || {}).textContent);
      m.color = cssVar(el, type === T.SUPERCHAT ? S.chat.paidMessageColorVars : S.chat.paidStickerColorVars);
      m.runs = runsOf(msgEl);
      if (type === T.SUPERSTICKER) {
        const st = el.querySelector(S.chat.stickerImg);
        m.stickerSrc = st ? httpsOnly(st.getAttribute('src') || st.src) : '';
      }
    } else if (tag === S.chat.giftMessage) {
      // F-13 禮物（T3.6）：內部結構未確認 → 通用解析（作者、頭像已在上方取得；文字 runs；第一張非頭像圖片作為禮物圖片）。
      // 結構確認後改為專用解析（送禮者、禮物名稱、數量）；在那之前保存 rawTag 供日後重新解析判斷
      m.runs = msgEl ? runsOf(msgEl) : textRuns(clean(el.textContent).slice(0, 300));
      const imgs = Array.from(el.querySelectorAll('img')).filter((i) => i !== photo);
      const gi = imgs.map((i) => httpsOnly(i.getAttribute('src') || i.src)).find(Boolean);
      if (gi) m.giftImage = gi;
      m.rawTag = tag;
    } else if (type === T.SYSTEM || tag === S.chat.giftRedemption || tag === S.chat.giftAnnouncement) {
      // 結構未確認的元件：保存 #message，沒有時保存可見文字（上限 300 字）供日後重新分類
      m.runs = msgEl ? runsOf(msgEl) : textRuns(clean(el.textContent).slice(0, 300));
      if (type === T.SYSTEM) m.rawTag = tag;
    } else {
      m.runs = runsOf(msgEl);
    }

    // 時間（F-02）：直播讀當地時間、重播讀影片時間
    const tsText = clean((el.querySelector(S.chat.timestamp) || {}).textContent);
    if (ctx.source === 'replay') {
      const off = parseOffset(tsText);
      m.videoOffsetSec = off;
      m.timestampAbs = ctx.startedAt != null && off != null ? ctx.startedAt + off * 1000 : ctx.now;
      m.phase = 'live';
    } else {
      const ts = parseClock(tsText, ctx.now);
      m.timestampAbs = ts == null ? ctx.now : ts;
      if (ctx.startedAt != null) {
        m.videoOffsetSec = Math.round((m.timestampAbs - ctx.startedAt) / 100) / 10;
        m.phase = m.timestampAbs < ctx.startedAt ? 'pre' : (ctx.endedAt != null && m.timestampAbs > ctx.endedAt ? 'post' : 'live');
      } else {
        m.videoOffsetSec = null; // 開播時間未定：先存 null，開播後由 background 回填（F-14）
        // T3.6：預定時間未到，或預定時間已過但尚未確認開播（startPending）→ pre、offset 留空（開播時間確認後 background 重算）
        m.phase = ctx.startPending || (ctx.scheduledStartAt != null && ctx.now < ctx.scheduledStartAt) ? 'pre' : 'live';
      }
    }
    if (isDeletedEl(el)) { m.deleted = true; m.deletedAt = ctx.now; }
    // T3.5：歡迎／守則提示每次重新整理 id 都不同 → 同一場次以內容產生固定 id（只存一筆）
    if (tag === S.chat.viewerEngagement && ctx.videoId) m.id = C.viewerEngagementId(ctx.videoId, m.runs);
    return m;
  }

  // 降落橫幅（取不到 id）：同一場同一段文字視為同一則，id 以內容雜湊產生（SPEC 4.3 補救 id）
  function parseRaid(el, ctx, videoId) {
    const runs = textRuns(clean(el.textContent).slice(0, 300));
    if (!runs.length) return null;
    return { id: 'ytcas-raid-' + hash(videoId + '\u0001' + runs[0].text), type: T.RAID, authorHandle: '', authorChannelId: '',
      authorUrl: '', authorAvatar: '', authorBadges: [], runs, timestampAbs: ctx.now,
      videoOffsetSec: ctx.startedAt != null ? Math.round((ctx.now - ctx.startedAt) / 100) / 10 : null,
      phase: ctx.source === 'replay' ? 'live' : (ctx.startedAt != null && ctx.endedAt != null && ctx.now > ctx.endedAt ? 'post' : 'live') };
  }

  // ---------------------------------------------------------------- F-20 結構探針（P7，同 docs/poc-clip-path.md 附錄 C／E）
  // 只輸出後代的標籤、id、屬性名稱（不含值）、img 網域、尺寸、「有沒有文字」；不輸出任何文字
  function structureOf(root, max) {
    max = max || 80;
    const out = [];
    const host = (u) => { try { return new URL(u, location.href).hostname; } catch (_) { return '(invalid)'; } };
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (out.length >= max) return;
        let size = '';
        try { const r = c.getBoundingClientRect(); size = Math.round(r.width) + 'x' + Math.round(r.height); } catch (_) { /* ignore */ }
        out.push({ d: depth, tag: c.tagName.toLowerCase() + (c.id ? '#' + c.id : ''),
          attrs: c.getAttributeNames().filter((a) => a !== 'id' && a !== 'class' && a !== 'style' && !a.startsWith('data-ytcas')),
          img: c.tagName === 'IMG' ? host(c.getAttribute('src') || '') : undefined, size,
          hasText: Array.from(c.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim()) });
        if (depth < 8) walk(c, depth + 1);
      }
    };
    walk(root, 1);
    return { tag: root.tagName.toLowerCase(), hasId: !!root.id, attrs: root.getAttributeNames().filter((a) => a !== 'id' && !a.startsWith('data-ytcas')), tree: out };
  }

  // ---------------------------------------------------------------- 引擎
  // opts: { doc, source: 'live'|'replay'|'popout', send(msg) → Promise<response>, isConnected() → bool,
  //         now?() → ms, onStatus?(status), log?: boolean }
  let liveObservers = 0;

  function createEngine(opts) {
    const doc = opts.doc || document;
    const now = opts.now || Date.now;
    const source = opts.source;
    const isConnected = opts.isConnected || (() => true);
    const st = {
      videoId: null, info: null, stream: {}, session: null,
      mode: 'pending', // pending（等場次資訊）／capturing／paused／disconnected／no-video-id／stopped
      items: null, banner: null,
      queue: [], unflushed: new Set(), sending: null, batchTimer: 0, trimTimer: 0, pollTimer: 0, statsTimer: 0,
      pinnedSent: new Set(), deletedReported: new Set(), pendingDeleted: [], waiters: [],
      stats: { captured: 0, added: 0, merged: 0, unchanged: 0, fpMerged: 0, dropped: 0, rejected: 0, trimmed: 0, deleted: 0, deletedMissing: 0, pinned: 0,
        observedAdded: 0, backfillRuns: 0, backfillCaptured: 0, lateCaptured: 0, dupCaptured: 0 },
      seenIds: new Set(),
      observers: [], startSeq: 0, lastStatus: '', durationWait: 0,
      createdAt: Date.now(),
      p7: new Map(), // F-20 P7：reason:tag → 次數
      f12: null, viewMode: null, // F-12 結果：null（未執行）／running／switched／already／failed:<原因>
    };

    // F-20：診斷探針回呼（content.js 只在記錄中轉送；這裡只組筆數、標籤、屬性名稱）
    const diag = (probe, kind, data) => { if (opts.onDiag) try { opts.onDiag(probe, kind, data); } catch (_) { /* ignore */ } };
    function probeStructure(reason, el) {
      if (!opts.onDiag || !el) return;
      const tag = el.tagName.toLowerCase();
      const k = reason + ':' + tag;
      const n = st.p7.get(k) || 0;
      if (n >= C.DIAG.P7_MAX_PER_TAG) return;
      st.p7.set(k, n + 1);
      diag('P7', 'structure', Object.assign({ reason }, structureOf(el)));
    }
    // P2：#items 節點分類（標籤 × 已存／略過／未存）
    function itemsBreakdown() {
      const box = st.items;
      if (!box) return { total: null };
      const byTag = {};
      for (const el of box.children) {
        const t = el.tagName.toLowerCase();
        const b = byTag[t] || (byTag[t] = { saved: 0, skip: 0, unsaved: 0 });
        const v = el.dataset[SAVED];
        if (v === '1') b.saved++; else if (v === 'skip') b.skip++; else b.unsaved++;
      }
      return { total: box.children.length, byTag };
    }

    const setStatus = (mode, extra) => {
      st.mode = mode;
      const s = Object.assign({ videoId: st.videoId, capturing: mode === 'capturing', reason: mode === 'capturing' ? null : mode }, extra || {});
      const key = JSON.stringify(s);
      if (key === st.lastStatus) return;
      st.lastStatus = key;
      if (opts.onStatus) try { opts.onStatus(s); } catch (_) { /* ignore */ }
    };

    const ctxNow = () => ({ source, videoId: st.videoId, now: now(), startedAt: st.stream.startedAt ?? null, endedAt: st.stream.endedAt ?? null,
      scheduledStartAt: st.stream.scheduledStartAt ?? null, startPending: !!st.stream.startPending });

    // ------------------------------------------------ 送出（3.2：重試 0.5／1／2 秒；失敗留待下一批）
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function sendWithRetry(msg) {
      const delays = [500, 1000, 2000];
      for (let i = 0; ; i++) {
        if (!isConnected()) throw Object.assign(new Error('disconnected'), { disconnected: true });
        try {
          const r = await opts.send(msg);
          if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
          throw new Error('no response');
        } catch (e) {
          if (e && e.disconnected) throw e;
          if (i >= delays.length) throw e;
          await sleep(delays[i]);
        }
      }
    }

    function disconnect() {
      if (st.mode === 'disconnected') return;
      st.queue.length = 0;
      st.unflushed.clear();
      clearTimeout(st.batchTimer);
      setStatus('disconnected');
      console.info('[ytcas] 擴充功能已重新載入，本頁停止收錄（DOM 修剪照常）；重新整理頁面即可恢復');
    }

    function enqueue(m) {
      st.queue.push(m);
      if (m.id) st.unflushed.add(m.id);
      if (st.queue.length > 2000) { // 3.2：上限 2000，丟棄最舊的
        const drop = st.queue.splice(0, st.queue.length - 2000);
        st.stats.dropped += drop.length;
        for (const d of drop) if (d.id) st.unflushed.delete(d.id);
      }
      if (st.queue.length >= C.BATCH_MAX) flush();
      else if (!st.batchTimer) st.batchTimer = setTimeout(() => { st.batchTimer = 0; flush(); }, C.BATCH_INTERVAL_MS);
    }

    // 單一送出流程：一次最多 200 則（含先前失敗留下的），直到佇列清空
    function flush() {
      clearTimeout(st.batchTimer); st.batchTimer = 0;
      if (st.sending) { st.sending.again = true; return st.sending.p; }
      if (!st.queue.length || st.mode !== 'capturing') return Promise.resolve();
      const job = { again: false };
      job.p = (async () => {
        while (st.queue.length && st.mode === 'capturing') {
          const batch = st.queue.splice(0, 200);
          let r;
          try {
            r = await sendWithRetry({ type: RT.SAVE_MESSAGES, videoId: st.videoId, stream: streamMeta(), messages: batch,
              captureSessionId: st.session && st.session.captureSessionId, source });
          } catch (e) {
            if (e && e.disconnected) { disconnect(); return; }
            st.queue.unshift(...batch); // 留待下一批一起送
            if (st.queue.length > 2000) { const d = st.queue.splice(0, st.queue.length - 2000); st.stats.dropped += d.length; for (const x of d) if (x.id) st.unflushed.delete(x.id); }
            if (!st.batchTimer) st.batchTimer = setTimeout(() => { st.batchTimer = 0; flush(); }, C.BATCH_INTERVAL_MS);
            return;
          }
          if (!r.ok) {
            if (r.error === 'paused') { pauseCapture(r.reason || 'paused'); return; }
            st.stats.rejected += batch.length; // ok:false 不重試（3.2）
          } else {
            for (const k of ['added', 'merged', 'unchanged', 'fpMerged']) st.stats[k] += r[k] || 0;
            // T3.6：background 重新抓取 meta 確認的開播／結束時間 → 之後的訊息以此計算 phase 與 offset
            const ch = adoptTimes(r.stream);
            if (ch.start) console.info('[ytcas] 採用 background 確認的開播時間', { videoId: st.videoId, source: st.stream.startedAtSource });
            if (ch.end) {
              console.info('[ytcas] 採用 background 確認的結束時間，之後的訊息標為結束後（post）', { videoId: st.videoId });
              probeStructure('stream-end', doc.querySelector(S.chat.renderer)); // F-20 P7：直播結束時的聊天室結構
            }
          }
          for (const m of batch) if (m.id) st.unflushed.delete(m.id);
          resolveWaiters();
          if (r.ok) await retryPendingDeleted();
        }
      })().finally(() => {
        st.sending = null;
        if (job.again && st.queue.length) flush();
      });
      st.sending = job;
      return job.p;
    }

    // 等某個 id 寫入完成（刪除通知先後順序，3.2 v29）
    function whenWritten(id) {
      if (!st.unflushed.has(id)) return Promise.resolve();
      return new Promise((res) => { st.waiters.push({ id, res }); flush(); });
    }
    function resolveWaiters() {
      st.waiters = st.waiters.filter((w) => { if (!st.unflushed.has(w.id)) { w.res(); return false; } return true; });
    }

    // ------------------------------------------------ 刪除（F-14）
    async function reportDeleted(id, deletedAt) {
      if (!id || st.deletedReported.has(id) || st.mode !== 'capturing') return;
      st.deletedReported.add(id);
      await whenWritten(id);
      try {
        const r = await sendWithRetry({ type: RT.MESSAGE_DELETED, videoId: st.videoId, id, deletedAt });
        if (r.ok && r.found) st.stats.deleted++;
        else if (r.ok) st.pendingDeleted.push({ id, deletedAt });
      } catch (e) { if (e && e.disconnected) disconnect(); }
    }
    async function retryPendingDeleted() {
      if (!st.pendingDeleted.length) return;
      const list = st.pendingDeleted.splice(0);
      for (const d of list) {
        try {
          const r = await sendWithRetry({ type: RT.MESSAGE_DELETED, videoId: st.videoId, id: d.id, deletedAt: d.deletedAt });
          if (r.ok && r.found) st.stats.deleted++; else st.stats.deletedMissing++; // 只重送一次
        } catch (e) { if (e && e.disconnected) { disconnect(); return; } }
      }
    }
    function checkDeleted(el) {
      if (el.dataset[SAVED] !== '1' || !el.id || st.deletedReported.has(el.id)) return;
      if (isDeletedEl(el)) reportDeleted(el.id, now());
    }

    // ------------------------------------------------ 擷取
    // how：observer／backfill／sweep（定時補掃）／trim（修剪前補擷取）／pending（等待期超過上限）
    // force：等待場次資訊期間（pending）也解析並排入佇列（收錄開始後才送出）
    function captureNode(el, how, force) {
      if (el.nodeType !== 1 || el.dataset[SAVED]) return;
      if (!st.items || el.parentElement !== st.items) return; // T3.4 防呆：只擷取 #items 的直接子節點
      if (st.mode !== 'capturing' && !(force && st.mode === 'pending')) return;
      let m = null;
      try { m = parseMessage(el, ctxNow()); } catch (e) { console.info('[ytcas] 訊息解析失敗', el.tagName.toLowerCase(), String(e && e.message)); }
      if (!m) { el.dataset[SAVED] = 'skip'; return; }
      el.dataset[SAVED] = '1';
      // F-20 P7：未知元件、禮物元件 → 結構紀錄（同一標籤每場最多 3 次）
      if (opts.onDiag && ((m.type === T.SYSTEM && m.rawTag && !KNOWN_SYSTEM_TAGS.has(m.rawTag)) || m.type === T.GIFT)) {
        probeStructure(m.type === T.GIFT ? 'gift' : 'unknown', el);
      }
      if (m.deleted && m.id) st.deletedReported.add(m.id);
      st.stats.captured++;
      if (how && how !== 'observer') st.stats[how === 'backfill' ? 'backfillCaptured' : 'lateCaptured']++;
      // 同一頁已擷取過的 id 再次出現（YouTube 重新插入節點）：只計數供診斷，去重由 background 負責
      if (m.id) {
        if (st.seenIds.has(m.id)) st.stats.dupCaptured++;
        else { if (st.seenIds.size > 20000) st.seenIds.clear(); st.seenIds.add(m.id); }
      }
      enqueue(m);
    }

    function capturePinned() {
      if (st.mode !== 'capturing' || !st.banner) return;
      st.banner.querySelectorAll(S.chat.bannerPinnedMessage).forEach((el) => {
        if (!el.id || st.pinnedSent.has(el.id)) return;
        let m;
        try { m = parseMessage(el, ctxNow()); } catch (_) { return; }
        if (!m) return;
        st.pinnedSent.add(el.id);
        m.pinnedAt = now();
        st.stats.pinned++;
        sendWithRetry({ type: RT.SAVE_PINNED, videoId: st.videoId, message: m, source })
          .catch((e) => { if (e && e.disconnected) disconnect(); else st.pinnedSent.delete(el.id); });
      });
      st.banner.querySelectorAll(S.chat.bannerRedirect).forEach((el) => {
        if (el.dataset[SAVED]) return;
        probeStructure('raid', el); // F-20 P7：降落橫幅結構（待實機確認的元件）
        const m = parseRaid(el, ctxNow(), st.videoId);
        el.dataset[SAVED] = m ? '1' : 'skip';
        if (m) { st.stats.captured++; enqueue(m); }
      });
    }

    // ------------------------------------------------ 修剪（F-01：數量觸發為主、計時器保底）
    // T3.3（審查十追加）：一律從最舊的節點移除，不得跳過未擷取的舊節點去移除較新的節點
    //（v29 的「只移除已標記節點」會在列表開頭有一批未標記節點時卡住：新訊息一標記就被移除、舊節點永遠留著）。
    //   收錄中：最舊節點未擷取 → 先擷取（標記）再移除；解析失敗標 skip 後移除。
    //   暫停、無 videoId、失去連線、已停止：不擷取，直接移除最舊的。
    //   等待場次資訊（pending）：保留未擷取節點以便回溯擷取，但超過 PENDING_MAX 時先解析排入佇列再移除最舊的。
    const PENDING_MAX = 200;
    function trim() {
      const box = st.items;
      if (!box) return;
      const freeAll = st.mode === 'paused' || st.mode === 'disconnected' || st.mode === 'no-video-id' || st.mode === 'stopped';
      const pending = st.mode === 'pending';
      const limit = pending ? PENDING_MAX : C.DOM_MAX_MESSAGES;
      let over = box.children.length - limit;
      while (over > 0) {
        const el = box.firstElementChild;
        if (!el) break;
        if (!el.dataset[SAVED] && !freeAll) {
          captureNode(el, pending ? 'pending' : 'trim', pending);
          if (!el.dataset[SAVED]) break; // 仍無法擷取（理論上不會發生）：寧可不修剪也不遺失
        }
        if (st.mode === 'capturing') checkDeleted(el);
        el.remove();
        over--;
        st.stats.trimmed++;
      }
    }

    function onItemsMutation(records) {
      for (const r of records) {
        // T3.4：observer 為了刪除偵測帶 subtree，childList 也會回報訊息內部的後代（徽章、圖示、span…）；
        // 只有 #items 的直接子節點才是訊息
        if (r.type === 'childList') {
          if (r.target !== st.items) continue;
          st.stats.observedAdded += r.addedNodes.length;
          r.addedNodes.forEach((n) => captureNode(n, 'observer'));
        }
        else if (r.type === 'attributes' && st.mode === 'capturing') {
          const el = r.target.closest && r.target.closest('[data-ytcas-saved="1"]');
          if (el && st.items && el.parentElement === st.items) checkDeleted(el);
        }
      }
      trim();
    }

    function observe(target, fn, options) {
      const mo = new MutationObserver(fn);
      mo.observe(target, options);
      st.observers.push(mo);
      liveObservers++;
      return mo;
    }
    function disconnectObservers() {
      for (const mo of st.observers) { mo.disconnect(); liveObservers--; }
      st.observers.length = 0;
    }

    // 找 #items 與置頂列；YouTube 重建時重新掛上
    function attach() {
      const items = doc.querySelector(S.chat.items);
      const banner = doc.querySelector(S.chat.bannerContainer);
      if (items === st.items && banner === st.banner && (items || st.items === null)) return !!items;
      disconnectObservers();
      st.items = items;
      st.banner = banner;
      if (!items) return false;
      const del = S.chat.deleted.attr ? { attributes: true, subtree: true, attributeFilter: [S.chat.deleted.attr] } : {};
      observe(items, onItemsMutation, Object.assign({ childList: true }, del));
      if (banner) observe(banner, () => capturePinned(), { childList: true, subtree: true });
      // F-01 AC：切換影片後不得累加。每個聊天室最多 2 個（訊息列表＋置頂列）
      console.info('[ytcas] 擷取 observer 已掛上（本頁共 ' + liveObservers + ' 個；每個聊天室最多 2 個）', { source });
      return true;
    }

    // 回溯擷取（F-02 v28）：#items 內既有訊息全部擷取一次（重複由 id 去重）。
    // T3.3：先確認 st.items 就是目前的 #items（YouTube 可能整個換掉列表元素），不是就重新掛上。
    // how：backfill（開始收錄、重新掛上、F-12 切換後）／sweep（定時補掃：observer 漏掉的節點）
    function backfill(how) {
      if (st.items !== doc.querySelector(S.chat.items) || (st.items && !st.items.isConnected)) attach();
      if (!st.items) return;
      if ((how || 'backfill') === 'backfill') st.stats.backfillRuns++;
      Array.from(st.items.children).forEach((el) => captureNode(el, how || 'backfill'));
      capturePinned();
      trim();
      if ((how || 'backfill') === 'backfill') flush(); // 等待期排入佇列的訊息（pending）在收錄開始後立即送出
    }

    function streamMeta() {
      const i = st.info || {};
      const m = { isLive: source !== 'replay' };
      for (const k of ['title', 'channelName', 'channelHandle', 'channelUrl']) if (i[k]) m[k] = i[k];
      for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt']) if (st.stream[k] != null) m[k] = st.stream[k];
      if (st.stream.startPending) m.startPending = true;
      return m;
    }

    // 場次資訊 → 開播／結束時間與來源（T3.6：C.deriveStartTimes 與 background 共用；預定時間已過但未確認開播 = startPending）
    function deriveTimes(info) {
      return C.deriveStartTimes({ startDate: info.startDate, endDate: info.endDate, knownScheduled: st.stream.scheduledStartAt ?? null, now: now() });
    }

    // T3.6：依來源等級採用開播／結束時間（C.START_SOURCE_RANK）。來源：STREAM_INFO、CAPTURE_START／SAVE_MESSAGES 的回應、
    // 播放器訊號。等級較高者覆蓋較低者；預定時間（scheduled）不得寫入 startedAt。回傳是否有變動
    function adoptTimes(t) {
      if (!t) return { start: false, end: false };
      const out = { start: false, end: false };
      for (const [k, flag] of [['startedAt', 'start'], ['endedAt', 'end']]) {
        const v = typeof t[k] === 'number' ? t[k] : null;
        const src = t[k + 'Source'] || null;
        if (v == null || src === 'scheduled') continue;
        const cur = st.stream[k] == null ? -1 : C.startRank(st.stream[k + 'Source']);
        if (C.startRank(src) > cur && st.stream[k] !== v) { st.stream[k] = v; st.stream[k + 'Source'] = src; out[flag] = true; }
      }
      if (st.stream.scheduledStartAt == null && typeof t.scheduledStartAt === 'number') st.stream.scheduledStartAt = t.scheduledStartAt;
      st.stream.startPending = st.stream.startedAt == null && !!(t.startPending || st.stream.startPending);
      return out;
    }

    async function beginCapture() {
      const seq = ++st.startSeq;
      if (!isConnected()) { disconnect(); return; }
      let r;
      try {
        r = await sendWithRetry({ type: RT.CAPTURE_START, videoId: st.videoId, source,
          duration: st.info && typeof st.info.duration === 'number' ? st.info.duration : null, stream: streamMeta() });
      } catch (e) {
        if (e && e.disconnected) { disconnect(); return; }
        console.info('[ytcas] 無法開始收錄（background 無回應），5 秒後重試'); // 暫時性，會自動重試：info
        setTimeout(() => { if (seq === st.startSeq && st.mode === 'pending') beginCapture(); }, 5000);
        return;
      }
      if (seq !== st.startSeq) return; // 期間 videoId 已改變
      if (!r.ok) { console.warn('[ytcas] 無法開始收錄', r.error); setStatus('paused', { reason: 'error' }); return; }
      if (!r.allowed) { pauseCapture(r.reason || 'paused'); return; }
      st.session = { captureSessionId: r.captureSessionId, versionId: r.versionId };
      // background 已知的開播／結束時間（彈出視窗由 FETCH_STREAM_META 補齊）
      if (r.stream) adoptTimes(r.stream);
      setStatus('capturing');
      backfill('backfill');
      if (!st.f12) autoLiveMode(); // F-12（v30）：開始收錄時切到「即時聊天室」，同一頁只做一次
    }

    // ------------------------------------------------ F-12 自動切換「即時聊天室」
    // 只依位置與 aria-selected（第 1 項 = 重點、第 2 項 = 即時），不依文字。先直接點；沒切成再「展開選單 → 點」；
    // 仍失敗就 warnOnce 放棄，不重試。選單可能比 #items 晚出現：最多等 F12_MENU_WAIT_MS。
    const F12_STEP_MS = 300;
    const F12_MENU_WAIT_MS = 5000;
    const viewItems = () => Array.from(doc.querySelectorAll(S.chat.viewSelector.items));
    const sel = (a) => !!a && a.getAttribute('aria-selected') === 'true';
    function viewMode() {
      const it = viewItems();
      if (it.length < 2) return 'unknown';
      return sel(it[1]) ? 'live' : (sel(it[0]) ? 'top' : 'unknown');
    }
    async function autoLiveMode() {
      st.f12 = 'running';
      const done = (r) => {
        st.f12 = r;
        st.viewMode = viewMode();
        // 聊天室已載入卻切不過去會影響存檔完整：warn；沒有選單（例如部分重播頁）屬可接受：info
        if (r.startsWith('failed')) S.warnOnce('F-12:' + r, '無法自動切換到「即時聊天室」', r === 'failed:no-menu' ? 'info' : 'warn');
        if (opts.onF12) try { opts.onF12({ f12: r, viewMode: st.viewMode }); } catch (_) { /* ignore */ }
        // T3.3：切換後 YouTube 會重新渲染列表（可能整個換掉 #items）→ 稍後再回溯擷取一次
        if (r === 'switched') setTimeout(() => { if (st.mode === 'capturing') backfill('backfill'); }, 500);
      };
      const t0 = Date.now();
      while (viewItems().length < 2) {
        if (st.mode !== 'capturing') { st.f12 = null; return; }
        if (Date.now() - t0 > F12_MENU_WAIT_MS) return done('failed:no-menu');
        await sleep(250);
      }
      if (st.mode !== 'capturing') { st.f12 = null; return; } // 暫停中不切換
      let it = viewItems();
      if (sel(it[1])) return done('already');
      if (!sel(it[0])) return done('failed:unknown-state');
      it[1].click();
      await sleep(F12_STEP_MS);
      if (sel(viewItems()[1])) return done('switched');
      const trig = doc.querySelector(S.chat.viewSelector.trigger);
      if (!trig) return done('failed:no-trigger');
      trig.click();
      await sleep(F12_STEP_MS);
      it = viewItems();
      if (it[1]) it[1].click();
      await sleep(F12_STEP_MS);
      return done(sel(viewItems()[1]) ? 'switched' : 'failed:not-selected');
    }

    function pauseCapture(reason) {
      st.queue.length = 0;
      st.unflushed.clear();
      resolveWaiters();
      st.session = null;
      setStatus('paused', { reason: 'paused', policy: reason });
      trim();
    }

    function endSession() {
      const s = st.session;
      st.session = null;
      if (s && isConnected()) {
        try { const p = opts.send({ type: RT.CAPTURE_END, captureSessionId: s.captureSessionId, endedAt: now(), source }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
      }
    }

    function logStats(final) {
      const s = st.stats;
      if (!s.captured && !final && !opts.onDiag) return; // 沒有收錄時不輸出 Console；診斷記錄中仍記錄（暫停、等待等狀態也要看得到）
      // 只記筆數（id 一致性驗證：重播時 idMerged ≫ fpMerged 代表直播與重播的訊息 id 相同）
      // T3.3 診斷：itemsIsCurrent（st.items 是否為目前的 #items 且仍在頁面上）、unmarkedNodes（#items 內未擷取數）、
      // observedAdded（這一分鐘 observer 看到的新增節點）、backfillRuns、backfillCaptured（回溯擷取到的）、
      // lateCaptured（定時補掃或修剪前才擷取到的 = observer 漏掉的）、dupCaptured（同頁同 id 再次出現 = YouTube 重新插入）
      const box = st.items;
      const cur = doc.querySelector(S.chat.items);
      const obj = { videoId: st.videoId, source, mode: st.mode, captured: s.captured,
        added: s.added, idMerged: s.merged + s.unchanged - s.fpMerged, fpMerged: s.fpMerged, dropped: s.dropped, rejected: s.rejected,
        trimmed: s.trimmed, pinned: s.pinned, deleted: s.deleted, deletedMissing: s.deletedMissing,
        domNodes: box ? box.children.length : null,
        itemsIsCurrent: !!box && box === cur && box.isConnected,
        itemsCount: doc.querySelectorAll(S.chat.anyItems).length,
        unmarkedNodes: box ? Array.from(box.children).filter((el) => !el.dataset[SAVED]).length : null,
        observedAdded: s.observedAdded, backfillRuns: s.backfillRuns, backfillCaptured: s.backfillCaptured,
        lateCaptured: s.lateCaptured, dupCaptured: s.dupCaptured, f12: st.f12 };
      if (s.captured || final) console.info('[ytcas] 收錄統計' + (final ? '（結束）' : ''), obj);
      // F-20 P1／P2：同一份統計寫入診斷記錄（只有筆數）；時間來源一併記錄，供開播判斷驗證
      diag('P1', final ? 'stats-final' : 'stats', Object.assign({}, obj, { times: {
        startedAtSource: st.stream.startedAtSource || null, startPending: !!st.stream.startPending,
        hasStartedAt: st.stream.startedAt != null, hasEndedAt: st.stream.endedAt != null } }));
      diag('P2', 'items', itemsBreakdown());
      s.observedAdded = 0; // 每分鐘歸零
    }

    // ------------------------------------------------ 對外
    // 定時：重新確認列表元素（T3.3：v29 只在「原本沒有列表」時回溯，YouTube 換掉列表元素後新列表的既有節點永遠未擷取）、
    // 補掃 observer 漏掉的節點、保底修剪
    function tick() {
      const prev = st.items;
      const ok = attach();
      if (ok && st.items !== prev && st.mode === 'capturing') backfill('backfill');
      else if (ok && st.mode === 'capturing') backfill('sweep');
      // 聊天室已渲染（有 renderer）且超過 10 秒仍找不到訊息列表才是問題：warn；載入中不輸出
      if (!ok && st.mode !== 'stopped' && doc.querySelector(S.chat.renderer) && Date.now() - st.createdAt > 10000) {
        S.warnOnce('chat.items', S.chat.items, 'warn');
      }
      trim();
    }

    const api = {
      // 設定或更新場次資訊（STREAM_INFO 或網址參數）；videoId 改變時結束舊收錄、重新開始
      setInfo(info) {
        if (!info || st.mode === 'stopped') return;
        const vid = typeof info.videoId === 'string' && /^[\w-]{6,20}$/.test(info.videoId) ? info.videoId : null;
        const changed = vid && vid !== st.videoId;
        st.info = Object.assign({}, st.info || {}, info);
        if (changed) st.stream = {}; // 新影片：先清掉舊場次的時間，再依新資訊判斷
        const ch = adoptTimes(deriveTimes(st.info));
        // T3.6 E-3 第 2 點：播放器長度由無變有（top frame 偵測，頁面載入 60 秒後才送）→ 開播訊號（signal，誤差 ≤ 30 秒），
        // 只在等待開播確認時採用；之後由 background 重新抓取的實際時間（meta-actual）覆蓋
        if (typeof info.liveSignalAt === 'number' && source !== 'replay' && st.stream.startedAt == null
          && (st.stream.startPending || (st.stream.scheduledStartAt != null && st.stream.scheduledStartAt <= now()))) {
          if (adoptTimes({ startedAt: info.liveSignalAt, startedAtSource: 'signal' }).start) {
            console.info('[ytcas] 偵測到開播訊號（播放器），暫以偵測時間為開播時間，待 background 確認', { videoId: st.videoId });
          }
        }
        // T3.5 F-2：收錄中得知結束時間 → 之後的訊息標 post；送出時帶 endedAt，background 依 F-14 重算 phase
        if (!changed && ch.end) {
          console.info('[ytcas] 已得知直播結束時間，之後的訊息標為結束後（post）', { videoId: st.videoId });
          probeStructure('stream-end', doc.querySelector(S.chat.renderer));
        }
        if (changed) {
          if (st.videoId) { flush(); endSession(); logStats(true); }
          st.videoId = vid;
          st.pinnedSent.clear(); st.deletedReported.clear(); st.pendingDeleted.length = 0; st.seenIds.clear(); st.p7.clear();
          for (const k of Object.keys(st.stats)) st.stats[k] = 0;
          // 新影片：先前標記過的節點屬於舊影片，不再擷取（iframe 通常會重新載入，這裡只是保險）
          setStatus('pending');
          clearTimeout(st.durationWait); st.durationWait = 0;
          // F-18：重播需要影片長度判斷版本；top frame 的 video 可能稍晚才有長度，最多等 3 秒（取不到視為 v1）
          if (source === 'replay' && typeof st.info.duration !== 'number') {
            st.durationWait = setTimeout(() => { st.durationWait = 0; beginCapture(); }, 3000);
          } else beginCapture();
        } else if (st.durationWait && typeof st.info.duration === 'number') {
          clearTimeout(st.durationWait); st.durationWait = 0;
          beginCapture();
        }
      },
      noVideoId() { if (!st.videoId) { setStatus('no-video-id'); trim(); } },
      // 暫停設定變更後重新判斷（content.js 監聽 storage.onChanged）
      recheckPolicy() {
        if (st.videoId && (st.mode === 'paused')) { setStatus('pending'); beginCapture(); }
      },
      start() {
        tick();
        st.trimTimer = setInterval(tick, C.DOM_TRIM_INTERVAL_MS);
        st.statsTimer = setInterval(() => logStats(false), 60000);
      },
      stop() {
        if (st.mode === 'stopped') return;
        flush();
        endSession();
        logStats(true);
        clearInterval(st.trimTimer); clearInterval(st.statsTimer); clearTimeout(st.batchTimer);
        disconnectObservers();
        setStatus('stopped');
      },
      flush,
      state: () => ({ mode: st.mode, videoId: st.videoId, queue: st.queue.length, session: st.session, stream: Object.assign({}, st.stream),
        stats: Object.assign({}, st.stats), observers: liveObservers, f12: st.f12, viewMode: st.viewMode || viewMode() }),
      _trim: trim,
      _logStats: (final) => logStats(final),
      _tick: tick,
    };
    return api;
  }

  root.YTCAS_CAPTURE = { createEngine, parseMessage, parseClock, parseOffset, runsOf, hash, structureOf, observers: () => liveObservers };
})(typeof globalThis !== 'undefined' ? globalThis : self);
