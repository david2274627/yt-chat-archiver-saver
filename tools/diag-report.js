#!/usr/bin/env node
// F-20 診斷記錄分析：讀取匯出檔（ytcas-diag-*.json），產生 Markdown 摘要（時間軸、各探針統計、異常列表）。
// 用法：node tools/diag-report.js docs/diag/raw/ytcas-diag-20261116-2030.json docs/diag/diag-summary-2026-11-16-2030.md
// 原始匯出檔（含觀看過的 videoId 與時間）放 docs/diag/raw/（.gitignore），只 commit 產生的摘要（videoId 只留前 4 碼）
// 沒有相依套件（CLAUDE.md）。匯出檔本身只有筆數、標籤、屬性名稱、時間與 videoId。
'use strict';
const fs = require('fs');

function pad(n) { return String(n).padStart(2, '0'); }
function hm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function dt(ms) { if (!ms) return '—'; const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm(ms); }
const esc = (s) => String(s == null ? '—' : s).replace(/\|/g, '\\|');
// T3.8（審查十追加七 B-2）：摘要會 commit 進 repo → videoId 只保留前 4 碼（原始匯出檔放 docs/diag/raw/，不進 git）
const vid4 = (v) => (typeof v === 'string' && v.length > 4 && v !== '—' ? v.slice(0, 4) + '…' : v);
const short = (o, n) => { const s = JSON.stringify(o); return s.length > (n || 160) ? s.slice(0, n || 160) + '…' : s; };

function report(data) {
  if (!data || data.format !== 'ytcas-diag') throw new Error('不是 ytcas 診斷匯出檔（format 應為 ytcas-diag）');
  const recs = (data.records || []).slice().sort((a, b) => a.ts - b.ts);
  const out = [];
  const L = (s) => out.push(s == null ? '' : s);
  const byProbe = {};
  for (const r of recs) (byProbe[r.probe] = byProbe[r.probe] || []).push(r);

  L('# 診斷記錄摘要');
  L();
  L('| 項目 | 內容 |');
  L('|---|---|');
  L('| 套件版本 | ' + esc(data.version) + ' |');
  L('| Chrome | ' + esc(data.chrome) + ' |');
  L('| 時段 | ' + dt(data.period && data.period.startAt) + ' ～ ' + dt((data.period && (data.period.stoppedAt || data.period.endsAt))) +
    (data.period && data.period.reason ? '（停止原因：' + data.period.reason + '）' : '') + ' |');
  L('| 探針 | ' + esc((data.probes || []).join('、')) + ' |');
  L('| 紀錄 | ' + recs.length + ' 筆（' + Object.keys(byProbe).sort().map((p) => p + ' ' + byProbe[p].length).join('、') + '） |');
  if (recs.length) L('| 實際涵蓋 | ' + dt(recs[0].ts) + ' ～ ' + dt(recs[recs.length - 1].ts) + ' |');
  L();

  const anomalies = [];
  const notes = []; // v48：暫時狀態等不需處理、但值得記下的事

  // ---- P1 收錄統計：各聊天室（videoId × source × 分頁）
  const p1 = byProbe.P1 || [];
  const groups = new Map();
  for (const r of p1) {
    if (!r.data || r.kind === 'diag-start' || r.kind === 'diag-stop') continue;
    const c = r.ctx || {};
    const k = [r.data.videoId || c.videoId || '—', r.data.source || c.source || '—', c.tab != null ? c.tab : '—', c.env || '—'].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  if (groups.size) {
    L('## P1 收錄統計（各聊天室，最後一筆）');
    L();
    L('| videoId | 來源 | 分頁 | 環境 | 期間 | 筆數 | captured | added | idMerged | fpMerged | dupCaptured | dropped | rejected | domNodes 最大 | 未擷取 最大 | 開播時間來源 |');
    L('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, list] of groups) {
      const [vidFull, src, tab, env] = k.split('|');
      const vid = vid4(vidFull);
      const last = list[list.length - 1].data;
      const maxDom = Math.max(...list.map((r) => r.data.domNodes || 0));
      const maxUn = Math.max(...list.map((r) => r.data.unmarkedNodes || 0));
      const times = last.times || {};
      L('| ' + [vid, src, tab, env, hm(list[0].ts) + '～' + hm(list[list.length - 1].ts), list.length, last.captured, last.added, last.idMerged, last.fpMerged,
        last.dupCaptured, last.dropped, last.rejected, maxDom, maxUn,
        (times.startedAtSource || (times.startPending ? 'startPending' : '—'))].map(esc).join(' | ') + ' |');
      if (maxDom > 50) anomalies.push('P1 ' + vid + '（' + src + '）：domNodes 最大 ' + maxDom + '（F-01 上限 50）');
      if (maxUn > 5) anomalies.push('P1 ' + vid + '（' + src + '）：未擷取節點最大 ' + maxUn + '（AC ≤ 5）');
      if (last.dropped > 0) anomalies.push('P1 ' + vid + '（' + src + '）：dropped ' + last.dropped);
      if (last.rejected > 0) anomalies.push('P1 ' + vid + '（' + src + '）：rejected ' + last.rejected);
      // v48（T5.7，審查十一 28.1）itemsIsCurrent: false＝統計當下 observer 沒掛在目前的 #items（YouTube 換了列表、下一次定時檢查還沒跑）。
      // 單次是暫時狀態（v48 起統計時立即重新掛上並回溯擷取）；連續 2 筆以上才列入異常
      const stale = list.map((r) => r.data.itemsIsCurrent === false && r.data.mode === 'capturing');
      const staleRun = stale.reduce((a, x) => (x ? { cur: a.cur + 1, max: Math.max(a.max, a.cur + 1) } : { cur: 0, max: a.max }), { cur: 0, max: 0 }).max;
      if (staleRun >= 2) anomalies.push('P1 ' + vid + '：收錄中連續 ' + staleRun + ' 筆 itemsIsCurrent: false（observer 沒跟上 YouTube 換掉的列表）');
      else if (staleRun === 1) notes.push('P1 ' + vid + '：收錄中出現 1 次 itemsIsCurrent: false（YouTube 換了列表，下一次檢查已重新掛上；不影響收錄）');
      if (typeof last.f12 === 'string' && last.f12.startsWith('failed')) anomalies.push('P1 ' + vid + '：F-12 ' + last.f12);
      // 間隔：每分鐘一筆，超過 3 分鐘視為空檔（分頁被節流、SW 無回應、頁面關閉等）
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].ts - list[i - 1].ts;
        if (gap > 3 * 60000 && list[i].kind !== 'stats-final') anomalies.push('P1 ' + vid + '（' + src + '）：' + hm(list[i - 1].ts) + '～' + hm(list[i].ts) + ' 沒有統計（' + Math.round(gap / 60000) + ' 分鐘）');
      }
    }
    L();
    // v48（T5.7，審查十一 28.1、28.3、28.4）時間來源、背景擷取、禮物圖片延遲補送、列表更換（最後一筆的累計值；v47 以前的記錄沒有這些欄位）
    const ext = [...groups].filter(([, list]) => list[list.length - 1].data.tsSource);
    if (ext.length) {
      L('### P1 時間來源與背景擷取（v48）');
      L();
      L('arrival＝到達時間（秒級）、clock＝聊天室顯示的分鐘（面板顯示「≈」）、capture＝讀不到時間。背景＝擷取當下分頁在背景（`document.hidden`）；一批＝同一次回呼新增超過 2 則（節流後成批到達，改用顯示時間）。');
      L();
      L('| videoId | 來源 | arrival | clock | capture | clock 比例 | 背景擷取 | 背景回呼 | 一批（回呼／訊息） | 最大批次 | 禮物圖片補送／放棄 | 換列表／統計時補掛 |');
      L('|---|---|---|---|---|---|---|---|---|---|---|---|');
      for (const [k, list] of ext) {
        const [vidFull, src] = k.split('|');
        const d = list[list.length - 1].data, t = d.tsSource || {}, h = d.hidden || {};
        const tot = (t.arrival || 0) + (t.clock || 0) + (t.capture || 0);
        L('| ' + [vid4(vidFull), src, t.arrival, t.clock, t.capture, tot ? Math.round((t.clock || 0) / tot * 100) + '%' : '—', h.captured, h.batches, (h.bulk || 0) + '／' + (h.bulkMsgs || 0), h.batchMax,
          (d.giftLate ?? '—') + '／' + (d.giftMissing ?? '—'), (d.itemsSwaps ?? '—') + '／' + (d.itemsStaleHeals ?? '—')].map(esc).join(' | ') + ' |');
      }
      L();
    }
    // v51（T6.2，審查十一 32.2、32.7）自己送出的訊息（合併次數與事件次數分開）、時間解析
    const ownG = [...groups].filter(([, list]) => list[list.length - 1].data.own);
    if (ownG.length) {
      L('### P1 自己送出的訊息與時間解析（v50／v51）');
      L();
      L('**合併**＝真的把暫時節點與正式節點合成一筆的次數（暫時 id／頁面移除 10 秒內／列表被換掉／事後配對／同一個節點原地改 id）。**事件**＝觀察到的次數，大多不會合併（YouTube 重新設定 id、重新排版）。v50 的記錄只有 `replaced`／`inPlace`／`pageRemoved`（後兩者是事件次數）。v54：原地的括號內＝其中暫時 id → 正式 id 的次數（tempAliased，正式 id 為主、暫時 id 記為別名）；事件的「離開頁面時改 id」＝插回時 id 已不同。clockFuture＝顯示時間以「今天」解讀會在未來、已往前推整天的筆數；clock-ambiguous＝依順序重建後早於擷取超過 24 小時。');
      L();
      L('| videoId | 來源 | 暫時 id 出現 | 合併：暫時 id／頁面移除／換列表／事後／原地 | 事件：id 改變（從空白）／頁面移除／離開頁面時改 id | 最近合併的 id 形狀 | clockFuture | clock-ambiguous |');
      L('|---|---|---|---|---|---|---|---|');
      for (const [k, list] of ownG) {
        const [vidFull, src] = k.split('|');
        const d = list[list.length - 1].data, o = d.own;
        const mg = o.merged || { temp: '—', removed: '—', swap: '—', late: o.late, inPlace: '—' };
        const ev = o.events || { idChanges: o.inPlace, idFromEmpty: '—', pageRemoved: o.pageRemoved };
        const recent = (o.recent || []).map((x) => (x.oldId ? x.oldId.p + '|' + x.oldId.len : '?') + '→' + (x.newId ? x.newId.p + '|' + x.newId.len : '?') + (x.rule ? '（' + x.rule + '）' : '')).join('、');
        L('| ' + [vid4(vidFull), src, o.tempSeen + (o.tempStored != null ? '（存 ' + o.tempStored + '／等 ' + o.tempPending + '／沒等到 ' + o.tempDropped + '）' : ''), o.merged ? [mg.temp, mg.removed, mg.swap, mg.late, mg.inPlace + (o.tempAliased != null ? '（' + o.tempAliased + '）' : '')].join('／') : 'v50：replaced ' + o.replaced + '、late ' + o.late,
          ev.idChanges + '（' + ev.idFromEmpty + '）／' + ev.pageRemoved + (ev.whileDetached != null ? '／' + ev.whileDetached : ''), recent || '—', d.clockFuture ?? '—', d.clockAmbiguous ?? '—'].map(esc).join(' | ') + ' |');
      }
      L();
    }
  }

  // ---- P2 節點分類
  const p2 = byProbe.P2 || [];
  if (p2.length) {
    const tags = {};
    let maxTotal = 0;
    for (const r of p2) {
      maxTotal = Math.max(maxTotal, r.data.total || 0);
      for (const [t, b] of Object.entries(r.data.byTag || {})) {
        const x = tags[t] || (tags[t] = { saved: 0, skip: 0, unsaved: 0, maxUnsaved: 0, n: 0 });
        x.saved += b.saved || 0; x.skip += b.skip || 0; x.unsaved += b.unsaved || 0; x.n++;
        x.maxUnsaved = Math.max(x.maxUnsaved, b.unsaved || 0);
      }
    }
    L('## P2 訊息列表節點（' + p2.length + ' 次取樣，節點總數最大 ' + maxTotal + '）');
    L();
    L('| 標籤 | 出現次數 | 已存（累計） | 略過（累計） | 未存（累計） | 單次未存最大 |');
    L('|---|---|---|---|---|---|');
    for (const [t, x] of Object.entries(tags).sort((a, b) => b[1].saved - a[1].saved)) L('| ' + [t, x.n, x.saved, x.skip, x.unsaved, x.maxUnsaved].map(esc).join(' | ') + ' |');
    L();
    if (maxTotal > 50) anomalies.push('P2：#items 節點總數最大 ' + maxTotal);
  }

  // ---- P5 場次摘要（最後一筆）
  const p5 = (byProbe.P5 || []).filter((r) => r.kind === 'stream');
  if (p5.length) {
    const last = new Map();
    for (const r of p5) last.set(vid4((r.ctx && r.ctx.videoId) || '—'), r);
    L('## P5 場次摘要（各場最後一筆）');
    L();
    L('| videoId | 時間 | 類型 | phase | 收錄紀錄 | 來源 | 進行中 | 重新載入 | 開播時間來源 | 等待確認 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    for (const [vid, r] of last) {
      const d = r.data;
      L('| ' + [vid, hm(r.ts), short(d.types, 80), short(d.phases, 60), d.sessions, short(d.bySource, 60), d.open, d.reloads,
        d.times && d.times.startedAtSource, d.times && d.times.startPending].map(esc).join(' | ') + ' |');
    }
    L();
  }

  // ---- P9 記憶體（T4.2）：各分頁 × 環境的時間序列（超過 24 列時平均抽樣，保留第一與最後一筆）
  const p9 = (byProbe.P9 || []).filter((r) => r.kind === 'memory' && r.data);
  if (p9.length) {
    const g9 = new Map();
    for (const r of p9) {
      const c = r.ctx || {};
      const k = [c.tab != null ? c.tab : '—', c.env || '—', vid4(c.videoId || '—')].join('|');
      if (!g9.has(k)) g9.set(k, []);
      g9.get(k).push(r);
    }
    const p9Min = data.p9Minutes || (byProbe.P1 || []).map((r) => r.data && r.data.p9Minutes).find((x) => typeof x === 'number') || 5;
    L('## P9 記憶體（每 ' + p9Min + ' 分鐘）');
    L();
    L('同源的 top 與聊天室 iframe 通常共用同一個 V8 heap，兩邊的 heap 數字可能相同；各 frame 的差異看 DOM 節點數。`panel` 是面板 viewer（擴充功能 origin，另一個程序）。`performance.memory` 的數值有量化誤差，只看趨勢。');
    L();
    L('| 分頁 | 環境 | videoId | 期間 | 筆數 | used heap 首→末（MB） | used 最大 | 每小時變化 | DOM 節點 首→末 | #items 最大 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, list] of g9) {
      const [tab, env, vid] = k.split('|');
      const a = list[0], b = list[list.length - 1];
      const used = list.map((r) => r.data.usedJSHeapMB).filter((x) => typeof x === 'number');
      const hours = (b.ts - a.ts) / 3600000;
      const du = typeof a.data.usedJSHeapMB === 'number' && typeof b.data.usedJSHeapMB === 'number' ? b.data.usedJSHeapMB - a.data.usedJSHeapMB : null;
      const items = list.map((r) => r.data.itemsNodes).filter((x) => typeof x === 'number');
      L('| ' + [tab, env, vid, hm(a.ts) + '～' + hm(b.ts), list.length, a.data.usedJSHeapMB + ' → ' + b.data.usedJSHeapMB,
        used.length ? Math.max(...used) : '—', du != null && hours >= 0.25 ? (du / hours).toFixed(1) : '—',
        a.data.domNodes + ' → ' + b.data.domNodes, items.length ? Math.max(...items) : '—'].map(esc).join(' | ') + ' |');
      if (du != null && hours >= 0.5 && du > 100 && du > a.data.usedJSHeapMB * 0.5) {
        anomalies.push('P9 ' + env + '（分頁 ' + tab + '）JS heap ' + hours.toFixed(1) + ' 小時內增加 ' + du.toFixed(0) + ' MB（' + a.data.usedJSHeapMB + ' → ' + b.data.usedJSHeapMB + '）');
      }
    }
    L();
    for (const [k, list] of g9) {
      const [tab, env, vid] = k.split('|');
      const pick = list.length <= 24 ? list : Array.from({ length: 24 }, (_, i) => list[Math.round(i * (list.length - 1) / 23)]);
      L('### ' + env + '（分頁 ' + tab + '，' + vid + '）');
      L();
      if (env === 'panel') {
        // v44（T5.3，18.4）面板 viewer：清單筆數（訊息／篩選後列）、虛擬列表實際繪出的列數、退讓中
        L('| 時間 | used（MB） | total（MB） | DOM 節點 | 訊息 | 列 | 繪出列 | 頭像快取 | 模式 | 退讓 | 背景 |');
        L('|---|---|---|---|---|---|---|---|---|---|---|');
        for (const r of pick) {
          const d = r.data;
          L('| ' + [hm(r.ts), d.usedJSHeapMB, d.totalJSHeapMB, d.domNodes, d.items, d.entries, d.rendered, d.avatars, d.mode, d.hostPaused ? '是' : '否', d.hidden ? '是' : '否'].map(esc).join(' | ') + ' |');
        }
      } else {
        L('| 時間 | used（MB） | total（MB） | DOM 節點 | #items | 佇列 | 背景 |');
        L('|---|---|---|---|---|---|---|');
        for (const r of pick) {
          const d = r.data;
          L('| ' + [hm(r.ts), d.usedJSHeapMB, d.totalJSHeapMB, d.domNodes, d.itemsNodes, d.queue, d.hidden ? '是' : '否'].map(esc).join(' | ') + ' |');
        }
      }
      L();
    }
  }

  // ---- P10 直播時鐘（v45，T5.4，審查十一 20.2 第 5 點）：在最新期間 A = now − currentTime×1000 是否穩定、currentTime 是否連續、seekEnd 是否前進
  const p10 = (byProbe.P10 || []).filter((r) => r.kind === 'live-clock' && r.data && typeof r.data.now === 'number');
  if (p10.length) {
    const g10 = new Map();
    for (const r of p10) {
      const c = r.ctx || {};
      const k = [c.tab != null ? c.tab : '—', vid4(c.videoId || '—')].join('|');
      if (!g10.has(k)) g10.set(k, []);
      g10.get(k).push(r);
    }
    const EDGE = new Set(['class', 'disabled']);
    const rate = (list, f) => {
      const a = list[0], b = list[list.length - 1];
      const dt = (b.data.now - a.data.now) / 1000;
      return dt > 5 && typeof f(a) === 'number' && typeof f(b) === 'number' ? ((f(b) - f(a)) / dt).toFixed(2) : '—';
    };
    L('## P10 直播時鐘（每 10 秒）');
    L();
    L('A＝now − currentTime×1000。**在最新（徽章「最新」）期間 A 的變動範圍應在數秒內**；倒轉中 A 會隨倒轉量改變（正常）。currentTime 速度與 seekEnd 速度正常約 1.00（seekEnd 0.00＝停住）。');
    L();
    L('| 分頁 | videoId | 期間 | 筆數 | 在最新筆數 | 在最新時 A 範圍（秒） | currentTime 速度 | seekEnd 速度 | currentTime 不連續 |');
    L('|---|---|---|---|---|---|---|---|---|');
    for (const [k, list] of g10) {
      const [tab, vid] = k.split('|');
      const edge = list.filter((r) => EDGE.has(r.data.badge) && !r.data.paused);
      const As = edge.map((r) => r.data.wallA).filter((x) => typeof x === 'number');
      const span = As.length ? ((Math.max(...As) - Math.min(...As)) / 1000).toFixed(1) : '—';
      // 不連續：相鄰兩筆 currentTime 的差與經過時間差超過 3 秒（跳轉或緩衝）
      let jumps = 0;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1].data, b = list[i].data;
        if (a.paused || b.paused) continue;
        if (Math.abs((b.currentTime - a.currentTime) - (b.now - a.now) / 1000) > 3) jumps++;
      }
      L('| ' + [tab, vid, hm(list[0].ts) + '～' + hm(list[list.length - 1].ts), list.length, edge.length, span,
        rate(list, (r) => r.data.currentTime), rate(list, (r) => r.data.seekEnd), jumps].map(esc).join(' | ') + ' |');
      if (As.length >= 6 && Number(span) > 10) anomalies.push('P10（分頁 ' + tab + '，' + vid + '）在最新期間 A 的範圍 ' + span + ' 秒（> 10 秒，牆上時間錨點的假設不成立）');
    }
    L();
    for (const [k, list] of g10) {
      const [tab, vid] = k.split('|');
      const pick = list.length <= 40 ? list : Array.from({ length: 40 }, (_, i) => list[Math.round(i * (list.length - 1) / 39)]);
      const A0 = list[0].data.wallA;
      L('### 分頁 ' + tab + '，' + vid + '（A、錨點以第一筆為 0，單位秒）');
      L();
      L('| 時間 | currentTime | seekStart | seekEnd | 徽章 | 模式 | 暫停 | A | 錨點 | 樣本 | 同步微調 |');
      L('|---|---|---|---|---|---|---|---|---|---|---|');
      const rel = (x) => (typeof x === 'number' && typeof A0 === 'number' ? ((x - A0) / 1000).toFixed(1) : '—');
      for (const r of pick) {
        const d = r.data;
        L('| ' + [hm(r.ts), d.currentTime, d.seekStart, d.seekEnd, d.badge, d.mode, d.paused ? '是' : '否', rel(d.wallA), rel(d.anchorA), d.anchorN, d.latency].map(esc).join(' | ') + ' |');
      }
      L();
    }
  }
  // ---- v47（T5.6，審查十一 26.2 第 4 點）P10 事件：seek、錨點採用、錨點作廢（立即一筆）的時間序列
  const p10ev = (byProbe.P10 || []).filter((r) => r.kind !== 'live-clock' && r.data && typeof r.data.now === 'number');
  if (p10ev.length) {
    const EVN = { 'live-seek': 'seek', 'anchor-ok': '錨點採用', 'anchor-void': '錨點作廢', 'anchor-top': '沿用本頁錨點（面板重建）' }; // v50（30.4）
    L('## P10 事件（seek／錨點採用／作廢）');
    L();
    L('時間以第一筆為 0（秒）。網址帶 t= 的載入：預期先出現 seek（到 t= 的位置、徽章非最新），之後才有「錨點採用」；採用後 5 秒內被 seek 到非最新＝「錨點作廢」。');
    L();
    L('| 分頁 | videoId | 時間 | 事件 | 徽章 | currentTime | 模式 | 候選 | 樣本 | 作廢 | 等點直播 | urlT | seeks |');
    L('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const t0 = p10ev[0].data.now;
    for (const r of p10ev.slice(0, 200)) {
      const c = r.ctx || {}, d = r.data;
      L('| ' + [c.tab != null ? c.tab : '—', vid4(c.videoId || '—'), ((d.now - t0) / 1000).toFixed(1), EVN[r.kind] || String(r.kind).slice(0, 16), d.badge, d.currentTime, d.mode,
        d.anchorCand, d.anchorN, d.anchorVoids, d.anchorStrict ? '是' : '否', d.urlT ? '是' : '否', d.seeks].map(esc).join(' | ') + ' |');
    }
    L();
    const voids = p10ev.filter((r) => r.kind === 'anchor-void').length;
    if (voids) anomalies.push('P10 錨點作廢 ' + voids + ' 次（採用後 5 秒內被 seek 到非最新；網址帶 t= 的載入屬預期）');
  }

  // ---- v47（T5.6，審查十一 26.4）P7 SC 文字色變數（名稱，不含值）
  const p7c = (byProbe.P7 || []).filter((r) => r.kind === 'sc-color-vars');
  if (p7c.length) {
    L('## SC 文字色變數（P7 sc-color-vars，' + p7c.length + ' 筆）');
    L();
    L('元件 inline style 上實際有的 `--yt-live-chat-paid-*` 名稱（不含值）；「讀到」＝本套件取得的文字色欄位（header／author／timestamp／body）。用來確認 dom-notes 2.4b。');
    L();
    L('| 時間 | videoId | 類型 | 有底色 | 讀到 | 元件上的變數 |');
    L('|---|---|---|---|---|---|');
    for (const r of p7c) {
      const d = r.data || {};
      L('| ' + [hm(r.ts), vid4((r.ctx && r.ctx.videoId) || '—'), d.type, d.hasBg ? '是' : '否', (d.got || []).join(', ') || '（無）',
        (d.inlineVars || []).map((x) => String(x).replace(/^--yt-live-chat-paid-/, '…')).join(', ') || '（無）'].map(esc).join(' | ') + ' |');
    }
    L();
    if (p7c.every((r) => !(r.data && r.data.got && r.data.got.length))) anomalies.push('SC 文字色：' + p7c.length + ' 筆都沒有讀到 YouTube 的文字色（selectors.js 的變數名稱可能不對，見「SC 文字色變數」）');
  }

  // ---- v51（T6.2，審查十一 32.1）P7 zone-structure：底部互動區相關元素（標籤、可見、高度、頂端；沒有文字）
  const zs = (byProbe.P7 || []).filter((r) => r.kind === 'zone-structure' && r.data);
  if (zs.length) {
    L('## 底部互動區結構（P7 zone-structure，' + zs.length + ' 筆）');
    L();
    L('`$` 流程、彈窗（表符選單等）、投票卡開著（以及剛關上那一次）且結構改變時記一筆。每筆先列量測結果，再列**可見**的元素（不可見的只計數）。role：本套件的代號（`panel-pages-child`＝`#panel-pages` 的直接子元素）。');
    L();
    L('| 時間 | videoId | 原因 | vh | hasInput | bottomZoneHeight | popupTop | purchase | 可見元素（role：標籤 高度@頂端） | 不可見 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of zs) {
      const d = r.data, m = d.m || {}, els = Array.isArray(d.els) ? d.els : [];
      const vis = els.filter((x) => x && x.v).map((x) => (x.role || '?') + '：' + x.t + ' ' + x.h + '@' + x.top).join('<br>');
      L('| ' + [hm(r.ts), vid4((r.ctx && r.ctx.videoId) || '—'), d.reason, m.vh, m.hasInput, m.bottomZoneHeight, m.popupTop ?? '—', m.purchase].map(esc).join(' | ') + ' | ' + (vis ? esc(vis).replace(/&lt;br&gt;/g, '<br>') : '—') + ' | ' + els.filter((x) => x && !x.v).length + ' |');
    }
    L();
    if (zs.some((r) => (r.data.els || []).some((x) => x && x.role === '[removed]'))) notes.push('zone-structure：有 role 被消毒成 [removed]（v50 的記錄；v51 起 role 只用允許的字元）');
  }
  // ---- v52（T6.3，審查十一 33.8.4）P7 poll-structure：投票卡的實際位置（不記文字）
  const ps = (byProbe.P7 || []).filter((r) => r.kind === 'poll-structure' && r.data);
  if (ps.length) {
    L('## 投票卡結構（P7 poll-structure，' + ps.length + ' 筆）');
    L();
    L('標籤或 id 含 poll／action-panel 的元素。underHidden＝在本套件面板開啟時隱藏的範圍內（#item-list、頂部列、置頂列）；inItems＝在訊息列表 #items 內（會被擷取與修剪碰到）。祖先鏈由內而外：標籤 高度 visibility／overflow／max-height（cp＝有 clip-path、★＝有本套件的屬性）。');
    L();
    L('| 時間 | 環境 | 原因 | 元素 | 頂端／高度 | visibility | underHidden | inItems | 祖先鏈 |');
    L('|---|---|---|---|---|---|---|---|---|');
    for (const r of ps) {
      const d = r.data;
      const chain = (d.chain || []).slice(1).map((c) => c.t + ' ' + c.h + ' ' + c.vis + '／' + c.ov + '／' + c.mh + (c.cp ? ' cp' : '') + (c.ytcas ? ' ★' : '')).join(' ＜ ');
      L('| ' + [hm(r.ts), (r.ctx && r.ctx.env) || '—', d.why, d.t, d.top + '／' + d.h, d.vis, d.underHidden, d.inItems, chain].map(esc).join(' | ') + ' |');
    }
    L();
  }
  // ---- v51（T6.2，審查十一 32.2）P7 own-replace：自己送出的訊息配對（id 形狀＝前 4 碼｜長度，不含內容）
  const ow = (byProbe.P7 || []).filter((r) => r.kind === 'own-replace' && r.data);
  if (ow.length) {
    L('## 自己送出的訊息配對（P7 own-replace，' + ow.length + ' 筆）');
    L();
    L('kind：`new-node`＝正式節點出現時配對、`late`＝暫時節點晚移除時事後配對、`in-place`＝同一個節點原地改 id、`temp-seen`＝看到暫時 id。rule：`temp`（暫時 id 格式）／`removed`（頁面移除 10 秒內）／`swap`（列表被換掉）／`same-node`。');
    L();
    L('| 時間 | videoId | kind | rule | 舊 id | 新 id | 相隔（秒） | 舊節點被移除 | 舊 id 是暫時格式 | 同一個節點 |');
    L('|---|---|---|---|---|---|---|---|---|---|');
    const sh = (x) => (x ? x.p + '|' + x.len : '—');
    for (const r of ow) {
      const d = r.data;
      L('| ' + [hm(r.ts), vid4((r.ctx && r.ctx.videoId) || '—'), d.kind, d.rule || '—', sh(d.oldId), sh(d.newId), d.dtMs == null ? '—' : (d.dtMs / 1000).toFixed(1),
        d.oldRemoved ? '是' : '否', d.oldTempId ? '是' : '否', d.sameEl ? '是' : '否'].map(esc).join(' | ') + ' |');
    }
    L();
  }
  // ---- v51（T6.2，審查十一 32.7）P7 ts-format：#timestamp 的形狀（不記原文）
  const tf = (byProbe.P7 || []).filter((r) => r.kind === 'ts-format' && r.data);
  if (tf.length) {
    L('## 聊天室時間格式（P7 ts-format，' + tf.length + ' 筆）');
    L();
    L('原因：`future`＝以「今天」解讀會在未來（已往前推整天，通常是進入頁面時載入的前幾天訊息）、`ambiguous`＝依順序重建後早於擷取超過 24 小時、`unparsed`＝解析失敗。形狀：數字 → `d`、上午／下午 → `A`／`P`、其他字元 → `?`。');
    L();
    L('| 時間 | videoId | 原因 | 形狀 | 長度 | Date.now() | 時區（UTC 差，分） |');
    L('|---|---|---|---|---|---|---|');
    for (const r of tf) {
      const d = r.data;
      L('| ' + [hm(r.ts), vid4((r.ctx && r.ctx.videoId) || '—'), d.reason, '`' + d.shape + '`', d.len, dt(d.now), (d.tz || '—') + '（' + d.tzOffsetMin + '）'].map(esc).join(' | ') + ' |');
    }
    L();
    if (tf.some((r) => r.data.reason === 'unparsed')) anomalies.push('ts-format：有 #timestamp 無法解析（見「聊天室時間格式」）');
  }

  // ---- P7 結構
  const p7 = (byProbe.P7 || []).filter((r) => !['sc-color-vars', 'zone-structure', 'own-replace', 'ts-format', 'poll-structure', 'video-switch'].includes(r.kind));
  if (p7.length) {
    L('## P7 結構紀錄（' + p7.length + ' 筆）');
    L();
    for (const r of p7) {
      const d = r.data || {};
      L('### ' + hm(r.ts) + ' ' + esc(d.reason) + '：`' + esc(d.tag) + '`（' + vid4((r.ctx && r.ctx.videoId) || '—') + '）');
      L();
      L('- 屬性：' + esc((d.attrs || []).join(', ') || '—') + '；有 id：' + (d.hasId ? '是' : '否'));
      L('```');
      for (const n of (d.tree || []).slice(0, 80)) {
        L('  '.repeat(Math.max(0, (n.d || 1) - 1)) + n.tag + (n.attrs && n.attrs.length ? ' [' + n.attrs.join(' ') + ']' : '') +
          (n.img ? ' img=' + n.img : '') + (n.size ? ' ' + n.size : '') + (n.hasText ? ' (有文字)' : '') + (n.at ? ' @' : '') + (n.href ? ' href=' + n.href : ''));
      }
      L('```');
      L();
    }
  }

  // ---- v45（T5.4，審查十一 20.4）禮物結構（非記錄期間也保留的最近 5 筆；不含文字）
  const gs = Array.isArray(data.giftStructures) ? data.giftStructures : [];
  if (gs.length) {
    L('## 禮物結構（最近 ' + gs.length + ' 筆，非記錄期間也保留）');
    L();
    L('`@` = 自己的文字以 @ 開頭（handle 的位置）；`href=` = 連結種類（handle／channel／redirect／external…，不含網址）。');
    L();
    for (const g of gs) {
      const d = g.data || {};
      L('### ' + hm(g.ts) + ' `' + esc(d.tag) + '`（' + vid4(g.videoId || '—') + '，' + esc(g.source) + '，作者來源 ' + esc(d.authorSource) + '，禮物圖片 ' + (d.hasGiftImage ? '有' : '無') + '）');
      L();
      L('```');
      for (const n of (d.tree || []).slice(0, 80)) {
        L('  '.repeat(Math.max(0, (n.d || 1) - 1)) + n.tag + (n.attrs && n.attrs.length ? ' [' + n.attrs.join(' ') + ']' : '') +
          (n.img ? ' img=' + n.img : '') + (n.size ? ' ' + n.size : '') + (n.hasText ? ' (有文字)' : '') + (n.at ? ' @' : '') + (n.href ? ' href=' + n.href : ''));
      }
      L('```');
      L();
    }
  }

  // ---- P8
  for (const r of byProbe.P8 || []) anomalies.push('P8 ' + hm(r.ts) + ' ' + r.kind + '（' + ((r.ctx && r.ctx.env) || '—') + '）：' + String((r.data && r.data.message) || '').slice(0, 200));

  // ---- 時間軸（事件型：P3、P4、P6、P7、P8 與開始／停止）
  const events = recs.filter((r) => ['P3', 'P4', 'P6', 'P7', 'P8'].includes(r.probe) || r.kind === 'diag-start' || r.kind === 'diag-stop');
  if (events.length) {
    L('## 時間軸（事件，最多 300 筆）');
    L();
    L('| 時間 | 探針 | 事件 | 環境 | videoId | 內容 |');
    L('|---|---|---|---|---|---|');
    for (const r of events.slice(0, 300)) {
      const c = r.ctx || {};
      const d = r.probe === 'P7' ? { reason: r.data.reason, tag: r.data.tag, nodes: (r.data.tree || []).length } : r.data;
      L('| ' + [hm(r.ts), r.probe, r.kind, c.env, vid4(c.videoId), short(d, 140)].map(esc).join(' | ') + ' |');
    }
    if (events.length > 300) L('| … | | 其餘 ' + (events.length - 300) + ' 筆省略 | | | |');
    L();
  }

  L('## 異常');
  L();
  if (!anomalies.length) L('沒有偵測到異常。');
  for (const a of anomalies) L('- ' + a);
  L();
  if (notes.length) {
    L('## 備註（不是異常）');
    L();
    for (const a of notes) L('- ' + a);
    L();
  }
  return out.join('\n');
}

module.exports = { report };

if (require.main === module) {
  const [, , inFile, outFile] = process.argv;
  if (!inFile) { console.error('用法：node tools/diag-report.js <ytcas-diag-*.json> [輸出.md]'); process.exit(2); }
  const md = report(JSON.parse(fs.readFileSync(inFile, 'utf8')));
  if (outFile) { fs.writeFileSync(outFile, md, 'utf8'); console.log('已寫入 ' + outFile); } else process.stdout.write(md);
}
