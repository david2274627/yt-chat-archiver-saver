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
        m.phase = ctx.scheduledStartAt != null && ctx.now < ctx.scheduledStartAt ? 'pre' : 'live';
      }
    }
    if (isDeletedEl(el)) { m.deleted = true; m.deletedAt = ctx.now; }
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
      stats: { captured: 0, added: 0, merged: 0, unchanged: 0, fpMerged: 0, dropped: 0, rejected: 0, trimmed: 0, deleted: 0, deletedMissing: 0, pinned: 0 },
      observers: [], startSeq: 0, lastStatus: '', durationWait: 0,
      f12: null, viewMode: null, // F-12 結果：null（未執行）／running／switched／already／failed:<原因>
    };

    const setStatus = (mode, extra) => {
      st.mode = mode;
      const s = Object.assign({ videoId: st.videoId, capturing: mode === 'capturing', reason: mode === 'capturing' ? null : mode }, extra || {});
      const key = JSON.stringify(s);
      if (key === st.lastStatus) return;
      st.lastStatus = key;
      if (opts.onStatus) try { opts.onStatus(s); } catch (_) { /* ignore */ }
    };

    const ctxNow = () => ({ source, now: now(), startedAt: st.stream.startedAt ?? null, endedAt: st.stream.endedAt ?? null,
      scheduledStartAt: st.stream.scheduledStartAt ?? null });

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
    function captureNode(el) {
      if (el.nodeType !== 1 || el.dataset[SAVED]) return;
      if (st.mode !== 'capturing') return;
      let m = null;
      try { m = parseMessage(el, ctxNow()); } catch (e) { console.warn('[ytcas] 訊息解析失敗', el.tagName.toLowerCase(), String(e && e.message)); }
      if (!m) { el.dataset[SAVED] = 'skip'; return; }
      el.dataset[SAVED] = '1';
      if (m.deleted && m.id) st.deletedReported.add(m.id);
      st.stats.captured++;
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
        const m = parseRaid(el, ctxNow(), st.videoId);
        el.dataset[SAVED] = m ? '1' : 'skip';
        if (m) { st.stats.captured++; enqueue(m); }
      });
    }

    // ------------------------------------------------ 修剪（F-01：數量觸發為主、計時器保底）
    // 收錄中與等待場次資訊時只移除已處理的節點；暫停、無 videoId、失去連線時不擷取，最舊的節點直接移除
    function trim() {
      const box = st.items;
      if (!box) return;
      const freeAll = st.mode === 'paused' || st.mode === 'disconnected' || st.mode === 'no-video-id' || st.mode === 'stopped';
      let over = box.children.length - C.DOM_MAX_MESSAGES;
      if (over <= 0) return;
      for (let el = box.firstElementChild; el && over > 0;) {
        const next = el.nextElementSibling;
        if (freeAll || el.dataset[SAVED]) {
          if (st.mode === 'capturing') checkDeleted(el);
          el.remove();
          over--;
          st.stats.trimmed++;
        }
        el = next;
      }
    }

    function onItemsMutation(records) {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(captureNode);
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

    // 回溯擷取（F-02 v28）：#items 內既有訊息全部擷取一次（重複由 id 去重）
    function backfill() {
      if (!st.items) return;
      Array.from(st.items.children).forEach(captureNode);
      capturePinned();
      trim();
    }

    function streamMeta() {
      const i = st.info || {};
      const m = { isLive: source !== 'replay' };
      for (const k of ['title', 'channelName', 'channelHandle', 'channelUrl']) if (i[k]) m[k] = i[k];
      if (st.stream.startedAt != null) m.startedAt = st.stream.startedAt;
      if (st.stream.endedAt != null) m.endedAt = st.stream.endedAt;
      if (st.stream.scheduledStartAt != null) m.scheduledStartAt = st.stream.scheduledStartAt;
      return m;
    }

    // 場次資訊 → 開播／結束時間（F-14 phase；判斷來源待實機確認，見 docs/youtube-dom-notes.md）
    function deriveTimes(info) {
      const t = { startedAt: null, endedAt: null, scheduledStartAt: null };
      const sd = typeof info.startDate === 'number' ? info.startDate : null;
      const ed = typeof info.endDate === 'number' ? info.endDate : null;
      if (ed != null) { t.endedAt = ed; t.startedAt = sd; }
      else if (sd != null && sd <= now()) t.startedAt = sd;
      else if (sd != null) t.scheduledStartAt = sd;
      return t;
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
        console.warn('[ytcas] 無法開始收錄（background 無回應），5 秒後重試');
        setTimeout(() => { if (seq === st.startSeq && st.mode === 'pending') beginCapture(); }, 5000);
        return;
      }
      if (seq !== st.startSeq) return; // 期間 videoId 已改變
      if (!r.ok) { console.warn('[ytcas] 無法開始收錄', r.error); setStatus('paused', { reason: 'error' }); return; }
      if (!r.allowed) { pauseCapture(r.reason || 'paused'); return; }
      st.session = { captureSessionId: r.captureSessionId, versionId: r.versionId };
      // background 已知的開播／結束時間（彈出視窗由 FETCH_STREAM_META 補齊）
      if (r.stream) for (const k of ['startedAt', 'endedAt', 'scheduledStartAt']) if (st.stream[k] == null && typeof r.stream[k] === 'number') st.stream[k] = r.stream[k];
      setStatus('capturing');
      backfill();
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
        if (r.startsWith('failed')) S.warnOnce('F-12:' + r, '無法自動切換到「即時聊天室」');
        if (opts.onF12) try { opts.onF12({ f12: r, viewMode: st.viewMode }); } catch (_) { /* ignore */ }
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
      if (!s.captured && !final) return;
      // 只記筆數（id 一致性驗證：重播時 idMerged ≫ fpMerged 代表直播與重播的訊息 id 相同）
      console.info('[ytcas] 收錄統計' + (final ? '（結束）' : ''), { videoId: st.videoId, source, mode: st.mode, captured: s.captured,
        added: s.added, idMerged: s.merged + s.unchanged - s.fpMerged, fpMerged: s.fpMerged, dropped: s.dropped, rejected: s.rejected,
        trimmed: s.trimmed, pinned: s.pinned, deleted: s.deleted, deletedMissing: s.deletedMissing, domNodes: st.items ? st.items.children.length : null });
    }

    // ------------------------------------------------ 對外
    function tick() {
      const had = !!st.items;
      const ok = attach();
      if (ok && !had && st.mode === 'capturing') backfill();
      if (!ok && st.mode !== 'stopped') S.warnOnce('chat.items', S.chat.items);
      trim();
    }

    const api = {
      // 設定或更新場次資訊（STREAM_INFO 或網址參數）；videoId 改變時結束舊收錄、重新開始
      setInfo(info) {
        if (!info || st.mode === 'stopped') return;
        const vid = typeof info.videoId === 'string' && /^[\w-]{6,20}$/.test(info.videoId) ? info.videoId : null;
        const changed = vid && vid !== st.videoId;
        st.info = Object.assign({}, st.info || {}, info);
        const times = deriveTimes(st.info);
        for (const k of Object.keys(times)) if (times[k] != null) st.stream[k] = times[k];
        if (changed) {
          if (st.videoId) { flush(); endSession(); logStats(true); }
          st.videoId = vid;
          st.stream = deriveTimes(st.info);
          st.pinnedSent.clear(); st.deletedReported.clear(); st.pendingDeleted.length = 0;
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
      _tick: tick,
    };
    return api;
  }

  root.YTCAS_CAPTURE = { createEngine, parseMessage, parseClock, parseOffset, runsOf, hash, observers: () => liveObservers };
})(typeof globalThis !== 'undefined' ? globalThis : self);
