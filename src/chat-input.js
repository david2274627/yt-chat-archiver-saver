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

  // v54（35.1）投票卡選擇器（空字串＝不啟用）
  const pollSels = (S) => [S.chat.pollBanner, S.chat.pollCard].filter((x) => typeof x === 'string' && x);

  // 純量測（測試頁直接呼叫）。回傳 { vh, hasInput, bottomZoneHeight, src, inputH, popupOpen, popupTop, overlayIgnored }
  function measure(doc, win, S, C) {
    const P = C.PANEL;
    const vh = win.innerHeight;
    const rootEl = doc.querySelector(S.chat.renderer) || doc.body;
    const out = { vh, hasInput: false, bottomZoneHeight: 0, src: 'none', inputH: 0, popupOpen: false, popupTop: null, overlayIgnored: false, purchase: false };
    if (!rootEl) return out;
    const input = doc.querySelector(S.chat.inputPanel);
    const ir = visibleRect(input, win);
    out.inputH = ir ? Math.round(ir.height) : 0;
    // 1. 白名單
    let wlTop = null;
    // v53（34 第 3 點）／v54（35.1）投票卡也算進底部互動區：置頂列裡含投票的橫幅（S.chat.pollBanner，含收合時的外框）與投票卡本身
    for (const sel of S.chat.bottomZone.concat(pollSels(S))) {
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
    // v50（T6.1，審查十一 30.3）`$` 相關（#panel-pages、`$` 選單、購買流程）任一可見 → 也算底部互動區，且一定「有互動區」：
    // 實機點 `$` 後 #input-panel 不可見 → v49 判成沒有輸入區、面板全高，`$` 流程整個被蓋住
    let iz = false;
    for (const sel of S.chat.interactiveZone) {
      rootEl.querySelectorAll(sel).forEach((el) => {
        const r = visibleRect(el, win);
        if (!r || r.height < P.ZONE_MIN_PX || r.top >= vh) return;
        iz = true;
        zone = Math.max(zone || 0, vh - r.top);
        if (out.src === 'none') out.src = 'zone';
      });
    }
    out.bottomZoneHeight = Math.round(Math.max(0, Math.min(vh, zone || 0)));
    // `$` 流程進行中（`$` 選單或購買流程可見，或 #input-panel 不見了而 #panel-pages 還在）：剩餘高度不足時也不退讓（panel.js）
    out.purchase = iz && (!ir || [S.chat.productPicker, S.chat.buyFlowInChat].some((sel) => Array.from(rootEl.querySelectorAll(sel)).some((el) => { const r = visibleRect(el, win); return !!r && r.height >= P.ZONE_MIN_PX; })));
    // 輸入區存在且有高度（VOD 重播：#input-panel 高度 0、#panel-pages 1px → 沒有輸入區，面板全高）
    out.hasInput = (!!ir || iz) && out.bottomZoneHeight > 0;
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

  // v50（T6.1，審查十一 30.1、30.3）F-20 P7 zone-structure：底部互動區相關元素（只有標籤、靜態 id、可見與否、高度、頂端；不含文字）。
  // 用來實機確認：點 `$` 後 #input-panel／#panel-pages 的變化、表符選單與輸入列的上下關係
  const SAFE_ID = /^[a-z][\w-]{0,40}$/i;
  function zoneStructure(doc, win, S) {
    const rootEl = doc.querySelector(S.chat.renderer) || doc.body;
    const out = [];
    if (!rootEl) return out;
    const Z = S.chat.zoneStructure;
    const add = (el, role) => {
      if (!el || out.length >= 30) return;
      const r = el.getBoundingClientRect();
      out.push({ role, t: el.tagName.toLowerCase() + (el.id && SAFE_ID.test(el.id) ? '#' + el.id : ''), v: !!visibleRect(el, win), h: Math.round(r.height), top: Math.round(r.top) });
    };
    // v51（T6.2，審查十一 32.1）role 只用 background 消毒規則接受的字元（v50 的 'panel-pages>' 含「>」被換成 [removed]）
    const pp = rootEl.querySelector(S.chat.panelPages);
    add(pp, 'panel-pages');
    if (pp) for (const c of pp.children) add(c, 'panel-pages-child');
    add(rootEl.querySelector(S.chat.inputPanel), 'input-panel');
    add(rootEl.querySelector(Z.inputRow), 'input-row');
    const pk = rootEl.querySelector(Z.pickers);
    if (pk) for (const c of pk.children) add(c, 'pickers-child');
    doc.querySelectorAll(S.chat.emojiPicker).forEach((el) => add(el, 'emoji'));
    doc.querySelectorAll(S.chat.buyFlowInChat).forEach((el) => add(el, 'buy-flow'));
    add(rootEl.querySelector(S.chat.bannerContainer), 'banner');
    if (S.chat.pollBanner) rootEl.querySelectorAll(S.chat.pollBanner).forEach((el) => add(el, 'poll-banner')); // v54（35.1）
    const ap = rootEl.querySelector(Z.actionPanel);
    add(ap, 'action-panel');
    // v51（32.6）投票卡：#action-panel 內的元件標籤（兩層，只有標籤與尺寸）
    if (ap) for (const c of ap.children) { add(c, 'action-panel-child'); for (const g of c.children) add(g, 'action-panel-grandchild'); }
    return out;
  }

  // opts: { doc, win, S, C, post(type, payload), onLog?(reason, data) }
  function create(opts) {
    const doc = opts.doc || document;
    const win = opts.win || window;
    const S = opts.S, C = opts.C, P = C.PANEL, FM = C.FM;
    const st = { started: false, last: '', timer: 0, poll: 0, ro: null, observed: [], hide: false, sent: 0, warnedOverlay: false,
      zoneActive: false, zoneSig: '', zoneLogs: 0 };

    // v50（30.1、30.3）`$` 流程或彈窗開著（以及剛關上的那一次）且結構改變時記一筆（每頁最多 ZONE_LOG_MAX 筆）
    function logZone(m) {
      // v51（32.6）投票卡（#action-panel）出現也記（實際元件標籤待記錄）
      const apVis = !!visibleRect(doc.querySelector(S.chat.zoneStructure.actionPanel), win);
      // v54（35.1）置頂列裡的投票橫幅露出（收合／展開時高度改變也記）
      const pollVis = !!S.chat.pollBanner && Array.from(doc.querySelectorAll(S.chat.pollBanner)).some((el) => !!visibleRect(el, win));
      const active = m.purchase || m.popupOpen || apVis || pollVis;
      if (opts.onLog && (active || st.zoneActive) && st.zoneLogs < P.ZONE_LOG_MAX) {
        const els = zoneStructure(doc, win, S);
        const sig = JSON.stringify([m.purchase, m.popupOpen, apVis, pollVis, els.map((x) => [x.t, x.v, x.h, x.top])]);
        if (sig !== st.zoneSig) {
          st.zoneSig = sig;
          st.zoneLogs++;
          try { opts.onLog('zone-structure', { reason: m.purchase ? 'purchase' : m.popupOpen ? 'popup' : apVis ? 'action-panel' : pollVis ? 'poll-banner' : 'closed',
            m: { vh: m.vh, hasInput: m.hasInput, bottomZoneHeight: m.bottomZoneHeight, src: m.src, popupOpen: m.popupOpen, popupTop: m.popupTop, purchase: m.purchase }, els }); } catch (_) { /* ignore */ }
        }
      }
      st.zoneActive = active;
    }

    function send(force) {
      const m = measure(doc, win, S, C);
      logZone(m);
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
      // v54（35.1）投票橫幅收合（約 40px）／展開：直接監看含投票的 banner-renderer，高度一變就重新量測、更新裁切
      for (const sel of pollSels(S)) doc.querySelectorAll(sel).forEach((el) => want.push(el));
      const same = want.length === st.observed.length && want.every((el, i) => el === st.observed[i]);
      if (same) return;
      if (st.ro) st.ro.disconnect();
      st.ro = new win.ResizeObserver(() => schedule(false));
      for (const el of want) st.ro.observe(el);
      st.observed = want;
    }
    // 6.2 第 2 點：面板開啟且未退讓 → 隱藏原生訊息列表與頂部列（visibility，不改 height／display）。
    // v50（T6.1，審查十一 30.2，使用者選 A）原生置頂列也隱藏：置頂只用面板的置頂卡（F-07，可展開看完整內容），
    // 原生置頂列不可見 → 不算進底部互動區，面板多出約 50～100px。投票卡（#action-panel）照樣露出。
    // 擷取端讀置頂列的 DOM 不受 visibility 影響（F-07 照常收錄）
    function setHidden(on) {
      if (on === st.hide) return;
      st.hide = on;
      let s = doc.getElementById(HIDE_STYLE_ID);
      if (on && !s) {
        s = doc.createElement('style');
        s.id = HIDE_STYLE_ID;
        s.textContent = [S.chat.itemList, S.chat.header, S.chat.bannerContainer].join(', ') + ' { visibility: hidden !important; }'
          // v54（35.1）投票卡在置頂列裡：置頂列整體隱藏，含投票的那個橫幅露出（visibility 子元素可覆蓋；:has，Chrome 105+）。
          // 同一層的置頂訊息、降落橫幅維持隱藏。選擇器留空＝不啟用
          + pollSels(S).map((sel) => '\n' + sel + ' { visibility: visible !important; }').join('');
        (doc.head || doc.documentElement).appendChild(s);
      } else if (!on && s) s.remove();
      if (st.started) schedule(false); // 置頂列顯示與否會改變底部互動區（stop 之後不再回報）
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

  // v52（T6.3，審查十一 33.8.4）F-20 P7 poll-structure：投票卡在本套件環境下被裁切（無痕視窗正常），P7 沒有 #action-panel 的記錄
  // → 投票卡不在 #chat > #action-panel。記錄聊天室文件中**任何**標籤或 id 含 poll／action-panel 的元素：
  // 祖先鏈（標籤＋靜態 id，到 yt-live-chat-app）、位置高度、computed visibility／overflow／max-height／clip-path、
  // 祖先是否有本套件的屬性或被本套件的隱藏樣式涵蓋（#item-list、頂部列、置頂列）。不記文字。
  // 只在診斷記錄 P7 時運作（opts.active()）：每 3 秒找一次，找到的以 ResizeObserver 監看大小；每頁最多 20 筆
  const POLL_RE = /poll|action-panel/i;
  function pollStructure(el, win, S) {
    const r = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    const hidSel = [S.chat.itemList, S.chat.header, S.chat.bannerContainer].join(', ');
    const chain = [];
    for (let p = el; p && chain.length < 16; p = p.parentElement) {
      const c = win.getComputedStyle(p);
      chain.push({ t: p.tagName.toLowerCase() + (p.id && SAFE_ID.test(p.id) ? '#' + p.id : ''), vis: c.visibility, ov: c.overflow, mh: c.maxHeight, cp: c.clipPath !== 'none',
        h: Math.round(p.getBoundingClientRect().height), ytcas: p.getAttributeNames().some((a) => a.startsWith('data-ytcas')) });
      if (p.tagName.toLowerCase() === S.chat.app) break;
    }
    return { t: el.tagName.toLowerCase() + (el.id && SAFE_ID.test(el.id) ? '#' + el.id : ''), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
      vis: cs.visibility, ov: cs.overflow, mh: cs.maxHeight, cp: cs.clipPath !== 'none', kids: el.children.length,
      underHidden: !!el.closest(hidSel), inItems: !!el.closest(S.chat.items), chain };
  }
  function watchPolls(opts) {
    const doc = opts.doc || document, win = opts.win || window, S = opts.S;
    const seen = new WeakMap();
    let logs = 0, timer = 0, ro = null;
    const log = (el, why) => {
      if (logs >= 20 || !opts.active()) return;
      const d = pollStructure(el, win, S);
      const sig = JSON.stringify([d.top, d.h, d.vis, d.underHidden]);
      if (seen.get(el) === sig) return;
      seen.set(el, sig);
      logs++;
      try { opts.onLog('poll-structure', Object.assign({ why }, d)); } catch (_) { /* ignore */ }
    };
    const scan = () => {
      if (!opts.active() || logs >= 20) return;
      for (const el of doc.querySelectorAll('*')) {
        if (!POLL_RE.test(el.tagName) && !(el.id && POLL_RE.test(el.id))) continue;
        if (!seen.has(el)) {
          log(el, 'found');
          if (win.ResizeObserver) { if (!ro) ro = new win.ResizeObserver((ents) => ents.forEach((e) => log(e.target, 'resize'))); ro.observe(el); }
        }
      }
    };
    timer = win.setInterval(scan, 3000);
    scan();
    return { stop() { win.clearInterval(timer); if (ro) ro.disconnect(); }, scan, pollStructure: (el) => pollStructure(el, win, S) };
  }

  root.YTCAS_CHAT_INPUT = { create, measure, zoneStructure, watchPolls, HIDE_STYLE_ID };
})(typeof globalThis !== 'undefined' ? globalThis : self);
