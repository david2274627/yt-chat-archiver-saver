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

  const post = (type, payload) => window.top.postMessage(Object.assign({ __ytcas: true, type }, payload || {}), YT);
  const tagId = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;

  // ---------------- 量測 ----------------
  function measure() {
    const panel = document.querySelector(S.chat.inputPanel);
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
        height: Math.round(r.height),                       // #input-panel 本身高度
        fromBottom: Math.round(window.innerHeight - r.top), // #input-panel 頂端到 iframe 底邊
        rows,                                                // 子元素標籤與高度（不含文字）
      };
    }
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
      btn.textContent = 'PoC 測試';
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
    if (e.data && e.data.__ytcas === true && e.data.type === 'POC_INPUT_REQUEST') { last = ''; lastAnchor = ''; attach(); }
  });
  window.addEventListener('resize', measure);
  setInterval(attach, 1000); // #input-panel、頂部列可能延遲出現或被重建
  attach();
})();
