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

  // T4.1（審查十一 5.3）以本實例啟動時取得的 runtime 判斷連線（不受其他實例影響）
  const myRuntime = (() => { try { return chrome.runtime; } catch (_) { return null; } })();
  const connected = () => { try { return !!(myRuntime && myRuntime.id); } catch (_) { return false; } };
  const send = (msg) => {
    if (!connected()) return Promise.reject(Object.assign(new Error('disconnected'), { disconnected: true }));
    return chrome.runtime.sendMessage(msg);
  };
  const isVideoId = (v) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v);

  // 舊實例的退場（擴充功能 🔄、關閉再開啟後，background 重新注入本檔）：
  // T4.1（審查十一 5.3）實測（Chromium 157，docs/reports/2026-11-17-t4-viewer.md「T4.1」）：重新載入或關閉再開啟後，
  // 重新注入的腳本跑在**新的隔離環境**，看不到舊實例的全域變數，所以 T3.8 的 globalThis.__ytcasRetire 從未生效，
  // 舊實例的擷取引擎一直在跑（斷線狀態下修剪會直接移除最舊的節點，不先擷取）。改以兩種方式通知：
  //   1. 同一環境（同一次載入重複注入）：globalThis.__ytcasRetire；舊實例仍連線 → 新實例不啟動（避免重複）
  //   2. 不同環境：DOM 事件（各環境共用同一個 document）。舊實例只在自己已斷線時退場，並回覆 RETIRED
  const EV_HANDOFF = 'ytcas:handoff';
  const EV_RETIRED = 'ytcas:retired';
  const prevRetire = globalThis.__ytcasRetire;
  if (typeof prevRetire === 'function') {
    let stillLive = false;
    try { stillLive = prevRetire() === false; } catch (_) { /* ignore */ }
    if (stillLive) return;
  }
  let retired = false;
  const retireHooks = [];
  const retireIfDisconnected = () => {
    if (connected()) return false; // 仍連線：不退場
    if (!retired) {
      retired = true;
      for (const f of retireHooks) { try { f(); } catch (_) { /* ignore */ } }
    }
    return true;
  };
  globalThis.__ytcasRetire = retireIfDisconnected;
  let handedOff = 0; // 本實例啟動時讓幾個舊實例退場（診斷）
  const onRetired = () => { handedOff++; };
  document.addEventListener(EV_RETIRED, onRetired);
  try { document.dispatchEvent(new CustomEvent(EV_HANDOFF)); } catch (_) { /* ignore */ }
  document.removeEventListener(EV_RETIRED, onRetired); // dispatchEvent 同步執行：舊實例的回覆此時已收到
  document.addEventListener(EV_HANDOFF, () => {
    if (!retired && retireIfDisconnected()) { try { document.dispatchEvent(new CustomEvent(EV_RETIRED)); } catch (_) { /* ignore */ } }
  });
  if (handedOff) console.info('[ytcas] 已接手先前斷線的實例（重新注入）', { env, retired: handedOff });

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
  // F-20 P9 記憶體（T4.2，審查十一 6.3）：每 5 分鐘記錄 JS heap（performance.memory，Chrome 專有，只有數字）、
  // 本 frame 的 DOM 節點數；chat frame 另記 #items 節點數與佇列長度。注意：同源的 top 與聊天室 iframe 通常在同一個
  // renderer 程序、共用同一個 V8 heap，兩邊的 heap 數字可能相同，各 frame 的差異以 DOM 節點數判斷
  let p9Extra = null; // () => { data, ctx }
  function p9() {
    if (retired || !diagOn('P9')) return;
    const pm = (typeof performance !== 'undefined' && performance.memory) || null;
    const mb = (v) => (typeof v === 'number' ? Math.round(v / 104857.6) / 10 : null);
    let e = {};
    try { e = (p9Extra && p9Extra()) || {}; } catch (_) { /* ignore */ }
    dlog('P9', 'memory', Object.assign({ usedJSHeapMB: mb(pm && pm.usedJSHeapSize), totalJSHeapMB: mb(pm && pm.totalJSHeapSize),
      heapLimitMB: mb(pm && pm.jsHeapSizeLimit), domNodes: document.getElementsByTagName('*').length, hidden: document.hidden }, e.data || {}), e.ctx);
  }
  if (env !== 'other') {
    setTimeout(p9, 30000);
    // v44（T5.3，18.4）間隔依記錄設定（diagState.p9Minutes，診斷頁預設 1 分鐘）；每次取樣後重新排程，設定改變即生效
    //（每 15 秒檢查一次是否到了下一次取樣時間）
    let lastP9 = Date.now();
    setInterval(() => {
      const every = Math.max(DG.P9_MIN_MINUTES, Number(diagSt.p9Minutes) || DG.P9_MINUTES) * 60000;
      if (Date.now() - lastP9 >= every - 1000) { lastP9 = Date.now(); p9(); }
    }, 15000);
    // 記錄途中才開始（或新加入 P9）時立即取樣一次
    try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[DG.STATE_KEY]) setTimeout(p9, 1000); }); } catch (_) { /* ignore */ }
  }
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
      onStatus: (s) => postStatus(s),
      onF12: (r) => { diag(r); postStatus(null); }, // T5：F-12 結果也告訴 top（面板說明文字）
      // F-20 P1／P2／P7：引擎的統計、節點分類、結構探針（記錄中才轉送）
      onDiag: (probe, kind, data) => { if (diagOn(probe)) dlog(probe, kind, data, { source, videoId: engine.state().videoId }); },
      // v45（T5.4，審查十一 20.4）禮物結構：非記錄期間也送給 background（storage.session 保留最近 5 筆）
      onGiftStructure: (data) => {
        if (!connected()) return;
        try { const p = chrome.runtime.sendMessage({ type: RT.GIFT_STRUCTURE, data, source, videoId: engine.state().videoId }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* 斷線 */ }
      },
    });
    // T5：收錄狀態＋F-12 結果（viewMode、f12）→ top frame → 面板（F-12 說明文字、收錄狀態）
    let lastCap = null;
    function postStatus(s) {
      if (s) lastCap = s;
      if (!lastCap) return;
      let f = {};
      try { const es = engine.state(); f = { f12: es.f12 || null, viewMode: es.viewMode || null }; } catch (_) { /* 引擎尚未建立 */ }
      post(FM.CAPTURE_STATUS, Object.assign({}, lastCap, f));
    }
    if (env === 'chatframe') headerButton(post); // T5.1：post 是 runChat 內的區域函式，需傳入
    // v49（T6，SPEC 6.3）F-10：底部互動區量測與彈窗偵測 → CHAT_INPUT_STATE；面板開啟時隱藏原生訊息列表與頂部列（嵌入式才有面板）
    if (env === 'chatframe' && globalThis.YTCAS_CHAT_INPUT) {
      const ci = globalThis.YTCAS_CHAT_INPUT.create({ doc: document, win: window, S, C, post,
        // v50（T6.1，30.1、30.3）F-20 P7：`$`／彈窗狀態改變時的底部互動區結構（記錄中才轉送）
        onLog: (kind, data) => { if (diagOn('P7')) dlog('P7', kind, data, { source, videoId: engine.state().videoId }); },
        accept: (e) => !retired && e.origin === YT && e.source === window.parent && !!e.data && e.data.__ytcas === true });
      ci.start();
      retireHooks.push(() => ci.stop());
    }
    if (env === 'popout') dlog('P6', 'popout-open', { urlHasV: !!urlVid }, { source, videoId: isVideoId(urlVid) ? urlVid : null });
    setTimeout(() => diag(null), 10000);
    engine.start();
    retireHooks.push(() => engine.stop()); // T3.8：被新注入的實例取代時停止（觀察器、計時器一併解除）
    p9Extra = () => {
      const s = engine.state();
      const items = document.querySelector(S.chat.items);
      return { data: { itemsNodes: items ? items.children.length : null, queue: s.queue, observers: s.observers, mode: s.mode }, ctx: { source, videoId: s.videoId } };
    };

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

  // ================================================================ T5 聊天室頂部列的開關（F-09 錨點 1，10.4）
  // ⋮ 之前、同一父層；只加 ytcas- 前綴的元素，不改原生元素。點擊 → TOGGLE_PANEL 給 top frame。
  // 面板開啟時頂部列被面板蓋住（T6 起被 clip 裁掉），按鈕主要在面板關閉與退讓（劇院模式）時看得到
  function headerButton(post) {
    const BTN_ID = 'ytcas-header-btn';
    const STYLE = 'ytcas-chat-style';
    let state = { on: false, paused: false, reason: null };
    let warned = false;
    const t0 = Date.now();
    const label = () => (state.on && state.paused ? (state.reason === 'theater' ? '劇院模式下無法使用優化面板' : '聊天室太小，無法使用優化面板')
      : state.on ? '關閉優化面板' : '開啟優化面板');
    function ensureStyle() {
      if (document.getElementById(STYLE)) return;
      const st = document.createElement('style');
      st.id = STYLE;
      st.textContent = `
        #${BTN_ID} { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin: 0 2px; padding: 0;
          border: 0; border-radius: 50%; background: transparent; color: var(--yt-spec-icon-inactive, #606060); cursor: pointer; flex: none; }
        #${BTN_ID}:hover { background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05)); }
        #${BTN_ID}:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 1px; }
        #${BTN_ID}:active { transform: translateY(1px); }
        #${BTN_ID}.ytcas-on { color: #cc0000; }
        #${BTN_ID}.ytcas-paused { opacity: .45; cursor: default; }
        #${BTN_ID} svg { width: 22px; height: 22px; display: block; }`;
      (document.head || document.documentElement).appendChild(st);
    }
    function render(b) {
      const l = label();
      b.title = l; b.setAttribute('aria-label', l);
      b.setAttribute('aria-pressed', String(!!state.on));
      b.classList.toggle('ytcas-on', !!state.on && !state.paused);
      b.classList.toggle('ytcas-paused', !!state.on && !!state.paused);
    }
    function mount() {
      if (retired) return;
      let anchor = null;
      for (const sel of S.chat.headerOverflow) { anchor = document.querySelector(sel); if (anchor) break; }
      let b = document.getElementById(BTN_ID);
      if (!anchor) {
        const hdr = document.querySelector(S.chat.header);
        if (hdr && !warned && Date.now() - t0 > 10000) { warned = true; S.warnOnce('panel:header', S.chat.headerOverflow.join(', '), 'info'); }
        return;
      }
      if (!b || b.nextElementSibling !== anchor) {
        if (b) b.remove();
        ensureStyle();
        b = document.createElement('button');
        b.type = 'button';
        b.id = BTN_ID;
        // 固定的 SVG 圖示（面板＋列表）
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9h9M7.5 12h9M7.5 15h5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        b.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (state.on && state.paused) return;
          post(FM.TOGGLE_PANEL, {});
        });
        anchor.parentElement.insertBefore(b, anchor);
        post(FM.PANEL_STATE, { headerMounted: true });
      }
      render(b);
    }
    window.addEventListener('message', (e) => {
      if (retired || e.origin !== YT || e.source !== window.parent || !e.data || e.data.__ytcas !== true || e.data.type !== FM.PANEL_STATE) return;
      state = { on: !!e.data.on, paused: !!e.data.paused, reason: e.data.reason || null };
      const b = document.getElementById(BTN_ID);
      if (b) render(b);
    });
    const iv = setInterval(mount, 1000);
    retireHooks.push(() => { clearInterval(iv); const b = document.getElementById(BTN_ID); if (b) b.remove(); });
    mount();
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
    p9Extra = () => {
      const v = currentVideoId();
      const vid = document.querySelector(T.video);
      return { data: { hasChatFrame: !!chatIframe(), videoBufferedSec: vid && vid.buffered && vid.buffered.length ? Math.round(vid.buffered.end(vid.buffered.length - 1) - vid.buffered.start(0)) : null },
        ctx: { videoId: isVideoId(v) ? v : null } };
    };
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
      if (!chatIframe()) return; // T3.9（審查十追加八 C）：沒有聊天室的一般影片分頁不記錄，減少雜訊
      const iso = (t) => (t == null ? null : new Date(t).toISOString());
      const d = { startDate: iso(info.startDate), endDate: iso(info.endDate), isLiveBroadcast: info.isLiveBroadcast, duration: info.duration,
        liveSignalAt: iso(info.liveSignalAt), pageAgeSec: Math.round((Date.now() - pageAt) / 1000), hasChatFrame: true };
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

    // ================================================================ T5 優化面板（F-08、F-09、6.2；src/panel.js）
    const PANEL = globalThis.YTCAS_PANEL;
    if (PANEL && myRuntime) {
      let viewerBase = '';
      try { viewerBase = myRuntime.getURL('src/viewer.html'); } catch (_) { /* ignore */ }
      const panel = PANEL.create({
        doc: document, win: window, C, S, ytOrigin: YT, extOrigin: 'chrome-extension://' + myRuntime.id,
        viewerUrl: (vid) => viewerBase + '?embed=1&v=' + encodeURIComponent(vid),
        currentVideoId: () => { const v = currentVideoId(); return isVideoId(v) ? v : null; },
        streamInfo,
        warnOnce: (k, d, lv) => S.warnOnce(k, d, lv),
        // 只記原因與版面（不含任何內容）
        onLog: (reason, data) => {
          if (['panel-open', 'panel-close', 'panel-pause', 'panel-resume', 'reinit', 'chat-reload', 'expand-timeout', 'expand-failed'].includes(reason)) {
            console.info('[ytcas] 優化面板：' + reason, data);
          }
          dlog('P4', 'panel-' + reason, data, { videoId: currentVideoId() });
        },
      }).start();
      retireHooks.push(() => panel.destroy());
      // 擴充功能被關閉或重新載入（本實例斷線）而沒有新實例接手：移除面板，原生聊天室完全還原
      const dc = setInterval(() => { if (!connected()) { clearInterval(dc); panel.destroy(); } }, 2000);
    }
  }
})();
