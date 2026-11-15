// 寫入壓力測試（SPEC 第 7 節「寫入效能」，review-2026-11-15-5 §3.1）。
// 結果顯示在頁面並存於 window.__stress。只輸出筆數與耗時，資料為虛構內容。
(function () {
  'use strict';
  const DB = self.YTCAS_DB;
  const M = self.__mock;
  const qs = new URLSearchParams(location.search);
  const MINUTES = Number(qs.get('minutes') || 30);
  const RATE = Number(qs.get('rate') || 20);          // 每秒則數
  const TOTAL = Number(qs.get('total') || 100000);     // 連續寫入總數下限
  const REALTIME = qs.get('realtime') === '1';
  const BATCH = REALTIME ? RATE : 50;                  // 即時模式：1 秒保底計時器的批次；加速模式：滿 50 筆送出
  const P95_LIMIT_MS = 100;

  const $ = (id) => document.getElementById(id);
  const status = (s) => { $('status').textContent = s; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const CONTENT = { id: 'testextid', url: 'https://www.youtube.com/live_chat?v=x', tab: { id: 1 } };
  function send(msg) {
    return new Promise((resolve) => {
      let done = false;
      const ret = M.listeners.message[0](msg, CONTENT, (r) => { done = true; resolve(r); });
      if (ret !== true && !done) resolve(undefined);
    });
  }

  // ---------------------------------------------------------------- 虛構訊息
  let rnd = 12345;
  const rand = () => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd / 4294967296; };
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const WORDS = ['草', '好耶', 'lol', '8888', '晚安', 'GG', '可愛', '笑死', 'nice', '加油', '辛苦了', '？？？', 'www', '來了', '欸'];
  const AUTHORS = Array.from({ length: 2000 }, (_, i) => '@viewer' + i.toString(36));
  function makeMsg(i, t0, startedAt) {
    const ts = t0 + Math.round(i * 1000 / RATE);
    const n = 1 + Math.floor(rand() * 6);
    const runs = [];
    for (let k = 0; k < n; k++) {
      if (rand() < 0.15) runs.push({ emoji: { src: 'https://yt3.ggpht.com/emoji/' + Math.floor(rand() * 500) + '=w24-h24-c-k-nd', alt: ':e' + Math.floor(rand() * 500) + ':', shortcut: '' } });
      else runs.push({ text: pick(WORDS) + (rand() < 0.3 ? ' ' + Math.floor(rand() * 1000) : '') });
    }
    const author = pick(AUTHORS);
    const m = {
      id: 'Ch' + i.toString(36).padStart(8, '0') + 'x' + Math.floor(rand() * 1e9).toString(36),
      type: rand() < 0.01 ? 'superchat' : 'text',
      authorHandle: author, authorName: '', authorUrl: 'https://www.youtube.com/' + author,
      authorAvatar: 'https://yt4.ggpht.com/ytc/' + author.slice(1) + '=s64-c-k-c0x00ffffff-no-rj',
      authorBadges: rand() < 0.2 ? ['member'] : [], runs, timestampAbs: ts,
      videoOffsetSec: Math.round((ts - startedAt) / 100) / 10, phase: 'live',
    };
    if (m.type === 'superchat') { m.amount = 'NT$75.00'; m.color = 'rgba(30,136,229,1)'; }
    return m;
  }

  // ---------------------------------------------------------------- 量測
  function stats(times) {
    const s = times.slice().sort((a, b) => a - b);
    const at = (p) => s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : 0;
    const sum = s.reduce((a, b) => a + b, 0);
    return { batches: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] || 0, avg: s.length ? sum / s.length : 0 };
  }
  const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : null);
  const memSamples = [];
  const slow = []; // 超過指標的批次：{ label, batch, ms, t }（找出偶發長延遲的位置）
  let written = 0;
  let errors = 0;

  // list：陣列，或 { length, at(i, n) } 產生器（長時間測試逐批產生資料，不把整份資料留在記憶體）
  async function runBatches(label, list, base, opts) {
    opts = opts || {};
    const times = [];
    const tot = { added: 0, merged: 0, unchanged: 0, fpMerged: 0 };
    const tStart = performance.now();
    const get = Array.isArray(list) ? (i, n) => list.slice(i, i + n) : list.at;
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = get(i, Math.min(BATCH, list.length - i));
      const t = performance.now();
      const r = await send(Object.assign({ type: 'SAVE_MESSAGES', messages: batch }, base));
      const ms = performance.now() - t;
      times.push(ms);
      if (ms > P95_LIMIT_MS) slow.push({ label, batch: i / BATCH, ms: Math.round(ms), atSec: Math.round((performance.now() - T_PAGE) / 1000) });
      M.broadcasts.length = 0; // 假物件會累積推播，清掉以免影響記憶體量測
      if (!r || r.ok !== true) { errors++; continue; }
      for (const k of Object.keys(tot)) tot[k] += r[k] || 0;
      written += batch.length;
      if (opts.sampleMem && written % 2000 < BATCH) memSamples.push({ written, heap: heap() });
      if (REALTIME) await sleep(Math.max(0, 1000 - (performance.now() - t)));
      if ((i / BATCH) % 40 === 0) { status(`${label}：${Math.min(i + BATCH, list.length)}／${list.length}（累計 ${written}）`); await sleep(0); }
    }
    const st = stats(times);
    return Object.assign({ label, messages: list.length, seconds: (performance.now() - tStart) / 1000 }, st, tot);
  }
  const T_PAGE = performance.now();

  async function capture(videoId, source, duration, stream) {
    const r = await send({ type: 'CAPTURE_START', videoId, source, duration, stream });
    if (!r || !r.ok) throw new Error('CAPTURE_START 失敗');
    return r;
  }

  async function main() {
    status('清除測試資料庫…');
    await DB.close();
    await req(indexedDB.deleteDatabase(M.TEST_DB));
    for (const a of ['sync', 'local', 'session']) chrome.storage[a]._reset();
    const results = [];
    const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
    const N = MINUTES * 60 * RATE;

    // 1. 直播 N 則；每批混入上一批 3% 的重複 id（模擬重新整理、回溯擷取重疊）
    const V1 = 'stressVid001';
    const stream1 = { title: '壓力測試 1', channelName: '測試頻道', channelHandle: '@stresstest', isLive: true, startedAt: T0 };
    let s = await capture(V1, 'live', null, stream1);
    const live = Array.from({ length: N }, (_, i) => makeMsg(i, T0, T0));
    const liveMixed = [];
    for (let i = 0; i < live.length; i += BATCH) {
      const b = live.slice(i, i + BATCH);
      liveMixed.push(...b);
      if (i > 0) for (let k = 0; k < Math.ceil(BATCH * 0.03); k++) liveMixed.push(live[i - 1 - k]);
    }
    results.push(await runBatches(`直播 ${MINUTES} 分鐘（${RATE} 則／秒，含 3% 重複 id）`, liveMixed,
      { videoId: V1, stream: stream1, captureSessionId: s.captureSessionId, source: 'live' }));

    // 2. 重播：同 id（id 命中路徑），offset 改為重播整數秒
    s = await capture(V1, 'replay', MINUTES * 60 + 30, null);
    const replaySame = live.map((m) => Object.assign({}, m, { videoOffsetSec: Math.round(m.videoOffsetSec), timestampAbs: T0 + Math.round(m.videoOffsetSec) * 1000 }));
    results.push(await runBatches('重播（同 id）', replaySame, { videoId: V1, captureSessionId: s.captureSessionId, source: 'replay' }));

    // 3. 直播 1/6 量 → 重播 id 全部不同（別名＋指紋查找路徑，最壞情況）
    const V2 = 'stressVid002';
    const n2 = Math.round(N / 6);
    const stream2 = { title: '壓力測試 2', channelHandle: '@stresstest', isLive: true, startedAt: T0 };
    s = await capture(V2, 'live', null, stream2);
    const live2 = Array.from({ length: n2 }, (_, i) => makeMsg(i + 10_000_000, T0, T0));
    results.push(await runBatches('直播（供 id 不同的重播比對）', live2, { videoId: V2, stream: stream2, captureSessionId: s.captureSessionId, source: 'live' }));
    s = await capture(V2, 'replay', Math.round(n2 / RATE) + 30, null);
    const replayDiff = live2.map((m) => Object.assign({}, m, { id: 'R' + m.id, videoOffsetSec: Math.round(m.videoOffsetSec), timestampAbs: T0 + Math.round(m.videoOffsetSec) * 1000 }));
    results.push(await runBatches('重播（id 全部不同：別名＋指紋）', replayDiff, { videoId: V2, captureSessionId: s.captureSessionId, source: 'replay' }));

    // 4. 同一場連續寫入 TOTAL 則（不出錯、記憶體不持續增長）。逐批產生資料，不保留整份陣列；
    //    前面情境的測試資料先釋放，記憶體只在這一段取樣。
    live.length = 0; liveMixed.length = 0; replaySame.length = 0; live2.length = 0; replayDiff.length = 0;
    const V3 = 'stressVid003';
    const st3 = { title: '壓力測試 3', channelHandle: '@stresstest', isLive: true, startedAt: T0 };
    const c3 = await capture(V3, 'live', null, st3);
    const gen = { length: TOTAL, at: (i, n) => Array.from({ length: n }, (_, j) => makeMsg(i + j + 30_000_000, T0, T0)) };
    results.push(await runBatches(`連續寫入 ${TOTAL} 則（同一場，逐批產生）`, gen,
      { videoId: V3, stream: st3, captureSessionId: c3.captureSessionId, source: 'live' }, { sampleMem: true }));

    // 最終筆數核對
    status('核對筆數…');
    const counts = {};
    counts[V1] = (await DB.queryMessages(V1)).length;
    const v2Msgs = await DB.queryMessages(V2);
    counts[V2] = v2Msgs.length;
    const v2Replay = v2Msgs.filter((m) => (m.sources || []).includes('replay')).length;
    v2Msgs.length = 0;
    counts[V3] = (await DB.getStream(V3)).messageCount;
    const total = await DB.countAll();
    const expectV1 = N, expectV2 = n2, expectV3 = TOTAL;

    // 記憶體趨勢：前 1/4 與後 1/4 樣本的平均
    let mem = null;
    const hs = memSamples.filter((x) => x.heap != null);
    if (hs.length >= 8) {
      const q = Math.floor(hs.length / 4);
      const avg = (a) => a.reduce((x, y) => x + y.heap, 0) / a.length;
      mem = { first: avg(hs.slice(0, q)), last: avg(hs.slice(-q)), samples: hs.length };
      mem.ratio = mem.last / mem.first;
    }

    const pass = {
      p95: results.every((r) => r.p95 <= P95_LIMIT_MS),
      errors: errors === 0,
      total: counts[V3] === expectV3,
      counts: counts[V1] === expectV1 && counts[V2] === expectV2 && v2Replay === expectV2,
      memory: mem ? mem.ratio < 1.5 : null,
    };
    window.__stress = { config: { MINUTES, RATE, TOTAL, BATCH, REALTIME }, results, counts, expect: { [V1]: expectV1, [V2]: expectV2, [V3]: expectV3 }, v2Replay, total, written, errors, mem, memSamples, slow, pass };
    render(window.__stress);
    status(Object.values(pass).every((v) => v !== false) ? '完成：全部達標' : '完成：有項目未達標');
  }

  function render(R) {
    const f = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v));
    const rows = R.results.map((r) => `<tr><td>${r.label}${r.note ? '（' + r.note + '）' : ''}</td><td>${r.messages}</td><td>${r.batches}</td><td>${f(r.p50)}</td><td class="${r.p95 <= P95_LIMIT_MS ? 'ok' : 'ng'}">${f(r.p95)}</td><td>${f(r.p99)}</td><td>${f(r.max)}</td><td>${f(r.messages / r.seconds)}</td><td>${r.added}</td><td>${r.merged}</td><td>${r.unchanged}</td><td>${r.fpMerged}</td></tr>`).join('');
    const mark = (b) => (b === null ? '<span class="mut">—（無 performance.memory）</span>' : b ? '<span class="ok">通過</span>' : '<span class="ng">未通過</span>');
    $('out').innerHTML = `
      <p>設定：每秒 ${R.config.RATE} 則 × ${R.config.MINUTES} 分鐘，每批 ${R.config.BATCH} 則，${R.config.REALTIME ? '即時' : '加速'}模式；總寫入 ${R.written} 則，錯誤 ${R.errors} 批。</p>
      <table><tr><th>情境</th><th>則數</th><th>批數</th><th>P50 ms</th><th>P95 ms</th><th>P99 ms</th><th>最大 ms</th><th>則／秒</th><th>新增</th><th>合併</th><th>未變</th><th>指紋合併</th></tr>${rows}</table>
      <ul>
        <li>P95 ≤ ${P95_LIMIT_MS}ms：${mark(R.pass.p95)}</li>
        <li>同一場連續寫入 ${R.config.TOTAL} 則不出錯（場次 3 = ${R.counts.stressVid003} 則）：${mark(R.pass.total && R.pass.errors)}</li>
        <li>最終筆數：場次 1 = ${R.counts.stressVid001}（預期 ${R.expect.stressVid001}）、場次 2 = ${R.counts.stressVid002}（預期 ${R.expect.stressVid002}，其中含 replay 來源 ${R.v2Replay}）；資料庫總計 ${JSON.stringify(R.total)}：${mark(R.pass.counts)}</li>
        <li>記憶體（JS heap，只取連續寫入那一段；前 1/4 與後 1/4 樣本平均）：${R.mem ? (R.mem.first / 1048576).toFixed(1) + ' MB → ' + (R.mem.last / 1048576).toFixed(1) + ' MB（×' + R.mem.ratio.toFixed(2) + '，' + R.mem.samples + ' 個樣本）' : '—'}：${mark(R.pass.memory)}</li>
        <li>超過 ${P95_LIMIT_MS}ms 的批次：${R.slow.length} 批${R.slow.length ? '（' + R.slow.slice(0, 20).map((s) => s.label.slice(0, 8) + '#' + s.batch + ' ' + s.ms + 'ms @' + s.atSec + 's').join('、') + '）' : ''}</li>
      </ul>`;
  }

  main().catch((e) => { status('失敗：' + (e && e.message)); console.error(e); window.__stress = { error: String(e && e.stack || e) }; });
})();
