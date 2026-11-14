// T1 clip-path PoC：top frame 端（T9 發版前移除）
// v23：面板插入 ytd-live-chat-frame 內（iframe#chatframe 前一個兄弟），clip-path 套在 iframe 本身；無任何 position:fixed 元素。
// v24：
//   - 開關改為多重錨點（SPEC F-09）：聊天室頂部列（poc-chat.js 注入）→ PoC 面板頂部列 → 影片下方「聊天室」卡片
//     （聊天室關閉時先展開）→ 舊版「隱藏聊天室」列；
//     全部找不到時 console.warn，快速鍵 Alt+Shift+P 仍可用
//   - 頁面層付款視窗以明確選擇器（top.pagePopups）偵測為主，position:fixed 掃描為輔
//   - review-3：自動量測 v2（底部互動區）、版面診斷與「複製診斷」（Alt+Shift+D）、
//     露出值 clamp 在 [0, iframe 高度]、摺疊保護（iframe 太矮 → 解除 clip、隱藏面板，恢復後自動重啟）
// 快速鍵：Alt+Shift+P 開關 PoC；Alt+Shift+U 切換「完全不裁切」。
(function () {
  'use strict';
  if (window !== window.top) return;
  const S = globalThis.YTCAS_SEL;
  const C = globalThis.YTCAS_CONST;
  if (!S || !C) return;

  const YT = C.YT_ORIGIN;
  const STYLE_ID = 'ytcas-poc-style';
  const PANEL_ID = 'ytcas-poc-panel';
  const LEGACY_BTN_ID = 'ytcas-poc-legacy-btn';
  const TEASER_BTN_ID = 'ytcas-poc-teaser-btn';
  const EXPAND_WAIT_MS = 8000;
  const COLLAPSE_MIN_H = 200; // iframe 高度低於此值視為「聊天室摺疊」（PoC 用；正式值於 T6 依診斷定案）
  const SUSPECT_RATIO = 0.6;        // 量測 v3 超過 iframe 高度的此比例 → 可疑
  const MIN_PANEL_VISIBLE_PX = 160; // 面板至少保留的可見高度（含頂部控制列）
  const PANEL_PAGE = 'src/poc/poc-panel.html';
  const ANCHOR_GRACE_MS = 6000;

  const state = {
    on: false,
    auto: true,            // 自動：使用 chat frame 量測值；手動：使用滑桿
    manualPx: 84,
    lower: 'div',          // 'div' | 'iframe'
    noClip: false,
    expanded: false,       // 面板頂部控制列是否展開
    measure: null,         // { found, height, fromBottom, rows }
    anchors: { header: false, headerHow: '—', headerKids: [], legacy: false, teaser: false, teaserHow: '—' },
    metaMo: null,
    metaRaf: 0,
    expanding: false,
    paused: false,         // 摺疊保護中
    layoutMo: null,
    flexyMo: null,
    flexyTreeMo: null,
    layoutRaf: 0,
    anchorWarned: false,
    pageStart: Date.now(),
    clicks: 0,
    wheels: 0,
    lastClick: '—',
    popupNow: '—',
    popupLast: '—',
    panelOrigin: null,
    ro: null,
    frameMo: null,
    bodyMo: null,
    buyMo: null,
    popupTimer: 0,
    mountTimer: 0,
  };

  const log = (...a) => console.log('[ytcas-poc]', ...a);
  const chromeVer = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '未知';

  function els() {
    const frame = document.querySelector(S.top.liveChatFrame);
    const iframe = frame && frame.querySelector(S.top.chatIframe);
    const showHide = frame && frame.querySelector(S.top.showHideButton);
    return { frame, iframe, showHide };
  }

  // 自動量測的結果與來源。v3 = iframe 底邊 − 白名單／覆蓋層子元素中最高者的頂端；
  // 合理性檢查（review-2026-11-15 §3.1-3）：v3 > iframe 高 × 0.6，或面板可見高度 < 160px → 可疑，退回 #input-panel 算法
  function autoReveal() {
    const m = state.measure;
    if (!m) return { px: null, src: '等待量測', suspect: '' };
    const h = iframeH();
    const fallback = m.found ? m.fromBottom : null; // null = 量測不到 → 視同無輸入區
    const v3 = m.zoneFromBottom;
    if (v3 == null) return { px: fallback, src: '後備（#input-panel）', suspect: 'v3 量不到' };
    if (h > 0 && (v3 > h * SUSPECT_RATIO || h - v3 < MIN_PANEL_VISIBLE_PX)) {
      return { px: fallback, src: '後備（#input-panel）', suspect: `v3 ${v3}px 可疑（${v3 > h * SUSPECT_RATIO ? '> iframe 高 60%' : '面板可見 < ' + MIN_PANEL_VISIBLE_PX + 'px'}）` };
    }
    return { px: v3, src: 'v3', suspect: '' };
  }

  // 原始露出值（未 clamp）
  function rawRevealPx() {
    return state.auto ? autoReveal().px : state.manualPx;
  }

  function iframeH() {
    const { iframe } = els();
    return iframe ? iframe.offsetHeight : 0;
  }

  // clamp 在 [0, iframe 高度]
  function revealPx() {
    const r = rawRevealPx();
    return r == null ? null : Math.min(Math.max(0, r), iframeH());
  }

  // 摺疊保護：iframe 太矮或露出值 ≥ iframe 高度 → 解除 clip、隱藏面板
  function isCollapsed() {
    const h = iframeH();
    const r = rawRevealPx();
    return h < COLLAPSE_MIN_H || (r != null && r >= h);
  }

  // ---------------- 樣式（全部在聊天室元素內，無 position:fixed） ----------------
  function css() {
    return `
      .ytcas-poc-frame { position: relative !important; }
      .ytcas-poc-iframe { position: relative !important; z-index: 20 !important; transition: clip-path 120ms ease-out; }
      @media (prefers-reduced-motion: reduce) { .ytcas-poc-iframe { transition: none; } }
      #${PANEL_ID} { position: absolute; inset: 0 0 auto 0; z-index: 10; box-sizing: border-box; display: flex; flex-direction: column;
        background: #f4f6fb; color: #1b1f2a; border: 2px dashed #3b5bdb; border-radius: 12px; overflow: hidden;
        font: 12px/1.45 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif; }
      html[dark] #${PANEL_ID} { background: #1b1f2a; color: #e6e9f2; }
      #${PANEL_ID} .bar { padding: 6px 10px; border-bottom: 1px solid #3b5bdb55; display: grid; gap: 4px; }
      #${PANEL_ID} .bar .sum { display: flex; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
      #${PANEL_ID} .bar .sum span.grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${PANEL_ID} .bar button.mini { font: inherit; padding: 2px 8px; border-radius: 999px; border: 1px solid #3b5bdb; background: transparent; color: inherit; cursor: pointer; white-space: nowrap; }
      #${PANEL_ID} .bar button.mini.danger { background: #c92a2a; border-color: #c92a2a; color: #fff; }
      #${PANEL_ID} .bar button.mini.on { background: #e8590c; border-color: #e8590c; color: #fff; }
      #${PANEL_ID} .bar .more { display: none; gap: 4px; }
      #${PANEL_ID}.expanded .bar .more { display: grid; }
      #${PANEL_ID} .bar .r { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${PANEL_ID} .bar .pop { word-break: break-all; }
      #${PANEL_ID} .bar input[type=range] { width: 110px; }
      #${PANEL_ID} .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      #${PANEL_ID} .body iframe { border: 0; width: 100%; flex: 1; display: block; }
      #${PANEL_ID} .list { flex: 1; overflow-y: auto; padding: 6px 10px; }
      #${PANEL_ID} .list button { display: block; width: 100%; text-align: left; margin: 2px 0; padding: 6px 8px;
        border: 1px solid #3b5bdb44; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
      #${PANEL_ID} .list button:hover { background: #3b5bdb22; }
      #${PANEL_ID} .list button.hit { background: #0ca67833; border-color: #0ca678; }
      .ytcas-poc-showhide { position: relative !important; }
      #${LEGACY_BTN_ID} { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); z-index: 21; }
      .ytcas-poc-entry { padding: 4px 10px; border-radius: 999px; border: 0; background: #3b5bdb; color: #fff;
        font: 600 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
      .ytcas-poc-entry.on { background: #c92a2a; }
      .ytcas-poc-teaser { margin-left: 8px; align-self: center; }
    `;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css();
    document.head.appendChild(st);
  }

  // ---------------- 開關錨點（SPEC F-09 多重錨點） ----------------
  function entryButton(id, onClick = toggle) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'ytcas-poc-entry';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  // 錨點 4：舊版面「隱藏聊天室」列
  function mountLegacy() {
    const { showHide } = els();
    // 實機（2026-11-15）：#show-hide-button 可能以隱藏狀態殘留 → 只有可見（rect 寬高 > 0）時才掛載
    const r = showHide && showHide.getBoundingClientRect();
    if (!showHide || r.width <= 0 || r.height <= 0) { document.getElementById(LEGACY_BTN_ID)?.remove(); state.anchors.legacy = false; return; }
    if (document.getElementById(LEGACY_BTN_ID)?.parentElement !== showHide) {
      document.getElementById(LEGACY_BTN_ID)?.remove();
      ensureStyle();
      showHide.classList.add('ytcas-poc-showhide');
      showHide.appendChild(entryButton(LEGACY_BTN_ID));
    }
    state.anchors.legacy = true;
  }

  function chatOpen() {
    const { frame, iframe } = els();
    return !!(frame && iframe && iframe.offsetHeight > 0);
  }

  // 錨點 3：影片下方「聊天室／開啟面板」卡片
  function onTeaserClick() {
    if (chatOpen()) { toggle(); return; }
    // 聊天室已關閉：先按原生「開啟面板」展開，再開啟 PoC
    const t = S.findChatTeaser(document, C.OPEN_PANEL_LABELS);
    if (!t || t.button.disabled) { log('無法展開聊天室：找不到可用的「開啟面板」'); return; }
    if (state.expanding) return;
    state.expanding = true;
    t.button.click();
    const t0 = Date.now();
    const wait = setInterval(() => {
      if (chatOpen()) { clearInterval(wait); state.expanding = false; if (!state.on) enable(); renderEntries(); }
      else if (Date.now() - t0 > EXPAND_WAIT_MS) { clearInterval(wait); state.expanding = false; log('等待聊天室展開逾時'); }
    }, 200);
  }

  function mountTeaser() {
    const t = S.findChatTeaser(document, C.OPEN_PANEL_LABELS);
    const old = document.getElementById(TEASER_BTN_ID);
    if (!t) { old?.remove(); state.anchors.teaser = false; return; }
    if (!old || old.previousElementSibling !== t.host) {
      old?.remove();
      ensureStyle();
      // 卡片按鈕要先處理「聊天室已關閉」的情況
      const b = entryButton(TEASER_BTN_ID, onTeaserClick);
      b.classList.add('ytcas-poc-teaser');
      t.host.after(b);
    }
    state.anchors.teaser = true;
    state.anchors.teaserHow = C.OPEN_PANEL_LABELS.includes((t.button.textContent || '').trim()) ? '文字比對' : '圖示比對';
  }

  // #teaser-carousel 會隨導航重建：監看 ytd-watch-metadata（以 rAF 合併）
  function watchMetadata() {
    const meta = document.querySelector(S.top.chatTeaser.metadata);
    if (!meta || state.metaMo?.__target === meta) return;
    state.metaMo?.disconnect();
    state.metaMo = new MutationObserver(() => {
      if (state.metaRaf) return;
      state.metaRaf = requestAnimationFrame(() => { state.metaRaf = 0; mountTeaser(); renderEntries(); });
    });
    state.metaMo.observe(meta, { childList: true, subtree: true });
    state.metaMo.__target = meta;
  }

  function mountAnchors() {
    if (!els().iframe) {
      state.anchors.header = false; // 聊天室關閉時頂部列不存在
      if (state.on) disable();      // 聊天室被 ✕ 關閉：PoC 一併關閉並還原
    }
    mountLegacy();
    watchMetadata();
    mountTeaser();
    renderEntries();
    checkAnchors();
  }

  // 寬限期後仍有錨點找不到 → 各自 warnOnce；全部找不到 → 額外警告一次（附已嘗試清單）
  function checkAnchors() {
    if (Date.now() - state.pageStart < ANCHOR_GRACE_MS) return;
    const a = state.anchors;
    if (!a.header) S.warnOnce('poc:anchor:header', '聊天室頂部列 ' + S.chat.header + '（chat frame 未回報）');
    if (!a.legacy) S.warnOnce('poc:anchor:legacy', '舊版「隱藏聊天室」列 ' + S.top.showHideButton + '（目前版面沒有屬正常）');
    if (!a.teaser) S.warnOnce('poc:anchor:teaser', '影片下方「聊天室」卡片 ' + S.top.chatTeaser.item);
    if (!a.header && !a.legacy && !a.teaser && !state.anchorWarned) {
      state.anchorWarned = true;
      console.warn('[ytcas-poc] 找不到開關錨點', [
        'chat frame 頂部列：' + S.chat.header + ' / ' + S.chat.headerOverflow.join(', '),
        '影片下方卡片：' + S.top.chatTeaser.item,
        '舊版列：' + S.top.showHideButton,
      ], '→ 請用 Alt+Shift+P 開啟');
    }
  }

  function entryLabel() {
    if (!state.on) return 'PoC 測試';
    return state.paused ? 'PoC 暫停（聊天室摺疊）' : '關閉 PoC';
  }

  let lastPosted = '';
  function renderEntries() {
    document.querySelectorAll('.ytcas-poc-entry').forEach((b) => {
      b.textContent = entryLabel();
      b.classList.toggle('on', state.on);
    });
    // 頂部列按鈕在 chat frame 內：把狀態告訴它（摺疊暫停時面板隱藏，頂部列是唯一看得到狀態的地方）
    const key = entryLabel();
    const { iframe } = els();
    if (iframe?.contentWindow && key !== lastPosted) {
      lastPosted = key;
      iframe.contentWindow.postMessage({ __ytcas: true, type: 'POC_STATE', on: state.on, paused: state.paused, label: key }, YT);
    }
  }

  // ---------------- 測試面板 ----------------
  function radio(name, value, label, cur) {
    return `<label><input type="radio" name="${name}" value="${value}"${cur === value ? ' checked' : ''}> ${label}</label>`;
  }

  function buildPanel() {
    const p = document.createElement('div');
    p.id = PANEL_ID;
    if (state.expanded) p.classList.add('expanded');
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `
      <div class="sum"><span class="grow" data-k="sum"></span>
        <button type="button" class="mini" data-k="noClip"></button>
        <button type="button" class="mini" data-k="copy">複製診斷</button>
        <button type="button" class="mini" data-k="expand"></button>
        <button type="button" class="mini danger" data-k="close">關閉 PoC</button></div>
      <div class="more">
        <div class="r">露出：${radio('ytcas-poc-mode', 'auto', '自動（量測 v2）', state.auto ? 'auto' : 'manual')}${radio('ytcas-poc-mode', 'manual', '手動', state.auto ? 'auto' : 'manual')}
          <input type="range" min="0" max="240" step="2" data-k="range"> <span data-k="rangeVal"></span>px</div>
        <div class="r">量測：<span data-k="measure">—</span></div>
        <div class="pop">底部互動區：<span data-k="zone">—</span></div>
        <div class="pop">輸入區子元素：<span data-k="rows">—</span></div>
        <div class="pop">版面：<span data-k="layout">—</span></div>
        <div class="pop">開關錨點：<span data-k="anchors">—</span></div>
        <div class="r">下層類型：${radio('ytcas-poc-lower', 'div', 'div', state.lower)}${radio('ytcas-poc-lower', 'iframe', '擴充功能 iframe', state.lower)}</div>
        <div class="pop">目前可見彈窗：<span data-k="popNow">—</span></div>
        <div class="pop">最近一次可見彈窗：<span data-k="popLast">—</span></div>
        <div class="r" style="opacity:.7">Chrome ${chromeVer}　快速鍵：Alt+Shift+P 開關、Alt+Shift+U 不裁切、Alt+Shift+D 複製診斷</div>
      </div>`;
    const body = document.createElement('div');
    body.className = 'body';
    p.append(bar, body);

    bar.querySelector('[data-k="expand"]').addEventListener('click', () => {
      state.expanded = !state.expanded;
      p.classList.toggle('expanded', state.expanded);
      render();
    });
    bar.querySelector('[data-k="noClip"]').addEventListener('click', toggleNoClip);
    bar.querySelector('[data-k="copy"]').addEventListener('click', copyDiagnostics);
    bar.querySelector('[data-k="close"]').addEventListener('click', () => toggle());
    const range = bar.querySelector('[data-k="range"]');
    range.value = String(state.manualPx);
    range.addEventListener('input', () => { state.manualPx = Number(range.value); applyClip(); render(); });
    bar.querySelectorAll('input[name="ytcas-poc-mode"]').forEach((r) => r.addEventListener('change', () => {
      if (r.checked) { state.auto = r.value === 'auto'; applyClip(); render(); log('露出模式', r.value); }
    }));
    bar.querySelectorAll('input[name="ytcas-poc-lower"]').forEach((r) => r.addEventListener('change', () => {
      if (r.checked) { state.lower = r.value; fillBody(); log('下層類型', state.lower); }
    }));
    fillBody(p);
    return p;
  }

  function fillBody(p = document.getElementById(PANEL_ID)) {
    if (!p) return;
    const body = p.querySelector('.body');
    body.textContent = '';
    if (state.lower === 'iframe') {
      const f = document.createElement('iframe');
      const src = chrome.runtime.getURL(PANEL_PAGE);
      state.panelOrigin = new URL(src).origin;
      f.src = src;
      f.title = '測試面板（擴充功能 iframe）';
      body.appendChild(f);
      return;
    }
    const list = document.createElement('div');
    list.className = 'list';
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
      render();
    });
    list.addEventListener('wheel', () => { state.wheels++; render(); }, { passive: true });
    body.appendChild(list);
  }

  function anchorText() {
    const a = state.anchors;
    return [
      `頂部列 ${a.header ? '✅（' + a.headerHow + '；父元素 ' + (a.headerParent || '—') + '）' : '❌'}`,
      `影片下方卡片 ${a.teaser ? '✅（' + a.teaserHow + '）' : '❌'}`,
      `舊版列 ${a.legacy ? '✅' : '—'}`,
      a.headerKids.length ? `頂部列結構：${a.headerKids.join(' ')}` : '',
    ].filter(Boolean).join('｜');
  }

  function render() {
    renderEntries();
    const p = document.getElementById(PANEL_ID);
    if (!p) return;
    const set = (k, v) => { const e = p.querySelector(`[data-k="${k}"]`); if (e) e.textContent = String(v); };
    const r = revealPx();
    const m = state.measure;
    set('sum', `點擊 ${state.clicks}｜滾輪 ${state.wheels}｜最後 ${state.lastClick}｜露出 ${state.noClip ? '不裁切' : (r == null ? '量測不到' : r + 'px')}${state.auto ? '（自動）' : '（手動）'}`);
    set('expand', state.expanded ? '收合 ▲' : '展開 ▼');
    set('noClip', state.noClip ? '恢復裁切' : '不裁切');
    p.querySelector('[data-k="noClip"]').classList.toggle('on', state.noClip);
    set('rangeVal', state.manualPx);
    const range = p.querySelector('[data-k="range"]');
    const h = iframeH();
    if (range && h > 0 && Number(range.max) !== h) range.max = String(h); // 滑桿上限 = iframe 高度
    const a = autoReveal();
    const v3 = m && m.zoneFromBottom != null ? `v3 底部互動區 ${m.zoneFromBottom}px` : 'v3 量測不到';
    const v1 = m ? (m.found ? `後備 #input-panel 高 ${m.height}px／頂端距底 ${m.fromBottom}px` : '後備 找不到 #input-panel') : '';
    set('measure', m ? `${v3}；${v1}；iframe 高 ${h}px；採用：${a.src}${a.suspect ? '（' + a.suspect + '）' : ''}` : '等待 chat frame 回報…');
    set('zone', m && m.zone && m.zone.length ? m.zone.map((z) => `${z.el}@${z.top}+${z.h}［${z.use}］`).join('、') : '—');
    set('rows', m && m.rows ? m.rows.join('、') : '—');
    set('layout', layoutText());
    set('anchors', anchorText());
    set('popNow', state.popupNow);
    set('popLast', state.popupLast);
  }

  // ---------------- 錨定與裁切 ----------------
  function placePanel() {
    const { frame, iframe } = els();
    if (!frame || !iframe) return;
    frame.classList.add('ytcas-poc-frame');
    iframe.classList.add('ytcas-poc-iframe');
    let p = document.getElementById(PANEL_ID);
    if (!p) p = buildPanel();
    if (p.parentElement !== frame || p.nextElementSibling !== iframe) frame.insertBefore(p, iframe);
    p.style.height = iframe.offsetHeight + 'px';
    if (state.ro?.__target !== iframe) {
      state.ro?.disconnect();
      state.ro = new ResizeObserver(() => {
        const q = document.getElementById(PANEL_ID);
        if (q) q.style.height = iframe.offsetHeight + 'px';
        applyClip();
        render();
      });
      state.ro.observe(iframe);
      state.ro.__target = iframe;
    }
    watchLayout();
    applyClip();
    render();
  }

  function clipValue() {
    const r = revealPx();
    return r == null ? 'inset(100% 0 0 0)' : `inset(calc(100% - ${r}px) 0 0 0)`;
  }

  function applyClip() {
    const { iframe } = els();
    if (!iframe) return;
    const p = document.getElementById(PANEL_ID);
    if (!state.on) { iframe.style.removeProperty('clip-path'); return; }
    // 摺疊保護（review-3 §3.2）：解除 clip、隱藏面板，不干擾原生聊天室；高度恢復後自動重啟
    const collapsed = isCollapsed();
    if (collapsed !== state.paused) {
      state.paused = collapsed;
      log(collapsed ? '聊天室摺疊，PoC 暫停' : '聊天室恢復，PoC 重啟', layoutInfo());
    }
    if (p) p.style.display = state.paused ? 'none' : '';
    if (state.noClip || state.paused) { iframe.style.removeProperty('clip-path'); return; }
    iframe.style.setProperty('clip-path', clipValue(), 'important');
  }

  // ---------------- 版面診斷（review-3 §4.1-3） ----------------
  const rectStr = (el) => {
    if (!el) return '—';
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map(Math.round).join(',');
  };
  const tagIdOf = (el) => (el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : '—');

  function layoutInfo() {
    const { frame, iframe } = els();
    const p = document.getElementById(PANEL_ID);
    const flexy = document.querySelector(S.top.watchFlexy);
    const attrs = (el, skip = []) => (el ? Array.from(el.attributes)
      .filter((a) => !skip.includes(a.name))
      .map((a) => (a.value ? `${a.name}=${a.value.slice(0, 40)}` : a.name)) : []);
    return {
      frameParent: frame ? `${tagIdOf(frame.parentElement)} < ${tagIdOf(frame.parentElement?.parentElement)}` : '—',
      frameAttrs: attrs(frame, ['style']),
      flexyAttrs: attrs(flexy, ['style']).filter((a) => !a.startsWith('video-id')).slice(0, 30),
      frameRect: rectStr(frame),
      iframeRect: rectStr(iframe),
      panelRect: rectStr(p),
      iframeH: iframeH(),
      reveal: rawRevealPx(),
      clip: iframe ? (iframe.style.clipPath || 'none') : '—',
      collapsed: state.paused,
      noClip: state.noClip,
    };
  }

  function layoutText() {
    const L = layoutInfo();
    return `父元素 ${L.frameParent}｜frame [${L.frameAttrs.join(' ')}] ${L.frameRect}｜iframe ${L.iframeRect}｜面板 ${L.panelRect}｜clip ${L.clip}｜摺疊保護 ${L.collapsed ? '觸發' : '否'}`;
  }

  function diagnostics() {
    return {
      poc: 'v24.1', chrome: chromeVer, time: new Date().toISOString(),
      layout: layoutInfo(),
      mode: state.auto ? 'auto' : 'manual',
      manualPx: state.manualPx,
      auto: autoReveal(),
      measure: state.measure,
      anchors: state.anchors,
      popupNow: state.popupNow,
      popupLast: state.popupLast,
    };
  }

  // 需使用者手勢（按鈕或 Alt+Shift+D）才能寫剪貼簿；失敗時改用暫存 textarea（放在面板內，非浮動元素）
  async function copyDiagnostics() {
    const text = JSON.stringify(diagnostics(), null, 1);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const host = document.getElementById(PANEL_ID) || els().frame || document.body;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;';
      host.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
    }
    log(ok ? '診斷已複製到剪貼簿' : '複製失敗，請從下方訊息複製', ok ? '' : text);
    const b = document.querySelector(`#${PANEL_ID} [data-k="copy"]`);
    if (b) { b.textContent = ok ? '已複製 ✓' : '複製失敗'; setTimeout(() => { b.textContent = '複製診斷'; }, 1500); }
  }

  // 劇院模式／窄版面：監看 ytd-live-chat-frame 屬性與子元素、ytd-watch-flexy 屬性與子樹（rAF 合併）
  function watchLayout() {
    const { frame } = els();
    const flexy = document.querySelector(S.top.watchFlexy);
    const schedule = () => {
      if (state.layoutRaf) return;
      state.layoutRaf = requestAnimationFrame(() => {
        state.layoutRaf = 0;
        if (!state.on) return;
        const { iframe: f } = els();
        const q = document.getElementById(PANEL_ID);
        if (!q || !f || q.nextElementSibling !== f) { placePanel(); return; }
        q.style.height = f.offsetHeight + 'px';
        applyClip();
        render();
      });
    };
    if (frame && state.layoutMo?.__target !== frame) {
      state.layoutMo?.disconnect();
      state.layoutMo = new MutationObserver(schedule);
      state.layoutMo.observe(frame, { attributes: true, childList: true });
      state.layoutMo.__target = frame;
    }
    if (flexy && state.flexyMo?.__target !== flexy) {
      state.flexyMo?.disconnect();
      state.flexyTreeMo?.disconnect();
      // ytd-watch-flexy 本身的屬性（theater、fullscreen 等），不含子樹（避免播放進度等頻繁變化）
      state.flexyMo = new MutationObserver(schedule);
      state.flexyMo.observe(flexy, { attributes: true });
      state.flexyMo.__target = flexy;
      // 聊天室被搬到其他容器
      const movesChat = (n) => n.nodeType === 1 && (n.matches(S.top.liveChatFrame) || !!n.querySelector(S.top.liveChatFrame));
      state.flexyTreeMo = new MutationObserver((list) => {
        if (list.some((m) => Array.from(m.addedNodes).some(movesChat))) schedule();
      });
      state.flexyTreeMo.observe(flexy, { childList: true, subtree: true });
    }
  }

  function toggleNoClip() {
    if (!state.on) return;
    state.noClip = !state.noClip;
    applyClip();
    render();
    log('完全不裁切', state.noClip);
  }

  // ---------------- 訊息（常駐：頂部列開關在 PoC 關閉時也要能用） ----------------
  function onMessage(e) {
    const d = e.data;
    if (!d || d.__ytcas !== true) return;
    const { iframe } = els();
    const fromChat = iframe && e.source === iframe.contentWindow && e.origin === YT;
    if (d.type === 'POC_INPUT') {
      if (!fromChat) return;
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
      state.measure = {
        found: !!d.found, height: num(d.height), fromBottom: num(d.fromBottom),
        rows: Array.isArray(d.rows) ? d.rows.slice(0, 12).map(String) : [],
        vh: num(d.vh), zoneFromBottom: num(d.zoneFromBottom),
        zone: Array.isArray(d.zone) ? d.zone.slice(0, 40).map((z) => ({ el: String(z.el), top: num(z.top), h: num(z.h), parents: String(z.parents || ''), use: String(z.use || '') })) : [],
        algo: String(d.algo || ''),
      };
      if (state.on) { log('量測', state.measure); applyClip(); render(); }
      return;
    }
    if (d.type === 'POC_ANCHOR') {
      if (!fromChat) return;
      state.anchors.header = !!d.header;
      state.anchors.headerHow = d.how || '—';
      state.anchors.headerKids = Array.isArray(d.kids) ? d.kids.slice(0, 16).map(String) : [];
      state.anchors.headerParent = typeof d.parent === 'string' ? d.parent.slice(0, 80) : '—';
      lastPosted = ''; // 可能是新的 chat 文件：重送一次按鈕狀態
      render();
      return;
    }
    if (d.type === C.FM.TOGGLE_PANEL) {
      if (!fromChat) { log('拒絕 TOGGLE_PANEL 來源', e.origin); return; }
      toggle();
      return;
    }
    if (d.type === 'POC_STAT') {
      const f = document.querySelector(`#${PANEL_ID} iframe`);
      if (!f || e.source !== f.contentWindow) return;
      if (e.origin !== state.panelOrigin && e.origin !== 'chrome-extension://' + chrome.runtime.id) { log('拒絕來源', e.origin); return; }
      if (d.kind === 'click') { state.clicks++; state.lastClick = 'iframe #' + d.i; }
      if (d.kind === 'wheel') state.wheels++;
      render();
    }
  }

  // ---------------- 彈窗觀察 ----------------
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  }

  function describe(el, where) {
    return `${where}：${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}（top ${Math.round(el.getBoundingClientRect().top)}px）`;
  }

  // 輔助：頁面上可見的大型 position:fixed 浮層（只取標籤與 id，不讀文字）；已由明確選擇器抓到的不重複列
  function scanLargeOverlays(found, known) {
    const vpArea = innerWidth * innerHeight;
    const ours = (el) => el.id && el.id.startsWith('ytcas-');
    const candidates = [];
    for (const top of document.body.children) {
      candidates.push(top);
      for (const c of top.children) candidates.push(c);
    }
    for (const el of candidates) {
      if (ours(el) || known.some((k) => k === el || k.contains(el) || el.contains(k)) || !isVisible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < vpArea * 0.05) continue;
      if (r.width * r.height > vpArea * 0.95 && (parseInt(cs.zIndex, 10) || 0) < 1000) continue; // 排除整頁版面
      found.push(describe(el, '頁面浮層'));
    }
  }

  function scanPopups() {
    const found = [];
    const known = [];
    // 1. 明確選擇器：頁面層付款視窗（v24 定案）
    S.top.pagePopups.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
      if (isVisible(el)) { known.push(el); found.push(describe(el, '頁面')); }
    }));
    // 1b. 付款視窗遮罩（輔助）
    S.top.pageMasks.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
      if (isVisible(el)) { known.push(el); found.push(describe(el, '頁面遮罩')); }
    }));
    // 2. ytd-popup-container 內的一般對話框（備援）
    const container = document.querySelector(S.top.popupContainer);
    if (container) {
      S.top.popups.forEach((sel) => container.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el)) { known.push(el); found.push(describe(el, '頁面')); }
      }));
    }
    // 3. 輔助：大型 fixed 浮層
    scanLargeOverlays(found, known);
    // 4. chat frame 內（同源時才讀得到）
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

  // body childList ＋ #buyFlowDivId 屬性變化 → 立即重掃；另有 500ms 保底輪詢
  function watchPopups() {
    const observeBuy = () => {
      const buy = document.querySelector(S.top.buyFlow);
      if (buy && state.buyMo?.__target !== buy) {
        state.buyMo?.disconnect();
        state.buyMo = new MutationObserver(scanPopups);
        state.buyMo.observe(buy, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
        state.buyMo.__target = buy;
      }
    };
    state.bodyMo = new MutationObserver(() => { observeBuy(); scanPopups(); });
    state.bodyMo.observe(document.body, { childList: true });
    observeBuy();
    state.popupTimer = setInterval(() => { observeBuy(); scanPopups(); }, 500);
  }

  // ---------------- 開關 ----------------
  function enable() {
    const { frame, iframe } = els();
    if (!frame || !iframe) {
      S.warnOnce('poc:liveChatFrame', '此頁沒有原生聊天室（請開直播頁並確認聊天室已展開）');
      return false;
    }
    ensureStyle();
    state.on = true;
    placePanel();
    // YouTube 重新渲染移除面板或替換 iframe 時重新插入
    state.frameMo = new MutationObserver(() => {
      const p = document.getElementById(PANEL_ID);
      const { iframe: f } = els();
      if (!p || !f || p.nextElementSibling !== f || !f.classList.contains('ytcas-poc-iframe')) placePanel();
    });
    state.frameMo.observe(frame, { childList: true });
    iframe.contentWindow?.postMessage({ __ytcas: true, type: 'POC_INPUT_REQUEST' }, YT);
    watchPopups();
    log('開啟', { chrome: chromeVer });
    return true;
  }

  function disable() {
    const { frame, iframe } = els();
    state.on = false;
    state.noClip = false;
    clearInterval(state.popupTimer);
    state.ro?.disconnect();
    state.ro = null;
    state.frameMo?.disconnect();
    state.bodyMo?.disconnect();
    state.buyMo?.disconnect();
    state.buyMo = null;
    state.layoutMo?.disconnect();
    state.layoutMo = null;
    state.flexyMo?.disconnect();
    state.flexyMo = null;
    state.flexyTreeMo?.disconnect();
    state.flexyTreeMo = null;
    state.paused = false;
    document.getElementById(PANEL_ID)?.remove();
    frame?.classList.remove('ytcas-poc-frame');
    if (iframe) {
      iframe.classList.remove('ytcas-poc-iframe');
      iframe.style.removeProperty('clip-path');
    }
    render();
    log('關閉，已還原（開關按鈕保留）');
  }

  function toggle() {
    if (state.on) disable(); else enable();
    renderEntries();
  }

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); toggle(); }
    if (k === 'u') { e.preventDefault(); toggleNoClip(); }
    if (k === 'd') { e.preventDefault(); copyDiagnostics(); } // 摺疊暫停時面板隱藏，用快速鍵複製診斷
  });
  document.addEventListener('yt-navigate-finish', () => {
    if (state.on) disable();
    state.pageStart = Date.now();
    state.anchors.header = false;
    mountAnchors();
  });
  window.addEventListener('message', onMessage);

  // 聊天室與錨點可能延遲出現或被重建：輕量檢查按鈕是否還在
  state.mountTimer = setInterval(mountAnchors, 1500);
  mountAnchors();
})();
