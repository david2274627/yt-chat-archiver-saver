// F-10 chat frame 端（T6，SPEC 6.2 第 2 點、6.3）：底部互動區量測、彈窗偵測、回報 CHAT_INPUT_STATE；
// 面板開啟（且未退讓）時以 visibility: hidden 隱藏原生訊息列表與頂部列。
// - 量測沿用 T1 PoC 的 v3.1 白名單算法（poc-chat.js）：iframe 底邊 − 可見白名單元素／覆蓋層可見子元素的最高頂端；
//   覆蓋層（非白名單）結果 > iframe 高度 × 0.6 → 不採計；白名單不套用 60% 規則；都量不到 → #input-panel 頂端；仍沒有 → 0。
// - 只回報尺寸與布林值，不讀任何文字。不改 yt-live-chat-app／#contents／#chat-messages 的 height／display（6.1 的教訓）。
// - 狀態有變化才送（同一狀態 debounce 合併）；觸發：ResizeObserver（候選元素與其父層、文件本身）、點擊與按鍵後、500ms 保底輪詢。
(function (root) {
  'use strict';

  const HIDE_STYLE_ID = 'ytcas-chat-hide';

  function visibleRect(el, win) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    return r;
  }
  // 覆蓋層內「可見的區塊」：由上往下找第一層有尺寸的子孫（找到就不再往下），容器本身不計
  function overlayChunks(overlay, win) {
    const out = [];
    const walk = (el, depth) => {
      for (const c of el.children) {
        const r = visibleRect(c, win);
        if (r) out.push(r);
        else if (depth < 6) walk(c, depth + 1);
      }
    };
    walk(overlay, 0);
    return out;
  }

  // 純量測（測試頁直接呼叫）。回傳 { vh, hasInput, bottomZoneHeight, src, inputH, popupOpen, popupTop, overlayIgnored }
  function measure(doc, win, S, C) {
    const P = C.PANEL;
    const vh = win.innerHeight;
    const rootEl = doc.querySelector(S.chat.renderer) || doc.body;
    const out = { vh, hasInput: false, bottomZoneHeight: 0, src: 'none', inputH: 0, popupOpen: false, popupTop: null, overlayIgnored: false };
    if (!rootEl) return out;
    const input = doc.querySelector(S.chat.inputPanel);
    const ir = visibleRect(input, win);
    out.inputH = ir ? Math.round(ir.height) : 0;
    // 1. 白名單
    let wlTop = null;
    for (const sel of S.chat.bottomZone) {
      rootEl.querySelectorAll(sel).forEach((el) => {
        const r = visibleRect(el, win);
        if (r && r.top < vh) wlTop = wlTop == null ? r.top : Math.min(wlTop, r.top);
      });
    }
    // 2. 覆蓋層的可見子元素
    let ovTop = null;
    const overlay = rootEl.querySelector(S.chat.bottomZoneOverlay);
    if (overlay) for (const r of overlayChunks(overlay, win)) if (r.top < vh) ovTop = ovTop == null ? r.top : Math.min(ovTop, r.top);
    const wl = wlTop == null ? null : vh - wlTop;
    let ov = ovTop == null ? null : vh - ovTop;
    if (ov != null && ov > vh * P.OVERLAY_MAX_RATIO) { ov = null; out.overlayIgnored = true; }
    let zone = null;
    if (wl != null || ov != null) { zone = Math.max(wl || 0, ov || 0); out.src = ov != null && ov > (wl || 0) ? 'overlay' : 'whitelist'; }
    else if (ir) { zone = vh - ir.top; out.src = 'fallback'; }
    out.bottomZoneHeight = Math.round(Math.max(0, Math.min(vh, zone || 0)));
    // 輸入區存在且有高度（VOD 重播：#input-panel 高度 0 → 沒有輸入區，面板全高）
    out.hasInput = !!ir && out.bottomZoneHeight > 0;
    // 3. 彈窗（S.chat.popups）：表符選單、購買流程、下拉選單、對話框。
    //    $ 選單（productPicker）長在 #input-panel 內，展開時 #input-panel 本身變高、已涵蓋在 bottomZoneHeight → 不列為彈窗
    //    （關閉時元素可能仍「可見」，SPEC 6.3）。頂部列內的下拉選單（F-12 自動切換時會短暫展開）不算
    const header = doc.querySelector(S.chat.header);
    let top = null;
    for (const sel of S.chat.popups) {
      if (sel === S.chat.productPicker) continue;
      doc.querySelectorAll(sel).forEach((el) => {
        if (header && header.contains(el)) return;
        const r = visibleRect(el, win);
        if (r && r.bottom > 0 && r.top < vh) top = top == null ? r.top : Math.min(top, r.top);
      });
    }
    if (top != null) { out.popupOpen = true; out.popupTop = Math.max(0, Math.round(top)); }
    return out;
  }

  // opts: { doc, win, S, C, post(type, payload), onLog?(reason, data) }
  function create(opts) {
    const doc = opts.doc || document;
    const win = opts.win || window;
    const S = opts.S, C = opts.C, P = C.PANEL, FM = C.FM;
    const st = { started: false, last: '', timer: 0, poll: 0, ro: null, observed: [], hide: false, sent: 0, warnedOverlay: false };

    function send(force) {
      const m = measure(doc, win, S, C);
      if (m.overlayIgnored && !st.warnedOverlay) {
        st.warnedOverlay = true;
        try { console.info('[ytcas] 底部互動區：覆蓋層子元素量出的高度超過 iframe 的 60%，不採計（只記一次）'); } catch (_) { /* ignore */ }
      }
      const key = JSON.stringify(m);
      if (!force && key === st.last) return;
      st.last = key;
      st.sent++;
      opts.post(FM.CHAT_INPUT_STATE, m);
    }
    function schedule(force) {
      if (st.timer) win.clearTimeout(st.timer);
      st.timer = win.setTimeout(() => { st.timer = 0; send(force); }, P.INPUT_DEBOUNCE_MS);
    }
    // 候選元素出現或被重建時重新監看（ResizeObserver 只看得到已綁定的元素）
    function bind() {
      if (!win.ResizeObserver) return;
      const want = [doc.documentElement];
      for (const sel of S.chat.bottomZone) doc.querySelectorAll(sel).forEach((el) => { want.push(el); if (el.parentElement) want.push(el.parentElement); });
      const same = want.length === st.observed.length && want.every((el, i) => el === st.observed[i]);
      if (same) return;
      if (st.ro) st.ro.disconnect();
      st.ro = new win.ResizeObserver(() => schedule(false));
      for (const el of want) st.ro.observe(el);
      st.observed = want;
    }
    // 6.2 第 2 點：面板開啟且未退讓 → 隱藏原生訊息列表與頂部列（visibility，不改 height／display）
    function setHidden(on) {
      if (on === st.hide) return;
      st.hide = on;
      let s = doc.getElementById(HIDE_STYLE_ID);
      if (on && !s) {
        s = doc.createElement('style');
        s.id = HIDE_STYLE_ID;
        s.textContent = S.chat.itemList + ', ' + S.chat.header + ' { visibility: hidden !important; }';
        (doc.head || doc.documentElement).appendChild(s);
      } else if (!on && s) s.remove();
    }
    const onUser = () => { schedule(false); win.setTimeout(() => schedule(false), 300); };
    const onResize = () => schedule(false);
    function onMessage(e) {
      if (!opts.accept(e)) return;
      const d = e.data;
      if (d.type === FM.CHAT_INPUT_REQUEST) send(true);
      else if (d.type === FM.PANEL_STATE && typeof d.on === 'boolean') setHidden(!!d.on && !d.paused);
    }
    function start() {
      if (st.started) return api;
      st.started = true;
      win.addEventListener('message', onMessage);
      win.addEventListener('resize', onResize);
      doc.addEventListener('click', onUser, true);
      doc.addEventListener('keyup', onUser, true);
      st.poll = win.setInterval(() => { bind(); send(false); }, P.INPUT_POLL_MS);
      bind();
      send(true);
      return api;
    }
    function stop() {
      if (!st.started) return;
      st.started = false;
      win.removeEventListener('message', onMessage);
      win.removeEventListener('resize', onResize);
      doc.removeEventListener('click', onUser, true);
      doc.removeEventListener('keyup', onUser, true);
      if (st.poll) win.clearInterval(st.poll);
      if (st.timer) win.clearTimeout(st.timer);
      if (st.ro) st.ro.disconnect();
      setHidden(false);
    }
    const api = { start, stop, send, state: () => ({ hidden: st.hide, sent: st.sent, last: st.last ? JSON.parse(st.last) : null }) };
    return api;
  }

  root.YTCAS_CHAT_INPUT = { create, measure, HIDE_STYLE_ID };
})(typeof globalThis !== 'undefined' ? globalThis : self);
