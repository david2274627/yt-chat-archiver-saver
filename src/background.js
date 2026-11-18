// Service Worker：唯一的 IndexedDB 寫入者、推播、頻道名稱解析（SPEC 3.2、4.2、F-03、F-11、F-14～F-16、F-18、F-19）。
// SW 可能隨時被終止：收到資料立即寫入 IndexedDB；頻道解析佇列存 chrome.storage.session（SPEC 3.2 v28）。
importScripts('constants.js', 'selectors.js', 'db.js');

const C = self.YTCAS_CONST;
const SEL = self.YTCAS_SEL;
const DB = self.YTCAS_DB;
const RT = C.RT;

// ---------------------------------------------------------------- 設定（F-15、F-16）
const settings = {};
let settingsLoaded = null;

function loadSettings() {
  if (settingsLoaded) return settingsLoaded;
  settingsLoaded = (async () => {
    const keysBy = { sync: [], local: [] };
    for (const [k, d] of Object.entries(C.SETTINGS)) keysBy[d.area].push(k);
    const [sync, local] = await Promise.all([chrome.storage.sync.get(keysBy.sync), chrome.storage.local.get(keysBy.local)]);
    for (const [k, d] of Object.entries(C.SETTINGS)) {
      const v = (d.area === 'sync' ? sync : local)[k];
      settings[k] = v === undefined ? JSON.parse(JSON.stringify(d.default)) : v;
    }
    return settings;
  })().catch((e) => { settingsLoaded = null; throw e; });
  return settingsLoaded;
}

chrome.storage.onChanged.addListener((changes, area) => {
  for (const [k, ch] of Object.entries(changes)) {
    const d = C.SETTINGS[k];
    if (d && d.area === area) settings[k] = ch.newValue === undefined ? JSON.parse(JSON.stringify(d.default)) : ch.newValue;
  }
});

async function capturePolicy(channelHandle) {
  const s = await loadSettings();
  if (s.captureEnabled === false) return { allowed: false, reason: 'global' };
  const h = typeof channelHandle === 'string' ? channelHandle.trim().toLowerCase() : '';
  if (h && Array.isArray(s.captureExcludedChannels) && s.captureExcludedChannels.some((x) => String(x).toLowerCase() === h)) {
    return { allowed: false, reason: 'channel' };
  }
  return { allowed: true, reason: null };
}

async function handleOf(videoId, stream) {
  if (stream && stream.channelHandle) return stream.channelHandle;
  const s = await DB.getStream(videoId);
  return (s && s.channelHandle) || '';
}

// ---------------------------------------------------------------- 推播
function broadcast(msg) {
  try {
    const p = chrome.runtime.sendMessage(msg);
    if (p && p.catch) p.catch(() => {}); // 沒有開啟中的 viewer 時會失敗，忽略
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------- 頻道名稱解析（F-03）
const HANDLE_RE = /^@[\p{L}\p{N}._\-·]{1,100}$/u;
let queueChain = Promise.resolve();
const inflight = new Set();
let kickTimer = null;

function withQueue(fn) {
  const next = queueChain.then(fn, fn);
  queueChain = next.catch(() => {});
  return next;
}
async function readQueue() {
  const o = await chrome.storage.session.get(C.CHANNEL_QUEUE_KEY);
  return o[C.CHANNEL_QUEUE_KEY] || {};
}
const writeQueue = (q) => chrome.storage.session.set({ [C.CHANNEL_QUEUE_KEY]: q });

function isFresh(rec, now) {
  if (!rec) return false;
  const ttl = rec.failed ? C.CHANNEL_FAIL_TTL_MS : C.CHANNEL_CACHE_TTL_MS;
  return now - (rec.fetchedAt || 0) < ttl;
}

async function enqueueHandles(handles) {
  const uniq = Array.from(new Set((handles || []).filter((h) => typeof h === 'string' && HANDLE_RE.test(h))));
  if (!uniq.length) return 0;
  const now = Date.now();
  const need = [];
  for (const h of uniq) if (!isFresh(await DB.getChannel(h), now)) need.push(h);
  if (!need.length) return 0;
  const added = await withQueue(async () => {
    const q = await readQueue();
    let n = 0;
    for (const h of need) if (!q[h]) { q[h] = { attempts: 0, nextAt: 0 }; n++; }
    if (n) await writeQueue(q);
    return n;
  });
  kickQueue();
  return added;
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l[0] === '#') {
      const cp = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }[l] || m;
  });
}

// 只讀 og:title／og:image（不用 DOMParser：SW 沒有 DOM）
function parseChannelHtml(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const prop = /\bproperty\s*=\s*["']([^"']+)["']/i.exec(tag);
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (!prop || !content) continue;
    const key = prop[1].toLowerCase();
    if ((key === 'og:title' || key === 'og:image') && !out[key]) out[key] = decodeEntities(content[1] ?? content[2] ?? '');
  }
  const displayName = (out['og:title'] || '').trim();
  const avatar = out['og:image'] && C.isAllowedImageUrl(out['og:image']) ? out['og:image'] : '';
  return { displayName, avatar };
}

// T4.2（審查十一 9）：先不帶 Cookie（omit）；頁面沒有 og:title（例如被導向同意頁或拿到精簡頁面）時，比照 watch 頁
// 以 include 重試一次。HTTP 錯誤（例如 404 頻道不存在）不重試。失敗時附上只有狀態與布林值的原因（failInfo），
// 存進失敗紀錄供 channelStats() 統計；成功紀錄記下用了哪一種（credentialsUsed）
async function fetchChannelPage(url, credentials) {
  const r = await fetch(url, { credentials, redirect: 'follow' });
  let host = '';
  try { host = new URL(r.url || url).hostname; } catch (_) { /* ignore */ }
  const html = r.ok ? await r.text() : '';
  const info = r.ok ? parseChannelHtml(html) : { displayName: '', avatar: '' };
  return { ok: r.ok, status: r.status, info, failInfo: { status: r.status, consent: /(^|\.)consent\./.test(host), offSite: !!host && host !== 'www.youtube.com',
    ogTitle: /property\s*=\s*["']og:title["']/i.test(html), ogImage: /property\s*=\s*["']og:image["']/i.test(html), kb: Math.round(html.length / 1024), credentials } };
}
async function resolveOne(handle) {
  const url = 'https://www.youtube.com/@' + encodeURIComponent(handle.slice(1));
  let res = await fetchChannelPage(url, 'omit');
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { failInfo: res.failInfo });
  if (!res.info.displayName) {
    const first = res.failInfo;
    try { res = await fetchChannelPage(url, 'include'); } catch (_) { res = null; }
    if (!res || !res.ok || !res.info.displayName) {
      throw Object.assign(new Error(res && !res.ok ? 'HTTP ' + res.status : 'no og:title'), { failInfo: Object.assign({}, first, { retry: res ? res.failInfo : { error: true } }) });
    }
    return Object.assign(res.info, { credentialsUsed: 'include' });
  }
  return Object.assign(res.info, { credentialsUsed: 'omit' });
}

function kickQueue() {
  if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
  withQueue(async () => {
    const q = await readQueue();
    const now = Date.now();
    let soonest = Infinity;
    for (const [h, it] of Object.entries(q)) {
      if (inflight.has(h)) continue;
      if (it.nextAt > now) { soonest = Math.min(soonest, it.nextAt); continue; }
      if (inflight.size >= C.CHANNEL_RESOLVE_CONCURRENCY) break;
      inflight.add(h);
      processHandle(h);
    }
    if (soonest !== Infinity) kickTimer = setTimeout(kickQueue, Math.max(1000, soonest - now));
  }).catch((e) => console.warn('[ytcas] 頻道解析佇列錯誤', e));
}

async function processHandle(h) {
  let info = null;
  let err = null;
  try { info = await resolveOne(h); } catch (e) { err = e; }
  try {
    await withQueue(async () => {
      const q = await readQueue();
      const it = q[h] || { attempts: 0, nextAt: 0 };
      if (info) {
        delete q[h];
        const rec = { handleOrId: h, displayName: info.displayName, avatar: info.avatar, fetchedAt: Date.now(), credentialsUsed: info.credentialsUsed || null };
        await DB.putChannel(rec);
        broadcast({ type: RT.CHANNEL_RESOLVED, handleOrId: h, displayName: rec.displayName, avatar: rec.avatar });
      } else {
        it.attempts++;
        if (it.attempts >= C.CHANNEL_MAX_ATTEMPTS) {
          delete q[h];
          // 失敗紀錄（1 天內不再重試）；檢視器退回顯示 @Handle
          await DB.putChannel({ handleOrId: h, displayName: '', avatar: '', fetchedAt: Date.now(), failed: true,
            failReason: C.asciiOnly(String((err && err.message) || 'error')).slice(0, 40), failInfo: (err && err.failInfo) || null });
        } else {
          it.nextAt = Date.now() + Math.min(30000 * 2 ** (it.attempts - 1), 6 * 3600 * 1000); // 指數退避
          q[h] = it;
        }
      }
      await writeQueue(q);
    });
  } finally {
    inflight.delete(h);
    // T3.8（CLAUDE.md 規則）：Console 不得輸出 handle → 只記失敗原因
    if (err) {
      const f = err.failInfo || {};
      console.info('[ytcas] 頻道名稱解析失敗', C.asciiOnly(String(err.message)), { status: f.status ?? null, consent: !!f.consent, offSite: !!f.offSite,
        ogTitle: !!f.ogTitle, retried: !!f.retry, retryStatus: f.retry ? f.retry.status ?? null : null });
    }
    kickQueue();
  }
}

// ---------------------------------------------------------------- F-11 自動遷移
async function autoMigrateLegacy(force) {
  const st = await chrome.storage.local.get(['legacyMigratedAt']);
  if (st.legacyMigratedAt && !force) return null;
  const r = await DB.migrateLegacy();
  if (!r.exists) {
    await chrome.storage.local.set({ legacyMigratedAt: Date.now(), legacyCounts: null, migratedCounts: null });
    return r;
  }
  await chrome.storage.local.set({ legacyMigratedAt: Date.now(), legacyCounts: r.legacyCounts, migratedCounts: r.migratedCounts });
  return r;
}

// ---------------------------------------------------------------- T3.4 清除垃圾 system 紀錄（SW Console 手動執行）
// rawTag 不以 yt-live-chat-／ytd-sponsorships- 開頭，或屬於子元件清單，或（T3.5）yt-live-chat-* 符合子元件規則
//（-view-model 結尾、含 -button-、-badge-renderer 結尾、-chip 結尾；selectors.js）→ 不是訊息元件
// T3.6（審查十追加五 A-2）白名單優先：messageTypeByTag 與已知系統訊息元件一律不是子元件
//（例：禮物 yt-gift-message-view-model 不以 yt-live-chat- 開頭、又以 -view-model 結尾，舊規則會誤刪）
function isJunkTag(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t) return false;
  if (Object.prototype.hasOwnProperty.call(SEL.messageTypeByTag, t) || SEL.knownMessageTags.includes(t)) return false;
  if (!SEL.messageTagPrefixes.some((p) => t.startsWith(p)) || SEL.nonMessageTags.includes(t)) return true;
  return t.startsWith('yt-live-chat-') && SEL.subComponentPatterns.some((re) => re.test(t));
}
// 用法：await YTCAS_BG.cleanupJunkSystem({ dryRun: true })  → 只回傳筆數；確認後 { dryRun: false } 才刪除
async function cleanupJunkSystem(opts) {
  const dryRun = !(opts && opts.dryRun === false);
  // T3.5：一併合併 viewer-engagement（歡迎／守則提示）的重複紀錄
  // T3.6：子元件垃圾只可能產生在 T3 部署到 T3.4 部署之間（T3.4 起只擷取 #items 直接子節點）→ 只清這段期間的
  const r = await DB.cleanupJunkSystem({ dryRun, isJunkTag, since: C.T3_DEPLOYED_AT, until: C.T34_DEPLOYED_AT, veTag: SEL.chat.viewerEngagement });
  console.info('[ytcas] 清除垃圾 system 紀錄' + (dryRun ? '（預覽）' : ''), { matched: r.matched, deleted: r.deleted, streams: r.streams,
    veDuplicates: r.veDuplicates, veMerged: r.veMerged, keptTags: Object.keys(r.keptByTag).length });
  return r;
}

// T4.1（審查十一 5.1）既有置頂重複的整理。用法：await YTCAS_BG.dedupePinned()（預覽）→ 確認後 { dryRun: false }
// 回傳筆數、各場（videoId 前 4 碼）與「重複的各筆哪些欄位不同」（只有欄位名稱）
async function dedupePinned(opts) {
  const r = await DB.dedupePinnedStore({ dryRun: !(opts && opts.dryRun === false) });
  console.info('[ytcas] 置頂重複整理' + (r.dryRun ? '（預覽）' : ''), { records: r.records, streams: r.streams, groups: r.groups, removed: r.removed, diffFields: r.diffFields });
  return r;
}
// T5.1（審查十一第 10 節 4）既有紀錄的頭像補齊（同場次同作者）。用法：await YTCAS_BG.fillAvatars()（預覽）→ { dryRun: false }
async function fillAvatars(opts) {
  const r = await DB.fillAvatars({ dryRun: !(opts && opts.dryRun === false) });
  console.info('[ytcas] 頭像補齊' + (r.dryRun ? '（預覽）' : ''), r);
  return r;
}

// T4.2（審查十一 9）頻道名稱解析統計（SW Console）：await YTCAS_BG.channelStats()
// 只有筆數與失敗原因分布（不含 handle 與名稱）。佇列中尚未解析的數量一併列出
async function channelStats() {
  const r = await DB.channelStats();
  r.queued = Object.keys(await readQueue()).length;
  r.failRate = r.ok + r.failed ? Math.round((r.failed / (r.ok + r.failed)) * 1000) / 10 : 0;
  return r;
}
// 失敗紀錄重新排入解析佇列（失敗紀錄原本 1 天內不重試）。預設預覽（只回傳筆數），{ dryRun: false } 才執行
async function retryFailedChannels(opts) {
  const dryRun = !(opts && opts.dryRun === false);
  const db = await DB.open();
  const all = await new Promise((res, rej) => { const q = db.transaction('channels').objectStore('channels').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const handles = all.filter((c) => c.failed && !c.displayName && HANDLE_RE.test(c.handleOrId)).map((c) => c.handleOrId);
  if (dryRun) return { dryRun, failed: handles.length };
  const added = await withQueue(async () => {
    const q = await readQueue();
    let n = 0;
    for (const h of handles) if (!q[h]) { q[h] = { attempts: 0, nextAt: 0 }; n++; }
    if (n) await writeQueue(q);
    return n;
  });
  kickQueue();
  return { dryRun, failed: handles.length, queued: added };
}

// T4.1（審查十一 2.2）頭像網址網域分布：console.table(await YTCAS_BG.avatarHosts())（類型 × 網域 → 筆數，不含網址）
const avatarHosts = () => DB.avatarHostStats();

// T3.6 欄位完整度（SW Console）：console.table(await YTCAS_BG.fieldStats())；預設只算 T3 部署後收錄的。
// 可指定 { videoId, since }。只回傳筆數，不含任何訊息內容
async function fieldStats(opts) {
  opts = opts || {};
  return DB.fieldStats({ since: opts.since ?? C.T3_DEPLOYED_AT, videoId: opts.videoId });
}

// T3.6 維護（SW Console）：以已知的實際開播／結束時間修正既有場次並重算 phase／offset。兩段式：
//   await YTCAS_BG.recomputeStream('videoId', { startedAt: Date.parse('…Z') })                 → 預覽（只回傳筆數）
//   await YTCAS_BG.recomputeStream('videoId', { startedAt: Date.parse('…Z'), dryRun: false })  → 執行
async function recomputeStream(videoId, opts) {
  vid({ videoId });
  const r = await DB.recomputeStream(videoId, opts || {});
  console.info('[ytcas] 場次重算' + (r.dryRun ? '（預覽）' : ''), { videoId, changed: r.changed, offsetChanged: r.offsetChanged });
  return r;
}

// ---------------------------------------------------------------- F-20 診斷記錄模式（T3.7，審查十追加六 B）
// 使用者只決定開始與結束時間；期間由內建探針（P1～P8）自動記錄到 diag_log，結束後匯出單一 JSON。
// 只記筆數、元件標籤、id、屬性名稱、時間、videoId、圖片網域；不記訊息文字、使用者名稱／handle、頻道名稱、標題、頭像網址。
// 不執行任何動態程式碼（MV3 禁止，也不應該）：新增探針 = 更新程式碼。
const D = C.DIAG;
let diagState = { active: false };
let diagLoaded = null;
function loadDiag() {
  if (!diagLoaded) {
    diagLoaded = chrome.storage.local.get(D.STATE_KEY).then((o) => { diagState = o[D.STATE_KEY] || { active: false }; return diagState; })
      .catch(() => diagState);
  }
  return diagLoaded;
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[D.STATE_KEY]) diagState = ch[D.STATE_KEY].newValue || { active: false }; });
const saveDiag = (s) => { diagState = s; return chrome.storage.local.set({ [D.STATE_KEY]: s }); };
const diagOn = (probe) => diagState.active && Array.isArray(diagState.probes) && diagState.probes.includes(probe);

// 消毒（background 端的最後防線；content script 端本來就只送筆數與標籤）
const SAFE_STR = /^[A-Za-z0-9_\-#.:/ ,=+()[\]|]{0,160}$/; // 不含 @（handle）、不含中日韓文字（訊息內容）
function scrubText(s) {
  return String(s).replace(/https?:\/\/[^\s)'"]+/g, (u) => { try { return new URL(u).host + new URL(u).pathname.replace(/\/[^/]*$/, '/…'); } catch (_) { return '(url)'; } })
    .replace(/@[^\s]+/g, '@…').slice(0, 800);
}
function sanitizeDiag(v, key, depth) {
  depth = depth || 0;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    // P8：錯誤訊息與堆疊只保留 ASCII（T3.8），並去除網址參數與 handle
    if (key === 'message' || key === 'stack') return scrubText(C.asciiOnly(v));
    // P8 warnOnce 的說明：只接受預先定義的文字（C.DIAG_WARN_TEXT），不接受任何執行期字串
    if (key === 'desc') return Object.values(C.DIAG_WARN_TEXT).includes(v) ? v : '[removed]';
    if (/^https?:\/\//.test(v)) { try { return new URL(v).host; } catch (_) { return '(url)'; } }
    return SAFE_STR.test(v) ? v : '[removed]';
  }
  if (depth > 6) return '[depth]';
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => sanitizeDiag(x, key, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    let n = 0;
    for (const [k, x] of Object.entries(v)) {
      if (n++ >= 100) break;
      if (k.includes('@') || !SAFE_STR.test(k)) continue;
      o[k] = sanitizeDiag(x, k, depth + 1);
    }
    return o;
  }
  return null;
}

let diagBuf = [];
let diagTimer = 0;
// ts：content script 端記錄的時間（批次送出會延遲數秒）；不合理（偏差超過 1 天）時以收到時間為準
function diagLog(probe, kind, data, ctx, ts) {
  if (!diagOn(probe)) return;
  const now = Date.now();
  const t = typeof ts === 'number' && Math.abs(ts - now) < 86400e3 ? ts : now;
  diagBuf.push({ ts: t, probe, kind: String(kind).slice(0, 60), ctx: sanitizeDiag(ctx || { env: 'bg' }), data: sanitizeDiag(data || {}) });
  if (diagBuf.length >= D.FLUSH_MAX) flushDiag();
  else if (!diagTimer) diagTimer = setTimeout(flushDiag, 1000);
}
function flushDiag() {
  clearTimeout(diagTimer); diagTimer = 0;
  const list = diagBuf.splice(0);
  if (!list.length) return Promise.resolve();
  return DB.diagAppend(list, { maxRecords: D.MAX_RECORDS, maxBytes: D.MAX_BYTES }).catch((e) => console.info('[ytcas] 診斷記錄寫入失敗', String(e && e.message)));
}

function setRecBadge(on) {
  try {
    chrome.action.setBadgeText({ text: on ? 'REC' : '' });
    if (on) chrome.action.setBadgeBackgroundColor({ color: '#c9362f' });
    chrome.action.setTitle({ title: on ? 'YT 加強版聊天室（診斷記錄中）' : 'YT 加強版聊天室' });
  } catch (_) { /* ignore */ }
}

// opts: { probes?: ['P1',…]（預設全部）, hours?（預設 6，1～24）, startAt?（ms，未來時間 = 排程開始）, endAt?（ms） }
async function diagStart(opts) {
  opts = opts || {};
  const now = Date.now();
  const probes = Array.isArray(opts.probes) && opts.probes.length ? opts.probes.filter((p) => D.PROBES.includes(p)) : D.PROBES.slice();
  const hours = Math.min(D.MAX_HOURS, Math.max(D.MIN_HOURS, Number(opts.hours) || D.DEFAULT_HOURS));
  const startAt = typeof opts.startAt === 'number' && opts.startAt > now ? opts.startAt : now;
  const maxEnd = startAt + hours * 3600e3;
  const endsAt = typeof opts.endAt === 'number' && opts.endAt > startAt ? Math.min(opts.endAt, maxEnd) : maxEnd;
  const scheduled = startAt > now;
  const st = { active: !scheduled, scheduled, startAt, endsAt, probes, hours, createdAt: now, stoppedAt: null, reason: null,
    version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version };
  if (!scheduled) await DB.diagClear(); // 新的一段記錄：清掉上一段（匯出後才開始新的）
  await saveDiag(st);
  try {
    if (scheduled) chrome.alarms.create('ytcas-diag-start', { when: startAt });
    chrome.alarms.create('ytcas-diag-stop', { when: endsAt });
    chrome.alarms.create('ytcas-diag-p5', { periodInMinutes: D.P5_MINUTES });
  } catch (_) { /* ignore */ }
  setRecBadge(st.active);
  if (st.active) { diagLog('P1', 'diag-start', { probes, hours, endsAt }); runP5().catch(() => {}); }
  return diagStatus();
}
async function diagStop(reason) {
  await loadDiag();
  if (!diagState.active && !diagState.scheduled) return diagStatus();
  if (diagState.active) diagLog(diagState.probes[0] || 'P1', 'diag-stop', { reason: reason || 'manual' });
  await flushDiag();
  await saveDiag(Object.assign({}, diagState, { active: false, scheduled: false, stoppedAt: Date.now(), reason: reason || 'manual' }));
  try { for (const n of ['ytcas-diag-start', 'ytcas-diag-stop', 'ytcas-diag-p5']) chrome.alarms.clear(n); } catch (_) { /* ignore */ }
  setRecBadge(false);
  return diagStatus();
}
// 被喚醒或排程觸發時檢查：排程開始、超過時限自動停止、停止 30 天後自動清除
async function diagCheck(now) {
  now = now || Date.now();
  await loadDiag();
  if (diagState.scheduled && now >= diagState.startAt) {
    await DB.diagClear();
    await saveDiag(Object.assign({}, diagState, { active: true, scheduled: false }));
    setRecBadge(true);
    diagLog('P1', 'diag-start', { probes: diagState.probes, scheduled: true, endsAt: diagState.endsAt });
  }
  if (diagState.active && now >= diagState.endsAt) await diagStop('limit');
  else setRecBadge(!!diagState.active);
  if (!diagState.active && !diagState.scheduled && diagState.stoppedAt && now - diagState.stoppedAt > D.RETAIN_DAYS * 86400e3 && !diagState.cleared) {
    await DB.diagClear();
    await saveDiag(Object.assign({}, diagState, { cleared: true }));
  }
}
async function diagStatus() {
  await loadDiag();
  const records = await DB.diagCount();
  // T3.8（審查十追加七 B-3）上一段尚未匯出：已停止、有紀錄、停止後沒有匯出過
  const unexported = !diagState.active && !diagState.scheduled && records > 0 &&
    !(diagState.exportedAt && (!diagState.stoppedAt || diagState.exportedAt >= diagState.stoppedAt));
  return Object.assign({}, diagState, { records, unexported, now: Date.now() });
}
async function markExported() {
  await loadDiag();
  await saveDiag(Object.assign({}, diagState, { exportedAt: Date.now() }));
}

// P5（每 10 分鐘）：欄位統計、有分頁開著的場次的 phase 分布與收錄紀錄摘要（只有筆數）
async function runP5() {
  if (!diagOn('P5')) return;
  diagLog('P5', 'fieldStats', await DB.fieldStats({ since: diagState.startAt || 0 }));
  for (const videoId of await openVideoIds()) {
    const s = await DB.getStream(videoId);
    if (!s) continue;
    const fs = await DB.fieldStats({ videoId, since: 0 });
    const types = {}, phases = { pre: 0, live: 0, post: 0 };
    for (const [t, x] of Object.entries(fs)) { types[t] = x.n; for (const p of Object.keys(phases)) phases[p] += x[p] || 0; }
    const { sessions } = await DB.listCaptureSessions(videoId);
    const bySource = {};
    for (const x of sessions) bySource[x.source] = (bySource[x.source] || 0) + 1;
    diagLog('P5', 'stream', { types, phases, sessions: sessions.length, bySource, open: sessions.filter((x) => x.endedAt == null).length,
      reloads: sessions.reduce((a, x) => a + (x.reloads || 0), 0), times: DB.pickStreamTimes(s) }, { env: 'bg', videoId });
  }
}

async function diagExport() {
  await flushDiag();
  const st = await diagStatus();
  const ua = (self.navigator && navigator.userAgent) || '';
  return { format: 'ytcas-diag', formatVersion: 1, app: C.EXPORT_APP, version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
    chrome: (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || null, exportedAt: Date.now(),
    period: { startAt: st.startAt || null, endsAt: st.endsAt || null, stoppedAt: st.stoppedAt || null, reason: st.reason || null, active: !!st.active },
    probes: st.probes || [], records: await DB.diagAll() };
}
function pad(n) { return String(n).padStart(2, '0'); }
function diagFilename(t) {
  const d = new Date(t);
  return D.DOWNLOAD_DIR + '/ytcas-diag-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
}
// SW Console 用：直接下載（data URL；擴充功能頁面 tools/diag.html 以 Blob 下載）
async function diagDownload() {
  const data = await diagExport();
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const id = await chrome.downloads.download({ url: 'data:application/json;base64,' + btoa(bin), filename: diagFilename(data.exportedAt), saveAs: false, conflictAction: 'uniquify' });
  await markExported();
  return { downloadId: id, filename: diagFilename(data.exportedAt), records: data.records.length, bytes: bytes.length };
}
// 人類可讀摘要（前 maxLines 行）
async function diagSummary(maxLines) {
  const data = await diagExport();
  const t = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const lines = ['ytcas 診斷記錄 ' + data.version + '／Chrome ' + data.chrome + '／' + data.records.length + ' 筆／探針 ' + data.probes.join(',')];
  for (const r of data.records) {
    if (lines.length >= (maxLines || 200)) break;
    const c = r.ctx || {};
    lines.push(t(r.ts) + ' ' + r.probe + ' ' + r.kind + ' [' + [c.env, c.source, c.videoId].filter(Boolean).join(' ') + '] ' + JSON.stringify(r.data).slice(0, 300));
  }
  return lines.join('\n');
}

// P8（background）：本套件的 warn／error 與未捕捉的例外
for (const lv of ['warn', 'error']) {
  const orig = console[lv].bind(console);
  console[lv] = (...a) => {
    orig(...a);
    try { if (diagOn('P8')) diagLog('P8', lv, { message: a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') }); } catch (_) { /* ignore */ }
  };
}
SEL.onWarn = (key, lv) => { if (lv === 'warn' && diagOn('P8')) diagLog('P8', 'warnOnce', { key: C.asciiOnly(key), level: lv, desc: C.diagWarnText(key) }); };
self.addEventListener('error', (e) => { if (diagOn('P8')) diagLog('P8', 'exception', { message: String(e.message || ''), stack: String((e.error && e.error.stack) || '') }); });
self.addEventListener('unhandledrejection', (e) => { if (diagOn('P8')) diagLog('P8', 'rejection', { message: String((e.reason && e.reason.message) || e.reason || ''), stack: String((e.reason && e.reason.stack) || '') }); });

const diag = { start: diagStart, stop: diagStop, status: diagStatus, export: diagExport, download: diagDownload, summary: diagSummary,
  clear: async () => { await DB.diagClear(); return diagStatus(); }, check: diagCheck, runP5, log: diagLog, flush: flushDiag, sanitize: sanitizeDiag };

// SW Console 用（RECLASSIFY_SYSTEM 只接受擴充功能頁面）：await YTCAS_BG.reclassifySystem()
async function reclassifySystem(opts) {
  return handlers[RT.RECLASSIFY_SYSTEM](opts || {});
}

// ---------------------------------------------------------------- 訊息處理
// 只有擴充功能頁面（viewer、popup）可以執行破壞性或管理操作；content script（https 頁面）不行
const isExtensionPage = (sender) => !!sender && sender.id === chrome.runtime.id && !String(sender.url || '').startsWith('https://');
const ADMIN = new Set([RT.DELETE_STREAM, RT.DELETE_STREAMS, RT.RESET_STREAM, RT.RECLASSIFY_SYSTEM, RT.MIGRATE_LEGACY,
  RT.IMPORT_DATA, RT.EXPORT_STREAM, RT.SET_VERSION_LABEL, RT.LINK_VIDEO, RT.UNLINK_VIDEO, RT.GET_STORAGE_USAGE, RT.DIAG_CONTROL, RT.OPEN_VIEWER]);

function vid(msg) {
  if (typeof msg.videoId !== 'string' || !/^[\w-]{6,20}$/.test(msg.videoId)) throw new Error('invalid videoId');
  return msg.videoId;
}

// ---------------------------------------------------------------- F-19 FETCH_STREAM_META
// 彈出視窗沒有 top frame：抓 watch 頁 HTML 只讀開播／結束時間、標題、頻道（已有資料不重抓；同一 videoId 同時只抓一次）
const metaInflight = new Map();
// knownScheduled：已知的預定開播時間（判斷 startDate 是否已更新為實際開播時間，C.deriveStartTimes）
function parseWatchHtml(html, knownScheduled) {
  const W = SEL.watchHtml;
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const ip = /\bitemprop\s*=\s*["']([^"']+)["']/i.exec(tag);
    const nm = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag);
    const ct = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (!ct) continue;
    const val = decodeEntities(ct[1] ?? ct[2] ?? '');
    if (ip && W.metaItemprop.includes(ip[1]) && out[ip[1]] == null) out[ip[1]] = val;
    if (nm && W.metaName.includes(nm[1]) && out[nm[1]] == null) out[nm[1]] = val;
  }
  const meta = {};
  const t = (s) => { const v = s ? Date.parse(s) : NaN; return Number.isFinite(v) ? v : null; };
  const sd = t(out.startDate), ed = t(out.endDate);
  const d = C.deriveStartTimes({ startDate: sd, endDate: ed, knownScheduled });
  for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt']) if (d[k] != null) meta[k] = d[k];
  if (d.startPending) meta.startPending = true;
  if (out.title) meta.title = out.title.slice(0, 500);
  if (out.isLiveBroadcast != null) meta.isLive = /^true$/i.test(out.isLiveBroadcast) && ed == null;
  const block = W.authorBlock.exec(html);
  if (block) {
    const u = W.authorUrl.exec(block[1]);
    const n = W.authorName.exec(block[1]);
    if (u) {
      const m = /\/(@[^/?#"']+)/.exec(u[1]);
      if (m) { try { meta.channelHandle = decodeURIComponent(m[1]); } catch (_) { meta.channelHandle = m[1]; } }
      meta.channelUrl = u[1].replace(/^http:/, 'https:');
    }
    if (n) meta.channelName = decodeEntities(n[1]).slice(0, 200);
  }
  return meta;
}

// T3.7（審查十追加六 A-2）：預設 credentials: 'omit'（不帶使用者登入狀態，避免影響觀看紀錄等）；
// 取不到任何時間 meta（例如會員限定直播未登入看不到）時，才以 'include' 重試一次
const hasTimeMeta = (m) => !!m && (m.startedAt != null || m.scheduledStartAt != null || m.endedAt != null || !!m.startPending);
async function fetchStreamMeta(videoId, knownScheduled) {
  if (metaInflight.has(videoId)) return metaInflight.get(videoId);
  const url = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
  const get = async (credentials) => {
    const r = await fetch(url, { credentials });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return parseWatchHtml(await r.text(), knownScheduled);
  };
  const p = (async () => {
    let meta = null;
    let err = null;
    try { meta = await get('omit'); } catch (e) { err = e; }
    if (hasTimeMeta(meta)) return meta;
    try {
      const m2 = await get('include');
      if (hasTimeMeta(m2) || !meta) { m2.credentialsUsed = 'include'; return m2; }
    } catch (e) { if (!meta) throw err || e; }
    return meta;
  })().finally(() => metaInflight.delete(videoId));
  metaInflight.set(videoId, p);
  return p;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);
const pickTimes = (s) => DB.pickStreamTimes(s);

// ---------------------------------------------------------------- T3.6 開播／結束：重新抓取 watch 頁 meta（審查十追加五 E-3）
// 頁面的 startDate meta 開播後不重新整理不會更新 → background 重新抓取：
//   等待開播確認（startPending）：每 60 秒一次，上限 3 小時；直播中（已開播、未結束）：每 5 分鐘一次，等 endDate。
// 不用計時器：搭在收錄中持續送來的 SAVE_MESSAGES 上檢查是否到期（SW 休眠不影響；沒有收錄就不需要抓）。
// 只讀 startDate／endDate／isLiveBroadcast 等 meta；credentials: 'omit'，不帶 Cookie。
const metaPoll = new Map(); // videoId → { firstAt, lastAt }
function metaPollDue(videoId, s, now) {
  if (!s || s.endedAt != null) return null;
  const st = metaPoll.get(videoId) || { firstAt: now, lastAt: 0 };
  const pending = s.startedAt == null && (s.startPending || (s.scheduledStartAt != null && s.scheduledStartAt <= now));
  if (pending) {
    // 3 小時上限：以預定開播時間起算（SW 重新啟動也不會重新計算）；不知道預定時間時以第一次檢查起算
    const since = s.scheduledStartAt != null ? s.scheduledStartAt : st.firstAt;
    if (now - since > C.META_POLL_PENDING_MAX_MS) return null;
    return now - st.lastAt >= C.META_POLL_PENDING_MS ? { st, kind: 'pending' } : null;
  }
  if (s.startedAt != null && s.isLive) return now - st.lastAt >= C.META_POLL_LIVE_MS ? { st, kind: 'live' } : null;
  return null;
}
async function maybeRefetchMeta(videoId, times, source) {
  if (source !== 'live' && source !== 'popout') return null;
  const now = Date.now();
  const due = metaPollDue(videoId, times, now);
  if (!due) return null;
  due.st.lastAt = now;
  metaPoll.set(videoId, due.st);
  let meta;
  try { meta = await fetchStreamMeta(videoId, times.scheduledStartAt); } catch (e) { console.info('[ytcas] 重新抓取場次資訊失敗', String(e && e.message)); return null; }
  const upd = {};
  for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt', 'startPending']) if (meta[k] != null) upd[k] = meta[k];
  if (!Object.keys(upd).length) return null;
  const r = await DB.saveMessages({ videoId, stream: upd, messages: [], source }); // 依來源等級合併並重算 phase／offset
  const got = r.stream || {};
  if (meta.startedAt != null && got.startedAt === meta.startedAt && times.startedAt !== meta.startedAt) {
    console.info('[ytcas] 已確認實際開播時間（watch 頁 meta）', { videoId, startedAt: new Date(meta.startedAt).toISOString() });
  }
  if (meta.endedAt != null && got.endedAt === meta.endedAt && times.endedAt !== meta.endedAt) {
    console.info('[ytcas] 已確認直播結束時間（watch 頁 meta）', { videoId, endedAt: new Date(meta.endedAt).toISOString() });
    metaPoll.delete(videoId);
  }
  return got;
}

// T3.7（審查十追加六 A-1）：除了搭在 SAVE_MESSAGES 上，另以 chrome.alarms 每 1 分鐘檢查一次，
// 待機室或冷清時段（沒有新訊息）也能確認開播／結束。只檢查「目前有分頁開著」的 videoId（watch 頁或彈出式聊天室），
// 是否到期與上限由 metaPollDue 判斷。
const META_ALARM = 'ytcas-meta-poll';
async function openVideoIds() {
  const out = new Set();
  try {
    const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/watch*', 'https://www.youtube.com/live_chat*', 'https://www.youtube.com/live/*'] });
    for (const t of tabs) {
      try {
        const u = new URL(t.url);
        const v = u.searchParams.get('v') || (/^\/live\/([\w-]{6,20})/.exec(u.pathname) || [])[1];
        if (v && /^[\w-]{6,20}$/.test(v)) out.add(v);
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  return out;
}
async function pollOpenStreams() {
  const done = [];
  for (const videoId of await openVideoIds()) {
    const s = await DB.getStream(videoId);
    if (!s) continue;
    const r = await maybeRefetchMeta(videoId, DB.pickStreamTimes(s), 'live').catch(() => null);
    if (r) done.push(videoId);
  }
  return done;
}
function ensureMetaAlarm() {
  try {
    chrome.alarms.get(META_ALARM, (a) => { if (!a) chrome.alarms.create(META_ALARM, { periodInMinutes: 1 }); });
  } catch (_) { /* alarms 不可用 */ }
}

// ---------------------------------------------------------------- F-19 彈出視窗關閉 → 主分頁接手（v30）
// 主要訊號：chrome.tabs.onRemoved（直接關閉視窗時 pagehide 的 CAPTURE_END 可能送不到）；pagehide 為輔助。
// 對照表 { [tabId]: { videoId, sid, notified } } 存 storage.session。
let popoutChain = Promise.resolve();
function withPopout(fn) {
  const next = popoutChain.then(fn, fn);
  popoutChain = next.catch(() => {});
  return next;
}
async function readPopout() {
  const o = await chrome.storage.session.get(C.POPOUT_TABS_KEY);
  return o[C.POPOUT_TABS_KEY] || {};
}
const writePopout = (m) => chrome.storage.session.set({ [C.POPOUT_TABS_KEY]: m });

async function handoffToMainTab(videoId, via) {
  const st = await loadSettings();
  if (st.popoutHandoff === false) { diagLog('P6', 'handoff-disabled', { via: via || null }, { env: 'bg', videoId }); return false; }
  await notifyTabs(videoId, { type: RT.CAPTURE_END, videoId, source: 'popout' });
  diagLog('P6', 'handoff', { via: via || null }, { env: 'bg', videoId });
  return true;
}

// 回傳是否應該通知（同一 session 只通知一次）。gen：每次 CAPTURE_START 換新（T3.5 起重新整理會沿用同一筆 session，
// 不能再用 sid 判斷「期間是否重新開始收錄」）
function markNotified(tabId, sid, gen) {
  return withPopout(async () => {
    const m = await readPopout();
    const e = m[tabId];
    if (!e || e.sid !== sid || e.gen !== gen || e.notified) return false;
    e.notified = true;
    await writePopout(m);
    return true;
  });
}

async function onPopoutTabRemoved(tabId) {
  const e = await withPopout(async () => {
    const m = await readPopout();
    const x = m[tabId];
    if (x) { delete m[tabId]; await writePopout(m); }
    return x || null;
  });
  if (!e) return;
  await DB.captureEnd({ captureSessionId: e.sid }); // 已結束的 session 不會被改寫
  diagLog('P6', 'popout-tab-removed', { notified: !!e.notified }, { env: 'bg', videoId: e.videoId, tab: tabId });
  if (!e.notified) await handoffToMainTab(e.videoId, 'tab-removed');
}

const handlers = {
  async [RT.CAPTURE_START](msg, sender) {
    const videoId = vid(msg);
    let stream = msg.stream && typeof msg.stream === 'object' ? Object.assign({}, msg.stream) : {};
    // F-19：彈出視窗缺場次資訊 → 先抓 watch 頁（最多等 5 秒），暫停判斷才知道頻道
    if (msg.source === 'popout' || msg.source === 'replay') {
      const known = await DB.getStream(videoId);
      const need = !(known && known.title && known.channelHandle && (known.startedAt != null || known.scheduledStartAt != null));
      if (need && !stream.channelHandle) {
        const meta = await withTimeout(fetchStreamMeta(videoId, known && known.scheduledStartAt).catch((e) => { console.info('[ytcas] 場次資訊抓取失敗', String(e && e.message)); return null; }), C.STREAM_META_TIMEOUT_MS);
        if (meta) stream = Object.assign(meta, stream);
      }
    }
    const policy = await capturePolicy(await handleOf(videoId, stream));
    if (!policy.allowed) return { allowed: false, reason: policy.reason };
    const r = await DB.captureStart({ videoId, source: msg.source, duration: msg.duration, stream });
    // F-19（v30）：記下彈出視窗所在分頁，關閉時由 tabs.onRemoved 接手
    const tabId = sender && sender.tab && sender.tab.id;
    if (msg.source === 'popout' && typeof tabId === 'number' && tabId >= 0) {
      await withPopout(async () => {
        const m = await readPopout();
        m[tabId] = { videoId, sid: r.captureSessionId, gen: Date.now() + '-' + Math.random().toString(36).slice(2, 8), notified: false };
        diagLog('P6', 'popout-start', { resumed: !!r.resumed }, { env: 'bg', videoId, tab: tabId });
        await writePopout(m);
      });
    }
    return Object.assign({ allowed: true, stream: pickTimes(await DB.getStream(videoId)) }, r);
  },

  async [RT.CAPTURE_END](msg, sender) {
    const s = await DB.captureEnd({ captureSessionId: msg.captureSessionId, endedAt: msg.endedAt });
    // F-19：彈出視窗 pagehide（輔助訊號）→ 等一下再通知主分頁；期間同一分頁重新開始收錄（重新整理）就不接手
    if (s && s.source === 'popout') {
      const tabId = sender && sender.tab && sender.tab.id;
      diagLog('P6', 'popout-end', { empty: !!s.empty }, { env: 'bg', videoId: s.videoId, tab: tabId });
      const gen = typeof tabId === 'number' && tabId >= 0 ? (((await readPopout())[tabId]) || {}).gen : undefined;
      setTimeout(async () => {
        try {
          if (typeof tabId === 'number' && tabId >= 0) {
            if (await markNotified(tabId, s.id, gen)) await handoffToMainTab(s.videoId, 'pagehide');
          } else {
            await handoffToMainTab(s.videoId, 'pagehide-notab'); // 沒有分頁資訊：直接通知
          }
        } catch (e) { console.warn('[ytcas] 彈出視窗接手失敗', String(e && e.message)); }
      }, C.POPOUT_RELOAD_GRACE_MS);
    }
    return { session: s || null };
  },

  async [RT.SAVE_MESSAGES](msg) {
    const videoId = vid(msg);
    const policy = await capturePolicy(await handleOf(videoId, msg.stream));
    if (!policy.allowed) return { ok: false, error: 'paused', reason: policy.reason };
    const r = await DB.saveMessages({ videoId, stream: msg.stream, messages: Array.isArray(msg.messages) ? msg.messages : [],
      source: C.CAPTURE_SOURCES.includes(msg.source) ? msg.source : 'live', captureSessionId: msg.captureSessionId });
    if (r.changed.length) {
      broadcast({ type: RT.NEW_MESSAGES, videoId, messages: r.changed });
      enqueueHandles(r.changed.map((m) => m.authorHandle)).catch(() => {});
    }
    // T3.6：到期時在背景重新抓取 meta（不阻塞回應；結果在下一批的回應中帶給擷取端）
    const src = C.CAPTURE_SOURCES.includes(msg.source) ? msg.source : 'live';
    maybeRefetchMeta(videoId, r.stream, src).catch((e) => console.info('[ytcas] 場次資訊更新失敗', String(e && e.message)));
    // stream：background 目前認定的開播／結束時間與來源，擷取端以來源等級決定是否採用
    return { added: r.added, merged: r.merged, unchanged: r.unchanged, fpMerged: r.fpMerged, stream: r.stream };
  },

  async [RT.SAVE_PINNED](msg) {
    const videoId = vid(msg);
    return DB.savePinned({ videoId, message: msg.message, source: msg.source || 'live' });
  },

  async [RT.MESSAGE_DELETED](msg) {
    const videoId = vid(msg);
    const r = await DB.markDeleted({ videoId, id: String(msg.id || ''), deletedAt: msg.deletedAt });
    if (r.record) broadcast({ type: RT.NEW_MESSAGES, videoId, messages: [r.record] });
    return { found: r.found };
  },

  async [RT.QUERY_MESSAGES](msg) {
    return { messages: await DB.queryMessages(vid(msg), msg.filter || {}) };
  },

  async [RT.LIST_STREAMS]() {
    await DB.closeStaleSessions();
    return { streams: await DB.listStreams() };
  },

  async [RT.LIST_CAPTURE_SESSIONS](msg) {
    await DB.closeStaleSessions();
    return DB.listCaptureSessions(vid(msg));
  },

  async [RT.GET_CAPTURE_POLICY](msg) {
    return capturePolicy(msg.channelHandle);
  },

  async [RT.GET_STORAGE_USAGE]() {
    const s = await loadSettings();
    let usage = null, quota = null;
    try { const e = await navigator.storage.estimate(); usage = e.usage; quota = e.quota; } catch (_) { /* ignore */ }
    const warnBytes = s.storageWarnBytes;
    return { usage, quota, warnBytes, warn: usage != null && usage > warnBytes, streams: await DB.storageSummary() };
  },

  // v43（T5.2 (I)）面板的「在後台開啟此場次」：由 background 開新分頁（擴充功能發起的導覽不受 use_dynamic_url 限制）。
  // 只接受擴充功能頁面（ADMIN）；網址固定為本擴充功能的 viewer.html，只帶通過檢查的 videoId
  async [RT.OPEN_VIEWER](msg, sender) {
    const url = chrome.runtime.getURL('src/viewer.html') + '?v=' + encodeURIComponent(vid(msg));
    const opt = { url };
    const tab = sender && sender.tab;
    if (tab && typeof tab.index === 'number') { opt.index = tab.index + 1; if (typeof tab.windowId === 'number') opt.windowId = tab.windowId; }
    if (tab && typeof tab.id === 'number') opt.openerTabId = tab.id;
    await chrome.tabs.create(opt);
    return {};
  },

  async [RT.DELETE_STREAM](msg) {
    return { deleted: await DB.deleteStreams([vid(msg)]) };
  },

  async [RT.DELETE_STREAMS](msg) {
    const ids = Array.isArray(msg.videoIds) ? msg.videoIds.map((v) => vid({ videoId: v })) : [];
    return { deleted: await DB.deleteStreams(ids) };
  },

  async [RT.RESET_STREAM](msg) {
    return { reset: await DB.resetStream(vid(msg)) };
  },

  async [RT.RECLASSIFY_SYSTEM](msg) {
    const r = await DB.reclassifySystem({ videoId: msg.videoId ? vid(msg) : undefined, tagMap: SEL.messageTypeByTag });
    console.info('[ytcas] 重新分類系統訊息', { scanned: r.scanned, changed: r.changed }); // 只記筆數
    return r;
  },

  async [RT.MIGRATE_LEGACY]() {
    return autoMigrateLegacy(true);
  },

  async [RT.IMPORT_DATA](msg) {
    return DB.importData(msg.data, { dryRun: !!msg.dryRun });
  },

  async [RT.EXPORT_STREAM](msg) {
    return { data: await DB.exportData({ videoId: msg.videoId ? vid(msg) : undefined }) };
  },

  async [RT.SET_VERSION_LABEL](msg) {
    return { stream: await DB.setVersionLabel({ videoId: vid(msg), versionId: msg.versionId, label: msg.label }) };
  },
  async [RT.LINK_VIDEO](msg) {
    return { stream: await DB.linkVideo({ videoId: vid(msg), linkedVideoId: msg.linkedVideoId, label: msg.label, offsetShift: msg.offsetShift }) };
  },
  // F-20：content script 的探針紀錄（記錄中才會送；這裡再檢查一次並消毒）
  async [RT.DIAG_LOG](msg, sender) {
    await loadDiag();
    if (!diagState.active) return { accepted: 0, active: false };
    const tab = sender && sender.tab ? sender.tab.id : null;
    let n = 0;
    for (const r of Array.isArray(msg.records) ? msg.records.slice(0, 500) : []) {
      if (!r || !D.PROBES.includes(r.probe) || !diagOn(r.probe)) continue;
      diagLog(r.probe, r.kind, r.data, Object.assign({}, r.ctx || {}, { tab }), r.ts);
      n++;
    }
    return { accepted: n, active: true };
  },
  // F-20：擴充功能頁面（tools/diag.html、之後的後台）控制
  async [RT.DIAG_CONTROL](msg) {
    const op = msg.op;
    if (op === 'start') {
      // T3.8 C-2：開始時檢查斷線分頁（這些分頁的探針不會送出，控制頁提示重新整理）
      const status = await diagStart(msg.opts || {});
      const staleTabs = await findStaleTabs();
      diagLog('P6', 'stale-tabs', { count: staleTabs.length, kinds: staleTabs.map((t) => t.kind) });
      return { status, staleTabs };
    }
    if (op === 'staleTabs') return { staleTabs: await findStaleTabs() };
    if (op === 'reinject') {
      const r = await reinjectYouTubeTabs(Array.isArray(msg.tabIds) ? msg.tabIds.filter((x) => typeof x === 'number') : undefined);
      await new Promise((res) => setTimeout(res, 500));
      return { reinject: r, staleTabs: await findStaleTabs() };
    }
    if (op === 'stop') return { status: await diagStop('manual') };
    if (op === 'status') return { status: await diagStatus() };
    if (op === 'export') { const data = await diagExport(); await markExported(); return { data }; }
    if (op === 'summary') return { text: await diagSummary(msg.maxLines || 200) };
    if (op === 'clear') { await DB.diagClear(); return { status: await diagStatus() }; }
    throw new Error('unknown op');
  },

  async [RT.UNLINK_VIDEO](msg) {
    return { stream: await DB.unlinkVideo({ videoId: vid(msg), linkedVideoId: msg.linkedVideoId }) };
  },
};

async function notifyTabs(videoId, msg) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
    for (const t of tabs) {
      try {
        if (t.url && new URL(t.url).searchParams.get('v') === videoId) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, msg.type)) return false;
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (ADMIN.has(msg.type) && !isExtensionPage(sender)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }
  handlers[msg.type](msg, sender)
    .then((r) => sendResponse(Object.assign({ ok: true }, r)))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // 非同步回應
});

// ---------------------------------------------------------------- 啟動
function onWake() {
  DB.closeStaleSessions().catch((e) => console.warn('[ytcas] closeStaleSessions', e));
  kickQueue(); // SW 被喚醒時接續頻道解析佇列
  ensureMetaAlarm();
  diagCheck().catch(() => {}); // F-20：排程開始、超過時限停止、30 天後清除、REC 標記
  // T3.9 B-1：等 onInstalled（若有）先處理，再檢查斷線分頁。
  // T4.1：3 秒 → 1 秒（onInstalled 在 SW 腳本執行後立即觸發；加上 PING 逾時 1.5 秒，關閉再開啟後約 3 秒內接上）
  setTimeout(() => { reconnectStaleTabs().catch((e) => console.info('[ytcas] 斷線分頁檢查失敗', C.asciiOnly(e && e.message))); }, 1000);
}

// chrome.alarms 分派（T3.7）：各功能以 alarmHandlers[name] 登記
const alarmHandlers = {
  [META_ALARM]: () => pollOpenStreams(),
  'ytcas-diag': async (a) => {
    await diagCheck();
    if (a.name === 'ytcas-diag-p5') await runP5();
    await flushDiag();
  },
};
try {
  chrome.alarms.onAlarm.addListener((a) => {
    const h = alarmHandlers[a.name] || (a.name.startsWith('ytcas-diag') && alarmHandlers['ytcas-diag']);
    if (h) Promise.resolve().then(() => h(a)).catch((e) => console.info('[ytcas] 排程工作失敗', a.name, String(e && e.message)));
  });
} catch (_) { /* alarms 不可用（測試頁以外不會發生） */ }

// ---------------------------------------------------------------- T3.8 擴充功能更新後自動接回已開著的 YouTube 分頁
// （審查十追加七 C-1、E：使用者同意 scripting 權限）擴充功能 🔄 或 Chrome 自動更新後，已開著的分頁裡的舊 content script
// 與新的 background 斷線（只剩修剪、不再收錄）。update 時對所有 YouTube 分頁的所有 frame 重新注入 content script；
// 新腳本會讓同一環境裡已斷線的舊實例退場（content.js 的 __ytcasRetire）。
// PoC（src/poc/）的腳本依 frame 有不同的 matches，無法以 allFrames 正確重現，不重新注入（PoC 需要 F5；T9 移除）。
const REINJECT_FILES = ['src/constants.js', 'src/selectors.js', 'src/capture.js', 'src/panel.js', 'src/content.js']; // T5：加入 panel.js
async function reinjectYouTubeTabs(tabIds) {
  const out = { tabs: 0, ok: 0, failed: [] };
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }); } catch (_) { return out; }
  for (const t of tabs) {
    if (tabIds && !tabIds.includes(t.id)) continue;
    if (t.discarded) continue; // 被 Chrome 卸載的分頁：使用者切回時會重新載入，manifest 會自動注入
    out.tabs++;
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: REINJECT_FILES });
      out.ok++;
    } catch (e) {
      out.failed.push({ tabId: t.id, error: C.asciiOnly(e && e.message) });
    }
  }
  console.info('[ytcas] 已重新接上 YouTube 分頁', { tabs: out.tabs, ok: out.ok, failed: out.failed.length });
  diagLog('P6', 'reinject', { tabs: out.tabs, ok: out.ok, failed: out.failed.length });
  return out;
}

// T3.8（審查十追加七 C-2）斷線分頁偵測：對每個 YouTube 分頁的 top frame 送 PING，1.5 秒內沒有回應 = 斷線
//（例如注入失敗、在 T3.8 以前的版本更新後沒有重新整理）。回傳只有分頁 id、種類、videoId 前 4 碼
async function findStaleTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }); } catch (_) { return []; }
  const kindOf = (u) => { try { const x = new URL(u); return x.pathname.startsWith('/live_chat') ? 'popout' : (x.pathname === '/watch' || x.pathname.startsWith('/live/') ? 'watch' : 'other'); } catch (_) { return 'other'; } };
  const vid4 = (u) => { try { const v = new URL(u).searchParams.get('v'); return v ? v.slice(0, 4) + '…' : null; } catch (_) { return null; } };
  const checks = tabs.filter((t) => !t.discarded).map(async (t) => {
    let ok = false;
    try {
      const r = await Promise.race([chrome.tabs.sendMessage(t.id, { type: RT.PING }), new Promise((res) => setTimeout(() => res(null), 1500))]);
      ok = !!(r && r.ok);
    } catch (_) { ok = false; }
    return ok ? null : { tabId: t.id, kind: kindOf(t.url), video: vid4(t.url) };
  });
  return (await Promise.all(checks)).filter(Boolean);
}

// T3.9（審查十追加八 B-1）Service Worker 每次啟動（每個 SW 實例一次）檢查斷線分頁並只對它們重新注入：
// 涵蓋 install／update 以外、已開著的分頁也會斷線的情況（在 chrome://extensions 關閉再開啟擴充功能不會觸發 onInstalled）。
// 成本：每個 YouTube 分頁 1 次 PING。仍在載入的分頁略過（manifest 會注入）。install／update 已全部重新注入時不再檢查。
let wakeChecked = false;
async function reconnectStaleTabs() {
  if (wakeChecked) return null;
  wakeChecked = true;
  const stale = await findStaleTabs();
  let ids = [];
  if (stale.length) {
    let loading = new Set();
    try { loading = new Set((await chrome.tabs.query({ url: 'https://www.youtube.com/*' })).filter((t) => t.status === 'loading').map((t) => t.id)); } catch (_) {}
    ids = stale.map((s) => s.tabId).filter((id) => !loading.has(id));
  }
  diagLog('P6', 'wake-check', { stale: stale.length, reinject: ids.length });
  // T4.1：實機確認用（只有分頁數），不需開診斷記錄也看得到
  console.info('[ytcas] Service Worker 啟動檢查', { youtubeTabsStale: stale.length, reinject: ids.length });
  return ids.length ? reinjectYouTubeTabs(ids) : { tabs: 0, ok: 0, failed: [] };
}

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[ytcas] installed', details.reason, chrome.runtime.getManifest().version_name);
  autoMigrateLegacy(false).catch((e) => console.warn('[ytcas] 舊資料遷移失敗', e));
  // T3.9 B-1：首次安裝也重新注入（安裝前就開著的 YouTube 分頁沒有 content script）
  if (details.reason === 'update' || details.reason === 'install') {
    wakeChecked = true;
    reinjectYouTubeTabs().catch((e) => console.info('[ytcas] 重新注入失敗', C.asciiOnly(e && e.message)));
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  onPopoutTabRemoved(tabId).catch((e) => console.warn('[ytcas] 彈出視窗關閉處理失敗', String(e && e.message)));
});
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.remove(C.POPOUT_TABS_KEY).catch(() => {}); // 瀏覽器重開：舊分頁 id 已無效

  autoMigrateLegacy(false).catch((e) => console.warn('[ytcas] 舊資料遷移失敗', e));
});

onWake();

// 測試頁使用（Service Worker 中無副作用）
self.YTCAS_BG = { handlers, capturePolicy, enqueueHandles, parseChannelHtml, parseWatchHtml, fetchStreamMeta, kickQueue,
  autoMigrateLegacy, readQueue, readPopout, maybeRefetchMeta, pollOpenStreams, findStaleTabs, reinjectYouTubeTabs, reconnectStaleTabs, _setWakeChecked: (v) => { wakeChecked = !!v; }, _metaPoll: metaPoll, onPopoutTabRemoved, cleanupJunkSystem, dedupePinned, avatarHosts, fillAvatars, channelStats, retryFailedChannels, isJunkTag, reclassifySystem, fieldStats, recomputeStream, diag, _inflight: inflight };
