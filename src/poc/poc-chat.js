// T1 PoC：chat frame 端（只在 live_chat / live_chat_replay iframe 執行；T9 移除）
// 量測 #input-panel，透過 postMessage 回報給 top frame（只回報尺寸與標籤名稱，不含任何文字內容）。
(function () {
  'use strict';
  if (window === window.top) return;
  const S = globalThis.YTCAS_SEL;
  if (!S) return;
  const YT = 'https://www.youtube.com';

  let ro = null;
  let observed = null;
  let last = '';

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
        .map((x) => `${x.el.tagName.toLowerCase()}${x.el.id ? '#' + x.el.id : ''}:${x.h}`);
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
    window.top.postMessage(Object.assign({ __ytcas: true, type: 'POC_INPUT' }, msg), YT);
  }

  function attach() {
    const panel = document.querySelector(S.chat.inputPanel);
    if (panel === observed) return;
    ro?.disconnect();
    observed = panel;
    if (panel) {
      ro = new ResizeObserver(measure);
      ro.observe(panel);
    }
    measure();
  }

  // top frame 開啟 PoC 時會要求重送一次
  window.addEventListener('message', (e) => {
    if (e.origin !== YT || e.source !== window.top) return;
    if (e.data && e.data.__ytcas === true && e.data.type === 'POC_INPUT_REQUEST') { last = ''; measure(); }
  });
  window.addEventListener('resize', measure);
  setInterval(attach, 1000); // #input-panel 可能延遲出現或被重建
  attach();
})();
