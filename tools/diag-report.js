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
      if (list.some((r) => r.data.itemsIsCurrent === false && r.data.mode === 'capturing')) anomalies.push('P1 ' + vid + '：收錄中出現 itemsIsCurrent: false');
      if (typeof last.f12 === 'string' && last.f12.startsWith('failed')) anomalies.push('P1 ' + vid + '：F-12 ' + last.f12);
      // 間隔：每分鐘一筆，超過 3 分鐘視為空檔（分頁被節流、SW 無回應、頁面關閉等）
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].ts - list[i - 1].ts;
        if (gap > 3 * 60000 && list[i].kind !== 'stats-final') anomalies.push('P1 ' + vid + '（' + src + '）：' + hm(list[i - 1].ts) + '～' + hm(list[i].ts) + ' 沒有統計（' + Math.round(gap / 60000) + ' 分鐘）');
      }
    }
    L();
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
    L('## P9 記憶體（每 5 分鐘）');
    L();
    L('同源的 top 與聊天室 iframe 通常共用同一個 V8 heap，兩邊的 heap 數字可能相同；各 frame 的差異看 DOM 節點數。`performance.memory` 的數值有量化誤差，只看趨勢。');
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
      L('| 時間 | used（MB） | total（MB） | DOM 節點 | #items | 佇列 | 背景 |');
      L('|---|---|---|---|---|---|---|');
      for (const r of pick) {
        const d = r.data;
        L('| ' + [hm(r.ts), d.usedJSHeapMB, d.totalJSHeapMB, d.domNodes, d.itemsNodes, d.queue, d.hidden ? '是' : '否'].map(esc).join(' | ') + ' |');
      }
      L();
    }
  }

  // ---- P7 結構
  const p7 = byProbe.P7 || [];
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
          (n.img ? ' img=' + n.img : '') + (n.size ? ' ' + n.size : '') + (n.hasText ? ' (有文字)' : ''));
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
  return out.join('\n');
}

module.exports = { report };

if (require.main === module) {
  const [, , inFile, outFile] = process.argv;
  if (!inFile) { console.error('用法：node tools/diag-report.js <ytcas-diag-*.json> [輸出.md]'); process.exit(2); }
  const md = report(JSON.parse(fs.readFileSync(inFile, 'utf8')));
  if (outFile) { fs.writeFileSync(outFile, md, 'utf8'); console.log('已寫入 ' + outFile); } else process.stdout.write(md);
}
