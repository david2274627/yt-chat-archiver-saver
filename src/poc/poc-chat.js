// T1 PoC：chat frame 端（只在 live_chat / live_chat_replay iframe 執行；T9 移除）
// 1. 量測 #input-panel，透過 postMessage 回報給 top frame（只回報尺寸與標籤名稱，不含任何文字內容）。
// 2. v24：在聊天室頂部列（⋮ 左側）注入「PoC 測試」按鈕（F-09 錨點 1），點擊後送 TOGGLE_PANEL 給 top frame。
// 3. v24.1：底部互動區量測 v3（白名單）；⋮ 改為 #live-chat-header-context-menu（v24 誤插進 #view-selector）。
(function () {
  'use strict';
  if (window === window.top) return;
  const S = globalThis.YTCAS_SEL;
  const C = globalThis.YTCAS_CONST;
  if (!S || !C) return;
  const YT = C.YT_ORIGIN;
  const HDR_BTN_ID = 'ytcas-poc-header-btn';
  const STYLE_ID = 'ytcas-poc-chat-style';

  let ro = null;
  let observed = null;
  let last = '';
  let lastAnchor = '';
  let label = 'PoC 測試'; // 由 top frame 的 POC_STATE 更新

  const post = (type, payload) => window.top.postMessage(Object.assign({ __ytcas: true, type }, payload || {}), YT);
  const tagId = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;

  // ---------------- 量測 ----------------
  function parentChain(el) {
    const out = [];
    for (let p = el.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) out.push(tagId(p));
    return out.join(' < ');
  }

  // 量測 v3（review-2026-11-15 §3.1）：只計白名單（chat.bottomZone）與覆蓋層（chat.bottomZoneOverlay）的「可見子元素」。
  // v2 的「底部 400px 內任何元素」會把蓋在訊息列表上的全高覆蓋層 ytls-widget-overlay-manager 算進去（實機算出 545px）。
  // 診斷清單另外列出底部 400px 內所有候選與其處理方式（use），只輸出標籤、id、位置與高度，不輸出任何文字。
  const ZONE_RANGE_PX = 400;
  const ZONE_MAX = 40;

  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    return r;
  }

  // 覆蓋層內「可見的區塊」：由上往下找第一層有尺寸的子孫（找到就不再往下），容器本身不計
  function overlayChunks(overlay) {
    const out = [];
    const walk = (el, depth) => {
      for (const c of el.children) {
        const r = visibleRect(c);
        if (r) out.push({ el: c, r });
        else if (depth < 6) walk(c, depth + 1);
      }
    };
    walk(overlay, 0);
    return out;
  }

  function bottomZone() {
    const root = document.querySelector(S.chat.renderer);
    const vh = window.innerHeight;
    if (!root) { S.warnOnce('poc:chat.renderer', S.chat.renderer); return { list: [], wlTop: null, ovTop: null }; }
    const list = [];
    const add = (el, r, use) => {
      if (list.length < ZONE_MAX) list.push({ el: tagId(el), top: Math.round(r.top), h: Math.round(r.height), parents: parentChain(el), use });
    };
    // 白名單與覆蓋層分開統計：合理性檢查對兩者的規則不同（review-2026-11-15-2 §3.1）
    let wlTop = null;
    let ovTop = null;
    const lower = (cur, r) => { const t = Math.round(r.top); return cur == null || t < cur ? t : cur; };

    // 1. 白名單
    const counted = new Set();
    for (const sel of S.chat.bottomZone) {
      root.querySelectorAll(sel).forEach((el) => {
        const r = visibleRect(el);
        if (!r) return;
        counted.add(el);
        wlTop = lower(wlTop, r);
        add(el, r, '計入：白名單 ' + sel);
      });
    }
    // 2. 覆蓋層：只計可見子元素（例如投票卡）
    const overlay = root.querySelector(S.chat.bottomZoneOverlay);
    if (overlay) {
      const or = overlay.getBoundingClientRect();
      if (or.height > 0) add(overlay, or, '排除：覆蓋層容器本身');
      for (const { el, r } of overlayChunks(overlay)) {
        counted.add(el);
        ovTop = lower(ovTop, r);
        add(el, r, '計入：覆蓋層子元素');
      }
    }
    // 3. 診斷用：底部 400px 內其他候選（不計入），排除清單標示原因；不進入已計入或已排除的子樹
    const excluded = new Map();
    S.chat.bottomZoneExclude.forEach((sel) => root.querySelectorAll(sel).forEach((el) => excluded.set(el, sel)));
    const walk = (el) => {
      for (const c of el.children) {
        if (counted.has(c) || c === overlay || (c.id && c.id.startsWith('ytcas-'))) continue;
        const r = c.getBoundingClientRect();
        const inZone = r.width > 0 && r.height > 0 && r.bottom > vh - ZONE_RANGE_PX && r.top < vh;
        if (excluded.has(c)) { if (inZone) add(c, r, '排除：' + excluded.get(c)); continue; }
        const isAncestor = Array.from(counted).some((k) => c.contains(k)) || (overlay && c.contains(overlay));
        if (inZone && !isAncestor && visibleRect(c)) { add(c, r, '未列入'); continue; }
        walk(c);
      }
    };
    walk(root);
    return { list, wlTop, ovTop };
  }

  function measure() {
    const panel = document.querySelector(S.chat.inputPanel);
    const vh = window.innerHeight;
    let msg;
    if (!panel || panel.getBoundingClientRect().height <= 0) {
      msg = { found: false };
    } else {
      const r = panel.getBoundingClientRect();
      const rows = Array.from(panel.querySelectorAll(':scope > *, :scope > * > *'))
        .map((el) => ({ el, h: Math.round(el.getBoundingClientRect().height) }))
        .filter((x) => x.h > 0)
        .slice(0, 12)
        .map((x) => `${tagId(x.el)}:${x.h}`);
      msg = {
        found: true,
        height: Math.round(r.height),            // #input-panel 本身高度（舊算法）
        fromBottom: Math.round(vh - r.top),      // #input-panel 頂端到 iframe 底邊（舊算法）
        rows,                                     // 子元素標籤與高度（不含文字）
      };
    }
    const z = bottomZone();
    msg.vh = vh;
    msg.zone = z.list;
    // 量測 v3：iframe 底邊 − 最高者的頂端；白名單與覆蓋層子元素分開回報，由 top frame 做合理性檢查
    msg.wlFromBottom = z.wlTop == null ? null : vh - z.wlTop;
    msg.ovFromBottom = z.ovTop == null ? null : vh - z.ovTop;
    const all = [msg.wlFromBottom, msg.ovFromBottom].filter((v) => v != null);
    msg.zoneFromBottom = all.length ? Math.max(...all) : null;
    msg.algo = 'v3.1';
    const key = JSON.stringify(msg);
    if (key === last) return;
    last = key;
    post('POC_INPUT', msg);
  }

  function attach() {
    const panel = document.querySelector(S.chat.inputPanel);
    if (panel !== observed) {
      ro?.disconnect();
      observed = panel;
      if (panel) {
        ro = new ResizeObserver(measure);
        ro.observe(panel);
        // 置頂訊息列、投票卡等出現或消失時，輸入區位置不一定改變：監看 #input-panel 的父容器
        if (panel.parentElement) ro.observe(panel.parentElement);
      }
    }
    measure();
    mountHeaderButton();
  }

  // ---------------- 頂部列開關（F-09 錨點 1） ----------------
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    // 只作用於 ytcas- 前綴元素，不改原生頂部列
    st.textContent = `
      #${HDR_BTN_ID} { flex: none; align-self: center; margin: 0 4px; padding: 4px 10px; border: 0; border-radius: 999px;
        background: #3b5bdb; color: #fff; font: 600 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
      #${HDR_BTN_ID}:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }`;
    (document.head || document.documentElement).appendChild(st);
  }

  function reportAnchor(info) {
    const key = JSON.stringify(info);
    if (key === lastAnchor) return;
    lastAnchor = key;
    post('POC_ANCHOR', info);
  }

  function mountHeaderButton() {
    const header = document.querySelector(S.chat.header);
    if (!header) {
      S.warnOnce('poc:chat.header', S.chat.header);
      reportAnchor({ header: false, how: 'no-header' });
      return;
    }
    const kids = Array.from(header.querySelectorAll(':scope > *, :scope > * > *'))
      .filter((el) => !el.id.startsWith('ytcas-')).slice(0, 16).map(tagId); // 只取標籤與 id，不含文字
    const btnParent = document.getElementById(HDR_BTN_ID)?.parentElement;
    let btn = document.getElementById(HDR_BTN_ID);
    let overflow = null;
    let matched = '';
    for (const sel of S.chat.headerOverflow) { overflow = document.querySelector(sel); if (overflow && header.contains(overflow)) { matched = sel; break; } overflow = null; }
    // 回報實際命中的選擇器（v24 一律回報 before-overflow，看不出是哪個候選）
    const how = overflow ? '插在 ' + tagId(overflow) + ' 前（' + matched + '）' : '附加在頂部列末端（找不到 ⋮）';
    if (btn && header.contains(btn) && (overflow ? btn.nextElementSibling === overflow : btnParent === header)) {
      reportAnchor({ header: true, how, kids, parent: tagId(btn.parentElement) });
      return;
    }
    ensureStyle();
    if (!btn) {
      btn = document.createElement('button');
      btn.id = HDR_BTN_ID;
      btn.type = 'button';
      btn.textContent = label;
      btn.title = '開啟 PoC 測試面板（Alt+Shift+P）';
      btn.setAttribute('aria-label', '開啟 PoC 測試面板');
      btn.addEventListener('click', (e) => { e.stopPropagation(); post(C.FM.TOGGLE_PANEL); });
    }
    if (overflow) overflow.parentElement.insertBefore(btn, overflow);
    else {
      S.warnOnce('poc:chat.headerOverflow', S.chat.headerOverflow);
      header.appendChild(btn);
    }
    reportAnchor({ header: true, how, kids, parent: tagId(btn.parentElement) });
  }

  // top frame 開啟 PoC 時會要求重送一次
  window.addEventListener('message', (e) => {
    if (e.origin !== YT || e.source !== window.top) return;
    if (!e.data || e.data.__ytcas !== true) return;
    if (e.data.type === 'POC_INPUT_REQUEST') { last = ''; lastAnchor = ''; attach(); }
    if (e.data.type === 'POC_STATE') {
      const btn = document.getElementById(HDR_BTN_ID);
      if (typeof e.data.label === 'string') label = e.data.label.slice(0, 30);
      if (btn) btn.textContent = label;
    }
  });
  // 焦點在聊天室內時，PoC 快速鍵（Alt+Shift+P/U/D/M/↑/↓）轉送給 top frame
  const POC_KEYS = new Set(['KeyP', 'KeyU', 'KeyD', 'KeyM', 'ArrowUp', 'ArrowDown']);
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey || !POC_KEYS.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    post('POC_KEY', { code: e.code, ctrl: e.ctrlKey });
  }, true);
  window.addEventListener('resize', measure);
  setInterval(attach, 1000); // #input-panel、頂部列可能延遲出現或被重建；底部卡片出現時也靠這個保底重量
  attach();
})();
