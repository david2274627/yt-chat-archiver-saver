// T5 優化面板（top frame，src/panel.js）測試：SPEC F-08、F-09、6.2、6.4、4.3。結果顯示在頁面並存於 window.__results。
(function () {
  'use strict';
  const C = self.YTCAS_CONST;
  const S = self.YTCAS_SEL;
  const P = self.YTCAS_PANEL;
  const FM = C.FM;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, msg) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(20); } }

  // ---------------------------------------------------------------- 模擬環境
  let vid = 'vidPANEL001';
  const logs = [];
  const warns = [];
  const flexy = document.querySelector('ytd-watch-flexy');
  const frame = () => document.querySelector('ytd-live-chat-frame');
  const chat = () => document.querySelector('iframe#chatframe');
  const panelEl = () => document.getElementById(P.PANEL_ID);
  const viewerWin = () => { const f = panelEl() && panelEl().querySelector('iframe'); return f && f.contentWindow; };
  // 播放器：可設定的 currentTime／duration／seekable（模擬頁沒有實際影片）
  const video = document.querySelector('video');
  const vs = { t: 0, dur: 3600, seek: null, paused: false };
  Object.defineProperty(video, 'currentTime', { get: () => vs.t, set: (v) => { vs.t = v; video.dispatchEvent(new Event('seeked')); } });
  Object.defineProperty(video, 'duration', { get: () => vs.dur });
  Object.defineProperty(video, 'paused', { get: () => vs.paused });
  Object.defineProperty(video, 'seekable', { get: () => (vs.seek ? { length: 1, start: () => vs.seek[0], end: () => vs.seek[1] } : { length: 0 }) });
  let info = { isLiveBroadcast: false, endDate: null };

  // 影片下方「聊天室／開啟面板」卡片（selectors.js 的 top.chatTeaser）
  function addTeaser() {
    const car = document.getElementById('teaser-carousel');
    car.innerHTML = '<yt-carousel-item-view-model><yt-text-carousel-item-view-model><span>聊天室</span>' +
      '<button-view-model><button type="button">開啟面板</button></button-view-model></yt-text-carousel-item-view-model></yt-carousel-item-view-model>';
    car.querySelector('button').addEventListener('click', () => { window.__nativeOpen = (window.__nativeOpen || 0) + 1; if (!chat()) addChat(); });
  }
  function addChat() {
    const f = document.createElement('iframe');
    f.id = 'chatframe';
    f.src = 'panel-fixtures/chat.html';
    frame().appendChild(f);
    return f;
  }
  const chatLoaded = () => until(() => chat() && chat().contentWindow && chat().contentWindow.sendTop, 3000, 'chat frame 載入');
  const viewerReady = () => until(() => ctl.state().ready, 3000, '面板 PANEL_READY');

  const ctl = P.create({
    doc: document, win: window, C, S, ytOrigin: location.origin, extOrigin: 'chrome-extension://testext',
    viewerUrl: (v) => 'panel-fixtures/viewer.html?embed=1&v=' + encodeURIComponent(v),
    currentVideoId: () => vid,
    streamInfo: () => info,
    warnOnce: (k, d, lv) => warns.push([k, lv]),
    onLog: (reason, data) => logs.push(reason),
  });

  // ---------------------------------------------------------------- 測試
  test('預設開啟（F-09 v24）：面板插入 ytd-live-chat-frame 內、iframe#chatframe 之前；高度等於 iframe；iframe 加 clip（T5：全隱藏）', async () => {
    await chatLoaded();
    ctl.start();
    await until(() => panelEl(), 2000, '面板');
    eq(panelEl().parentElement, frame());
    eq(panelEl().nextElementSibling, chat());
    assert(frame().classList.contains('ytcas-frame') && chat().classList.contains('ytcas-chatframe'), 'class');
    assert(document.getElementById('ytcas-style'), '樣式');
    eq(getComputedStyle(chat()).clipPath, 'inset(100% 0px 0px)', 'T5 clip：iframe 全隱藏、面板佔滿全高');
    eq(panelEl().style.height, chat().offsetHeight + 'px');
    eq(getComputedStyle(panelEl()).position, 'absolute');
    assert(!Array.from(document.querySelectorAll('[id^="ytcas"], .ytcas-entry')).some((e) => getComputedStyle(e).position === 'fixed'), '不得有 position: fixed（10.1 原則 6）');
    assert(panelEl().querySelector('iframe').src.includes('embed=1&v=' + vid), '面板 iframe 網址');
  });

  test('面板握手（4.3）：PANEL_READY → 送 THEME 與 VOD_TIME；深色切換即時送出；SEEK_TO 跳轉（限制在可回放範圍）', async () => {
    await viewerReady();
    const w = viewerWin();
    await until(() => w.got.some((m) => m.type === FM.THEME), 2000, 'THEME');
    eq(w.got.find((m) => m.type === FM.THEME).theme, 'light');
    document.documentElement.setAttribute('dark', '');
    await until(() => w.got.filter((m) => m.type === FM.THEME).length >= 2, 2000, '深色');
    eq(w.got.filter((m) => m.type === FM.THEME).pop().theme, 'dark');
    document.documentElement.removeAttribute('dark');
    vs.t = 123.4;
    await until(() => w.got.some((m) => m.type === FM.VOD_TIME && Math.abs(m.currentTime - 123.4) < 0.01), 2000, 'VOD_TIME');
    const vt = w.got.filter((m) => m.type === FM.VOD_TIME).pop();
    eq([vt.duration, vt.live, typeof vt.at], [3600, false, 'number']);
    w.sendTop(FM.SEEK_TO, { seconds: 600 });
    await until(() => vs.t === 600, 2000, 'SEEK_TO');
    vs.seek = [100, 500];
    w.sendTop(FM.SEEK_TO, { seconds: 900 });
    await until(() => vs.t === 500, 2000, '超過可回放範圍 → 限制在 seekEnd');
    vs.seek = null;
    // 直播：VOD_TIME 帶 live 與 DVR 範圍
    info = { isLiveBroadcast: true, endDate: null };
    vs.seek = [6400, 10000]; vs.t = 9990;
    await until(() => { const m = w.got.filter((x) => x.type === FM.VOD_TIME).pop(); return m && m.live && m.seekEnd === 10000; }, 2000, '直播 clock');
    // v43（T5.2）：seeked 累計次數；「直播」徽章的判定（找不到 → null、disabled → 在最新、可點 → 不在最新）
    const last = () => w.got.filter((x) => x.type === FM.VOD_TIME).pop();
    eq([last().liveHead, last().badge], [null, 'missing']);
    const n0 = last().seeks;
    video.currentTime = 9900; // 設定 currentTime 會觸發 seeked
    await until(() => last().seeks === n0 + 1 && last().currentTime === 9900, 2000, 'seeks +1');
    const player = document.createElement('div'); player.className = 'html5-video-player';
    const badge = document.createElement('button'); badge.className = 'ytp-live-badge'; badge.textContent = 'LIVE'; badge.disabled = true;
    player.appendChild(badge); document.body.appendChild(player);
    await until(() => last().liveHead === true && last().badge === 'disabled', 2000, '徽章：在最新');
    badge.disabled = false;
    await until(() => last().liveHead === false && last().badge === 'behind', 2000, '徽章：不在最新');
    // v47（T5.6，審查十一 26.2）網址帶 t=（或 start=、#t=）→ urlT: true
    eq(last().urlT, false, '網址沒有 t=');
    const href0 = location.href;
    history.replaceState(null, '', location.pathname + '?v=x&t=600s');
    await until(() => last().urlT === true, 2000, 'urlT');
    history.replaceState(null, '', href0);
    await until(() => last().urlT === false, 2000, 'urlT 還原');
    player.remove();
    info = { isLiveBroadcast: false, endDate: null }; vs.seek = null;
  });

  test('只接受預期來源的訊息：其他 frame 或錯誤 origin 送來的 SEEK_TO／PANEL_CLOSE 被忽略', async () => {
    vs.t = 1;
    // 本頁自己（不是面板 iframe）送的
    window.postMessage({ __ytcas: true, type: FM.SEEK_TO, seconds: 77 }, location.origin);
    window.postMessage({ __ytcas: true, type: FM.PANEL_CLOSE }, location.origin);
    await sleep(150);
    eq(vs.t, 1);
    assert(ctl.state().mounted, '面板仍開著');
    // chat frame 送 SEEK_TO：不是面板 → 忽略
    chat().contentWindow.sendTop(FM.SEEK_TO, { seconds: 88 });
    await sleep(150);
    eq(vs.t, 1);
    // 偽造 origin（直接呼叫處理函式）：面板來源但 origin 不符
    ctl._onMessage({ source: viewerWin(), origin: 'https://evil.example', data: { __ytcas: true, type: FM.SEEK_TO, seconds: 99 } });
    eq(vs.t, 1);
  });

  test('退讓（6.2、6.4）：劇院模式與聊天室太矮時移除 clip、隱藏面板；條件解除後自動恢復；chat frame 收到 PANEL_STATE', async () => {
    flexy.setAttribute('theater', '');
    await until(() => ctl.state().paused, 2500, '劇院模式退讓');
    eq(ctl.state().pauseReason, 'theater');
    eq(getComputedStyle(chat()).clipPath, 'none');
    eq(getComputedStyle(panelEl()).display, 'none');
    // T5.1（13.1 (D)，P1）：退讓時 ytd-live-chat-frame／iframe 不得留下套件的定位樣式（與沒有套件時相同）
    eq([getComputedStyle(frame()).position, getComputedStyle(chat()).position, getComputedStyle(chat()).zIndex], ['static', 'static', 'auto'], '退讓時沒有定位樣式');
    await until(() => chat().contentWindow.got.some((m) => m.type === FM.PANEL_STATE && m.paused && m.reason === 'theater'), 2000, 'PANEL_STATE');
    flexy.removeAttribute('theater');
    await until(() => !ctl.state().paused, 2500, '恢復');
    eq(getComputedStyle(chat()).clipPath, 'inset(100% 0px 0px)');
    eq([getComputedStyle(frame()).position, getComputedStyle(chat()).position], ['relative', 'relative'], '恢復後才套用定位');
    chat().style.height = '150px';
    await until(() => ctl.state().paused && ctl.state().pauseReason === 'small', 2500, '太矮');
    chat().style.height = '';
    await until(() => !ctl.state().paused, 2500, '恢復');
    eq(panelEl().style.height, chat().offsetHeight + 'px', '高度跟著 iframe');
    assert(logs.includes('panel-pause') && logs.includes('panel-resume'), '記錄退讓與恢復');
  });

  test('YouTube 重新渲染（6.2 第 3 點、6.4）：面板被移除 → 重新插入；iframe 被替換 → 重新初始化', async () => {
    panelEl().remove();
    await until(() => panelEl() && panelEl().nextElementSibling === chat(), 2000, '重新插入');
    const old = chat();
    old.remove();
    const nf = addChat();
    await until(() => panelEl() && panelEl().nextElementSibling === nf && nf.classList.contains('ytcas-chatframe'), 2500, '新 iframe');
    await chatLoaded();
  });

  test('開關（F-09）：面板的「關閉優化面板」→ 完全還原、本影片不自動重開；chat frame 頂部列的 TOGGLE_PANEL 再開啟；換影片預設開啟', async () => {
    await viewerReady();
    viewerWin().sendTop(FM.PANEL_CLOSE);
    await until(() => !ctl.state().mounted, 2000, '關閉');
    assert(!panelEl() && !document.getElementById('ytcas-style'), '面板與樣式移除');
    assert(!document.querySelector('.ytcas-frame, .ytcas-chatframe'), 'class 移除');
    eq(getComputedStyle(chat()).clipPath, 'none', '原生聊天室 100% 還原（6.5 AC 7）');
    await sleep(1300); // 看門狗跑過一次：不重開
    assert(!ctl.state().mounted, '本影片不自動重開（不記住只對本頁面有效）');
    chat().contentWindow.sendTop(FM.TOGGLE_PANEL);
    await until(() => ctl.state().mounted, 2000, 'TOGGLE_PANEL 開啟');
    chat().contentWindow.sendTop(FM.TOGGLE_PANEL);
    await until(() => !ctl.state().mounted, 2000, 'TOGGLE_PANEL 關閉');
    vid = 'vidPANEL002';
    await until(() => ctl.state().mounted, 2500, '換影片 → 預設開啟');
    assert(panelEl().querySelector('iframe').src.includes('v=vidPANEL002'), '面板換成新影片');
  });

  test('影片下方卡片（F-09 錨點 3）：按鈕插在「開啟面板」右側；聊天室關閉（✕）時點擊先展開原生聊天室再開啟面板', async () => {
    addTeaser();
    await until(() => document.getElementById('ytcas-teaser-btn'), 2500, '卡片按鈕');
    const b = document.getElementById('ytcas-teaser-btn');
    eq(b.previousElementSibling.tagName.toLowerCase(), 'button-view-model');
    eq(b.textContent, '關閉優化面板');
    assert(b.classList.contains('ytcas-on'), '開啟中：紅色');
    // 聊天室被 ✕ 關閉：iframe 移除 → 面板一併關閉
    chat().remove();
    await until(() => !ctl.state().mounted, 2500, '聊天室關閉 → 面板關閉');
    await until(() => document.getElementById('ytcas-teaser-btn').textContent === '開啟優化面板', 2000, '按鈕文字');
    window.__nativeOpen = 0;
    document.getElementById('ytcas-teaser-btn').click();
    await until(() => ctl.state().mounted, 3000, '展開聊天室並開啟面板');
    eq(window.__nativeOpen, 1, '先按原生「開啟面板」');
    // 劇院模式時卡片按鈕為低調停用樣式（不用紅色）
    flexy.setAttribute('theater', '');
    await until(() => document.getElementById('ytcas-teaser-btn').classList.contains('ytcas-paused'), 2500, '停用樣式');
    const tb = document.getElementById('ytcas-teaser-btn');
    assert(!tb.classList.contains('ytcas-on') && tb.textContent.includes('劇院模式'), '劇院模式文字');
    flexy.removeAttribute('theater');
    await until(() => !ctl.state().paused, 2500);
  });

  test('舊版面（F-09 錨點 4）：可見的「隱藏聊天室」列才掛按鈕；destroy 後全部還原', async () => {
    const sh = document.createElement('div');
    sh.id = 'show-hide-button';
    frame().appendChild(sh);
    await until(() => document.getElementById('ytcas-legacy-btn'), 2500, '舊版列按鈕');
    sh.style.display = 'none';
    await until(() => !document.getElementById('ytcas-legacy-btn'), 2500, '隱藏的列不掛');
    sh.remove();
    ctl.destroy();
    assert(!panelEl() && !document.getElementById('ytcas-style') && !document.querySelector('.ytcas-entry, .ytcas-frame, .ytcas-chatframe'), '全部還原');
    eq(getComputedStyle(chat()).clipPath, 'none');
    eq(warns.length, 0, '有錨點時不警告');
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
