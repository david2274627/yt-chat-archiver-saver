// T1 clip-path PoC（只在 top frame 執行；驗證完成後於 T6 移除）
// 目的：驗證對 ytd-live-chat-frame 套 clip-path 後，被裁切區域的點擊/滾輪會落到下層測試面板，
//      而下方露出的原生輸入框仍可正常打字。
// 切換：頁面左下角「PoC」按鈕，或 Alt+Shift+P。
(function () {
  'use strict';
  if (window !== window.top) return;
  const S = globalThis.YTCAS_SEL;
  if (!S) return;

  const STYLE_ID = 'ytcas-poc-style';
  const PANEL_ID = 'ytcas-poc-panel';
  const TOGGLE_ID = 'ytcas-poc-toggle';

  const state = {
    on: false,
    revealPx: 84,          // 露出高度（從目標元素底部算起）
    target: 'frame',       // 'frame' = ytd-live-chat-frame；'iframe' = iframe#chatframe
    clicks: 0,
    wheels: 0,
    lastClick: '—',
    timer: 0,
    ro: null,
  };

  const log = (...a) => console.log('[ytcas-poc]', ...a);
  const chromeVer = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '未知';

  function els() {
    const frame = document.querySelector(S.top.liveChatFrame);
    const iframe = frame && frame.querySelector(S.top.chatIframe);
    return { frame, iframe, host: frame && frame.parentElement };
  }

  function css() {
    return `
      .ytcas-poc-host { position: relative !important; }
      .ytcas-poc-frame { position: relative !important; z-index: 20 !important; }
      .ytcas-poc-clip { clip-path: inset(calc(100% - var(--ytcas-poc-reveal, 84px)) 0 0 0) !important;
                        transition: clip-path 120ms ease-out; }
      #${PANEL_ID} { position: absolute; z-index: 10; box-sizing: border-box; display: flex; flex-direction: column;
        background: #f4f6fb; color: #1b1f2a; border: 2px dashed #3b5bdb; border-radius: 12px; overflow: hidden;
        font: 13px/1.45 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
      html[dark] #${PANEL_ID} { background: #1b1f2a; color: #e6e9f2; }
      #${PANEL_ID} .ytcas-poc-head { padding: 8px 10px; border-bottom: 1px solid #3b5bdb55; display: grid; gap: 6px; }
      #${PANEL_ID} .ytcas-poc-head b { font-size: 14px; }
      #${PANEL_ID} .ytcas-poc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${PANEL_ID} .ytcas-poc-stat { font-variant-numeric: tabular-nums; }
      #${PANEL_ID} .ytcas-poc-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
      #${PANEL_ID} .ytcas-poc-list button { display: block; width: 100%; text-align: left; margin: 2px 0; padding: 6px 8px;
        border: 1px solid #3b5bdb44; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
      #${PANEL_ID} .ytcas-poc-list button:hover { background: #3b5bdb22; }
      #${PANEL_ID} .ytcas-poc-list button.hit { background: #0ca67833; border-color: #0ca678; }
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

  function buildPanel() {
    const p = document.createElement('div');
    p.id = PANEL_ID;
    const head = document.createElement('div');
    head.className = 'ytcas-poc-head';
    head.innerHTML = `
      <b>clip-path PoC 測試面板</b>
      <div class="ytcas-poc-row ytcas-poc-stat">
        點擊：<span data-k="clicks">0</span>　滾輪：<span data-k="wheels">0</span>　最後點擊：<span data-k="last">—</span>
      </div>
      <div class="ytcas-poc-row">
        <label>露出高度 <input type="range" min="40" max="240" step="2" data-k="reveal"> <span data-k="revealVal"></span>px</label>
      </div>
      <div class="ytcas-poc-row">
        裁切對象：
        <label><input type="radio" name="ytcas-poc-target" value="frame"> ytd-live-chat-frame</label>
        <label><input type="radio" name="ytcas-poc-target" value="iframe"> iframe#chatframe</label>
      </div>
      <div class="ytcas-poc-row" style="opacity:.7">Chrome ${chromeVer}</div>`;
    const list = document.createElement('div');
    list.className = 'ytcas-poc-list';
    for (let i = 1; i <= 200; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `測試列 #${i}（點我）`;
      b.dataset.i = String(i);
      list.appendChild(b);
    }
    p.append(head, list);

    list.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.clicks++;
      state.lastClick = '#' + b.dataset.i;
      list.querySelectorAll('button.hit').forEach((x) => x.classList.remove('hit'));
      b.classList.add('hit');
      log('面板收到點擊', state.lastClick);
      renderStats();
    });
    p.addEventListener('wheel', () => { state.wheels++; renderStats(); }, { passive: true });

    const range = head.querySelector('[data-k="reveal"]');
    range.value = String(state.revealPx);
    range.addEventListener('input', () => { state.revealPx = Number(range.value); applyClip(); renderStats(); });
    head.querySelectorAll('input[name="ytcas-poc-target"]').forEach((r) => {
      r.checked = r.value === state.target;
      r.addEventListener('change', () => { if (r.checked) { state.target = r.value; applyClip(); log('裁切對象', state.target); } });
    });
    return p;
  }

  function renderStats() {
    const p = document.getElementById(PANEL_ID);
    if (!p) return;
    p.querySelector('[data-k="clicks"]').textContent = String(state.clicks);
    p.querySelector('[data-k="wheels"]').textContent = String(state.wheels);
    p.querySelector('[data-k="last"]').textContent = state.lastClick;
    p.querySelector('[data-k="revealVal"]').textContent = String(state.revealPx);
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

  // 'frame' 模式：從 iframe 底邊往上露出 revealPx（iframe 下方的原生「隱藏聊天室」列一併露出）
  // 'iframe' 模式：直接裁 iframe 本身
  function applyClip() {
    const { frame, iframe } = els();
    if (!frame || !iframe) return;
    [frame, iframe].forEach((el) => {
      el.classList.remove('ytcas-poc-clip');
      el.style.removeProperty('clip-path');
    });
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

  function enable() {
    const { frame, iframe, host } = els();
    if (!frame || !iframe || !host) {
      S.warnOnce('poc:liveChatFrame', '此頁沒有原生聊天室（請開直播頁並確認聊天室已展開）');
      alert('PoC：找不到原生聊天室。請在直播頁、聊天室展開的狀態下再試一次。');
      return;
    }
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    host.classList.add('ytcas-poc-host');
    frame.classList.add('ytcas-poc-frame');
    host.insertBefore(buildPanel(), frame);
    renderStats();
    layout();
    applyClip();
    state.ro = new ResizeObserver(layout);
    state.ro.observe(frame);
    state.ro.observe(host);
    state.timer = setInterval(layout, 1000); // PoC 用：劇院模式切換等位置變化
    state.on = true;
    log('開啟', { chrome: chromeVer, frameH: frame.offsetHeight, iframeH: iframe.offsetHeight });
  }

  function disable() {
    const { frame, iframe, host } = els();
    clearInterval(state.timer);
    if (state.ro) state.ro.disconnect();
    document.getElementById(PANEL_ID)?.remove();
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
    state.on ? disable() : enable();
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
    // 按鈕樣式需在 PoC 關閉時也存在
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
