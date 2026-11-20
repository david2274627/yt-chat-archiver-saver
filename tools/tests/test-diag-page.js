// F-20 診斷控制頁測試（T3.8 F）：按鈕三種狀態、分鐘與絕對時間互斥、超過上限的提示與實際停止時間、尚未匯出提示
(function () {
  'use strict';
  const BG = self.YTCAS_BG;
  const M = self.__mock;
  const DB = self.YTCAS_DB;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, m) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (m || '')); await sleep(30); } }
  const PAGE = { id: 'testextid', url: 'chrome-extension://testextid/tools/diag.html' };
  // 控制頁的 runtime.sendMessage → 真正的 background 處理函式（以擴充功能頁面身分）
  chrome.runtime.sendMessage = (msg) => new Promise((res) => {
    let done = false;
    const ret = M.listeners.message[0](msg, PAGE, (r) => { done = true; res(r); });
    if (ret !== true && !done) res(undefined);
  });
  window.confirm = () => true;
  const $ = (id) => document.getElementById(id);
  const MIN = 60000;
  const localInput = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const set = (id, v) => { const el = $(id); if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };

  async function loadPage() {
    const html = await (await self.__sameOriginFetch('../diag.html')).text(); // 只讀同一來源的檔案（keep-fetch.js）
    const doc = new DOMParser().parseFromString(html, 'text/html');
    $('host').append(doc.querySelector('main'));
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '../diag.js'; s.onload = res; s.onerror = rej; document.body.append(s); });
  }

  // ---------------------------------------------------------------- 純函式
  test('buttonState：未記錄（開始，accent）／記錄中（停止記錄（剩 mm:ss），danger）／已排程（取消排程（hh:mm 開始），次要）', () => {
    const U = self.YTCAS_DIAG_UI;
    const now = new Date(2026, 10, 17, 9, 0, 0).getTime();
    eq(U.buttonState(null, now), { action: 'start', cls: 'primary', label: '開始記錄' });
    eq(U.buttonState({ active: true, endsAt: now + 9 * MIN + 5000 }, now), { action: 'stop', cls: 'danger', label: '停止記錄（剩 09:05）' });
    eq(U.buttonState({ active: true, endsAt: now + 125 * MIN + 30000 }, now).label, '停止記錄（剩 125:30）', '超過 60 分鐘');
    eq(U.buttonState({ scheduled: true, startAt: new Date(2026, 10, 17, 21, 5).getTime() }, now), { action: 'cancel', cls: 'secondary', label: '取消排程（21:05 開始）' });
  });

  test('computePlan：分鐘與指定結束時間互斥（只採用被選的一個）；超過最長時限時提示並以上限為準；輸入錯誤', () => {
    const U = self.YTCAS_DIAG_UI;
    const now = new Date(2026, 10, 17, 9, 0, 0).getTime();
    let p = U.computePlan({ endMode: 'minutes', minutes: 10, endAt: now + 300 * MIN, hours: 6 }, now);
    eq([p.ok, p.endAt - now, p.exceeds, p.opts.endAt - now], [true, 10 * MIN, false, 10 * MIN], '分鐘模式忽略結束時間');
    p = U.computePlan({ endMode: 'end', minutes: 999, endAt: now + 30 * MIN, hours: 6 }, now);
    eq([p.endAt - now, p.exceeds], [30 * MIN, false], '結束時間模式忽略分鐘');
    p = U.computePlan({ endMode: 'minutes', minutes: 120, hours: 1 }, now);
    eq([p.exceeds, p.effectiveEnd - now, p.warning], [true, 60 * MIN, '超過最長時限 1 小時，將於上限時停止（10:00）']);
    p = U.computePlan({ endMode: 'minutes', minutes: 1441, hours: 6 }, now);
    eq(p.ok, false);
    eq(U.computePlan({ endMode: 'end', endAt: now - MIN, hours: 6 }, now).ok, false, '結束早於開始');
    p = U.computePlan({ schedule: true, startAt: now + 60 * MIN, endMode: 'minutes', minutes: 10, hours: 6 }, now);
    eq([p.scheduled, p.opts.startAt - now, p.endAt - now], [true, 60 * MIN, 70 * MIN], '排程開始');
    eq(U.computePlan({ schedule: true, startAt: null, endMode: 'minutes', minutes: 10, hours: 6 }, now).ok, false);
    // v44（T5.3，18.4）P9 取樣間隔：診斷頁預設 1 分鐘；1～30 的整數
    eq(U.computePlan({ endMode: 'minutes', minutes: 10, hours: 6 }, now).opts.p9Minutes, 1, '預設 1 分鐘');
    eq(U.computePlan({ endMode: 'minutes', minutes: 10, hours: 6, p9Minutes: '3' }, now).opts.p9Minutes, 3);
    for (const bad of ['0', '31', '1.5', 'x']) eq(U.computePlan({ endMode: 'minutes', minutes: 10, hours: 6, p9Minutes: bad }, now).ok, false, 'P9 ' + bad);
    assert(document.getElementById('p9Minutes') ? document.getElementById('p9Minutes').value === '1' : true, '診斷頁欄位預設 1');
  });

  test('T5.4 輸出檔名格式（20.6）：預設與現行一致、參數取記錄開始時間、非法字元轉成 _、不提供 videoId；診斷頁欄位與預覽', async () => {
    const C = self.YTCAS_CONST;
    const t = new Date(2026, 10, 20, 19, 50, 7).getTime();
    eq(C.diagFileName(C.DIAG_FILE_FORMAT_DEFAULT, t, []), 'ytcas-diag-26_11_20_19_50');
    eq(C.diagFileName('ytcas-diag-{yyyy}{MM}{dd}-{HH}{mm}', t), 'ytcas-diag-20261120-1950');
    eq(C.diagFileName('x-{yyyy}-{MM}-{dd}_{HH}{mm}{ss}_{probes}', t, ['P1', 'P9', 'P10', 'bad']), 'x-2026-11-20_195007_P1-P9-P10');
    eq(C.diagFileName('診斷 {videoId}/../{HH}', t), 'videoId__.._19', '非法字元與未知參數 → _（開頭的 _ 去掉；{videoId} 不是參數，只剩字面文字）');
    eq(C.diagFileName('', t), 'ytcas-diag-26_11_20_19_50', '空白 → 預設');
    eq(C.diagFileName('////', t), 'ytcas-diag-26_11_20_19_50', '全部非法 → 預設');
    await until(() => $('fileFormat') && $('fileFormat').value === C.DIAG_FILE_FORMAT_DEFAULT, 3000, '欄位預設');
    assert(/^預覽：ytcas-diag-\d\d_\d\d_\d\d_\d\d_\d\d\.json/.test($('filePreview').textContent), $('filePreview').textContent);
    $('fileFormat').value = 'mine-{HH}{mm}'; $('fileFormat').dispatchEvent(new Event('input'));
    assert(/^預覽：mine-\d{4}\.json/.test($('filePreview').textContent), $('filePreview').textContent);
    eq($('filePreset').value, '', '自訂');
    await sleep(500);
    eq((await chrome.storage.local.get(C.DIAG_FILE_FORMAT_KEY))[C.DIAG_FILE_FORMAT_KEY], 'mine-{HH}{mm}', '記在 storage.local');
    $('filePreset').value = C.DIAG_FILE_FORMAT_DEFAULT; $('filePreset').dispatchEvent(new Event('change'));
    eq($('fileFormat').value, C.DIAG_FILE_FORMAT_DEFAULT);
  });

  // ---------------------------------------------------------------- 畫面整合
  test('畫面：初始為「開始記錄」；結束方式切換時另一個欄位停用；勾選排程才顯示開始時間', async () => {
    await until(() => $('btn-toggle').textContent === '開始記錄', 3000);
    eq([$('btn-toggle').className, $('minutes').disabled, $('endAt').disabled, $('start-field').hidden], ['primary', false, true, true]);
    set('mode-end', true);
    eq([$('minutes').disabled, $('endAt').disabled], [true, false]);
    set('mode-minutes', true);
    eq([$('minutes').disabled, $('endAt').disabled], [false, true]);
    set('schedule', true);
    eq($('start-field').hidden, false);
    set('schedule', false);
    eq($('minutes').value, '10', '預設 10 分鐘');
  });

  test('畫面：記錄 10 分鐘 → 按鈕變成「停止記錄（剩 mm:ss）」並每秒更新；實際停止時間 = 開始 + 10 分鐘；按下立即停止', async () => {
    set('minutes', '10');
    $('btn-toggle').click();
    await until(() => /^停止記錄（剩 \d\d:\d\d）$/.test($('btn-toggle').textContent), 3000, '記錄中按鈕');
    eq($('btn-toggle').className, 'danger');
    const st = await BG.diag.status();
    eq([st.active, st.endsAt - st.startAt], [true, 10 * MIN]);
    const first = $('btn-toggle').textContent;
    await sleep(2200);
    assert($('btn-toggle').textContent !== first, '剩餘時間每秒更新');
    assert($('minutes').disabled && $('mode-end').disabled, '記錄中表單鎖定');
    $('btn-toggle').click();
    await until(() => $('btn-toggle').textContent === '開始記錄', 3000, '停止後');
    eq((await BG.diag.status()).reason, 'manual');
  });

  test('畫面（B-3）：上一段有紀錄且尚未匯出 → 顯示提示與「先匯出再開始」；按下後先下載再開始', async () => {
    await DB.diagAppend([{ ts: Date.now(), probe: 'P1', kind: 'x', data: {} }]);
    await until(() => !$('unexported').hidden, 3000, '尚未匯出提示');
    eq($('btn-export-start').hidden, false);
    const before = chrome.downloads._list.length;
    $('btn-export-start').click();
    await until(() => chrome.downloads._list.length === before + 1, 3000, '下載');
    // v45（20.6）預設格式 ytcas-diag-{yy}_{MM}_{dd}_{HH}_{mm}（記錄開始時間）
    assert(/^YT聊天室診斷\/ytcas-diag-\d\d_\d\d_\d\d_\d\d_\d\d\.json$/.test(chrome.downloads._list[before].filename), chrome.downloads._list[before].filename);
    await until(async () => (await BG.diag.status()).active, 3000, '接著開始');
    await until(() => $('unexported').hidden, 3000);
    $('btn-toggle').click();
    await until(() => $('btn-toggle').textContent === '開始記錄', 3000);
    await BG.diag.clear();
  });

  test('畫面：超過最長時限 → 即時提示「超過最長時限 X 小時，將於上限時停止」，實際停止時間以上限為準', async () => {
    $('host').querySelector('details').open = true;
    set('hours', '1');
    set('minutes', '120');
    assert(!$('limit-warn').hidden && $('limit-warn').textContent.startsWith('超過最長時限 1 小時，將於上限時停止'), $('limit-warn').textContent);
    $('btn-toggle').click();
    await until(async () => (await BG.diag.status()).active, 3000);
    const st = await BG.diag.status();
    eq(st.endsAt - st.startAt, 60 * MIN, '以上限為準');
    $('btn-toggle').click();
    await until(() => $('btn-toggle').textContent === '開始記錄', 3000);
    set('hours', '6'); set('minutes', '10');
    await BG.diag.clear();
  });

  test('畫面：排程開始 → 「取消排程（hh:mm 開始）」次要樣式；按下取消；Enter 在分鐘欄位等同開始', async () => {
    const at = Math.floor((Date.now() + 2 * 3600e3) / MIN) * MIN; // datetime-local 只到分鐘
    set('schedule', true);
    set('startAt', localInput(at));
    $('btn-toggle').click();
    await until(() => $('btn-toggle').textContent.startsWith('取消排程（'), 3000, '排程按鈕');
    eq($('btn-toggle').className, 'secondary');
    const st = await BG.diag.status();
    eq([st.scheduled, st.active, Math.round((st.startAt - at) / MIN)], [true, false, 0]);
    $('btn-toggle').click();
    await until(() => $('btn-toggle').textContent === '開始記錄', 3000, '取消後');
    eq((await BG.diag.status()).scheduled, false);
    set('schedule', false);
    $('minutes').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(async () => (await BG.diag.status()).active, 3000, 'Enter 開始');
    await until(() => $('btn-toggle').textContent.startsWith('停止記錄') && !$('btn-toggle').disabled, 3000, '按鈕更新為停止');
    $('btn-toggle').click();
    await until(async () => !(await BG.diag.status()).active && $('btn-toggle').textContent === '開始記錄', 3000, '停止');
  });

  test('畫面：請求進行中切換按鈕停用（連按不會重複開始）', async () => {
    $('btn-toggle').click();
    $('btn-toggle').click(); // 第二次在請求進行中，應被忽略
    await until(() => $('btn-toggle').textContent.startsWith('停止記錄') && !$('btn-toggle').disabled, 3000);
    eq((await BG.diag.status()).active, true);
    $('btn-toggle').click();
    await until(async () => !(await BG.diag.status()).active && $('btn-toggle').textContent === '開始記錄', 3000);
  });

  async function run() {
    const out = [];
    await DB.close();
    await new Promise((r) => { const q = indexedDB.deleteDatabase(M.TEST_DB); q.onsuccess = q.onerror = r; });
    await BG.diag.clear();
    await loadPage();
    for (const t of tests) {
      const li = document.createElement('li');
      let ok = true, err = '';
      try { await t.fn(); } catch (e) { ok = false; err = String(e && e.message || e); console.error(t.name, e); }
      li.className = ok ? 'ok' : 'ng';
      li.textContent = (ok ? '✅ ' : '❌ ') + t.name + (err ? '：' + err : '');
      $('list').append(li);
      out.push({ name: t.name, ok, err });
    }
    const pass = out.filter((r) => r.ok).length;
    $('summary').textContent = pass + '／' + out.length + ' 通過';
    window.__results = { pass, total: out.length, results: out };
  }
  run();
})();
