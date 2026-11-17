// T4 檢視器測試（SPEC F-04～F-07、F-13、F-14、10.4、第 7 節效能／安全）。結果顯示在頁面並存於 window.__results。
(function () {
  'use strict';
  const DB = self.YTCAS_DB;
  const CORE = self.YTCAS_VIEWER_CORE;
  const V = self.YTCAS_VIEWER;
  const TEST_DB = 'test-viewer-ytcas-v3';
  DB.configure({ dbName: TEST_DB });
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 頁面在背景時 requestAnimationFrame 不會觸發：以 setTimeout 保底
  const frame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => requestAnimationFrame(f)); setTimeout(f, 80); });
  async function until(fn, ms, msg) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(20); } }

  const VID = 'vidVIEWER01', VBIG = 'vidVIEWERBG';
  const T0 = Date.parse('2026-11-17T20:00:00+08:00');
  // 虛構資料
  function mk(o) {
    return Object.assign({ videoId: VID, type: 'text', authorHandle: '@guest', authorChannelId: '', authorUrl: '', authorAvatar: '', authorBadges: [],
      runs: [{ text: '安安' }], timestampAbs: T0, videoOffsetSec: 0, phase: 'live', offsetSource: 'estimated', sources: ['live'],
      firstSeenAt: T0, lastSeenAt: T0, deleted: false, fp: '', offsets: {}, aliasIds: [] }, o);
  }
  async function resetDb() { await DB.close(); await req(indexedDB.deleteDatabase(TEST_DB)); }
  // 直接寫入（測試資料準備；正式程式只有 background 寫入）
  async function put(stream, messages, pinned, channels) {
    const db = await DB.open();
    const t = db.transaction(['streams', 'messages', 'pinned_messages', 'channels'], 'readwrite');
    if (stream) t.objectStore('streams').put(stream);
    for (const m of messages || []) t.objectStore('messages').put(m);
    for (const p of pinned || []) t.objectStore('pinned_messages').put(p);
    for (const c of channels || []) t.objectStore('channels').put(c);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  const host = document.getElementById('host');
  const texts = (ctl) => ctl.els.list.innerText;
  const rows = (ctl) => Array.from(ctl.els.list.querySelectorAll('.vrow > *'));

  // ================================================================ 純函式
  test('分類膠囊：SC／超級貼圖／禮物 → sc；會員／里程碑 → mem；降落橫幅與認證實況主 → raid（排除機器人、本台主播與管理員）', () => {
    const c = (o) => CORE.categories(mk(o), o.authorName || '');
    eq(c({ type: 'superchat' }), ['all', 'sc']);
    eq(c({ type: 'supersticker' }), ['all', 'sc']);
    eq(c({ type: 'gift' }), ['all', 'sc']);
    eq(c({ type: 'membership' }), ['all', 'mem']);
    eq(c({ type: 'milestone' }), ['all', 'mem']);
    eq(c({ type: 'raid' }), ['all', 'raid']);
    eq(c({ authorBadges: ['verified'] }), ['all', 'raid'], '認證實況主發言');
    eq(c({ authorBadges: ['verified', 'owner'] }), ['all'], '本台主播不算降落');
    eq(c({ authorBadges: ['verified', 'moderator'] }), ['all'], '管理員不算降落');
    eq(c({ authorBadges: ['verified'], authorHandle: '@Nightbot' }), ['all'], '機器人（handle，不分大小寫）');
    eq(c({ authorBadges: ['verified'], authorHandle: '', authorName: 'StreamElements' }), ['all'], '機器人（名稱）');
  });

  test('篩選：膠囊、隱藏已刪除、使用者文字與 chip、關鍵字（NFKC、不分大小寫、表符 alt）；各膠囊筆數套用其他條件', () => {
    const ch = new Map([['@alice', { displayName: 'Alice 頻道' }]]);
    const items = [
      mk({ id: 'a', authorHandle: '@alice', runs: [{ text: 'Hello ABC' }] }),
      mk({ id: 'b', authorHandle: '@bob', type: 'superchat', runs: [{ text: '謝謝' }] }),
      mk({ id: 'c', authorHandle: '@bob', runs: [{ emoji: { alt: ':tea:', shortcut: ':tea:' } }] }),
      mk({ id: 'd', authorHandle: '@carol', deleted: true, runs: [{ text: 'abc deleted' }] }),
      mk({ id: 'e', authorHandle: '@dave', type: 'membership', runs: [{ text: '歡迎' }] }),
    ].map((m) => CORE.indexMessage(m, ch));
    const f = (o) => { const r = CORE.filter(items, Object.assign({ pill: 'all', hideDeleted: false, userQuery: '', userChip: '', keyword: '' }, o)); return [r.list.map((x) => x.m.id).join(''), r.counts]; };
    eq(f({})[0], 'abcde');
    eq(f({ pill: 'sc' })[0], 'b');
    eq(f({ pill: 'mem' })[0], 'e');
    eq(f({ hideDeleted: true })[0], 'abce');
    eq(f({ userQuery: 'alice 頻' })[0], 'a', '依顯示名稱（頻道解析結果）');
    eq(f({ userQuery: '@BOB' })[0], 'bc', '依 handle，不分大小寫');
    eq(f({ userChip: '@bob', pill: 'sc' })[0], 'b');
    eq(f({ keyword: 'ａｂｃ' })[0], 'ad', '全形關鍵字（NFKC）');
    eq(f({ keyword: 'tea' })[0], 'c', '表符 alt／shortcut');
    eq(f({ keyword: 'abc' })[1], { all: 2, sc: 0, mem: 0, raid: 0 }, '筆數反映關鍵字');
  });

  test('高亮範圍與表符命中', () => {
    eq(CORE.matchRanges('Hello hello HELLO', 'hello'), [[0, 5], [6, 11], [12, 17]]);
    eq(CORE.matchRanges('abc', ''), []);
    eq(CORE.matchRanges('草草草', '草'), [[0, 1], [1, 2], [2, 3]]);
    assert(CORE.emojiMatches({ alt: ':Tea_Cup:' }, 'tea'));
    assert(!CORE.emojiMatches({ alt: ':cat:' }, 'tea'));
  });

  test('時段分隔線（F-14）：只有直播中不加；有待機室或結束後時每段開頭加標籤', () => {
    const L = (ps) => ps.map((p, i) => ({ m: mk({ id: 'x' + i, phase: p }) }));
    eq(CORE.withPhaseDividers(L(['live', 'live'])).map((e) => e.kind), ['msg', 'msg']);
    eq(CORE.withPhaseDividers(L(['pre', 'live', 'live', 'post'])).map((e) => e.kind === 'phase' ? e.label : '·'),
      ['直播開始前（待機室）', '·', '直播中', '·', '·', '直播結束後', '·']);
  });

  test('時間碼：直播中 offset 可點；開播前／結束後為純文字；offset 未知與長期直播顯示當地時間（F-08 v37 備註）', () => {
    const s = { startedAt: T0, endedAt: T0 + 3600e3 };
    const a = CORE.timecode(mk({ videoOffsetSec: 3725.4 }), s, {});
    eq([a.text, a.seconds, a.label], ['1:02:05', 3725, '跳轉至 1:02:05']);
    eq(CORE.timecode(mk({ videoOffsetSec: 65 }), s, {}).text, '1:05');
    const pre = CORE.timecode(mk({ phase: 'pre', videoOffsetSec: -754 }), s, {});
    eq([pre.text, pre.seconds], ['開播前 12:34', null]);
    const post = CORE.timecode(mk({ phase: 'post', timestampAbs: T0 + 3600e3 + 185e3 }), s, {});
    eq([post.text, post.seconds], ['結束後 3:05', null]);
    const unk = CORE.timecode(mk({ videoOffsetSec: null, timestampAbs: T0 + 5e3 }), s, {});
    eq([unk.text, unk.seconds], ['20:00:05', null]);
    const long = CORE.timecode(mk({ videoOffsetSec: 8e7, timestampAbs: T0 }), s, { long: true, refMs: T0 - 86400e3 });
    eq([long.text, long.seconds], ['11/17 20:00:00', null], '跨日加日期');
    assert(CORE.isLongStream({ startedAt: Date.parse('2023-05-07T02:30:09Z'), lastMessageAt: T0 }), '24 小時直播');
    assert(!CORE.isLongStream({ startedAt: T0, lastMessageAt: T0 + 5 * 3600e3 }));
  });

  test('SC 顏色：依底色選黑或白；只接受色碼與 rgb()，其他字串（含注入）一律不用', () => {
    eq(CORE.parseColor('#1e88e5'), { bg: 'rgb(30, 136, 229)', fg: '#000' });
    eq(CORE.parseColor('rgba(208, 0, 0, 1)').fg, '#fff');
    eq(CORE.parseColor('rgba(255,202,40,1)').fg, '#000');
    eq(CORE.parseColor('#ff1565c0').bg, 'rgb(21, 101, 192)', '#aarrggbb');
    eq(CORE.parseColor('red; background:url(https://evil.example/x)'), null);
    eq(CORE.parseColor('rgb(300, 0, 0)'), null);
    eq(CORE.parseColor(''), null);
  });

  test('置頂（F-07）：同內容去重保留最新，依置頂時間新到舊', () => {
    const p = (id, t, at) => mk({ id, runs: [{ text: t }], pinnedAt: at, authorHandle: '@host' });
    eq(CORE.dedupePinned([p('1', '規則', 1), p('2', '規則', 5), p('3', '抽獎', 3)]).map((x) => x.id), ['2', '3']);
  });

  // ================================================================ 渲染（真實 DOM）
  const STREAM = { videoId: VID, title: '測試場次', isLive: false, startedAt: T0, endedAt: T0 + 7200e3, scheduledStartAt: T0 - 600e3,
    lastMessageAt: T0 + 7300e3, messageCount: 12, versions: [], linkedVideos: [] };
  function fixture() {
    let i = 0;
    const at = (sec, o) => mk(Object.assign({ id: 'f' + (++i), timestampAbs: T0 + sec * 1000, videoOffsetSec: sec }, o));
    return [
      at(-300, { phase: 'pre', authorHandle: '@early', runs: [{ text: '待機中' }] }),
      at(5, { authorHandle: '@host', authorBadges: ['owner'], runs: [{ text: '大家好' }] }),
      at(10, { authorHandle: '@alice', runs: [{ text: '<img src=x onerror="window.__xss=1">' }] }),
      at(12, { authorHandle: '@alice', runs: [{ text: '表符 ' }, { emoji: { src: 'https://yt3.ggpht.com/emo.png', alt: ':tea:', shortcut: ':tea:' } }, { emoji: { src: 'https://evil.example/e.png', alt: ':evil:' } }] }),
      at(20, { type: 'superchat', authorHandle: '@bob', amount: 'NT$150', color: '#1e88e5', runs: [{ text: '辛苦了' }] }),
      at(25, { type: 'supersticker', authorHandle: '@bob', amount: 'NT$30', color: 'rgba(255,202,40,1)', stickerSrc: 'https://lh3.googleusercontent.com/s.png', runs: [] }),
      at(30, { type: 'gift', authorHandle: '@carol', giftName: '櫻花雨', giftCount: 3, jewels: 150, runs: [] }),
      at(35, { type: 'membership', authorHandle: '@dave', runs: [{ text: '新會員\n歡迎加入' }] }),
      at(40, { type: 'raid', authorHandle: '', runs: [{ text: '藍鯨工作室帶著觀眾來訪' }] }),
      at(45, { authorHandle: '@eve', deleted: true, deletedAt: T0 + 50e3, runs: [{ text: '被刪除的訊息' }] }),
      at(50, { type: 'system', authorHandle: '', runs: [{ text: '慢速模式已開啟' }] }),
      at(7300, { phase: 'post', authorHandle: '@late', runs: [{ text: '辛苦了 post' }] }),
    ];
  }
  let ctl = null;

  test('渲染：各訊息類型、時段分隔線、時間碼、已刪除徽章；文字一律 textContent（不執行注入的 HTML）；非白名單圖片以 alt 顯示', async () => {
    await resetDb();
    await put(STREAM, fixture(), [mk({ id: 'p1', authorHandle: '@host', runs: [{ text: '今晚的規則請看資訊欄' }], pinnedAt: T0 + 60e3 })],
      [{ handleOrId: '@host', displayName: '星野茶館', avatar: '', fetchedAt: Date.now() }]);
    ctl = V.mount(host, { embed: true, videoId: VID });
    await ctl.ready; await frame();
    const t = texts(ctl);
    for (const s of ['直播開始前（待機室）', '直播中', '直播結束後', '開播前 5:00', '結束後 1:40', '0:05', '星野茶館', '主播', 'NT$150', '櫻花雨', '×3', '150 Jewels', '新會員', '✨ 降落', '已刪除', '慢速模式已開啟'])
      assert(t.includes(s), '缺少：' + s);
    assert(t.includes('<img src=x onerror="window.__xss=1">'), '注入字串以純文字顯示');
    assert(!window.__xss && !ctl.els.list.querySelector('img[src="x"]'), '沒有產生 img 元素');
    const imgs = Array.from(ctl.els.list.querySelectorAll('img')).map((i) => new URL(i.src).hostname);
    assert(imgs.includes('yt3.ggpht.com') && imgs.includes('lh3.googleusercontent.com'), '白名單圖片顯示');
    assert(!imgs.includes('evil.example'), '非白名單圖片不載入');
    assert(t.includes(':evil:'), '非白名單表符以 alt 文字顯示');
    const sc = ctl.els.list.querySelector('.card');
    eq([sc.style.background.replace(/\s/g, ''), sc.style.color.replace(/\s/g, '')], ['rgb(30,136,229)', 'rgb(0,0,0)'], 'SC 底色＋依對比選字色');
    eq(ctl.els.list.querySelectorAll('.msg.deleted .bdg.del').length, 1);
    assert(!ctl.els.list.querySelector('.tc.static[aria-label]'), 'pre／post 時間碼不可點');
    eq(ctl.els.list.querySelector('button.tc').getAttribute('aria-label'), '跳轉至 0:05');
    eq(ctl.els.pills.all.querySelector('.num').textContent, '12');
    eq(['sc', 'mem', 'raid'].map((p) => ctl.els.pills[p].querySelector('.num').textContent), ['3', '1', '1']);
    assert(!ctl.els.pin.hidden && ctl.els.pin.innerText.includes('今晚的規則'), '置頂卡片');
  });

  test('互動：膠囊切換、點名稱建立使用者 chip、關鍵字高亮（debounce）、⋯ 選單隱藏已刪除、置頂展開', async () => {
    ctl.els.pills.sc.click(); await frame();
    eq(rows(ctl).filter((r) => !r.classList.contains('phase')).length, 3, 'SC／禮物 3 則');
    eq(ctl.els.pills.sc.getAttribute('aria-selected'), 'true');
    ctl.els.pills.all.click(); await frame();
    const nm = Array.from(ctl.els.list.querySelectorAll('.nm')).find((n) => n.textContent === '@alice');
    nm.click(); await frame();
    assert(!ctl.els.user.chip.hidden && ctl.els.user.chipText.textContent === '@alice', '顯示 chip');
    eq(rows(ctl).filter((r) => r.classList.contains('msg')).length, 2, '只剩 @alice 的 2 則');
    ctl.els.user.chipX.click(); await frame();
    ctl.els.keyword.input.value = '辛苦';
    ctl.els.keyword.input.dispatchEvent(new Event('input'));
    await sleep(self.YTCAS_CONST.SEARCH_DEBOUNCE_MS + 80); await frame();
    const marks = Array.from(ctl.els.list.querySelectorAll('mark')).map((m) => m.textContent);
    eq(marks, ['辛苦', '辛苦'], '兩則命中並高亮');
    eq(ctl.els.pills.all.querySelector('.num').textContent, '2');
    ctl.els.keyword.clear.click(); await frame();
    ctl.els.moreBtn.click(); ctl.els.miDel.click(); await frame();
    assert(!texts(ctl).includes('被刪除的訊息'), '隱藏已刪除');
    ctl.els.miDel.click(); await frame();
    assert(texts(ctl).includes('被刪除的訊息'), '再按一次顯示');
    document.body.click();
    ctl.els.pin.click();
    assert(ctl.els.pin.classList.contains('open') && ctl.els.pin.getAttribute('aria-expanded') === 'true', '置頂展開');
  });

  test('即時更新：NEW_MESSAGES 新增訊息、既有訊息被標記刪除、CHANNEL_RESOLVED 更新名稱；不屬於本場次的忽略', async () => {
    ctl._onRuntime({ type: 'NEW_MESSAGES', videoId: VID, messages: [mk({ id: 'n1', authorHandle: '@zed', timestampAbs: T0 + 60e3, videoOffsetSec: 60, runs: [{ text: '新來的' }] })] });
    ctl._onRuntime({ type: 'NEW_MESSAGES', videoId: 'other', messages: [mk({ id: 'n2', videoId: 'other', runs: [{ text: '別場' }] })] });
    await sleep(400); await frame();
    eq(ctl.els.pills.all.querySelector('.num').textContent, '13');
    ctl.state.vl.toBottom(); await frame();
    ctl._onRuntime({ type: 'NEW_MESSAGES', videoId: VID, messages: [mk({ id: 'f3', authorHandle: '@alice', timestampAbs: T0 + 10e3, videoOffsetSec: 10, deleted: true, runs: [{ text: '<img src=x onerror="window.__xss=1">' }] })] });
    ctl._onRuntime({ type: 'CHANNEL_RESOLVED', handleOrId: '@zed', displayName: 'Zed 的頻道' });
    await sleep(400); await frame();
    eq(ctl.els.pills.all.querySelector('.num').textContent, '13', '更新不重複計數');
    assert(texts(ctl).includes('Zed 的頻道'), '名稱更新');
    ctl.state.vl.toBottom(); ctl.els.list.scrollTop = 0; await frame();
    assert(ctl.els.list.querySelector('[data-id="f3"]').classList.contains('deleted'), '既有訊息顯示已刪除');
  });

  test('效能（第 7 節）：10 萬則場次首屏 ≤ 2 秒、搜尋 ≤ 300ms；DOM 只保留可見範圍的列', async () => {
    await resetDb();
    const N = 100000;
    const msgs = new Array(N);
    const words = ['草', 'gg', '晚安', '好耶', 'lol', '辛苦了', 'さくら', 'nice'];
    for (let i = 0; i < N; i++) {
      msgs[i] = mk({ id: 'b' + i, videoId: VBIG, authorHandle: '@u' + (i % 3000), timestampAbs: T0 + i * 300, videoOffsetSec: i * 0.3,
        type: i % 500 === 0 ? 'superchat' : 'text', color: '#1e88e5', amount: 'NT$75',
        runs: [{ text: words[i % words.length] + ' ' + i }] });
    }
    msgs[77777].runs = [{ text: '獨一無二的關鍵字 xyzzy' }];
    for (let i = 0; i < N; i += 10000) await put(i === 0 ? { videoId: VBIG, title: '大型場次', isLive: false, startedAt: T0, endedAt: T0 + N * 300, lastMessageAt: T0 + N * 300, messageCount: N } : null, msgs.slice(i, i + 10000));
    await DB.close();
    const t0 = performance.now();
    const big = V.mount(host, { embed: true, videoId: VBIG });
    await big.ready; await frame();
    const first = performance.now() - t0;
    const tm = big.state.timings;
    console.info('[test-viewer] 10 萬則', { firstScreenMs: Math.round(first), queryMs: Math.round(tm.queryMs), indexMs: Math.round(tm.indexMs), filterMs: Math.round(tm.filterMs) });
    eq(big.els.pills.all.querySelector('.num').textContent, '100,000');
    assert(first <= 2000, '首屏 ' + Math.round(first) + 'ms > 2000ms');
    assert(big.state.vl.renderedCount < 120, 'DOM 列數 ' + big.state.vl.renderedCount);
    big.els.keyword.input.value = 'xyzzy';
    const s0 = performance.now();
    big.state.f.keyword = 'xyzzy'; big.apply({ reset: true }); await frame();
    const searchMs = performance.now() - s0;
    console.info('[test-viewer] 搜尋', { searchMs: Math.round(searchMs) });
    eq(big.els.pills.all.querySelector('.num').textContent, '1');
    assert(texts(big).includes('獨一無二的關鍵字'));
    assert(searchMs <= 300, '搜尋 ' + Math.round(searchMs) + 'ms > 300ms');
    // 捲到中段：仍只繪製可見範圍
    big.state.f.keyword = ''; big.apply({ reset: true }); await frame();
    big.els.list.scrollTop = big.els.list.scrollHeight / 2; await frame(); await frame();
    assert(big.state.vl.renderedCount > 0 && big.state.vl.renderedCount < 120, '中段列數 ' + big.state.vl.renderedCount);
    window.__perf = { firstScreenMs: Math.round(first), searchMs: Math.round(searchMs), queryMs: Math.round(tm.queryMs), indexMs: Math.round(tm.indexMs) };
  });

  test('空狀態：沒有資料的場次、沒有任何場次（後台）', async () => {
    await resetDb();
    const a = V.mount(host, { embed: true, videoId: 'nothing' });
    await a.ready;
    assert(!a.els.empty.hidden && a.els.empty.innerText.includes('還沒有訊息'));
    const b = V.mount(host, { embed: false });
    await b.ready;
    assert(!b.els.empty.hidden && b.els.empty.innerText.includes('還沒有收錄任何場次'));
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
