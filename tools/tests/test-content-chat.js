// T5.1（審查十一第 12 節）：chat frame 環境實際載入 content.js（含 capture.js、panel.js），
// 確認頂部列按鈕掛上、PANEL_STATE／TOGGLE_PANEL／STREAM_INFO／CAPTURE_STATUS 的 frame 訊息，且沒有未捕捉的例外。
(function () {
  'use strict';
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, msg) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(20); } }

  const frame = document.getElementById('chatframe');
  const w = () => frame.contentWindow;
  const d = () => frame.contentDocument;
  const got = []; // chat frame → 本頁（top）的訊息
  const VID = 'vidCHATENV1';
  window.addEventListener('message', (e) => {
    if (e.source !== w() || e.origin !== location.origin || !e.data || e.data.__ytcas !== true) return;
    got.push(e.data);
    // 扮演 top frame：回應場次資訊
    if (e.data.type === 'STREAM_INFO_REQUEST') {
      w().postMessage({ __ytcas: true, type: 'STREAM_INFO', videoId: VID, title: '', channelName: '', channelHandle: '', channelUrl: '',
        startDate: Date.now() - 3600e3, endDate: null, isLiveBroadcast: true, duration: null }, location.origin);
    }
  });
  const toChat = (m) => w().postMessage(Object.assign({ __ytcas: true }, m), location.origin);
  const btn = () => d().getElementById('ytcas-header-btn');

  test('載入 content.js（chatframe 環境）沒有錯誤；頂部列按鈕插在 ⋮ 之前、同一父層；送出 PANEL_STATE { headerMounted: true }', async () => {
    await until(() => w() && w().__loaded, 5000, 'fixture 載入');
    eq(w().__errors, [], '載入時的例外');
    await until(() => btn(), 3000, '頂部列按鈕');
    const menu = d().getElementById('live-chat-header-context-menu');
    eq(btn().nextElementSibling, menu, '在 ⋮ 之前');
    eq(btn().parentElement, menu.parentElement, '同一父層');
    eq([btn().getAttribute('aria-label'), btn().getAttribute('aria-pressed')], ['開啟優化面板', 'false']);
    await until(() => got.some((m) => m.type === 'PANEL_STATE' && m.headerMounted === true), 2000, 'PANEL_STATE headerMounted');
    eq(w().__errors, []);
  });

  test('點擊按鈕 → TOGGLE_PANEL 給 top；top 的 PANEL_STATE 更新按鈕狀態；退讓時停用、點擊不送出', async () => {
    const n0 = got.filter((m) => m.type === 'TOGGLE_PANEL').length;
    btn().click();
    await until(() => got.filter((m) => m.type === 'TOGGLE_PANEL').length === n0 + 1, 2000, 'TOGGLE_PANEL');
    toChat({ type: 'PANEL_STATE', on: true, paused: false, reason: null });
    await until(() => btn().getAttribute('aria-label') === '關閉優化面板', 2000, '開啟中');
    assert(btn().classList.contains('ytcas-on'), '開啟中樣式');
    toChat({ type: 'PANEL_STATE', on: true, paused: true, reason: 'theater' });
    await until(() => btn().classList.contains('ytcas-paused'), 2000, '退讓樣式');
    eq(btn().getAttribute('aria-label'), '劇院模式下無法使用優化面板');
    const n1 = got.filter((m) => m.type === 'TOGGLE_PANEL').length;
    btn().click();
    await sleep(200);
    eq(got.filter((m) => m.type === 'TOGGLE_PANEL').length, n1, '退讓中點擊不送出');
    // 其他來源的 PANEL_STATE 被忽略：iframe 自己送給自己（由 iframe 內的函式送出，e.source 才會是 iframe 本身）
    w().__selfPost({ __ytcas: true, type: 'PANEL_STATE', on: false, paused: false });
    await sleep(150);
    eq(btn().getAttribute('aria-label'), '劇院模式下無法使用優化面板', '只接受 parent 的 PANEL_STATE');
    toChat({ type: 'PANEL_STATE', on: false, paused: false, reason: null });
    await until(() => btn().getAttribute('aria-label') === '開啟優化面板', 2000, '關閉');
    eq(w().__errors, []);
  });

  test('YouTube 重新渲染頂部列（按鈕被移除）→ 1 秒內重新掛上', async () => {
    btn().remove();
    await until(() => btn(), 2500, '重新掛上');
    eq(w().__errors, []);
  });

  test('收錄流程的 frame 訊息：STREAM_INFO_REQUEST → STREAM_INFO → CAPTURE_START → CAPTURE_STATUS（帶 f12、viewMode 欄位）', async () => {
    assert(got.some((m) => m.type === 'STREAM_INFO_REQUEST'), 'STREAM_INFO_REQUEST');
    await until(() => w().__sent.includes('CAPTURE_START'), 3000, 'CAPTURE_START');
    await until(() => got.some((m) => m.type === 'CAPTURE_STATUS' && m.capturing === true && m.videoId === VID), 3000, 'CAPTURE_STATUS');
    const cs = got.filter((m) => m.type === 'CAPTURE_STATUS').pop();
    assert('f12' in cs && 'viewMode' in cs, 'CAPTURE_STATUS 帶 F-12 欄位：' + JSON.stringify(Object.keys(cs)));
  });

  test('T6（6.3）：chat frame 送 CHAT_INPUT_STATE（只有數字與布林）；CHAT_INPUT_REQUEST 重送；PANEL_STATE on → 隱藏原生列表、關閉 → 還原', async () => {
    await until(() => got.some((m) => m.type === 'CHAT_INPUT_STATE'), 2000, 'CHAT_INPUT_STATE');
    const s = got.filter((m) => m.type === 'CHAT_INPUT_STATE').pop();
    eq([typeof s.vh, typeof s.hasInput, typeof s.bottomZoneHeight, typeof s.popupOpen], ['number', 'boolean', 'number', 'boolean']);
    eq(s.hasInput, false, 'fixture 的 #input-panel 沒有高度 → 沒有輸入區');
    const n = got.filter((m) => m.type === 'CHAT_INPUT_STATE').length;
    toChat({ type: 'CHAT_INPUT_REQUEST' });
    await until(() => got.filter((m) => m.type === 'CHAT_INPUT_STATE').length === n + 1, 2000, '重送');
    const vis = () => w().getComputedStyle(d().getElementById('item-list')).visibility;
    toChat({ type: 'PANEL_STATE', on: true, paused: false, reason: null });
    await until(() => vis() === 'hidden', 2000, '隱藏原生列表');
    toChat({ type: 'PANEL_STATE', on: false, paused: false, reason: null });
    await until(() => vis() === 'visible', 2000, '還原');
    eq(w().__errors, []);
  });

  test('整段過程沒有未捕捉的例外（等 F-12 結果與一輪定時工作）', async () => {
    await sleep(6000);
    eq(w().__errors, []);
  });

  // ---------------------------------------------------------------- 執行
  (async () => {
    const list = document.getElementById('list');
    const results = [];
    for (const t of tests) {
      const li = document.createElement('li');
      const t0 = performance.now();
      try { await t.fn(); li.className = 'ok'; li.textContent = '✅ ' + t.name + '（' + Math.round(performance.now() - t0) + ' ms）'; results.push({ name: t.name, ok: true }); }
      catch (e) { li.className = 'ng'; li.textContent = '❌ ' + t.name + ' — ' + (e && e.message); results.push({ name: t.name, ok: false, error: String(e && e.message) }); console.error(e); }
      list.appendChild(li);
    }
    const ok = results.filter((r) => r.ok).length;
    document.getElementById('summary').textContent = '通過 ' + ok + ' / ' + results.length;
    window.__results = results;
  })();
})();
