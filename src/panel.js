// 優化面板（T5：SPEC F-08、F-09、6.2、6.4、10.4）：top frame（www.youtube.com/watch）端的控制器。
// - 面板插入 ytd-live-chat-frame 內、iframe#chatframe 之前（6.2 第 3 點），內含檢視器 iframe（viewer.html?embed=1&v=…）。
// - 裁切（v49 T6，SPEC 6.2、6.7）：依 chat frame 的 CHAT_INPUT_STATE（src/chat-input.js）與頁面層付款視窗，
//   在 iframe#chatframe 設 --ytcas-clip（clipState：收起只露出底部互動區／彈窗展開／無輸入區全高）；面板底部留白 PANEL_INSET。
// - 劇院模式或聊天室太矮：退讓（移除 clip、隱藏面板），擷取與修剪不受影響（6.2、6.4）。
// - 開關錨點（F-09）：影片下方「聊天室」卡片、舊版「隱藏聊天室」列；聊天室頂部列的按鈕由 chat frame 注入（content.js），
//   點擊時送 TOGGLE_PANEL。面板開啟時的「關閉優化面板」在面板自己的頂部列（viewer.js）。
// - 預設開啟、不記住關閉（F-09 v24）：使用者在某部影片關閉只對該次頁面的該影片有效。
// - 不在 YouTube 頁面上加 position: fixed 的元素（10.1 原則 6）；樣式只加在 ytcas- 前綴的元素與 class 上。
// 純 DOM 邏輯，所有外部依賴由 opts 傳入（測試頁以同源的模擬頁面驗證）。
(function (root) {
  'use strict';

  const PANEL_ID = 'ytcas-panel';
  const STYLE_ID = 'ytcas-style';          // 面板開啟時才存在，關閉時整個移除（6.4）
  const BTN_STYLE_ID = 'ytcas-btn-style';  // 開關按鈕（面板關閉時也要顯示）
  const TEASER_BTN_ID = 'ytcas-teaser-btn';
  const LEGACY_BTN_ID = 'ytcas-legacy-btn';

  // v49（T6，SPEC 6.2 第 4 點）clip 狀態機（純函式，測試頁直接呼叫）。
  // o: { input: CHAT_INPUT_STATE|null, iframeH, topPopupOpen, prev: 上一次的結果|null }；P: C.PANEL
  // 回傳 { mode, clip, pad }：mode = 'input'（收起，只露出底部互動區）／'popup'（彈窗展開）／'none'（無輸入區，面板全高）／
  //   'stale'／'unknown'（量測過期或還沒收到：面板全高，等重新量測，不套用舊值）；頁面層付款視窗開啟中 → 沿用前一個狀態（held）。
  // pad：面板底部被原生互動區蓋住的高度（面板底部留白，6.2 第 5 點）
  function clipState(o, P) {
    const h = Math.max(0, o.iframeH || 0);
    const inp = o.input;
    const NONE = 'inset(100% 0 0 0)';
    if (o.topPopupOpen && o.prev && o.prev.mode !== 'unknown') return Object.assign({}, o.prev, { held: true });
    if (!inp) return { mode: 'unknown', clip: NONE, pad: 0 };
    if (Math.abs((inp.vh || 0) - h) > P.INPUT_STALE_PX) return { mode: 'stale', clip: NONE, pad: 0 };
    const bz = Math.max(0, Math.min(h, Math.round(inp.bottomZoneHeight || 0)));
    // v50（T6.1，審查十一 30.1）彈窗展開：裁切頂端＝彈窗與底部互動區所有元素（chat frame 已取最上方＝h − bottomZoneHeight）的最上方 − 8。
    // 實機：表符選單長在輸入列下方（輸入列被往上推），v49 只取彈窗頂端 → 輸入列被裁掉，看不到選了什麼、也無法關閉選單
    if (inp.popupOpen && typeof inp.popupTop === 'number') {
      const zoneTop = bz > 0 ? h - bz : h;
      const top = Math.max(0, Math.min(h, Math.min(Math.round(inp.popupTop), zoneTop) - P.POPUP_GAP_PX));
      return { mode: 'popup', clip: 'inset(' + top + 'px 0 0 0)', pad: bz };
    }
    if (!inp.hasInput || bz <= 0) return { mode: 'none', clip: NONE, pad: 0 };
    return { mode: 'input', clip: 'inset(calc(100% - ' + bz + 'px) 0 0 0)', pad: bz };
  }
  // 面板剩餘高度不足（6.2「聊天室摺疊／退讓」v26）：iframe 高度 − bottomZoneHeight < PANEL_MIN_REMAIN_PX（含 ≥ iframe 高度）。
  // 彈窗展開中不判斷（表符選單等會暫時變高）；量測過期也不判斷。v50（30.3）`$` 流程進行中（purchase）也不判斷
  function remainTooSmall(input, iframeH, P) {
    if (!input || !input.hasInput || input.popupOpen || input.purchase) return false;
    if (Math.abs((input.vh || 0) - iframeH) > P.INPUT_STALE_PX) return false;
    return iframeH - (input.bottomZoneHeight || 0) < P.PANEL_MIN_REMAIN_PX;
  }

  // opts: { doc, win, C, S, ytOrigin, viewerUrl(videoId) → string, extOrigin, currentVideoId() → string|null,
  //         streamInfo() → { isLiveBroadcast, endDate }|null, onLog?(reason, data), warnOnce?(key, detail, level) }
  function create(opts) {
    const doc = opts.doc || document;
    const win = opts.win || window;
    const C = opts.C;
    const S = opts.S;
    const P = C.PANEL;
    const FM = C.FM;
    const log = (reason, data) => { try { if (opts.onLog) opts.onLog(reason, data || {}); } catch (_) { /* ignore */ } };
    const isVideoId = (v) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v);

    const st = {
      started: false, destroyed: false,
      mounted: false, paused: false, pauseReason: null,
      videoId: null, dismissedFor: null, // 使用者在這部影片關閉了面板（只對本次頁面有效）
      panel: null, viewer: null, viewerVid: null, ready: false,
      frame: null, iframe: null,
      ro: null, frameMo: null, themeMo: null, metaMo: null, timer: 0, vodTimer: 0, watchdog: 0,
      lastTheme: null, capture: null, lastVod: '', lastChatState: '', expanding: false,
      pageStart: Date.now(), anchorWarned: false, anchors: { teaser: false, legacy: false, header: false },
      liveAnchor: null, // v50（30.4）{ videoId, wallA }：面板回報的直播牆上時間錨點
      boundVideo: null,
      // v49（T6）chat frame 的 CHAT_INPUT_STATE、頁面層付款視窗、目前的 clip 狀態、面板底部留白
      input: null, topPopup: false, clip: null, inset: -1, popTimer: 0, bodyMo: null,
    };

    // ---------------------------------------------------------------- 元素
    const els = () => {
      const frame = doc.querySelector(S.top.liveChatFrame);
      const iframe = (frame && frame.querySelector(S.top.chatIframe)) || doc.querySelector(S.top.chatIframe);
      return { frame: iframe ? iframe.parentElement : frame, iframe };
    };
    const iframeH = (f) => (f ? f.offsetHeight : 0);
    const chatOpen = () => { const { iframe } = els(); return !!iframe && iframeH(iframe) > 0; };
    const theater = () => !!(doc.querySelector(S.top.layout.theater) || doc.querySelector(S.top.layout.frameTheater));
    const video = () => doc.querySelector(S.top.video);
    const ytTheme = () => (doc.documentElement.hasAttribute('dark') ? 'dark' : 'light');

    // ---------------------------------------------------------------- 樣式
    function panelCss() {
      // T5.1（審查十一 13.1 (D)，P1）：退讓（劇院模式、太矮）時，ytd-live-chat-frame／iframe#chatframe 上不得留下任何
      // 套件的定位樣式。v41 的 position: relative !important 在退讓時仍套用，窄視窗劇院模式下 YouTube 以自己的定位排版
      // 聊天室框 → 被改成 relative 後影片縮到左上、聊天室框偏出視窗。所有規則都只在「未退讓」時生效
      return `
        .ytcas-frame:not(.ytcas-paused) { position: relative !important; }
        .ytcas-frame:not(.ytcas-paused) > .ytcas-chatframe { position: relative !important; z-index: 20 !important;
          clip-path: var(--ytcas-clip, inset(100% 0 0 0)); transition: clip-path 120ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .ytcas-frame:not(.ytcas-paused) > .ytcas-chatframe { transition: none; } }
        #${PANEL_ID} { position: absolute; inset: 0 0 auto 0; z-index: 10; box-sizing: border-box; overflow: hidden;
          border-radius: 12px; background: #fff; }
        html[dark] #${PANEL_ID} { background: #0f0f0f; }
        .ytcas-frame.ytcas-paused #${PANEL_ID} { display: none !important; }
        #${PANEL_ID} > iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
      `;
    }
    function btnCss() {
      return `
        .ytcas-entry { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 18px;
          border: 1px solid rgba(0,0,0,.12); background: rgba(0,0,0,.05); color: #0f0f0f; cursor: pointer; white-space: nowrap;
          font: 500 14px/1 "Roboto","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
        html[dark] .ytcas-entry { border-color: rgba(255,255,255,.16); background: rgba(255,255,255,.1); color: #f1f1f1; }
        .ytcas-entry:hover { background: rgba(0,0,0,.1); }
        html[dark] .ytcas-entry:hover { background: rgba(255,255,255,.2); }
        .ytcas-entry:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
        .ytcas-entry:active { transform: translateY(1px); }
        .ytcas-entry.ytcas-on { background: #cc0000; border-color: #cc0000; color: #fff; font-weight: 700; }
        .ytcas-entry.ytcas-on:hover { background: #a50000; }
        .ytcas-entry.ytcas-paused { background: transparent; color: rgba(0,0,0,.45); border-style: dashed; font-weight: 500; }
        html[dark] .ytcas-entry.ytcas-paused { color: rgba(255,255,255,.45); }
        .ytcas-entry-teaser { margin-left: 8px; align-self: center; }
        .ytcas-legacy-host { position: relative !important; }
        #${LEGACY_BTN_ID} { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); z-index: 21; height: 28px; }
      `;
    }
    function ensureStyle(id, css) {
      if (doc.getElementById(id)) return;
      const s = doc.createElement('style');
      s.id = id;
      s.textContent = css;
      (doc.head || doc.documentElement).appendChild(s);
    }

    // ---------------------------------------------------------------- 掛上／移除面板
    function viewerSrc(vid) { return opts.viewerUrl(vid); }
    function viewerOriginOk(origin) {
      if (!st.viewer) return false;
      try { if (origin === new URL(st.viewer.src).origin) return true; } catch (_) { /* ignore */ }
      return !!opts.extOrigin && origin === opts.extOrigin;
    }

    function mount(reason) {
      const { frame, iframe } = els();
      if (!frame || !iframe) return false;
      ensureStyle(STYLE_ID, panelCss());
      frame.classList.add('ytcas-frame');
      iframe.classList.add('ytcas-chatframe');
      if (!st.panel) {
        st.panel = doc.createElement('div');
        st.panel.id = PANEL_ID;
        st.viewer = doc.createElement('iframe');
        st.viewer.className = 'ytcas-viewer';
        st.viewer.setAttribute('title', '優化面板');
        st.viewer.setAttribute('allow', '');
        st.panel.appendChild(st.viewer);
      }
      if (st.viewerVid !== st.videoId) { st.ready = false; st.viewer.src = viewerSrc(st.videoId); st.viewerVid = st.videoId; }
      if (st.panel.parentElement !== frame || st.panel.nextElementSibling !== iframe) frame.insertBefore(st.panel, iframe);
      st.frame = frame; st.iframe = iframe;
      bindObservers();
      sizePanel();
      if (!st.mounted) { log('panel-open', { reason, layout: layoutInfo() }); requestInput(); }
      st.mounted = true;
      startVodTimer();
      startPopupWatch(); // v49（T6）
      return true;
    }

    function unmount(reason) {
      if (!st.mounted && !st.panel) return;
      if (st.panel) st.panel.remove();
      st.panel = null; st.viewer = null; st.viewerVid = null; st.ready = false;
      doc.querySelectorAll('.ytcas-frame').forEach((e) => e.classList.remove('ytcas-frame', 'ytcas-paused'));
      doc.querySelectorAll('.ytcas-chatframe').forEach((e) => { e.classList.remove('ytcas-chatframe'); e.style.removeProperty('--ytcas-clip'); });
      const s = doc.getElementById(STYLE_ID);
      if (s) s.remove();
      unbindObservers();
      stopVodTimer();
      stopPopupWatch(); // v49（T6）
      st.clip = null; st.inset = -1;
      if (st.mounted) log('panel-close', { reason });
      st.mounted = false; st.paused = false; st.pauseReason = null;
      st.frame = null; st.iframe = null;
    }

    function sizePanel() {
      if (!st.panel || !st.iframe) return;
      const h = iframeH(st.iframe);
      if (h > 0) st.panel.style.height = h + 'px';
    }

    function bindObservers() {
      if (st.ro && st.ro.__t === st.iframe) return;
      unbindObservers();
      if (win.ResizeObserver) {
        st.ro = new win.ResizeObserver(() => { sizePanel(); evaluate('resize'); });
        st.ro.observe(st.iframe);
        st.ro.__t = st.iframe;
      }
      // YouTube 重新渲染移除面板、替換 iframe 時重新插入（6.2 第 3 點）
      st.frameMo = new win.MutationObserver(() => evaluate('frame-mutation'));
      st.frameMo.observe(st.frame, { childList: true });
      st.iframe.addEventListener('load', onChatLoad);
    }
    function unbindObservers() {
      if (st.ro) { st.ro.disconnect(); st.ro = null; }
      if (st.frameMo) { st.frameMo.disconnect(); st.frameMo = null; }
      if (st.iframe) st.iframe.removeEventListener('load', onChatLoad);
    }
    // v49（T6，6.4）iframe 重新載入：舊的量測全部失效 → 面板全高，等新的 chat frame 回報（並主動要求一次）
    function onChatLoad() { log('chat-reload', {}); st.lastChatState = ''; st.input = null; evaluate('chat-load'); win.setTimeout(requestInput, 1000); }

    // ---------------------------------------------------------------- 狀態判斷（看門狗每秒＋各事件）
    function wanted() {
      return isVideoId(st.videoId) && st.dismissedFor !== st.videoId && chatOpen();
    }
    function collapseReason() {
      if (theater()) return 'theater';
      const { iframe } = els();
      if (iframeH(iframe) < P.COLLAPSE_MIN_H) return 'small';
      if (remainTooSmall(st.input, iframeH(iframe), P)) return 'small'; // v49（T6）面板剩餘高度 < 80px
      return null;
    }

    // ---------------------------------------------------------------- v49（T6，SPEC 6.3、6.4）頁面層付款視窗與 clip
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = win.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    // top.pagePopups（#buyFlowDivId 等）為主；ytd-popup-container 內的對話框為備援。不用萬用規則、不讀跨來源 iframe
    function topPopupOpen() {
      for (const sel of S.top.pagePopups) for (const el of doc.querySelectorAll(sel)) if (visible(el)) return true;
      const pc = doc.querySelector(S.top.popupContainer);
      if (pc) for (const sel of S.top.popups) for (const el of pc.querySelectorAll(sel)) if (visible(el)) return true;
      return false;
    }
    function checkTopPopup() {
      const v = topPopupOpen();
      if (v === st.topPopup) return;
      st.topPopup = v;
      log(v ? 'top-popup-open' : 'top-popup-close', {});
      applyClip('top-popup');
    }
    function startPopupWatch() {
      if (st.popTimer) return;
      st.popTimer = win.setInterval(checkTopPopup, P.TOP_POPUP_POLL_MS);
      if (doc.body) { st.bodyMo = new win.MutationObserver(checkTopPopup); st.bodyMo.observe(doc.body, { childList: true }); }
    }
    function stopPopupWatch() {
      if (st.popTimer) { win.clearInterval(st.popTimer); st.popTimer = 0; }
      if (st.bodyMo) { st.bodyMo.disconnect(); st.bodyMo = null; }
      st.topPopup = false;
    }
    // 依 CHAT_INPUT_STATE 與頁面層彈窗設定 iframe#chatframe 的 --ytcas-clip；面板底部留白告訴面板（PANEL_INSET）
    function applyClip(why) {
      if (!st.mounted || !st.iframe) return;
      const cs = clipState({ input: st.input, iframeH: iframeH(st.iframe), topPopupOpen: st.topPopup, prev: st.clip }, P);      if (!st.clip || st.clip.mode !== cs.mode) log('clip', { mode: cs.mode, held: !!cs.held, why: why || '' });
      st.clip = cs;
      if (st.iframe.style.getPropertyValue('--ytcas-clip') !== cs.clip) st.iframe.style.setProperty('--ytcas-clip', cs.clip);
      const inset = st.paused ? 0 : cs.pad;
      if (inset !== st.inset) { st.inset = inset; toViewer({ type: FM.PANEL_INSET, bottom: inset }); }
    }
    function requestInput() {
      const { iframe } = els();
      if (!iframe || !iframe.contentWindow) return;
      try { iframe.contentWindow.postMessage({ __ytcas: true, type: FM.CHAT_INPUT_REQUEST }, opts.ytOrigin); } catch (_) { /* ignore */ }
    }
    const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    function takeInput(d) {
      st.input = { vh: numOr(d.vh, 0), hasInput: !!d.hasInput, bottomZoneHeight: Math.max(0, numOr(d.bottomZoneHeight, 0)),
        popupOpen: !!d.popupOpen, popupTop: d.popupTop == null ? null : numOr(d.popupTop, null), src: typeof d.src === 'string' ? d.src.slice(0, 16) : '',
        inputH: Math.max(0, numOr(d.inputH, 0)), at: Date.now() };
      evaluate('chat-input');
    }
    function evaluate(why) {
      if (st.destroyed) return;
      const vid = opts.currentVideoId();
      if (vid !== st.videoId) {
        st.videoId = vid;
        st.dismissedFor = null; // 換影片：預設開啟（不記住）
        st.capture = null;
        if (st.mounted) log('video-change', {});
      }
      if (wanted()) {
        const { frame, iframe } = els();
        if (!st.mounted || st.iframe !== iframe || st.frame !== frame || !st.panel || st.panel.parentElement !== frame) {
          if (st.mounted && st.iframe && st.iframe !== iframe) log('reinit', { why });
          if (st.mounted && st.iframe !== iframe) unbindObservers();
          mount(why);
        } else if (st.viewerVid !== st.videoId) mount('video-change');
        const r = collapseReason();
        if (r !== st.pauseReason) {
          st.paused = !!r; st.pauseReason = r;
          if (st.frame) st.frame.classList.toggle('ytcas-paused', st.paused);
          log(st.paused ? 'panel-pause' : 'panel-resume', { reason: r, layout: layoutInfo() });
          toViewer({ type: FM.PANEL_STATE, paused: st.paused }); // v43：退讓中面板暫停補讀
        }
        sizePanel();
        applyClip(why); // v49（T6）
      } else if (st.mounted) unmount(why);
      renderEntries();
    }

    function layoutInfo() {
      const { iframe } = els();
      return { theater: theater(), singleColumn: !!doc.querySelector(S.top.layout.singleColumn), iframeH: iframeH(iframe) };
    }

    // ---------------------------------------------------------------- 開關
    function open(reason) {
      st.dismissedFor = null;
      if (!chatOpen()) return expandChatThenOpen();
      evaluate(reason || 'open');
      return true;
    }
    function close(reason) {
      st.dismissedFor = st.videoId;
      evaluate(reason || 'close');
    }
    function toggle(reason) {
      if (st.mounted) close(reason || 'toggle'); else open(reason || 'toggle');
    }
    // 聊天室已關閉（✕）：先按影片下方卡片的原生「開啟面板」展開聊天室，再開啟優化面板（F-09）
    function expandChatThenOpen() {
      const t = S.findChatTeaser(doc, C.OPEN_PANEL_LABELS);
      if (!t || t.button.disabled) { log('expand-failed', { teaser: !!t }); return false; }
      if (st.expanding) return true;
      st.expanding = true;
      t.button.click();
      const t0 = Date.now();
      const wait = win.setInterval(() => {
        if (chatOpen()) { win.clearInterval(wait); st.expanding = false; evaluate('expanded'); }
        else if (Date.now() - t0 > P.EXPAND_WAIT_MS) { win.clearInterval(wait); st.expanding = false; log('expand-timeout', {}); }
      }, 200);
      return true;
    }

    // ---------------------------------------------------------------- 開關錨點（F-09）
    function entryLabel() {
      if (!st.mounted) return '開啟優化面板';
      if (st.paused) return st.pauseReason === 'theater' ? '劇院模式下無法使用優化面板' : '聊天室太小，無法使用優化面板';
      return '關閉優化面板';
    }
    function entryButton(id, onClick) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = 'ytcas-entry';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
      return b;
    }
    function pageHasChat() {
      return !!(els().iframe || doc.querySelector(S.top.layout.chatPresent) || S.findChatTeaser(doc, C.OPEN_PANEL_LABELS));
    }
    function mountTeaser() {
      const t = isVideoId(st.videoId) ? S.findChatTeaser(doc, C.OPEN_PANEL_LABELS) : null;
      let b = doc.getElementById(TEASER_BTN_ID);
      if (!t) { if (b) b.remove(); st.anchors.teaser = false; return; }
      if (!b || b.previousElementSibling !== t.host) {
        if (b) b.remove();
        ensureStyle(BTN_STYLE_ID, btnCss());
        b = entryButton(TEASER_BTN_ID, () => { if (st.mounted && !st.paused) close('teaser'); else open('teaser'); });
        b.classList.add('ytcas-entry-teaser');
        t.host.after(b);
      }
      st.anchors.teaser = true;
    }
    function mountLegacy() {
      const host = doc.querySelector(S.top.showHideButton);
      const r = host && host.getBoundingClientRect();
      let b = doc.getElementById(LEGACY_BTN_ID);
      // 2026-11-15 實機：#show-hide-button 可能以隱藏狀態殘留 → 只有可見時才掛
      if (!host || r.width <= 0 || r.height <= 0) { if (b) b.remove(); st.anchors.legacy = false; return; }
      if (!b || b.parentElement !== host) {
        if (b) b.remove();
        ensureStyle(BTN_STYLE_ID, btnCss());
        host.classList.add('ytcas-legacy-host');
        b = entryButton(LEGACY_BTN_ID, () => toggle('legacy'));
        host.appendChild(b);
      }
      st.anchors.legacy = true;
    }
    function renderEntries() {
      if (!pageHasChat() || !isVideoId(st.videoId)) {
        for (const id of [TEASER_BTN_ID, LEGACY_BTN_ID]) { const b = doc.getElementById(id); if (b) b.remove(); }
        st.anchors.teaser = st.anchors.legacy = false;
      } else {
        mountTeaser();
        mountLegacy();
        const label = entryLabel();
        doc.querySelectorAll('.ytcas-entry').forEach((b) => {
          if (b.textContent !== label) b.textContent = label;
          b.classList.toggle('ytcas-on', st.mounted && !st.paused);
          b.classList.toggle('ytcas-paused', st.mounted && st.paused);
          b.setAttribute('aria-pressed', String(st.mounted));
        });
        checkAnchors();
      }
      postChatState();
    }
    function checkAnchors() {
      if (st.anchorWarned || Date.now() - st.pageStart < P.ANCHOR_GRACE_MS) return;
      const a = st.anchors;
      if (!a.header && !a.teaser && !a.legacy && opts.warnOnce) {
        st.anchorWarned = true;
        opts.warnOnce('panel:anchors', '此頁有聊天室，但找不到任何優化面板開關位置', 'warn');
      }
    }
    // 聊天室頂部列的按鈕在 chat frame 內：告訴它面板狀態（退讓時面板隱藏，頂部列是唯一看得到狀態的地方）
    function postChatState() {
      const { iframe } = els();
      if (!iframe || !iframe.contentWindow) return;
      const s = { on: st.mounted, paused: st.paused, reason: st.pauseReason };
      const key = JSON.stringify(s);
      if (key === st.lastChatState) return;
      st.lastChatState = key;
      try { iframe.contentWindow.postMessage(Object.assign({ __ytcas: true, type: FM.PANEL_STATE }, s), opts.ytOrigin); } catch (_) { /* ignore */ }
    }

    // ---------------------------------------------------------------- 面板 iframe 訊息
    // T5.1（審查十一 13.1 (A)）：web_accessible_resources 設了 use_dynamic_url，面板 iframe 的 src 是動態 ID 的網址，
    // 但面板文件的實際 origin 可能是擴充功能本身的 ID（實機：面板讀得到擴充功能的 IndexedDB、SEEK_TO 以擴充功能 ID 的
    // origin 通過檢查）。targetOrigin 不符時 postMessage 會被瀏覽器默默丟棄 → VOD_TIME 等全部收不到。
    // 兩個 origin 都送：不符的那個會被丟棄，面板只會收到一次
    function viewerTargets() {
      const out = [];
      try { const o = new URL(st.viewer.src).origin; if (o && o !== 'null') out.push(o); } catch (_) { /* ignore */ }
      if (opts.extOrigin && !out.includes(opts.extOrigin)) out.push(opts.extOrigin);
      return out;
    }
    function toViewer(msg) {
      if (!st.viewer || !st.viewer.contentWindow || !st.ready) return;
      const data = Object.assign({ __ytcas: true }, msg);
      for (const target of viewerTargets()) {
        try { st.viewer.contentWindow.postMessage(data, target); } catch (_) { /* ignore */ }
      }
    }
    function sendTheme(force) {
      const t = ytTheme();
      if (!force && t === st.lastTheme) return;
      st.lastTheme = t;
      toViewer({ type: FM.THEME, theme: t });
    }
    function clock() {
      const v = video();
      if (!v) return null;
      const info = (opts.streamInfo && opts.streamInfo()) || {};
      let seekStart = null, seekEnd = null;
      try { if (v.seekable && v.seekable.length) { seekStart = v.seekable.start(0); seekEnd = v.seekable.end(v.seekable.length - 1); } } catch (_) { /* ignore */ }
      const dur = Number.isFinite(v.duration) ? v.duration : null;
      const live = info.isLiveBroadcast === true && info.endDate == null;
      const head = live ? liveHead() : { liveHead: null, badge: 'n/a' };
      // v43（T5.2）：seeks＝video 的 seeked 事件累計次數（面板據此解除同步暫停）；liveHead／badge＝「直播」徽章的判定（待實機確認）
      // v50（T6.1，審查十一 30.4）anchorA：面板量到的牆上時間錨點（同一部影片），面板 iframe 重建後沿用
      const anchorA = live && st.liveAnchor && st.liveAnchor.videoId === st.videoId ? st.liveAnchor.wallA : null;
      return { currentTime: v.currentTime, paused: !!v.paused, duration: dur, seekStart, seekEnd, live, at: Date.now(),
        seeks: st.seeks || 0, liveHead: head.liveHead, badge: head.badge, urlT: live && urlHasT(), anchorA };
    }
    // v47（T5.6，審查十一 26.2）網址帶 t=／start=（查詢字串或 #t=）：面板的第一個錨點要等使用者點過「直播」或穩定 10 秒
    function urlHasT() {
      try {
        const u = new URL(win.location.href);
        return u.searchParams.has('t') || u.searchParams.has('start') || /(^|[#&])t=/.test(u.hash.slice(1));
      } catch (_) { return false; }
    }
    // 「直播」徽章：在最新時不可點（disabled 或 liveHeadClass）。找不到或沒顯示 → null（面板改用延遲基準判斷）
    function liveHead() {
      const b = doc.querySelector(S.top.liveBadge);
      if (!b) return { liveHead: null, badge: 'missing' };
      if (!b.getClientRects().length) return { liveHead: null, badge: 'hidden' };
      if (b.classList.contains(S.top.liveHeadClass)) return { liveHead: true, badge: 'class' };
      if (b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true') return { liveHead: true, badge: 'disabled' };
      return { liveHead: false, badge: 'behind' };
    }
    function sendVodTime(force) {
      if (!st.mounted || st.paused || !st.ready) return;
      const c = clock();
      if (!c) return;
      const key = [Math.round(c.currentTime * 4), c.paused, Math.round(c.seekEnd || 0), c.live, c.seeks, c.liveHead].join('|');
      if (!force && key === st.lastVod && c.paused) return; // 暫停中且沒有變化：不重送
      st.lastVod = key;
      toViewer(Object.assign({ type: FM.VOD_TIME }, c));
    }
    function startVodTimer() {
      if (st.vodTimer) return;
      st.vodTimer = win.setInterval(() => { bindVideo(); sendVodTime(false); }, P.VOD_TIME_MS);
    }
    function stopVodTimer() { if (st.vodTimer) { win.clearInterval(st.vodTimer); st.vodTimer = 0; } }
    const onSeeked = () => { st.seeks = (st.seeks || 0) + 1; sendVodTime(true); };
    function bindVideo() {
      const v = video();
      if (v === st.boundVideo) return;
      if (st.boundVideo) st.boundVideo.removeEventListener('seeked', onSeeked);
      st.boundVideo = v;
      if (v) v.addEventListener('seeked', onSeeked);
    }
    function seekTo(seconds) {
      const v = video();
      if (!v || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
      let t = Math.max(0, seconds);
      try {
        if (v.seekable && v.seekable.length) t = Math.min(Math.max(t, v.seekable.start(0)), v.seekable.end(v.seekable.length - 1));
        else if (Number.isFinite(v.duration)) t = Math.min(t, v.duration);
      } catch (_) { /* ignore */ }
      v.currentTime = t;
      log('seek', {});
    }

    function onMessage(e) {
      if (st.destroyed) return;
      const d = e.data;
      if (!d || d.__ytcas !== true) return;
      // 面板 iframe（擴充功能 origin）
      if (st.viewer && e.source === st.viewer.contentWindow) {
        if (!viewerOriginOk(e.origin)) return;
        if (d.type === FM.PANEL_READY) {
          st.ready = true;
          sendTheme(true);
          if (st.capture) toViewer(Object.assign({ type: FM.CAPTURE_STATUS }, st.capture));
          toViewer({ type: FM.PANEL_STATE, paused: st.paused });
          st.inset = -1; applyClip('panel-ready'); // v49：面板底部留白
          sendVodTime(true);
        } else if (d.type === FM.SEEK_TO) seekTo(d.seconds);
        else if (d.type === FM.LIVE_ANCHOR) {
          // v50（30.4）錨點存在 top：面板 iframe 因版面切換重建時不會遺失（null＝作廢）
          st.liveAnchor = typeof d.wallA === 'number' && Number.isFinite(d.wallA) && st.videoId ? { videoId: st.videoId, wallA: d.wallA } : null;
          log('live-anchor', { set: !!st.liveAnchor });
        }
        else if (d.type === FM.PANEL_CLOSE) close('panel-button');
        return;
      }
      // chat frame（youtube.com）
      const { iframe } = els();
      if (e.origin !== opts.ytOrigin || !iframe || e.source !== iframe.contentWindow) return;
      if (d.type === FM.CHAT_INPUT_STATE) takeInput(d); // v49（T6）
      else if (d.type === FM.TOGGLE_PANEL) { st.anchors.header = true; toggle('header'); }
      else if (d.type === FM.PANEL_STATE) { st.anchors.header = !!d.headerMounted; st.lastChatState = ''; postChatState(); }
      else if (d.type === FM.CAPTURE_STATUS) {
        if (d.headerMounted != null) st.anchors.header = !!d.headerMounted;
        st.capture = { videoId: d.videoId || null, capturing: !!d.capturing, reason: d.reason || null, f12: d.f12 || null, viewMode: d.viewMode || null };
        toViewer(Object.assign({ type: FM.CAPTURE_STATUS }, st.capture));
      }
    }

    // ---------------------------------------------------------------- 啟動與結束
    function start() {
      if (st.started) return api;
      st.started = true;
      win.addEventListener('message', onMessage);
      st.themeMo = new win.MutationObserver(() => sendTheme(false));
      st.themeMo.observe(doc.documentElement, { attributes: true, attributeFilter: ['dark'] });
      // #teaser-carousel 會隨導航重建（F-09）：監看 ytd-watch-metadata；flexy 屬性變化（劇院模式）
      const watchMeta = () => {
        const m = doc.querySelector(S.top.chatTeaser.metadata);
        if (m && (!st.metaMo || st.metaMo.__t !== m)) {
          if (st.metaMo) st.metaMo.disconnect();
          let pend = 0;
          st.metaMo = new win.MutationObserver(() => { if (!pend) pend = win.setTimeout(() => { pend = 0; renderEntries(); }, 100); });
          st.metaMo.observe(m, { childList: true, subtree: true });
          st.metaMo.__t = m;
        }
      };
      st.watchdog = win.setInterval(() => { watchMeta(); evaluate('watchdog'); }, 1000);
      doc.addEventListener('yt-navigate-finish', () => { st.pageStart = Date.now(); st.anchorWarned = false; watchMeta(); evaluate('navigate'); });
      watchMeta();
      evaluate('start');
      return api;
    }
    function destroy() {
      st.destroyed = true;
      win.removeEventListener('message', onMessage);
      if (st.themeMo) st.themeMo.disconnect();
      if (st.metaMo) st.metaMo.disconnect();
      if (st.watchdog) win.clearInterval(st.watchdog);
      unmount('destroy');
      for (const id of [TEASER_BTN_ID, LEGACY_BTN_ID, BTN_STYLE_ID]) { const b = doc.getElementById(id); if (b) b.remove(); }
      if (st.boundVideo) st.boundVideo.removeEventListener('seeked', onSeeked);
    }

    const api = {
      start, destroy, open, close, toggle, evaluate,
      state: () => ({ mounted: st.mounted, paused: st.paused, pauseReason: st.pauseReason, videoId: st.videoId, dismissedFor: st.dismissedFor,
        ready: st.ready, anchors: Object.assign({}, st.anchors), capture: st.capture,
        clip: st.clip ? Object.assign({}, st.clip) : null, input: st.input ? Object.assign({}, st.input) : null, topPopup: st.topPopup, inset: st.inset,
        liveAnchor: st.liveAnchor ? Object.assign({}, st.liveAnchor) : null }),
      _clock: clock, _onMessage: onMessage,
    };
    return api;
  }

  root.YTCAS_PANEL = { create, PANEL_ID, clipState, remainTooSmall };
})(typeof globalThis !== 'undefined' ? globalThis : self);
