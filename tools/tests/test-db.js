// T2 資料層單元測試（SPEC 第 8 節 T2）。結果顯示在頁面並存於 window.__results。
(function () {
  'use strict';
  const DB = self.YTCAS_DB;
  const U = DB.util;
  const BG = self.YTCAS_BG;
  BG._setWakeChecked(true); // SW 啟動時的斷線分頁檢查（3 秒後）會送 PING，干擾其他測試的 tabs.sent；由專屬測試個別執行
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
  async function until(fn, ms, msg) {
    const t0 = performance.now();
    while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(20); }
  }
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
    eq(db.version, self.YTCAS_CONST.DB_VERSION, '升到目前版本（v35 起為 3）');
    assert(db.objectStoreNames.contains('capture_sessions'), 'capture_sessions');
    assert(db.objectStoreNames.contains('diag_log'), 'v3：diag_log（F-20）');
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
    // T3.5：60 秒內重新整理沿用同一筆收錄紀錄（不算新的一次收錄）
    eq([streams[0].messageCount, streams[0].liveCaptureCount], [4, 1]);
    eq((await DB.countAll()).capture_sessions, 1);
  });

  test('T3.5 收錄紀錄：60 秒內重新載入沿用同一筆（endedAt 清除、reloads 累加）；超過 60 秒才算新的一次；來源不同各自一筆', async () => {
    await resetAll();
    const a = await DB.captureStart({ videoId: V, source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [msg()], source: 'live', captureSessionId: a.captureSessionId });
    await DB.captureEnd({ captureSessionId: a.captureSessionId });
    const b = await DB.captureStart({ videoId: V, source: 'live' });
    eq([b.captureSessionId, b.resumed], [a.captureSessionId, true], '重新載入沿用');
    let { sessions } = await DB.listCaptureSessions(V);
    eq([sessions.length, sessions[0].endedAt, sessions[0].reloads], [1, null, 1]);
    await DB.saveMessages({ videoId: V, messages: [msg()], source: 'live', captureSessionId: b.captureSessionId });
    await DB.captureEnd({ captureSessionId: b.captureSessionId, endedAt: Date.now() - 61000 }); // 61 秒前結束
    const c = await DB.captureStart({ videoId: V, source: 'live' });
    assert(c.captureSessionId !== a.captureSessionId && !c.resumed, '超過 60 秒 → 新的一次');
    const p = await DB.captureStart({ videoId: V, source: 'popout' });
    assert(p.captureSessionId !== c.captureSessionId, '不同來源各自一筆');
    const s = await DB.getStream(V);
    eq([s.liveCaptureCount, s.popoutCaptureCount], [2, 1]);
  });

  test('T3.5 收錄紀錄：結束時一則都沒寫入 → 刪除並扣回收錄次數（CAPTURE_END 與逾時補結束都適用）', async () => {
    await resetAll();
    const a = await DB.captureStart({ videoId: V, source: 'live' });
    const end = await DB.captureEnd({ captureSessionId: a.captureSessionId });
    eq(end.empty, true);
    eq([(await DB.countAll()).capture_sessions, (await DB.getStream(V)).liveCaptureCount], [0, 0]);
    const b = await DB.captureStart({ videoId: V, source: 'replay', duration: 600 });
    eq((await DB.getStream(V)).replayCaptureCount, 1);
    eq(await DB.closeStaleSessions(Date.now() + C_STALE() + 1000), 1, '逾時補結束');
    eq([(await DB.countAll()).capture_sessions, (await DB.getStream(V)).replayCaptureCount], [0, 0], '空的直接刪除');
    // 有寫入的保留
    const c = await DB.captureStart({ videoId: V, source: 'live' });
    await DB.saveMessages({ videoId: V, messages: [msg()], source: 'live', captureSessionId: c.captureSessionId });
    eq((await DB.captureEnd({ captureSessionId: c.captureSessionId })).empty, undefined);
    eq((await DB.countAll()).capture_sessions, 1);
    void b;
  });
  function C_STALE() { return self.YTCAS_CONST.CAPTURE_STALE_MS; }

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
      await DB.captureEnd({ captureSessionId: cs.captureSessionId, endedAt: Date.now() - 5 * 60000 }); // 隔一段時間再看（T3.5：60 秒內算同一次）
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

  test('T4.1 置頂：同一則以不同 id 再次送來 → 合併為一筆（pinnedAt 最早、pinnedLastAt 最晚、別名）；既有重複可預覽後整理', async () => {
    await resetAll();
    const pin = (id, at, o) => ({ videoId: V, message: Object.assign(msg({ id, type: 'text', runs: [{ text: '會員招募 ' }], authorHandle: '@ch', pinnedAt: at }), o || {}) });
    await DB.savePinned(pin('p1', 1000));
    await DB.savePinned(pin('p2', 5000, { authorHandle: '', authorName: 'ch' }));
    await DB.savePinned(pin('p3', 3000, { runs: [{ text: '會員招募' }] }));
    await DB.savePinned(pin('q1', 4000, { runs: [{ text: '抽獎' }] }));
    let list = await DB.queryPinned(V);
    eq(list.map((x) => x.id).sort(), ['p1', 'q1']);
    const p1 = list.find((x) => x.id === 'p1');
    eq([p1.pinnedAt, p1.pinnedLastAt], [1000, 5000]);
    assert(p1.aliasIds.includes('p2') && p1.aliasIds.includes('p3'), '別名');
    // 既有重複（T4.1 以前寫入）：直接寫進 store 模擬
    const db = await DB.open();
    const t = db.transaction('pinned_messages', 'readwrite');
    t.objectStore('pinned_messages').put(Object.assign({}, p1, { id: 'old1', aliasIds: [], pinnedAt: 500, pinnedLastAt: undefined }));
    t.objectStore('pinned_messages').put(Object.assign({}, p1, { id: 'old2', aliasIds: [], pinnedAt: 9000, pinnedLastAt: undefined, authorHandle: '' }));
    await new Promise((r) => { t.oncomplete = r; });
    const pre = await BG.dedupePinned();
    eq([pre.dryRun, pre.records, pre.groups, pre.removed], [true, 4, 1, 2]);
    assert(pre.diffFields.id === 1 && pre.diffFields.authorHandle === 1, 'diffFields：' + JSON.stringify(pre.diffFields));
    eq((await DB.queryPinned(V)).length, 4, '預覽不改資料');
    const r = await BG.dedupePinned({ dryRun: false });
    eq(r.removed, 2);
    list = await DB.queryPinned(V);
    eq(list.map((x) => x.id).sort(), ['old1', 'q1']);
    const k = list.find((x) => x.id === 'old1');
    eq([k.pinnedAt, k.pinnedLastAt], [500, 9000]);
    eq((await BG.dedupePinned()).removed, 0, '再跑一次沒有重複');
  });

  test('T4.1 頭像網域分布：只回傳 類型 × 網域 → 筆數', async () => {
    await resetAll();
    await DB.saveMessages({ videoId: V, source: 'live', messages: [msg({ authorAvatar: 'https://yt4.ggpht.com/a' }), msg({ authorAvatar: 'https://yt4.ggpht.com/b' }), msg({})] });
    const s = await BG.avatarHosts();
    eq(s.text, { 'yt4.ggpht.com': 2, '(none)': 1 });
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

  test('T3.6 F-13：既有 yt-gift-message-view-model 的 system 紀錄以 SW 的 reclassifySystem() 改為 gift（partial: true），筆數不變', async () => {
    await resetAll();
    const g = (id) => ({ id, type: 'system', rawTag: 'yt-gift-message-view-model', authorHandle: '', runs: [{ text: '禮物' }], timestampAbs: Date.now(), videoOffsetSec: null });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [g('gf1'), g('gf2'), msg()] });
    const r = await BG.reclassifySystem();
    eq([r.changed, r.byType], [2, { gift: 2 }]);
    const gifts = (await DB.queryMessages(V)).filter((m) => m.type === 'gift');
    eq(gifts.map((m) => [m.id, m.partial]), [['gf1', true], ['gf2', true]]);
    eq(await count(V), 3);
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
    // 未送 CAPTURE_END 的 session：逾時後以 lastWriteAt（無則 startedAt）補上（T3.5：一則都沒寫入的直接刪除，見另一項測試）
    await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [msg()], source: 'popout', captureSessionId: p.captureSessionId });
    const closed = await DB.closeStaleSessions(Date.now() + 10 * 60 * 1000);
    eq(closed, 1);
    const after = (await DB.listCaptureSessions(V)).sessions.find((x) => x.id === p.captureSessionId);
    assert(after.endedAt === after.lastWriteAt, '以 lastWriteAt 補 endedAt');
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
    eq(m, { startedAt: Date.parse('2026-11-15T12:00:00Z'), startedAtSource: 'meta-actual', endedAt: Date.parse('2026-11-15T14:00:00Z'),
      endedAtSource: 'meta-actual', scheduledFuture: false, title: '測試 & 直播', isLive: false,
      channelHandle: '@Host台', channelUrl: 'https://www.youtube.com/@Host%E5%8F%B0', channelName: '主播台' }, '已結束：startDate 為實際開播時間');
    const future = new Date(Math.ceil((Date.now() + 3600e3) / 60000) * 60000).toISOString();
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="' + future + '"><meta itemprop="isLiveBroadcast" content="True">'),
      { scheduledStartAt: Date.parse(future), scheduledFuture: true, isLive: true }, '待機室：預定時間（v47 scheduledFuture）');
    eq(BG.parseWatchHtml('<html></html>'), {});
    // T3.6（追加五 E-2）：預定時間已過、整分、與已知預定相同 → startPending（不得寫入 startedAt）
    const sch = '2026-11-16T11:15:00Z';
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="' + sch + '">', Date.parse(sch)), { scheduledStartAt: Date.parse(sch), startPending: true, scheduledFuture: false });
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="' + sch + '">'), { scheduledStartAt: Date.parse(sch), startPending: true, scheduledFuture: false }, '不知道預定時間時，整分也視為未確認');
    // 重新取得頁面後為實際開播時間（有秒數）
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="2026-11-16T11:24:38Z">', Date.parse(sch)),
      { startedAt: Date.parse('2026-11-16T11:24:38Z'), startedAtSource: 'meta-actual', scheduledFuture: false });
    // 剛好整分開播但與已知預定不同 → 實際
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="2026-11-16T11:25:00Z">', Date.parse(sch)).startedAtSource, 'meta-actual');
  });

  test('F-19 CAPTURE_START（popout）：缺場次資訊時先抓 watch 頁，再依頻道判斷暫停；回傳開播時間', async () => {
    await resetAll();
    const urls = [];
    self.fetch = async (url) => {
      urls.push(String(url));
      return new Response('<meta name="title" content="T"><span itemprop="author"><link itemprop="url" href="http://www.youtube.com/@popHost"><link itemprop="name" content="P"></span>' +
        '<meta itemprop="startDate" content="2026-11-15T12:00:07+00:00"><meta itemprop="isLiveBroadcast" content="True">', { status: 200 });
    };
    try {
      const r = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout' });
      eq([r.ok, r.allowed, r.stream.startedAt, r.stream.channelHandle], [true, true, Date.parse('2026-11-15T12:00:07Z'), '@popHost'], '實際開播時間（有秒數）');
      eq(urls, ['https://www.youtube.com/watch?v=' + V]);
      const s = await DB.getStream(V);
      eq([s.title, s.channelName, s.popoutCaptureCount], ['T', 'P', 1]);
      await send({ type: 'CAPTURE_START', videoId: V, source: 'popout' });
      eq(urls.length, 1, '已有資料不重抓');
      await chrome.storage.local.set({ captureExcludedChannels: ['@pophost'] });
      eq((await send({ type: 'CAPTURE_START', videoId: V2, source: 'popout' })).reason, 'channel', '抓到頻道後才判斷暫停');
      // 直播（嵌入式）有標題：不抓
      await send({ type: 'CAPTURE_START', videoId: 'vidCCCCCCC3', source: 'live', stream: { channelHandle: '@x', title: '有標題' } });
      await sleep(100);
      eq(urls.length, 2);
      // v52（33.1 第 3 點）直播沒有標題（導航後 microdata 還是上一場的，top 不送）→ 背景抓 watch 頁補標題（不阻擋收錄）
      await send({ type: 'CAPTURE_START', videoId: 'vidDDDDDDD4', source: 'live', stream: { channelHandle: '@x' } });
      await until(async () => (await DB.getStream('vidDDDDDDD4') || {}).title === 'T', 2000, '補上標題');
      eq(urls.slice(-1), ['https://www.youtube.com/watch?v=vidDDDDDDD4']);
    } finally {
      self.fetch = self.__blockedFetch;
    }
  });

  test('F-19 自動接手（v30）：彈出視窗分頁關閉（tabs.onRemoved）→ 補上結束時間並通知同一 videoId 的主分頁', async () => {
    await resetAll();
    const POP = (tabId) => ({ id: 'testextid', url: 'https://www.youtube.com/live_chat?is_popout=1&v=' + V, tab: { id: tabId } });
    chrome.tabs._tabs = [{ id: 3, url: 'https://www.youtube.com/watch?v=' + V }, { id: 4, url: 'https://www.youtube.com/watch?v=' + V2 }];
    chrome.tabs.sent.length = 0;
    try {
      const r = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout', stream: { channelHandle: '@x' } }, POP(7));
      const ent = (await BG.readPopout())[7];
      eq([ent.videoId, ent.sid, ent.notified, typeof ent.gen], [V, r.captureSessionId, false, 'string'], '記下分頁（storage.session）');
      await send({ type: 'SAVE_MESSAGES', videoId: V, messages: [msg()], source: 'popout', captureSessionId: r.captureSessionId }, POP(7)); // 有寫入才保留紀錄（T3.5）
      for (const f of M.listeners.removed) f(7);
      await sleep(200);
      eq(chrome.tabs.sent.map((s) => [s.tabId, s.msg.type, s.msg.source, s.msg.videoId]), [[3, 'CAPTURE_END', 'popout', V]], '只通知同一 videoId 的主分頁');
      const { sessions } = await DB.listCaptureSessions(V);
      assert(sessions.find((s) => s.id === r.captureSessionId).endedAt != null, '補上 endedAt');
      eq(await BG.readPopout(), {}, '對照表移除');
      // 一般分頁關閉不影響
      for (const f of M.listeners.removed) f(99);
      await sleep(100);
      eq(chrome.tabs.sent.length, 1);
      // 設定關閉時不通知
      await chrome.storage.sync.set({ popoutHandoff: false });
      await send({ type: 'CAPTURE_START', videoId: V, source: 'popout', stream: { channelHandle: '@x' } }, POP(9));
      await BG.onPopoutTabRemoved(9);
      eq(chrome.tabs.sent.length, 1, 'popoutHandoff=false');
    } finally { chrome.tabs._tabs = []; }
  });

  test('F-19 自動接手（v30）：pagehide 的 CAPTURE_END 等 3 秒；期間重新整理（同分頁重新開始）不接手；之後關閉分頁不重複通知', async () => {
    await resetAll();
    const POP = { id: 'testextid', url: 'https://www.youtube.com/live_chat?is_popout=1&v=' + V, tab: { id: 8 } };
    chrome.tabs._tabs = [{ id: 3, url: 'https://www.youtube.com/watch?v=' + V }];
    chrome.tabs.sent.length = 0;
    try {
      let r = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout', stream: { channelHandle: '@x' } }, POP);
      await send({ type: 'CAPTURE_END', captureSessionId: r.captureSessionId, source: 'popout' }, POP);
      r = await send({ type: 'CAPTURE_START', videoId: V, source: 'popout', stream: { channelHandle: '@x' } }, POP); // 重新整理
      await sleep(C_GRACE() + 300);
      eq(chrome.tabs.sent.length, 0, '重新整理不接手');
      await send({ type: 'CAPTURE_END', captureSessionId: r.captureSessionId, source: 'popout' }, POP);
      await sleep(C_GRACE() + 300);
      eq(chrome.tabs.sent.length, 1, 'pagehide 後接手一次');
      await BG.onPopoutTabRemoved(8);
      eq(chrome.tabs.sent.length, 1, '分頁關閉不重複通知');
    } finally { chrome.tabs._tabs = []; }
  });
  function C_GRACE() { return self.YTCAS_CONST.POPOUT_RELOAD_GRACE_MS; }

  test('T3.4 cleanupJunkSystem：預覽只回筆數；刪除只動 T3 後收錄的子元件 system 紀錄，遷移／舊紀錄／真訊息不動，messageCount 更新', async () => {
    await resetAll();
    // T3.6：子元件垃圾只清 T3 部署～T3.4 部署之間首次收錄的（WIN）；T3.4 之後收錄的 system 都是真訊息
    const WIN = Date.parse('2026-11-16T00:30:00+08:00');
    const sys = (id, tag, fs) => ({ id, type: 'system', rawTag: tag, authorHandle: '', runs: [{ text: 'x' }], timestampAbs: fs || Date.now(), videoOffsetSec: null, firstSeenAt: fs || WIN });
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [
      sys('j1', 'yt-icon'), sys('j2', 'span'), sys('j3', 'yt-live-chat-author-badge-renderer'),
      sys('k1', 'yt-live-chat-viewer-engagement-message-renderer'), sys('k2', 'yt-live-chat-something-new-renderer'),
      sys('k7', 'yt-gift-message-view-model'), // 禮物：白名單，不得刪除
    ] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [msg({ id: 'k3' })] });
    await DB.saveMessages({ videoId: V, source: 'legacy', preserve: true, messages: [sys('k4', 'span')] });
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [sys('k5', 'span', Date.parse('2026-11-14T00:00:00Z'))] });
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [sys('k6', 'span', Date.parse('2026-11-16T02:00:00+08:00'))] }); // T3.4 之後
    eq((await DB.getStream(V)).messageCount, 10);
    eq([BG.isJunkTag('yt-gift-message-view-model'), BG.isJunkTag('yt-live-chat-viewer-engagement-message-renderer')], [false, false], '白名單優先');
    eq([BG.isJunkTag('div'), BG.isJunkTag('yt-live-chat-author-chip'), BG.isJunkTag('yt-live-chat-paid-message-renderer'), BG.isJunkTag('ytd-sponsorships-live-chat-gift-redemption-announcement-renderer')],
      [true, true, false, false]);
    // T3.5 規則式：-view-model、-button-、-badge-renderer、-chip；真訊息元件（*-renderer）都不受影響
    eq(['yt-live-chat-reply-button-view-model', 'yt-live-chat-like-button-view-model', 'yt-live-chat-foo-view-model',
      'yt-live-chat-icon-toggle-button-renderer', 'yt-live-chat-new-badge-renderer', 'yt-live-chat-some-chip'].map(BG.isJunkTag), [true, true, true, true, true, true]);
    eq(Object.keys(self.YTCAS_SEL.messageTypeByTag).concat(['yt-live-chat-viewer-engagement-message-renderer', 'yt-live-chat-placeholder-item-renderer',
      'yt-live-chat-ticker-sponsor-item-renderer']).filter(BG.isJunkTag), [], '訊息元件不得被判為子元件');
    const pre = await BG.cleanupJunkSystem();
    eq([pre.dryRun, pre.matched, pre.streams, pre.deleted], [true, 3, 1, 0], '未指定時為預覽');
    eq(pre.byTag, { 'yt-icon': 1, span: 1, 'yt-live-chat-author-badge-renderer': 1 });
    // T3.5 B-2：保留的 system 也列出（含不在範圍內的遷移／舊紀錄），合計 = scanned
    eq(pre.keptByTag, { 'yt-live-chat-viewer-engagement-message-renderer': 1, 'yt-live-chat-something-new-renderer': 1, span: 3, 'yt-gift-message-view-model': 1 });
    eq(pre.matched + Object.values(pre.keptByTag).reduce((a, b) => a + b, 0), pre.scanned);
    eq((await DB.queryMessages(V)).length, 10, '預覽不刪');
    const r = await BG.cleanupJunkSystem({ dryRun: false });
    eq([r.matched, r.deleted], [3, 3]);
    const veK1 = self.YTCAS_CONST.viewerEngagementId(V, [{ text: 'x' }]); // T3.5：k1 改用內容 id
    eq((await DB.queryMessages(V)).map((m) => m.id).sort(), [veK1, 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].sort());
    eq((await DB.getStream(V)).messageCount, 7, 'messageCount 重算');
    eq((await BG.cleanupJunkSystem({ dryRun: false })).deleted, 0, '可重複執行');
  });

  test('T3.5 viewer-engagement 重複：同一場同內容保留最早一筆並改用內容 id；之後收錄的同內容以 id 合併；遷移紀錄不動', async () => {
    await resetAll();
    const VE = 'yt-live-chat-viewer-engagement-message-renderer';
    const ve = (id, text, t) => ({ id, type: 'system', rawTag: VE, authorHandle: '', runs: [{ text }], timestampAbs: t, videoOffsetSec: null });
    const now = Date.now();
    // 每次重新整理一筆（id 都不同）：同內容 3 筆、不同內容 1 筆，另一場 1 筆
    await DB.saveMessages({ videoId: V, source: 'live', messages: [ve('ve-a1', '歡迎來到聊天室', now - 3000)] });
    await sleep(5);
    await DB.saveMessages({ videoId: V, source: 'live', messages: [ve('ve-a2', '歡迎來到聊天室', now - 2000), ve('ve-b1', '請遵守守則', now - 2000)] });
    await sleep(5);
    await DB.saveMessages({ videoId: V, source: 'live', messages: [ve('ve-a3', '歡迎來到聊天室', now - 1000)] });
    await DB.saveMessages({ videoId: V2, source: 'live', messages: [ve('ve-c1', '歡迎來到聊天室', now)] });
    await DB.saveMessages({ videoId: V, source: 'legacy', preserve: true, messages: [ve('ve-old1', '歡迎來到聊天室', now - 9000)] });
    const pre = await BG.cleanupJunkSystem();
    eq([pre.veGroups, pre.veDuplicates, pre.veMerged], [3, 2, 0], '預覽：3 組需處理（含只需改 id 的）、2 筆重複');
    const r = await BG.cleanupJunkSystem({ dryRun: false });
    eq([r.veMerged, r.veRekeyed], [2, 3]);
    const C = self.YTCAS_CONST;
    const idA = C.viewerEngagementId(V, [{ text: '歡迎來到聊天室' }]);
    const list = (await DB.queryMessages(V)).filter((m) => m.rawTag === VE);
    eq(list.map((m) => m.id).sort(), [idA, C.viewerEngagementId(V, [{ text: '請遵守守則' }]), 've-old1'].sort(), '每組一筆；遷移紀錄不動');
    const kept = list.find((m) => m.id === idA);
    assert(kept.aliasIds.includes('ve-a1'), '保留最早一筆（原 id 記入別名）');
    eq((await DB.getStream(V)).messageCount, 3);
    // 之後收錄（capture.js 以同一函式產生 id）→ 以 id 合併，不再新增
    const r2 = await DB.saveMessages({ videoId: V, source: 'live', messages: [ve(idA, '歡迎來到聊天室', now + 1000)] });
    eq([r2.added, (await DB.getStream(V)).messageCount], [0, 3]);
    eq((await BG.cleanupJunkSystem({ dryRun: false })).veMerged, 0, '可重複執行');
  });

  test('T3.6 fieldStats：各類型欄位完整度（含 SC 顏色、phase）只回傳筆數；遷移紀錄與 since 之前不計', async () => {
    await resetAll();
    await DB.saveMessages({ videoId: V, source: 'live', messages: [
      msg({ id: 'f1', authorAvatar: 'https://yt4.ggpht.com/a', authorBadges: ['member'], runs: [{ text: 'a' }, { emoji: { alt: ':x:', src: 'https://yt3.ggpht.com/e' } }] }),
      msg({ id: 'f2', videoOffsetSec: null, phase: 'pre' }),
      msg({ id: 'f3', type: 'superchat', amount: 'NT$75.00', color: 'rgba(30,136,229,1)' }),
      msg({ id: 'f4', type: 'superchat', amount: 'NT$30.00' }),
    ] });
    await DB.saveMessages({ videoId: V, source: 'legacy', preserve: true, messages: [msg({ id: 'f5' })] });
    const s = await BG.fieldStats();
    eq(Object.keys(s).sort(), ['superchat', 'text']);
    eq([s.text.n, s.text.author, s.text.avatar, s.text.offset, s.text.badges, s.text.emoji, s.text.pre, s.text.live], [2, 2, 1, 1, 1, 1, 1, 1]);
    eq([s.superchat.n, s.superchat.amount, s.superchat.color], [2, 2, 1], 'SC 顏色');
    eq(JSON.stringify(s).includes('NT$'), false, '不含內容');
    eq(Object.keys(await BG.fieldStats({ since: Date.now() + 60000 })).length, 0, 'since 之後才計');
  });

  // ---------------------------------------------------------------- T3.6 開播／結束判斷（審查十追加五 E、E-3）
  const MIN = 60000;
  const baseMin = () => Math.floor(Date.now() / MIN) * MIN;

  test('T3.6 startedAt 來源等級：高者覆蓋低者並重算既有訊息的 phase／offset；scheduled 不得寫入；低者不覆蓋；重播精確值不動', async () => {
    await resetAll();
    const sch = baseMin() - 30 * MIN, act = sch + 10 * MIN;
    // 舊版行為：以預定時間寫入 startedAt（來源不明 = signal 等級）
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: sch, scheduledStartAt: sch }, messages: [
      msg({ id: 'p1', timestampAbs: sch + 5 * MIN, videoOffsetSec: 300, phase: 'live' }),
      msg({ id: 'p2', timestampAbs: act + 5 * MIN, videoOffsetSec: 900, phase: 'live' }),
    ] });
    await DB.saveMessages({ videoId: V, source: 'replay', messages: [msg({ id: 'p3', timestampAbs: act + 6 * MIN, videoOffsetSec: 361 })] });
    let s = await DB.getStream(V);
    eq([s.startedAt, s.startedAtSource ?? null], [sch, null]);
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: act - MIN, startedAtSource: 'scheduled' }, messages: [] });
    eq((await DB.getStream(V)).startedAt, sch, 'scheduled 不得寫入');
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: act - MIN, startedAtSource: 'signal' }, messages: [] });
    eq((await DB.getStream(V)).startedAt, sch, '同等級不覆蓋');
    const r = await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: act, startedAtSource: 'meta-actual' }, messages: [] });
    eq([r.stream.startedAt, r.stream.startedAtSource, r.stream.startPending], [act, 'meta-actual', false], '回應帶回確認的時間');
    const by = Object.fromEntries((await DB.queryMessages(V)).map((m) => [m.id, [m.phase, m.videoOffsetSec, m.offsetSource]]));
    eq(by.p1, ['pre', -300, 'estimated'], '延後開播：預定～實際之間為 pre、負 offset');
    eq(by.p2, ['live', 300, 'estimated'], '開播後以實際時間為零點');
    eq(by.p3, ['live', 361, 'replay'], '重播精確值不動');
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: act + MIN, startedAtSource: 'signal' }, messages: [] });
    eq((await DB.getStream(V)).startedAt, act, '低等級不覆蓋 meta-actual');
  });

  test('T3.6 AC（追加五 E 第 4 點）：預定 X、實際 X+10 分（模擬）→ 等待期訊息 pre／offset 空；重新抓取 meta 確認後重算；輪詢間隔與結束偵測', async () => {
    await resetAll();
    const sch = baseMin() - 30 * MIN, act = sch + 10 * MIN;
    const cs = await send({ type: 'CAPTURE_START', videoId: V, source: 'live', stream: { channelHandle: '@h', isLive: true, scheduledStartAt: sch, startPending: true } });
    let r = await send({ type: 'SAVE_MESSAGES', videoId: V, source: 'live', captureSessionId: cs.captureSessionId,
      stream: { scheduledStartAt: sch, startPending: true, isLive: true },
      messages: [msg({ id: 'w1', timestampAbs: sch + 5 * MIN, videoOffsetSec: null, phase: 'pre' }), msg({ id: 'w2', timestampAbs: act + 5 * MIN, videoOffsetSec: null, phase: 'pre' })] });
    eq([r.stream.startedAt, r.stream.startPending], [null, true], '不得以預定時間寫入 startedAt');
    await sleep(100); // SAVE_MESSAGES 在背景觸發的重新抓取（測試頁攔截 → 失敗）先結束，避免下面共用同一個進行中的請求
    const urls = [];
    let html = '<meta itemprop="startDate" content="' + new Date(act).toISOString() + '"><meta itemprop="isLiveBroadcast" content="True">';
    self.fetch = async (u) => { urls.push(String(u)); return new Response(html, { status: 200 }); };
    try {
      BG._metaPoll.clear();
      const got = await BG.maybeRefetchMeta(V, r.stream, 'live');
      eq([got.startedAt, got.startedAtSource], [act, 'meta-actual'], '實際開播時間（整分但與預定不同）');
      const by = Object.fromEntries((await DB.queryMessages(V)).map((m) => [m.id, [m.phase, m.videoOffsetSec]]));
      eq([by.w1, by.w2], [['pre', -300], ['live', 300]], '已存訊息重算');
      eq(await BG.maybeRefetchMeta(V, got, 'live'), null, '直播中每 5 分鐘一次：剛抓過不抓');
      eq(await BG.maybeRefetchMeta(V, Object.assign({}, got, { startedAt: null, startPending: true }), 'replay'), null, '重播不抓');
      // 5 分鐘後：endDate 出現 → 結束時間
      BG._metaPoll.get(V).lastAt -= 5 * MIN + 1000;
      const end = act + 60 * MIN;
      html = '<meta itemprop="startDate" content="' + new Date(act).toISOString() + '"><meta itemprop="endDate" content="' + new Date(end).toISOString() + '">';
      const got2 = await BG.maybeRefetchMeta(V, got, 'live');
      eq([got2.endedAt, got2.endedAtSource], [end, 'meta-actual']);
      // 只看 watch 頁（同期間的頻道名稱解析也會呼叫 fetch，這裡不計）
      eq(urls.filter((u) => u.includes('/watch?v=')).map((u) => u.replace('https://www.youtube.com/watch?v=', '')), [V, V]);
      eq(BG._metaPoll.has(V), false, '確認結束後停止');
    } finally { self.fetch = self.__blockedFetch; }
  });

  test('T3.6 recomputeStream：預覽只回筆數不寫入；執行後 startedAt 改為指定值（不受來源等級限制）並重算 phase／offset', async () => {
    await resetAll();
    const sch = baseMin() - 30 * MIN, act = sch + 9 * MIN + 38000; // 例：3LKGU…（預定 19:15、實際 19:24:38）
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: sch, startedAtSource: 'meta-actual' }, messages: [
      msg({ id: 'q1', timestampAbs: sch + 5 * MIN }), msg({ id: 'q2', timestampAbs: act + 60000 }), msg({ id: 'q3', timestampAbs: act + 120000 }) ] });
    await DB.saveMessages({ videoId: V, source: 'replay', messages: [msg({ id: 'q4', timestampAbs: act + 180000, videoOffsetSec: 180 })] });
    eq((await BG.recomputeStream(V, { startedAt: act })).dryRun, true);
    const pre = await BG.recomputeStream(V, { startedAt: act });
    eq([pre.messages, pre.changed, pre.offsetChanged], [4, 3, 3]);
    eq([pre.before.phases, pre.after.phases], [{ live: 4 }, { pre: 1, live: 3 }]);
    eq((await DB.getStream(V)).startedAt, sch, '預覽不寫入');
    const r = await BG.recomputeStream(V, { startedAt: act, dryRun: false });
    eq([r.updated, (await DB.getStream(V)).startedAt, (await DB.getStream(V)).startedAtSource], [3, act, 'meta-actual']);
    const by = Object.fromEntries((await DB.queryMessages(V)).map((m) => [m.id, [m.phase, m.videoOffsetSec]]));
    eq([by.q1, by.q2, by.q3, by.q4], [['pre', -278], ['live', 60], ['live', 120], ['live', 180]]);
    eq((await BG.recomputeStream('vidNONE0001', { startedAt: act })).error, 'no-stream');
  });

  test('T3.7 A-2：重新抓取 watch 頁先 credentials omit；取不到時間 meta 才以 include 重試一次', async () => {
    await resetAll();
    const calls = [];
    const withMeta = '<meta itemprop="startDate" content="2026-11-16T11:24:38Z"><meta name="title" content="T">';
    let omitHtml = withMeta;
    self.fetch = async (u, o) => {
      if (!String(u).includes('/watch?v=')) return new Response('', { status: 404 });
      calls.push(o && o.credentials);
      return new Response(o && o.credentials === 'include' ? withMeta : omitHtml, { status: 200 });
    };
    try {
      let m = await BG.fetchStreamMeta(V);
      eq([calls, m.startedAtSource, m.credentialsUsed], [['omit'], 'meta-actual', undefined], '取得 meta → 不重試');
      calls.length = 0;
      omitHtml = '<html>未登入看不到</html>';
      m = await BG.fetchStreamMeta(V);
      eq([calls, m.startedAtSource, m.credentialsUsed], [['omit', 'include'], 'meta-actual', 'include'], '取不到 → include 重試一次');
      calls.length = 0;
      self.fetch = async (u, o) => { calls.push(o && o.credentials); return new Response('<html></html>', { status: 200 }); };
      m = await BG.fetchStreamMeta(V);
      eq([calls.length, Object.keys(m).length], [2, 0], '兩次都沒有 → 回傳空結果，不再重試');
    } finally { self.fetch = self.__blockedFetch; }
  });

  test('T3.7 A-1：chrome.alarms 每 1 分鐘檢查「有分頁開著」的場次（沒有新訊息也能確認開播）；沒開分頁的場次不抓', async () => {
    await resetAll();
    const sch = baseMin() - 30 * MIN, act = sch + 7 * MIN;
    await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: sch, startPending: true, isLive: true }, messages: [] });
    await DB.saveMessages({ videoId: V2, source: 'live', stream: { scheduledStartAt: sch, startPending: true, isLive: true }, messages: [] });
    eq(!!chrome.alarms._list.get('ytcas-meta-poll'), true, '啟動時建立排程');
    const urls = [];
    self.fetch = async (u) => { urls.push(String(u)); return new Response('<meta itemprop="startDate" content="' + new Date(act).toISOString() + '">', { status: 200 }); };
    chrome.tabs._tabs = [{ id: 3, url: 'https://www.youtube.com/watch?v=' + V }, { id: 4, url: 'https://www.youtube.com/live_chat?is_popout=1&v=vidCCCCCCC3' }];
    try {
      BG._metaPoll.clear();
      M.fireAlarm('ytcas-meta-poll');
      await until(async () => (await DB.getStream(V)).startedAt === act, 2000);
      eq((await DB.getStream(V)).startedAtSource, 'meta-actual');
      eq((await DB.getStream(V2)).startedAt, null, '沒有分頁開著 → 不抓');
      eq(urls.filter((u) => u.includes('/watch?v=')).map((u) => u.split('v=')[1]), [V]);
    } finally { self.fetch = self.__blockedFetch; chrome.tabs._tabs = []; }
  });

  test('T3.6 等待開播確認的輪詢：每 60 秒一次、超過 3 小時停止', async () => {
    await resetAll();
    const sch = baseMin() - 30 * MIN;
    const times = { startedAt: null, scheduledStartAt: sch, startPending: true, endedAt: null, isLive: true };
    let n = 0;
    self.fetch = async (u) => { if (String(u).includes('/watch?v=')) n++; return new Response('<meta itemprop="startDate" content="' + new Date(sch).toISOString() + '">', { status: 200 }); };
    try {
      BG._metaPoll.clear();
      await BG.maybeRefetchMeta(V, times, 'live');
      await BG.maybeRefetchMeta(V, times, 'live');
      eq(n, 1, '60 秒內只抓一次');
      BG._metaPoll.get(V).lastAt -= 61000;
      await BG.maybeRefetchMeta(V, times, 'popout');
      eq(n, 2, '彈出視窗也適用');
      eq((await DB.getStream(V)).startedAt, null, 'startDate 仍是預定時間 → 維持 startPending');
      // T3.7：3 小時上限以預定開播時間起算（SW 重新啟動也不會重新計算）
      BG._metaPoll.get(V).lastAt -= 61000;
      await BG.maybeRefetchMeta(V, Object.assign({}, times, { scheduledStartAt: Date.now() - 3 * 3600e3 - MIN }), 'live');
      eq(n, 2, '預定開播已超過 3 小時 → 停止');
      // 不知道預定時間時，以第一次檢查起算
      BG._metaPoll.get(V).firstAt -= 3 * 3600e3 + 1000;
      await BG.maybeRefetchMeta(V, Object.assign({}, times, { scheduledStartAt: null }), 'live');
      eq(n, 2, '第一次檢查起超過 3 小時 → 停止');
    } finally { self.fetch = self.__blockedFetch; }
  });

  // ---------------------------------------------------------------- F-20 診斷記錄模式（T3.7）
  test('F-20：開始 → REC 標記與排程；content 紀錄消毒後寫入（文字、handle、網址被去除）；未勾選的探針不收；停止後不再寫入；匯出與摘要', async () => {
    await resetAll();
    await BG.diag.clear();
    const st = await BG.diag.start({ probes: ['P1', 'P2', 'P8'], hours: 2 });
    eq([st.active, st.probes, chrome.action._badge.text], [true, ['P1', 'P2', 'P8'], 'REC']);
    assert(chrome.alarms._list.get('ytcas-diag-stop').when === st.endsAt && st.endsAt - st.startAt === 2 * 3600e3, '時限排程');
    const r = await send({ type: 'DIAG_LOG', records: [
      { probe: 'P1', kind: 'stats', ctx: { env: 'chatframe', videoId: V }, data: { captured: 10, mode: 'capturing', text: '這是一則聊天內容', who: '@someone', avatar: 'https://yt4.ggpht.com/abc=s64', tags: { 'yt-live-chat-text-message-renderer': 3 } } },
      { probe: 'P3', kind: 'stream-info', data: { x: 1 } }, // 未勾選
      { probe: 'P8', kind: 'warn', data: { message: '錯誤 at https://www.youtube.com/live_chat?continuation=SECRET @handle' } },
    ] });
    eq([r.ok, r.accepted], [true, 2]);
    await BG.diag.flush();
    let ex = await BG.diag.export();
    const recs = ex.records.filter((x) => x.kind !== 'diag-start');
    eq(recs.map((x) => x.probe), ['P1', 'P8']);
    eq(recs[0].data, { captured: 10, mode: 'capturing', text: '[removed]', who: '[removed]', avatar: 'yt4.ggpht.com', tags: { 'yt-live-chat-text-message-renderer': 3 } });
    eq([recs[0].ctx.videoId, recs[0].ctx.tab], [V, 1]);
    assert(!JSON.stringify(recs[1]).includes('SECRET') && !JSON.stringify(recs[1]).includes('@handle'), 'P8 去除網址參數與 handle');
    eq([ex.format, ex.formatVersion, ex.probes, typeof ex.version], ['ytcas-diag', 1, ['P1', 'P2', 'P8'], 'string']);
    const sum = await BG.diag.summary(200);
    assert(sum.split('\n').length >= 3 && !sum.includes('聊天內容'), '摘要');
    const stop = await BG.diag.stop();
    eq([stop.active, stop.reason, chrome.action._badge.text, chrome.alarms._list.has('ytcas-diag-stop')], [false, 'manual', '', false]);
    const r2 = await send({ type: 'DIAG_LOG', records: [{ probe: 'P1', kind: 'stats', data: {} }] });
    eq([r2.accepted, r2.active], [0, false], '停止後不再寫入');
    const dl = await BG.diag.download();
    // v45（20.6）預設格式 ytcas-diag-{yy}_{MM}_{dd}_{HH}_{mm}（記錄開始時間）
    assert(/^YT聊天室診斷\/ytcas-diag-\d\d_\d\d_\d\d_\d\d_\d\d\.json$/.test(dl.filename) && chrome.downloads._list.length >= 1, '下載到 YT聊天室診斷 資料夾 ' + dl.filename);
    eq(chrome.downloads._list[chrome.downloads._list.length - 1].url.startsWith('data:application/json;base64,'), true);
  });

  test('T3.8 B-1：P8 只保留 ASCII（中日韓文字換成 […]）；warnOnce 只記 key＋等級＋預先定義的說明，任意說明文字被去除', async () => {
    await resetAll();
    await BG.diag.clear();
    await BG.diag.start({ probes: ['P8'] });
    try {
      await send({ type: 'DIAG_LOG', records: [
        { probe: 'P8', kind: 'error', data: { message: 'TypeError: x is null（聊天內容：哈囉大家）' } },
        { probe: 'P8', kind: 'warnOnce', data: { key: 'F-12:failed:not-selected', level: 'warn', desc: self.YTCAS_CONST.diagWarnText('F-12:failed:not-selected') } },
        { probe: 'P8', kind: 'warnOnce', data: { key: 'chat.items', level: 'warn', desc: '某人說了什麼' } },
      ] });
      self.YTCAS_SEL.warnOnce('chat.items:bgtest', 'detail 不應被記錄', 'warn'); // background 的 warnOnce 也經 onWarn 記錄
      await BG.diag.flush();
      const recs = (await DB.diagAll()).filter((x) => x.probe === 'P8' && x.kind !== 'diag-start');
      eq(recs[0].data.message, 'TypeError: x is null[…]');
      eq([recs[1].data.key, recs[1].data.desc], ['F-12:failed:not-selected', '無法自動切換到「即時聊天室」'], '預先定義的說明保留');
      eq(recs[2].data.desc, '[removed]', '執行期字串被去除');
      const bgw = recs.find((x) => x.data.key === 'chat.items:bgtest');
      eq([bgw.kind, bgw.data.level, JSON.stringify(bgw).includes('detail')], ['warnOnce', 'warn', false]);
      eq(self.YTCAS_CONST.diagWarnText('poc:anchor:header'), 'PoC 錨點或結構找不到', '前綴比對');
    } finally { await BG.diag.stop(); }
  });

  test('T4.2 F-20 P9 記憶體：數字與狀態字串保留、分頁 id 由 background 補上；未選 P9 時不記錄', async () => {
    await resetAll();
    await BG.diag.clear();
    await BG.diag.start({ probes: ['P9'] });
    try {
      const d = { usedJSHeapMB: 85.3, totalJSHeapMB: 120.1, heapLimitMB: 4096, domNodes: 912, hidden: false, itemsNodes: 45, queue: 0, observers: 2, mode: 'capturing' };
      await send({ type: 'DIAG_LOG', records: [
        { probe: 'P9', kind: 'memory', ctx: { env: 'chatframe', source: 'live', videoId: 'vidAAAAAAA1' }, data: d },
        { probe: 'P1', kind: 'stats', data: { captured: 1 } },
      ] });
      await BG.diag.flush();
      const recs = (await DB.diagAll()).filter((x) => x.kind !== 'diag-start');
      eq(recs.map((x) => x.probe), ['P9']);
      eq(recs[0].data, d);
      eq([recs[0].ctx.env, recs[0].ctx.tab], ['chatframe', 1]);
    } finally { await BG.diag.stop(); }
    eq(self.YTCAS_CONST.DIAG.PROBES.includes('P9'), true);
  });

  test('T5.3 F-20 P9（審查十一 18.4）：取樣間隔可設定（1～30 分鐘，未指定 5）；面板 viewer（嵌入 iframe）送來的 P9 被接受並補上分頁 id', async () => {
    await resetAll();
    await BG.diag.clear();
    eq((await BG.diag.start({ probes: ['P9'] })).p9Minutes, 5, '未指定');
    await BG.diag.stop();
    eq((await BG.diag.start({ probes: ['P9'], p9Minutes: 99 })).p9Minutes, 30, '上限');
    await BG.diag.stop();
    const st = await BG.diag.start({ probes: ['P9'], p9Minutes: 1 });
    eq(st.p9Minutes, 1);
    try {
      const PANEL = { id: 'testextid', url: 'chrome-extension://dynamic-id/src/viewer.html?embed=1&v=vidAAAAAAA1', tab: { id: 9, index: 0, windowId: 1 } };
      const d = { usedJSHeapMB: 40.2, totalJSHeapMB: 60, heapLimitMB: 4096, domNodes: 640, items: 8898, entries: 8898, rendered: 31, avatars: 1200, hidden: false, hostPaused: false, mode: 'tail' };
      eq((await send({ type: 'DIAG_LOG', records: [{ probe: 'P9', kind: 'memory', ctx: { env: 'panel', videoId: 'vidAAAAAAA1' }, data: d }] }, PANEL)).accepted, 1);
      await BG.diag.flush();
      const recs = (await DB.diagAll()).filter((x) => x.probe === 'P9');
      eq(recs[0].data, d);
      eq([recs[0].ctx.env, recs[0].ctx.tab], ['panel', 9]);
      eq((await BG.diag.export()).p9Minutes, 1, '匯出檔記下間隔（報告用）');
    } finally { await BG.diag.stop(); }
  });

  test('T3.8 C-1／T3.9 B-1：擴充功能更新或首次安裝（onInstalled: update／install）→ 對所有 YouTube 分頁的所有 frame 重新注入 content script；非 YouTube 分頁與卸載分頁不注入；失敗分頁回報', async () => {
    await resetAll();
    chrome.scripting._calls.length = 0;
    chrome.scripting._fail = new Set([12]);
    chrome.tabs._tabs = [
      { id: 10, url: 'https://www.youtube.com/watch?v=' + V },
      { id: 11, url: 'https://www.youtube.com/live_chat?is_popout=1&v=' + V },
      { id: 12, url: 'https://www.youtube.com/' },
      { id: 13, url: 'https://example.com/' },
      { id: 14, url: 'https://www.youtube.com/watch?v=' + V2, discarded: true },
    ];
    try {
      for (const f of M.listeners.installed) f({ reason: 'install' });
      await until(() => chrome.scripting._calls.length === 3, 2000);
      eq(chrome.scripting._calls.map((c) => c.target.tabId), [10, 11, 12], '首次安裝：安裝前就開著的分頁也注入');
      chrome.scripting._calls.length = 0;
      for (const f of M.listeners.installed) f({ reason: 'update' });
      await until(() => chrome.scripting._calls.length === 3, 2000);
      eq(chrome.scripting._calls.map((c) => [c.target.tabId, c.target.allFrames]), [[10, true], [11, true], [12, true]]);
      eq(chrome.scripting._calls[0].files, ['src/constants.js', 'src/selectors.js', 'src/capture.js', 'src/chat-input.js', 'src/panel.js', 'src/content.js'], '與 manifest 的 content script 相同順序，不含 PoC');
      chrome.scripting._calls.length = 0;
      for (const f of M.listeners.installed) f({ reason: 'chrome_update' });
      await sleep(50);
      eq(chrome.scripting._calls.length, 0, 'Chrome 本身更新：content script 未斷線，不注入');
      eq(await BG.reconnectStaleTabs(), null, 'install／update 已全部注入：SW 啟動檢查不再執行');
    } finally { chrome.tabs._tabs = []; chrome.scripting._fail = new Set(); }
  });

  test('T3.9 B-1：SW 啟動時（每個實例一次）只對 PING 無回應的分頁重新注入；載入中的分頁略過', async () => {
    await resetAll();
    await BG.diag.clear();
    await send({ type: 'DIAG_CONTROL', op: 'start', opts: { probes: ['P6'] } }, PAGE);
    BG._setWakeChecked(false);
    chrome.tabs._tabs = [
      { id: 30, url: 'https://www.youtube.com/watch?v=' + V },
      { id: 31, url: 'https://www.youtube.com/watch?v=' + V2 },
      { id: 32, url: 'https://www.youtube.com/', status: 'loading' },
      { id: 33, url: 'https://example.com/' },
    ];
    chrome.tabs._alive = new Set([30]);
    chrome.scripting._calls.length = 0;
    try {
      const r = await BG.reconnectStaleTabs();
      eq([r.tabs, r.ok], [1, 1]);
      eq(chrome.scripting._calls.map((c) => c.target.tabId), [31], '只注入斷線且已載入完成的分頁');
      eq(await BG.reconnectStaleTabs(), null, '同一個 SW 實例只檢查一次');
      await BG.diag.flush();
      eq((await DB.diagAll()).find((x) => x.kind === 'wake-check').data, { stale: 2, reinject: 1 });
    } finally { chrome.tabs._tabs = []; chrome.tabs._alive = new Set(); await BG.diag.stop(); }
  });

  test('T3.8 C-2：斷線分頁偵測（PING 無回應）；開始記錄時一併回傳並記入 P6；重新接上後重新檢查', async () => {
    await resetAll();
    await BG.diag.clear();
    chrome.tabs._tabs = [
      { id: 20, url: 'https://www.youtube.com/watch?v=' + V },
      { id: 21, url: 'https://www.youtube.com/live_chat?is_popout=1&v=' + V2 },
      { id: 22, url: 'https://www.youtube.com/' },
      { id: 23, url: 'https://example.com/' },
    ];
    chrome.tabs._alive = new Set([22]);
    chrome.tabs.sent.length = 0;
    chrome.scripting._calls.length = 0;
    try {
      const stale = await BG.findStaleTabs();
      eq(stale, [{ tabId: 20, kind: 'watch', video: V.slice(0, 4) + '…' }, { tabId: 21, kind: 'popout', video: V2.slice(0, 4) + '…' }]);
      const r = await send({ type: 'DIAG_CONTROL', op: 'start', opts: { probes: ['P6'] } }, PAGE);
      eq([r.ok, r.staleTabs.length], [true, 2]);
      await BG.diag.flush();
      const rec = (await DB.diagAll()).find((x) => x.kind === 'stale-tabs');
      eq(rec.data, { count: 2, kinds: ['watch', 'popout'] });
      // 重新接上：注入後分頁開始回應
      chrome.scripting.executeScript = ((orig) => async (o) => { chrome.tabs._alive.add(o.target.tabId); return orig(o); })(chrome.scripting.executeScript);
      const rr = await send({ type: 'DIAG_CONTROL', op: 'reinject', tabIds: [20, 21] }, PAGE);
      eq([rr.reinject.ok, rr.staleTabs.length], [2, 0]);
      eq(chrome.scripting._calls.map((c) => c.target.tabId), [20, 21]);
      eq((await send({ type: 'DIAG_CONTROL', op: 'staleTabs' })).error, 'forbidden', 'content script 不可呼叫');
    } finally { chrome.tabs._tabs = []; chrome.tabs._alive = new Set(); await BG.diag.stop(); }
  });

  test('F-20：最長時限自動停止；指定開始時間（排程）；停止 30 天後自動清除；控制只接受擴充功能頁面', async () => {
    await resetAll();
    await BG.diag.clear();
    let st = await BG.diag.start({ hours: 99 });
    eq(st.endsAt - st.startAt, 24 * 3600e3, '上限 24 小時');
    st = await BG.diag.start({ hours: 1 });
    await BG.diag.check(st.endsAt + 1000);
    st = await BG.diag.status();
    eq([st.active, st.reason], [false, 'limit'], '超過時限自動停止');
    const at = Date.now() + 3600e3;
    st = await BG.diag.start({ startAt: at, endAt: at + 600e3 });
    eq([st.active, st.scheduled, st.endsAt - st.startAt], [false, true, 600e3]);
    eq((await send({ type: 'DIAG_LOG', records: [{ probe: 'P1', kind: 'x', data: {} }] })).accepted, 0, '排程開始前不收');
    await BG.diag.check(at + 1000);
    st = await BG.diag.status();
    eq([st.active, st.scheduled, chrome.action._badge.text], [true, false, 'REC'], '到時間開始');
    await BG.diag.stop();
    await DB.diagAppend([{ ts: 1, probe: 'P1', kind: 'old', data: {} }]);
    const s0 = await BG.diag.status();
    await BG.diag.check(s0.stoppedAt + 31 * 86400e3);
    eq((await BG.diag.status()).records, 0, '停止 30 天後清除');
    eq((await send({ type: 'DIAG_CONTROL', op: 'status' })).error, 'forbidden', 'content script 不可控制');
    eq((await send({ type: 'DIAG_CONTROL', op: 'status' }, PAGE)).ok, true);
  });

  test('F-20：環狀上限（筆數）丟最舊的；P5 記錄有分頁開著的場次摘要（只有筆數）', async () => {
    await resetAll();
    await BG.diag.clear();
    const r = await DB.diagAppend(Array.from({ length: 30 }, (_, i) => ({ ts: i, probe: 'P1', kind: 'k', data: { i } })), { maxRecords: 20 });
    eq([r.count, r.dropped], [20, 10]);
    eq((await DB.diagAll())[0].data.i, 10, '保留最新的 20 筆');
    await BG.diag.clear();
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: Date.now() - 600e3, startedAtSource: 'meta-actual', isLive: true }, messages: [msg(), msg({ phase: 'pre' })] });
    chrome.tabs._tabs = [{ id: 3, url: 'https://www.youtube.com/watch?v=' + V }];
    try {
      await BG.diag.start({ probes: ['P5'] });
      await BG.diag.runP5();
      await BG.diag.flush();
      const rec = (await DB.diagAll()).find((x) => x.kind === 'stream');
      eq([rec.ctx.videoId, rec.data.types, rec.data.sessions], [V, { text: 2 }, 0]);
      assert(rec.data.phases.live + rec.data.phases.pre === 2);
      assert((await DB.diagAll()).some((x) => x.kind === 'fieldStats'));
    } finally { chrome.tabs._tabs = []; await BG.diag.stop(); }
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

  test('T4.2 F-03：不帶 Cookie 的頻道頁沒有 og:title → 以 include 重試一次；HTTP 錯誤不重試；失敗原因與統計只有筆數', async () => {
    await resetAll();
    await sleep(300);
    BG._inflight.clear();
    await chrome.storage.session.set({ channelQueue: {} });
    const realFetch = self.fetch;
    const calls = [];
    self.fetch = async (url, o) => {
      const h = decodeURIComponent(String(url).split('/@')[1]);
      calls.push(h + ':' + (o && o.credentials));
      if (h === 'gone') return new Response('', { status: 404 });
      if (h === 'thin') return new Response('<html><title>YouTube</title></html>', { status: 200 });
      if (o && o.credentials === 'include') return new Response('<meta property="og:title" content="帶 Cookie 才有">', { status: 200 });
      return new Response('<html>consent</html>', { status: 200 });
    };
    try {
      await chrome.storage.session.set({ channelQueue: { '@needcookie': { attempts: 0, nextAt: 0 }, '@gone': { attempts: 5, nextAt: 0 }, '@thin': { attempts: 5, nextAt: 0 } } });
      BG.kickQueue();
      await until(async () => Object.keys(await BG.readQueue()).length === 0, 3000, '佇列清空');
      await sleep(50);
      eq(calls.filter((c) => c.startsWith('needcookie')), ['needcookie:omit', 'needcookie:include']);
      eq(calls.filter((c) => c.startsWith('gone')), ['gone:omit'], 'HTTP 錯誤不重試');
      eq(calls.filter((c) => c.startsWith('thin')), ['thin:omit', 'thin:include']);
      const ok = await DB.getChannel('@needcookie');
      eq([ok.displayName, ok.credentialsUsed], ['帶 Cookie 才有', 'include']);
      const thin = await DB.getChannel('@thin');
      eq([thin.failed, thin.failReason, thin.failInfo.ogTitle, thin.failInfo.retry.status, thin.failInfo.retry.ogTitle], [true, 'no og:title', false, 200, false]);
      await DB.putChannel({ handleOrId: '@old', displayName: '舊的', avatar: '', fetchedAt: 1 });
      const st = await BG.channelStats();
      eq([st.total, st.ok, st.failed, st.queued, st.failRate], [4, 2, 2, 0, 50]);
      eq(st.byCredentials, { include: 1, 'before-T4.2': 1 });
      eq(st.failReasons, { 'HTTP 404': 1, 'no og:title': 1 });
      eq(st.failDetail, { 'status 404 noOgTitle': 1, 'status 200 noOgTitle retry:status 200 noOgTitle': 1 });
      assert(!JSON.stringify(st).includes('@'), '統計不含 handle');
      eq(await BG.retryFailedChannels(), { dryRun: true, failed: 2 });
      self.fetch = async () => new Response('', { status: 503 }); // 重新排入後的解析一律失敗（不影響後續測試）
      const r = await BG.retryFailedChannels({ dryRun: false });
      eq([r.failed, r.queued], [2, 2]);
    } finally {
      await sleep(100);
      self.fetch = realFetch;
      await chrome.storage.session.set({ channelQueue: {} });
    }
  });

  test('T5.1 頭像（審查十一第 10 節）：寫入時以同場次同作者的頭像補上（不跨場次、不用名稱比對）；fillAvatars 預覽與補齊既有紀錄', async () => {
    await resetAll();
    const A = 'https://yt4.ggpht.com/author-a=s64';
    await DB.saveMessages({ videoId: V, source: 'live', messages: [msg({ id: 'a1', authorHandle: '@aa', authorAvatar: A })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [msg({ id: 'a2', authorHandle: '@aa', authorAvatar: '' }),
      msg({ id: 'b1', authorHandle: '', authorName: '同名', authorAvatar: '' })] });
    await DB.saveMessages({ videoId: V2, source: 'live', messages: [msg({ id: 'x1', videoId: V2, authorHandle: '@aa', authorAvatar: '' })] });
    const get = async (id) => (await DB.queryMessages(id.startsWith('x') ? V2 : V)).find((m) => m.id === id);
    eq((await get('a2')).authorAvatar, A, '同場次同作者補上');
    eq((await get('b1')).authorAvatar, '', '沒有 handle／頻道 id：不以名稱比對');
    eq((await get('x1')).authorAvatar, '', '不跨場次');
    // 既有紀錄：直接寫入缺頭像的資料（模擬 T5.1 以前收錄的）
    const a1 = await get('a1'); // 先讀，交易內不能 await 其他查詢
    const db = await DB.open();
    const t = db.transaction('messages', 'readwrite');
    t.objectStore('messages').put(Object.assign({}, a1, { id: 'old1', authorAvatar: '' }));
    t.objectStore('messages').put(Object.assign({}, a1, { id: 'old2', authorHandle: '@zz', authorAvatar: '' }));
    await new Promise((r) => { t.oncomplete = r; });
    const pre = await BG.fillAvatars();
    eq([pre.dryRun, pre.fillable, pre.filled], [true, 1, 0]);
    eq((await get('old1')).authorAvatar, '', '預覽不改資料');
    const r = await BG.fillAvatars({ dryRun: false });
    eq(r.filled, 1);
    eq((await get('old1')).authorAvatar, A);
    eq((await get('old2')).authorAvatar, '', '沒有其他頭像的作者不補');
    eq((await BG.fillAvatars()).fillable, 0, '再跑一次沒有可補的');
  });

  test('T5.4 禮物（20.4）：fixGiftAuthors 預覽／執行兩段式（內文開頭 @handle → 送禮者、@handle 連結改為頻道網址）；禮物結構存 storage.session 最近 5 筆並隨匯出附上', async () => {
    await resetAll();
    const G = (o) => msg(Object.assign({ type: 'gift', authorHandle: '', rawTag: 'yt-gift-message-view-model' }, o));
    await DB.saveMessages({ videoId: V, source: 'live', messages: [
      G({ id: 'g1', runs: [{ text: '@jaro0965 贈送X_X' }] }),
      G({ id: 'g2', runs: [{ text: '@ididibibiKaik', link: { url: 'https://www.youtube.com/' } }, { text: ' 贈送花束' }] }),
      G({ id: 'g3', runs: [{ text: '有人贈送' }] }),
      G({ id: 'g4', authorHandle: '@known', runs: [{ text: '@other 贈送' }] }),
      msg({ id: 't1', authorHandle: '', runs: [{ text: '@notgift 一般訊息' }] }),
    ] });
    const get = async (id) => (await DB.queryMessages(V)).find((m) => m.id === id);
    const pre = await BG.fixGiftAuthors();
    eq([pre.dryRun, pre.gifts, pre.unknownAuthor, pre.fillable, pre.links, pre.fixed], [true, 4, 3, 2, 1, 0]);
    eq((await get('g1')).authorHandle, '', '預覽不改資料');
    const r = await BG.fixGiftAuthors({ dryRun: false });
    eq([r.fixed, r.streams], [2, 1]);
    const g1 = await get('g1'), g2 = await get('g2');
    eq([g1.authorHandle, g1.authorUrl, g1.authorSource], ['@jaro0965', 'https://www.youtube.com/@jaro0965', 'text']);
    eq([g2.authorHandle, g2.runs[0].link.url], ['@ididibibiKaik', 'https://www.youtube.com/@ididibibiKaik']);
    assert(g1.fp && g1.fp !== '', '指紋重算');
    eq([(await get('g3')).authorHandle, (await get('g4')).authorHandle, (await get('t1')).authorHandle], ['', '@known', ''], '沒有 @handle、已有作者、非禮物都不動');
    eq((await BG.fixGiftAuthors()).fillable, 0, '再跑一次沒有可補的');
    // 禮物結構：content script 非記錄期間也送 → storage.session 最近 5 筆（消毒），匯出附上
    for (let i = 0; i < 7; i++) {
      const res = await send({ type: 'GIFT_STRUCTURE', source: 'live', videoId: V, data: { tag: 'yt-gift-message-view-model', authorSource: 'text', tree: [{ d: 1, tag: 'a', attrs: ['href'], at: true, href: 'handle' }], leak: '@jaro0965 贈送' } });
      eq(res.ok, true);
    }
    const gs = await BG.giftStructures();
    eq(gs.length, 5, '只留最近 5 筆');
    eq([gs[0].data.tag, gs[0].data.tree[0].href, gs[0].data.leak], ['yt-gift-message-view-model', 'handle', '[removed]'], '文字被消毒');
    const ex = await BG.diag.export();
    eq(ex.giftStructures.length, 5, '匯出附上（不需要記錄中）');
  });

  test('T5.4 phase（21.2、21.3）：endedAt 確定時自動重算；既有資料 fixPhases 預覽／執行兩段式；頁面狀態提示不參與 phase', async () => {
    await resetAll();
    const S0 = 1_700_000_000_000;
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: S0, startedAtSource: 'meta-actual' }, messages: [
      msg({ id: 'p1', timestampAbs: S0 + 100e3, videoOffsetSec: 100 }), msg({ id: 'p2', timestampAbs: S0 + 900e3, videoOffsetSec: 900 }),
      msg({ id: 'ytcas-ve-x1', type: 'system', timestampAbs: S0 + 950e3, videoOffsetSec: 950, notice: true, runs: [{ text: '提示' }] })] });
    const get = async (id) => (await DB.queryMessages(V)).find((m) => m.id === id);
    eq((await get('p2')).phase, 'live');
    // 結束時間之後才取得（meta）→ 自動重算：p2 在結束之後 → post；提示不動
    await DB.saveMessages({ videoId: V, source: 'live', stream: { endedAt: S0 + 500e3, endedAtSource: 'meta-actual' }, messages: [] });
    eq([(await get('p1')).phase, (await get('p2')).phase, (await get('ytcas-ve-x1')).phase], ['live', 'post', 'live']);
    // 既有資料（模擬重算以前就存著的錯誤 phase）
    const p2 = await get('p2');
    const db = await DB.open();
    const t = db.transaction('messages', 'readwrite');
    t.objectStore('messages').put(Object.assign({}, p2, { phase: 'live' }));
    await new Promise((r) => { t.oncomplete = r; });
    const pre = await BG.fixPhases();
    eq([pre.dryRun, pre.streams, pre.changed, pre.list[0].vid, pre.list[0].moves], [true, 1, 1, V.slice(0, 4), { 'live→post': 1 }]);
    eq((await get('p2')).phase, 'live', '預覽不改資料');
    const r = await BG.fixPhases({ dryRun: false });
    eq(r.updated, 1);
    eq((await get('p2')).phase, 'post');
    eq((await BG.fixPhases()).changed, 0, '再跑一次沒有要改的');
    // 頁面狀態提示用的元件標籤統計（只有標籤與筆數）
    const tags = await BG.systemTags();
    eq([tags.system, tags.notice], [1, 1]);
    assert(!JSON.stringify(tags).includes('提示'.repeat(2)) && Object.keys(tags.byTag)[0].endsWith('（提示）'), JSON.stringify(tags));
  });

  test('T5.6 待機室被記了開播時間（26.1）：meta 說預定時間在未來 → startedAt 降級（視同沒有）、預定時間改為最新、不接受 signal；之後 meta-actual 可覆蓋；fixPhases 兩段式清除並把訊息改回 pre', async () => {
    await resetAll();
    const C = self.YTCAS_CONST;
    const now = Date.now();
    const wrong = now - 3941e3;
    const future = Math.ceil((now + 25 * 3600e3) / 60000) * 60000;
    // 舊版：等待開播確認時以播放器訊號寫入 startedAt；降落事件（v46 一律 live）
    await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: now - 7200e3, startPending: true, isLive: true }, messages: [] });
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: wrong, startedAtSource: 'signal' }, messages: [
      msg({ id: 'ytcas-raid-1', type: 'raid', timestampAbs: now - 60e3, videoOffsetSec: 3881, phase: 'live', runs: [{ text: '降落' }] }),
      msg({ id: 'w2', timestampAbs: now - 30e3, videoOffsetSec: 3911, phase: 'live' })] });
    eq(DB.pickStreamTimes(await DB.getStream(V)).startedAt, wrong, '前提：舊版記下的錯誤開播時間');
    // 重新整理待機室：meta 說「25 小時後」
    await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: future, scheduledFuture: true, isLive: true }, messages: [] });
    let s = await DB.getStream(V);
    eq([s.startedAt, s.startedAtSuspect, s.scheduledFuture, s.scheduledStartAt], [wrong, true, true, future], '降級（原值保留供預覽）、預定時間改為最新');
    const pt = DB.pickStreamTimes(s);
    eq([pt.startedAt, pt.startedAtSource, pt.suspectSource, C.effectiveStart(s)], [null, null, 'signal', null], '回傳給擷取端的是 null');
    // 待機室中再送 signal：不接受
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: now, startedAtSource: 'signal' }, messages: [] });
    eq(C.effectiveStart(await DB.getStream(V)), null, '待機室中不接受 signal');
    const tm = await BG.streamTimes(V);
    eq([tm.startedAtSource, tm.startedAtSuspect, tm.scheduledFuture, tm.effectiveStart], ['signal', true, true, null], 'SW Console 查詢');
    assert(!('title' in tm) && !('channelHandle' in tm), '不含標題與頻道');
    // fixPhases：預覽 → 執行
    const pre = await BG.fixPhases();
    eq(pre.waiting.length, 1);
    eq([pre.waiting[0].vid, pre.waiting[0].startedAtSource, pre.waiting[0].suspect, pre.waiting[0].changed, pre.waiting[0].moves], [V.slice(0, 4), 'signal', true, 2, { 'live→pre': 2 }]);
    eq((await DB.getStream(V)).startedAt, wrong, '預覽不改資料');
    await BG.fixPhases({ dryRun: false });
    s = await DB.getStream(V);
    eq([s.startedAt, s.startedAtSource, s.startedAtSuspect, s.scheduledFuture], [null, null, false, true]);
    const ms = await DB.queryMessages(V);
    eq(ms.map((m) => [m.id, m.phase, m.videoOffsetSec]).sort(), [['w2', 'pre', null], ['ytcas-raid-1', 'pre', null]]);
    eq((await BG.fixPhases()).waiting.length, 0, '再跑一次沒有要改的');
    // 實際開播（預定時間到了、meta 說已開播）→ 解除待機室並採用
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: future - 3000, startedAtSource: 'meta-actual', scheduledFuture: false }, messages: [] });
    s = await DB.getStream(V);
    eq([C.effectiveStart(s), s.scheduledFuture], [future - 3000, false], '提早開播（meta-actual）可覆蓋');
    // 提早開播的場次：fixPhases 不動
    eq((await BG.fixPhases()).waiting.length, 0, 'meta-actual 的提早開播不列入');
  });

  test('T5.7 待機室→開播（27 第 1 點）：提早開播不重新整理 → 預定時間前 30 分鐘內每 2 分鐘重新抓取；isLiveNow＋實際時間 → 採用並 pre→live 重算；之後分頁的舊 meta（在未來）不得降級；之後送來的 pre 訊息依已知開播時間重算', async () => {
    await resetAll();
    const C = self.YTCAS_CONST;
    const now = Date.now();
    const sch = Math.ceil((now + 20 * MIN) / MIN) * MIN; // 預定 20 分鐘後
    const act = now - 5 * MIN + 17000; // 實際已在 5 分鐘前開播（帶秒數）
    await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: sch, scheduledFuture: true, isLive: true }, messages: [
      msg({ id: 'e1', timestampAbs: now - 10 * MIN, videoOffsetSec: null, phase: 'pre' }), // 開播前
      msg({ id: 'e2', timestampAbs: now - 2 * MIN, videoOffsetSec: null, phase: 'pre' }), // 實際已開播（擷取端還不知道）
    ] });
    let html = '<meta itemprop="startDate" content="' + new Date(sch).toISOString() + '"><script>var x={"isLiveNow":false}</script>';
    let n = 0;
    self.fetch = async (u) => { if (String(u).includes('/watch?v=')) n++; return new Response(html, { status: 200 }); };
    try {
      BG._metaPoll.clear();
      let s = await DB.getStream(V);
      await BG.maybeRefetchMeta(V, DB.pickStreamTimes(s), 'live');
      eq(n, 1, '待機室（預定時間在未來）也重新抓取');
      await BG.maybeRefetchMeta(V, DB.pickStreamTimes(await DB.getStream(V)), 'live');
      eq(n, 1, '2 分鐘內不重抓');
      BG._metaPoll.get(V).lastAt -= 2 * MIN + 1000;
      // 提早開播：重新抓到的頁面 startDate＝實際開播（帶秒數）、isLiveNow true
      html = '<meta itemprop="startDate" content="' + new Date(act).toISOString() + '"><script>var x={"liveBroadcastDetails":{"isLiveNow":true}}</script>';
      await BG.maybeRefetchMeta(V, DB.pickStreamTimes(await DB.getStream(V)), 'live');
      eq(n, 2);
      s = await DB.getStream(V);
      eq([s.startedAt, s.startedAtSource, s.scheduledFuture, typeof s.liveConfirmedAt, C.effectiveStart(s)], [act, 'meta-actual', false, 'number', act], '採用實際開播時間');
      const get = async (id) => (await DB.queryMessages(V)).find((m) => m.id === id);
      eq([(await get('e1')).phase, (await get('e2')).phase, (await get('e2')).videoOffsetSec], ['pre', 'live', Math.round((now - 2 * MIN - act) / 100) / 10], 'pre→live 重算');
      // 分頁沒重新整理：擷取端送來的 meta 仍說預定時間在未來、新訊息仍標 pre → 不降級、訊息依已知開播時間重算
      const r = await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: sch, scheduledFuture: true, isLive: true }, messages: [
        msg({ id: 'e3', timestampAbs: now - 1 * MIN, videoOffsetSec: null, phase: 'pre' })] });
      s = await DB.getStream(V);
      eq([C.effectiveStart(s), !!s.startedAtSuspect, r.stream.startedAt, r.stream.liveConfirmedAt === s.liveConfirmedAt], [act, false, act, true], '舊 meta 不降級；回應帶 liveConfirmedAt');
      eq([(await get('e3')).phase, r.phaseFixed], ['live', 1], '送來的 pre 依已知開播時間改為 live');
      // 預定時間還很遠（> 30 分鐘）：每 15 分鐘
      BG._metaPoll.clear();
      const far = { startedAt: null, scheduledStartAt: Date.now() + 5 * 3600e3, isLive: true, endedAt: null };
      await BG.maybeRefetchMeta(V2, far, 'live');
      const c0 = n;
      BG._metaPoll.get(V2).lastAt -= 3 * MIN;
      await BG.maybeRefetchMeta(V2, far, 'live');
      eq(n, c0, '遠的待機室：3 分鐘內不重抓');
      BG._metaPoll.get(V2).lastAt -= 13 * MIN;
      await BG.maybeRefetchMeta(V2, far, 'live');
      eq(n, c0 + 1, '15 分鐘後重抓');
    } finally { self.fetch = self.__blockedFetch; }
    // 27.1：待機室的頁面 startDate 是過去、帶秒數的時間，但 isLiveNow false → 不當成開播
    const past = new Date(Date.now() - 3600e3 + 24000).toISOString();
    eq(BG.parseWatchHtml('<meta itemprop="startDate" content="' + past + '"><script>{"isLiveNow":false}</script>'),
      { startPending: true, scheduledFuture: false, isLiveNow: false }, 'isLiveNow false：不採用');
    const live = BG.parseWatchHtml('<meta itemprop="startDate" content="' + past + '"><script>{"isLiveNow":true}</script>');
    eq([live.startedAtSource, live.isLiveNow, typeof live.liveConfirmedAt], ['meta-actual', true, 'number']);
  });

  test('權限：管理操作只接受擴充功能頁面，content script 被拒', async () => {
    await resetAll();
    for (const type of ['DELETE_STREAMS', 'IMPORT_DATA', 'MIGRATE_LEGACY', 'EXPORT_STREAM', 'GET_STORAGE_USAGE', 'RECLASSIFY_SYSTEM']) {
      eq((await send({ type, videoIds: [V], data: {} }, CONTENT)).error, 'forbidden', type);
    }
    eq(await send({ type: 'LIST_STREAMS' }, { id: 'other-ext', url: 'chrome-extension://other/' }), undefined, '其他擴充功能不回應');
  });

  test('T5.2 (I) OPEN_VIEWER：嵌入面板（擴充功能頁面）請 background 開後台分頁，開在該分頁右邊；content script 被拒；videoId 檢查', async () => {
    const created = self.chrome.tabs._created;
    created.length = 0;
    eq((await send({ type: 'OPEN_VIEWER', videoId: V }, CONTENT)).error, 'forbidden', 'content script 不可開');
    // Chrome 對嵌在 youtube.com 裡的擴充功能 iframe 給的 MessageSender 形狀（url／origin 為動態 ID、tab 為 YouTube 分頁）
    const EMBED = { id: 'testextid', url: 'chrome-extension://dynamic-id/src/viewer.html?embed=1&v=' + V, origin: 'chrome-extension://dynamic-id',
      frameId: 12, documentId: 'D', tab: { id: 7, index: 3, windowId: 2, url: 'https://www.youtube.com/watch?v=' + V } };
    eq((await send({ type: 'OPEN_VIEWER', videoId: V }, EMBED)).ok, true);
    eq(created.length, 1);
    // v44（T5.3 (J)）：開不在 web_accessible_resources 的 backend.html；不設 openerTabId
    eq(created[0], { url: 'chrome-extension://testextid/src/backend.html?v=' + V, index: 4, windowId: 2 });
    eq((await send({ type: 'OPEN_VIEWER', videoId: 'x"><script>' }, EMBED)), { ok: false, error: 'bad-video-id' }, '不合法的 videoId');
    eq(created.length, 1);
    // tabs.create 失敗：先不指定位置重試；仍失敗 → 回傳原因代碼
    const realCreate = self.chrome.tabs.create;
    let calls = 0;
    self.chrome.tabs.create = async (o) => { calls++; if (o.index != null) throw new Error('No window with id: 2.'); created.push(o); return { id: 99 }; };
    eq((await send({ type: 'OPEN_VIEWER', videoId: V }, EMBED)).ok, true, '位置不合法 → 不指定位置重試');
    eq([calls, created.length, created[1].index], [2, 2, undefined]);
    self.chrome.tabs.create = async () => { throw new Error('Tabs cannot be edited right now'); };
    const r = await send({ type: 'OPEN_VIEWER', videoId: V }, EMBED);
    assert(r.ok === false && r.error.startsWith('tabs-create:'), JSON.stringify(r));
    self.chrome.tabs.create = realCreate;
  });

  test('T5.3 (K) sourceStats：已結束場次的 live／replay／已合併筆數、亂序、校正值、疑似重複；只有數字、videoId 只留 4 字', async () => {
    await resetAll();
    const S0 = Date.parse('2026-11-18T20:00:00+08:00');
    const db = await DB.open();
    const t = db.transaction(['streams', 'messages'], 'readwrite');
    t.objectStore('streams').put({ videoId: 'vidSRCSTAT1', title: '不應出現的標題', isLive: true, startedAt: S0, endedAt: S0 + 7200e3, messageCount: 7, lastMessageAt: S0 + 100e3 });
    const base = { videoId: 'vidSRCSTAT1', type: 'text', authorHandle: '@a', runs: [{ text: '不應出現的內容' }], phase: 'live', aliasIds: [], deleted: false };
    const put = (o) => t.objectStore('messages').put(Object.assign({}, base, o));
    for (let i = 0; i < 5; i++) put({ id: 'b' + i, sources: ['live', 'replay'], offsetSource: 'replay', videoOffsetSec: 10 + i * 10, timestampAbs: S0 + (10 + i * 10 + 7) * 1000, runs: [{ text: 'b' + i }] });
    put({ id: 'l0', sources: ['live'], offsetSource: 'estimated', videoOffsetSec: 63, timestampAbs: S0 + 63e3, runs: [{ text: 'x' }] });
    put({ id: 'r0', sources: ['replay'], offsetSource: 'replay', videoOffsetSec: 52, timestampAbs: S0 + 52e3, runs: [{ text: 'y' }] }); // 到達時間比 b4（57 秒）早、offset 比 b3（40）大 → 依到達時間排序時不倒退
    await new Promise((res) => { t.oncomplete = res; });
    const [r] = await self.YTCAS_BG.sourceStats();
    eq(r.vid, 'vidS');
    eq([r.messages, r.sources, r.offsetSource], [7, { liveOnly: 1, replayOnly: 1, both: 5, other: 0 }, { replay: 6, estimated: 1, none: 0 }]);
    eq(r.cal, { delta: -7, pairs: 5, how: 'merged' });
    eq(r.disorder.both, 1, 'b4（offset 50）排在 r0（52）之後');
    const txt = JSON.stringify(r);
    assert(!txt.includes('不應出現') && !txt.includes('vidSRCSTAT1') && !txt.includes('@a'), '只有數字');
  });

  // 審查十一 18.1 (J)：以**嵌入的 iframe 當 sender**——真實 viewer.js（embed=1）在 iframe 內點 ⋯「在後台開啟此場次」，
  // 它的 chrome.runtime.sendMessage 接到本頁真實的 background 處理函式（sender 依該 iframe 的實際網址與所在分頁組成）
  test('T5.3 (J) 嵌入面板 iframe → background：開 backend.html、成功時不顯示錯誤；失敗時面板顯示原因、不退回 window.open', async () => {
    const created = self.chrome.tabs._created;
    created.length = 0;
    const f = document.createElement('iframe');
    f.style.cssText = 'width:360px;height:500px';
    f.src = 'content-fixtures/viewer-env.html?embed=1&v=' + V + '&db=test-db-embed-ytcas';
    document.body.appendChild(f);
    try {
      await until(() => f.contentWindow && f.contentWindow.__loaded && f.contentWindow.YTCAS_VIEWER && f.contentWindow.YTCAS_VIEWER.current, 6000, '面板載入');
      const w = f.contentWindow;
      await w.YTCAS_VIEWER.current.ready;
      const opened = [];
      w.open = (u) => { opened.push(String(u)); return null; };
      const sender = () => ({ id: 'testextid', url: w.location.href, origin: w.location.origin, frameId: 3, tab: { id: 7, index: 1, windowId: 2, url: 'https://www.youtube.com/watch?v=' + V } });
      w.chrome.runtime.sendMessage = (msg) => send(JSON.parse(JSON.stringify(msg)), sender());
      const click = () => {
        w.YTCAS_VIEWER.current.els.moreBtn.click();
        Array.from(w.YTCAS_VIEWER.current.els.menu.querySelectorAll('button')).find((b) => b.textContent.includes('在後台開啟此場次')).click();
      };
      click();
      await until(() => created.length === 1, 2000, 'tabs.create');
      eq(created[0].url, 'chrome-extension://testextid/src/backend.html?v=' + V);
      const note = w.YTCAS_VIEWER.current.els.note;
      assert(note.hidden || !note.textContent.includes('無法開啟'), '成功時不顯示錯誤');
      // background 失敗 → 面板顯示原因代碼；嵌入模式不退回 window.open
      const realCreate = self.chrome.tabs.create;
      self.chrome.tabs.create = async () => { throw new Error('blocked'); };
      try {
        click();
        await until(() => !note.hidden && note.textContent.includes('無法開啟後台分頁（tabs-create:'), 2000, '錯誤提示 ' + note.textContent);
      } finally { self.chrome.tabs.create = realCreate; }
      // 送訊息本身拋錯
      w.chrome.runtime.sendMessage = () => Promise.reject(new Error('Could not establish connection'));
      click();
      await until(() => note.textContent.includes('send:'), 2000, '送出失敗的提示');
      eq(opened, [], '嵌入模式不退回 window.open');
      eq(created.length, 1);
    } finally { f.remove(); indexedDB.deleteDatabase('test-db-embed-ytcas'); }
  });

  // ---------------------------------------------------------------- v50（T6.1，審查十一 30.5）自己送出的訊息重複
  test('T6.1 自己送出的訊息（30.5）：暫時 id → 正式 id 合併為一筆（正式 id 為主、沿用到達時間）；兩筆都是正式 id 不合併；不同作者不合併；連續送出相同內容各配各的', async () => {
    await resetAll();
    U._resetTwins();
    const t0 = 1_700_100_000_000;
    const own = (o) => Object.assign({ type: 'text', authorHandle: '@又新-david', runs: [{ text: '早安' }] }, o);
    // 1. 暫時節點（到達時間）→ 18 秒後正式節點（顯示時間，沒有提示）
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'CTMPAAAAAAAAAAAAAAAAtmp1', timestampAbs: t0, tsSource: 'arrival', videoOffsetSec: 100, phase: 'live' })] });
    const r1 = await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKreal1', timestampAbs: t0 + 18000, tsSource: 'clock', videoOffsetSec: 118, phase: 'pre' })] });
    let list = await DB.queryMessages(V);
    eq(list.map((m) => m.id), ['ChwKreal1'], '只剩正式 id');
    eq([list[0].timestampAbs, list[0].tsSource, list[0].videoOffsetSec, list[0].phase, list[0].aliasIds], [t0, 'arrival', 100, 'live', ['CTMPAAAAAAAAAAAAAAAAtmp1']]);
    eq([r1.ownMerged, r1.changed.map((m) => m.id)], [1, ['ChwKreal1']], '推播合併後的紀錄');
    eq((await DB.getStream(V)).messageCount, 1, '筆數不重複計算');
    // 同一則正式訊息再送一次（回溯）：不再動
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKreal1', timestampAbs: t0 + 18000, tsSource: 'clock', videoOffsetSec: 118 })] });
    eq((await DB.queryMessages(V)).length, 1);
    // 2. 兩筆都是正式 id（同一個人 10 秒內送兩次相同內容）→ 不合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKa', runs: [{ text: '8888' }], timestampAbs: t0 + 60000, videoOffsetSec: 160 }),
      own({ id: 'ChwKb', runs: [{ text: '8888' }], timestampAbs: t0 + 70000, videoOffsetSec: 170 })] });
    eq((await DB.queryMessages(V)).filter((m) => m.runs[0].text === '8888').length, 2, '正式 id 之間不合併');
    // 3. 不同作者、相同內容、其中一筆暫時 id → 不合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'CTMPAAAAAAAAAAAAAAAAtmp2', runs: [{ text: '草' }], timestampAbs: t0 + 80000, tsSource: 'arrival', videoOffsetSec: 180 }),
      own({ id: 'ChwKother', authorHandle: '@someone', runs: [{ text: '草' }], timestampAbs: t0 + 81000, videoOffsetSec: 181 })] });
    eq((await DB.queryMessages(V)).filter((m) => m.runs[0].text === '草').length, 2, '不同作者不合併');
    // 4. 連續送出相同內容兩次：暫時 ×2 → 正式 ×2，各配各的（時間最近）
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'CTMPAAAAAAAAAAAAAAAAx1', runs: [{ text: 'hi' }], timestampAbs: t0 + 200000, tsSource: 'arrival', videoOffsetSec: 300 }),
      own({ id: 'CTMPAAAAAAAAAAAAAAAAx2', runs: [{ text: 'hi' }], timestampAbs: t0 + 203000, tsSource: 'arrival', videoOffsetSec: 303 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKx1', runs: [{ text: 'hi' }], timestampAbs: t0 + 201000, tsSource: 'clock', videoOffsetSec: 301 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKx2', runs: [{ text: 'hi' }], timestampAbs: t0 + 204000, tsSource: 'clock', videoOffsetSec: 304 })] });
    const his = (await DB.queryMessages(V)).filter((m) => m.runs[0].text === 'hi').sort((a, b) => a.timestampAbs - b.timestampAbs);
    eq(his.map((m) => [m.id, m.timestampAbs - t0, m.aliasIds]), [['ChwKx1', 200000, ['CTMPAAAAAAAAAAAAAAAAx1']], ['ChwKx2', 203000, ['CTMPAAAAAAAAAAAAAAAAx2']]], '兩則各自保留');
    // 5. 正式節點先存、暫時節點晚到 → 也合併（以正式 id 為主、時間取到達時間）
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKlate', runs: [{ text: '晚到' }], timestampAbs: t0 + 400000, tsSource: 'clock', videoOffsetSec: 500 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'CTMPAAAAAAAAAAAAAAAAlate', runs: [{ text: '晚到' }], timestampAbs: t0 + 390000, tsSource: 'arrival', videoOffsetSec: 490 })] });
    const late = (await DB.queryMessages(V)).filter((m) => m.runs[0].text === '晚到');
    eq(late.map((m) => [m.id, m.timestampAbs - t0, m.tsSource, m.aliasIds]), [['ChwKlate', 390000, 'arrival', ['CTMPAAAAAAAAAAAAAAAAlate']]]);
    // 6. 超過 90 秒 → 不合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'CTMPAAAAAAAAAAAAAAAAfar', runs: [{ text: '遠' }], timestampAbs: t0 + 600000, tsSource: 'arrival', videoOffsetSec: 700 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKfar', runs: [{ text: '遠' }], timestampAbs: t0 + 691000, videoOffsetSec: 791 })] });
    eq((await DB.queryMessages(V)).filter((m) => m.runs[0].text === '遠').length, 2, '> 90 秒不合併');
    const s = await DB.getStream(V);
    eq(s.messageCount, (await DB.queryMessages(V)).length, 'messageCount 與實際筆數一致');
    const stored = await DB.queryMessages(V);
    assert(stored.every((m) => !('replacesId' in m) && !('replaceInPlace' in m)), '替換提示不存');
  });

  test('T6.1 自己送出的訊息（30.5）：擷取端帶 replacesId（看得出前一筆是暫時節點，id 不必符合暫時格式）→ 合併；原地改 id 同作者同內容才合併（v51：不同內容或作者絕不合併）；內容不同的 replacesId 不合併', async () => {
    await resetAll();
    U._resetTwins();
    const t0 = 1_700_200_000_000;
    const own = (o) => Object.assign({ type: 'text', authorHandle: '@me', runs: [{ text: '你好' }] }, o);
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKpending', timestampAbs: t0, tsSource: 'arrival', videoOffsetSec: 10 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKfinal', timestampAbs: t0, tsSource: 'arrival', videoOffsetSec: 10, replacesId: 'ChwKpending' })] });
    eq((await DB.queryMessages(V)).map((m) => [m.id, m.aliasIds]), [['ChwKfinal', ['ChwKpending']]]);
    // 原地改 id、同作者同內容 → 合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKold2', runs: [{ text: 'a' }], timestampAbs: t0 + 5000, videoOffsetSec: 15 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKnew2', runs: [{ text: 'a' }], timestampAbs: t0 + 5000, videoOffsetSec: 15, replacesId: 'ChwKold2', replaceInPlace: true })] });
    assert((await DB.queryMessages(V)).some((m) => m.id === 'ChwKnew2' && m.aliasIds.includes('ChwKold2')), '原地改 id 合併');
    assert(!(await DB.queryMessages(V)).some((m) => m.id === 'ChwKold2'), '舊 id 刪除');
    // v51（32.2）原地改 id、但內容或作者不同（節點被重複利用）→ 絕不合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKold3', runs: [{ text: '777' }], timestampAbs: t0 + 6000, videoOffsetSec: 16 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKnew3', runs: [{ text: '888' }], timestampAbs: t0 + 6000, videoOffsetSec: 16, replacesId: 'ChwKold3', replaceInPlace: true })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKnew4', authorHandle: '@other', runs: [{ text: '777' }], timestampAbs: t0 + 6000, videoOffsetSec: 16, replacesId: 'ChwKold3', replaceInPlace: true })] });
    const ids3 = (await DB.queryMessages(V)).map((m) => m.id);
    assert(['ChwKold3', 'ChwKnew3', 'ChwKnew4'].every((x) => ids3.includes(x)), '不同內容／不同作者都保留：' + ids3.join(','));
    // replacesId 指到內容不同的訊息 → 不合併
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKq1', runs: [{ text: 'q1' }], timestampAbs: t0 + 9000, videoOffsetSec: 19 })] });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [own({ id: 'ChwKq2', runs: [{ text: 'q2' }], timestampAbs: t0 + 9000, videoOffsetSec: 19, replacesId: 'ChwKq1' })] });
    eq((await DB.queryMessages(V)).filter((m) => /^ChwKq/.test(m.id)).length, 2);
    eq((await DB.getStream(V)).messageCount, (await DB.queryMessages(V)).length);
  });

  test('T6.1 YTCAS_BG.fixOwnDuplicates（30.5 第 4 點）：預覽只回傳筆數與場次（4 碼）、暫時 id 總數、兩筆都是正式 id 的 id 形狀；執行後合併並重算筆數；重跑為 0', async () => {
    await resetAll();
    U._resetTwins();
    const t0 = 1_700_300_000_000;
    const own = (o) => Object.assign({ type: 'text', authorHandle: '@me', runs: [{ text: '舊資料' }] }, o);
    // 以匯入（preserve）寫入：不經過寫入時的合併 → 模擬既有的重複資料
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [
      own({ id: 'CTMPAAAAAAAAAAAAAAAAo1', timestampAbs: t0, tsSource: 'arrival', videoOffsetSec: 50, phase: 'live' }),
      own({ id: 'ChwKo1', timestampAbs: t0 + 15000, tsSource: 'clock', videoOffsetSec: 65, phase: 'pre' }),
      own({ id: 'ChwKs1', runs: [{ text: '8888' }], timestampAbs: t0 + 20000, videoOffsetSec: 70 }),
      own({ id: 'ChwKs2', runs: [{ text: '8888' }], timestampAbs: t0 + 25000, videoOffsetSec: 75 }),
    ] });
    eq(await count(V), 4);
    const pre = await BG.fixOwnDuplicates();
    eq([pre.dryRun, pre.pairs, pre.tempIds, pre.streams, pre.sameTextBothReal.pairs, pre.sameTextBothReal.idShapes], [true, 1, 1, [{ v: V.slice(0, 4), n: 1 }], 1, [{ k: 'ChwK|6 + ChwK|6 @ live + live', n: 1 }]]);
    eq(await count(V), 4, '預覽不寫入');
    const ex = await BG.fixOwnDuplicates({ dryRun: false });
    eq([ex.dryRun, ex.merged], [false, 1]);
    const list = await DB.queryMessages(V);
    eq(list.length, 3);
    const m = list.find((x) => x.id === 'ChwKo1');
    eq([m.timestampAbs, m.tsSource, m.videoOffsetSec, m.phase, m.aliasIds], [t0, 'arrival', 50, 'live', ['CTMPAAAAAAAAAAAAAAAAo1']]);
    eq((await DB.getStream(V)).messageCount, 3, '重算筆數');
    eq((await BG.fixOwnDuplicates()).pairs, 0, '重跑為 0');
    assert(!JSON.stringify(pre).includes('舊資料') && !JSON.stringify(pre).includes('@me'), '預覽不含內容與作者');
  });

  test('T6.2（32.10）頻道名稱：og:title 的全形括號、emoji、HTML 實體解碼（「亞瑟Arthur【精華剪輯】」）；channelInfo 只回傳狀態；可見優先排序；網路錯誤指數退避、不計入嘗試次數；channelStats 新欄位', async () => {
    // 解碼：原樣的全形括號與 emoji、數字實體（十進位／十六進位）、具名實體
    const p = (c) => BG.parseChannelHtml('<meta property="og:title" content="' + c + '">').displayName;
    eq(p('亞瑟Arthur【精華剪輯】'), '亞瑟Arthur【精華剪輯】', '原樣');
    eq(p('亞瑟Arthur&#12304;精華剪輯&#12305;'), '亞瑟Arthur【精華剪輯】', '十進位實體');
    eq(p('亞瑟Arthur&#x3010;精華剪輯&#x3011; &#x1F3AE;'), '亞瑟Arthur【精華剪輯】 🎮', '十六進位實體、emoji');
    eq(p('A &amp; B &quot;C&quot; &#39;D&#39; &lt;E&gt;'), 'A & B "C" \'D\' <E>', '具名實體');
    eq(p('魚 🐟 &amp;amp;'), '魚 🐟 &amp;', '只解一層');
    // 可見優先：prio 新的在前，其餘依加入順序
    // v52：加入順序＝鍵的插入順序（項目不再存 addedAt，舊資料殘留的 addedAt 不影響順序）
    eq(BG._orderQueue({ '@a': {}, '@b': { prio: 100 }, '@c': { prio: 200 }, '@d': { addedAt: 0 } }).map((x) => x[0]), ['@c', '@b', '@a', '@d']);
    eq(BG._orderQueue(JSON.parse(JSON.stringify({ '@z': {}, '@y': {}, '@x': {} }))).map((x) => x[0]), ['@z', '@y', '@x'], 'JSON 來回保留插入順序');
    eq([0, 1, 2, 3, 4, 10].map(BG._netBackoffMs), [0, 0, 30000, 60000, 120000, 600000], '連續網路錯誤 2 次起暫停 30 秒 × 2^(n−2)，最多 10 分鐘');
    assert(BG._isNetError(new TypeError('Failed to fetch')) && !BG._isNetError(Object.assign(new Error('HTTP 404'), { failInfo: { status: 404 } })), '網路錯誤與 HTTP 錯誤分開');
    await resetAll();
    BG._resetChStats();
    eq((await BG.channelInfo('not a handle')).error, 'bad-handle');
    eq((await BG.channelInfo('@nobody')).status, 'unknown');
    // 網路錯誤：不計入嘗試次數、netErrors 累計
    let calls = 0;
    self.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
    try {
      await BG.enqueueHandles(['@netfail']);
      await until(async () => (await BG.channelStats()).netErrors >= 1, 3000, '網路錯誤計數');
      const ci = await BG.channelInfo('@netfail');
      eq([ci.status, ci.attempts, ci.netErrors, ci.hasName], ['retry', 0, 1, false], '網路錯誤：retry、attempts 0');
      const cs = await BG.channelStats();
      eq([cs.netErrors, cs.netErrorsLastHour, cs.queued, cs.consecutiveNetErrors, cs.concurrency], [1, 1, 1, 1, 3]);
      assert(cs.oldestWaitMin === 0 && typeof cs.perMinLast10 === 'number', 'oldestWaitMin／perMinLast10 ' + JSON.stringify(cs));
      assert(!JSON.stringify(cs).includes('@netfail') && !JSON.stringify(ci).includes('netfail'), '不含 handle');
      // v52（T6.3 第 6 項）：佇列項目不存 addedAt（整份佇列每次寫入都要序列化），排入時間只在記憶體
      const qi = (await BG.readQueue())['@netfail'];
      assert(qi && !('addedAt' in qi) && typeof ci.queuedAt === 'string', '佇列項目不含 addedAt、channelInfo 仍有 queuedAt ' + JSON.stringify(Object.keys(qi || {})));
    } finally { self.fetch = self.__blockedFetch; }
    // 成功：可見優先送來的 handle 排入並解析，channelInfo ok
    self.fetch = async () => new Response('<meta property="og:title" content="亞瑟Arthur&#12304;精華剪輯&#12305;">', { status: 200 });
    try {
      BG._resetChStats();
      const r = await send({ type: 'RESOLVE_CHANNELS', handles: ['@arthurW77748', 'bad', '@arthurW77748'] }, PAGE);
      eq([r.queued, r.prioritized], [1, 1], '可見優先：排入並標優先（不合格的 handle 略過、重複合併）');
      await until(async () => (await BG.channelInfo('@arthurW77748')).status === 'ok', 3000, '解析完成');
      eq((await DB.getChannel('@arthurW77748')).displayName, '亞瑟Arthur【精華剪輯】');
      const ci = await BG.channelInfo('@arthurW77748');
      eq([ci.hasName, ci.credentialsUsed], [true, 'omit']);
      assert(!('displayName' in ci), 'channelInfo 不回傳名稱');
      eq((await send({ type: 'RESOLVE_CHANNELS', handles: ['@arthurW77748'] }, PAGE)).queued, 0, '已解析的不再排入');
    } finally { self.fetch = self.__blockedFetch; }
  });

  test('T6.3.1（34.2.1 第 3、4 點）降落暫定的結束：重新抓取確認 isLiveNow true、沒有 endDate → 撤銷並重算 phase（post → live）；擷取端再送同一個 raid 結束時間不採用；fixRaidEnds 預覽／執行（有 endDate → 覆蓋；仍在直播 → 撤銷）', async () => {
    await resetAll();
    U._resetTwins();
    const V = 'vidRVKraid1', W = 'vidRVKend02', X = 'vidRVKlive3';
    const t0 = Date.now() - 2 * 3600e3, rAt = Date.now() - 30 * 60e3;
    const mm = (id, vid, ts) => ({ id, videoId: vid, type: 'text', authorHandle: '@u', runs: [{ text: id }], timestampAbs: ts, tsSource: 'arrival' });
    for (const v of [V, W, X]) {
      await DB.saveMessages({ videoId: v, source: 'live', stream: { startedAt: t0, startedAtSource: 'meta-actual', isLive: true }, messages: [mm(v + 'a', v, t0 + 60e3)] });
      await DB.saveMessages({ videoId: v, source: 'live', stream: { endedAt: rAt, endedAtSource: 'raid' }, messages: [mm(v + 'b', v, rAt + 60e3)] });
    }
    eq((await DB.queryMessages(V)).find((m) => m.id === V + 'b').phase, 'post', '暫定結束後的訊息是 post');
    const live = '<meta itemprop="startDate" content="' + new Date(t0).toISOString() + '"><script>var x={"liveBroadcastDetails":{"isLiveNow":true}}</script>';
    self.fetch = async () => new Response(live, { status: 200 });
    try {
      BG._metaPoll.clear();
      await BG.maybeRefetchMeta(V, DB.pickStreamTimes(await DB.getStream(V)), 'live');
      const s = await DB.getStream(V);
      eq([s.endedAt, s.endedAtSource, typeof s.raidEndRevokedAt], [null, null, 'number'], '撤銷');
      eq((await DB.queryMessages(V)).find((m) => m.id === V + 'b').phase, 'live', '重算 post → live');
      eq(DB.pickStreamTimes(s).raidEndRevokedAt, s.raidEndRevokedAt, '回應帶 raidEndRevokedAt（擷取端據此撤銷）');
      // 還沒收到撤銷的擷取端再送同一個 raid 結束 → 不採用；之後新的降落出去（較晚）照常採用
      await DB.saveMessages({ videoId: V, source: 'live', stream: { endedAt: rAt, endedAtSource: 'raid' }, messages: [] });
      eq((await DB.getStream(V)).endedAt, null, '撤銷過的 raid 結束不再採用');
      const later = Date.now() + 1000;
      await DB.saveMessages({ videoId: V, source: 'live', stream: { endedAt: later, endedAtSource: 'raid' }, messages: [] });
      eq((await DB.getStream(V)).endedAt, later, '之後的降落出去照常採用');
    } finally { self.fetch = self.__blockedFetch; }
    // fixRaidEnds：W 的 meta 已有 endDate、X 仍在直播
    const pre = await BG.fixRaidEnds();
    eq([pre.dryRun, pre.streams], [true, 3], 'V（新的降落）、W、X');
    assert(pre.vids.every((x) => x.length === 4), '只有 4 碼');
    const endAt = Date.now() - 20 * 60e3;
    self.fetch = async (url) => {
      const u = String(url);
      if (u.includes(W)) return new Response('<meta itemprop="startDate" content="' + new Date(t0).toISOString() + '"><meta itemprop="endDate" content="' + new Date(endAt).toISOString() + '">', { status: 200 });
      if (u.includes(X)) return new Response(live, { status: 200 });
      return new Response('<meta itemprop="startDate" content="' + new Date(t0).toISOString() + '">', { status: 200 });
    };
    try {
      const ex = await BG.fixRaidEnds({ dryRun: false });
      eq([ex.replaced, ex.revoked, ex.kept, ex.failed], [1, 1, 1, 0], ex);
      const sw = await DB.getStream(W), sx = await DB.getStream(X);
      eq([sw.endedAtSource, Math.abs(sw.endedAt - endAt) < 1000, sx.endedAt], ['meta-actual', true, null]);
      eq((await DB.queryMessages(X)).find((m) => m.id === X + 'b').phase, 'live');
    } finally { self.fetch = self.__blockedFetch; }
  });

  test('T6.3（33.1）降落：streamCompare 只輸出數字與代碼；id 已在別的場次 → crossVideo 計數；fixRaidLeak 預覽／搬回原場次（post）；降落暫定結束時照常重新抓取；fixStreamMeta 覆蓋標題', async () => {
    await resetAll();
    U._resetTwins();
    const A = 'vidRAIDorg1', B = 'vidRAIDnew2';
    const t0 = Date.now() - 3 * 3600e3;
    const raidAt = t0 + 2 * 3600e3;
    const mm = (id, vid, h, text, ts, o) => Object.assign({ id, videoId: vid, type: 'text', authorHandle: h, runs: [{ text }], timestampAbs: ts, tsSource: 'arrival' }, o);
    // 原場次 A：一般訊息、降落橫幅
    await DB.saveMessages({ videoId: A, source: 'live', stream: { title: '原直播', channelHandle: '@orig', startedAt: t0, startedAtSource: 'meta-actual' }, messages: [
      mm('a1', A, '@fan1', '你好', t0 + 60e3), mm('a2', A, '@fan2', '加油', t0 + 3600e3), mm('a3', A, '@fan1', '再見', raidAt - 30e3),
      mm('a4', A, '@fan1', '今天拿這麼大的', raidAt + 20e3),
      // v53（34.2.2）舊資料沒有 raidDir：別人降落進來的進場卡在前、真正的降落橫幅在後 → 取最後一則
      { id: 'ytcas-raid-in', type: 'raid', runs: [{ text: '@someone 和他們的觀眾剛剛加入' }], timestampAbs: raidAt - 21 * 60e3, phase: 'live' },
      { id: 'ytcas-raid-x', type: 'raid', runs: [{ text: '千萬別錯過！和大家一起收看@target' }], timestampAbs: raidAt, phase: 'live' }] });
    // 新場次 B：被存成 A 的標題；自己的 backlog（@tfan）＋漏進來的 A 訊息（@fan1、@fan2、A 的降落橫幅）
    await DB.saveMessages({ videoId: B, source: 'live', stream: { title: '原直播', channelHandle: '@target', startedAt: t0 + 1800e3, startedAtSource: 'meta-actual' }, messages: [
      mm('b1', B, '@tfan', '演唱中', raidAt - 1800e3), mm('b2', B, '@tfan', '好聽', raidAt + 20 * 60e3),
      mm('leak1', B, '@fan1', '今天拿這麼大的', raidAt + 30e3), mm('leak2', B, '@fan2', '怎麼這樣', raidAt + 60e3),
      { id: 'ytcas-raid-x2', type: 'raid', runs: [{ text: '千萬別錯過！和大家一起收看@target' }], timestampAbs: raidAt + 5e3, phase: 'live' }] });
    // 原場次的彈出視窗又收到 leak1（同 id）→ 合併到 B 那筆，記 crossVideo
    await DB.saveMessages({ videoId: A, source: 'popout', messages: [mm('leak1', A, '@fan1', '今天拿這麼大的', raidAt + 30e3)] });
    const cmp = await BG.streamCompare(A, B);
    eq([cmp.ok, cmp.a.v, cmp.b.v, cmp.titleSame, cmp.channelSame], [true, 'vidR', 'vidR', true, false]);
    eq([cmp.crossVideo.aHitB, cmp.crossVideo.bHitA], [1, 0], 'A 的寫入命中 B 的紀錄 1 次');
    eq(cmp.authors, { a: 2, b: 3, both: 2 });
    // v53（34.2.2）降落出去的那則：舊資料取最後一則（不是 21 分鐘前的進場卡）；新規則的筆數
    eq([cmp.aRaidPick, cmp.aRaidAt], ['last', new Date(raidAt).toISOString()]);
    eq(cmp.leak, { sameAuthorText120s: 1, raidBanner: 1, bAfterDelete: 3, tsSource: { arrival: 1 } }, 'leak1（a4 同作者同內容 10 秒）＋降落橫幅');
    const s = JSON.stringify(cmp);
    assert(!s.includes('原直播') && !s.includes('@fan1') && !s.includes('你好') && !s.includes(A) && !s.includes(B), '不含標題、作者、內容、完整 videoId');
    // fixRaidLeak 預覽 → 執行（刪除新場次的重複；跟著降落過來的 @fan2「怎麼這樣」只在 b → 保留）
    eq((await BG.fixRaidLeak(B, 'vidNOPEnope')).error, 'orig-empty', '原場次 id 打錯');
    const pre = await BG.fixRaidLeak(B, A);
    eq([pre.dryRun, pre.raidPick, pre.sameAuthorText120s, pre.raidBanner, pre.bBefore, pre.bAfter], [true, 'last', 1, 1, 5, 3]);
    eq((await DB.queryMessages(B)).length, 5, '預覽不寫入');
    const ex = await BG.fixRaidLeak(B, A, { dryRun: false });
    eq(ex.deleted, 2);
    eq((await DB.queryMessages(B)).map((m) => m.id).sort(), ['b1', 'b2', 'leak2'], '新場次刪掉重複，其他保留');
    const inA = await DB.queryMessages(A);
    eq([inA.some((m) => m.id === 'a4'), (await DB.getStream(B)).messageCount], [true, 3], '原場次不動、新場次重新計數');
    // 有 raidDir 的資料：用 out 那則（不論先後）
    await DB.saveMessages({ videoId: A, source: 'live', messages: [{ id: 'ytcas-raid-late-in', type: 'raid', raidDir: 'in', runs: [{ text: '@x 和他們的觀眾剛剛加入' }], timestampAbs: raidAt + 600e3, phase: 'live' },
      { id: 'ytcas-raid-out', type: 'raid', raidDir: 'out', runs: [{ text: '千萬別錯過！和大家一起收看@target' }], timestampAbs: raidAt + 1000, phase: 'live' }] });
    const cmp2 = await BG.streamCompare(A, B);
    eq([cmp2.aRaidPick, cmp2.aRaidAt, cmp2.aRaidDirs['(無)'], cmp2.aRaidDirs.in, cmp2.aRaidDirs.out], ['dir', new Date(raidAt + 1000).toISOString(), 2, 1, 1]);
    // 降落暫定結束：照常重新抓取（等 meta 的 endDate）
    const due = BG._metaPollDue('vidZZZZZZZ9', { endedAt: Date.now() - 60e3, endedAtSource: 'raid', startedAt: t0, isLive: true }, Date.now());
    eq(due && due.kind, 'raid-end');
    eq(BG._metaPollDue('vidZZZZZZZ8', { endedAt: Date.now() - 60e3, endedAtSource: 'meta-actual', startedAt: t0, isLive: true }, Date.now()), null, '確定的結束時間：停止');
    // fixStreamMeta：重新抓 watch 頁覆蓋標題
    self.fetch = async () => new Response('<meta name="title" content="杉山唱歌"><meta itemprop="startDate" content="' + new Date(t0 + 1800e3).toISOString() + '">' +
      '<span itemprop="author"><link itemprop="url" href="http://www.youtube.com/@target"><link itemprop="name" content="杉山"></span>', { status: 200 });
    try {
      const fp = await BG.fixStreamMeta(B);
      eq([fp.ok, fp.dryRun, fp.titleChanges, fp.updated], [true, true, true, false]);
      eq((await DB.getStream(B)).title, '原直播', '預覽不寫入');
      const fx = await BG.fixStreamMeta(B, { dryRun: false });
      eq(fx.updated, true);
      eq([(await DB.getStream(B)).title, (await DB.getStream(B)).channelName], ['杉山唱歌', '杉山']);
      const groups = await BG.fixStreamMeta();
      eq(groups.sameTitleGroups, 0, '修正後沒有同標題的組');
    } finally { self.fetch = self.__blockedFetch; }
  });

  test('T6.3（33.3）取消置頂：UNPIN 記 unpinnedAt（以 id 或別名）並推播 PINNED_CHANGED；同一則再置頂（pinnedAt 較晚）→ 清掉 unpinnedAt', async () => {
    await resetAll();
    const t0 = 1_700_500_000_000;
    const pm = (o) => Object.assign({ id: 'pinA', type: 'text', authorHandle: '@host', runs: [{ text: '公告' }], timestampAbs: t0, pinnedAt: t0 }, o);
    await send({ type: 'SAVE_PINNED', videoId: V, message: pm() });
    assert(M.broadcasts.some((b) => b.type === 'PINNED_CHANGED' && b.videoId === V), '新增置頂 → PINNED_CHANGED');
    M.broadcasts.length = 0;
    // 同一則以別的 id 再擷取（重新渲染）→ 合併、記入別名
    await send({ type: 'SAVE_PINNED', videoId: V, message: pm({ id: 'pinA2', pinnedAt: t0 + 1000 }) });
    let r = await send({ type: 'UNPIN', videoId: V, id: 'pinA2', unpinnedAt: t0 + 60e3 });
    eq([r.found, r.changed], [true, true], '以別名找到');
    let p = (await DB.queryPinned(V))[0];
    eq(p.unpinnedAt, t0 + 60e3);
    assert(M.broadcasts.some((b) => b.type === 'PINNED_CHANGED'), '取消 → PINNED_CHANGED');
    eq((await send({ type: 'UNPIN', videoId: V, id: 'pinA', unpinnedAt: t0 + 70e3 })).changed, false, '已取消的不再改');
    eq((await send({ type: 'UNPIN', videoId: V, id: 'nope', unpinnedAt: t0 })).found, false);
    // 再置頂
    M.broadcasts.length = 0;
    await send({ type: 'SAVE_PINNED', videoId: V, message: pm({ pinnedAt: t0 + 120e3 }) });
    p = (await DB.queryPinned(V))[0];
    assert(!('unpinnedAt' in p), '再置頂 → 清掉 unpinnedAt');
    assert(M.broadcasts.some((b) => b.type === 'PINNED_CHANGED'), '再置頂 → PINNED_CHANGED');
    // v53（34 第 4 點）CAPTURE_START 回傳最新、還沒取消的置頂（lastPin）；UNPIN 的 absent 來源
    const cs = await send({ type: 'CAPTURE_START', videoId: V, source: 'live', stream: { channelHandle: '@ch' } });
    eq([cs.allowed, cs.lastPin && cs.lastPin.id], [true, 'pinA']);
    r = await send({ type: 'UNPIN', videoId: V, id: 'pinA', unpinnedAt: t0 + 200e3, unpinnedAtSource: 'absent' });
    p = (await DB.queryPinned(V))[0];
    eq([r.changed, p.unpinnedAt, p.unpinnedAtSource], [true, t0 + 200e3, 'absent']);
    eq((await send({ type: 'CAPTURE_START', videoId: V, source: 'live', stream: { channelHandle: '@ch' } })).lastPin, null, '都取消了 → 沒有 lastPin');
  });

  test('T6.3（33.1 第 6 點）降落自動開彈出視窗：降落橫幅後同一分頁導航到別的影片 → 開一次（popup、不搶焦點、www）並通知分頁；重複導航不重開；設定關閉、已有彈出視窗、超過 3 分鐘都不開', async () => {
    await resetAll();
    const W = self.chrome.windows._created;
    W.length = 0; self.chrome.tabs.sent.length = 0;
    const tab = { id: 41, url: 'https://www.youtube.com/live_chat?continuation=x' };
    await send({ type: 'RAID_SEEN', videoId: 'vidRAIDorg1' }, { id: 'testextid', url: tab.url, tab });
    // 導航（tabs.onUpdated）
    M.listeners.updated[0](41, { url: 'https://www.youtube.com/watch?v=vidTARGET01' });
    await until(() => W.length === 1, 2000, '開彈出視窗');
    eq([W[0].type, W[0].focused, W[0].url], ['popup', false, 'https://www.youtube.com/live_chat?is_popout=1&v=vidRAIDorg1']);
    assert(W[0].width <= 480 && W[0].height <= 720, '小尺寸');
    await until(() => self.chrome.tabs.sent.some((s) => s.tabId === 41 && s.msg.type === 'RAID_POPOUT'), 2000, '通知分頁');
    // 同一場再降落＋導航 → 不重開
    await send({ type: 'RAID_SEEN', videoId: 'vidRAIDorg1' }, { id: 'testextid', url: tab.url, tab });
    eq(await BG._maybeRaidPopout(41, 'https://www.youtube.com/watch?v=vidTARGET02'), 'already-opened');
    // 只是同一部影片的網址變化（例如 &t=）→ 不算導航
    await send({ type: 'RAID_SEEN', videoId: 'vidRAIDorg2' }, { id: 'testextid', url: tab.url, tab });
    eq(await BG._maybeRaidPopout(41, 'https://www.youtube.com/watch?v=vidRAIDorg2&t=5'), null);
    // 設定關閉
    await BG.setRaidAutoPopout(false);
    eq(await BG._maybeRaidPopout(41, 'https://www.youtube.com/watch?v=vidTARGET03'), 'disabled');
    await BG.setRaidAutoPopout(true);
    // 已有同一 videoId 的彈出視窗
    await chrome.storage.session.set({ [C_POP()]: { 77: { videoId: 'vidRAIDorg3', sid: 1, gen: 'g', notified: false } } });
    await send({ type: 'RAID_SEEN', videoId: 'vidRAIDorg3' }, { id: 'testextid', url: tab.url, tab });
    eq(await BG._maybeRaidPopout(41, 'https://www.youtube.com/watch?v=vidTARGET04'), 'has-popout');
    eq(W.length, 1, '只開過一次');
    // 沒有降落的分頁導航 → 不開
    eq(await BG._maybeRaidPopout(99, 'https://www.youtube.com/watch?v=vidTARGET05'), null);
  });
  const C_POP = () => self.YTCAS_CONST.POPOUT_TABS_KEY;

  test('T6.3（33.6）暫時 id 的規則收緊：只限直播來源、一般文字、到達時間、時間差 ≤ 30 秒；重播來源、遷移資料、SC／會員、顯示時間的短 C 開頭 id 不是暫時；預覽列 tempShapes、pairShapes、pairDt', async () => {
    await resetAll();
    U._resetTwins();
    const t0 = 1_700_400_000_000;
    const C28 = (s) => 'CM_E' + s.padEnd(24, 'x');
    const base = (o) => Object.assign({ type: 'text', authorHandle: '@me', runs: [{ text: '同一句' }], tsSource: 'arrival' }, o);
    // 以匯入寫入（不經寫入時合併），各種「形狀符合但不是暫時節點」的資料＋一對真的
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [
      base({ id: C28('rp'), sources: ['replay'], timestampAbs: t0, runs: [{ text: '重播' }] }), base({ id: 'ChwK' + 'r'.repeat(36), sources: ['replay'], timestampAbs: t0 + 5000, runs: [{ text: '重播' }] }),
      base({ id: C28('lg'), sources: ['legacy'], timestampAbs: t0, runs: [{ text: '遷移' }] }), base({ id: 'ChwK' + 'l'.repeat(36), sources: ['legacy'], timestampAbs: t0 + 5000, runs: [{ text: '遷移' }] }),
      base({ id: C28('sc'), type: 'superchat', amount: '$30.00', timestampAbs: t0, runs: [{ text: 'SC' }] }), base({ id: 'ChwK' + 's'.repeat(36), type: 'superchat', amount: '$30.00', timestampAbs: t0 + 5000, runs: [{ text: 'SC' }] }),
      base({ id: C28('ck'), tsSource: 'clock', timestampAbs: t0, runs: [{ text: '顯示時間' }] }), base({ id: 'ChwK' + 'c'.repeat(36), timestampAbs: t0 + 5000, runs: [{ text: '顯示時間' }] }),
      base({ id: C28('far'), timestampAbs: t0, runs: [{ text: '超過30秒' }] }), base({ id: 'ChwK' + 'f'.repeat(36), timestampAbs: t0 + 45000, runs: [{ text: '超過30秒' }] }),
      base({ id: C28('ok'), timestampAbs: t0, runs: [{ text: '真的' }] }), base({ id: 'ChwK' + 'o'.repeat(36), tsSource: 'clock', timestampAbs: t0 + 18000, runs: [{ text: '真的' }] }),
    ] });
    const pre = await BG.fixOwnDuplicates();
    eq([pre.pairs, pre.tempIds, pre.tempShapeMatches], [1, 2, 6], '只有「真的」那對；形狀符合 6、暫時節點 2（真的＋超過 30 秒）');
    eq(pre.pairDt, { le10s: 0, le30s: 1 });
    assert(pre.pairShapes.length === 1 && /CM_E\|28 → ChwK\|40 @ live · text/.test(pre.pairShapes[0].k), 'pairShapes ' + JSON.stringify(pre.pairShapes));
    const ts = pre.tempShapes.map((x) => x.k).join('｜');
    assert(/replay · text · arrival(?! ✓)/.test(ts) && /legacy/.test(ts) && /superchat/.test(ts) && /· clock/.test(ts) && /✓/.test(ts), 'tempShapes 依來源、類型、時間來源分組 ' + ts);
    assert(!JSON.stringify(pre).includes('同一句') && !JSON.stringify(pre).includes('@me'), '不含內容與作者');
    // v53（34.1）作者數：都是 @me → 1、不列分布；沒配對的 1 筆（超過 30 秒）→ twinFar
    eq([pre.tempAuthors, pre.pairAuthors, 'tempAuthorDist' in pre, 'pairAuthorDist' in pre], [1, 1, false, false]);
    eq(pre.tempUnpaired, { noTwin: 0, twinFar: 1, twinUsed: 0, noKey: 0 });
    // 別的作者也有暫時節點形狀（含一筆沒有正式紀錄的）→ 作者數 > 1、列分布（只有數字）
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, messages: [
      base({ id: C28('o1'), authorHandle: '@other', timestampAbs: t0 + 200000, runs: [{ text: '別人' }] }),
      base({ id: C28('o2'), authorHandle: '@other', timestampAbs: t0 + 300000, runs: [{ text: '只有暫時' }] }),
      base({ id: 'ChwK' + 'z'.repeat(36), authorHandle: '@other', tsSource: 'clock', timestampAbs: t0 + 205000, runs: [{ text: '別人' }] }),
    ] });
    const pre2 = await BG.fixOwnDuplicates();
    eq([pre2.pairs, pre2.tempIds, pre2.tempAuthors, pre2.pairAuthors, pre2.tempAuthorDist, pre2.pairAuthorDist], [2, 4, 2, 2, [2, 2], [1, 1]]);
    eq(pre2.tempUnpaired, { noTwin: 1, twinFar: 1, twinUsed: 0, noKey: 0 });
    assert(!JSON.stringify(pre2).includes('@other'), '不含 handle');
    // 寫入時：重播來源的短 C 開頭 id 不合併；直播文字、到達時間、30 秒內才合併
    U._resetTwins();
    await DB.saveMessages({ videoId: V2, source: 'replay', messages: [base({ id: C28('r2'), runs: [{ text: 'R' }], timestampAbs: t0, videoOffsetSec: 1 })] });
    await DB.saveMessages({ videoId: V2, source: 'replay', messages: [base({ id: 'ChwK' + 'q'.repeat(36), runs: [{ text: 'R' }], timestampAbs: t0 + 3000, videoOffsetSec: 4 })] });
    eq((await DB.queryMessages(V2)).length, 2, '重播來源不合併');
    await DB.saveMessages({ videoId: V2, source: 'live', messages: [base({ id: C28('l2'), runs: [{ text: 'L' }], timestampAbs: t0 + 100000 })] });
    await DB.saveMessages({ videoId: V2, source: 'live', messages: [base({ id: 'ChwK' + 'w'.repeat(36), runs: [{ text: 'L' }], tsSource: 'clock', timestampAbs: t0 + 135000 })] });
    eq((await DB.queryMessages(V2)).filter((m) => m.runs[0].text === 'L').length, 2, '直播但超過 30 秒：不合併');
  });

  test('T6.2（32.11）scTiers：依幣別前綴＋顏色統計 SC 筆數與金額範圍；同幣別兩種顏色範圍重疊列為 overlaps；不含名稱與內容', async () => {
    eq(['HK$170.00', 'US$5.00', '¥500', '€5,00', 'NT$1,500.00', '$1,500', '1.500,00 €', ''].map((t) => { const a = BG._parseAmount(t); return [a.prefix, a.value]; }),
      [['HK$', 170], ['US$', 5], ['¥', 500], ['€', 5], ['NT$', 1500], ['$', 1500], ['€', 1500], ['?', null]]);
    await resetAll();
    const sc = (id, amount, color) => ({ id, type: 'superchat', authorHandle: '@秘密', runs: [{ text: '內容' }], amount, color, timestampAbs: 1_700_000_000_000, videoOffsetSec: 1 });
    await DB.saveMessages({ videoId: V, source: 'live', messages: [
      sc('s1', '$150.00', '#ffca28'), sc('s2', '$300.00', '#ffca28'), sc('s3', '$170.00', '#1de9b6'), sc('s4', '$75.00', '#1de9b6'),
      sc('s5', 'HK$170.00', '#1de9b6'), sc('s6', '$15.00', '#1e88e5'), sc('s7', '', '#1e88e5'),
    ] });
    const r = await BG.scTiers();
    eq([r.total, r.noAmount], [7, 1]);
    const t = (cur, color) => r.tiers.find((x) => x.currency === cur && x.color === color);
    eq([t('$', '#1de9b6').n, t('$', '#1de9b6').min, t('$', '#1de9b6').max], [2, 75, 170]);
    eq([t('HK$', '#1de9b6').n, t('$', '#ffca28').min, t('$', '#ffca28').max], [1, 150, 300]);
    eq(r.overlaps.map((o) => [o.currency, o.a, o.b]), [['$', '#1de9b6 75～170', '#ffca28 150～300']], '同幣別 $170 綠松與 $150 黃色重疊');
    assert(!JSON.stringify(r).includes('秘密') && !JSON.stringify(r).includes('內容') && !JSON.stringify(r).includes(V), '不含名稱、內容、videoId');
  });

  test('T6.2（32.8）streamTimes 的 firstStartSource：待機室→開播先由播放器訊號（signal）得知、之後被 meta-actual 覆蓋 → 第一次的來源仍是 signal', async () => {
    await resetAll();
    const sched = Date.now() - 30e3;
    await DB.saveMessages({ videoId: V, source: 'live', stream: { scheduledStartAt: sched, startPending: true }, messages: [] });
    eq((await BG.streamTimes(V)).firstStartSource, null, '還沒開播');
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: sched + 5e3, startedAtSource: 'signal' }, messages: [] });
    await DB.saveMessages({ videoId: V, source: 'live', stream: { startedAt: sched + 2e3, startedAtSource: 'meta-actual' }, messages: [] });
    const tm = await BG.streamTimes(V);
    eq([tm.startedAtSource, tm.firstStartSource, typeof tm.firstStartKnown], ['meta-actual', 'signal', 'string']);
  });

  // ---------------------------------------------------------------- v51（T6.2，審查十一 32.7）未來時間
  test('T6.2 fixFutureTimes（32.7）：時間晚於寫入時間的直播訊息往前推整天、phase／offset 依場次重算、標 clock-ambiguous；預覽只回傳筆數與場次（4 碼）；到達時間與重播不動；寫入時保底', async () => {
    await resetAll();
    const w = Date.now() - 3600e3; // 一小時前寫入
    const DAY = 86400e3;
    const start = w - 600e3; // 已開播 10 分鐘
    const base = { type: 'text', authorHandle: '@x', runs: [{ text: '舊' }] };
    // 以匯入（preserve）寫入：不經過寫入時的保底 → 模擬 v50 存下的資料
    await DB.saveMessages({ videoId: V, source: 'live', preserve: true, stream: { startedAt: start, startedAtSource: 'meta-actual' }, messages: [
      Object.assign({ id: 'fut1', timestampAbs: w + 3 * 3600e3, tsSource: 'clock', phase: 'live', videoOffsetSec: 11400, firstSeenAt: w, sources: ['live'] }, base),
      Object.assign({ id: 'fut2', timestampAbs: w + 4 * 60e3, tsSource: 'clock', phase: 'live', videoOffsetSec: 840, firstSeenAt: w, sources: ['live'] }, base),
      Object.assign({ id: 'ok1', timestampAbs: w - 60e3, tsSource: 'clock', phase: 'live', videoOffsetSec: 540, firstSeenAt: w, sources: ['live'] }, base),
      Object.assign({ id: 'arr1', timestampAbs: w + 30e3, tsSource: 'arrival', phase: 'live', videoOffsetSec: 630, firstSeenAt: w, sources: ['live'] }, base),
    ] });
    // preserve 時 stream 也要有開播時間
    await DB.recomputeStream(V, { startedAt: start, dryRun: false });
    const pre = await BG.fixFutureTimes();
    eq([pre.dryRun, pre.messages, pre.phaseChanged, pre.streams], [true, 2, 2, [{ v: V.slice(0, 4), n: 2 }]]);
    eq((await DB.queryMessages(V)).find((m) => m.id === 'fut1').timestampAbs, w + 3 * 3600e3, '預覽不寫入');
    const ex = await BG.fixFutureTimes({ dryRun: false });
    eq(ex.fixed, 2);
    const by = new Map((await DB.queryMessages(V)).map((m) => [m.id, m]));
    eq([by.get('fut1').timestampAbs, by.get('fut1').phase, by.get('fut1').tsSource], [w + 3 * 3600e3 - DAY, 'pre', 'clock-ambiguous'], '往前推一天 → 開播前');
    eq(by.get('fut1').videoOffsetSec, Math.round((w + 3 * 3600e3 - DAY - start) / 100) / 10, 'offset 重算（負值）');
    eq(by.get('fut2').timestampAbs, w + 4 * 60e3 - DAY);
    eq([by.get('ok1').timestampAbs, by.get('arr1').timestampAbs], [w - 60e3, w + 30e3], '不在未來的、到達時間的不動');
    assert((await DB.getStream(V)).lastMessageAt <= w + 60e3, 'lastMessageAt 重算');
    eq((await BG.fixFutureTimes()).messages, 0, '重跑為 0');
    // 寫入時保底（舊版擷取端）：未來 3 小時的顯示時間 → 往前推一天
    const r = await DB.saveMessages({ videoId: V, source: 'live', messages: [Object.assign({ id: 'fut3', timestampAbs: Date.now() + 3 * 3600e3, tsSource: 'clock', phase: 'live', videoOffsetSec: 1 }, base)] });
    eq(r.futureFixed, 1);
    const f3 = (await DB.queryMessages(V)).find((m) => m.id === 'fut3');
    assert(f3.timestampAbs <= Date.now() && f3.tsSource === 'clock-ambiguous', '寫入時往前推');
    assert(!JSON.stringify(pre).includes('舊') && !JSON.stringify(pre).includes('@x'), '預覽不含內容');
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
