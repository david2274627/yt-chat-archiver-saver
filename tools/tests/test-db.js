// T2 資料層單元測試（SPEC 第 8 節 T2）。結果顯示在頁面並存於 window.__results。
(function () {
  'use strict';
  const DB = self.YTCAS_DB;
  const U = DB.util;
  const BG = self.YTCAS_BG;
  const M = self.__mock;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  // 測試頁不得連外：mock-chrome.js 已把 fetch 換成一律回 404（個別測試可暫時替換，用完還原）

  // ---------------------------------------------------------------- 工具
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error((msg || 'not equal') + '：實際 ' + x + '，預期 ' + y);
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CONTENT = { id: 'testextid', url: 'https://www.youtube.com/live_chat?v=x', tab: { id: 1 } };
  const PAGE = { id: 'testextid', url: 'chrome-extension://testextid/src/viewer.html' };
  function send(msg, sender) {
    return new Promise((resolve) => {
      let done = false;
      const ret = M.listeners.message[0](msg, sender || CONTENT, (r) => { done = true; resolve(r); });
      if (ret !== true && !done) resolve(undefined);
    });
  }
  async function resetAll() {
    await DB.close();
    await req(indexedDB.deleteDatabase(M.TEST_DB));
    await req(indexedDB.deleteDatabase(M.TEST_LEGACY));
    for (const a of ['sync', 'local', 'session']) chrome.storage[a]._reset();
    M.broadcasts.length = 0;
  }
  const V = 'vidAAAAAAA1', V2 = 'vidBBBBBBB2';
  let seq = 0;
  function msg(o) {
    seq++;
    return Object.assign({ id: 'm' + seq, type: 'text', authorHandle: '@user' + (seq % 5), runs: [{ text: 'hello ' + seq }],
      timestampAbs: 1_700_000_000_000 + seq * 1000, videoOffsetSec: seq * 10 }, o || {});
  }
  const count = async (vid) => (await DB.queryMessages(vid)).length;

  // ---------------------------------------------------------------- 純函式
  test('純函式：hash 固定、normText 含表符 alt、offset 為 null 不產生 fp', () => {
    eq(U.hash('abc'), U.hash('abc'));
    assert(U.hash('abc') !== U.hash('abd'));
    eq(U.normText([{ text: 'Ｈｉ  ' }, { emoji: { alt: ':smile:' } }, { text: ' 草' }]), 'hi :smile: 草');
    eq(U.makeFp({ type: 'text', authorHandle: '@a', runs: [{ text: 'x' }], videoOffsetSec: null }), '');
    eq(U.makeFp({ type: 'sticker', authorHandle: '', runs: [], videoOffsetSec: 10 }), '', '沒有作者也沒有內容不做 fp');
    const a = U.makeFp({ type: 'text', authorHandle: '@A', runs: [{ text: 'X' }], videoOffsetSec: 10.2 });
    const b = U.makeFp({ type: 'text', authorHandle: '@a', runs: [{ text: 'x' }], videoOffsetSec: 9.6 });
    eq(a, b, '同桶（3 秒）指紋相同');
  });

  test('純函式：F-18 版本偵測（v1 補長度、±2 秒同版、長度改變產生 v2）', () => {
    const vs = [];
    eq(U.resolveVersion(vs, null, 1), 'v1');
    eq(vs[0].duration, null);
    eq(U.resolveVersion(vs, 3600.4, 2), 'v1', 'v1 長度未知時補上');
    eq(vs[0].duration, 3600);
    eq(U.resolveVersion(vs, 3602, 3), 'v1', '差 2 秒內同版');
    eq(U.resolveVersion(vs, 3000, 4), 'v2');
    eq(vs[1].label, '剪輯版 1');
    eq(U.resolveVersion(vs, 3001, 5), 'v2');
    eq(U.resolveVersion(vs, NaN, 6), 'v1', '長度取不到視為 v1');
  });

  test('純函式：區間合併與覆蓋範圍空檔（含 popout、replay 換算）', () => {
    eq(U.mergeIntervals([[5, 9], [1, 3], [3.5, 4]], 0.5), [[1, 4], [5, 9]]);
    eq(U.mergeIntervals([[5, 9], [1, 4]], 1), [[1, 9]], '小於容許值的空檔忽略');
    const t0 = 1_000_000;
    const cov = U.coverage([
      { source: 'live', startedAt: t0, endedAt: t0 + 60000, firstTs: t0 - 30000, lastTs: t0 + 59000 },
      { source: 'popout', startedAt: t0 + 61000, endedAt: t0 + 120000 },
      { source: 'live', startedAt: t0 + 300000, endedAt: t0 + 360000 },
      { source: 'replay', versionId: 'v1', firstOffset: 400, lastOffset: 500 },
    ], { startedAt: t0 });
    eq(cov.live, [[t0 - 30000, t0 + 120000], [t0 + 300000, t0 + 360000]], '回溯訊息延伸起點、popout 與 live 合併');
    eq(cov.gaps, [[t0 + 120000, t0 + 300000], [t0 + 360000, t0 + 400000]], '空檔');
    eq(cov.replay.v1, [[400, 500]]);
  });

  test('純函式：v2.6.0 訊息轉換（類型、徽章、handle、別名）', () => {
    const m = U.convertLegacyMessage({ id: V + '_ChwKGkNOYXR', videoId: V, timestamp: 5, videoOffsetSec: 3, authorId: '@abc',
      authorName: 'ABC 頻道', isOwner: true, isCreatorLanding: true, type: 'yt-live-chat-text-message-renderer',
      parts: [{ type: 'text', text: 'hi' }, { type: 'emoji', alt: ':x:', src: 'https://yt3.ggpht.com/a' }] });
    eq(m.type, 'text'); eq(m.authorHandle, '@abc'); eq(m.authorBadges, ['owner', 'verified']); eq(m.aliasIds, ['ChwKGkNOYXR']);
    eq(m.runs[1], { emoji: { src: 'https://yt3.ggpht.com/a', alt: ':x:', shortcut: '' } });
    const n = U.convertLegacyMessage({ id: V + '_1731500000000_ab12', videoId: V, authorId: 'unknown:1', type: 'x-unknown', parts: [] });
    eq(n.aliasIds, [], '亂數 id 不作別名'); eq(n.type, 'system'); eq(n.rawTag, 'x-unknown'); eq(n.authorHandle, '');
  });

  // ---------------------------------------------------------------- DB 結構與遷移
  test('v1 → v2 遷移：補預設值、新索引與 capture_sessions', async () => {
    await resetAll();
    // 以 v1 結構建立資料庫並寫入舊紀錄
    await new Promise((resolve, reject) => {
      const r = indexedDB.open(M.TEST_DB, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('streams', { keyPath: 'videoId' }).put({ videoId: V, title: 'v1 場次', messageCount: 1 });
        const ms = db.createObjectStore('messages', { keyPath: 'id' });
        ms.createIndex('videoId', 'videoId'); ms.createIndex('videoId_offset', ['videoId', 'videoOffsetSec']); ms.createIndex('videoId_type', ['videoId', 'type']);
        ms.put({ id: 'old1', videoId: V, type: 'text', authorHandle: '@a', runs: [{ text: 'x' }], timestampAbs: 1, videoOffsetSec: 12 });
        db.createObjectStore('pinned_messages', { keyPath: 'id' }).createIndex('videoId', 'videoId');
        db.createObjectStore('channels', { keyPath: 'handleOrId' });
      };
      r.onsuccess = () => { r.result.close(); resolve(); };
      r.onerror = () => reject(r.error);
    });
    const db = await DB.open();
    eq(db.version, 2);
    assert(db.objectStoreNames.contains('capture_sessions'), 'capture_sessions');
    const idx = Array.from(db.transaction('messages').objectStore('messages').indexNames);
    assert(idx.includes('videoId_fp') && idx.includes('aliasIds'), '新索引：' + idx.join(','));
    const [m] = await DB.queryMessages(V);
    eq([m.sources, m.phase, m.offsetSource, m.deleted, m.offsets, m.aliasIds], [['live'], 'live', 'estimated', false, { v1: 12 }, []]);
    assert(m.fp, '補上 fp');
    const s = await DB.getStream(V);
    eq([s.title, s.versions, s.linkedVideos, s.popoutCaptureCount], ['v1 場次', [], [], 0]);
  });

  // ---------------------------------------------------------------- F-14 情境表
  test('F-14 情境 1：同一場重新整理 3 次（回溯訊息重疊）→ 無重複、場次只有一筆（AC 1）', async () => {
    await resetAll();
    const batch = [msg(), msg(), msg(), msg()];
    for (let i = 0; i < 3; i++) {
      const cs = await DB.captureStart({ videoId: V, source: 'live', stream: { title: '直播 A' } });
      await DB.saveMessages({ videoId: V, messages: batch.slice(0, 2 + i), source: 'live', captureSessionId: cs.captureSessionId });
    }
    eq(await count(V), 4);
    const streams = await DB.listStreams();
    eq(streams.length, 1);
    eq([streams[0].messageCount, streams[0].liveCaptureCount], [4, 3]);
  });

  test('F-14 情境 2：直播後看重播 → 同一份存檔，id 相同合併、offset 升級為 replay（AC 2）', async () => {
    await resetAll();
    const a = msg({ videoOffsetSec: 100.4 });
    await DB.saveMessages({ videoId: V, messages: [a], source: 'live' });
    const cs = await DB.captureStart({ videoId: V, source: 'replay', duration: 3600 });
    eq(cs.versionId, 'v1');
    const r = await DB.saveMessages({ videoId: V, messages: [Object.assign({}, a, { videoOffsetSec: 98 })], source: 'replay', captureSessionId: cs.captureSessionId });
    eq([r.added, r.merged], [0, 1]);
    const [m] = await DB.queryMessages(V);
    eq([m.sources, m.offsetSource, m.videoOffsetSec, m.offsets.v1], [['live', 'replay'], 'replay', 98, 98]);
    // 第二次重播（同版）不再改寫
    await DB.saveMessages({ videoId: V, messages: [Object.assign({}, a, { videoOffsetSec: 97 })], source: 'replay', versionId: 'v1' });
    eq((await DB.queryMessages(V))[0].videoOffsetSec, 98, 'replay 值永不改寫');
  });

  test('F-14 情境 2b：重播 id 不同 → 後備指紋去重合併並記入別名，再看一次不重複', async () => {
    await resetAll();
    const live = msg({ id: 'live-1', authorHandle: '@x', runs: [{ text: '你好' }], videoOffsetSec: 61 });
    await DB.saveMessages({ videoId: V, messages: [live], source: 'live' });
    const rep = Object.assign({}, live, { id: 'replay-1', videoOffsetSec: 60 });
    const r1 = await DB.saveMessages({ videoId: V, messages: [rep], source: 'replay' });
    eq([r1.added, r1.fpMerged], [0, 1]);
    const r2 = await DB.saveMessages({ videoId: V, messages: [rep], source: 'replay' });
    eq(r2.added, 0, '以別名命中');
    const all = await DB.queryMessages(V);
    eq(all.length, 1);
    eq(all[0].aliasIds, ['replay-1']);
  });

  test('F-14 情境 3：重複觀看同一部 VOD → 無重複', async () => {
    await resetAll();
    const list = [msg(), msg(), msg()];
    for (let i = 0; i < 2; i++) {
      const cs = await DB.captureStart({ videoId: V, source: 'replay', duration: 1200 });
      await DB.saveMessages({ videoId: V, messages: list, source: 'replay', captureSessionId: cs.captureSessionId });
    }
    eq(await count(V), 3);
    eq((await DB.getStream(V)).replayCaptureCount, 2);
  });

  test('F-14 情境 4：兩個分頁同時寫入同一場 → 序列化、無重複（AC 3）', async () => {
    await resetAll();
    const list = Array.from({ length: 30 }, () => msg());
    const rs = await Promise.all([
      DB.saveMessages({ videoId: V, messages: list, source: 'live' }),
      DB.saveMessages({ videoId: V, messages: list.slice().reverse(), source: 'popout' }),
      send({ type: 'SAVE_MESSAGES', videoId: V, messages: list, source: 'live' }),
    ]);
    eq(await count(V), 30);
    eq(rs[0].added + rs[1].added + rs[2].added, 30);
    eq((await DB.getStream(V)).messageCount, 30);
  });

  test('F-14 情境 5：被管理員刪除 → 保留內容並標記，可篩選隱藏（AC 4）', async () => {
    await resetAll();
    const a = msg(), b = msg();
    await DB.saveMessages({ videoId: V, messages: [a, b], source: 'live' });
    const r = await send({ type: 'MESSAGE_DELETED', videoId: V, id: a.id, deletedAt: 123 });
    eq([r.ok, r.found], [true, true]);
    const all = await DB.queryMessages(V);
    const d = all.find((m) => m.id === a.id);
    eq([d.deleted, d.deletedAt, d.runs], [true, 123, a.runs]);
    eq((await DB.queryMessages(V, { includeDeleted: false })).map((m) => m.id), [b.id]);
    // 之後重播再出現（deleted 未標）不會取消刪除標記
    await DB.saveMessages({ videoId: V, messages: [a], source: 'replay' });
    eq((await DB.queryMessages(V)).find((m) => m.id === a.id).deleted, true);
  });

  test('F-14 情境 6a：v2.6.0 舊資料庫遷移 → 舊庫筆數不變、新舊一致、重跑無重複、舊 id 與新收錄以別名合併', async () => {
    await resetAll();
    await createLegacyDb();
    const r1 = await send({ type: 'MIGRATE_LEGACY' }, PAGE);
    assert(r1.ok && r1.exists, JSON.stringify(r1));
    eq(r1.legacyCounts, { streams: 2, messages: 5, pinned_messages: 1, channels: 2 });
    eq(r1.legacyCountsAfter, r1.legacyCounts, '舊庫筆數不變');
    eq([r1.migratedCounts.messages.added, r1.migratedCounts.pinned.added, r1.migratedCounts.streams], [5, 1, 2]);
    eq(await count(V) + await count(V2), 5, '新舊訊息數一致');
    eq((await DB.listStreams()).length, 2, '場次數一致');
    const r2 = await DB.migrateLegacy();
    eq(r2.migratedCounts.messages.added, 0, '重跑無重複');
    eq((await DB.countAll()).messages, 5);
    // 之後直播／重播收錄到同一則（YouTube 原 id）→ 以別名合併
    const r3 = await DB.saveMessages({ videoId: V, messages: [{ id: 'YTID-1', type: 'text', authorHandle: '@abc', runs: [{ text: 'hi' }], videoOffsetSec: 30 }], source: 'replay' });
    eq([r3.added, r3.merged], [0, 1]);
    const ch = await DB.getChannel('@abc');
    eq(ch.displayName, 'ABC 頻道');
    eq((await chrome.storage.local.get('legacyMigratedAt')).legacyMigratedAt > 0, true);
    // 舊庫內容未被修改
    const ldb = await req(indexedDB.open(M.TEST_LEGACY));
    const row = await req(ldb.transaction('messages').objectStore('messages').get(V + '_YTID-1'));
    ldb.close();
    eq([row.type, row.authorId, row.aliasIds], ['yt-live-chat-text-message-renderer', '@abc', undefined]);
  });

  test('F-11：舊資料庫不存在 → 不建立空庫', async () => {
    await resetAll();
    const r = await DB.migrateLegacy();
    eq(r.exists, false);
    if (indexedDB.databases) {
      const names = (await indexedDB.databases()).map((d) => d.name);
      assert(!names.includes(M.TEST_LEGACY), '不得建立空的舊資料庫：' + names.join(','));
    }
  });

  test('F-14 情境 6b：JSON 匯入（v3 匯出往返）兩次 → 無重複，收錄紀錄不重複（AC 5）', async () => {
    await resetAll();
    const cs = await DB.captureStart({ videoId: V, source: 'live', stream: { title: '匯出測試' } });
    await DB.saveMessages({ videoId: V, messages: [msg(), msg(), msg()], source: 'live', captureSessionId: cs.captureSessionId });
    await DB.savePinned({ videoId: V, message: msg({ id: 'pin1' }) });
    const exp = (await send({ type: 'EXPORT_STREAM', videoId: V }, PAGE)).data;
    eq([exp.formatVersion, exp.app, exp.messages.length, exp.pinnedMessages.length, exp.captureSessions.length], [2, 'ytcas', 3, 1, 1]);
    await DB.deleteStreams([V]);
    eq((await DB.countAll()).messages, 0);
    const pv = await send({ type: 'IMPORT_DATA', data: exp, dryRun: true }, PAGE);
    eq([pv.streams, pv.messages, pv.duplicates], [1, 3, 0]);
    const i1 = await send({ type: 'IMPORT_DATA', data: exp }, PAGE);
    eq([i1.added, i1.pinnedAdded, i1.sessionsAdded], [3, 1, 1]);
    const pv2 = await send({ type: 'IMPORT_DATA', data: exp, dryRun: true }, PAGE);
    eq(pv2.duplicates, 3, '預覽顯示重複數');
    const i2 = await send({ type: 'IMPORT_DATA', data: exp }, PAGE);
    eq([i2.added, i2.pinnedAdded, i2.sessionsAdded], [0, 0, 0]);
    const c = await DB.countAll();
    eq([c.streams, c.messages, c.pinned_messages, c.capture_sessions], [1, 3, 1, 1]);
    const m = (await DB.queryMessages(V))[0];
    eq(m.sources, ['live', 'import']);
  });

  test('F-11：v2.6.0 匯出 JSON 匯入；格式錯誤時不寫入任何資料', async () => {
    await resetAll();
    const legacy = { videoId: V, streamMeta: { videoId: V, title: '舊匯出', streamStartEpochMs: 1000 }, pinnedMessages: [],
      messages: [{ id: V + '_A1', videoId: V, timestamp: 2000, videoOffsetSec: 1, authorId: '@q', authorName: '@q',
        parts: [{ type: 'text', text: 'x' }], plainText: 'x', type: 'yt-live-chat-text-message-renderer', resolvedChannelName: 'Q 台' }] };
    const r = await send({ type: 'IMPORT_DATA', data: legacy }, PAGE);
    eq([r.ok, r.added], [true, 1]);
    const m = (await DB.queryMessages(V))[0];
    eq([m.sources, m.authorName, (await DB.getStream(V)).title], [['legacy'], 'Q 台', '舊匯出']);
    const before = await DB.countAll();
    for (const bad of [{ foo: 1 }, { formatVersion: 9, app: 'ytcas', streams: [], messages: [] },
      { app: 'ytcas', formatVersion: 2, streams: [{ videoId: V2 }], messages: [{ videoId: V2 }] }, 'string']) {
      const e = await send({ type: 'IMPORT_DATA', data: bad }, PAGE);
      eq(e.ok, false, '應回報錯誤：' + JSON.stringify(bad));
      assert(/格式錯誤/.test(e.error), e.error);
    }
    eq(await DB.countAll(), before, '格式錯誤不寫入');
  });

  test('F-14 AC 8：同一觀眾短時間連發相同內容（不同 id，同來源）→ 兩則都保留', async () => {
    await resetAll();
    const a = msg({ id: 'k1', authorHandle: '@spam', runs: [{ text: '草' }], videoOffsetSec: 30 });
    const b = msg({ id: 'k2', authorHandle: '@spam', runs: [{ text: '草' }], videoOffsetSec: 31 });
    await DB.saveMessages({ videoId: V, messages: [a, b], source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [Object.assign({}, a, { id: 'k3' })], source: 'popout' });
    eq(await count(V), 3, 'popout 與 live 同類，不做後備合併');
  });

  test('F-14：offset 為 null 不做後備去重；system 被已知類型取代', async () => {
    await resetAll();
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 'n1', authorHandle: '@n', runs: [{ text: 'a' }], videoOffsetSec: null })], source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 'n2', authorHandle: '@n', runs: [{ text: 'a' }], videoOffsetSec: null })], source: 'replay' });
    eq(await count(V), 2);
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 's1', type: 'system', rawTag: 'x-gift', runs: [] })], source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [{ id: 's1', type: 'gift', giftName: '玫瑰', runs: [{ text: '送出 玫瑰' }] }], source: 'live' });
    const s = (await DB.queryMessages(V)).find((m) => m.id === 's1');
    eq([s.type, s.giftName, s.rawTag], ['gift', '玫瑰', 'x-gift']);
  });

  test('F-13 RECLASSIFY_SYSTEM：依 rawTag 重新分類，筆數不變、可重複執行', async () => {
    await resetAll();
    await DB.saveMessages({ videoId: V, messages: [
      msg({ id: 'g1', type: 'system', rawTag: 'ytd-future-gift-renderer' }),
      msg({ id: 'g2', type: 'system', rawTag: 'unknown-x' }), msg()], source: 'live' });
    const r = await DB.reclassifySystem({ videoId: V, tagMap: { 'ytd-future-gift-renderer': 'gift' } });
    eq([r.scanned, r.changed, r.byType], [2, 1, { gift: 1 }]);
    const again = await DB.reclassifySystem({ tagMap: { 'ytd-future-gift-renderer': 'gift' } });
    eq(again.changed, 0);
    eq(await count(V), 3);
    const viaBg = await send({ type: 'RECLASSIFY_SYSTEM', videoId: V }, PAGE);
    eq([viaBg.ok, viaBg.scanned], [true, 1]);
  });

  test('F-14 phase：開播時間事後確定 → 重算 pre／live／post 與 pre 的負 offset', async () => {
    await resetAll();
    const T0 = 1_800_000_000_000;
    await DB.saveMessages({ videoId: V, stream: { title: '待機室' }, source: 'live', messages: [
      { id: 'p1', type: 'text', authorHandle: '@a', runs: [{ text: '等開播' }], timestampAbs: T0 - 120000, videoOffsetSec: null, phase: 'pre' },
      { id: 'p2', type: 'text', authorHandle: '@a', runs: [{ text: '開始了' }], timestampAbs: T0 + 5000, videoOffsetSec: null },
      { id: 'p3', type: 'text', authorHandle: '@a', runs: [{ text: '辛苦了' }], timestampAbs: T0 + 3_700_000, videoOffsetSec: null }] });
    await DB.saveMessages({ videoId: V, stream: { startedAt: T0 }, source: 'live', messages: [] });
    let all = await DB.queryMessages(V);
    eq(all.map((m) => [m.phase, m.videoOffsetSec]), [['pre', -120], ['live', 5], ['live', 3700]]);
    await DB.saveMessages({ videoId: V, stream: { endedAt: T0 + 3_600_000 }, source: 'live', messages: [] });
    all = await DB.queryMessages(V);
    eq(all.map((m) => m.phase), ['pre', 'live', 'post']);
    assert(all[0].fp, 'offset 回填後有 fp');
  });

  // ---------------------------------------------------------------- F-18
  test('F-18：剪輯後重播 → 產生 v2，v1 時間碼完全不變；被剪段落不刪除（AC a）', async () => {
    await resetAll();
    const a = msg({ id: 'e1', videoOffsetSec: 100 }), b = msg({ id: 'e2', videoOffsetSec: 2000 }), c = msg({ id: 'e3', videoOffsetSec: 3000 });
    const live = await DB.captureStart({ videoId: V, source: 'live' });
    eq(live.versionId, 'v1');
    await DB.saveMessages({ videoId: V, messages: [a, b, c], source: 'live', captureSessionId: live.captureSessionId });
    const r1 = await DB.captureStart({ videoId: V, source: 'replay', duration: 3600 });
    eq(r1.versionId, 'v1');
    await DB.saveMessages({ videoId: V, messages: [Object.assign({}, a, { videoOffsetSec: 99 }), Object.assign({}, b, { videoOffsetSec: 1999 }),
      Object.assign({}, c, { videoOffsetSec: 2999 })], source: 'replay', captureSessionId: r1.captureSessionId });
    const v1Before = (await DB.queryMessages(V)).map((m) => m.videoOffsetSec);
    eq(v1Before, [99, 1999, 2999]);
    // 剪掉 1500～2500 秒（長度 3600 → 2600）
    const r2 = await DB.captureStart({ videoId: V, source: 'replay', duration: 2600 });
    eq(r2.versionId, 'v2');
    await DB.saveMessages({ videoId: V, messages: [Object.assign({}, a, { videoOffsetSec: 99 }), Object.assign({}, c, { videoOffsetSec: 1999 }),
      msg({ id: 'e4', videoOffsetSec: 2500 })], source: 'replay', captureSessionId: r2.captureSessionId });
    const all = await DB.queryMessages(V);
    const by = Object.fromEntries(all.map((m) => [m.id, m]));
    eq([by.e1.videoOffsetSec, by.e2.videoOffsetSec, by.e3.videoOffsetSec], v1Before, 'v1 時間碼不變');
    eq([by.e1.offsets, by.e2.offsets, by.e3.offsets], [{ v1: 99, v2: 99 }, { v1: 1999 }, { v1: 2999, v2: 1999 }]);
    eq([by.e4.videoOffsetSec, by.e4.offsets], [null, { v2: 2500 }], '只在新版本出現的訊息沒有 v1 offset');
    const s = await DB.getStream(V);
    eq(s.versions.map((v) => [v.id, v.duration, v.label]), [['v1', 3600, '原始'], ['v2', 2600, '剪輯版 1']]);
    // 匯出保留所有版本
    const exp = await DB.exportData({ videoId: V });
    eq(exp.streams[0].versions.length, 2);
    eq(exp.messages.find((m) => m.id === 'e3').offsets, { v1: 2999, v2: 1999 });
  });

  test('F-18：estimated 只在 v1 重播升級；v2 重播不做後備去重', async () => {
    await resetAll();
    await DB.captureStart({ videoId: V, source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 'f1', authorHandle: '@f', runs: [{ text: 'z' }], videoOffsetSec: 500 })], source: 'live' });
    await DB.captureStart({ videoId: V, source: 'replay', duration: 4000 });
    const v2 = await DB.captureStart({ videoId: V, source: 'replay', duration: 3000 });
    eq(v2.versionId, 'v2');
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 'f1', authorHandle: '@f', runs: [{ text: 'z' }], videoOffsetSec: 200 })], source: 'replay', captureSessionId: v2.captureSessionId });
    const m = (await DB.queryMessages(V))[0];
    eq([m.videoOffsetSec, m.offsetSource, m.offsets], [500, 'estimated', { v1: 500, v2: 200 }]);
    await DB.saveMessages({ videoId: V, messages: [msg({ id: 'f9', authorHandle: '@f', runs: [{ text: 'z' }], videoOffsetSec: 500 })], source: 'replay', captureSessionId: v2.captureSessionId });
    eq(await count(V), 2, 'v2 時間軸不做 fp 合併');
  });

  test('F-18：版本改名、連結剪輯版影片（重複連結為更新）、解除連結', async () => {
    await resetAll();
    await DB.captureStart({ videoId: V, source: 'replay', duration: 100 });
    eq((await send({ type: 'SET_VERSION_LABEL', videoId: V, versionId: 'v1', label: '首播版' }, PAGE)).stream.versions[0].label, '首播版');
    await send({ type: 'LINK_VIDEO', videoId: V, linkedVideoId: V2, label: '重新上傳', offsetShift: -12 }, PAGE);
    const r = await send({ type: 'LINK_VIDEO', videoId: V, linkedVideoId: V2, offsetShift: -10 }, PAGE);
    eq(r.stream.linkedVideos, [{ videoId: V2, label: '重新上傳', offsetShift: -10 }]);
    eq((await send({ type: 'LINK_VIDEO', videoId: V, linkedVideoId: 'bad id!' }, PAGE)).ok, false);
    eq((await send({ type: 'UNLINK_VIDEO', videoId: V, linkedVideoId: V2 }, PAGE)).stream.linkedVideos, []);
  });

  // ---------------------------------------------------------------- capture_sessions／重設／刪除
  test('capture_sessions：統計、CAPTURE_END、逾時補 endedAt、覆蓋範圍（F-19 popout）', async () => {
    await resetAll();
    const a = await send({ type: 'CAPTURE_START', videoId: V, source: 'live', stream: { title: 'S' } });
    eq([a.ok, a.allowed, a.versionId], [true, true, 'v1']);
    await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [msg(), msg({ phase: 'pre', videoOffsetSec: -5 })], source: 'live', captureSessionId: a.captureSessionId });
    await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [msg()], source: 'live', captureSessionId: a.captureSessionId });
    const e = await send({ type: 'CAPTURE_END', captureSessionId: a.captureSessionId });
    assert(e.session.endedAt > 0);
    const p = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout' });
    const r = await send({ type: 'LIST_CAPTURE_SESSIONS', videoId: V }, PAGE);
    const s0 = r.sessions[0];
    eq([s0.added, s0.merged, s0.phases.sort(), s0.firstOffset], [3, 0, ['live', 'pre'], -5]);
    eq(r.sessions[1].source, 'popout');
    eq((await DB.getStream(V)).popoutCaptureCount, 1);
    // 未送 CAPTURE_END 的 session：逾時後以 lastWriteAt（無則 startedAt）補上
    const closed = await DB.closeStaleSessions(Date.now() + 10 * 60 * 1000);
    eq(closed, 1);
    const after = (await DB.listCaptureSessions(V)).sessions.find((x) => x.id === p.captureSessionId);
    assert(after.endedAt === after.startedAt, '以 startedAt 補 endedAt');
    assert(r.coverage.live.length >= 1, '覆蓋範圍');
  });

  test('RESET_STREAM：刪訊息／置頂／收錄紀錄，保留基本資料與 linkedVideos、清空 versions（需擴充功能頁面）', async () => {
    await resetAll();
    await DB.captureStart({ videoId: V, source: 'replay', duration: 50, stream: { title: '保留標題', channelName: '頻道' } });
    await DB.saveMessages({ videoId: V, messages: [msg(), msg()], source: 'replay' });
    await DB.savePinned({ videoId: V, message: msg() });
    await DB.linkVideo({ videoId: V, linkedVideoId: V2 });
    eq((await send({ type: 'RESET_STREAM', videoId: V }, CONTENT)).error, 'forbidden', 'content script 不可執行');
    const r = await send({ type: 'RESET_STREAM', videoId: V }, PAGE);
    eq([r.reset.messages, r.reset.pinned, r.reset.sessions], [2, 1, 1]);
    const s = await DB.getStream(V);
    eq([s.title, s.channelName, s.messageCount, s.replayCaptureCount, s.versions, s.linkedVideos.length], ['保留標題', '頻道', 0, 0, [], 1]);
  });

  test('F-16：用量查詢、各場次大小、批次刪除只影響指定場次', async () => {
    await resetAll();
    const V3 = 'vidCCCCCCC3';
    for (const v of [V, V2, V3]) {
      await DB.captureStart({ videoId: v, source: 'live', stream: { title: v } });
      await DB.saveMessages({ videoId: v, messages: [msg(), msg()], source: 'live' });
      await DB.savePinned({ videoId: v, message: msg() });
    }
    const u = await send({ type: 'GET_STORAGE_USAGE' }, PAGE);
    eq([u.ok, u.streams.length, u.warnBytes], [true, 3, 2 * 1024 ** 3]);
    assert(u.streams.every((s) => s.messageCount === 2 && s.approxBytes > 100), '各場次估計大小');
    assert(typeof u.usage === 'number', 'navigator.storage.estimate');
    await chrome.storage.sync.set({ storageWarnBytes: 1 });
    eq((await send({ type: 'GET_STORAGE_USAGE' }, PAGE)).warn, true, '門檻調低後提醒');
    const rc = await DB.recountStream(V);
    eq(rc.messageCount, 2);
    await send({ type: 'DELETE_STREAMS', videoIds: [V, V2] }, PAGE);
    const c = await DB.countAll();
    eq([c.streams, c.messages, c.pinned_messages, c.capture_sessions], [1, 2, 1, 1]);
    eq((await DB.listStreams())[0].videoId, V3);
  });

  // ---------------------------------------------------------------- F-15
  test('F-15：全域暫停與暫停頻道（CAPTURE_START 不建 session、SAVE_MESSAGES 回 paused）', async () => {
    await resetAll();
    eq((await send({ type: 'GET_CAPTURE_POLICY', channelHandle: '@Host' })).allowed, true);
    await chrome.storage.local.set({ captureExcludedChannels: ['@host'] });
    const p = await send({ type: 'GET_CAPTURE_POLICY', channelHandle: '@Host' });
    eq([p.allowed, p.reason], [false, 'channel'], '不分大小寫');
    const cs = await send({ type: 'CAPTURE_START', videoId: V, source: 'live', stream: { channelHandle: '@HOST' } });
    eq([cs.allowed, cs.reason, cs.captureSessionId], [false, 'channel', undefined]);
    eq((await send({ type: 'CAPTURE_START', videoId: V2, source: 'live', stream: { channelHandle: '@other' } })).allowed, true, '只影響該頻道');
    await chrome.storage.sync.set({ captureEnabled: false });
    const s = await send({ type: 'SAVE_MESSAGES', videoId: V2, messages: [msg()], source: 'live' });
    eq([s.ok, s.error, s.reason], [false, 'paused', 'global']);
    await chrome.storage.sync.set({ captureEnabled: true });
    eq((await send({ type: 'SAVE_MESSAGES', videoId: V2, messages: [msg()], source: 'live' })).added, 1, '恢復後同一份存檔繼續累加');
    eq((await DB.countAll()).capture_sessions, 1);
  });

  // ---------------------------------------------------------------- background：推播、權限、頻道解析
  test('background：NEW_MESSAGES 推播只含有變動的紀錄；無效 videoId 被拒', async () => {
    await resetAll();
    const a = msg();
    await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [a], source: 'live' });
    await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [a], source: 'live' });
    const news = M.broadcasts.filter((b) => b.type === 'NEW_MESSAGES');
    eq(news.length, 1, '第二次完全相同（只更新 lastSeenAt）');
    eq(news[0].messages[0].id, a.id);
    eq((await send({ type: 'SAVE_MESSAGES', videoId: '../x', messages: [] })).ok, false);
    eq(await send({ type: 'NOT_A_TYPE' }), undefined, '未知訊息不回應');
  });

  test('F-03：og:title／og:image 解析（實體解碼、圖片白名單）', () => {
    const r = BG.parseChannelHtml('<meta content="A &amp; B &#x1F600;" property="og:title"><meta property="og:image" content="https://yt3.ggpht.com/x.jpg">');
    eq(r, { displayName: 'A & B 😀', avatar: 'https://yt3.ggpht.com/x.jpg' });
    eq(BG.parseChannelHtml('<meta property="og:title" content="X"><meta property="og:image" content="https://evil.example/x.jpg">').avatar, '');
  });

  test('F-19 FETCH_STREAM_META：watch 頁 meta 解析（開播／結束、標題、頻道；結構待實機確認）', () => {
    const html = '<meta name="title" content="測試 &amp; 直播"><span itemprop="author" itemscope itemtype="http://schema.org/Person">' +
      '<link itemprop="url" href="http://www.youtube.com/@Host%E5%8F%B0"><link itemprop="name" content="主播台"></span>' +
      '<span itemprop="publication" itemscope><meta itemprop="isLiveBroadcast" content="True">' +
      '<meta itemprop="startDate" content="2026-11-15T12:00:00+00:00"><meta itemprop="endDate" content="2026-11-15T14:00:00+00:00"></span>';
    const m = BG.parseWatchHtml(html);
    eq(m, { endedAt: Date.parse('2026-11-15T14:00:00Z'), startedAt: Date.parse('2026-11-15T12:00:00Z'), title: '測試 & 直播', isLive: false,
      channelHandle: '@Host台', channelUrl: 'https://www.youtube.com/@Host%E5%8F%B0', channelName: '主播台' });
    const future = new Date(Date.now() + 3600e3).toISOString();
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="' + future + '"><meta itemprop="isLiveBroadcast" content="True">'),
      { scheduledStartAt: Date.parse(future), isLive: true }, '待機室：預定時間');
    eq(BG.parseWatchHtml('<html></html>'), {});
  });

  test('F-19 CAPTURE_START（popout）：缺場次資訊時先抓 watch 頁，再依頻道判斷暫停；回傳開播時間', async () => {
    await resetAll();
    const urls = [];
    self.fetch = async (url) => {
      urls.push(String(url));
      return new Response('<meta name="title" content="T"><span itemprop="author"><link itemprop="url" href="http://www.youtube.com/@popHost"><link itemprop="name" content="P"></span>' +
        '<meta itemprop="startDate" content="2026-11-15T12:00:00+00:00"><meta itemprop="isLiveBroadcast" content="True">', { status: 200 });
    };
    try {
      const r = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout' });
      eq([r.ok, r.allowed, r.stream.startedAt, r.stream.channelHandle], [true, true, Date.parse('2026-11-15T12:00:00Z'), '@popHost']);
      eq(urls, ['https://www.youtube.com/watch?v=' + V]);
      const s = await DB.getStream(V);
      eq([s.title, s.channelName, s.popoutCaptureCount], ['T', 'P', 1]);
      await send({ type: 'CAPTURE_START', videoId: V, source: 'popout' });
      eq(urls.length, 1, '已有資料不重抓');
      await chrome.storage.local.set({ captureExcludedChannels: ['@pophost'] });
      eq((await send({ type: 'CAPTURE_START', videoId: V2, source: 'popout' })).reason, 'channel', '抓到頻道後才判斷暫停');
      // 直播（嵌入式）不抓
      await send({ type: 'CAPTURE_START', videoId: 'vidCCCCCCC3', source: 'live', stream: { channelHandle: '@x' } });
      eq(urls.length, 2);
    } finally {
      self.fetch = self.__blockedFetch;
    }
  });

  test('F-03／3.2：頻道解析佇列存 storage.session，失敗退避、SW 重啟後接續', async () => {
    await resetAll();
    await sleep(300); // 等前面測試排入的解析工作結束（測試期間 fetch 一律被攔截，不連外）
    BG._inflight.clear();
    await chrome.storage.session.set({ channelQueue: {} });
    const realFetch = self.fetch;
    let mode = 'fail';
    const calls = [];
    self.fetch = async (url) => {
      calls.push(url);
      if (mode === 'fail') return new Response('', { status: 503 });
      return new Response('<meta property="og:title" content="解析成功台">', { status: 200 });
    };
    try {
      await DB.putChannel({ handleOrId: '@cached', displayName: 'C', avatar: '', fetchedAt: Date.now() });
      await BG.enqueueHandles(['@retry', '@cached', 'not-a-handle']);
      await sleep(300);
      let q = await BG.readQueue();
      eq(Object.keys(q), ['@retry'], '快取有效與格式不符者不排入');
      eq(q['@retry'].attempts, 1);
      assert(q['@retry'].nextAt > Date.now(), '指數退避');
      eq(calls[0], 'https://www.youtube.com/@retry');
      // 模擬 SW 被終止後重新喚醒：記憶體狀態消失，只剩 storage.session 的佇列
      BG._inflight.clear();
      await chrome.storage.session.set({ channelQueue: { '@retry': { attempts: 1, nextAt: 0 } } });
      mode = 'ok';
      BG.kickQueue();
      await sleep(300);
      q = await BG.readQueue();
      eq(Object.keys(q), [], '佇列清空');
      eq((await DB.getChannel('@retry')).displayName, '解析成功台');
      assert(M.broadcasts.some((b) => b.type === 'CHANNEL_RESOLVED' && b.handleOrId === '@retry'), 'CHANNEL_RESOLVED 推播');
      // 多次失敗後寫入失敗紀錄，不再重試
      mode = 'fail';
      await chrome.storage.session.set({ channelQueue: { '@bad': { attempts: 5, nextAt: 0 } } });
      BG.kickQueue();
      await sleep(300);
      eq(Object.keys(await BG.readQueue()), []);
      eq((await DB.getChannel('@bad')).failed, true);
    } finally {
      self.fetch = realFetch;
    }
  });

  test('權限：管理操作只接受擴充功能頁面，content script 被拒', async () => {
    await resetAll();
    for (const type of ['DELETE_STREAMS', 'IMPORT_DATA', 'MIGRATE_LEGACY', 'EXPORT_STREAM', 'GET_STORAGE_USAGE', 'RECLASSIFY_SYSTEM']) {
      eq((await send({ type, videoIds: [V], data: {} }, CONTENT)).error, 'forbidden', type);
    }
    eq(await send({ type: 'LIST_STREAMS' }, { id: 'other-ext', url: 'chrome-extension://other/' }), undefined, '其他擴充功能不回應');
  });

  // ---------------------------------------------------------------- 舊資料庫測試資料
  function createLegacyDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(M.TEST_LEGACY, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const s = db.createObjectStore('streams', { keyPath: 'videoId' });
        s.createIndex('updatedAt', 'updatedAt');
        s.put({ videoId: V, title: '舊直播 1', channelName: '舊頻道', streamStartEpochMs: 1000, lastMessageTime: 9000, createdAt: 900, updatedAt: 9000 });
        s.put({ videoId: V2, title: '舊直播 2', createdAt: 500, updatedAt: 600 });
        const m = db.createObjectStore('messages', { keyPath: 'id' });
        m.createIndex('videoId', 'videoId'); m.createIndex('videoId_timestamp', ['videoId', 'timestamp']);
        const base = { displayTime: '下午 8:01', authorUrl: '', avatarUrl: 'https://yt3.ggpht.com/a', type: 'yt-live-chat-text-message-renderer' };
        m.put(Object.assign({}, base, { id: V + '_YTID-1', videoId: V, timestamp: 2000, videoOffsetSec: 1, authorId: '@abc', authorName: 'ABC 頻道', parts: [{ type: 'text', text: 'hi' }], plainText: 'hi' }));
        m.put(Object.assign({}, base, { id: V + '_YTID-2', videoId: V, timestamp: 3000, videoOffsetSec: 2, authorId: 'channel/UCxyz', authorName: '名字', parts: [{ type: 'text', text: 'yo' }], plainText: 'yo', amount: 'NT$75', isSuperChat: true, type: 'yt-live-chat-paid-message-renderer' }));
        m.put(Object.assign({}, base, { id: V + '_1731500000000_x1', videoId: V, timestamp: 4000, videoOffsetSec: null, authorId: 'unknown:1', authorName: '?', parts: [], plainText: '', type: 'yt-live-chat-viewer-engagement-message-renderer' }));
        m.put(Object.assign({}, base, { id: V2 + '_Z1', videoId: V2, timestamp: 5000, videoOffsetSec: 3, authorId: '@host', authorName: '@host', parts: [{ type: 'emoji', alt: ':wave:', src: 'https://yt3.ggpht.com/e' }], plainText: '', isOwner: true }));
        m.put(Object.assign({}, base, { id: V2 + '_Z2', videoId: V2, timestamp: 6000, videoOffsetSec: 4, authorId: '@raider', authorName: '@raider', parts: [{ type: 'text', text: '降落' }], plainText: '降落', isCreatorLanding: true }));
        const p = db.createObjectStore('pinned_messages', { keyPath: 'id' });
        p.createIndex('videoId', 'videoId');
        p.put({ id: V + '::@host::置頂', videoId: V, timestamp: 2500, authorId: '@host', authorName: '@host', parts: [{ type: 'text', text: '置頂' }], plainText: '置頂' });
        const c = db.createObjectStore('channels', { keyPath: 'key' });
        c.put({ key: '@abc', displayName: 'ABC 頻道', avatarUrl: 'https://yt3.ggpht.com/a', channelUrl: '', updatedAt: 1000 });
        c.put({ key: 'channel/UCxyz', displayName: '名字', avatarUrl: '', updatedAt: 1000 });
      };
      r.onsuccess = () => { r.result.close(); resolve(); };
      r.onerror = () => reject(r.error);
    });
  }

  // ---------------------------------------------------------------- 執行
  (async () => {
    const results = [];
    const list = document.getElementById('list');
    for (const t of tests) {
      const li = document.createElement('li');
      const t0 = performance.now();
      try {
        await t.fn();
        results.push({ name: t.name, ok: true });
        li.className = 'ok';
        li.textContent = '✅ ' + t.name + '（' + Math.round(performance.now() - t0) + ' ms）';
      } catch (e) {
        results.push({ name: t.name, ok: false, error: String(e && e.stack || e) });
        li.className = 'ng';
        li.textContent = '❌ ' + t.name + ' — ' + (e && e.message);
      }
      list.appendChild(li);
    }
    await resetAll();
    const pass = results.filter((r) => r.ok).length;
    document.getElementById('summary').textContent = `通過 ${pass} / ${results.length}`;
    self.__results = { pass, total: results.length, results };
  })();
})();
