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
  test('T4.1 置頂去重：同一則以不同 id 擷取（一筆缺 handle、空白不同、全形）仍只顯示一次；不同作者同內容各自保留；pinnedLastAt 優先', () => {
    const a = mk({ id: 'x1', runs: [{ text: '會員招募中 ' }, { emoji: { alt: ':heart:' } }], pinnedAt: 10, authorHandle: '@TVBS', authorName: 'TVBS' });
    const b = mk({ id: 'x2', runs: [{ text: '會員招募中' }, { emoji: { alt: ':heart:' } }], pinnedAt: 20, authorHandle: '', authorName: 'TVBS' });
    const c = mk({ id: 'x3', runs: [{ text: '會員招募中　' }, { emoji: { alt: ':heart:' } }], pinnedAt: 30, authorHandle: '@tvbs' });
    const d = mk({ id: 'x4', runs: [{ text: '會員招募中' }, { emoji: { alt: ':heart:' } }], pinnedAt: 5, authorHandle: '@other' });
    eq(CORE.dedupePinned([a, b, c, d]).map((x) => x.id), ['x3', 'x4']);
    const e = mk({ id: 'y1', runs: [{ text: '舊' }], pinnedAt: 1, pinnedLastAt: 100, authorHandle: '@h' });
    const f = mk({ id: 'y2', runs: [{ text: '新' }], pinnedAt: 50, authorHandle: '@h' });
    eq(CORE.dedupePinned([f, e]).map((x) => x.id), ['y1', 'y2']);
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
    // v44：貼圖載入失敗（本頁 CSP 擋下外部圖片）會換成 alt／🏷，所以貼圖可能已被替換
    assert(imgs.includes('yt3.ggpht.com') && (imgs.includes('lh3.googleusercontent.com') || ctl.els.list.querySelector('.stk')), '白名單圖片顯示');
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

  test('T4.1 後台場次選單筆數：目前場次隨推播更新；其他場次與新場次在重新查詢時更新，選擇不變', async () => {
    await resetDb();
    const SA = { videoId: 'vidSelAAAA1', title: 'A 場', isLive: true, startedAt: T0, lastMessageAt: T0 + 2e3, messageCount: 2 };
    const SB = { videoId: 'vidSelBBBB2', title: 'B 場', isLive: false, startedAt: T0 - 86400e3, lastMessageAt: T0 - 86000e3, messageCount: 1 };
    await put(SA, [mk({ id: 'sa1', videoId: SA.videoId, timestampAbs: T0 + 1e3 }), mk({ id: 'sa2', videoId: SA.videoId, timestampAbs: T0 + 2e3 })]);
    await put(SB, [mk({ id: 'sb1', videoId: SB.videoId, timestampAbs: T0 - 86000e3 })]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: SA.videoId });
    await c.ready;
    const opt = (v) => Array.from(c.els.pick.options).find((o) => o.value === v);
    assert(opt(SA.videoId).textContent.endsWith('2 則') && opt(SB.videoId).textContent.endsWith('1 則'), '初始：' + opt(SA.videoId).textContent);
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: SA.videoId, messages: [mk({ id: 'sa3', videoId: SA.videoId, timestampAbs: T0 + 3e3 })] });
    assert(opt(SA.videoId).textContent.endsWith('3 則'), '推播後：' + opt(SA.videoId).textContent);
    await put(Object.assign({}, SB, { messageCount: 5 }), []);
    await put({ videoId: 'vidSelCCCC3', title: 'C 場', isLive: true, startedAt: T0 + 10e3, lastMessageAt: T0 + 10e3, messageCount: 7 }, []);
    await c._refreshStreamCounts();
    assert(opt(SB.videoId).textContent.endsWith('5 則'), '重新查詢：' + opt(SB.videoId).textContent);
    assert(opt('vidSelCCCC3') && opt('vidSelCCCC3').textContent.endsWith('7 則'), '新場次加入選單');
    eq(c.els.pick.value, SA.videoId, '選擇不變');
    assert(opt(SA.videoId).textContent.endsWith('3 則'), '目前場次不被舊的 messageCount 蓋回');
  });

  // ================================================================ T5（F-08、F-12、F-18）
  test('T5 純函式：影片時間換算（VOD 版本 offset＋時間差、直播 DVR 範圍）、pre／post 不參與、同步位置、版本選擇、連結影片、F-12 說明', () => {
    const m = mk({ id: 'a', videoOffsetSec: 100, offsets: { v1: 100, v2: 80 }, timestampAbs: T0 + 100e3 });
    const vod = { live: false, currentTime: 0, duration: 3600, at: 0 };
    eq(CORE.videoTimeOf(m, vod, {}), 100);
    eq(CORE.videoTimeOf(m, vod, { ver: 'v2' }), 80);
    eq(CORE.videoTimeOf(m, vod, { ver: 'v3' }), null, '該版本沒有 offset');
    eq(CORE.videoTimeOf(m, vod, { shift: 12 }), 112, '連結影片時間差');
    eq(CORE.videoTimeOf(mk({ phase: 'pre', videoOffsetSec: -30 }), vod, {}), null, 'pre 不參與');
    eq(CORE.videoTimeOf(mk({ phase: 'post', videoOffsetSec: 4000 }), vod, {}), null, 'post 不參與');
    // 直播（v45 牆上時間錨點）：A＝在最新時的 at − currentTime×1000；訊息 10 分鐘前 → currentTime − 600；沒有 A → 不可點
    const live = { live: true, currentTime: 50000, seekStart: 40000, seekEnd: 50000, at: T0 + 3600e3 };
    const wallA = live.at - 50000e3;
    eq(CORE.videoTimeOf(mk({ timestampAbs: T0 + 3000e3 }), live, { wallA }), 49400);
    eq(CORE.videoTimeOf(mk({ timestampAbs: T0 + 3000e3 }), live, {}), null, '沒量過錨點');
    eq(CORE.videoTimeOf(mk({ timestampAbs: T0 + 3000e3 }), live, { wallA, latency: 20 }), 49420, '直播延遲 20 秒：畫面晚 20 秒才演到');
    assert(CORE.inRange(49400, live) && !CORE.inRange(39000, live), 'DVR 範圍');
    assert(CORE.inRange(100, vod) && !CORE.inRange(3700, vod) && !CORE.inRange(-1, vod), 'VOD 範圍');
    assert(CORE.atLiveEdge(live, 15) && !CORE.atLiveEdge(Object.assign({}, live, { currentTime: 49000 }), 15), '直播邊緣');
    // v43（16.1 (F)）：在最新時延遲本來就 40 秒 → 以基準判斷；徽章優先；換算扣掉基準
    const lag40 = Object.assign({}, live, { currentTime: 50000 - 40 });
    assert(!CORE.atLiveEdge(lag40, 15) && CORE.atLiveEdge(lag40, 15, 38), '基準 38 秒：延遲 40 秒仍在最新');
    assert(!CORE.atLiveEdge(Object.assign({}, lag40, { currentTime: 50000 - 100 }), 15, 38), '倒轉 1 分鐘：不在最新');
    assert(CORE.atLiveEdge(Object.assign({}, lag40, { currentTime: 49000, liveHead: true }), 15, 0), '徽章說在最新');
    assert(!CORE.atLiveEdge(Object.assign({}, lag40, { liveHead: false }), 15, 40), '徽章說不在最新');
    eq(CORE.playheadAbs(Object.assign({}, live, { currentTime: 50000 - 100 }), 40), live.at - 60e3, '倒轉 1 分鐘 → 1 分鐘前（v42 會算成 100 秒前）');
    // v45：A 的中位數、目標時間
    eq(CORE.median([5, 1, 3]), 3); eq(CORE.median([4, 1, 3, 2]), 2.5); eq(CORE.median([]), null);
    eq(CORE.nextWallSamples([1, 2, 3], live, 3).length, 3, '最多 maxN 個');
    eq(CORE.wallTarget(Object.assign({}, live, { currentTime: 50000 - 60 }), wallA, 0), live.at - 60e3, '倒轉 1 分鐘 → 1 分鐘前（不看 seekEnd）');
    eq(CORE.wallTarget(Object.assign({}, live, { currentTime: 50000 - 60, seekEnd: 99999 }), wallA, 10), live.at - 70e3, 'seekEnd 無關；延遲 10 秒');
    eq(CORE.wallTarget(live, null, 0), null);
    const nb = (b, lagSec, o) => CORE.nextBaseline(b, Object.assign({}, live, { currentTime: 50000 - lagSec }, o), 15, 0.5);
    eq(nb(null, 40), 40, '第一個樣本');
    eq(nb(40, 30), 30, '較小 → 採用');
    eq(nb(40, 50), 45, '在範圍內較大 → 只往上追 drift 比例');
    eq(nb(40, 100), 40, '倒轉中 → 不變');
    eq(nb(40, 100, { liveHead: true }), 100, '徽章說在最新 → 採用');
    eq(nb(40, 30, { liveHead: false }), 40, '徽章說不在最新 → 不學');
    eq(nb(40, 30, { paused: true }), 40, '暫停中不學');
    // 同步位置：VOD 依 offset、直播依實際時間；分隔線與 pre 略過
    const items = [mk({ id: 'p', phase: 'pre', videoOffsetSec: -5, timestampAbs: T0 - 5e3 }), mk({ id: 'x', videoOffsetSec: 10, timestampAbs: T0 + 10e3 }),
      mk({ id: 'y', videoOffsetSec: 20, timestampAbs: T0 + 20e3 }), mk({ id: 'z', videoOffsetSec: 30, timestampAbs: T0 + 30e3 })].map((x) => CORE.indexMessage(x, new Map()));
    const entries = CORE.withPhaseDividers(items);
    const at = (t) => { const i = CORE.syncIndex(entries, Object.assign({}, vod, { currentTime: t }), {}); return i < 0 ? null : entries[i].it.m.id; };
    eq([at(5), at(10), at(25), at(99)], [null, 'x', 'y', 'z']);
    const lc = { live: true, seekStart: 0, seekEnd: 1000, currentTime: 1000 - 15, at: T0 + 30e3 }; // 播放位置 = T0 + 15s
    const li = CORE.syncIndex(entries, lc, {});
    eq(entries[li].it.m.id, 'x');
    eq(CORE.pickVersion([{ id: 'v1', duration: 3600 }, { id: 'v2', duration: 3000 }], 3001.4), 'v2');
    eq(CORE.pickVersion([{ id: 'v1', duration: 3600 }], 100), null);
    const ls = CORE.findLinkedStream([{ videoId: 'orig', linkedVideos: [{ videoId: 'newone', offsetShift: -30 }] }], 'newone');
    eq([ls.stream.videoId, ls.link.offsetShift], ['orig', -30]);
    eq(CORE.findLinkedStream([], 'x'), null);
    eq(CORE.captureNote({ capturing: true, f12: 'switched' }).sticky, false);
    eq(CORE.captureNote({ capturing: true, f12: 'failed:no-menu' }).tone, 'warn');
    eq(CORE.captureNote({ capturing: true, f12: 'already' }), null, '本來就是即時聊天室：不顯示');
    eq(CORE.captureNote({ capturing: false, reason: 'channel' }).sticky, true);
  });

  test('T5 內嵌面板：VOD 時間軸同步（目前訊息框、捲到可視範圍、使用者捲動暫停、回到播放位置）、時間碼跳轉、關閉按鈕、F-12 說明', async () => {
    await resetDb();
    const VV = 'vidSYNCVOD1';
    const msgs = [];
    for (let i = 0; i < 400; i++) msgs.push(mk({ id: 's' + i, videoId: VV, timestampAbs: T0 + i * 10e3, videoOffsetSec: i * 10, offsets: { v1: i * 10 }, runs: [{ text: '同步 ' + i }] }));
    await put({ videoId: VV, title: '同步測試', isLive: true, startedAt: T0, endedAt: T0 + 4000e3, lastMessageAt: T0 + 3990e3, messageCount: 400, versions: [{ id: 'v1', duration: 4000, label: '原始' }], linkedVideos: [] }, msgs);
    await DB.close();
    const opened = [];
    const realOpen = window.open;
    window.open = (u) => { opened.push(String(u)); return null; }; // 測試頁沒有 parent：跳轉退回開新分頁，這裡攔截
    try {
      const c = V.mount(host, { embed: true, videoId: VV });
      await c.ready; await frame();
      assert(c.els.closeBtn && c.els.closeBtn.textContent === '關閉優化面板', '關閉按鈕');
      const A = Date.now();
      c._onClock({ currentTime: 1505, paused: false, duration: 4000, live: false, at: A });
      await frame(); await frame();
      eq(c.state.mode, 'sync');
      eq(c.state.currentId, 's150');
      const cur = c.els.list.querySelector('.current');
      assert(cur && cur.dataset.id === 's150', '目前訊息加框');
      const lr = c.els.list.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      assert(cr.bottom <= lr.bottom + 2 && cr.top >= lr.top - 2, '目前訊息在可視範圍');
      // 時間碼：可點，跳轉送出該訊息的影片時間（測試頁沒有 parent → 開新分頁）
      const tc = cur.querySelector('button.tc');
      assert(tc && tc.textContent === '25:00', '時間碼 ' + (tc && tc.textContent));
      tc.click();
      assert(opened.length === 1 && opened[0].includes('t=1500'), '跳轉 ' + opened[0]);
      // 使用者往上捲 → 暫停同步，出現「回到播放位置」
      c.els.list.dispatchEvent(new Event('wheel'));
      c.els.list.scrollTop = 0; c.els.list.dispatchEvent(new Event('scroll')); await frame(); await frame(); // 背景分頁不會自動觸發 scroll 事件
      eq(c.state.syncPaused, true);
      assert(!c.els.resume.hidden && c.els.resume.textContent.includes('回到播放位置'), '回到播放位置按鈕');
      // 正常播放 500 秒（不是跳轉：v43 起跳轉會解除暫停）
      c._onClock({ currentTime: 2005, paused: false, duration: 4000, live: false, at: A + 500e3 });
      await frame();
      eq(c.state.currentId, 's200', '暫停捲動時仍更新目前訊息');
      assert(c.els.list.scrollTop < 50, '暫停中不捲動');
      c.els.resume.click(); await frame(); await frame();
      eq(c.state.syncPaused, false);
      assert(c.els.list.scrollTop > 1000, '回到播放位置');
      // F-12 說明
      c._onCapture({ capturing: true, f12: 'switched' });
      assert(!c.els.note.hidden && c.els.noteText.textContent.includes('即時聊天室'), 'F-12 說明');
      c._onCapture({ capturing: true, f12: 'already' });
      assert(c.els.note.hidden, '已是即時聊天室：不顯示');
    } finally { window.open = realOpen; }
  });

  test('T5 直播中：在直播邊緣跟隨到底；倒轉 DVR 時依時間同步；DVR 範圍外的時間碼不可點', async () => {
    await resetDb();
    const VL = 'vidSYNCLIV1';
    const now = Date.now();
    const msgs = [];
    for (let i = 0; i < 300; i++) msgs.push(mk({ id: 'l' + i, videoId: VL, timestampAbs: now - (300 - i) * 20e3, videoOffsetSec: 100000 + i * 20, runs: [{ text: '直播 ' + i }] }));
    await put({ videoId: VL, title: '直播測試', isLive: true, startedAt: now - 7 * 86400e3, lastMessageAt: now - 20e3, messageCount: 300, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VL });
    await c.ready; await frame();
    // 直播邊緣：DVR 只有最近 1 小時（seekEnd − seekStart = 3600）
    // v47（26.2）錨點要在最新穩定 3 秒才採用、採用後 5 秒內倒轉會作廢 → 在最新播放 10 秒
    for (let k = 0; k <= 9; k++) c._onClock({ currentTime: 9998 - (9 - k), paused: false, duration: null, seekStart: 6400, seekEnd: 10000, live: true, at: now - (9 - k) * 1000, liveHead: true, badge: 'class' });
    await frame(); await frame();
    eq(c.state.mode, 'tail');
    assert(c.state.vl.follow, '跟隨到底');
    // 最後一則（20 秒前）在 DVR 內：可點；最舊的（100 分鐘前）不可點
    const last = c.els.list.querySelector('[data-id="l299"] .tc');
    assert(last && last.tagName === 'BUTTON', 'DVR 內可點');
    // 倒轉 30 分鐘
    c._onClock({ currentTime: 10000 - 1800, paused: false, duration: null, seekStart: 6400, seekEnd: 10000, live: true, at: now, liveHead: false, badge: 'behind' });
    await frame(); await frame();
    eq(c.state.mode, 'sync');
    const id = c.state.currentId;
    const m = msgs.find((x) => x.id === id);
    assert(m && m.timestampAbs <= now - 1800e3 && m.timestampAbs > now - 1800e3 - 20e3, '同步到 30 分鐘前的訊息 ' + id);
    c.els.list.scrollTop = 0; c.els.list.dispatchEvent(new Event('scroll')); await frame(); await frame();
    const old = c.els.list.querySelector('[data-id="l0"] .tc');
    assert(old && old.tagName === 'SPAN', 'DVR 範圍外不可點');
  });

  // ================================================================ T5.2（審查十一 16.1 (F)(G)(H)、16.3）
  test('T5.2 直播：在最新時延遲 40 秒仍跟隨到底；sync 中先手動捲動、再 seek → 跳到新位置（seeked 與跳轉後備）；回到最新；範圍外提示；連線狀態', async () => {
    await resetDb();
    const VL = 'vidLIVESEEK';
    const now = Date.now();
    const msgs = [];
    for (let i = 0; i < 300; i++) msgs.push(mk({ id: 'k' + i, videoId: VL, timestampAbs: now - (300 - i) * 10e3, videoOffsetSec: 50000 + i * 10, runs: [{ text: '倒轉 ' + i }] }));
    await put({ videoId: VL, title: '直播倒轉', isLive: true, startedAt: now - 86400e3, lastMessageAt: now - 10e3, messageCount: 300, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VL });
    await c.ready; await frame();
    // 播放器時鐘：每次 250ms，seekEnd 隨時間前進；lag＝seekEnd − currentTime（秒）
    let t = now, seeks = 0;
    const tick = (lag, o) => {
      t += 250;
      const seekEnd = 10000 + (t - now) / 1000;
      c._onClock(Object.assign({ currentTime: seekEnd - lag, paused: false, duration: null, seekStart: seekEnd - 7200, seekEnd, live: true, at: t, seeks }, o));
    };
    const visible = (id) => {
      const n = c.els.list.querySelector('.vrow > [data-id="' + id + '"]');
      if (!n) return false;
      const lr = c.els.list.getBoundingClientRect(), r = n.getBoundingClientRect();
      return r.bottom > lr.top && r.top < lr.bottom;
    };
    const near = (backSec) => { // 目前訊息＝「現在 − backSec」之前的最後一則（訊息每 10 秒一則）
      const m = msgs.find((x) => x.id === c.state.currentId);
      return !!m && m.timestampAbs <= t - backSec * 1000 && m.timestampAbs > t - backSec * 1000 - 10e3;
    };
    const userScroll = async () => {
      c.els.list.dispatchEvent(new Event('wheel'));
      c.els.list.scrollTop = 0; c.els.list.dispatchEvent(new Event('scroll')); await frame(); await frame();
    };
    // 在最新：延遲 40 秒（YouTube 一般延遲模式）→ 基準 40，tail
    // v47（26.2）讀不到徽章：錨點要穩定 10 秒才採用、採用後 5 秒內倒轉會作廢 → 在最新播放 18 秒
    for (let k = 0; k < 72; k++) tick(40);
    await frame(); await frame();
    eq(c.state.mode, 'tail', 'v42 會判成 sync（延遲 40 > 15）');
    assert(Math.abs(c.state.baseline - 40) < 0.01, '基準 ' + c.state.baseline);
    // 倒轉 5 分鐘（seeked）
    seeks++; tick(340);
    await frame(); await frame();
    eq(c.state.mode, 'sync');
    assert(near(300), '同步到 5 分鐘前（扣掉基準）：' + c.state.currentId);
    assert(visible(c.state.currentId), '目前訊息在可視範圍');
    // 使用者手動捲動 → 同步暫停
    await userScroll();
    eq(c.state.syncPaused, true);
    tick(340); await frame();
    assert(c.els.list.scrollTop < 50, '暫停中不捲動');
    // 再倒轉 1 分鐘（seeked）→ 解除暫停、跳到新位置（16.3 第 1 點；v42 停著不動）
    seeks++; tick(400);
    await frame(); await frame();
    eq(c.state.syncPaused, false, 'seek 解除暫停');
    assert(near(360), '同步到 6 分鐘前：' + c.state.currentId);
    assert(visible(c.state.currentId), '跳到新位置');
    assert(c.els.resume.hidden, '不再顯示「回到播放位置」');
    // 再捲動、再 seek，但這次 seeked 沒觸發（seeks 不變）→ 以播放位置跳轉判定
    await userScroll();
    eq(c.state.syncPaused, true);
    tick(460);
    await frame(); await frame();
    eq(c.state.syncPaused, false, '跳轉後備');
    assert(near(420) && visible(c.state.currentId), '跳轉後備：跳到 7 分鐘前 ' + c.state.currentId);
    assert(c.state.diag.seeks === 2 && c.state.diag.jumps >= 1, JSON.stringify([c.state.diag.seeks, c.state.diag.jumps]));
    // 倒轉到最早收錄的訊息之前 → 提示
    seeks++; tick(40 + 3600);
    await frame();
    const hint = c.els.syncHint;
    assert(hint && !hint.hidden && hint.textContent.includes('之前沒有收錄'), '範圍外提示 ' + (hint && hint.textContent));
    // 連線狀態：模式、延遲與基準、seeked、目標 → 訊息
    c.els.moreBtn.click();
    let dl = c.els.menu.querySelector('.diag-line').textContent;
    assert(dl.includes('模式 sync') && dl.includes('延遲 3640.0 秒（基準 40.0）') && dl.includes('seeked 3') && dl.includes('目標 ') && dl.includes('→ 無'), '連線狀態：' + dl);
    // 回到最新（seeked）→ tail、跟隨到底、提示消失
    seeks++; tick(40);
    await frame(); await frame();
    eq(c.state.mode, 'tail');
    assert(c.state.vl.follow && hint.hidden, '回到最新');
    // 選單開著時每秒刷新（16.1 (H)）；資料庫＝實際筆數（16.1 (G)）
    await until(() => c.els.menu.querySelector('.diag-line').textContent.includes('模式 tail'), 2500, '選單沒有刷新');
    await put(null, [mk({ id: 'k-new', videoId: VL, timestampAbs: now, videoOffsetSec: 53000 })]);
    await until(() => c.state.diag.dbReal === 301, 2500, '實際筆數 ' + c.state.diag.dbReal);
    await until(() => c.els.menu.querySelector('.diag-line').textContent.includes('／資料庫 301'), 2500, '選單的資料庫筆數');
    document.body.click();
    assert(c.els.menu.hidden, '關閉選單');
  });

  // ================================================================ T5.3（審查十一 18.1 (K)）
  // 同一場：直播時收錄（live，offset＝到達時間 − 開播，比影片時間晚 8 秒）＋結束後看 VOD（replay，影片時間）
  function kFixture(VK) {
    const msgs = [];
    for (let i = 0; i < 20; i++) { const off = 1900 + i * 10; msgs.push(mk({ id: 'mg' + i, videoId: VK, videoOffsetSec: off, offsets: { v1: off }, offsetSource: 'replay', sources: ['live', 'replay'], timestampAbs: T0 + (off + 8) * 1000, runs: [{ text: '合併 ' + i }] })); }
    for (let j = 0; j < 10; j++) { const off = 1905 + j * 10; msgs.push(mk({ id: 'lv' + j, videoId: VK, videoOffsetSec: off + 8, offsets: { v1: off + 8 }, offsetSource: 'estimated', sources: ['live'], timestampAbs: T0 + (off + 8) * 1000, runs: [{ text: '只有直播 ' + j }] })); }
    for (let j = 0; j < 10; j++) { const off = 1903 + j * 10; msgs.push(mk({ id: 'rp' + j, videoId: VK, videoOffsetSec: off, offsets: { v1: off }, offsetSource: 'replay', sources: ['replay'], timestampAbs: T0 + off * 1000, runs: [{ text: '只有重播 ' + j }] })); }
    return msgs;
  }
  test('T5.3 (K) VOD 校正：已合併訊息的 replay offset − live 估計值的中位數；只有 live 的以此換算；沒有合併時以同作者同內容配對；排序', () => {
    const msgs = kFixture('vidKCAL0001');
    const stream = { startedAt: T0 };
    const cal = CORE.vodCalibration(msgs, stream);
    eq([cal.delta, cal.pairs, cal.how, cal.liveOnly, cal.replay], [-8, 20, 'merged', 10, 30]);
    const lv2 = msgs.find((m) => m.id === 'lv2');
    eq(CORE.versionOffset(lv2, 'v1', cal), 1925, '只有 live：到達時間 − 開播 − 8');
    eq(CORE.versionOffset(lv2, 'v1', null), 1933, '沒有校正值：維持原本的估計值');
    eq(CORE.versionOffset(msgs.find((m) => m.id === 'mg2'), 'v1', cal), 1920, '已合併：replay offset');
    eq(CORE.versionOffset(lv2, 'v2', cal), null, '其他版本不套用');
    const sorted = CORE.sortForVod(msgs.map((m) => CORE.indexMessage(m, new Map())), 'v1', cal).map((it) => CORE.vodSortKey(it.m, 'v1', cal));
    assert(sorted.every((k, i) => i === 0 || k >= sorted[i - 1]), '依同步時間遞增');
    // live 與 replay 沒有合併（id 不同、各存一份）：以內容配對
    const dupe = [];
    for (let i = 0; i < 8; i++) {
      dupe.push(mk({ id: 'L' + i, authorHandle: '@u' + i, runs: [{ text: '同一句 ' + i }], sources: ['live'], offsetSource: 'estimated', videoOffsetSec: 100 + i * 30 + 6, timestampAbs: T0 + (100 + i * 30 + 6) * 1000 }));
      dupe.push(mk({ id: 'R' + i, authorHandle: '@u' + i, runs: [{ text: '同一句 ' + i }], sources: ['replay'], offsetSource: 'replay', videoOffsetSec: 100 + i * 30, timestampAbs: T0 + (100 + i * 30) * 1000 }));
    }
    const c2 = CORE.vodCalibration(dupe, stream);
    eq([c2.delta, c2.pairs, c2.dupPairs, c2.how], [-6, 0, 8, 'content']);
    eq(CORE.vodCalibration(dupe, {}).delta, null, '沒有開播時間不校正');
  });

  test('T5.3 (K) VOD 嵌入面板：清單依同步時間排序；點時間碼後藍框標在被點的那則，直到播放位置越過下一則', async () => {
    await resetDb();
    const VK = 'vidKVOD0001';
    await put({ videoId: VK, title: 'K', isLive: true, startedAt: T0, endedAt: T0 + 4000e3, lastMessageAt: T0 + 2200e3, messageCount: 40, versions: [{ id: 'v1', duration: 4000 }], linkedVideos: [] }, kFixture(VK));
    await DB.close();
    const opened = [];
    const realOpen = window.open;
    window.open = (u) => { opened.push(String(u)); return null; };
    try {
      const c = V.mount(host, { embed: true, videoId: VK });
      await c.ready; await frame();
      const A = Date.now();
      c._onClock({ currentTime: 1900.5, paused: false, duration: 4000, live: false, at: A });
      await frame(); await frame();
      const keys = c.state.entries.filter((e) => e.kind === 'msg').map((e) => CORE.vodSortKey(e.it.m, 'v1', c.state.cal));
      assert(keys.every((k, i) => i === 0 || k >= keys[i - 1]), '清單依同步時間排序');
      eq(c.state.cal.delta, -8);
      // v43 以前：依到達時間排序，只有 replay 的（ts＝offset）排在合併的前面 → 同步點跳過部分訊息
      c.state.vl.reveal(c.state.entries.findIndex((e) => e.key === 'lv2'), false); await frame(); await frame();
      const btn = c.els.list.querySelector('[data-id="lv2"] button.tc');
      assert(btn && btn.textContent === '32:05', '時間碼為校正後的時間 ' + (btn && btn.textContent));
      btn.click();
      assert(opened.length === 1 && opened[0].includes('t=1925'), '跳轉到 32:05 ' + opened[0]);
      eq(c.state.currentId, 'lv2', '點下去立刻標在被點的那則');
      // 播放器實際跳到 32:04（關鍵影格）→ 仍標在 lv2；越過下一則（mg3＝32:10）後才改
      c._onClock({ currentTime: 1924.2, paused: false, duration: 4000, live: false, at: A + 1000 });
      eq(c.state.currentId, 'lv2', '跳轉落點略早：仍標在被點的那則');
      c._onClock({ currentTime: 1927, paused: false, duration: 4000, live: false, at: A + 3800 });
      eq(c.state.currentId, 'lv2');
      c._onClock({ currentTime: 1930.4, paused: false, duration: 4000, live: false, at: A + 7200 });
      eq(c.state.currentId, 'mg3', '越過下一則');
      c.els.moreBtn.click();
      const dl = c.els.menu.querySelector('.diag-line').textContent;
      assert(dl.includes('VOD 校正 −8.0 秒（已合併 20、疑似重複 0、只有 live 10）'), '連線狀態：' + dl);
      document.body.click();
    } finally { window.open = realOpen; }
  });

  // ================================================================ T5.4（審查十一 20.2）直播牆上時間錨點
  test('T5.4 直播牆上時間錨點（20.2）：seekEnd 停住時倒轉 1／2／3 分鐘都對齊；「藍框提早／延後」、+ 往較新、依頻道記住；本頁沒量過錨點 → 提示先回到最新；P10', async () => {
    await resetDb();
    const VL = 'vidWALLA001', VO = 'vidWALLOTHR';
    const now = Date.now();
    const msgs = [];
    for (let i = 0; i < 400; i++) msgs.push(mk({ id: 'w' + i, videoId: VL, timestampAbs: now - (400 - i) * 5e3 + 300e3, videoOffsetSec: 50000 + i * 5, runs: [{ text: '不應出現 ' + i }] }));
    for (let i = 0; i < 400; i++) msgs.push(mk({ id: 'x' + i, videoId: VO, timestampAbs: now - (400 - i) * 5e3 + 300e3, videoOffsetSec: 50000 + i * 5 }));
    await put({ videoId: VL, title: 'W', channelHandle: '@chanW', isLive: true, startedAt: now - 86400e3, lastMessageAt: now, messageCount: 400, versions: [], linkedVideos: [] }, msgs.slice(0, 400));
    await put({ videoId: VO, title: 'X', channelHandle: '@otherW', isLive: true, startedAt: now - 86400e3, lastMessageAt: now, messageCount: 400, versions: [], linkedVideos: [] }, msgs.slice(400));
    await DB.close();
    chrome.storage.local._reset();
    const sent = [];
    const realSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (m) => { sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); };
    try {
      await chrome.storage.local.set({ liveSync: { byChannel: { '@chanW': -110 }, last: -110, baseline: 2038.8 } }); // v44 的值：不沿用
      await chrome.storage.local.set({ [self.YTCAS_CONST.DIAG.STATE_KEY]: { active: true, probes: ['P10'] } });
      let c = V.mount(host, { embed: true, videoId: VL });
      await c.ready; await frame();
      eq([c.state.latency, c.state.latencyFrom], [0, 'default'], 'v44 的 liveSync 不沿用');
      // 實機（20.2 圖4）：seekEnd 停住不前進（速度 0.00）、seekEnd − currentTime ≈ 3,486 秒；徽章「最新」可靠
      let t = now, ct = 10000, seeks = 0;
      const SE = 13486;
      const tick = (o, dt) => { dt = dt == null ? 1000 : dt; t += dt; if (!(o && o.paused)) ct += dt / 1000; c._onClock(Object.assign({ currentTime: ct, paused: false, duration: null, seekStart: 3000, seekEnd: SE, live: true, at: t, seeks, liveHead: true, badge: 'class' }, o)); };
      const behind = { liveHead: false, badge: 'behind' };
      const cur = () => msgs.find((x) => x.id === c.state.currentId);
      const near = (back) => { const m = cur(); return !!m && m.timestampAbs <= t - back * 1000 && m.timestampAbs > t - back * 1000 - 5e3; };
      for (let k = 0; k < 12; k++) tick();
      eq(c.state.mode, 'tail');
      eq(c.state.wallSamples.length, 12);
      // 播放器偶發的小抖動（一次 2 秒的跳動）：中位數不受影響
      t += 1000; ct += 1;
      c._onClock({ currentTime: ct - 2, paused: false, duration: null, seekStart: 3000, seekEnd: SE, live: true, at: t, seeks, liveHead: true, badge: 'class' });
      tick();
      eq(c.state.wallA, now - 10000e3, '錨點＝中位數');
      // 倒轉 1、2、3 分鐘，各播放 20 秒：差距固定（v44 會隨倒轉量變大）
      for (const back of [60, 120, 180]) {
        seeks++; ct -= back; tick(behind, 0);
        await frame();
        eq(c.state.mode, 'sync', '倒轉 ' + back);
        assert(near(back), '倒轉 ' + back + ' 秒 → ' + back + ' 秒前：' + c.state.currentId);
        for (let k = 0; k < 20; k++) tick(behind);
        assert(near(back), '播放 20 秒後仍是 ' + back + ' 秒前：' + c.state.currentId);
        const a0 = c.state.wallA;
        seeks++; ct += back; tick({}, 0); // 點「直播」回到最新 → 重新量錨點
        eq(c.state.mode, 'tail');
        // v47（26.2）：新的一段要穩定 3 秒才採用；採用前沿用上一段的錨點
        eq([c.state.anchor.cand.length, c.state.wallA], [1, a0], '回到最新：重新量（候選 1、錨點沿用上一段）');
        for (let k = 0; k < 8; k++) tick(); // 採用後超過 5 秒才再倒轉（5 秒內倒轉到非最新＝作廢，見 T5.6 測試）
        eq(c.state.wallSamples.length, 9, '新的一段已採用（穩定 3 秒後，候選一併採用）');
      }
      // 同步微調：倒轉 1 分鐘；按 +10 三次 → 藍框往較新的訊息移動 30 秒（提早 30 秒）
      seeks++; ct -= 60; tick(behind, 0); await frame();
      assert(!c.els.latBox.hidden && c.els.latText.textContent === '同步微調：0 秒', c.els.latText.textContent);
      assert(c.els.latBox.textContent.includes('按 + 藍框往較新的訊息移動，按 − 往較舊移動'), '說明');
      const btn = (label) => Array.from(c.els.latBox.querySelectorAll('button')).find((b) => b.textContent === label);
      btn('+10').click(); btn('+10').click(); btn('+10').click();
      eq([c.state.latency, c.state.latencyFrom], [-30, 'channel']);
      assert(near(30), '+30：往較新 → 30 秒前 ' + c.state.currentId);
      eq(c.els.latText.textContent, '同步微調：藍框提早 30 秒（本頻道）');
      for (let k = 0; k < 5; k++) btn('−10').click();
      eq(c.state.latency, 20);
      assert(near(80), '−50：往較舊 → 80 秒前 ' + c.state.currentId);
      eq(c.els.latText.textContent, '同步微調：藍框延後 20 秒（本頻道）');
      c.els.moreBtn.click();
      const dl = c.els.menu.querySelector('.diag-line').textContent;
      assert(dl.includes('錨點 ') && dl.includes('樣本、範圍 ') && dl.includes('同步微調 藍框延後 20 秒（本頻道）') && dl.includes('seekEnd 速度 0.00'), '連線狀態：' + dl);
      document.body.click();
      // P10：記錄中且選了 P10 → 每 10 秒一筆，只有數字與徽章代碼
      const p10all = sent.filter((m) => m.type === 'DIAG_LOG').map((m) => m.records[0]).filter((r) => r.probe === 'P10');
      const p10 = p10all.filter((r) => r.kind === 'live-clock');
      assert(p10.length >= 8 && p10.length <= 16, 'P10 筆數 ' + p10.length);
      // v47（26.2 第 4 點）seek 與錨點採用另記事件
      const kinds = new Set(p10all.map((r) => r.kind));
      assert(kinds.has('live-seek') && kinds.has('anchor-ok'), 'P10 事件 ' + [...kinds]);
      assert(p10all.every((r) => typeof r.data.anchorCand === 'number' && typeof r.data.anchorVoids === 'number'), '錨點欄位');
      const r = p10[0];
      eq([r.kind, r.ctx.env, r.ctx.videoId], ['live-clock', 'panel', VL]);
      eq(r.data.seekEnd, SE);
      assert(typeof r.data.now === 'number' && typeof r.data.currentTime === 'number' && typeof r.data.wallA === 'number' && ['class', 'behind'].includes(r.data.badge), JSON.stringify(r.data));
      assert(!JSON.stringify(p10).includes('不應出現') && !JSON.stringify(p10).includes('@chanW'), '沒有內容與頻道');
      await sleep(900); // 寫入 storage 有 800ms 延遲
      const st = (await chrome.storage.local.get('liveSyncV2')).liveSyncV2;
      eq([st.byChannel['@chanW'], st.last, st.baseline], [20, 20, undefined]);
      // 進入頁面時就不在最新（本頁沒量過錨點）：提示先回到最新，清單不動、不沿用別的分頁記下的值
      c = V.mount(host, { embed: true, videoId: VO });
      await c.ready; await frame();
      eq([c.state.latency, c.state.latencyFrom], [20, 'last']);
      t = Date.now(); ct = 5000;
      tick(behind, 0); await frame();
      eq(c.state.mode, 'sync');
      eq([c.state.wallA, c.state.currentId], [null, null]);
      const hint = c.els.syncHint;
      assert(hint && !hint.hidden && hint.textContent.includes('請先點播放器的「直播」回到最新一次'), '提示 ' + (hint && hint.textContent));
      const tcb = c.els.list.querySelector('.vrow .tc');
      assert(tcb && tcb.tagName === 'SPAN', '沒量過錨點：時間碼不可點');
      // 回到最新一次後再倒轉 → 對齊
      seeks++; ct = 5100; tick({}, 0);
      for (let k = 0; k < 9; k++) tick(); // v47：穩定 3 秒才採用；採用後 5 秒內倒轉會作廢
      seeks++; ct -= 120; tick(behind, 0); await frame();
      assert(hint.hidden, '量到錨點後提示消失');
      const m = msgs.find((x) => x.id === c.state.currentId);
      assert(m && m.timestampAbs <= t - 140e3 && m.timestampAbs > t - 145e3, '2 分鐘前再延後 20 秒（沿用上次）：' + c.state.currentId);
      // 回到原頻道：用該頻道的值
      c = V.mount(host, { embed: true, videoId: VL });
      await c.ready;
      eq([c.state.latency, c.state.latencyFrom], [20, 'channel']);
    } finally { chrome.runtime.sendMessage = realSend; await sleep(900); chrome.storage.local._reset(); }
  });

  test('T5.4 待機室（21.1）：播放器回報 live 也不做時間軸同步、不顯示同步微調；已結束場次也不顯示', async () => {
    await resetDb();
    const VW = 'vidWAITRM01';
    const now = Date.now();
    await put({ videoId: VW, title: 'wait', isLive: true, startedAt: null, scheduledStartAt: now + 100 * 86400e3, lastMessageAt: now, messageCount: 3, versions: [], linkedVideos: [] },
      [0, 1, 2].map((i) => mk({ id: 'wr' + i, videoId: VW, phase: 'pre', timestampAbs: now - (3 - i) * 60e3, videoOffsetSec: null })));
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VW });
    await c.ready; await frame();
    c._onClock({ currentTime: 100, paused: false, duration: null, seekStart: 0, seekEnd: 3600, live: true, at: now, liveHead: false, badge: 'behind' });
    await frame();
    eq(c.state.mode, 'tail', '待機室：跟隨到底');
    assert(c.els.latBox.hidden, '待機室不顯示同步微調');
    const hint = c.els.syncHint;
    assert(hint.hidden, '不提示回到最新');
  });

  // ================================================================ T5.5（審查十一第 23 節）
  test('T5.5 待機室判定（第 23 節第 2 點）：預告／倒數影片 currentTime 前進＋徽章「非最新」、場次沒有預定時間但訊息全是 pre、播放器時間比資料先到、回報 live: false，都不同步', () => {
    const pre = [0, 1].map((i) => ({ m: mk({ id: 'p' + i, phase: 'pre' }) }));
    const live = [{ m: mk({ id: 'l0', phase: 'live' }) }];
    const notice = [{ m: mk({ id: 'ytcas-ve-x', type: 'system', phase: 'live' }) }];
    eq(CORE.isWaitingRoom(null, []), true, '場次還沒載入');
    eq(CORE.isWaitingRoom({ scheduledStartAt: T0 }, live), true, '有預定時間、還沒開播');
    eq(CORE.isWaitingRoom({ startPending: true, scheduledStartAt: T0 }, live), true, '等待開播確認');
    eq(CORE.isWaitingRoom({ startedAt: T0 }, pre), false, '已開播');
    eq(CORE.isWaitingRoom({ startedAt: T0, endedAt: T0 + 1 }, pre), false, '已結束');
    eq(CORE.isWaitingRoom({ videoId: 'x' }, pre.concat(notice)), true, '沒有開播／預定時間：訊息全是 pre（提示不算）');
    eq(CORE.isWaitingRoom({ videoId: 'x' }, pre.concat(live)), false, '有 live 訊息');
    eq(CORE.isWaitingRoom({ videoId: 'x' }, []), false, '沒有任何資訊：視為直播中');
  });

  test('T5.6 待機室（26.1）：預定開播時間在未來（meta）→ 不論 startedAt 一律待機室；降落事件不是開播訊號；標頭「待機室」、不同步', async () => {
    const now = Date.now();
    const fut = { startedAt: now - 3941e3, startedAtSource: 'signal', scheduledStartAt: now + 25 * 3600e3, scheduledFuture: true, isLive: true };
    const raid = [{ m: mk({ id: 'ytcas-raid-1', type: 'raid', phase: 'live' }) }];
    eq(CORE.isWaitingRoom(fut, raid), true, '有 startedAt 也是待機室');
    eq(CORE.isWaitingRoom(Object.assign({}, fut, { startedAtSource: 'replay' }), raid), false, '重播來源例外');
    eq(CORE.isWaitingRoom(Object.assign({}, fut, { scheduledFuture: false }), raid), false, 'meta 沒說在未來（提早開播）→ 依 startedAt');
    eq(CORE.isWaitingRoom(Object.assign({}, fut, { scheduledStartAt: now - 1000 }), raid), false, '預定時間已過 → 不套用硬性規則');
    eq(CORE.isWaitingRoom({ startedAt: now - 1000, startedAtSuspect: true, scheduledStartAt: now - 60e3 }, raid), true, '已降級的 startedAt 視同沒有');
    await resetDb();
    const VW = 'vidWAITRM03';
    await put(Object.assign({ videoId: VW, title: 'wait3', lastMessageAt: now, messageCount: 2, versions: [], linkedVideos: [] }, fut),
      [mk({ id: 'ytcas-raid-1', videoId: VW, type: 'raid', phase: 'pre', timestampAbs: now - 60e3, videoOffsetSec: null, runs: [{ text: '@raider 降落' }] }),
        mk({ id: 'wz1', videoId: VW, phase: 'pre', timestampAbs: now - 30e3, videoOffsetSec: null })]);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VW });
    await c.ready; await frame();
    let t = now, ct = 100;
    for (let k = 0; k < 8; k++) { t += 1000; ct += 1; c._onClock({ currentTime: ct, paused: false, duration: null, seekStart: 0, seekEnd: 3600, live: true, at: t, liveHead: k < 4, badge: k < 4 ? 'class' : 'behind' }); }
    await frame();
    eq([c.state.mode, c.state.currentId, c.state.wallA], ['tail', null, null], '不同步、不量錨點');
    assert(/待機室/.test(c.els.meta.textContent) && !/直播中/.test(c.els.meta.textContent), '標頭 ' + c.els.meta.textContent);
    assert(c.els.syncHint.hidden && c.els.latBox.hidden, '沒有同步提示與同步微調');
    assert(!c.els.list.querySelector('.live-dot'), '沒有直播中的紅點');
  });

  test('T5.6 錨點（26.2）：載入時先最新 → 2 秒後 seek 到 t=600 → 不同步、顯示提示；採用後 5 秒內被 seek 到非最新 → 作廢並重新提示；網址帶 t= 時等點「直播」或穩定 10 秒', async () => {
    // 純函式
    const P = { stableMs: 3000, guardMs: 5000, strictMs: 10000, maxN: 60 };
    const step = (a, at, ct, o) => CORE.anchorStep(a, Object.assign({ live: true, paused: false, at, currentTime: ct, liveHead: true }, o && o.clock), Object.assign({ edge: true, seeked: false }, P, o));
    let a = CORE.anchorInit(false), r;
    for (let k = 0; k <= 2; k++) a = step(a, 1000e3 + k * 1000, 9000 + k).state;
    eq([a.wallA, a.cand.length], [null, 3], '穩定 2 秒：還沒採用');
    r = step(a, 1003e3, 9003 - 600 + 3, { seeked: true, edge: false, clock: { liveHead: false } });
    eq([r.state.wallA, r.state.cand.length], [null, 0], 'seek 到非最新：候選丟掉');
    // 讀不到徽章（liveHead null）：一律等 10 秒
    a = CORE.anchorInit(false);
    for (let k = 0; k <= 9; k++) a = step(a, 2000e3 + k * 1000, 100 + k, { clock: { liveHead: null } }).state;
    eq(a.wallA, null, '讀不到徽章：9 秒還沒採用');
    a = step(a, 2010e3, 110, { clock: { liveHead: null } }).state;
    eq(a.wallA, 2000e3 - 100e3, '10 秒後採用');
    // 網址帶 t=：最新穩定 5 秒不採用；從非最新點回「直播」後 3 秒採用
    a = CORE.anchorInit(true);
    for (let k = 0; k <= 5; k++) a = step(a, 3000e3 + k * 1000, 500 + k).state;
    eq([a.wallA, a.strict], [null, true], 't=：穩定 5 秒不採用');
    a = step(a, 3006e3, 300, { seeked: true, edge: false, clock: { liveHead: false } }).state; // YouTube 跳到 t=
    a = step(a, 3007e3, 301, { edge: false, clock: { liveHead: false } }).state;
    a = step(a, 3008e3, 700, { seeked: true }).state; // 使用者點「直播」
    eq(a.liveClicked, true);
    for (let k = 1; k <= 3; k++) a = step(a, 3008e3 + k * 1000, 700 + k).state;
    eq([a.wallA, a.strict], [3008e3 - 700e3, false], '點「直播」後穩定 3 秒採用');
    // 面板：先最新 2 秒 → seek 到 t=600（非最新）
    await resetDb();
    const VL = 'vidANCHOR01';
    const now = Date.now();
    const msgs = [];
    for (let i = 0; i < 300; i++) msgs.push(mk({ id: 'an' + i, videoId: VL, timestampAbs: now - (300 - i) * 10e3, videoOffsetSec: 3000 + i * 10 }));
    await put({ videoId: VL, title: 'A', isLive: true, startedAt: now - 7200e3, lastMessageAt: now, messageCount: 300, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    let c = V.mount(host, { embed: true, videoId: VL });
    await c.ready; await frame();
    let t = now, ct = 7200, seeks = 0;
    const tick = (o, dt) => { dt = dt == null ? 1000 : dt; t += dt; if (!(o && o.paused)) ct += dt / 1000; c._onClock(Object.assign({ currentTime: ct, paused: false, duration: null, seekStart: 0, seekEnd: 7300, live: true, at: t, seeks, liveHead: true, badge: 'class' }, o)); };
    const behind = { liveHead: false, badge: 'behind' };
    tick({}, 0); tick(); tick();
    seeks++; ct = 600; tick(behind, 0); await frame();
    for (let k = 0; k < 5; k++) tick(behind);
    await frame();
    eq([c.state.mode, c.state.wallA, c.state.currentId], ['sync', null, null], '不同步（v46 會在最新一則加藍框）');
    assert(!c.els.syncHint.hidden && /請先點播放器的「直播」/.test(c.els.syncHint.textContent), '顯示提示');
    // 點「直播」回到最新、穩定 3 秒採用 → 2 秒後又被 seek 到非最新 → 作廢、提示重新出現（即使先前按過 ✕）
    c.els.syncHint.querySelector('.note-x').click();
    seeks++; ct = 7300; tick({}, 0);
    for (let k = 0; k < 3; k++) tick();
    assert(c.state.wallA != null, '採用');
    tick(); tick();
    seeks++; ct = 900; tick(behind, 0); await frame();
    eq([c.state.wallA, c.state.anchor.voids, c.state.currentId], [null, 1, null], '作廢');
    assert(!c.els.syncHint.hidden, '重新提示');
    c.els.moreBtn.click();
    assert(c.els.menu.querySelector('.diag-line').textContent.includes('作廢 1 次'), '連線狀態顯示作廢次數');
    document.body.click();
    // 網址帶 t=（panel 的 clock.urlT）：在最新穩定 5 秒仍不採用
    c = V.mount(host, { embed: true, videoId: VL });
    await c.ready; await frame();
    t = Date.now(); ct = 7300; seeks = 0;
    for (let k = 0; k < 6; k++) tick({ urlT: true });
    eq([c.state.wallA, c.state.anchor.strict], [null, true], 't=：5 秒不採用');
    for (let k = 0; k < 5; k++) tick({ urlT: true });
    assert(c.state.wallA != null && !c.state.anchor.strict, 't=：穩定 10 秒後採用');
  });

  test('T5.6 頭像（26.3）：點頭像以新分頁開作者頻道（頻道 id 優先、其次 @handle，只限 youtube.com）；所有卡片一致；沒有頻道資訊不可點；點名稱＝篩選不變', async () => {
    const UC = 'UC' + 'a'.repeat(22);
    eq(CORE.channelUrl({ authorChannelId: UC, authorHandle: '@alice' }), 'https://www.youtube.com/channel/' + UC, '頻道 id 優先');
    eq(CORE.channelUrl({ authorHandle: '@alice' }), 'https://www.youtube.com/@alice');
    eq(CORE.channelUrl({ authorUrl: 'http://www.youtube.com/channel/' + UC + '/' }), 'https://www.youtube.com/channel/' + UC, 'authorUrl 的頻道 id');
    eq(CORE.channelUrl({ authorUrl: 'https://evil.example/@alice' }), '', '不是 youtube.com');
    eq(CORE.channelUrl({ authorUrl: 'javascript:alert(1)', authorHandle: '' }), '');
    eq(CORE.channelUrl({ authorUrl: 'https://evil.example/x', authorHandle: '@bob' }), 'https://www.youtube.com/@bob', '網址不合格 → 改用 @handle');
    eq(CORE.channelUrl({ authorName: '只有名稱' }), '', '只有名稱：不可點');
    eq(CORE.channelUrl({ authorHandle: '@中文名稱' }), 'https://www.youtube.com/@' + encodeURIComponent('中文名稱'));
    await resetDb();
    const VA = 'vidAVLINK01';
    const now = Date.now();
    const types = [
      mk({ id: 'a-text', videoId: VA, authorHandle: '@alice', timestampAbs: now - 9e3 }),
      mk({ id: 'a-sc', videoId: VA, type: 'superchat', authorHandle: '@bob', amount: '$5', color: '#1e88e5', timestampAbs: now - 8e3 }),
      mk({ id: 'a-stk', videoId: VA, type: 'supersticker', authorHandle: '@carol', amount: '$2', color: '#00e5ff', timestampAbs: now - 7e3 }),
      mk({ id: 'a-gift', videoId: VA, type: 'gift', authorHandle: '@dave', giftName: '花', runs: [{ text: '送出了 花' }], timestampAbs: now - 6e3 }),
      mk({ id: 'a-mem', videoId: VA, type: 'membership', authorHandle: '@erin', runs: [{ text: '歡迎加入' }], timestampAbs: now - 5e3 }),
      mk({ id: 'a-ms', videoId: VA, type: 'membership', authorHandle: '', authorChannelId: UC, authorName: 'Frank', runs: [{ text: '會員 3 個月' }, { text: '\n' }, { text: '謝謝' }], timestampAbs: now - 4e3 }),
      mk({ id: 'a-none', videoId: VA, authorHandle: '', authorName: '無頻道', timestampAbs: now - 3e3 }),
    ];
    await put({ videoId: VA, title: 'AV', isLive: true, startedAt: now - 3600e3, endedAt: now, lastMessageAt: now, messageCount: types.length, versions: [], linkedVideos: [] }, types,
      [mk({ id: 'a-pin', videoId: VA, authorHandle: '@pinner', pinnedAt: now, runs: [{ text: '置頂' }] })]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VA });
    await c.ready; await frame(); await frame();
    const row = (id) => c.els.list.querySelector('[data-id="' + id + '"]');
    const expect = { 'a-text': '@alice', 'a-sc': '@bob', 'a-stk': '@carol', 'a-gift': '@dave', 'a-mem': '@erin', 'a-ms': 'channel/' + UC };
    for (const [id, tail] of Object.entries(expect)) {
      const r = row(id);
      assert(r, '列 ' + id);
      const a = r.querySelector('a.av-link');
      assert(a, id + '：頭像是連結');
      eq([a.getAttribute('href'), a.target, a.rel, a.title], ['https://www.youtube.com/' + tail, '_blank', 'noopener noreferrer', '開啟頻道'], id);
      assert(a.querySelector('.av'), id + '：連結內是頭像');
      eq(getComputedStyle(a).cursor, 'pointer', id + ' 手型游標');
    }
    const none = row('a-none');
    assert(none && !none.querySelector('a.av-link') && none.querySelector('.av'), '沒有頻道資訊：不可點');
    assert(getComputedStyle(none.querySelector('.av')).cursor !== 'pointer', '沒有手型游標');
    // 置頂列：點頭像不展開／收合
    const pa = c.els.pin.querySelector('a.av-link');
    assert(pa && pa.getAttribute('href') === 'https://www.youtube.com/@pinner', '置頂的頭像');
    const open0 = c.state.pinOpen;
    pa.addEventListener('click', (e) => e.preventDefault(), { once: true }); // 測試頁不開新分頁
    pa.click();
    eq(c.state.pinOpen, open0, '點頭像不切換置頂列');
    // 點名稱＝只看這位使用者（不變）
    row('a-text').querySelector('.nm').click(); await frame();
    eq(c.state.f.userChip, '@alice', '點名稱篩選');
  });

  test('T5.6 SC 文字色（26.4）：有 YouTube 文字色 → 標題列／名稱／時間／內文照用（藍底白字）；沒有 → 對比度規則；不合格的值不採用', async () => {
    const yt = CORE.scColors({ color: 'rgba(30,136,229,1)', textColors: { header: '#ffffff', author: 'rgba(255,255,255,0.7)', timestamp: '#ffffff80', body: '#ffffff' } });
    eq([yt.from, yt.header, yt.author, yt.timestamp, yt.body, yt.onDark], ['youtube', '#ffffff', 'rgba(255,255,255,0.7)', '#ffffff80', '#ffffff', true]);
    const old = CORE.scColors({ color: 'rgba(30,136,229,1)' });
    eq([old.from, old.header, old.onDark], ['contrast', '#000', false], '舊資料：對比度規則（藍底黑字）');
    const part = CORE.scColors({ color: '#1e88e5', textColors: { author: '#ffffffb3' } });
    eq([part.from, part.author, part.header, part.body], ['youtube', '#ffffffb3', '#000', '#000'], '只有部分欄位：其他用對比度規則');
    const bad = CORE.scColors({ color: '#1e88e5', textColors: { header: 'url(x)', body: 'red;background:url(x)' } });
    eq([bad.from, bad.header], ['contrast', '#000'], '不合格的值不採用');
    eq(CORE.scColors({ color: '' }), null);
    await resetDb();
    const VS = 'vidSCCOLOR1';
    await put({ videoId: VS, title: 'SC', isLive: true, startedAt: T0 - 3600e3, endedAt: T0 + 3600e3, lastMessageAt: T0, messageCount: 2, versions: [], linkedVideos: [] }, [
      mk({ id: 'sc-yt', videoId: VS, type: 'superchat', amount: '$15.00', color: 'rgba(30,136,229,1)', authorHandle: '@payer', runs: [{ text: '加油' }],
        textColors: { header: '#ffffff', author: 'rgba(255,255,255,0.7)', timestamp: '#ffffff80', body: '#ffffff' } }),
      mk({ id: 'sc-old', videoId: VS, type: 'superchat', amount: '$15.00', color: 'rgba(30,136,229,1)', authorHandle: '@payer2', timestampAbs: T0 + 1000, runs: [{ text: '舊的' }] }),
    ]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VS });
    await c.ready; await frame(); await frame();
    const r1 = c.els.list.querySelector('[data-id="sc-yt"]');
    const rgb = (n) => getComputedStyle(n).color;
    assert(r1.classList.contains('yt-colors') && r1.classList.contains('on-dark'), r1.className);
    eq([rgb(r1.querySelector('.amt')), rgb(r1.querySelector('.content')), rgb(r1.querySelector('.nm'))], ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 0.7)']);
    const r2 = c.els.list.querySelector('[data-id="sc-old"]');
    assert(!r2.classList.contains('yt-colors') && r2.classList.contains('on-light'), r2.className);
    eq(rgb(r2.querySelector('.amt')), 'rgb(0, 0, 0)', '舊資料：黑字');
  });

  test('T5.7 短 handle（28.2、27 第 2 點）：DOM 給的 @handle 長度下限 1（@无恋、@魚、@a、含 ·）、路徑段編碼；內文推斷維持 3～30', async () => {
    const enc = (s) => 'https://www.youtube.com/@' + encodeURIComponent(s);
    for (const h of ['无恋', '魚', 'a', 'ナナ·ミ', '又新-david', '魚_5123'])
      eq(CORE.channelUrl({ authorHandle: '@' + h }), enc(h), '@' + h);
    eq(CORE.channelUrl({ authorHandle: '@魚' }), 'https://www.youtube.com/@%E9%AD%9A', '編碼');
    eq(CORE.channelUrl({ authorUrl: 'https://www.youtube.com/@%E6%97%A0%E6%81%8B' }), enc('无恋'), 'authorUrl 的短 handle');
    eq(CORE.channelUrl({ authorHandle: '@' }), '', '只有 @');
    eq(CORE.channelUrl({ authorHandle: '@有 空白' }), '', '含空白');
    const K = self.YTCAS_CONST;
    eq(K.domHandle(' @无恋 '), '@无恋');
    eq([K.handleOf('@无恋 謝謝'), K.handleOf('@abc 謝謝')], ['', '@abc'], '內文推斷維持嚴格規則');
    // 訊息內的 @提及連結（文字＝短 handle）→ youtube.com/@handle
    await resetDb();
    const VH = 'vidSHORTHD1';
    await put({ videoId: VH, title: 'H', isLive: true, startedAt: T0 - 60e3, endedAt: T0 + 60e3, lastMessageAt: T0, messageCount: 1, versions: [], linkedVideos: [] },
      [mk({ id: 'sh1', videoId: VH, authorHandle: '@无恋', runs: [{ text: '@魚', link: { url: 'https://evil.example/x' } }, { text: ' 你好' }] })]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VH });
    await c.ready; await frame(); await frame();
    const r = c.els.list.querySelector('[data-id="sh1"]');
    eq(r.querySelector('a.av-link').getAttribute('href'), enc('无恋'), '@无恋 的頭像可點');
    eq(r.querySelector('.content a.lnk').getAttribute('href'), 'https://www.youtube.com/@%E9%AD%9A', '@魚 的提及連結');
  });

  test('T5.7「≈」（28.3）：tsSource clock 的直播訊息時間碼前加淡色「≈」與說明；arrival、重播來源、VOD 排序時不加；面板與後台一致', async () => {
    await resetDb();
    const VC = 'vidAPPROX01';
    const now = Date.now();
    await put({ videoId: VC, title: 'C', isLive: true, startedAt: now - 3600e3, lastMessageAt: now, messageCount: 3, versions: [], linkedVideos: [] }, [
      mk({ id: 'ck', videoId: VC, tsSource: 'clock', timestampAbs: now - 120e3, videoOffsetSec: 3480 }),
      mk({ id: 'ar', videoId: VC, tsSource: 'arrival', timestampAbs: now - 60e3, videoOffsetSec: 3540 }),
      mk({ id: 'rp', videoId: VC, tsSource: 'clock', offsetSource: 'replay', sources: ['live', 'replay'], timestampAbs: now - 30e3, videoOffsetSec: 3570 }),
    ]);
    await DB.close();
    for (const embed of [false, true]) {
      const c = V.mount(host, { embed, videoId: VC });
      await c.ready; await frame(); await frame();
      const tc = (id) => c.els.list.querySelector('[data-id="' + id + '"] .tc');
      const ap = tc('ck').querySelector('.approx');
      assert(ap && ap.textContent === '≈' && /只精確到分鐘（YouTube 只顯示到分鐘）/.test(tc('ck').title), (embed ? '面板' : '後台') + '：clock 有「≈」 ' + tc('ck').title);
      assert(getComputedStyle(ap).color !== getComputedStyle(tc('ck')).color, '淡色（與時間碼顏色不同）');
      assert(!tc('ar').querySelector('.approx') && !tc('rp').querySelector('.approx'), 'arrival／重播來源不加');
    }
    // 已結束場次的 VOD（後台依影片時間排序）：不加
    await resetDb();
    await put({ videoId: VC, title: 'C', isLive: false, startedAt: now - 3600e3, endedAt: now - 10e3, lastMessageAt: now, messageCount: 1, versions: [], linkedVideos: [] },
      [mk({ id: 'ck2', videoId: VC, tsSource: 'clock', timestampAbs: now - 120e3, videoOffsetSec: 3480 })]);
    await DB.close();
    const c2 = V.mount(host, { embed: false, videoId: VC });
    await c2.ready; await frame(); await frame();
    assert(!c2.els.list.querySelector('[data-id="ck2"] .tc .approx'), 'VOD：不加');
  });

  test('T5.5 待機室（第 23 節）：播放器時間比資料先到、預告影片 currentTime 前進＋「非最新」→ 不同步、不提示、沒有「回到播放位置」與 current 標記、時間碼不可點', async () => {
    await resetDb();
    const VW = 'vidWAITRM02';
    const now = Date.now();
    // 實機（第 23 節圖1）：場次沒有記到預定開播時間，訊息在收錄時判定為 pre
    await put({ videoId: VW, title: 'wait2', isLive: true, startedAt: null, lastMessageAt: now, messageCount: 15, versions: [], linkedVideos: [] },
      Array.from({ length: 15 }, (_, i) => mk({ id: 'wq' + i, videoId: VW, phase: 'pre', timestampAbs: now - (15 - i) * 3600e3, videoOffsetSec: null })));
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VW });
    // 載入完成前就收到播放器時間（v45：場次未知 → 當成直播中 → sync，之後播放器不再回報就一直停在 sync）
    c._onClock({ currentTime: 30, paused: false, duration: 120, seekStart: 0, seekEnd: 3600, live: true, at: now, liveHead: false, badge: 'behind' });
    await c.ready; await frame(); await frame();
    eq(c.state.mode, 'tail', '載入後依場次重新決定模式');
    let t = now, ct = 30;
    for (let k = 0; k < 10; k++) { t += 1000; ct += 1; c._onClock({ currentTime: ct, paused: false, duration: 120, seekStart: 0, seekEnd: 3600, live: true, at: t, liveHead: false, badge: 'behind' }); }
    await frame();
    eq([c.state.mode, c.state.currentId, c.state.wallA], ['tail', null, null], '待機室：不同步、不量錨點');
    assert(c.els.syncHint.hidden && c.els.latBox.hidden, '不顯示提示與同步微調');
    assert(c.els.resume.hidden || !/回到播放位置/.test(c.els.resume.textContent), '沒有「回到播放位置」');
    assert(!c.els.list.querySelector('.current'), '沒有 current 標記');
    const tc = c.els.list.querySelector('.vrow .tc');
    assert(tc && tc.tagName === 'SPAN' && /待機室/.test(tc.title), '時間碼不可點並說明 ' + (tc && tc.title));
    // 預告影片回報 live: false（VOD 形式）也不同步、不依 VOD 排序
    c._onClock({ currentTime: 50, paused: false, duration: 120, live: false, at: t + 1000 });
    await frame();
    eq([c.state.mode, c.state.sortedVod], ['tail', false], 'live: false 也不同步');
  });

  test('T5.5 提示不得遮蓋清單與選單（第 23 節第 1 點、SPEC 10.1 原則 7）：同步提示是版面內的一列、文字完整可換行、✕ 本頁不再顯示；⋯ 選單在所有浮動元素之上；「回到播放位置」顯示時底部留白', async () => {
    await resetDb();
    const VL = 'vidHINTROW1';
    const now = Date.now();
    const msgs = [];
    for (let i = 0; i < 200; i++) msgs.push(mk({ id: 'h' + i, videoId: VL, timestampAbs: now - (200 - i) * 5e3, videoOffsetSec: 50000 + i * 5 }));
    await put({ videoId: VL, title: 'H', isLive: true, startedAt: now - 86400e3, lastMessageAt: now, messageCount: 200, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    host.style.width = '340px';
    try {
      const c = V.mount(host, { embed: true, videoId: VL });
      await c.ready; await frame();
      let t = now, ct = 5000;
      const tick = (o, dt) => { dt = dt == null ? 1000 : dt; t += dt; ct += dt / 1000; c._onClock(Object.assign({ currentTime: ct, paused: false, seekStart: 0, seekEnd: 9000, live: true, at: t, liveHead: false, badge: 'behind' }, o)); };
      tick(null, 0); await frame(); await frame();
      const hint = c.els.syncHint;
      assert(!hint.hidden && hint.textContent.includes('請先點播放器的「直播」回到最新一次，藍框才能對齊（本頁還沒量過直播的時間基準）'), '提示文字完整 ' + hint.textContent);
      // 版面內：不在清單容器裡、不是 absolute／fixed、位在清單上方（把清單往下推，兩者不重疊）
      const cs = getComputedStyle(hint);
      assert(!c.els.list.parentElement.contains(hint) && cs.position !== 'absolute' && cs.position !== 'fixed', '版面內的一列 ' + cs.position);
      assert(cs.whiteSpace !== 'nowrap' && cs.textOverflow !== 'ellipsis', '可換行、不截斷');
      const hr = hint.getBoundingClientRect(), lr = c.els.list.getBoundingClientRect();
      assert(hr.bottom <= lr.top + 0.5, '提示在清單上方、不重疊 ' + [hr.bottom, lr.top]);
      const span = hint.querySelector('span');
      assert(span.scrollWidth <= span.clientWidth + 1 && hr.height > 20, '340px 寬時換行顯示、沒有被截斷 ' + [span.scrollWidth, span.clientWidth, hr.height]);
      // ⋯ 選單開著時：選單在提示與清單之上（點選單中央，最上層的元素屬於選單）
      c.els.moreBtn.click();
      // 面板內所有 absolute／fixed 元素：z-index 低於選單（清單列 .vrow 在清單自己的捲動容器內）。
      // 不用 elementFromPoint：測試分頁在背景時可視範圍為 0
      const mz = Number(getComputedStyle(c.els.menu).zIndex);
      assert(!c.els.menu.hidden && mz >= 10, '選單開著且在最上層 ' + mz);
      // 提示列與選單同時顯示時：提示列不是定位元素，不會蓋在選單上
      eq(getComputedStyle(hint).zIndex, 'auto');
      for (const n of c.els.panel.querySelectorAll('*')) {
        if (n === c.els.menu || c.els.menu.contains(n) || n.closest('.vspace')) continue;
        const s = getComputedStyle(n);
        if (s.position === 'fixed') throw new Error('不得使用 position: fixed：' + n.className);
        if (s.position === 'absolute' && s.zIndex !== 'auto') assert(Number(s.zIndex) < mz, n.className + ' 的 z-index ' + s.zIndex + ' 不低於選單 ' + mz);
      }
      document.body.click();
      // ✕ 關閉：本頁不再顯示同一種提示
      hint.querySelector('.note-x').click();
      assert(hint.hidden, '關閉');
      tick(); tick(); await frame();
      assert(hint.hidden, '同一種提示本頁不再顯示');
      // 「↓ 回到播放位置」：回到最新、量錨點、倒轉、使用者捲動 → 顯示，清單底部留出等高空白，最後一列不被按鈕遮住
      tick({ liveHead: true, badge: 'class', seeks: 1 }, 0);
      for (let k = 0; k < 9; k++) tick({ liveHead: true, badge: 'class', seeks: 1 }); // v47：穩定 3 秒＋超過作廢期間
      ct -= 120; tick({ seeks: 2 }, 0); await frame(); await frame();
      eq(c.state.mode, 'sync');
      c.els.list.dispatchEvent(new Event('wheel'));
      c.els.list.scrollTop = 0; c.els.list.dispatchEvent(new Event('scroll')); await frame(); await frame();
      eq(c.state.syncPaused, true, '使用者捲動 → 同步暫停 ' + c.state.currentId);
      assert(!c.els.resume.hidden && /回到播放位置/.test(c.els.resume.textContent), '顯示「回到播放位置」');
      eq(c.state.vl.padBottom, self.YTCAS_CONST.PANEL.RESUME_PAD_PX, '底部留白');
      c.els.list.dispatchEvent(new Event('wheel'));
      c.els.list.scrollTop = c.els.list.scrollHeight; c.els.list.dispatchEvent(new Event('scroll')); await frame(); await frame();
      const rows = c.els.list.querySelectorAll('.vrow');
      let lastRow = rows[0];
      for (const r of rows) if (parseFloat(r.style.top) > parseFloat(lastRow.style.top)) lastRow = r;
      const br = c.els.resume.getBoundingClientRect(), rr = lastRow.getBoundingClientRect();
      assert(rr.bottom <= br.top + 0.5, '捲到最底時最後一則在按鈕上方 ' + [rr.bottom, br.top]);
      c.els.resume.click(); await frame();
      eq(c.state.vl.padBottom, 0, '按鈕隱藏後取消留白');
    } finally { host.style.width = ''; }
  });

  test('T5.4 禮物顯示（20.4）：送禮者從內文推出時顯示為名稱、內文去掉開頭的 @handle；@handle 連結一律指向 youtube.com/@handle', async () => {
    await resetDb();
    const VG = 'vidGIFTV001';
    await put({ videoId: VG, title: 'g', versions: [], linkedVideos: [] }, [
      mk({ id: 'gv1', videoId: VG, type: 'gift', authorHandle: '@jaro0965', authorSource: 'text', timestampAbs: T0 + 1000, runs: [{ text: '@jaro0965', link: { url: 'https://www.youtube.com/#' } }, { text: ' 贈送X_X' }] }),
      mk({ id: 'gv2', videoId: VG, type: 'gift', authorHandle: '', timestampAbs: T0 + 2000, runs: [{ text: '有人贈送花束' }] }),
    ]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VG });
    await c.ready; await frame(); await frame();
    const row = (id) => c.els.list.querySelector('[data-id="' + id + '"]');
    eq(row('gv1').querySelector('.nm').textContent, '@jaro0965');
    eq(row('gv1').querySelector('.sub').textContent, '贈送X_X', '內文去掉開頭的 @handle');
    eq(row('gv2').querySelector('.nm').textContent, '（未知）');
    // 一般訊息裡的 @handle 連結：舊紀錄的網址指向別處 → 改為頻道網址
    await put(null, [mk({ id: 'gv3', videoId: VG, timestampAbs: T0 + 3000, runs: [{ text: '@someone', link: { url: 'https://www.youtube.com/#' } }, { text: ' 你好' }] })]);
    await DB.close();
    const c2 = V.mount(host, { embed: false, videoId: VG });
    await c2.ready; await frame(); await frame();
    const a = c2.els.list.querySelector('[data-id="gv3"] a.lnk');
    eq(a && a.getAttribute('href'), 'https://www.youtube.com/@someone');
  });

  test('T5.5 禮物卡（24.3、24.4）：名稱列與一般訊息相同（名稱＝篩選、旁邊灰色 @handle、不是連結）；內文＝#message-v2；禮物圖片 alt＝禮物名稱；www.youtube.com 圖片可顯示', async () => {
    await resetDb();
    const VG = 'vidGIFTV002';
    await put({ videoId: VG, title: 'g2', versions: [], linkedVideos: [] }, [
      mk({ id: 'gd1', videoId: VG, type: 'gift', authorName: 'Dennis', authorHandle: '@dennis_tw', authorSource: 'dom', giftName: '星星', giftImage: 'https://www.youtube.com/s/gaming/emoji/gift/star.png', timestampAbs: T0 + 1000, runs: [{ text: '贈送星星' }] }),
      mk({ id: 'gd2', videoId: VG, type: 'gift', authorHandle: '@carol', giftName: '櫻花雨', giftCount: 3, timestampAbs: T0 + 2000, runs: [] }),
      mk({ id: 'tx1', videoId: VG, authorName: 'Dennis', authorHandle: '@dennis_tw', timestampAbs: T0 + 3000, runs: [{ text: '一般訊息' }] }),
    ]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VG });
    await c.ready; await frame(); await frame();
    const row = (id) => c.els.list.querySelector('[data-id="' + id + '"]');
    const g = row('gd1'), t = row('tx1');
    const seq = (n) => Array.from(n.querySelectorAll('.tc, .nm, .hd, .bdg')).map((x) => x.className.split(' ')[0] + ':' + (x.classList.contains('tc') ? '' : x.textContent));
    eq(seq(g).slice(0, 3), seq(t).slice(0, 3), '名稱列與一般訊息相同（時間碼 → 名稱 → 灰色 @handle）');
    eq([g.querySelector('.nm').textContent, g.querySelector('.hd').textContent, g.querySelector('.hd').tagName], ['Dennis', '@dennis_tw', 'SPAN']);
    assert(g.querySelector('.bdg.gift'), '禮物徽章');
    eq(g.querySelector('.sub').textContent, '贈送星星', '內文');
    // 測試頁的 CSP 擋外部圖片（載入失敗後換成 🎁）：以白名單與容器的 title 確認
    eq(CORE.safeImg('https://www.youtube.com/s/gaming/emoji/gift/star.png'), 'https://www.youtube.com/s/gaming/emoji/gift/star.png', 'www.youtube.com 在白名單');
    eq(g.querySelector('.gimg').title, '星星', '禮物名稱');
    const img = g.querySelector('.gimg img');
    if (img) eq([img.getAttribute('src'), img.alt], ['https://www.youtube.com/s/gaming/emoji/gift/star.png', '星星']);
    eq(row('gd2').querySelector('.sub').textContent, '送出 櫻花雨 ×3', '沒有內文時以禮物名稱顯示');
    // 點名稱＝只看這位使用者（與一般訊息一致）
    g.querySelector('.nm').click();
    await frame();
    eq(c.state.f.userChip !== '', true, '套用使用者篩選');
    const ids = c.state.entries.filter((e) => e.kind === 'msg').map((e) => e.it.m.id);
    eq(ids, ['gd1', 'tx1'], '同一位使用者的禮物與訊息');
  });

  test('T5.5 會員里程碑卡（24.6）：有留言＝會員色卡片（標題列：名稱、里程碑、月數／徽章名稱；下方留言），新會員（沒有留言）維持左側色條；深淺色都用 tokens', async () => {
    const ms = mk({ id: 'ms1', type: 'membership', authorName: '桑抹', authorHandle: '@sangmo', timestampAbs: T0 + 1000,
      runs: [{ text: '已加入會員 33 個月 黃金會員' }, { text: '\n' }, { text: '謝謝主播' }, { emoji: { alt: ':heart:' } }] });
    const nw = mk({ id: 'nm1', type: 'membership', authorHandle: '@newbie', timestampAbs: T0 + 2000, runs: [{ text: '歡迎新會員！' }] });
    eq([CORE.isMilestone(ms), CORE.isMilestone(nw), CORE.isMilestone(mk({ type: 'membership', runs: [{ text: '標題' }, { text: '\n' }, { text: '  ' }] }))], [true, false, false]);
    eq(CORE.memberParts(ms), { head: [{ text: '已加入會員 33 個月 黃金會員' }], body: [{ text: '謝謝主播' }, { emoji: { alt: ':heart:' } }] });
    await resetDb();
    const VM = 'vidMILEST01';
    await put({ videoId: VM, title: 'm', versions: [], linkedVideos: [] }, [Object.assign(ms, { videoId: VM }), Object.assign(nw, { videoId: VM })]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VM });
    await c.ready; await frame(); await frame();
    const row = (id) => c.els.list.querySelector('[data-id="' + id + '"]');
    const r = row('ms1');
    assert(r.classList.contains('milestone'), '里程碑卡 ' + r.className);
    eq([r.querySelector('.ms-head .nm').textContent, r.querySelector('.ms-head .hd').textContent, r.querySelector('.ms-head .bdg.member').textContent, r.querySelector('.ms-title').textContent],
      ['桑抹', '@sangmo', '里程碑', '已加入會員 33 個月 黃金會員']);
    eq(r.querySelector('.ms-body').textContent, '謝謝主播:heart:', '留言');
    const n = row('nm1');
    assert(n.classList.contains('member-ev') && !n.classList.contains('milestone'), '新會員維持左側色條');
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      const probe = document.createElement('div'); document.body.append(probe);
      probe.style.background = css('--ytcas-member-strong'); const strong = getComputedStyle(probe).backgroundColor;
      probe.style.background = css('--ytcas-member-soft'); const soft = getComputedStyle(probe).backgroundColor;
      probe.remove();
      eq([bg(r.querySelector('.ms-head')), bg(r.querySelector('.ms-body'))], [strong, soft], theme + '：標題列與留言區用 tokens');
      assert(bg(n) !== strong, theme + '：新會員不是會員色卡片');
    }
    document.documentElement.removeAttribute('data-theme');
  });

  test('T5.5 跨日分隔線（24.7）：跨日、跨多日、跨年、時區；與 phase 標題同時出現時先 phase；段首與前一段日期不同也顯示；VOD 午夜前後順序顛倒不來回插入', () => {
    const at = (id, d, o) => ({ m: Object.assign({ id, timestampAbs: d.getTime() }, o || {}) });
    const kinds = (es) => es.map((e) => (e.kind === 'msg' ? e.it.m.id : e.kind === 'phase' ? '#' + e.phase : '|' + e.label));
    // 只有 live：沒有 phase 標題，但跨日仍插入（清單第一則前不加）
    let es = CORE.withPhaseDividers([at('a', new Date(2026, 10, 18, 23, 59, 50)), at('b', new Date(2026, 10, 19, 0, 0, 5)), at('c', new Date(2026, 10, 19, 12))]);
    eq(kinds(es), ['a', '|2026/11/19（四）', 'b', 'c'], '跨日');
    // 跨多日：只插入新日期一條（不補中間的日子）
    es = CORE.withPhaseDividers([at('a', new Date(2026, 10, 10, 9)), at('b', new Date(2026, 10, 14, 9)), at('c', new Date(2026, 10, 14, 10))]);
    eq(kinds(es), ['a', '|2026/11/14（六）', 'b', 'c'], '跨多日');
    // 跨年
    es = CORE.withPhaseDividers([at('a', new Date(2026, 11, 31, 23, 59)), at('b', new Date(2027, 0, 1, 0, 1))]);
    eq(kinds(es), ['a', '|2027/01/01（五）', 'b'], '跨年');
    // 時區：同一組時刻，UTC+8 跨日、UTC−5 不跨日
    const u = (h, mi) => ({ m: { id: 'u' + h + mi, timestampAbs: Date.UTC(2026, 10, 18, h, mi) } });
    const pair = [u(15, 50), u(16, 10)]; // UTC+8：23:50 → 00:10；UTC−5：10:50 → 11:10
    eq(kinds(CORE.withPhaseDividers(pair, { tzOffsetMin: 480 })), ['u1550', '|2026/11/19（四）', 'u1610'], 'UTC+8');
    eq(kinds(CORE.withPhaseDividers(pair, { tzOffsetMin: -300 })), ['u1550', 'u1610'], 'UTC−5');
    eq(CORE.dayLabel(Date.UTC(2026, 10, 18, 16, 10), 480), '2026/11/19（四）');
    // 各段：提示 → pre（待機室跨三天）→ live → post；phase 標題在前、日期在後；段首日期與前一段不同也顯示
    es = CORE.withPhaseDividers([
      at('n0', new Date(2026, 10, 20, 20), { notice: true }),
      at('p0', new Date(2026, 10, 17, 21), { phase: 'pre' }), at('p1', new Date(2026, 10, 19, 8), { phase: 'pre' }), at('p2', new Date(2026, 10, 20, 19), { phase: 'pre' }),
      at('l0', new Date(2026, 10, 20, 20), { phase: 'live' }), at('l1', new Date(2026, 10, 21, 0, 30), { phase: 'live' }),
      at('q0', new Date(2026, 10, 21, 1), { phase: 'post' }),
    ]);
    eq(kinds(es), ['#notice', 'n0', '#pre', '|2026/11/17（二）', 'p0', '|2026/11/19（四）', 'p1', '|2026/11/20（五）', 'p2', '#live', 'l0', '|2026/11/21（六）', 'l1', '#post', 'q0'],
      '各段皆適用；先 phase 再日期；post 段首與前一段最後一則同一天 → 不加');
    // VOD（依影片時間排序）：午夜前後到達時間有幾秒顛倒 → 只在往後跨日時插入一次
    es = CORE.withPhaseDividers([at('v0', new Date(2026, 10, 18, 23, 59, 58)), at('v1', new Date(2026, 10, 19, 0, 0, 1)), at('v2', new Date(2026, 10, 18, 23, 59, 59)), at('v3', new Date(2026, 10, 19, 0, 0, 3))]);
    eq(kinds(es), ['v0', '|2026/11/19（四）', 'v1', 'v2', 'v3'], '不來回插入');
    // 時間軸同步：分隔線不影響（連續兩條分隔線也取前一則訊息的時間）
    const clock = { live: true, currentTime: 0, at: 0 };
    const idx = CORE.syncIndex(es, clock, { target: new Date(2026, 10, 19, 0, 0, 2).getTime() });
    eq(es[idx].it.m.id, 'v2');
  });

  test('T5.5 跨日分隔線的繪製（24.7）：面板與後台都有；虛擬列表的列高納入分隔線（列不重疊、總高＝各列相加）', async () => {
    await resetDb();
    const VD = 'vidDAYSEP01';
    const msgs = [];
    const base = new Date(2026, 10, 15, 20).getTime();
    for (let i = 0; i < 120; i++) msgs.push(mk({ id: 'd' + i, videoId: VD, phase: 'pre', timestampAbs: base + i * 3 * 3600e3, videoOffsetSec: null }));
    await put({ videoId: VD, title: 'd', isLive: true, startedAt: null, scheduledStartAt: base + 400 * 3600e3, lastMessageAt: base + 360 * 3600e3, messageCount: 120, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    for (const embed of [false, true]) {
      const c = V.mount(host, { embed, videoId: VD });
      await c.ready; await frame(); await frame();
      const days = c.state.entries.filter((e) => e.kind === 'day');
      eq(days.length, 15, (embed ? '面板' : '後台') + '：11/15 20:00～11/30 17:00（16 個日期）→ 15 條');
      const check = async () => {
        await frame(); await frame();
        const rows = Array.from(c.els.list.querySelectorAll('.vrow')).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
        assert(rows.some((r) => r.querySelector('.day-sep')), '可視範圍內有跨日分隔線');
        for (let k = 1; k < rows.length; k++) {
          const prev = rows[k - 1], cur = rows[k];
          assert(Math.abs(parseFloat(prev.style.top) + prev.offsetHeight - parseFloat(cur.style.top)) < 1, '列不重疊、不留縫 ' + k);
        }
        const sep = rows.find((r) => r.querySelector('.day-sep'));
        assert(sep.querySelector('.day-sep').getAttribute('role') === 'separator' && /^\d{4}\/\d\d\/\d\d（[日一二三四五六]）$/.test(sep.textContent), sep.textContent);
      };
      await check();
      c.els.list.scrollTop = 0; c.els.list.dispatchEvent(new Event('scroll')); await check();
    }
  });

  test('T5.4 已結束場次（21.2、21.3）：依 phase 分段（提示 → pre → live → post）、每段標題一次；超出影片長度的時間碼面板與後台都不可點並說明；頁面狀態提示在最上方、不參與同步', async () => {
    await resetDb();
    const VE = 'vidENDED001';
    const msgs = [];
    // 已合併（live＋replay，影片時間＝到達時間 − 開播 − 8 秒）→ 校正值 −8；VOD 長度 1000 秒，比直播（1100 秒）短
    for (let i = 0; i < 10; i++) { const off = 100 + i * 80; msgs.push(mk({ id: 'mg' + i, videoId: VE, videoOffsetSec: off, offsets: { v1: off }, offsetSource: 'replay', sources: ['live', 'replay'], timestampAbs: T0 + (off + 8) * 1000 })); }
    msgs.push(mk({ id: 'late', videoId: VE, videoOffsetSec: 1090, offsets: { v1: 1090 }, offsetSource: 'estimated', sources: ['live'], timestampAbs: T0 + 1090e3 })); // 校正後 1082 > 1000
    for (let j = 0; j < 3; j++) msgs.push(mk({ id: 'po' + j, videoId: VE, phase: 'post', videoOffsetSec: 1101 + j * 2, offsets: { v1: 1101 + j * 2 }, sources: ['live'], timestampAbs: T0 + (1101 + j * 2) * 1000 }));
    msgs.push(mk({ id: 'pr0', videoId: VE, phase: 'pre', videoOffsetSec: null, timestampAbs: T0 - 3600e3 }));
    msgs.push(mk({ id: 'pr1', videoId: VE, phase: 'pre', videoOffsetSec: -30, timestampAbs: T0 - 30e3 }));
    msgs.push(mk({ id: 'ytcas-ve-replayon', videoId: VE, type: 'system', phase: 'live', videoOffsetSec: 5000, timestampAbs: T0 + 5000e3, runs: [{ text: '提示' }] })); // 之後打開 VOD 時擷取
    await put({ videoId: VE, title: 'E', isLive: false, startedAt: T0, endedAt: T0 + 1100e3, lastMessageAt: T0 + 5000e3, messageCount: msgs.length, versions: [{ id: 'v1', duration: 1000 }], linkedVideos: [] }, msgs);
    await DB.close();
    const order = (c) => c.state.entries.map((e) => (e.kind === 'phase' ? '#' + e.phase : e.it.m.id));
    const check = (c, label) => {
      const o = order(c);
      eq(o.filter((x) => x[0] === '#'), ['#notice', '#pre', '#live', '#post'], label + '：每段標題一次');
      eq(o.slice(0, 5), ['#notice', 'ytcas-ve-replayon', '#pre', 'pr0', 'pr1'], label);
      eq(o.slice(-4), ['#post', 'po0', 'po1', 'po2'], label + '：post 在最後、不與 live 穿插');
      eq(o[o.indexOf('#post') - 1], 'late', label);
    };
    const realOpen = window.open;
    window.open = () => null;
    try {
      // 面板（VOD）
      const c = V.mount(host, { embed: true, videoId: VE });
      await c.ready; await frame();
      c._onClock({ currentTime: 500, paused: false, duration: 1000, live: false, at: Date.now() });
      await frame(); await frame();
      check(c, '面板');
      eq(c.state.cal.delta, -8);
      c.state.vl.reveal(c.state.entries.findIndex((e) => e.kind === 'msg' && e.it.m.id === 'late'), false); await frame(); await frame();
      const t1 = c.els.list.querySelector('[data-id="late"] .tc');
      eq([t1.tagName, t1.textContent, t1.title], ['SPAN', '18:02', '超出影片長度（16:40）']);
      const syncIds = CORE.syncPoints(c.state.entries, { ver: 'v1', cal: c.state.cal }).map((p) => c.state.entries[p.i].it.m.id);
      assert(!syncIds.includes('ytcas-ve-replayon') && !syncIds.includes('po0') && !syncIds.includes('pr0'), '提示、pre、post 不參與同步');
      // 後台（獨立分頁）：同一規則
      const b = V.mount(host, { embed: false, videoId: VE });
      await b.ready; await frame(); await frame();
      check(b, '後台');
      b.state.vl.reveal(b.state.entries.findIndex((e) => e.kind === 'msg' && e.it.m.id === 'late'), false); await frame(); await frame();
      const t2 = b.els.list.querySelector('[data-id="late"] .tc');
      eq([t2.tagName, t2.textContent, t2.title], ['SPAN', '18:02', '超出影片長度（16:40）'], '後台也不可點（v44 可點）');
      b.state.vl.reveal(b.state.entries.findIndex((e) => e.kind === 'msg' && e.it.m.id === 'mg3'), false); await frame(); await frame();
      const t3 = b.els.list.querySelector('[data-id="mg3"] .tc');
      eq([t3.tagName, t3.textContent], ['BUTTON', '5:40'], '範圍內可點');
      // 日期：不是今天一律顯示月／日
      b.state.vl.reveal(1, false); await frame(); await frame();
      const pre = b.els.list.querySelector('[data-id="pr0"] .tc');
      assert(/\d+\/\d+ /.test(pre.textContent), 'pre 顯示月／日 ' + pre.textContent);
    } finally { window.open = realOpen; }
  });

  test('T5.4 面板頭像快取上限（20.3）：2,000 位作者（LRU）', async () => {
    await resetDb();
    const VA = 'vidAVCAP001';
    const msgs = [];
    for (let i = 0; i < 2100; i++) msgs.push(mk({ id: 'av' + i, videoId: VA, authorHandle: '@a' + i, authorAvatar: 'https://yt4.ggpht.com/a' + i + '=s64', timestampAbs: T0 + i * 1000 }));
    await put({ videoId: VA, title: 'a', versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VA });
    await c.ready; await frame();
    eq(c.state.avatars.size, self.YTCAS_CONST.PANEL.AVATAR_CACHE_MAX);
    assert(!c.state.avatars.has('@a0') && c.state.avatars.has('@a2099'), '最久沒用到的先移除');
  });

  test('T5.3 連結與超級貼圖的呈現（17.1、17.2）：<a target=_blank rel=noopener noreferrer>、title 為完整網址；非 http(s) 只顯示文字；貼圖沒圖時顯示 alt', async () => {
    await resetDb();
    const VLK = 'vidLINKS001';
    await put({ videoId: VLK, title: 'links', versions: [], linkedVideos: [] }, [
      mk({ id: 'k1', videoId: VLK, timestampAbs: T0 + 1000, runs: [{ text: '看 ' }, { text: 'https://madestudio.com.tw/zh/games/br...', link: { url: 'https://madestudio.com.tw/zh/games/brave-story' } }, { text: ' <img src=x onerror=alert(1)>' }] }),
      mk({ id: 'k2', videoId: VLK, timestampAbs: T0 + 2000, runs: [{ text: '壞連結', link: { url: 'javascript:alert(1)' } }] }), // 直接寫入（略過 db 的檢查）
      mk({ id: 'k3', videoId: VLK, timestampAbs: T0 + 3000, type: 'supersticker', amount: '$45.00', stickerSrc: '', stickerAlt: '揮手的熊', runs: [] }),
      mk({ id: 'k4', videoId: VLK, timestampAbs: T0 + 4000, type: 'supersticker', amount: '$5.00', stickerSrc: '', runs: [] }),
    ]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VLK });
    await c.ready; await frame(); await frame();
    const row = (id) => c.els.list.querySelector('[data-id="' + id + '"]');
    const a = row('k1').querySelector('a.lnk');
    assert(a, '連結');
    eq([a.getAttribute('href'), a.target, a.rel, a.title, a.textContent], ['https://madestudio.com.tw/zh/games/brave-story', '_blank', 'noopener noreferrer', 'https://madestudio.com.tw/zh/games/brave-story', 'https://madestudio.com.tw/zh/games/br...']);
    assert(!row('k1').querySelector('img[src="x"]') && row('k1').textContent.includes('<img src=x onerror=alert(1)>'), '文字不變成 HTML');
    assert(!row('k2').querySelector('.content a') && row('k2').textContent.includes('壞連結'), 'javascript: 只顯示文字（v47：頭像連結不算）');
    eq(row('k3').querySelector('.stk').textContent, '揮手的熊', '貼圖沒有圖 → alt');
    eq(row('k4').querySelector('.stk').textContent, '🏷', '都沒有 → 🏷');
    // db 寫入時也只保留 http／https（擷取、匯入、遷移都經過 normalizeIncoming）
    await DB.saveMessages({ videoId: VLK, source: 'live', messages: [{ id: 'k5', type: 'text', timestampAbs: T0 + 5000, runs: [{ text: 'a', link: { url: 'javascript:alert(1)' } }, { text: 'b', link: { url: 'https://ok.example/' } }] }] });
    const saved = (await DB.queryMessages(VLK)).find((m) => m.id === 'k5');
    eq(saved.runs, [{ text: 'a' }, { text: 'b', link: { url: 'https://ok.example/' } }]);
    await DB.close();
  });

  test('T5.3 F-20 P9 面板（審查十一 18.4）：記錄中且選了 P9 才送；只有數字（heap、DOM 節點、清單筆數、繪出列數）；依設定的間隔', async () => {
    await resetDb();
    const VP9 = 'vidP9PANEL1';
    const msgs = [];
    for (let i = 0; i < 500; i++) msgs.push(mk({ id: 'q' + i, videoId: VP9, timestampAbs: T0 + i * 1000, runs: [{ text: '不應出現 ' + i }] }));
    await put({ videoId: VP9, title: '不應出現的標題', versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const sent = [];
    const realSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (m) => { sent.push(JSON.parse(JSON.stringify(m))); return Promise.resolve({ ok: true }); };
    chrome.storage.local._reset();
    try {
      const c = V.mount(host, { embed: true, videoId: VP9 });
      await c.ready; await frame();
      c._p9Tick(true);
      eq(sent.filter((m) => m.type === 'DIAG_LOG').length, 0, '沒有記錄中：不送');
      await chrome.storage.local.set({ [self.YTCAS_CONST.DIAG.STATE_KEY]: { active: true, probes: ['P9'], p9Minutes: 1 } });
      await sleep(20);
      c._p9Tick(false);
      const logs = sent.filter((m) => m.type === 'DIAG_LOG');
      eq(logs.length, 1);
      const r = logs[0].records[0];
      eq([r.probe, r.kind, r.ctx.env, r.ctx.videoId], ['P9', 'memory', 'panel', VP9]);
      eq([r.data.items, r.data.entries], [500, 500]);
      assert(r.data.rendered > 0 && r.data.rendered < 200, '虛擬列表只繪出可見列 ' + r.data.rendered);
      assert(typeof r.data.domNodes === 'number' && r.data.domNodes > 0, 'DOM 節點');
      assert(Object.values(r.data).every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null || v === 'tail' || v === 'sync'), '只有數字');
      assert(!JSON.stringify(r).includes('不應出現'), '沒有內容與標題');
      c._p9Tick(false);
      eq(sent.filter((m) => m.type === 'DIAG_LOG').length, 1, '間隔未到不重送');
      await chrome.storage.local.set({ [self.YTCAS_CONST.DIAG.STATE_KEY]: { active: true, probes: ['P1'] } });
      await sleep(20);
      c._p9Tick(true);
      eq(sent.filter((m) => m.type === 'DIAG_LOG').length, 1, '沒選 P9：不送');
    } finally { chrome.runtime.sendMessage = realSend; chrome.storage.local._reset(); }
  });

  test('T5.2 (I)「在後台開啟此場次」：請 background 開分頁（OPEN_VIEWER），不自己開', async () => {
    await resetDb();
    await put({ videoId: VID, title: 't', versions: [], linkedVideos: [] }, [mk({ id: 'o1' })]);
    await DB.close();
    const sent = [];
    const realSend = chrome.runtime.sendMessage, realOpen = window.open;
    const opened = [];
    chrome.runtime.sendMessage = (m) => { sent.push(m); return Promise.resolve({ ok: true }); };
    window.open = (u) => { opened.push(u); return null; };
    try {
      const c = V.mount(host, { embed: true, videoId: VID });
      await c.ready; await frame();
      c.els.moreBtn.click();
      const item = Array.from(c.els.menu.querySelectorAll('button')).find((b) => b.textContent.includes('在後台開啟此場次'));
      item.click();
      await sleep(50);
      eq(sent.filter((m) => m.type === 'OPEN_VIEWER').map((m) => m.videoId), [VID]);
      eq(opened.length, 0, '沒有自己開新分頁');
    } finally { chrome.runtime.sendMessage = realSend; window.open = realOpen; }
  });

  test('T5 F-18：版本切換（依影片長度自動選、剪輯版中不存在的訊息淡色標示）；連結影片以時間差同步並可微調', async () => {
    await resetDb();
    const VO = 'vidVERSION1', VN = 'vidLINKED01';
    const msgs = [];
    for (let i = 0; i < 50; i++) {
      const o = { v1: i * 60 };
      if (i < 20 || i >= 30) o.v2 = i < 20 ? i * 60 : i * 60 - 600; // 剪輯版剪掉 20～29
      msgs.push(mk({ id: 'v' + i, videoId: VO, timestampAbs: T0 + i * 60e3, videoOffsetSec: i * 60, offsets: o }));
    }
    await put({ videoId: VO, title: '版本測試', isLive: true, startedAt: T0, endedAt: T0 + 3000e3, lastMessageAt: T0 + 2940e3, messageCount: 50,
      versions: [{ id: 'v1', duration: 3000, label: '原始' }, { id: 'v2', duration: 2400, label: '剪輯版 1' }],
      linkedVideos: [{ videoId: VN, label: '重新上傳', offsetShift: -120 }] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VO });
    await c.ready; await frame();
    assert(!c.els.verPick.hidden && c.els.verPick.options.length === 2, '版本選單');
    c._onClock({ currentTime: 1900, paused: false, duration: 2400.6, live: false, at: Date.now() });
    await frame(); await frame();
    eq(c.state.ver, 'v2', '依長度選剪輯版');
    eq(c.state.currentId, 'v41', '剪輯版時間 1900 → 第 41 則（v2 = 41×60−600 = 1860）');
    c.els.verPick.value = 'v1'; c.els.verPick.dispatchEvent(new Event('change'));
    c.els.verPick.value = 'v2'; c.els.verPick.dispatchEvent(new Event('change'));
    await frame();
    c.state.vl.reveal(25, false); c.state.syncPaused = true; await frame(); await frame();
    const cutRow = c.els.list.querySelector('[data-id="v25"]');
    assert(cutRow && cutRow.classList.contains('cut') && cutRow.textContent.includes('剪輯版中不存在'), '被剪掉的段落');
    // 連結影片：載入原始場次，時間差 −120 秒
    const d = V.mount(host, { embed: true, videoId: VN });
    await d.ready; await frame();
    assert(!d.els.linkBox.hidden && d.els.linkText.textContent.includes('−120'), '時間差 ' + d.els.linkText.textContent);
    d._onClock({ currentTime: 600, paused: false, duration: 2880, live: false, at: Date.now() });
    await frame();
    eq(d.state.currentId, 'v12', '600 + 120 = 720 → 第 12 則');
    d.els.linkBox.querySelectorAll('button')[3].click(); // +10
    eq(d.state.link.shift, -110);
    d._onClock({ currentTime: 600, paused: false, duration: 2880, live: false, at: Date.now() + 300 });
    eq(d.state.currentId, 'v11', '時間差改為 −110 → 710 → 第 11 則');
  });

  // ================================================================ T5.1（審查十一 13.1 (B)、13.3）
  test('T5.1 計數：以別名送來的同一則不重複計數；重新載入期間收到的推播不遺失；標頭＝「全部」＝清單筆數；⋯ 選單顯示連線狀態', async () => {
    await resetDb();
    const VC = 'vidCOUNT001';
    const msgs = [];
    for (let i = 0; i < 20; i++) msgs.push(mk({ id: 'c' + i, videoId: VC, timestampAbs: T0 + i * 1000, videoOffsetSec: i, aliasIds: i === 5 ? ['old-id-5'] : [] }));
    await put({ videoId: VC, title: '計數', isLive: true, startedAt: T0, lastMessageAt: T0 + 19000, messageCount: 20, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VC });
    await c.ready; await frame();
    const meta = () => c.els.meta.textContent;
    const all = () => c.els.pills.all.querySelector('.num').textContent;
    // 以舊 id（別名）送來的同一則：更新，不新增
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: VC, messages: [mk({ id: 'old-id-5', videoId: VC, timestampAbs: T0 + 5000, videoOffsetSec: 5, deleted: true })] });
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: VC, messages: [mk({ id: 'c7', videoId: VC, aliasIds: ['dup-7'], timestampAbs: T0 + 7000, videoOffsetSec: 7 })] });
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: VC, messages: [mk({ id: 'dup-7', videoId: VC, timestampAbs: T0 + 7000, videoOffsetSec: 7 })] });
    await sleep(400); await frame();
    eq(c.state.items.length, 20, '別名不重複計數');
    assert(meta().includes('20 則') && all() === '20', '標頭 ' + meta() + '／全部 ' + all());
    // 重新載入期間收到的推播：資料庫快照沒有它 → 載入完成後補上（v41 以前遺失）
    const p = c.load(VC);
    eq(c.state.loading, true, '重新載入時 loading 為 true');
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: VC, messages: [mk({ id: 'late1', videoId: VC, timestampAbs: T0 + 30000, videoOffsetSec: 30 })] });
    await p; await sleep(400); await frame();
    assert(c.state.byId.has('late1'), '載入中收到的推播已補上');
    eq(c.state.items.length, 21);
    assert(meta().includes('21 則') && all() === '21', '標頭 ' + meta() + '／全部 ' + all());
    eq(c.state.diag.pushBuffered, 1);
    c.els.moreBtn.click();
    const dl = c.els.menu.querySelector('.diag-line').textContent;
    assert(dl.includes('推播 4') && dl.includes('暫存 1') && dl.includes('載入 2 次'), '連線狀態：' + dl);
    document.body.click();
  });

  test('T6.1 自己送出的訊息（30.5）：清單裡暫時 id 與正式 id 各一筆 → 收到合併後的紀錄（正式 id＋暫時 id 別名、時間取到達時間）只剩一筆，位置依時間', async () => {
    await resetDb();
    const VO = 'vidOWNDUP01';
    const msgs = [];
    for (let i = 0; i < 5; i++) msgs.push(mk({ id: 'o' + i, videoId: VO, timestampAbs: T0 + i * 10000, videoOffsetSec: i * 10 }));
    msgs.push(mk({ id: 'LCC.temp', videoId: VO, authorHandle: '@me', runs: [{ text: '早安' }], timestampAbs: T0 + 21000, videoOffsetSec: 21 }));
    msgs.push(mk({ id: 'ChwKreal', videoId: VO, authorHandle: '@me', runs: [{ text: '早安' }], timestampAbs: T0 + 39000, videoOffsetSec: 39 }));
    await put({ videoId: VO, title: '重複', isLive: true, startedAt: T0, lastMessageAt: T0 + 40000, messageCount: 7, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VO });
    await c.ready; await frame();
    eq(c.state.items.length, 7);
    c._onRuntime({ type: 'NEW_MESSAGES', videoId: VO, messages: [mk({ id: 'ChwKreal', videoId: VO, authorHandle: '@me', runs: [{ text: '早安' }], aliasIds: ['LCC.temp'], timestampAbs: T0 + 21000, videoOffsetSec: 21 })] });
    await sleep(400); await frame();
    eq(c.state.items.length, 6, '只剩一筆');
    eq(c.state.items.map((x) => x.m.id), ['o0', 'o1', 'o2', 'ChwKreal', 'o3', 'o4'], '依時間排在 o2 之後');
    eq([c.state.byId.get('ChwKreal'), c.state.byId.get('LCC.temp')], [3, 3], '兩個 id 都指到同一筆');
    assert(c.els.pills.all.querySelector('.num').textContent === '6', '「全部」筆數');
  });

  test('T5.1 推播的後備：直播中超過 15 秒沒有推播 → 讀資料庫的新訊息（offset 索引，只讀新的部分）', async () => {
    await resetDb();
    const VP = 'vidPOLL0001';
    const msgs = [];
    for (let i = 0; i < 30; i++) msgs.push(mk({ id: 'p' + i, videoId: VP, timestampAbs: T0 + i * 1000, videoOffsetSec: 100 + i }));
    await put({ videoId: VP, title: '補讀', isLive: true, startedAt: T0, lastMessageAt: T0 + 29000, messageCount: 30, versions: [], linkedVideos: [] }, msgs);
    await DB.close();
    const c = V.mount(host, { embed: true, videoId: VP });
    await c.ready; await frame();
    // background 寫入了 3 則，但面板沒收到推播
    await put({ videoId: VP, title: '補讀', isLive: true, startedAt: T0, lastMessageAt: T0 + 32000, messageCount: 33, versions: [], linkedVideos: [] },
      [0, 1, 2].map((k) => mk({ id: 'q' + k, videoId: VP, timestampAbs: T0 + 30000 + k * 1000, videoOffsetSec: 130 + k })));
    await DB.close();
    await until(() => c.state.items.length === 33, 8000, '補讀 ' + c.state.items.length);
    assert(c.state.diag.polls >= 1 && c.state.diag.pollAdded === 3, JSON.stringify(c.state.diag));
    await until(() => c.els.meta.textContent.includes('33 則'), 2000, '標頭更新'); // 重繪合併 300ms
  });

  test('T5.1 頭像後備（審查十一第 10 節）：訊息沒有頭像時用同場次同作者的頭像，其次頻道資料，最後才是首字圓點', async () => {
    await resetDb();
    const VA = 'vidAVATAR01';
    const A = 'https://yt4.ggpht.com/aa=s64', CH = 'https://yt3.ggpht.com/ch=s88';
    await put({ videoId: VA, title: '頭像', isLive: false, startedAt: T0, endedAt: T0 + 60e3, messageCount: 4, versions: [], linkedVideos: [] }, [
      mk({ id: 'h1', videoId: VA, authorHandle: '@aa', authorAvatar: '', timestampAbs: T0 + 1000 }),
      mk({ id: 'h2', videoId: VA, authorHandle: '@aa', authorAvatar: A, timestampAbs: T0 + 2000 }),
      mk({ id: 'h3', videoId: VA, authorHandle: '@cc', authorAvatar: '', timestampAbs: T0 + 3000 }),
      mk({ id: 'h4', videoId: VA, authorHandle: '@none', authorAvatar: '', timestampAbs: T0 + 4000 }),
    ], [], [{ handleOrId: '@cc', displayName: 'CC 頻道', avatar: CH, fetchedAt: T0 }]);
    await DB.close();
    const c = V.mount(host, { embed: false, videoId: VA });
    await c.ready; await frame();
    // 本頁 CSP 阻止外部圖片 → <img> 會觸發 error 改成首字圓點（正常行為），所以直接檢查後備順序的結果
    const m = (id) => c.state.items.find((x) => x.m.id === id).m;
    eq(c._avatarUrl(m('h1')), A, '同作者的頭像');
    eq(c._avatarUrl(m('h2')), A, '自己的頭像');
    eq(c._avatarUrl(m('h3')), CH, '頻道資料的頭像');
    eq(c._avatarUrl(m('h4')), '', '都沒有 → 首字圓點');
    eq(c.els.list.querySelector('[data-id="h4"] .av').tagName, 'SPAN');
  });

  test('T5.1 膠囊列（審查十一 13.1 (E)）：300／340／360px 寬「全部」兩字與數字都保留、單列放得下', async () => {
    for (const w of [360, 340, 300]) {
      const box = document.createElement('div');
      box.style.cssText = 'width:' + w + 'px;height:200px;flex:none';
      document.body.appendChild(box);
      try {
        const c = V.mount(box, { embed: true, videoId: 'nothing' });
        await c.ready;
        c.els.pills.all.querySelector('.num').textContent = '8,780';
        c.els.pills.sc.querySelector('.num').textContent = '123';
        await frame();
        const lbl = c.els.pills.all.querySelector('.lbl-all');
        assert(getComputedStyle(lbl).display !== 'none' && lbl.textContent.includes('全部'), w + 'px：「全部」被隱藏');
        const row = c.els.pills.all.parentElement;
        assert(row.scrollWidth <= row.clientWidth + 1, w + 'px：膠囊列放不下 ' + row.scrollWidth + '/' + row.clientWidth);
      } finally { box.remove(); }
    }
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
