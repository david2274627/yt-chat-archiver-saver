// T1 clip-path PoC（只在 top frame 執行；T9 發版前移除）
// 目的：
//   1. 對 ytd-live-chat-frame 套 clip-path 後，被裁切區域的點擊/滾輪會落到下層面板（div 或擴充功能 iframe）
//   2. 底部露出的原生輸入框仍可正常打字
//   3. 「完全不裁切」時原生表符/$ 彈窗的展開情形
//   4. 觀察 $ 付款視窗開在聊天室 iframe 內，還是 top frame 的 ytd-popup-container
// 切換：頁面左下角「PoC」按鈕，或 Alt+Shift+P。控制項在左下角浮動控制盒（不在面板內，避免不裁切時按不到）。
(function () {
  'use strict';
  if (window !== window.top) return;
  const S = globalThis.YTCAS_SEL;
  if (!S) return;

  const STYLE_ID = 'ytcas-poc-style';
  const PANEL_ID = 'ytcas-poc-panel';
  const CTRL_ID = 'ytcas-poc-ctrl';
  const TOGGLE_ID = 'ytcas-poc-toggle';
  const PANEL_PAGE = 'src/poc/poc-panel.html';

  const state = {
    on: false,
    revealPx: 84,          // 從 iframe 底邊往上露出的高度
    target: 'frame',       // 'frame' = ytd-live-chat-frame；'iframe' = iframe#chatframe
    lower: 'div',          // 'div' | 'iframe'（擴充功能頁面）
    noClip: false,         // 完全不裁切（原生聊天室仍在上層）
    clicks: 0,
    wheels: 0,
    lastClick: '—',
    popupNow: '—',
    popupLast: '—',
    timer: 0,
    popupTimer: 0,
    ro: null,
    mo: null,
    panelOrigin: null,
  };

  const log = (...a) => console.log('[ytcas-poc]', ...a);
  const chromeVer = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '未知';

  function els() {
    const frame = document.querySelector(S.top.liveChatFrame);
    const iframe = frame && frame.querySelector(S.top.chatIframe);
    return { frame, iframe, host: frame && frame.parentElement };
  }

  // ---------------- 樣式 ----------------
  function css() {
    return `
      .ytcas-poc-host { position: relative !important; }
      .ytcas-poc-frame { position: relative !important; z-index: 20 !important; }
      .ytcas-poc-clip { clip-path: inset(calc(100% - var(--ytcas-poc-reveal, 84px)) 0 0 0) !important; }
      #${PANEL_ID} { position: absolute; z-index: 10; box-sizing: border-box; display: flex; flex-direction: column;
        background: #f4f6fb; color: #1b1f2a; border: 2px dashed #3b5bdb; border-radius: 12px; overflow: hidden;
        font: 13px/1.45 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
      html[dark] #${PANEL_ID} { background: #1b1f2a; color: #e6e9f2; }
      #${PANEL_ID} iframe { border: 0; width: 100%; height: 100%; display: block; }
      #${PANEL_ID} .ytcas-poc-title { padding: 8px 10px; font-weight: 700; border-bottom: 1px solid #3b5bdb55; }
      #${PANEL_ID} .ytcas-poc-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
      #${PANEL_ID} .ytcas-poc-list button { display: block; width: 100%; text-align: left; margin: 2px 0; padding: 6px 8px;
        border: 1px solid #3b5bdb44; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
      #${PANEL_ID} .ytcas-poc-list button:hover { background: #3b5bdb22; }
      #${PANEL_ID} .ytcas-poc-list button.hit { background: #0ca67833; border-color: #0ca678; }
      #${CTRL_ID} { position: fixed; left: 12px; bottom: 56px; z-index: 2147483000; width: 300px; box-sizing: border-box;
        padding: 10px 12px; border-radius: 12px; background: #ffffff; color: #1b1f2a; border: 1px solid #3b5bdb;
        box-shadow: 0 4px 16px #0003; font: 12px/1.5 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; display: grid; gap: 6px; }
      html[dark] #${CTRL_ID} { background: #1b1f2a; color: #e6e9f2; }
      #${CTRL_ID} b { font-size: 13px; }
      #${CTRL_ID} .r { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${CTRL_ID} .n { font-variant-numeric: tabular-nums; }
      #${CTRL_ID} .pop { word-break: break-all; }
      #${CTRL_ID} input[type=range] { width: 120px; }
    `;
  }

  function toggleCss() {
    return `
      #${TOGGLE_ID} { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; padding: 8px 14px;
        border-radius: 999px; border: 0; background: #3b5bdb; color: #fff; font: 600 13px system-ui, sans-serif;
        cursor: pointer; box-shadow: 0 2px 8px #0004; }
      #${TOGGLE_ID}.on { background: #c92a2a; }
    `;
  }

  // ---------------- 控制盒 ----------------
  function radio(name, value, label, cur) {
    return `<label><input type="radio" name="${name}" value="${value}"${cur === value ? ' checked' : ''}> ${label}</label>`;
  }

  function buildControls() {
    const c = document.createElement('div');
    c.id = CTRL_ID;
    c.innerHTML = `
      <b>clip-path PoC 控制盒</b>
      <div class="r n">點擊：<span data-k="clicks">0</span>　滾輪：<span data-k="wheels">0</span>　最後點擊：<span data-k="last">—</span></div>
      <div class="r"><label>露出高度 <input type="range" min="40" max="240" step="2" data-k="reveal"> <span class="n" data-k="revealVal"></span>px</label></div>
      <div class="r">裁切對象：${radio('ytcas-poc-target', 'frame', 'ytd-live-chat-frame', state.target)}${radio('ytcas-poc-target', 'iframe', 'iframe#chatframe', state.target)}</div>
      <div class="r">下層類型：${radio('ytcas-poc-lower', 'div', 'div', state.lower)}${radio('ytcas-poc-lower', 'iframe', '擴充功能 iframe', state.lower)}</div>
      <div class="r"><label><input type="checkbox" data-k="noClip"> 完全不裁切（clip-path: none）</label></div>
      <div class="pop">目前可見彈窗：<span data-k="popNow">—</span></div>
      <div class="pop">最近一次可見彈窗：<span data-k="popLast">—</span></div>
      <div class="r" style="opacity:.7">Chrome ${chromeVer}</div>`;

    const range = c.querySelector('[data-k="reveal"]');
    range.value = String(state.revealPx);
    range.addEventListener('input', () => { state.revealPx = Number(range.value); applyClip(); render(); });
    c.querySelectorAll('input[name="ytcas-poc-target"]').forEach((r) => r.addEventListener('change', () => {
      if (r.checked) { state.target = r.value; applyClip(); log('裁切對象', state.target); }
    }));
    c.querySelectorAll('input[name="ytcas-poc-lower"]').forEach((r) => r.addEventListener('change', () => {
      if (r.checked) { state.lower = r.value; mountPanel(); log('下層類型', state.lower); }
    }));
    const nc = c.querySelector('[data-k="noClip"]');
    nc.checked = state.noClip;
    nc.addEventListener('change', () => { state.noClip = nc.checked; applyClip(); log('完全不裁切', state.noClip); });
    return c;
  }

  function render() {
    const c = document.getElementById(CTRL_ID);
    if (!c) return;
    const set = (k, v) => { const e = c.querySelector(`[data-k="${k}"]`); if (e) e.textContent = String(v); };
    set('clicks', state.clicks);
    set('wheels', state.wheels);
    set('last', state.lastClick);
    set('revealVal', state.revealPx);
    set('popNow', state.popupNow);
    set('popLast', state.popupLast);
  }

  // ---------------- 下層面板 ----------------
  function buildDivPanel(p) {
    const title = document.createElement('div');
    title.className = 'ytcas-poc-title';
    title.textContent = '測試面板（div）';
    const list = document.createElement('div');
    list.className = 'ytcas-poc-list';
    for (let i = 1; i <= 200; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `測試列 #${i}（點我）`;
      b.dataset.i = String(i);
      list.appendChild(b);
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.clicks++;
      state.lastClick = 'div #' + b.dataset.i;
      list.querySelectorAll('button.hit').forEach((x) => x.classList.remove('hit'));
      b.classList.add('hit');
      log('面板收到點擊', state.lastClick);
      render();
    });
    p.addEventListener('wheel', () => { state.wheels++; render(); }, { passive: true });
    p.append(title, list);
  }

  function buildIframePanel(p) {
    const f = document.createElement('iframe');
    const src = chrome.runtime.getURL(PANEL_PAGE);
    state.panelOrigin = new URL(src).origin;
    f.src = src;
    f.title = '測試面板（擴充功能 iframe）';
    p.appendChild(f);
    log('載入擴充功能 iframe', src);
  }

  function mountPanel() {
    const { frame, host } = els();
    if (!frame || !host) return;
    document.getElementById(PANEL_ID)?.remove();
    const p = document.createElement('div');
    p.id = PANEL_ID;
    if (state.lower === 'iframe') buildIframePanel(p); else buildDivPanel(p);
    host.insertBefore(p, frame);
    layout();
  }

  // 擴充功能 iframe 面板透過 postMessage 回報點擊/滾輪
  function onMessage(e) {
    const d = e.data;
    if (!d || d.__ytcas !== true || d.type !== 'POC_STAT') return;
    const f = document.querySelector(`#${PANEL_ID} iframe`);
    if (!f || e.source !== f.contentWindow) return;
    const okOrigin = e.origin === state.panelOrigin || e.origin === 'chrome-extension://' + chrome.runtime.id;
    if (!okOrigin) { log('拒絕來源', e.origin); return; }
    if (d.kind === 'click') { state.clicks++; state.lastClick = 'iframe #' + d.i; }
    if (d.kind === 'wheel') state.wheels++;
    render();
  }

  // 面板與 ytd-live-chat-frame 完全重疊（同位置同寬高）
  function layout() {
    const { frame, host } = els();
    const p = document.getElementById(PANEL_ID);
    if (!frame || !host || !p) return;
    if (p.parentElement !== host) host.insertBefore(p, frame);
    const hr = host.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    p.style.top = (fr.top - hr.top + host.scrollTop - host.clientTop) + 'px';
    p.style.left = (fr.left - hr.left + host.scrollLeft - host.clientLeft) + 'px';
    p.style.width = fr.width + 'px';
    p.style.height = fr.height + 'px';
    applyClip();
  }

  // 'frame'：clip = inset(iframeBottom - frameTop - revealPx 0 0 0)（SPEC 6.2 v22）
  // 'iframe'：直接裁 iframe 本身
  function applyClip() {
    const { frame, iframe } = els();
    if (!frame || !iframe) return;
    [frame, iframe].forEach((el) => {
      el.classList.remove('ytcas-poc-clip');
      el.style.removeProperty('clip-path');
    });
    if (state.noClip) return;
    if (state.target === 'iframe') {
      iframe.style.setProperty('--ytcas-poc-reveal', state.revealPx + 'px');
      iframe.classList.add('ytcas-poc-clip');
    } else {
      const fr = frame.getBoundingClientRect();
      const ir = iframe.getBoundingClientRect();
      const topPx = Math.max(0, Math.round(ir.bottom - fr.top - state.revealPx));
      frame.style.setProperty('transition', 'clip-path 120ms ease-out');
      frame.style.setProperty('clip-path', `inset(${topPx}px 0 0 0)`, 'important');
    }
  }

  // ---------------- 彈窗觀察 ----------------
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function describe(el, where) {
    return `${where}：${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}（top ${Math.round(el.getBoundingClientRect().top)}px）`;
  }

  function scanPopups() {
    const found = [];
    // top frame
    const container = document.querySelector(S.top.popupContainer);
    if (container) {
      S.top.popups.forEach((sel) => container.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el)) found.push(describe(el, '頁面'));
      }));
    }
    // chat frame（同源，盡力而為）
    try {
      const doc = els().iframe?.contentDocument;
      if (doc) {
        S.chat.popups.forEach((sel) => doc.querySelectorAll(sel).forEach((el) => {
          if (isVisible(el)) found.push(describe(el, '聊天室'));
        }));
      }
    } catch (_) { /* 跨來源時略過 */ }

    const now = found.length ? Array.from(new Set(found)).join('、') : '—';
    if (now !== state.popupNow) {
      state.popupNow = now;
      if (found.length) {
        state.popupLast = `${now}（${new Date().toLocaleTimeString('zh-TW', { hour12: false })}）`;
        log('可見彈窗', now);
      }
      render();
    }
  }

  function startPopupWatch() {
    const container = document.querySelector(S.top.popupContainer);
    if (container) {
      state.mo = new MutationObserver(() => scanPopups());
      state.mo.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden', 'opened', 'aria-hidden'] });
    } else {
      S.warnOnce('poc:popupContainer', S.top.popupContainer);
    }
    state.popupTimer = setInterval(scanPopups, 500); // 保底輪詢（含聊天室 iframe 內）
  }

  // ---------------- 開關 ----------------
  function enable() {
    const { frame, iframe, host } = els();
    if (!frame || !iframe || !host) {
      S.warnOnce('poc:liveChatFrame', '此頁沒有原生聊天室（請開直播頁並確認聊天室已展開）');
      alert('PoC：找不到原生聊天室。請在直播頁、聊天室展開的狀態下再試一次。');
      return false;
    }
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    host.classList.add('ytcas-poc-host');
    frame.classList.add('ytcas-poc-frame');
    document.body.appendChild(buildControls());
    mountPanel();
    render();
    state.ro = new ResizeObserver(layout);
    state.ro.observe(frame);
    state.ro.observe(host);
    state.timer = setInterval(layout, 1000); // 劇院模式切換等位置變化
    window.addEventListener('message', onMessage);
    startPopupWatch();
    state.on = true;
    log('開啟', { chrome: chromeVer, frameH: frame.offsetHeight, iframeH: iframe.offsetHeight });
    return true;
  }

  function disable() {
    const { frame, iframe, host } = els();
    clearInterval(state.timer);
    clearInterval(state.popupTimer);
    state.ro?.disconnect();
    state.mo?.disconnect();
    window.removeEventListener('message', onMessage);
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(CTRL_ID)?.remove();
    [frame, iframe].forEach((el) => {
      if (!el) return;
      el.classList.remove('ytcas-poc-clip', 'ytcas-poc-frame');
      el.style.removeProperty('--ytcas-poc-reveal');
      el.style.removeProperty('clip-path');
      el.style.removeProperty('transition');
    });
    host?.classList.remove('ytcas-poc-host');
    document.getElementById(STYLE_ID)?.remove();
    state.on = false;
    log('關閉，已還原');
  }

  function toggle() {
    if (state.on) disable(); else enable();
    const t = document.getElementById(TOGGLE_ID);
    if (t) {
      t.classList.toggle('on', state.on);
      t.textContent = state.on ? 'PoC：關閉' : 'PoC：開啟';
    }
  }

  function mountToggle() {
    if (document.getElementById(TOGGLE_ID)) return;
    const t = document.createElement('button');
    t.id = TOGGLE_ID;
    t.type = 'button';
    t.textContent = 'PoC：開啟';
    t.addEventListener('click', toggle);
    const st = document.createElement('style');
    st.textContent = toggleCss();
    document.head.appendChild(st);
    document.body.appendChild(t);
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); toggle(); }
  });
  document.addEventListener('yt-navigate-finish', () => { if (state.on) toggle(); });

  mountToggle();
})();
