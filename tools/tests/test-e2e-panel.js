// T5.1 端對端（審查十一 13.1 (A)(B)）：top 端真實 panel.js ↔ 面板 iframe 內真實 viewer.js。
// 只有 YT_ORIGIN 換成本機 origin、資料庫換成測試資料庫；訊息路徑（postMessage 的 targetOrigin、source、origin 檢查）與實機相同。
(function () {
  'use strict';
  const C = self.YTCAS_CONST, S = self.YTCAS_SEL, P = self.YTCAS_PANEL, DB = self.YTCAS_DB;
  const TEST_DB = 'test-e2e-ytcas-v3';
  DB.configure({ dbName: TEST_DB });
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, msg) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 4000)) throw new Error('逾時：' + (typeof msg === 'function' ? msg() : msg || '')); await sleep(25); } }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  // ---------------------------------------------------------------- 資料
  const NOW = Date.now();
  const VOD = 'vidE2EVOD01', LIVE = 'vidE2ELIVE1';
  const base = { type: 'text', authorHandle: '@guest', authorBadges: [], phase: 'live', sources: ['live'], deleted: false, aliasIds: [], firstSeenAt: NOW, lastSeenAt: NOW };
  const vodMsgs = [], liveMsgs = [];
  for (let i = 0; i < 300; i++) vodMsgs.push(Object.assign({}, base, { id: 'v' + i, videoId: VOD, timestampAbs: NOW - 86400e3 + i * 10e3, videoOffsetSec: i * 10, offsets: { v1: i * 10 }, runs: [{ text: 'VOD ' + i }] }));
  for (let i = 0; i < 300; i++) liveMsgs.push(Object.assign({}, base, { id: 'l' + i, videoId: LIVE, timestampAbs: NOW - (300 - i) * 10e3, videoOffsetSec: 1000 + i * 10, offsets: { v1: 1000 + i * 10 }, runs: [{ text: '直播 ' + i }] }));
  async function seed() {
    await DB.close();
    await req(indexedDB.deleteDatabase(TEST_DB));
    const db = await DB.open();
    const t = db.transaction(['streams', 'messages'], 'readwrite');
    t.objectStore('streams').put({ videoId: VOD, title: 'E2E VOD', isLive: true, startedAt: NOW - 86400e3, endedAt: NOW - 86400e3 + 3000e3, lastMessageAt: NOW - 86400e3 + 2990e3, messageCount: 300, versions: [{ id: 'v1', duration: 3000, label: '原始' }], linkedVideos: [] });
    t.objectStore('streams').put({ videoId: LIVE, title: 'E2E 直播', isLive: true, startedAt: NOW - 3000e3, lastMessageAt: NOW - 10e3, messageCount: 300, versions: [], linkedVideos: [] });
    for (const m of vodMsgs.concat(liveMsgs)) t.objectStore('messages').put(m);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    await DB.close();
  }

  // ---------------------------------------------------------------- 模擬播放器與頁面
  let vid = VOD;
  let info = { isLiveBroadcast: false, endDate: NOW - 86400e3 + 3000e3 };
  const video = document.querySelector('video');
  const vs = { t: 0, dur: 3000, seek: null, paused: false };
  Object.defineProperty(video, 'currentTime', { get: () => vs.t, set: (v) => { vs.t = v; video.dispatchEvent(new Event('seeked')); } });
  Object.defineProperty(video, 'duration', { get: () => vs.dur });
  Object.defineProperty(video, 'paused', { get: () => vs.paused });
  Object.defineProperty(video, 'seekable', { get: () => (vs.seek ? { length: 1, start: () => vs.seek[0], end: () => vs.seek[1] } : { length: 0 }) });

  const panelFrame = () => { const p = document.getElementById(P.PANEL_ID); return p && p.querySelector('iframe'); };
  const vw = () => { const f = panelFrame(); try { return f && f.contentWindow && f.contentWindow.location.hostname === '127.0.0.1' ? f.contentWindow : null; } catch (_) { return null; } };
  const vd = () => panelFrame() && panelFrame().contentDocument;
  const viewer = () => vw() && vw().YTCAS_VIEWER && vw().YTCAS_VIEWER.current;
  const cur = () => { const d = vd(); const n = d && d.querySelector('.vrow > .current'); return n ? n.dataset.id : null; };
  const errs = () => (vw() && vw().__errors) || [];
  const diag = () => JSON.stringify({ errs: errs(), msgs: vw() && vw().__frameMsgs && vw().__frameMsgs.slice(-6), mode: viewer() && viewer().state.mode, clock: !!(viewer() && viewer().state.clock), ready: ctl.state().ready });

  const ctl = P.create({
    // 面板 src 用 localhost、載入後轉到本頁 origin（127.0.0.1）：模擬 use_dynamic_url（src 是動態 ID、實際 origin 是擴充功能 ID）。
    // extOrigin＝實際 origin（對應 'chrome-extension://' + runtime.id）
    doc: document, win: window, C, S, ytOrigin: location.origin, extOrigin: location.origin,
    viewerUrl: (v) => location.origin.replace('//127.0.0.1:', '//localhost:') + '/tools/tests/content-fixtures/viewer-env.html?embed=1&hop=1&v=' + encodeURIComponent(v) + '&db=' + TEST_DB,
    currentVideoId: () => vid,
    streamInfo: () => info,
  });

  async function viewerLoaded(v) {
    await until(() => panelFrame() && panelFrame().src.includes('v=' + v), 4000, '面板網址');
    assert(panelFrame().src.startsWith('http://localhost:'), 'src 為 localhost（與實際 origin 不同）');
    await until(() => vw() && vw().__loaded && viewer(), 6000, '面板載入');
    await viewer().ready;
    await until(() => ctl.state().ready, 4000, 'PANEL_READY');
    eq(errs(), [], '面板 iframe 的例外');
  }
  // 面板 iframe 在背景頁時捲動事件與 rAF 不一定觸發：使用者捲動以 wheel＋scroll 事件模擬
  function userScrollTop(y) {
    const list = vd().querySelector('.list');
    list.dispatchEvent(new (vw().Event)('wheel'));
    list.scrollTop = y;
    list.dispatchEvent(new (vw().Event)('scroll'));
  }

  // ---------------------------------------------------------------- 測試
  test('VOD：播放器時間 → VOD_TIME → 面板出現目前訊息框並捲到可視範圍；拖曳後跟上', async () => {
    await seed();
    ctl.start();
    await viewerLoaded(VOD);
    vs.t = 1505;
    await until(() => cur() === 'v150', 4000, () => '目前訊息框 ' + cur() + ' ' + diag());
    const list = vd().querySelector('.list'), row = vd().querySelector('.vrow > .current');
    const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
    assert(rr.top >= lr.top - 2 && rr.bottom <= lr.bottom + 2, '目前訊息在可視範圍');
    video.currentTime = 2505; // 拖曳（seeked）
    await until(() => cur() === 'v250', 4000, () => '拖曳後 ' + cur() + ' ' + diag());
  });

  test('VOD：使用者捲動 → 暫停；「↓ 回到播放位置」回到目前訊息（不是清單最後）', async () => {
    userScrollTop(0);
    await until(() => viewer().state.syncPaused, 3000, () => '暫停 ' + diag());
    const resume = vd().querySelector('.resume');
    assert(!resume.hidden && resume.textContent.includes('回到播放位置'), '按鈕文字 ' + resume.textContent);
    vs.t = 1005;
    await until(() => viewer().state.currentId === 'v100', 3000, '暫停中仍更新目前訊息（該列不在畫面上，以狀態確認）');
    resume.click();
    await sleep(300);
    const list = vd().querySelector('.list'), row = vd().querySelector('.vrow > .current');
    assert(row, '目前訊息列存在');
    const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect();
    assert(rr.top >= lr.top - 2 && rr.bottom <= lr.bottom + 2, '回到目前訊息（v100），不是清單最後');
    assert(list.scrollTop < list.scrollHeight - list.clientHeight - 100, '不在清單底部');
  });

  test('直播：在直播邊緣跟隨到底；倒轉 10 分鐘 → 同步到當時的訊息並加框；回到直播邊緣 → 恢復跟隨到底', async () => {
    vid = LIVE;
    info = { isLiveBroadcast: true, endDate: null };
    vs.dur = 3600; vs.seek = [0, 3600]; vs.t = 3598;
    await viewerLoaded(LIVE);
    await until(() => viewer().state.clock && viewer().state.clock.live, 3000, () => '直播 clock ' + diag());
    eq(viewer().state.mode, 'tail');
    assert(viewer().state.vl.follow, '跟隨到底');
    video.currentTime = 3000; // 倒轉 600 秒
    await until(() => viewer().state.mode === 'sync' && cur(), 4000, () => '倒轉後 ' + diag());
    const m = liveMsgs.find((x) => x.id === cur());
    const target = NOW - 600e3;
    assert(m && Math.abs(m.timestampAbs - target) <= 15e3, '同步到約 10 分鐘前：' + cur());
    video.currentTime = 3599; // 回到直播邊緣
    await until(() => viewer().state.mode === 'tail' && !cur(), 4000, () => '回到最新 ' + diag());
    assert(viewer().state.vl.follow, '恢復跟隨到底');
  });

  test('(B) background 推播 NEW_MESSAGES → 面板即時出現；標頭訊息數與「全部」一致', async () => {
    const v = viewer();
    const listeners = vw().__mock.listeners.message;
    assert(listeners.length >= 1, '面板有註冊 chrome.runtime.onMessage');
    const nm = [0, 1, 2].map((k) => Object.assign({}, base, { id: 'n' + k, videoId: LIVE, timestampAbs: Date.now() + k, videoOffsetSec: 5000 + k, runs: [{ text: '新訊息 ' + k }] }));
    for (const f of listeners) f({ type: 'NEW_MESSAGES', videoId: LIVE, messages: nm }, { id: 'testextid' }, () => {});
    await until(() => vd().querySelector('[data-id="n2"]'), 3000, '新訊息出現');
    const meta = vd().querySelector('.p-top .meta').textContent;
    const all = vd().querySelector('.pill[data-pill="all"] .num').textContent;
    assert(meta.includes('303'), '標頭 ' + meta);
    eq(all, '303', '「全部」');
    eq(v.state.items.length, 303);
  });

  test('整段過程面板 iframe 沒有未捕捉的例外', async () => {
    eq(errs(), []);
    ctl.destroy();
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
