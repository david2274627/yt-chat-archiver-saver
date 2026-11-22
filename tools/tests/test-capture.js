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

  test('T3.6 parseMessage：禮物 yt-gift-message-view-model → type gift（通用解析：作者、頭像、文字、禮物圖片；保存 rawTag）；不輸出未知元件', () => {
    // 內部結構未實機確認：只用通用欄位（#author-name、#author-photo img、其他 img、可見文字）
    const el = h('yt-gift-message-view-model', { id: 'GIFT1' }, [
      h('yt-img-shadow', { id: 'author-photo' }, [h('img', { id: 'img', src: 'https://yt4.ggpht.com/g=s64' })]),
      h('span', { id: 'author-name', text: '@giver' }),
      h('span', { text: '送出了 玫瑰 x3' }),
      h('img', { src: 'https://www.gstatic.com/youtube/img/gifts/rose.png' }),
    ]);
    const infos = [];
    const orig = console.info;
    console.info = (...a) => { infos.push(String(a[0])); };
    let m;
    try { m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null }); } finally { console.info = orig; }
    eq([m.id, m.type, m.rawTag, m.authorHandle, m.authorAvatar, m.giftImage],
      ['GIFT1', 'gift', 'yt-gift-message-view-model', '@giver', 'https://yt4.ggpht.com/g=s64', 'https://www.gstatic.com/youtube/img/gifts/rose.png']);
    assert(C.MSG_TYPE.GIFT === 'gift');
    assert(m.runs.length === 1 && m.runs[0].text.includes('玫瑰'), '保存可見文字');
    eq(infos.filter((s) => s.includes('未知訊息元件')).length, 0);
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

  // ---------------------------------------------------------------- T3.6 開播判斷（審查十追加五 E、E-3）
  test('T3.6：預定時間已過但尚未確認開播（startPending）→ 訊息 pre、offset 空，不以預定時間寫入；background 確認後之後的訊息以實際時間計算', async () => {
    const { items } = buildChat();
    const sch = new Date(2026, 10, 16, 19, 15, 0).getTime();
    const act = new Date(2026, 10, 16, 19, 24, 38).getTime();
    let t = new Date(2026, 10, 16, 19, 20, 10).getTime();
    let confirm = false;
    const send = mockSend(async (msg) => {
      if (msg.type === RT.SAVE_MESSAGES) {
        const r = defaultReply(msg);
        r.stream = confirm ? { startedAt: act, startedAtSource: 'meta-actual', scheduledStartAt: sch, startPending: false }
          : { startedAt: null, scheduledStartAt: sch, startPending: true };
        return r;
      }
      return defaultReply(msg);
    });
    const e = engine({ send, now: () => t });
    e.start();
    // 待機室時看到的 startDate（預定時間），之後一直沒有更新（頁面沒有重新整理）
    e.setInfo({ videoId: 'testVidDLY1', startDate: sch, isLiveBroadcast: true });
    await until(() => e.state().mode === 'capturing');
    eq([e.state().stream.startedAt ?? null, e.state().stream.startPending], [null, true]);
    items.append(textMsg({ id: 'D1', ts: '下午7:20' }));
    await until(() => savedIds(send).includes('D1'), 2000);
    const d1 = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).find((m) => m.id === 'D1');
    eq([d1.phase, d1.videoOffsetSec], ['pre', null]);
    eq(send.of(RT.SAVE_MESSAGES)[0].msg.stream.startedAt, undefined, '不送出以預定時間為準的 startedAt');
    confirm = true; // background 重新抓取 meta 確認實際開播
    items.append(textMsg({ id: 'D2', ts: '下午7:25' }));
    t = new Date(2026, 10, 16, 19, 25, 20).getTime();
    await until(() => savedIds(send).includes('D2'), 2000);
    eq([e.state().stream.startedAt, e.state().stream.startedAtSource], [act, 'meta-actual'], '採用回應中的確認時間');
    t = new Date(2026, 10, 16, 19, 30, 38).getTime();
    items.append(textMsg({ id: 'D3', ts: '下午7:30' }));
    await until(() => savedIds(send).includes('D3'), 2000);
    const d3 = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).find((m) => m.id === 'D3');
    eq([d3.phase, d3.videoOffsetSec], ['live', 360]);
    e.stop();
  });

  test('T3.6：頁面載入後才開播 → startDate 有秒數即為實際（meta-actual）；播放器訊號只在等待確認時採用，可被 meta-actual 覆蓋', async () => {
    buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    const act = NOW - 3600e3 + 7000; // 有秒數
    e.setInfo({ videoId: 'testVidDLY2', startDate: act, isLiveBroadcast: true, liveSignalAt: NOW });
    await until(() => e.state().mode === 'capturing');
    eq([e.state().stream.startedAt, e.state().stream.startedAtSource], [act, 'meta-actual'], '不是等待確認 → 不採用播放器訊號');
    e.stop();
    const e2 = engine({ send });
    e2.start();
    const sch = Math.floor((NOW - 600e3) / 60000) * 60000;
    e2.setInfo({ videoId: 'testVidDLY3', startDate: sch, isLiveBroadcast: true });
    eq(e2.state().stream.startPending, true);
    e2.setInfo({ videoId: 'testVidDLY3', startDate: sch, liveSignalAt: NOW - 20000 });
    eq([e2.state().stream.startedAt, e2.state().stream.startedAtSource, e2.state().stream.startPending], [NOW - 20000, 'signal', false]);
    e2.setInfo({ videoId: 'testVidDLY3', startDate: sch + 37000 }); // 重新整理後的實際時間
    eq([e2.state().stream.startedAt, e2.state().stream.startedAtSource], [sch + 37000, 'meta-actual'], 'meta-actual 覆蓋 signal');
    e2.stop();
  });

  // ---------------------------------------------------------------- F-20 診斷探針（T3.7）
  test('T5.6 待機室（26.1）：預定開播時間在未來 → background 回傳的錯誤 startedAt、播放器訊號都不採用；已採用的清除；降落事件 phase pre、offset null', async () => {
    const { items } = buildChat();
    const future = Math.ceil((NOW + 25 * 3600e3) / 60000) * 60000; // 「25 小時後開始直播」
    const wrong = NOW - 3941e3; // 錯誤的開播時間（圖4：時間碼 1:05:41）
    const send = mockSend(async (msg) => {
      const r = defaultReply(msg);
      if (msg.type === RT.CAPTURE_START || msg.type === RT.SAVE_MESSAGES) r.stream = { startedAt: wrong, startedAtSource: 'signal', scheduledStartAt: NOW - 600e3, startPending: false };
      return r;
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidWAIT1', startDate: future, isLiveBroadcast: true, liveSignalAt: NOW - 1000 });
    await until(() => e.state().mode === 'capturing');
    const s = e.state().stream;
    eq([s.startedAt ?? null, s.scheduledStartAt, s.scheduledFuture, s.startPending], [null, future, true, false], '不採用 background 回傳的 startedAt、預定時間以 meta 為準');
    items.append(textMsg({ id: 'W1', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('W1'), 2000);
    const w1 = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).find((m) => m.id === 'W1');
    eq([w1.phase, w1.videoOffsetSec], ['pre', null]);
    const last = send.of(RT.SAVE_MESSAGES).pop().msg.stream;
    eq([last.startedAt, last.scheduledFuture, last.scheduledStartAt], [undefined, true, future], 'SAVE_MESSAGES 帶 scheduledFuture');
    e.stop();
    // 已採用（頁面曾說已開播）之後，重新整理看到預定時間在未來（延期）→ 清除
    const e2 = engine({ send: mockSend() });
    e2.start();
    e2.setInfo({ videoId: 'testVidWAIT2', startDate: NOW - 3600e3 + 7000, isLiveBroadcast: true });
    await until(() => e2.state().mode === 'capturing');
    eq(e2.state().stream.startedAtSource, 'meta-actual');
    e2.setInfo({ videoId: 'testVidWAIT2', startDate: future, isLiveBroadcast: true });
    eq([e2.state().stream.startedAt, e2.state().stream.scheduledFuture], [null, true], '延期 → 清除開播時間');
    e2.stop();
    // 降落事件：與其他訊息同一規則（v46 一律 live）
    const raid = document.createElement('div');
    raid.textContent = '@raider 和他們的觀眾剛剛加入';
    let r = CAP.parseRaid(raid, { source: 'live', now: NOW, startedAt: null, endedAt: null, scheduledStartAt: future }, 'testVidWAIT1');
    eq([r.phase, r.videoOffsetSec], ['pre', null], '待機室的降落：pre');
    r = CAP.parseRaid(raid, { source: 'live', now: NOW, startedAt: null, endedAt: null, scheduledStartAt: NOW - 60e3, startPending: true }, 'testVidWAIT1');
    eq(r.phase, 'pre', '等待開播確認：pre');
    r = CAP.parseRaid(raid, { source: 'live', now: NOW, startedAt: NOW - 60e3, endedAt: null }, 'testVidWAIT1');
    eq([r.phase, r.videoOffsetSec], ['live', 60]);
  });

  test('T5.6 SC 文字色（26.4）：保存 YouTube 給各 SC 的文字色變數（標題列、名稱、時間、內文；只接受色碼）；超級貼圖只取名稱色；P7 列出元件上的變數名稱（不含值）', async () => {
    const sc = (style) => {
      const el = h('yt-live-chat-paid-message-renderer', { id: 'sc' + (++seq), style }, [
        h('div', { id: 'card' }, [h('div', { id: 'header' }, [
          h('yt-img-shadow', { id: 'author-photo' }, [h('img', { id: 'img', src: 'https://yt4.ggpht.com/s=s64' })]),
          h('span', { id: 'author-name', text: '@payer' }), h('div', { id: 'purchase-amount', text: '$15.00' }), h('span', { id: 'timestamp', text: '' })]),
        h('div', { id: 'content' }, [h('div', { id: 'message', text: '加油' })])]),
      ]);
      document.body.appendChild(el);
      return el;
    };
    const el = sc('--yt-live-chat-paid-message-primary-color: rgba(30,136,229,1); --yt-live-chat-paid-message-header-color: #FFFFFF; '
      + '--yt-live-chat-paid-message-author-name-color: rgba(255, 255, 255, 0.7); --yt-live-chat-paid-message-timestamp-color: #ffffff80; '
      + '--yt-live-chat-paid-message-color: #ffffff; --yt-live-chat-paid-message-secondary-color: rgba(21,101,192,1)');
    let m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq(m.type, 'superchat');
    eq(m.textColors, { header: '#ffffff', author: 'rgba(255,255,255,0.7)', timestamp: '#ffffff80', body: '#ffffff' });
    el.remove();
    const bad = sc('--yt-live-chat-paid-message-primary-color: #1e88e5; --yt-live-chat-paid-message-header-color: url(javascript:alert(1)); --yt-live-chat-paid-message-color: expression(1)');
    m = CAP.parseMessage(bad, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    assert(!('textColors' in m), '不是色碼 → 不存 ' + JSON.stringify(m.textColors));
    bad.remove();
    const stk = stickerMsg();
    stk.setAttribute('style', '--yt-live-chat-paid-sticker-background-color: #00e5ff; --yt-live-chat-paid-sticker-chip-text-color: #000000; --yt-live-chat-paid-sticker-author-name-text-color: rgba(0,0,0,0.54)');
    document.body.appendChild(stk);
    m = CAP.parseMessage(stk, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq(m.textColors, { author: 'rgba(0,0,0,0.54)' }, '貼圖：只取名稱色');
    stk.remove();
    // P7：變數名稱（不含值）
    const { items } = buildChat();
    const recs = [];
    const e = engine({ send: mockSend(), onDiag: (p, k, d) => recs.push({ p, k, d }) });
    e.start();
    e.setInfo({ videoId: 'testVidSCCOL', startDate: NOW - 3600e3 + 7000, isLiveBroadcast: true });
    await until(() => e.state().mode === 'capturing');
    const live = sc('--yt-live-chat-paid-message-primary-color: #1e88e5; --yt-live-chat-paid-message-header-color: #ffffff');
    items.appendChild(live);
    await until(() => recs.some((r) => r.k === 'sc-color-vars'), 2000, 'P7 sc-color-vars');
    const r = recs.find((x) => x.k === 'sc-color-vars');
    eq([r.p, r.d.type, r.d.inlineVars, r.d.got, r.d.hasBg], ['P7', 'superchat', ['--yt-live-chat-paid-message-primary-color', '--yt-live-chat-paid-message-header-color'], ['header'], true]);
    assert(!JSON.stringify(r).includes('#ffffff') && !JSON.stringify(r).includes('加油') && !JSON.stringify(r).includes('@payer'), '不含值與文字');
    e.stop();
  });

  test('T5.7 handle（28.2、27 第 2 點）：作者網址的路徑段編碼（@又新-david、@无恋）；@提及連結文字是短 handle → youtube.com/@handle', () => {
    let m = CAP.parseMessage(textMsg({ author: '@又新-david' }), { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq([m.authorHandle, m.authorUrl], ['@又新-david', 'https://www.youtube.com/@' + encodeURIComponent('又新-david')]);
    m = CAP.parseMessage(textMsg({ author: '@无恋' }), { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq(m.authorUrl, 'https://www.youtube.com/@%E6%97%A0%E6%81%8B');
    const el = textMsg({ runs: [{ text: '' }] });
    const msg = el.querySelector('#message');
    const a = document.createElement('a'); a.setAttribute('href', '/channel/UCxxxxxxxxxxxxxxxxxxxxxx'); a.textContent = '@魚';
    msg.append(a, document.createTextNode(' 你好'));
    m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq(m.runs[0], { text: '@魚', link: { url: 'https://www.youtube.com/@%E9%AD%9A' } });
    // 禮物送禮者（#author-name-v2）是短 handle
    m = CAP.parseMessage(realGift('ChwKgiftSH1', { author: '@魚' }), { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq([m.authorHandle, m.authorUrl, m.authorSource], ['@魚', 'https://www.youtube.com/@%E9%AD%9A', 'dom'], '禮物短 handle');
  });

  test('T5.7 待機室→開播（27 第 1 點）：分頁沒重新整理（top 每 30 秒送的舊 meta 仍說「在未來」）＋background 回傳 liveConfirmedAt → 採用開播時間、之後的訊息 live；舊 meta 不再清除', async () => {
    const { items } = buildChat();
    const sch = Math.ceil((NOW + 20 * 60e3) / 60000) * 60000;
    const act = NOW - 5 * 60e3 + 17000;
    let confirmed = false;
    const send = mockSend(async (msg) => {
      const r = defaultReply(msg);
      if (msg.type === RT.SAVE_MESSAGES && confirmed) r.stream = { startedAt: act, startedAtSource: 'meta-actual', scheduledStartAt: sch, scheduledFuture: false, liveConfirmedAt: NOW - 1000, startPending: false };
      return r;
    });
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidEARLY', startDate: sch, isLiveBroadcast: true });
    await until(() => e.state().mode === 'capturing');
    items.append(textMsg({ id: 'EA1', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('EA1'), 2000);
    confirmed = true; // background 重新抓取確認提早開播
    items.append(textMsg({ id: 'EA2', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('EA2'), 2000);
    eq([e.state().stream.startedAt, e.state().stream.scheduledFuture], [act, false], '採用 background 確認的開播時間');
    e.setInfo({ videoId: 'testVidEARLY', startDate: sch, isLiveBroadcast: true }); // top 每 30 秒重送（舊 meta）
    eq(e.state().stream.startedAt, act, '舊 meta 不再清除');
    items.append(textMsg({ id: 'EA3', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('EA3'), 2000);
    const all = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages);
    const f = (id) => all.find((x) => x.id === id);
    eq([f('EA1').phase, f('EA3').phase, f('EA3').videoOffsetSec != null], ['pre', 'live', true]);
    e.stop();
  });

  test('F-20 P7（AC 2）：注入未知元件與禮物元件 → 自動留下結構紀錄（只有標籤、id、屬性名稱、img 網域，沒有文字）；同一標籤每場最多 3 次', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const recs = [];
    const e = engine({ send, onDiag: (p, k, d) => recs.push({ p, k, d }) });
    e.start();
    e.setInfo({ videoId: 'testVidDG01' });
    await until(() => e.state().mode === 'capturing');
    const unk = () => h('yt-live-chat-mystery-renderer', { id: 'U' + (++seq), 'some-flag': '' }, [
      h('div', { id: 'card' }, [h('span', { id: 'message', text: '神秘的聊天內容' }), h('img', { src: 'https://www.gstatic.com/x/y.png' })])]);
    for (let i = 0; i < 5; i++) items.append(unk());
    items.append(h('yt-gift-message-view-model', { id: 'GF1' }, [h('span', { text: '送出玫瑰' })]));
    await tick();
    const p7 = recs.filter((r) => r.p === 'P7');
    eq(p7.map((r) => [r.d.reason, r.d.tag]), [['unknown', 'yt-live-chat-mystery-renderer'], ['unknown', 'yt-live-chat-mystery-renderer'],
      ['unknown', 'yt-live-chat-mystery-renderer'], ['gift', 'yt-gift-message-view-model']], '同一標籤最多 3 次');
    const s = p7[0].d;
    eq([s.attrs, s.hasId, s.tree.map((n) => n.tag)], [['some-flag'], true, ['div#card', 'span#message', 'img']]);
    eq([s.tree[1].hasText, s.tree[2].img], [true, 'www.gstatic.com']);
    assert(!JSON.stringify(p7).includes('神秘') && !JSON.stringify(p7).includes('玫瑰'), '不含文字');
    e.stop();
  });

  test('T5.4 禮物（20.4）：作者取不到 → 內文開頭 @handle 當送禮者（authorSource text）；@handle 連結一律指向 youtube.com/@handle；結構非記錄期間也送（不含文字，每個引擎最多 5 筆）', async () => {
    // 作者元件不存在（實機圖5：作者顯示「（未知）」）
    const g1 = h('yt-gift-message-view-model', { id: 'GFT1' }, [h('div', { id: 'message' }, [h('a', { href: '#', text: '@jaro0965' }), h('span', { text: ' 贈送X_X' })])]);
    const m1 = CAP.parseMessage(g1, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq([m1.authorHandle, m1.authorUrl, m1.authorSource], ['@jaro0965', 'https://www.youtube.com/@jaro0965', 'text']);
    eq(m1.runs[0], { text: '@jaro0965', link: { url: 'https://www.youtube.com/@jaro0965' } }, '@handle 連結（href 是 #）→ 頻道網址');
    const g2 = h('yt-gift-message-view-model', { id: 'GFT2' }, [h('span', { text: '@ididibibiKaik 贈送花束' })]);
    eq(CAP.parseMessage(g2, { source: 'live', now: NOW, startedAt: NOW - 60e3 }).authorHandle, '@ididibibiKaik', '純文字的 @handle');
    const g3 = h('yt-gift-message-view-model', { id: 'GFT3' }, [h('span', { text: '有人贈送花束' })]);
    const m3 = CAP.parseMessage(g3, { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq([m3.authorHandle, m3.authorSource], ['', undefined], '沒有 @handle 不猜');
    const g4 = h('yt-gift-message-view-model', { id: 'GFT4' }, [h('div', { id: 'author-name', text: '@realGiver' }), h('span', { text: '@other 贈送' })]);
    eq([CAP.parseMessage(g4, { source: 'live', now: NOW }).authorHandle, CAP.parseMessage(g4, { source: 'live', now: NOW }).authorSource], ['@realGiver', undefined], '取得到作者時不用後備');
    eq([C.handleOf('@a.b-c_1 x'), C.handleOf('a@b'), C.handleOf('@ab'), C.handleOf('@使用者名稱 送出')], ['@a.b-c_1', '', '', '@使用者名稱']);
    // 引擎：禮物結構不論是否記錄中都送；不含文字
    const { items } = buildChat();
    const send = mockSend();
    const gs = [];
    const e = engine({ send, onGiftStructure: (d) => gs.push(d) });
    e.start();
    e.setInfo({ videoId: 'testVidGS01' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 7; i++) items.append(h('yt-gift-message-view-model', { id: 'GS' + i }, [h('a', { href: '/@giverX', text: '@giverX' }), h('span', { text: ' 贈送祕密禮物' }), h('img', { src: 'https://www.gstatic.com/g.png' })]));
    await tick();
    eq(gs.length, 5, '每個引擎最多 5 筆');
    eq([gs[0].tag, gs[0].authorSource, gs[0].hasGiftImage], ['yt-gift-message-view-model', 'text', true]);
    eq([gs[0].tree[0].tag, gs[0].tree[0].at, gs[0].tree[0].href, gs[0].tree[2].img], ['a', true, 'handle', 'www.gstatic.com']);
    assert(!JSON.stringify(gs).includes('giverX') && !JSON.stringify(gs).includes('祕密'), '不含文字與 handle');
    e.stop();
  });

  // v46（T5.5，審查十一 24.3）實機禮物結構（2026-11-21，2 筆相同；dom-notes 5.3）
  const realGift = (id, o) => {
    o = o || {};
    const gimg = h('img', o.giftSrc ? { alt: o.alt || '星星', src: o.giftSrc } : { alt: o.alt || '星星' });
    return h('yt-gift-message-view-model', { id }, [
      h('div', { id: 'gift-message-v2', tabindex: '0', role: 'listitem' }, [
        h('yt-img-shadow', { id: 'author-photo', height: '24', width: '24' }, [h('img', { id: 'img', draggable: 'false', alt: '', src: o.photo || 'https://yt4.ggpht.com/gv=s64' })]),
        h('div', { id: 'content' }, [
          h('yt-attributed-string', { id: 'author-name-v2' }, [h('span', { role: 'text' }, [h('span', { text: o.author || '@dennis_tw' })])]),
          h('yt-attributed-string', { id: 'message-v2' }, [h('span', { role: 'text' }, [h('span', { text: o.text || '贈送星星' })])]),
          h('yt-image', { id: 'gift-image' }, [gimg]),
        ]),
      ]),
    ]);
  };
  test('T5.5 禮物專用解析（24.3）：handle＝#author-name-v2（authorSource dom）、頭像、內文＝#message-v2、禮物名稱＝圖片 alt；圖片延遲設定 src → 補送；www.youtube.com 在白名單', async () => {
    const m = CAP.parseMessage(realGift('GV1'), { source: 'live', now: NOW, startedAt: NOW - 60e3 });
    eq([m.type, m.authorHandle, m.authorUrl, m.authorSource, m.authorAvatar, m.giftName, m.giftImage, m.rawTag],
      ['gift', '@dennis_tw', 'https://www.youtube.com/@dennis_tw', 'dom', 'https://yt4.ggpht.com/gv=s64', '星星', undefined, 'yt-gift-message-view-model']);
    eq(m.runs, [{ text: '贈送星星' }], '內文只有 #message-v2（不含 handle）');
    // 內文開頭剛好也有 @handle：以 #author-name-v2 為準
    const m2 = CAP.parseMessage(realGift('GV2', { author: '@real_one', text: '@someone 贈送' }), { source: 'live', now: NOW });
    eq([m2.authorHandle, m2.authorSource], ['@real_one', 'dom']);
    // 作者元件是顯示名稱（不是 @handle）
    const m3 = CAP.parseMessage(realGift('GV3', { author: 'Dennis' }), { source: 'live', now: NOW });
    eq([m3.authorHandle, m3.authorName, m3.authorSource], ['', 'Dennis', 'dom']);
    // 已有 src（www.youtube.com）
    const m4 = CAP.parseMessage(realGift('GV4', { giftSrc: 'https://www.youtube.com/s/gaming/emoji/gift/star.png' }), { source: 'live', now: NOW });
    eq(m4.giftImage, 'https://www.youtube.com/s/gaming/emoji/gift/star.png');
    eq([C.isAllowedImageUrl(m4.giftImage), C.isAllowedImageUrl('https://evil.example/x.png')], [true, false], '白名單');
    // 引擎：擷取當下沒有 src → 設定 src 後補送同一則（giftLate）
    const { items } = buildChat();
    const send = mockSend();
    const gs = [];
    const e = engine({ send, onGiftStructure: (d) => gs.push(d) });
    e.start();
    e.setInfo({ videoId: 'testVidGV01', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => send.of(RT.CAPTURE_START).length === 1, 2000, 'CAPTURE_START');
    await sleep(50);
    const node = realGift('GV5');
    items.append(node);
    await until(() => savedIds(send).includes('GV5'), 3000, '先送出');
    node.querySelector('#gift-image img').setAttribute('src', 'https://www.youtube.com/s/gaming/emoji/gift/star.png');
    const sentOf = () => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).filter((x) => x.id === 'GV5');
    await until(() => sentOf().some((x) => x.giftImage), 3000, '補送禮物圖片');
    const last = sentOf().filter((x) => x.giftImage).pop();
    eq([last.giftImage, last.giftName, last.authorHandle], ['https://www.youtube.com/s/gaming/emoji/gift/star.png', '星星', '@dennis_tw']);
    eq(e.state().stats.giftLate, 1);
    eq([gs[0].authorSource, gs[0].hasGiftImage], ['dom', false]);
    e.stop();
  });

  test('T5.4 頁面狀態提示（21.3）：依元件標籤標 notice（不比對文字；其他語系同樣分類）、同場同內容同一個 id', () => {
    const mkVe = (text) => h(self.YTCAS_SEL.chat.viewerEngagement, { id: 'VE' + (++seq) }, [h('div', { id: 'message', text })]);
    const a = CAP.parseMessage(mkVe('Welcome to live chat!'), { source: 'replay', now: NOW, videoId: 'testVidVE01' });
    const b = CAP.parseMessage(mkVe('Welcome to live chat!'), { source: 'replay', now: NOW + 5000, videoId: 'testVidVE01' });
    eq([a.type, a.notice, C.isNotice(a), a.id === b.id], ['system', true, true, true]);
    const t = CAP.parseMessage(textMsg({}), { source: 'live', now: NOW });
    eq([t.notice, C.isNotice(t)], [undefined, false], '一般訊息不是提示');
  });

  test('F-20 P1／P2：每分鐘的收錄統計與 #items 節點分類（標籤 × 已存／略過／未存），沒有收錄時也記錄', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const recs = [];
    const e = engine({ send, onDiag: (p, k, d) => recs.push({ p, k, d }) });
    e.start();
    e._logStats(false);
    eq(recs.filter((r) => r.p === 'P2').length, 1, '尚未收錄也記錄');
    e.setInfo({ videoId: 'testVidDG02' });
    await until(() => e.state().mode === 'capturing');
    for (let i = 0; i < 3; i++) items.append(textMsg({}));
    items.append(h('yt-live-chat-placeholder-item-renderer'));
    await tick();
    e._logStats(false);
    const p1 = recs.filter((r) => r.p === 'P1').pop().d;
    const p2 = recs.filter((r) => r.p === 'P2').pop().d;
    eq([p1.videoId, p1.captured, p1.times.hasStartedAt], ['testVidDG02', 3, false]);
    eq(p2, { total: 4, byTag: { 'yt-live-chat-text-message-renderer': { saved: 3, skip: 0, unsaved: 0 }, 'yt-live-chat-placeholder-item-renderer': { saved: 0, skip: 1, unsaved: 0 } } });
    e.stop();
  });

  test('T5.1 直播時間精度（審查十一 13.1 (C)）：即時到達的訊息用到達時間（與顯示的分鐘差 ≤ 90 秒）；歷史訊息與差太多的維持顯示時間；tsSource 記錄來源', async () => {
    const mkEl = (ts) => textMsg({ ts });
    // NOW = 22:23:41
    let m = CAP.parseMessage(mkEl('下午10:23'), { source: 'live', now: NOW, startedAt: NOW - 3600e3, arrival: true });
    eq([m.timestampAbs, m.tsSource], [NOW, 'arrival']);
    m = CAP.parseMessage(mkEl('下午10:22'), { source: 'live', now: NOW, startedAt: NOW - 3600e3, arrival: true });
    eq([m.timestampAbs, m.tsSource], [NOW, 'arrival'], '顯示的分鐘比到達早 1 分鐘（傳遞延遲、時鐘誤差）');
    m = CAP.parseMessage(mkEl('下午10:15'), { source: 'live', now: NOW, startedAt: NOW - 3600e3, arrival: true });
    eq([m.timestampAbs, m.tsSource], [new Date(2026, 10, 15, 22, 15, 59, 999).getTime(), 'clock'], '差太多：用顯示時間');
    m = CAP.parseMessage(mkEl('下午10:22'), { source: 'live', now: NOW, startedAt: NOW - 3600e3 });
    eq([m.timestampAbs, m.tsSource], [new Date(2026, 10, 15, 22, 22, 59, 999).getTime(), 'clock'], '歷史訊息（非即時到達）：顯示時間');
    // 同一分鐘內到達的兩則：秒數不同，offset 也不同
    const a = CAP.parseMessage(mkEl('下午10:23'), { source: 'live', now: NOW + 5000, startedAt: NOW - 3600e3, arrival: true });
    const b = CAP.parseMessage(mkEl('下午10:23'), { source: 'live', now: NOW + 12000, startedAt: NOW - 3600e3, arrival: true });
    assert(b.videoOffsetSec - a.videoOffsetSec === 7, 'offset 差 7 秒：' + a.videoOffsetSec + ' / ' + b.videoOffsetSec);
    // 引擎：開始收錄時既有的（回溯）＝ clock；之後 observer 收到的 ＝ arrival
    const { items } = buildChat();
    items.append(textMsg({ id: 'TS-OLD', ts: '下午10:20' }));
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidTsrc', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => savedIds(send).includes('TS-OLD'), 3000, '回溯');
    items.append(textMsg({ id: 'TS-NEW', ts: '下午10:23' }));
    await until(() => savedIds(send).includes('TS-NEW'), 3000, '即時');
    const all = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages);
    eq([all.find((x) => x.id === 'TS-OLD').tsSource, all.find((x) => x.id === 'TS-NEW').tsSource], ['clock', 'arrival']);
    e.stop();
  });

  test('T5.7 背景分頁的時間精度（28.3、28.4）：背景時一批到達（> 2 則）→ 顯示時間（clock）；背景時逐則到達 → 到達時間；P1 記 tsSource 分布、背景擷取筆數、giftLate／giftMissing', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const recs = [];
    const e = engine({ send, onDiag: (p, k, d) => recs.push({ p, k, d }) });
    e.start();
    e.setInfo({ videoId: 'testVidHide1', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => e.state().mode === 'capturing');
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    try {
      // 前景：一次 3 則 → 到達時間
      items.append(textMsg({ id: 'HV1', ts: '下午10:23' }), textMsg({ id: 'HV2', ts: '下午10:23' }), textMsg({ id: 'HV3', ts: '下午10:23' }));
      await until(() => savedIds(send).includes('HV3'), 3000);
      hidden = true;
      // 背景：一次 4 則（節流後一批到達）→ 顯示時間
      items.append(textMsg({ id: 'HB1', ts: '下午10:22' }), textMsg({ id: 'HB2', ts: '下午10:23' }), textMsg({ id: 'HB3', ts: '下午10:23' }), textMsg({ id: 'HB4', ts: '下午10:23' }));
      await until(() => savedIds(send).includes('HB4'), 3000);
      // 背景：逐則 → 到達時間
      items.append(textMsg({ id: 'HS1', ts: '下午10:23' }));
      await until(() => savedIds(send).includes('HS1'), 3000);
      const all = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages);
      const src = (id) => all.find((x) => x.id === id).tsSource;
      eq(['HV1', 'HV3', 'HB1', 'HB4', 'HS1'].map(src), ['arrival', 'arrival', 'clock', 'clock', 'arrival']);
      e.stop();
      const p1 = recs.filter((r) => r.p === 'P1').pop();
      assert(p1, 'P1');
      const ts = p1.d.tsSource;
      assert(ts.arrival === 4 && ts.clock >= 4 && ts.capture === 0, 'tsSource 分布（clock 含開始時回溯的既有訊息）' + JSON.stringify(ts));
      eq([p1.d.hidden.captured, p1.d.hidden.batches, p1.d.hidden.bulk, p1.d.hidden.bulkMsgs, p1.d.hidden.batchMax], [5, 2, 1, 4, 4]);
      assert(typeof p1.d.giftLate === 'number' && typeof p1.d.giftMissing === 'number', 'giftLate／giftMissing');
    } finally { delete document.hidden; }
  });

  test('T5.1 頭像延遲載入（審查十一第 10 節）：擷取時還是佔位圖 → src 變成 https 後補送同一則（帶頭像）；10 秒內沒有就放棄', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidAvat', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => send.of(RT.CAPTURE_START).length === 1, 2000, 'CAPTURE_START');
    await sleep(50);
    const el = textMsg({ id: 'AVATAR-LATE', ts: '下午10:23', avatar: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
    items.append(el);
    await until(() => savedIds(send).includes('AVATAR-LATE'), 3000, '先送出');
    const first = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).find((m) => m.id === 'AVATAR-LATE');
    eq(first.authorAvatar, '', '擷取當下沒有 https 頭像');
    // yt-img-shadow 延遲載入：src 換成 https（本頁 CSP 阻止實際連線）
    el.querySelector('#img').setAttribute('src', 'https://yt4.ggpht.com/late-avatar=s64');
    await until(() => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).some((m) => m.id === 'AVATAR-LATE' && m.authorAvatar), 3000, '補送頭像');
    const upd = send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).filter((m) => m.id === 'AVATAR-LATE').pop();
    eq(upd.authorAvatar, 'https://yt4.ggpht.com/late-avatar=s64');
    eq(e.state().stats.avatarLate, 1);
    e.stop();
  });

  // ---------------------------------------------------------------- T5.3（審查十一 17.1、17.2）
  test('T5.3 連結（17.1）：/redirect 解出 q、站內連結保留完整網址、javascript: 丟棄只留文字、文字含 < > 不變成 HTML', () => {
    const el = textMsg({ id: 'LINK-1' });
    const msg = el.querySelector('#message');
    msg.textContent = '';
    const a = (href, text) => { const x = document.createElement('a'); x.className = 'yt-simple-endpoint style-scope yt-live-chat-text-message-renderer'; x.setAttribute('href', href); x.textContent = text; return x; };
    msg.append('看這裡 ',
      a('https://www.youtube.com/redirect?event=live_chat&redir_token=TOKEN&q=https%3A%2F%2Fmadestudio.com.tw%2Fzh%2Fgames%2Fbrave-story%3Fa%3D1', 'https://madestudio.com.tw/zh/games/br...'),
      ' 頻道 ', a('/@someone', '@someone'), ' ', a('/hashtag/test', '#test'),
      ' ', a('javascript:alert(1)', '點我'), ' ', a('/redirect?q=javascript%3Aalert(1)', '壞的'), ' <b>不是粗體</b>');
    const m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null });
    const links = m.runs.filter((r) => r.link);
    eq(links.map((r) => [r.text, r.link.url]), [
      ['https://madestudio.com.tw/zh/games/br...', 'https://madestudio.com.tw/zh/games/brave-story?a=1'],
      ['@someone', 'https://www.youtube.com/@someone'],
      ['#test', 'https://www.youtube.com/hashtag/test'],
    ]);
    const text = m.runs.map((r) => r.text).join('');
    assert(text.includes('點我') && text.includes('壞的'), '不合格的連結只留文字');
    assert(text.endsWith(' <b>不是粗體</b>'), '文字照原樣（textContent）');
    assert(!m.runs.some((r) => r.link && !/^https?:/.test(r.link.url)), '只有 http／https');
    // 相鄰的文字不會併入連結
    eq(m.runs[0], { text: '看這裡 ' });
  });

  test('T5.3 超級貼圖（17.2）：協定相對網址補 https:、存下 alt；data:／javascript: 丟棄；延遲載入補送（stickerLate）', async () => {
    let el = stickerMsg();
    const img = el.querySelector('#sticker img');
    img.setAttribute('src', '//lh3.googleusercontent.com/stk-rel=s96');
    img.setAttribute('alt', '開心的貓');
    let m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null });
    eq([m.stickerSrc, m.stickerAlt], ['https://lh3.googleusercontent.com/stk-rel=s96', '開心的貓']);
    for (const bad of ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'javascript:alert(1)', 'http://lh3.googleusercontent.com/x']) {
      el = stickerMsg(); el.querySelector('#sticker img').setAttribute('src', bad);
      m = CAP.parseMessage(el, { source: 'live', now: NOW, startedAt: null });
      eq(m.stickerSrc, '', bad.slice(0, 12));
    }
    // 表符與頭像用同一個函式
    const t = textMsg({ id: 'REL-EMOJI', avatar: '//yt4.ggpht.com/rel-avatar=s64', runs: [{ emoji: { alt: ':x:', src: '//yt3.ggpht.com/rel-emoji=w24' } }] });
    m = CAP.parseMessage(t, { source: 'live', now: NOW, startedAt: null });
    eq([m.authorAvatar, m.runs[0].emoji.src], ['https://yt4.ggpht.com/rel-avatar=s64', 'https://yt3.ggpht.com/rel-emoji=w24']);
    // 延遲載入
    const { items } = buildChat();
    const send = mockSend();
    const e = engine({ send });
    e.start();
    e.setInfo({ videoId: 'testVidStkr', startDate: NOW - 60000, channelHandle: '@ch' });
    await until(() => send.of(RT.CAPTURE_START).length === 1, 2000, 'CAPTURE_START');
    await sleep(50);
    el = stickerMsg();
    const id = el.id;
    el.querySelector('#sticker img').setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    items.append(el);
    await until(() => savedIds(send).includes(id), 3000, '先送出');
    el.querySelector('#sticker img').setAttribute('src', 'https://lh3.googleusercontent.com/late-stk=s96');
    await until(() => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages).some((x) => x.id === id && x.stickerSrc), 3000, '補送貼圖');
    eq(e.state().stats.stickerLate, 1);
    e.stop();
  });

  // v50（T6.1，審查十一 30.5）自己送出的訊息：暫時節點 → 正式節点（模擬結構；YouTube 實際的替換方式待實機確認，dom-notes 2.9）
  test('T6.1 自己送出的訊息（30.5）：暫時 id／頁面移除（非開頭）／原地改 id／事後配對 → 正式節點帶 replacesId 並沿用到達時間；修剪、列表開頭、兩則都在頁面上（連續送出相同內容）不配對；P7 只有 id 前 4 碼與長度', async () => {
    const { items } = buildChat();
    const send = mockSend();
    const recs = [];
    let T = NOW;
    const e = engine({ send, now: () => T, onDiag: (p, k, d) => recs.push({ p, k, d }) });
    e.start();
    e.setInfo({ videoId: 'testVidOwn1', startDate: NOW - 3600e3, channelHandle: '@ch' });
    await until(() => e.state().mode === 'capturing');
    const all = () => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages);
    const last = (id) => all().filter((x) => x.id === id).pop();
    const me = (id, text) => textMsg({ id, author: '@又新-david', ts: '下午10:24', runs: [{ text }] });
    items.append(textMsg({ id: 'OWN-OLDER', author: '@x', ts: '下午10:23' })); // 列表開頭的其他訊息
    await until(() => last('OWN-OLDER'), 3000);
    // 1. 暫時 id（LCC.）→ 18 秒後正式節點（暫時節點還在頁面上）
    T = NOW + 20000;
    const tmp = me('LCC.own-temp-1', '早安');
    items.append(tmp);
    await until(() => last('LCC.own-temp-1'), 3000);
    T = NOW + 38000;
    items.append(me('ChwKown-real-1', '早安'));
    await until(() => last('ChwKown-real-1'), 3000);
    let r = last('ChwKown-real-1');
    eq([r.replacesId, r.timestampAbs, r.tsSource], ['LCC.own-temp-1', NOW + 20000, 'arrival'], '暫時 id');
    tmp.remove();
    // 2. 暫時 id 格式不符：頁面移除舊節點（不是開頭）＋新節點
    T = NOW + 45000;
    const tmp2 = me('ChwKown-pend-2', '午安');
    items.append(tmp2);
    await until(() => last('ChwKown-pend-2'), 3000);
    T = NOW + 55000;
    tmp2.remove();
    items.append(me('ChwKown-real-2', '午安'));
    await until(() => last('ChwKown-real-2'), 3000);
    r = last('ChwKown-real-2');
    eq([r.replacesId, r.timestampAbs], ['ChwKown-pend-2', NOW + 45000], '頁面移除');
    // 3. 連續送出相同內容（兩個節點都在頁面上、都是正式 id）→ 不配對
    T = NOW + 60000;
    items.append(me('ChwKown-dup-a', '8888'));
    await until(() => last('ChwKown-dup-a'), 3000);
    T = NOW + 62000;
    items.append(me('ChwKown-dup-b', '8888'));
    await until(() => last('ChwKown-dup-b'), 3000);
    assert(!last('ChwKown-dup-b').replacesId, '連續送出相同內容不可配對');
    // 4. 列表開頭被移除（YouTube 自己的上限）→ 不配對
    const head = items.firstElementChild;
    const headText = head.querySelector('#message').textContent;
    const headAuthor = head.querySelector('#author-name').firstChild.textContent;
    T = NOW + 63000;
    head.remove();
    items.append(textMsg({ id: 'ChwKown-head-new', author: headAuthor, ts: '下午10:24', runs: [{ text: headText }] }));
    await until(() => last('ChwKown-head-new'), 3000);
    assert(!last('ChwKown-head-new').replacesId, '列表開頭被移除不算替換');
    // 5. 原地改 id（同一個節點）
    T = NOW + 70000;
    const inplace = me('ChwKown-ip-old', '晚安');
    items.append(inplace);
    await until(() => last('ChwKown-ip-old'), 3000);
    T = NOW + 80000;
    inplace.id = 'ChwKown-ip-new';
    await until(() => last('ChwKown-ip-new'), 3000);
    r = last('ChwKown-ip-new');
    eq([r.replacesId, r.replaceInPlace, r.timestampAbs], ['ChwKown-ip-old', true, NOW + 70000], '原地改 id');
    // 6. 事後配對：正式節點先出現（暫時節點還在），之後頁面才移除暫時節點
    T = NOW + 85000;
    const tmp6 = me('ChwKown-pend-6', '你好');
    items.append(tmp6);
    await until(() => last('ChwKown-pend-6'), 3000);
    T = NOW + 95000;
    items.append(me('ChwKown-real-6', '你好'));
    await until(() => last('ChwKown-real-6'), 3000);
    assert(!last('ChwKown-real-6').replacesId, '暫時節點還在、id 也不像暫時 → 先不配對');
    tmp6.remove();
    await until(() => last('ChwKown-real-6').replacesId, 3000, '事後配對');
    r = last('ChwKown-real-6');
    eq([r.replacesId, r.timestampAbs], ['ChwKown-pend-6', NOW + 85000]);
    const st = e.state().stats;
    eq([st.ownTempSeen, st.ownReplaced, st.ownInPlace, st.ownLate], [1, 2, 1, 1]);
    e.stop();
    const p7 = recs.filter((x) => x.p === 'P7' && x.k === 'own-replace').map((x) => x.d);
    assert(p7.length >= 4, 'P7 own-replace：' + p7.length);
    const s = JSON.stringify(p7);
    assert(!s.includes('早安') && !s.includes('又新') && !s.includes('own-real'), 'P7 不含內容、作者與完整 id');
    eq(p7.find((x) => x.kind === 'new-node').newId, { p: 'ChwK', len: 'ChwKown-real-1'.length });
    const p1 = recs.filter((x) => x.p === 'P1').pop();
    assert(p1 && p1.d.own && p1.d.own.replaced === 2, 'P1 own 統計');
  });

  test('T6.1 自己送出的訊息（30.5）：本套件修剪掉的舊節點不算替換（同作者同內容的新訊息照常存成新的一則）', async () => {
    const { items } = buildChat();
    const send = mockSend();
    let T = NOW;
    const e = engine({ send, now: () => T });
    e.start();
    e.setInfo({ videoId: 'testVidOwn2', startDate: NOW - 3600e3, channelHandle: '@ch' });
    await until(() => e.state().mode === 'capturing');
    const all = () => send.of(RT.SAVE_MESSAGES).flatMap((c) => c.msg.messages);
    items.append(textMsg({ id: 'ChwKtrim-first', author: '@fan', ts: '下午10:23', runs: [{ text: '同一句' }] }));
    for (let i = 0; i < 60; i++) items.append(textMsg({ id: 'ChwKfill' + i, author: '@other' + i, ts: '下午10:23' }));
    await until(() => all().some((x) => x.id === 'ChwKfill59') && items.children.length <= C.DOM_MAX_MESSAGES, 3000);
    assert(!items.querySelector('#ChwKtrim-first'), '已被修剪');
    T = NOW + 10000;
    items.append(textMsg({ id: 'ChwKtrim-second', author: '@fan', ts: '下午10:23', runs: [{ text: '同一句' }] }));
    await until(() => all().some((x) => x.id === 'ChwKtrim-second'), 3000);
    assert(!all().find((x) => x.id === 'ChwKtrim-second').replacesId, '修剪的節點不配對');
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
