// T1 PoC：chat frame 端（只在 live_chat / live_chat_replay iframe 執行；T9 移除）
// 1. 量測 #input-panel，透過 postMessage 回報給 top frame（只回報尺寸與標籤名稱，不含任何文字內容）。
// 2. v24：在聊天室頂部列（⋮ 左側）注入「PoC 測試」按鈕（F-09 錨點 1），點擊後送 TOGGLE_PANEL 給 top frame。
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

  // v24（review-3 §4.1）：底部互動區診斷。列出 yt-live-chat-renderer 底下所有可見、且 rect.bottom 在 iframe 底部 400px 內的元素；
  // 排除 #item-list（及其子孫與祖先）、頂部列與套件自己的元素。只輸出標籤、id、位置與高度，不輸出任何文字。
  const ZONE_RANGE_PX = 400;
  const ZONE_MAX = 40;
  function bottomZone() {
    const root = document.querySelector(S.chat.renderer);
    const vh = window.innerHeight;
    if (!root) { S.warnOnce('poc:chat.renderer', S.chat.renderer); return { list: [], top: null }; }
    const itemList = root.querySelector(S.chat.itemList);
    const header = root.querySelector(S.chat.header);
    const list = [];
    let minTop = null;
    // 手動走訪：整棵跳過 #item-list 與頂部列（訊息節點很多），#item-list 的祖先只往下走、本身不列入
    const walk = (el) => {
      for (const c of el.children) {
        if (c === itemList || c === header || (c.id && c.id.startsWith('ytcas-'))) continue;
        if (itemList && c.contains(itemList)) { walk(c); continue; }
        const r = c.getBoundingClientRect();
        const inZone = r.width > 0 && r.height > 0 && r.bottom > vh - ZONE_RANGE_PX && r.top < vh;
        if (inZone) {
          const cs = getComputedStyle(c);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue; // 隱藏的子樹整個略過
          if (Number(cs.opacity) !== 0) {
            const top = Math.max(0, Math.round(r.top));
            if (minTop == null || top < minTop) minTop = top;
            if (list.length < ZONE_MAX) list.push({ el: tagId(c), top, h: Math.round(r.height), parents: parentChain(c) });
          }
        }
        walk(c);
      }
    };
    walk(root);
    return { list, top: minTop };
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
    msg.zoneFromBottom = z.top == null ? null : vh - z.top; // 自動量測 v2：iframe 底邊 − 最高的底部元素頂端
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
    let btn = document.getElementById(HDR_BTN_ID);
    let overflow = null;
    for (const sel of S.chat.headerOverflow) { overflow = header.querySelector(sel); if (overflow) break; }
    const how = overflow ? 'before-overflow' : 'append';
    if (btn && header.contains(btn) && (overflow ? btn.nextElementSibling === overflow : true)) {
      reportAnchor({ header: true, how, kids });
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
    reportAnchor({ header: true, how, kids });
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
  window.addEventListener('resize', measure);
  setInterval(attach, 1000); // #input-panel、頂部列可能延遲出現或被重建；底部卡片出現時也靠這個保底重量
  attach();
})();
