// content script：三種環境（SPEC 3.1、F-19）
//   1. top watch 頁（www.youtube.com/watch）：場次資訊提供者（STREAM_INFO）、F-19 自動接手；按鈕、面板、clip-path 於 T5／T6 實作
//   2. 嵌入式 chat frame（iframe 內的 /live_chat、/live_chat_replay）：擷取、修剪
//   3. 彈出式聊天室（頂層頁面的 /live_chat、/live_chat_replay）：擷取、修剪
// 輸出到 console 的內容只有標籤、筆數與時間，不含訊息文字。
(function () {
  'use strict';
  const C = globalThis.YTCAS_CONST;
  const S = globalThis.YTCAS_SEL;
  const CAP = globalThis.YTCAS_CAPTURE;
  if (!C || !S) return;
  const FM = C.FM;
  const RT = C.RT;
  const YT = C.YT_ORIGIN;

  const path = location.pathname;
  const isTop = window === window.top;
  const isChatPath = path.startsWith('/live_chat'); // 含 /live_chat_replay
  const env = isChatPath ? (isTop ? 'popout' : 'chatframe') : (isTop ? 'top' : 'other');

  const connected = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  const send = (msg) => {
    if (!connected()) return Promise.reject(Object.assign(new Error('disconnected'), { disconnected: true }));
    return chrome.runtime.sendMessage(msg);
  };
  const isVideoId = (v) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v);

  // T3.8（審查十追加七 C-1）擴充功能更新後 background 會重新注入本檔。若同一環境裡已有實例：
  //   舊實例已斷線 → 讓它退場（停止擷取引擎與定時工作），由新實例接手；舊實例仍連線 → 新實例不啟動（避免重複）
  const prevRetire = globalThis.__ytcasRetire;
  if (typeof prevRetire === 'function') {
    let stillLive = false;
    try { stillLive = prevRetire() === false; } catch (_) { /* ignore */ }
    if (stillLive) return;
  }
  let retired = false;
  const retireHooks = [];
  globalThis.__ytcasRetire = () => {
    if (connected()) return false; // 仍連線：不退場
    if (!retired) {
      retired = true;
      for (const f of retireHooks) { try { f(); } catch (_) { /* ignore */ } }
    }
    return true;
  };

  // ================================================================ F-20 診斷記錄（T3.7）
  // 記錄中（chrome.storage.local 的 diagState）才收集並批次送給 background；只送筆數、標籤、屬性名稱、時間、videoId。
  // 不在 YouTube 頁面上顯示任何東西（10.1 原則 6）。
  const DG = C.DIAG;
  let diagSt = { active: false };
  try {
    chrome.storage.local.get(DG.STATE_KEY).then((o) => { diagSt = o[DG.STATE_KEY] || { active: false }; }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[DG.STATE_KEY]) diagSt = ch[DG.STATE_KEY].newValue || { active: false }; });
  } catch (_) { /* ignore */ }
  const diagOn = (p) => !!diagSt.active && Array.isArray(diagSt.probes) && diagSt.probes.includes(p) && connected();
  let dbuf = [];
  let dtimer = 0;
  function dlog(probe, kind, data, ctx) {
    if (!diagOn(probe)) return;
    dbuf.push({ ts: Date.now(), probe, kind, ctx: Object.assign({ env }, ctx || {}), data: data || {} });
    if (dbuf.length >= DG.FLUSH_MAX) dflush();
    else if (!dtimer) dtimer = setTimeout(dflush, DG.FLUSH_MS);
  }
  function dflush() {
    clearTimeout(dtimer); dtimer = 0;
    const records = dbuf.splice(0);
    if (!records.length || !connected()) return;
    try { const p = chrome.runtime.sendMessage({ type: RT.DIAG_LOG, records }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  }
  window.addEventListener('pagehide', dflush);
  // P8：本套件（content script）的 warn／error 與例外。console 物件是 content script 世界自己的，不影響 YouTube。
  // T3.8（審查十追加七 B-1）：warnOnce 只記 key＋等級＋預先定義的說明（不取執行期字串）；其他 warn／error 與例外的
  // 訊息只保留 ASCII（中日韓文字換成 […]），避免意外帶到聊天內容
  const WARN_ONCE_PREFIX = '[ytcas] 找不到 YouTube 元素';
  S.onWarn = (key, lv) => { if (lv === 'warn' && diagOn('P8')) dlog('P8', 'warnOnce', { key: C.asciiOnly(key), level: lv, desc: C.diagWarnText(key) }); };
  for (const lv of ['warn', 'error']) {
    const orig = console[lv].bind(console);
    console[lv] = (...a) => {
      orig(...a);
      try {
        if (!diagOn('P8') || (typeof a[0] === 'string' && a[0].startsWith(WARN_ONCE_PREFIX))) return; // warnOnce 由 onWarn 記錄
        dlog('P8', lv, { message: C.asciiOnly(a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')) });
      } catch (_) { /* ignore */ }
    };
  }
  window.addEventListener('error', (e) => {
    if (!diagOn('P8') || !String(e.filename || '').startsWith('chrome-extension://')) return; // 只收本套件的例外
    dlog('P8', 'exception', { message: C.asciiOnly(e.message), stack: C.asciiOnly((e.error && e.error.stack) || ''), line: e.lineno || null });
  });

  // T3.8（審查十追加七 C-2）：background 的連線檢查。只由頂層頁面回應（同一分頁的多個 frame 只需一個回覆）；
  // 已斷線的舊 content script 收不到這則訊息，所以「沒有回應」= 需要重新整理或重新注入
  if (isTop) {
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (retired || !msg || msg.type !== RT.PING) return;
        sendResponse({ ok: true, env });
      });
    } catch (_) { /* ignore */ }
  }

  if (env === 'chatframe' || env === 'popout') runChat();
  else if (env === 'top') runTop();

  // ================================================================ chat frame／彈出式聊天室
  function runChat() {
    if (!CAP) return;
    const replay = path.startsWith('/live_chat_replay');
    // 彈出視窗的重播仍記為 replay（offset 來自影片時間）；直播的彈出視窗記為 popout（F-19）
    const source = replay ? 'replay' : (env === 'popout' ? 'popout' : 'live');
    const urlVid = new URLSearchParams(location.search).get('v');

    const post = (type, payload) => {
      if (env !== 'chatframe') return;
      try { window.parent.postMessage(Object.assign({ __ytcas: true, type }, payload || {}), YT); } catch (_) { /* 非 YouTube 頁面內嵌 */ }
    };

    // 診斷（只記屬性名稱與狀態）：phase 判斷來源（F-14 第 3 點）與 F-12 結果。F-12 有結果時輸出，最晚 10 秒
    let diagDone = false;
    const diag = (f12) => {
      if (diagDone) return;
      diagDone = true;
      const r = document.querySelector(S.chat.renderer);
      const s = engine.state();
      const envInfo = { env, source, rendererAttrs: r ? r.getAttributeNames() : null,
        hasItems: !!document.querySelector(S.chat.items), urlHasV: !!urlVid, mode: s.mode,
        viewMode: (f12 && f12.viewMode) || s.viewMode, f12: (f12 && f12.f12) || s.f12 || 'not-run' };
      console.info('[ytcas] 聊天室環境（診斷）', envInfo);
      dlog('P4', 'chat-env', envInfo, { source, videoId: s.videoId }); // F-20
    };
    const engine = CAP.createEngine({
      doc: document, source, send, isConnected: connected,
      onStatus: (s) => post(FM.CAPTURE_STATUS, s),
      onF12: (r) => diag(r),
      // F-20 P1／P2／P7：引擎的統計、節點分類、結構探針（記錄中才轉送）
      onDiag: (probe, kind, data) => { if (diagOn(probe)) dlog(probe, kind, data, { source, videoId: engine.state().videoId }); },
    });
    if (env === 'popout') dlog('P6', 'popout-open', { urlHasV: !!urlVid }, { source, videoId: isVideoId(urlVid) ? urlVid : null });
    setTimeout(() => diag(null), 10000);
    engine.start();
    retireHooks.push(() => engine.stop()); // T3.8：被新注入的實例取代時停止（觀察器、計時器一併解除）

    if (env === 'popout') {
      if (isVideoId(urlVid)) engine.setInfo({ videoId: urlVid });
      else { S.warnOnce('popout:videoId', location.pathname, 'warn'); engine.noVideoId(); } // 彈出式聊天室卻沒有 v：無法收錄
    } else {
      // 嵌入式：網址通常只有 continuation，videoId 以 top frame 的 STREAM_INFO 為準（4.3 v29）
      let got = false;
      window.addEventListener('message', (e) => {
        if (e.origin !== YT || e.source !== window.parent || !e.data || e.data.__ytcas !== true) return;
        if (e.data.type !== FM.STREAM_INFO) return;
        const d = e.data;
        if (!isVideoId(d.videoId)) return;
        got = true;
        engine.setInfo({
          videoId: d.videoId, title: str(d.title), channelName: str(d.channelName), channelHandle: str(d.channelHandle),
          channelUrl: str(d.channelUrl), startDate: num(d.startDate), endDate: num(d.endDate),
          isLiveBroadcast: typeof d.isLiveBroadcast === 'boolean' ? d.isLiveBroadcast : null, duration: num(d.duration),
          liveSignalAt: num(d.liveSignalAt), // T3.6 開播訊號
        });
      });
      const t0 = Date.now();
      const ask = () => {
        if (got) return;
        if (Date.now() - t0 > C.STREAM_INFO_MAX_WAIT_MS) {
          if (isVideoId(urlVid)) engine.setInfo({ videoId: urlVid });
          else { S.warnOnce('chatframe:STREAM_INFO', '30 秒內沒有收到 top frame 的場次資訊，本聊天室不收錄', 'warn'); engine.noVideoId(); }
          return;
        }
        post(FM.STREAM_INFO_REQUEST);
        setTimeout(ask, C.STREAM_INFO_RETRY_MS);
      };
      ask();
    }

    // F-15：暫停設定變更 → 重新判斷（暫停由 background 的 SAVE_MESSAGES 回應 paused 生效）
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if ('captureEnabled' in changes || 'captureExcludedChannels' in changes) engine.recheckPolicy();
      });
    } catch (_) { /* ignore */ }

    // T3.5（審查十追加三 F-2）直播結束偵測的候選訊號：yt-live-chat-renderer 屬性變化（診斷，只記屬性名稱，每頁最多 30 次）。
    // 結束提示若以新的訊息元件出現，會以「未知訊息元件」記錄標籤（存為 system，保存 rawTag）。
    let rLogs = 0;
    const watchRenderer = () => {
      const r = document.querySelector(S.chat.renderer);
      if (!r) { setTimeout(watchRenderer, 2000); return; }
      let prev = new Set(r.getAttributeNames());
      new MutationObserver(() => {
        const now = new Set(r.getAttributeNames());
        const added = [...now].filter((a) => !prev.has(a));
        const removed = [...prev].filter((a) => !now.has(a));
        prev = now;
        if ((added.length || removed.length) && rLogs < 30) {
          rLogs++;
          console.info('[ytcas] 聊天室屬性變化（診斷）', { added, removed, at: new Date().toISOString() });
        }
        // F-20 P4（不受上面 30 次的限制，診斷記錄本身有容量上限）
        if (added.length || removed.length) dlog('P4', 'renderer-attrs', { added, removed }, { source, videoId: engine.state().videoId });
      }).observe(r, { attributes: true });
    };
    watchRenderer();

    // 離開頁面：送出剩餘訊息並結束 session（送不到時由 background 以最後寫入時間補 endedAt）
    // T3.8（審查十追加七 D）：結束時的「收錄統計（結束）」也寫入 P1（彈出式聊天室開不到 1 分鐘時也有紀錄）→ stop 之後再送出診斷
    window.addEventListener('pagehide', () => { engine.stop(); dflush(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') engine.flush(); });
  }

  function str(v) { return typeof v === 'string' ? v.slice(0, 500) : ''; }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

  // ================================================================ top watch 頁
  function runTop() {
    const T = S.top;
    let lastStatus = null; // 嵌入式聊天室回報的 CAPTURE_STATUS
    let diagFor = '';
    let pageAt = Date.now(); // 頁面（或站內換頁）開始時間：開播訊號的採信門檻
    let liveSignal = null;   // { videoId, at }

    const currentVideoId = () => {
      if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
      const m = /^\/live\/([\w-]{6,20})/.exec(location.pathname);
      return m ? m[1] : null;
    };
    const chatIframe = () => document.querySelector(T.chatIframe);
    const metaContent = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('content') : null; };
    const parseDate = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };

    function streamInfo() {
      const videoId = currentVideoId();
      if (!isVideoId(videoId)) return null;
      const a = document.querySelector(T.channelLink);
      const href = a ? a.getAttribute('href') || '' : '';
      const hm = /^\/(@[^/?#]+)/.exec(href);
      let handle = '';
      if (hm) { try { handle = decodeURIComponent(hm[1]); } catch (_) { handle = hm[1]; } }
      const live = metaContent(T.isLiveMeta);
      const v = document.querySelector(T.video);
      const d = v && Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : null;
      return {
        videoId,
        title: metaContent(T.titleMeta) || '',
        channelName: a ? (a.textContent || '').trim() : '',
        channelHandle: handle,
        channelUrl: href ? new URL(href, YT).href : '',
        startDate: parseDate(metaContent(T.startDateMeta)),
        endDate: parseDate(metaContent(T.endDateMeta)),
        isLiveBroadcast: live == null ? null : /^true$/i.test(live),
        duration: d,
        // T3.6：播放器開播訊號（偵測時間）；chat frame 只在等待開播確認時採用
        liveSignalAt: liveSignal && liveSignal.videoId === videoId ? liveSignal.at : null,
      };
    }

    function sendInfo() {
      const f = chatIframe();
      const info = streamInfo();
      if (!f || !f.contentWindow || !info) return;
      try { f.contentWindow.postMessage(Object.assign({ __ytcas: true, type: FM.STREAM_INFO }, info), YT); } catch (_) { /* ignore */ }
      if (diagFor !== info.videoId) {
        diagFor = info.videoId;
        // 診斷（F-14 phase 判斷來源）：只記是否存在與時間，不記標題與聊天內容
        const iso = (t) => (t == null ? null : new Date(t).toISOString());
        console.info('[ytcas] 場次資訊（診斷）', { videoId: info.videoId, startDate: iso(info.startDate), endDate: iso(info.endDate),
          isLiveBroadcast: info.isLiveBroadcast, rawIsLive: metaContent(T.isLiveMeta), duration: info.duration,
          hasStartDateMeta: !!document.querySelector(T.startDateMeta), hasEndDateMeta: !!document.querySelector(T.endDateMeta),
          now: new Date().toISOString() });
      }
    }

    window.addEventListener('message', (e) => {
      if (retired) return;
      const f = chatIframe();
      if (e.origin !== YT || !f || e.source !== f.contentWindow || !e.data || e.data.__ytcas !== true) return;
      if (e.data.type === FM.STREAM_INFO_REQUEST) sendInfo();
      else if (e.data.type === FM.CAPTURE_STATUS) {
        lastStatus = { videoId: e.data.videoId, capturing: !!e.data.capturing, reason: e.data.reason || null, at: Date.now() };
      }
    });

    // 影片長度（F-18）：重播的 video 長度可能稍晚才確定
    let boundVideo = null;
    function bindVideo() {
      const v = document.querySelector(T.video);
      if (!v || v === boundVideo) return;
      boundVideo = v;
      v.addEventListener('durationchange', sendInfo);
      v.addEventListener('loadedmetadata', sendInfo);
    }

    document.addEventListener('yt-navigate-finish', () => {
      lastStatus = null;
      pageAt = Date.now();
      liveSignal = null;
      bindVideo();
      setTimeout(sendInfo, 800); // microdata 隨導航更新的時機待實機確認；chat frame 也會主動要求
    });

    // T3.5（審查十追加三 F-2）直播結束偵測：
    //   可行動的訊號：每 30 秒重讀場次資訊並送給 chat frame；endDate meta 出現 → chat frame 之後的訊息標 post，
    //   background 依 F-14 重算 phase。其他候選訊號（ytd-watch-flexy 屬性變化）尚未實機確認，只記屬性名稱供診斷。
    let lastEnd = { videoId: null, endDate: null, isLive: null, duration: undefined };
    setInterval(() => {
      if (retired) return;
      const info = streamInfo();
      if (!info) return;
      if (info.videoId !== lastEnd.videoId) lastEnd = { videoId: info.videoId, endDate: info.endDate, isLive: info.isLiveBroadcast, duration: undefined };
      // T3.6（審查十追加五 E-3 第 2 點）播放器長度由無變有 → 開播訊號。頁面載入 60 秒後才採信
      //（載入已在直播的頁面時，長度會在數秒內出現，不是開播）；是否在不重新整理時發生，以此診斷確認
      if (lastEnd.duration !== undefined && lastEnd.duration == null && info.duration != null) {
        const age = Date.now() - pageAt;
        console.info('[ytcas] 播放器長度出現（診斷）', { videoId: info.videoId, duration: info.duration, pageAgeSec: Math.round(age / 1000) });
        if (age >= C.LIVE_SIGNAL_MIN_PAGE_AGE_MS) liveSignal = { videoId: info.videoId, at: Date.now() };
      }
      lastEnd.duration = info.duration;
      if (info.endDate != null && lastEnd.endDate == null) {
        console.info('[ytcas] 偵測到直播結束（endDate meta 出現）', { videoId: info.videoId, endDate: new Date(info.endDate).toISOString() });
      }
      if (info.isLiveBroadcast !== lastEnd.isLive) console.info('[ytcas] isLiveBroadcast 變化（診斷）', { from: lastEnd.isLive, to: info.isLiveBroadcast });
      lastEnd.endDate = info.endDate; lastEnd.isLive = info.isLiveBroadcast;
      sendInfo();
      p3(info);
    }, 30000);
    // F-20 P3：場次資訊＋播放器長度（變化時＋每 5 分鐘；不記標題與頻道）
    let p3Key = '';
    let p3At = 0;
    function p3(info) {
      if (!diagOn('P3') || !info) return;
      const iso = (t) => (t == null ? null : new Date(t).toISOString());
      const d = { startDate: iso(info.startDate), endDate: iso(info.endDate), isLiveBroadcast: info.isLiveBroadcast, duration: info.duration,
        liveSignalAt: iso(info.liveSignalAt), pageAgeSec: Math.round((Date.now() - pageAt) / 1000), hasChatFrame: !!chatIframe() };
      const key = JSON.stringify([d.startDate, d.endDate, d.isLiveBroadcast, d.duration, d.liveSignalAt]);
      if (key === p3Key && Date.now() - p3At < 5 * 60000) return;
      p3Key = key; p3At = Date.now();
      dlog('P3', 'stream-info', d, { videoId: info.videoId });
    }
    // ytd-watch-flexy 屬性變化（診斷，只記屬性名稱，每頁最多 30 次）：找出直播結束時是否有可用的屬性訊號
    let flexyLogs = 0;
    let flexyObs = null;
    function watchFlexyAttrs() {
      const fx = document.querySelector(T.watchFlexy);
      if (!fx || (flexyObs && flexyObs.__t === fx)) return;
      if (flexyObs) flexyObs.disconnect();
      let prev = new Set(fx.getAttributeNames());
      flexyObs = new MutationObserver(() => {
        const now = new Set(fx.getAttributeNames());
        const added = [...now].filter((a) => !prev.has(a));
        const removed = [...prev].filter((a) => !now.has(a));
        prev = now;
        if ((added.length || removed.length) && flexyLogs < 30 && currentVideoId()) {
          flexyLogs++;
          console.info('[ytcas] ytd-watch-flexy 屬性變化（診斷）', { added, removed, at: new Date().toISOString() });
        }
        if ((added.length || removed.length) && currentVideoId()) dlog('P4', 'flexy-attrs', { added, removed }, { videoId: currentVideoId() }); // F-20
      });
      flexyObs.observe(fx, { attributes: true });
      flexyObs.__t = fx;
    }
    setInterval(() => { if (!retired) watchFlexyAttrs(); }, 5000);
    retireHooks.push(() => { if (flexyObs) flexyObs.disconnect(); });

    // 聊天室 iframe 狀態（診斷）：彈出視窗開啟時主分頁的嵌入式聊天室是否仍存在（F-19 第 4 點，待實機確認）
    let lastFrameKey = '';
    setInterval(() => {
      if (retired) return;
      bindVideo();
      const f = chatIframe();
      let p = null;
      try { p = f && f.contentWindow ? f.contentWindow.location.pathname : null; } catch (_) { p = 'cross-origin'; }
      const st = { present: !!f, visible: !!(f && f.offsetHeight > 0), path: p, height: f ? f.offsetHeight : 0 };
      const key = JSON.stringify([st.present, st.visible, st.path]);
      if (key !== lastFrameKey) {
        lastFrameKey = key;
        if (currentVideoId()) {
          console.info('[ytcas] 聊天室 iframe 狀態（診斷）', st);
          dlog('P4', 'chat-iframe', st, { videoId: currentVideoId() }); // F-20
        }
      }
    }, 1000);

    // F-19：彈出視窗關閉 → 主分頁自動接手（展開聊天室、恢復收錄；預設開啟面板於 T5）
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (retired || !msg || msg.type !== RT.CAPTURE_END || msg.source !== 'popout' || msg.videoId !== currentVideoId()) return;
        handoff();
      });
    } catch (_) { /* ignore */ }

    function handoff() {
      const f = chatIframe();
      const visible = !!(f && f.offsetHeight > 0);
      dlog('P6', 'handoff-received', { chatVisible: visible, capturing: !!(lastStatus && lastStatus.capturing) }, { videoId: currentVideoId() }); // F-20
      if (visible && lastStatus && lastStatus.capturing && lastStatus.videoId === currentVideoId()) {
        console.info('[ytcas] 彈出視窗已關閉；主分頁聊天室已在收錄中');
        return;
      }
      if (!visible) {
        const t = S.findChatTeaser(document, C.OPEN_PANEL_LABELS);
        if (!t || t.button.disabled) { S.warnOnce('handoff:teaser', '找不到可用的「開啟面板」，無法自動展開聊天室', 'warn'); return; }
        console.info('[ytcas] 彈出視窗已關閉，自動展開聊天室恢復收錄');
        t.button.click();
        return;
      }
      // 聊天室看得到但沒有在收錄：等 chat frame 回報（它會自己開始）；5 秒後仍沒有就記錄一次
      setTimeout(() => {
        if (!(lastStatus && lastStatus.capturing)) console.warn('[ytcas] 彈出視窗已關閉，但主分頁聊天室沒有回報收錄中', lastStatus && lastStatus.reason);
      }, 5000);
    }

    bindVideo();
  }
})();
