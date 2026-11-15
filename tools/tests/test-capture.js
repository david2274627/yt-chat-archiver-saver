// T3 擷取引擎測試（src/capture.js）。結果顯示在頁面並存於 window.__results。
// 模擬 DOM 依 docs/youtube-dom-notes.md 2.1／2.4／3 建構；標「待實機確認」的部分（刪除屬性、徽章 type）只驗證程式邏輯。
(function () {
  'use strict';
  const CAP = self.YTCAS_CAPTURE;
  const C = self.YTCAS_CONST;
  const RT = C.RT;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error((msg || 'not equal') + '：實際 ' + x + '，預期 ' + y);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => sleep(0);
  const stage = document.getElementById('stage');

  // ---------------------------------------------------------------- 模擬聊天室（筆記 2.1）
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
    }
    for (const k of kids || []) el.append(k);
    return el;
  }
  function buildChat() {
    stage.textContent = '';
    const items = h('div', { id: 'items' });
    const banner = h('yt-live-chat-banner-manager', { id: 'live-chat-banner' });
    const app = h('yt-live-chat-renderer', { 'hide-timestamps': '', 'has-ticker': '' }, [
      h('div', { id: 'chat-messages' }, [h('div', { id: 'contents' }, [
        h('yt-live-chat-header-renderer'),
        h('div', { id: 'chat' }, [h('div', { id: 'item-list' }, [h('yt-live-chat-item-list-renderer', { id: 'live-chat-item-list-panel' }, [
          h('div', { id: 'contents' }, [h('div', { id: 'item-scroller' }, [h('div', { id: 'item-offset' }, [items])])]),
        ])])]),
        banner,
        h('tp-yt-iron-pages', { id: 'panel-pages' }, [h('div', { id: 'input-panel' })]),
      ])]),
    ]);
    stage.append(app);
    return { items, banner };
  }
  let seq = 0;
  // yt-live-chat-text-message-renderer（筆記 2.4）
  function textMsg(o) {
    o = o || {};
    seq++;
    const msg = h('span', { id: 'message' });
    for (const r of o.runs || [{ text: '測試訊息 ' + seq }]) {
      if (r.emoji) msg.append(h('img', { id: 'emoji-' + seq, alt: r.emoji.alt, src: r.emoji.src }));
      else msg.append(document.createTextNode(r.text));
    }
    const badges = h('span', { id: 'chat-badges' }, (o.badges || []).map((b) => h('yt-live-chat-author-badge-renderer', { type: b }, [h('div', { id: 'image' })])));
    return h('yt-live-chat-text-message-renderer', Object.assign({ id: o.id || ('ChwKGk' + seq), modern: '' }, o.authorType ? { 'author-type': o.authorType } : {}), [
      h('yt-img-shadow', { id: 'author-photo' }, [h('img', { id: 'img', src: o.avatar || 'https://yt4.ggpht.com/a/test=s64' })]),
      h('div', { id: 'content' }, [
        h('span', { id: 'timestamp', text: o.ts || '' }),
        h('yt-live-chat-author-chip', {}, [h('span', { id: 'author-name' }, [document.createTextNode(o.author || '@tester' + (seq % 7)), h('span', { id: 'chip-badges' })]), badges]),
        h('span', { id: 'message-container' }, [msg]),
        h('span', { id: 'deleted-state' }),
      ]),
    ]);
  }
  // yt-live-chat-membership-item-renderer（筆記 3）
  function memberMsg() {
    seq++;
    return h('yt-live-chat-membership-item-renderer', { id: 'mem' + seq, modern: '', 'has-primary-header-text': '' }, [
      h('div', { id: 'card' }, [h('div', { id: 'header' }, [
        h('yt-img-shadow', { id: 'author-photo' }, [h('img', { id: 'img', src: 'https://yt4.ggpht.com/m=s64' })]),
        h('div', { id: 'header-content' }, [h('span', { id: 'author-name', text: '@member1' }), h('span', { id: 'chat-badges' }),
          h('div', { id: 'header-primary-text', text: '會員 12 個月' }), h('div', { id: 'header-subtext', text: '歡迎加入' }), h('div', { id: 'timestamp', text: '1:23' })]),
      ]), h('div', { id: 'content' }, [h('div', { id: 'message', text: '謝謝' })])]),
    ]);
  }
  // yt-live-chat-paid-sticker-renderer（筆記 2.4）
  function stickerMsg() {
    seq++;
    return h('yt-live-chat-paid-sticker-renderer', { id: 'stk' + seq, 'is-v2-style': '' }, [
      h('div', { id: 'card' }, [h('div', { id: 'author-info' }, [
        h('yt-img-shadow', { id: 'author-photo' }, [h('img', { id: 'img', src: 'https://yt4.ggpht.com/s=s64' })]),
        h('span', { id: 'timestamp', text: '' }), h('span', { id: 'author-name', text: '@fan' }),
      ]), h('div', { id: 'price-column' }, [h('yt-formatted-string', { id: 'purchase-amount-chip', text: 'NT$30.00' })]),
      h('div', { id: 'sticker-container' }, [h('yt-img-shadow', { id: 'sticker' }, [h('img', { id: 'img', src: 'https://lh3.googleusercontent.com/st=s96' })])])]),
    ]);
  }

  // 假送出：記錄每則訊息；回應可由 handler 自訂
  function mockSend(handler) {
    const calls = [];
    const fn = async (msg) => {
      const c = { msg: JSON.parse(JSON.stringify(msg)), at: performance.now(), done: null };
      calls.push(c);
      const r = await (handler ? handler(msg, calls) : defaultReply(msg));
      c.done = performance.now();
      return r;
    };
    fn.calls = calls;
    fn.of = (type) => calls.filter((c) => c.msg.type === type);
    return fn;
  }
  let sid = 0;
  function defaultReply(msg) {
    if (msg.type === RT.CAPTURE_START) return { ok: true, allowed: true, captureSessionId: ++sid, versionId: 'v1', stream: null };
    if (msg.type === RT.SAVE_MESSAGES) return { ok: true, added: msg.messages.length, merged: 0, unchanged: 0, fpMerged: 0 };
    if (msg.type === RT.MESSAGE_DELETED) return { ok: true, found: true };
    return { ok: true };
  }
  const savedIds = (send) => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages.map((m) => m.id));
  const NOW = new Date(2026, 10, 15, 22, 23, 41, 0).getTime();
  const engines = [];
  function engine(o) {
    const e = CAP.createEngine(Object.assign({ doc: document, source: 'live', now: () => NOW }, o));
    engines.push(e);
    return e;
  }
  async function until(fn, ms, msg) {
    const t0 = performance.now();
    while (!fn()) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(10); }
  }

  // ---------------------------------------------------------------- 純函式
  test('parseClock：上午／下午、AM／PM、24 小時制；即時訊息秒級、回溯訊息落在該分鐘最後；跨日；失敗回 null', () => {
    const base = new Date(2026, 10, 15, 22, 23, 41, 0).getTime();
    eq(CAP.parseClock('下午10:23', base), base, '即時訊息 = 擷取時間');
    eq(CAP.parseClock('10:23 PM', base), base);
    eq(CAP.parseClock('22:23', base), base);
    eq(CAP.parseClock('下午10:20', base), new Date(2026, 10, 15, 22, 20, 59, 999).getTime(), '回溯：該分鐘最後一刻');
    eq(CAP.parseClock('上午12:05', new Date(2026, 10, 15, 0, 5, 10).getTime()), new Date(2026, 10, 15, 0, 5, 10).getTime(), '上午 12 點 = 0 點');
    const mid = new Date(2026, 10, 16, 0, 0, 30).getTime();
    eq(CAP.parseClock('下午11:59', mid), new Date(2026, 10, 15, 23, 59, 59, 999).getTime(), '比擷取時間晚超過 12 小時 → 前一天');
    eq(CAP.parseClock('abc', base), null);
    eq(CAP.parseClock('下午13:00', base), null, '12 小時制超過 12');
  });

  test('parseOffset：m:ss、h:mm:ss、負值、無效', () => {
    eq(CAP.parseOffset('1:23'), 83);
    eq(CAP.parseOffset('1:02:03'), 3723);
    eq(CAP.parseOffset('-0:05'), -5);
    eq(CAP.parseOffset(''), null);
    eq(CAP.parseOffset('下午10:23'), null);
  });

  // ---------------------------------------------------------------- 解析
  test('parseMessage：一般訊息欄位（id、@handle、author-type、徽章、表符、頭像、直播時間與 offset）', () => {
    buildChat();
    const el = textMsg({ id: 'ChwKGkTEST', ts: '下午10:23', author: '@alice', authorType: 'member', badges: ['verified'],
      runs: [{ text: '哈囉 ' }, { emoji: { alt: ':wave:', src: 'https://yt3.ggpht.com/e=w24' } }, { text: '!' }] });
    const startedAt = NOW - 3600 * 1000;
    const m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt, endedAt: null });
    eq(m.id, 'ChwKGkTEST');
    eq(m.type, 'text');
    eq(m.authorHandle, '@alice');
    eq(m.authorUrl, 'https://www.youtube.com/@alice');
    eq(m.authorBadges, ['member', 'verified']);
    eq(m.runs, [{ text: '哈囉 ' }, { emoji: { src: 'https://yt3.ggpht.com/e=w24', alt: ':wave:', shortcut: '' } }, { text: '!' }]);
    eq(m.authorAvatar, 'https://yt4.ggpht.com/a/test=s64');
    eq(m.timestampAbs, NOW);
    eq(m.videoOffsetSec, 3600);
    eq(m.phase, 'live');
    assert(!m.deleted && !('authorName' in m));
  });

  test('parseMessage：待機室（預定時間未到 → pre、offset null）、開播前訊息（負 offset）、結束後（post）', () => {
    const el = textMsg({ ts: '下午10:23' });
    let m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null, endedAt: null, scheduledStartAt: NOW + 600000 });
    eq([m.phase, m.videoOffsetSec], ['pre', null]);
    m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: NOW + 30000, endedAt: null });
    eq([m.phase, m.videoOffsetSec], ['pre', -30]);
    m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: NOW - 7200000, endedAt: NOW - 60000 });
    eq(m.phase, 'post');
  });

  test('parseMessage：重播時間（#timestamp → offset，timestampAbs 由 startedAt 推算）', () => {
    const el = textMsg({ ts: '1:02:03' });
    const m = CAP.parseMessage(el, { source: 'replay', now: NOW, startedAt: 1_700_000_000_000 });
    eq(m.videoOffsetSec, 3723);
    eq(m.timestampAbs, 1_700_000_000_000 + 3723000);
    eq(m.phase, 'live');
  });

  test('parseMessage：會員訊息（標題與副標放在 runs 開頭）、超級貼圖（金額、貼圖）', () => {
    let m = CAP.parseMessage(memberMsg(), { source: 'replay', now: NOW, startedAt: null });
    eq(m.type, 'membership');
    eq(m.runs, [{ text: '會員 12 個月 歡迎加入' }, { text: '\n' }, { text: '謝謝' }]);
    eq(m.videoOffsetSec, 83);
    m = CAP.parseMessage(stickerMsg(), { source: 'live', now: NOW, startedAt: null });
    eq(m.type, 'supersticker');
    eq(m.amount, 'NT$30.00');
    eq(m.stickerSrc, 'https://lh3.googleusercontent.com/st=s96');
    eq(m.authorHandle, '@fan');
  });

  test('parseMessage：未知元件存為 system（含 rawTag，console.info 一次）；佔位元素與跑馬燈項目不擷取', () => {
    const el = h('yt-live-chat-something-new-renderer', { id: 'x1' }, [h('span', { id: 'message', text: '新東西' })]);
    const m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null });
    eq([m.type, m.rawTag], ['system', 'yt-live-chat-something-new-renderer']);
    eq(m.runs, [{ text: '新東西' }]);
    eq(CAP.parseMessage(h('yt-live-chat-placeholder-item-renderer'), { source: 'live', now: NOW }), null);
    eq(CAP.parseMessage(h('yt-live-chat-ticker-sponsor-item-renderer'), { source: 'live', now: NOW }), null);
  });

  test('T3.5 parseMessage：歡迎／守則提示（viewer-engagement）以場次＋內容產生固定 id（元素 id 每次不同也一樣）', () => {
    const mk = (id) => h('yt-live-chat-viewer-engagement-message-renderer', { id }, [h('div', { id: 'card' }, [h('yt-icon', { id: 'icon' }),
      h('div', { id: 'message-container' }, [h('yt-formatted-string', { id: 'message', text: '歡迎來到聊天室！' })])])]);
    const a = CAP.parseMessage(mk('ChwRandom1'), { source: 'live', now: NOW, videoId: 'testVidVE01', startedAt: null });
    const b = CAP.parseMessage(mk('ChwRandom2'), { source: 'live', now: NOW + 9999, videoId: 'testVidVE01', startedAt: null });
    const c = CAP.parseMessage(mk('ChwRandom3'), { source: 'live', now: NOW, videoId: 'testVidVE02', startedAt: null });
    eq(a.id, C.viewerEngagementId('testVidVE01', [{ text: '歡迎來到聊天室！' }]));
    eq(a.id, b.id, '同場同內容 → 同 id');
    assert(a.id !== c.id, '不同場次 → 不同 id');
    eq([a.type, a.rawTag], ['system', 'yt-live-chat-viewer-engagement-message-renderer']);
  });

  // ---------------------------------------------------------------- 引擎
  test('回溯擷取：開始收錄時 #items 既有 60 則全部送出；DOM 修剪到 ≤ 45；第一批滿 50 則立即送出', async () => {
    const { items } = buildChat();
    for (let i = 0; i < 60; i++) items.append(textMsg({ ts: '下午10:2' + (i % 4) }));
    const send = mockSend();
    const e = engine({ send });
    e.start();
    assert(items.children.length === 60, '等待場次資訊時不得修剪未擷取的訊息');
    e.setInfo({ videoId: 'testVid0001', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => savedIds(send).length === 60, 3000, '60 則送出');
    eq(send.of(RT.SAVE_MESSAGES)[0].msg.messages.length, 50, '第一批 50 則（筆數觸發）');
    assert(send.of(RT.SAVE_MESSAGES)[0].at - send.of(RT.CAPTURE_START)[0].done < 500, '筆數觸發，不等 1 秒計時器');
    assert(items.children.length <= 45, 'DOM 節點 ' + items.children.length);
    eq(new Set(savedIds(send)).size, 60, '不重複');
    const cs = send.of(RT.CAPTURE_START)[0].msg;
    eq([cs.videoId, cs.source, cs.stream.channelHandle, cs.stream.startedAt], ['testVid0001', 'live', '@ch', NOW - 60000]);
    e.stop();
  });

  test('MutationObserver：持續新增 200 則，每次變動後 DOM ≤ 45；未滿 50 則時 1 秒保底送出', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0002' });
    await until(() => e.state().mode === 'capturing');
    let maxNodes = 0;
    for (let i = 0; i < 200; i++) {
      items.append(textMsg({ ts: '下午10:23' }));
      if (i % 10 === 9) { await tick(); maxNodes = Math.max(maxNodes, items.children.length); }
    }
    await tick();
    assert(maxNodes <= 45 + 10, '變動回呼後節點數 ' + maxNodes);
    assert(items.children.length <= 45, '最後 DOM 節點 ' + items.children.length);
    await until(() => savedIds(send).length === 200, 3000, '200 則送出');
    items.append(textMsg({ ts: '下午10:23' }));
    await sleep(300);
    eq(savedIds(send).length, 200, '1 則時不立即送');
    await until(() => savedIds(send).length === 201, 2000, '1 秒保底送出');
    eq(e.state().stats.trimmed >= 150, true);
    e.stop();
  });

  test('重試（3.2）：連續失敗 2 次後成功 → 訊息送達，不重複', async () => {
    const { items } = buildChat();
    let fails = 2;
    const send = mockSend(async (msg) => {
      if (msg.type === RT.SAVE_MESSAGES && fails > 0) { fails--; throw new Error('Could not establish connection'); }
      return defaultReply(msg);
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0003' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 50; i++) items.append(textMsg({}));
    await until(() => e.state().stats.added === 50, 4000, '重試後送達');
    eq(send.of(RT.SAVE_MESSAGES).length, 3, '1 次 + 2 次重試');
    e.stop();
  });

  test('重試用盡：留在佇列，下一批一起送（不遺失、不重複）', async () => {
    const { items } = buildChat();
    let down = true;
    const send = mockSend(async (msg) => {
      if (msg.type === RT.SAVE_MESSAGES && down) throw new Error('SW restarting');
      return defaultReply(msg);
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0004' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 50; i++) items.append(textMsg({}));
    await until(() => send.of(RT.SAVE_MESSAGES).length === 4, 5000, '4 次嘗試');
    await sleep(50);
    eq(e.state().queue, 50, '失敗的 50 則留在佇列');
    down = false;
    for (let i = 0; i < 10; i++) items.append(textMsg({}));
    await until(() => e.state().stats.added === 60, 3000, '一起送出');
    const ok = send.of(RT.SAVE_MESSAGES).slice(4).flatMap((c) => c.msg.messages.map((m) => m.id));
    eq(ok.length, 60);
    eq(new Set(ok).size, 60);
    e.stop();
  });

  test('F-15 暫停：CAPTURE_START 不允許 → 不送訊息，DOM 照常修剪；恢復後重新開始並回溯擷取', async () => {
    const { items } = buildChat();
    let allowed = false;
    const send = mockSend(async (msg) => {
      if (msg.type === RT.CAPTURE_START) return allowed ? defaultReply(msg) : { ok: true, allowed: false, reason: 'channel' };
      return defaultReply(msg);
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0005' });
    await until(() => e.state().mode === 'paused');
    for (let i = 0; i < 80; i++) items.append(textMsg({}));
    await tick();
    assert(items.children.length <= 45, '暫停中仍修剪：' + items.children.length);
    eq(send.of(RT.SAVE_MESSAGES).length, 0);
    allowed = true;
    e.recheckPolicy();
    await until(() => savedIds(send).length === items.children.length && items.children.length > 0, 3000, '恢復後回溯擷取現有節點');
    eq(send.of(RT.CAPTURE_START).length, 2);
    e.stop();
  });

  test('F-15 暫停：收錄中 SAVE_MESSAGES 回 paused → 停止擷取並清空佇列，DOM 照常修剪', async () => {
    const { items } = buildChat();
    const send = mockSend(async (msg) => (msg.type === RT.SAVE_MESSAGES ? { ok: false, error: 'paused', reason: 'global' } : defaultReply(msg)));
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0006' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 50; i++) items.append(textMsg({}));
    await until(() => e.state().mode === 'paused', 2000, '轉為暫停');
    for (let i = 0; i < 60; i++) items.append(textMsg({}));
    await tick();
    assert(items.children.length <= 45);
    eq(send.of(RT.SAVE_MESSAGES).length, 1, '暫停後不再送');
    eq(e.state().queue, 0);
    e.stop();
  });

  test('刪除通知先後順序（3.2 v29）：所在批次寫入完成後才送 MESSAGE_DELETED；found:false 時下一批後重送一次', async () => {
    const { items } = buildChat();
    let found = false;
    const send = mockSend(async (msg) => {
      if (msg.type === RT.SAVE_MESSAGES) { await sleep(200); return defaultReply(msg); }
      if (msg.type === RT.MESSAGE_DELETED) { const f = found; found = true; return { ok: true, found: f }; }
      return defaultReply(msg);
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0007' });
    await until(() => e.state().mode === 'capturing');
    const target = textMsg({ id: 'DEL1' });
    items.append(target);
    await tick();
    target.setAttribute('is-deleted', ''); // 刪除屬性名稱待實機確認；此處驗證順序邏輯
    await until(() => send.of(RT.MESSAGE_DELETED).length === 1, 3000, '送出刪除通知');
    const save = send.of(RT.SAVE_MESSAGES).find((c) => c.msg.messages.some((m) => m.id === 'DEL1'));
    const del = send.of(RT.MESSAGE_DELETED)[0];
    assert(save && save.done != null && del.at >= save.done, '刪除通知在寫入完成之後');
    eq(del.msg.id, 'DEL1');
    items.append(textMsg({}));
    await until(() => send.of(RT.MESSAGE_DELETED).length === 2, 3000, 'found:false → 下一批後重送');
    await sleep(50);
    eq(e.state().stats.deleted, 1);
    e.stop();
  });

  test('擷取時已是刪除狀態：直接以 deleted:true 存入，不另送通知', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0008' });
    await until(() => e.state().mode === 'capturing');
    const el = textMsg({ id: 'DEL2' });
    el.setAttribute('is-deleted', '');
    items.append(el);
    await until(() => savedIds(send).includes('DEL2'), 2000);
    const m = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).find((x) => x.id === 'DEL2');
    eq([m.deleted, m.deletedAt], [true, NOW]);
    await sleep(100);
    eq(send.of(RT.MESSAGE_DELETED).length, 0);
    e.stop();
  });

  test('擴充功能重新載入（失去連線）：停止送出，DOM 照常修剪', async () => {
    const { items } = buildChat();
    let alive = true;
    const send = mockSend();
    const e = engine({ send, isConnected: () => alive });
    e.start();
    e.setInfo({ videoId: 'testVid0009' });
    await until(() => e.state().mode === 'capturing');
    alive = false;
    for (let i = 0; i < 70; i++) items.append(textMsg({}));
    await until(() => e.state().mode === 'disconnected', 2000);
    for (let i = 0; i < 30; i++) items.append(textMsg({}));
    await tick();
    assert(items.children.length <= 45, '失去連線後仍修剪：' + items.children.length);
    eq(send.of(RT.SAVE_MESSAGES).length, 0);
    e.stop();
  });

  test('置頂訊息：置頂列內的訊息送 SAVE_PINNED 一次（重新渲染不重送）', async () => {
    const { banner } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVid0010' });
    await until(() => e.state().mode === 'capturing');
    const mk = () => h('yt-live-chat-banner-renderer', {}, [h('div', { id: 'contents' }, [textMsg({ id: 'PIN1', author: '@owner', authorType: 'owner' })])]);
    banner.append(mk());
    await until(() => send.of(RT.SAVE_PINNED).length === 1, 2000);
    banner.textContent = '';
    banner.append(mk());
    await sleep(100);
    eq(send.of(RT.SAVE_PINNED).length, 1);
    const p = send.of(RT.SAVE_PINNED)[0].msg.message;
    eq([p.id, p.authorHandle, p.authorBadges], ['PIN1', '@owner', ['owner']]);
    e.stop();
  });

  test('videoId 改變：結束舊 session、開始新 session；observer 不累加', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const before = CAP.observers();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidAAAA' });
    await until(() => e.state().mode === 'capturing');
    const n1 = CAP.observers();
    e.setInfo({ videoId: 'testVidBBBB' });
    await until(() => e.state().mode === 'capturing' && e.state().videoId === 'testVidBBBB');
    eq(send.of(RT.CAPTURE_END).length, 1);
    eq(send.of(RT.CAPTURE_START).map((c) => c.msg.videoId), ['testVidAAAA', 'testVidBBBB']);
    items.append(textMsg({}));
    await until(() => send.of(RT.SAVE_MESSAGES).length === 1, 2000);
    eq(send.of(RT.SAVE_MESSAGES)[0].msg.videoId, 'testVidBBBB');
    eq(CAP.observers(), n1, 'observer 數不變');
    e.stop();
    eq(CAP.observers(), before, 'stop 後全部解除');
  });

  test('F-18 重播：沒有影片長度時等待，收到長度後才 CAPTURE_START（帶 duration）', async () => {
    buildChat();
    const send = mockSend();
    const e = engine({ send, source: 'replay' });
    e.start();
    e.setInfo({ videoId: 'testVid0011' });
    await sleep(200);
    eq(send.of(RT.CAPTURE_START).length, 0, '等待長度');
    e.setInfo({ videoId: 'testVid0011', duration: 7265 });
    await until(() => send.of(RT.CAPTURE_START).length === 1, 1000);
    eq([send.of(RT.CAPTURE_START)[0].msg.source, send.of(RT.CAPTURE_START)[0].msg.duration], ['replay', 7265]);
    e.stop();
  });

  test('結束：stop() 送出剩餘訊息並送 CAPTURE_END（含 source）', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send, source: 'popout' });
    e.start();
    e.setInfo({ videoId: 'testVid0012' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 5; i++) items.append(textMsg({}));
    await tick();
    e.stop();
    await until(() => savedIds(send).length === 5, 1000);
    const end = send.of(RT.CAPTURE_END)[0].msg;
    eq([end.captureSessionId != null, end.source], [true, 'popout']);
  });

  // ---------------------------------------------------------------- F-12（v30：開始收錄時）
  // 選單結構依筆記 2.3：#view-selector > yt-sort-filter-sub-menu-renderer#live-chat-view-selector-sub-menu > yt-dropdown-menu
  //   > tp-yt-paper-menu-button#menu-button（#trigger；tp-yt-iron-dropdown#dropdown > #contentWrapper > tp-yt-paper-listbox#menu > a, a）
  // YouTube 的點擊行為（是否需先展開）待實機確認：requireOpen 模擬「需先展開」，broken 模擬「點了也沒切」
  function addViewMenu(o) {
    const header = stage.querySelector('yt-live-chat-header-renderer');
    const a1 = h('a', { 'aria-selected': o.mode === 'live' ? 'false' : 'true' });
    const a2 = h('a', { 'aria-selected': o.mode === 'live' ? 'true' : 'false' });
    const trigger = h('div', { id: 'trigger' });
    let open = false;
    const clicks = [];
    trigger.addEventListener('click', () => { clicks.push('trigger'); open = true; });
    const pick = (a, b) => () => {
      clicks.push(a === a1 ? 'a1' : 'a2');
      if (o.broken || (o.requireOpen && !open)) return;
      a.setAttribute('aria-selected', 'true'); b.setAttribute('aria-selected', 'false'); open = false;
    };
    a1.addEventListener('click', pick(a1, a2));
    a2.addEventListener('click', pick(a2, a1));
    header.append(h('div', { id: 'primary-content' }, [h('div', { id: 'view-selector' }, [
      h('yt-sort-filter-sub-menu-renderer', { id: 'live-chat-view-selector-sub-menu' }, [h('yt-dropdown-menu', {}, [
        h('tp-yt-paper-menu-button', { id: 'menu-button' }, [trigger,
          h('tp-yt-iron-dropdown', { id: 'dropdown' }, [h('div', { id: 'contentWrapper' }, [h('tp-yt-paper-listbox', { id: 'menu' }, [a1, a2])])])]),
      ])]),
    ])]));
    return { a1, a2, clicks };
  }
  async function f12Run(menu, allowed) {
    buildChat();
    const m = menu ? addViewMenu(menu) : null;
    const send = mockSend(async (msg) => (msg.type === RT.CAPTURE_START && allowed === false ? { ok: true, allowed: false, reason: 'global' } : defaultReply(msg)));
    let result = null;
    const e = engine({ send, onF12: (r) => { result = r; } });
    e.start();
    e.setInfo({ videoId: 'testVidF12x' });
    return { e, m, get result() { return result; } };
  }

  test('F-12：開始收錄時從「重點」切到「即時」（直接點擊即可）', async () => {
    const r = await f12Run({ mode: 'top' });
    await until(() => r.result, 3000, 'F-12 結果');
    eq(r.result, { f12: 'switched', viewMode: 'live' });
    eq(r.m.clicks, ['a2']);
    eq(r.e.state().f12, 'switched');
  });

  test('F-12：直接點沒有切換 → 展開選單再點', async () => {
    const r = await f12Run({ mode: 'top', requireOpen: true });
    await until(() => r.result, 3000, 'F-12 結果');
    eq(r.result, { f12: 'switched', viewMode: 'live' });
    eq(r.m.clicks, ['a2', 'trigger', 'a2']);
  });

  test('F-12：已是「即時」→ 不做任何操作；切換失敗 → failed 且不重試', async () => {
    let r = await f12Run({ mode: 'live' });
    await until(() => r.result, 3000);
    eq([r.result.f12, r.m.clicks.length], ['already', 0]);
    r.e.stop();
    r = await f12Run({ mode: 'top', broken: true });
    await until(() => r.result, 3000);
    eq(r.result, { f12: 'failed:not-selected', viewMode: 'top' });
    await sleep(700);
    eq(r.m.clicks, ['a2', 'trigger', 'a2'], '不重試迴圈');
  });

  test('F-12：F-15 暫停中不切換；沒有選單 → failed:no-menu（不報錯）', async () => {
    let r = await f12Run({ mode: 'top' }, false);
    await until(() => r.e.state().mode === 'paused');
    await sleep(800);
    eq([r.m.clicks.length, r.result, r.e.state().f12], [0, null, null]);
    r.e.stop();
    r = await f12Run(null);
    await until(() => r.result, 7000, '等選單逾時');
    eq(r.result, { f12: 'failed:no-menu', viewMode: 'unknown' });
  });

  // ---------------------------------------------------------------- T3.3 修剪卡住（審查十追加）
  const unmarked = (box) => Array.from(box.children).filter((el) => !el.dataset.ytcasSaved).length;

  test('T3.3(a)：開始前已有 76 個未擷取節點、等待期間又加入 20 個 → 收錄後全數擷取、DOM ≤ 45、未標記 ≤ 5；新訊息留在畫面上', async () => {
    const { items } = buildChat();
    for (let i = 0; i < 76; i++) items.append(textMsg({ id: 'OLD' + i }));
    const send = mockSend(async (msg) => { if (msg.type === RT.CAPTURE_START) await sleep(150); return defaultReply(msg); });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidT33a' });
    for (let i = 0; i < 20; i++) items.append(textMsg({ id: 'PEND' + i }));
    await tick();
    eq(items.children.length, 96, '等待期間未達硬上限：不修剪');
    await until(() => e.state().mode === 'capturing');
    await until(() => new Set(savedIds(send)).size === 96, 3000, '96 則全數送出');
    assert(items.children.length <= 45, 'DOM ' + items.children.length);
    assert(unmarked(items) <= 5, '未標記 ' + unmarked(items));
    const fresh = textMsg({ id: 'NEW1' });
    items.append(fresh);
    await tick();
    assert(fresh.isConnected, '新訊息不可一出現就被移除');
    assert(items.children.length <= 45);
    e.stop();
  });

  test('T3.3：等待期間超過硬上限 200 → 先解析排入佇列再移除最舊的；收錄開始後全數送出', async () => {
    const { items } = buildChat();
    let release;
    const gate = new Promise((r) => { release = r; });
    const send = mockSend(async (msg) => { if (msg.type === RT.CAPTURE_START) await gate; return defaultReply(msg); });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidT33p' });
    for (let i = 0; i < 250; i++) items.append(textMsg({ id: 'P' + i }));
    await tick();
    eq(items.children.length, 200, '硬上限');
    eq(send.of(RT.SAVE_MESSAGES).length, 0, '收錄開始前不送');
    release();
    await until(() => new Set(savedIds(send)).size === 250, 3000, '250 則全數送出');
    assert(items.children.length <= 45);
    e.stop();
  });

  test('T3.3：收錄中 YouTube 把 #items 整個換掉（新列表帶 76 個既有節點）→ 定時檢查重新掛上並回溯，DOM ≤ 45', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidT33r' });
    await until(() => e.state().mode === 'capturing');
    const fresh = h('div', { id: 'items' });
    for (let i = 0; i < 76; i++) fresh.append(textMsg({ id: 'R' + i }));
    items.replaceWith(fresh);
    e._tick(); // 等同 3.5 秒保底計時器觸發
    await until(() => new Set(savedIds(send)).size === 76, 3000, '新列表 76 則全數送出');
    assert(fresh.children.length <= 45, 'DOM ' + fresh.children.length);
    eq(unmarked(fresh), 0);
    eq(e.state().stats.backfillRuns >= 2, true, '開始時＋重新掛上');
    const n = textMsg({ id: 'R-NEW' });
    fresh.append(n);
    await until(() => savedIds(send).includes('R-NEW'), 2000);
    assert(n.isConnected, '新訊息留在畫面上');
    e.stop();
  });

  test('T3.3(b)：F-12 切換後列表整批重建（換新 #items、含已擷取過的 id）→ 全數擷取、DOM ≤ 45；同 id 計入 dupCaptured', async () => {
    buildChat();
    const items0 = stage.querySelector('#items');
    for (let i = 0; i < 30; i++) items0.append(textMsg({ id: 'TOP' + i }));
    const m = addViewMenu({ mode: 'top' });
    // 模擬 YouTube：切到「即時」時以新的列表元素重新渲染 60 則（含先前 30 則同 id）
    m.a2.addEventListener('click', () => {
      setTimeout(() => {
        const box = h('div', { id: 'items' });
        for (let i = 0; i < 30; i++) box.append(textMsg({ id: 'TOP' + i }));
        for (let i = 0; i < 30; i++) box.append(textMsg({ id: 'LIVE' + i }));
        stage.querySelector('#items').replaceWith(box);
      }, 50);
    });
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidT33b' });
    await until(() => e.state().f12 === 'switched', 3000, 'F-12 切換');
    await until(() => new Set(savedIds(send)).size === 60, 3000, '重建後 60 個 id 全數擷取');
    const box = stage.querySelector('#items');
    assert(box.children.length <= 45, 'DOM ' + box.children.length);
    eq(unmarked(box), 0);
    eq(e.state().stats.dupCaptured, 30, '同 id 重新插入只計數');
    e.stop();
  });

  // ---------------------------------------------------------------- T3.4 只處理 #items 的直接子節點
  test('T3.4：訊息內部後代延遲渲染（徽章、圖示、按鈕、span、dom-if）→ 不產生新紀錄、observedAdded 不增加、不輸出未知元件', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidT34a' });
    await until(() => e.state().mode === 'capturing');
    const el = textMsg({ id: 'T34MSG' });
    items.append(el);
    await until(() => savedIds(send).includes('T34MSG'), 2000);
    const added0 = e.state().stats.observedAdded;
    const infos = [];
    const orig = console.info;
    console.info = (...a) => { infos.push(String(a[0])); orig.apply(console, a); };
    try {
      // 實測 Console 出現過的子元件標籤（審查十追加二 A）
      el.querySelector('#chat-badges').append(h('yt-live-chat-author-badge-renderer', { type: 'moderator' }, [h('yt-icon')]));
      el.querySelector('#message').append(h('span', { text: ' 追加' }), h('yt-img-shadow', {}, [h('yt-image')]));
      el.append(h('yt-button-view-model', {}, [h('button-view-model')]), h('dom-if'), h('div'));
      await sleep(1300); // 超過 1 秒批次保底
      e._tick();
      await sleep(50);
    } finally { console.info = orig; }
    eq(savedIds(send), ['T34MSG'], '沒有新紀錄');
    eq(e.state().stats.observedAdded, added0, 'observedAdded 不增加');
    eq(e.state().stats.captured, 1);
    eq(infos.filter((s) => s.includes('未知訊息元件')).length, 0, '不輸出未知元件');
    e.stop();
  });

  // ---------------------------------------------------------------- T3.5 F-2 直播結束
  test('T3.5 F-2：收錄中收到含 endDate 的場次資訊 → 之後的訊息標 post，SAVE_MESSAGES 帶 endedAt', async () => {
    const { items } = buildChat();
    const send = mockSend();
    let t = NOW;
    const e = engine({ send, now: () => t });
    e.start();
    const startDate = NOW - 3600e3;
    e.setInfo({ videoId: 'testVidEND1', startDate, isLiveBroadcast: true });
    await until(() => e.state().mode === 'capturing');
    items.append(textMsg({ id: 'E1', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('E1'), 2000);
    const endDate = NOW + 30000;
    e.setInfo({ videoId: 'testVidEND1', startDate, endDate, isLiveBroadcast: true }); // top frame 每 30 秒重送
    t = NOW + 60000; // 結束 30 秒後的訊息
    items.append(textMsg({ id: 'E2', ts: '下午10:24' }));
    await until(() => savedIds(send).includes('E2'), 2000);
    const all = send.of(RT.SAVE_MESSAGES);
    const m1 = all.flatMap((c) => c.msg.messages).find((m) => m.id === 'E1');
    const last = all[all.length - 1].msg;
    const m2 = last.messages.find((m) => m.id === 'E2');
    eq([m1.phase, m2.phase], ['live', 'post']);
    eq([last.stream.startedAt, last.stream.endedAt], [startDate, endDate]);
    eq(e.state().stream.endedAt, endDate);
    e.stop();
  });

  // ---------------------------------------------------------------- 執行
  async function run() {
    const out = [];
    const list = document.getElementById('list');
    for (const t of tests) {
      const li = document.createElement('li');
      let ok = true, err = '';
      try { await t.fn(); } catch (e) { ok = false; err = String(e && e.message || e); console.error(t.name, e); }
      for (const e of engines.splice(0)) { try { e.stop(); } catch (_) { /* */ } }
      li.className = ok ? 'ok' : 'ng';
      li.textContent = (ok ? '✅ ' : '❌ ') + t.name + (err ? '：' + err : '');
      list.appendChild(li);
      out.push({ name: t.name, ok, err });
    }
    const pass = out.filter((r) => r.ok).length;
    document.getElementById('summary').textContent = `${pass}／${out.length} 通過`;
    document.getElementById('summary').className = pass === out.length ? 'ok' : 'ng';
    window.__results = { pass, total: out.length, results: out };
  }
  run();
})();
