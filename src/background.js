// Service Worker：唯一的 IndexedDB 寫入者、推播、頻道名稱解析（SPEC 3.2、4.2、F-03、F-11、F-14～F-16、F-18、F-19）。
// SW 可能隨時被終止：收到資料立即寫入 IndexedDB；頻道解析佇列存 chrome.storage.session（SPEC 3.2 v28）。
importScripts('constants.js', 'selectors.js', 'db.js', 'viewer-core.js'); // viewer-core：純函式（T5.3 sourceStats 用）

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
// v48（T5.7，審查十一 28.2 第 4 點）與 C.domHandle 同一條規則（聊天室 DOM 給的 handle：1～100 字，字元類別含 \p{M} 組合符號）。
// v47 以前這裡少了 \p{M}（含組合符號的 handle 不會排入頻道解析），而 constants 的 handleOf 是 3～30 字（內文推斷用）
const HANDLE_RE = C.DOM_HANDLE_RE;
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
    for (const h of need) if (!q[h]) { q[h] = newQueueItem(h); n++; }
    if (n) await writeQueue(q);
    return n;
  });
  kickQueue();
  return added;
}
// v52（T6.3 第 6 項）佇列項目不再存 addedAt：整份佇列每次寫入都要序列化（壓力測試 2,000 個 handle 時，
// 每筆多 24 bytes 讓直播 30 分鐘 P95 從約 48ms 升到約 62ms）。排入時間只記在記憶體（SW 重啟後未知），
// 排入順序＝物件鍵的插入順序（JSON 來回保留順序）
const queuedAt = new Map();
function newQueueItem(h) { queuedAt.set(h, Date.now()); return { attempts: 0, nextAt: 0 }; }
const queuedTime = (h, it) => queuedAt.get(h) ?? (it && typeof it.addedAt === 'number' ? it.addedAt : null);

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

// v51（T6.2，審查十一 32.10）解析統計（只有次數與時間）：網路錯誤（fetch 本身失敗，例如 Failed to fetch）累計與時間、
// 完成時間（近 10 分鐘的處理速度）、連續網路錯誤（指數退避：暫停整個佇列）。存在 storage.session（SW 重啟後保留）
const CH_STATS_KEY = 'channelStatsV51';
const chStats = { netErrors: 0, netErrorTimes: [], doneTimes: [], consecutiveNet: 0, pauseUntil: 0, loaded: false };
async function loadChStats() {
  if (chStats.loaded) return;
  chStats.loaded = true;
  try { const o = (await chrome.storage.session.get(CH_STATS_KEY))[CH_STATS_KEY]; if (o) Object.assign(chStats, o, { loaded: true }); } catch (_) { /* ignore */ }
}
function saveChStats() {
  const t = Date.now();
  chStats.netErrorTimes = chStats.netErrorTimes.filter((x) => t - x < 3600e3).slice(-500);
  chStats.doneTimes = chStats.doneTimes.filter((x) => t - x < 600e3).slice(-2000);
  const { loaded, ...o } = chStats; // eslint-disable-line no-unused-vars
  try { chrome.storage.session.set({ [CH_STATS_KEY]: o }); } catch (_) { /* ignore */ }
}
// 網路錯誤＝fetch 本身拋錯（沒有 HTTP 狀態）：可能是 SW 暫停、被限流斷線、網路或其他擴充功能攔截
const isNetError = (e) => !!e && !e.failInfo && (e.name === 'TypeError' || /failed to fetch|network/i.test(String(e.message || '')));
// 連續網路錯誤 → 整個佇列暫停 30 秒 × 2^(n−2)（2 次起，最多 10 分鐘），不提高併發
function netBackoffMs(n) { return n < 2 ? 0 : Math.min(30000 * 2 ** (n - 2), 10 * 60 * 1000); }

// v51（32.10）可見優先：面板畫面上的作者（prio 較新的）排最前面，其餘依加入順序
// （v52：加入順序＝物件鍵的插入順序，Array.prototype.sort 是穩定排序）
const orderQueue = (q) => Object.entries(q).sort((a, b) => (b[1].prio || 0) - (a[1].prio || 0));

function kickQueue() {
  if (kickTimer) { clearTimeout(kickTimer); kickTimer = null; }
  withQueue(async () => {
    await loadChStats();
    const q = await readQueue();
    const now = Date.now();
    if (chStats.pauseUntil > now) { kickTimer = setTimeout(kickQueue, chStats.pauseUntil - now + 50); return; }
    let soonest = Infinity;
    for (const [h, it] of orderQueue(q)) {
      if (inflight.has(h)) continue;
      if (it.nextAt > now) { soonest = Math.min(soonest, it.nextAt); continue; }
      if (inflight.size >= C.CHANNEL_RESOLVE_CONCURRENCY) break;
      inflight.add(h);
      processHandle(h);
    }
    if (soonest !== Infinity) kickTimer = setTimeout(kickQueue, Math.max(1000, soonest - now));
  }).catch((e) => console.warn('[ytcas] 頻道解析佇列錯誤', e));
}

// v51（32.10）面板目前畫面上的作者 handle → 排到佇列最前面（還沒排入的、快取過期的一併排入）
async function prioritizeHandles(handles) {
  const uniq = Array.from(new Set((handles || []).filter((h) => typeof h === 'string' && HANDLE_RE.test(h)))).slice(0, 100);
  if (!uniq.length) return { queued: 0, prioritized: 0 };
  const now = Date.now();
  const need = [];
  for (const h of uniq) if (!isFresh(await DB.getChannel(h), now)) need.push(h);
  const r = await withQueue(async () => {
    const q = await readQueue();
    let queued = 0, prioritized = 0;
    for (const h of need) {
      if (!q[h]) { q[h] = newQueueItem(h); queued++; }
      q[h].prio = now; prioritized++;
    }
    if (need.length) await writeQueue(q);
    return { queued, prioritized };
  });
  if (need.length) kickQueue();
  return r;
}

async function processHandle(h) {
  let info = null;
  let err = null;
  try { info = await resolveOne(h); } catch (e) { err = e; }
  await loadChStats();
  const net = isNetError(err);
  if (net) {
    chStats.netErrors++; chStats.netErrorTimes.push(Date.now()); chStats.consecutiveNet++;
    const ms = netBackoffMs(chStats.consecutiveNet);
    if (ms) chStats.pauseUntil = Date.now() + ms;
  } else {
    chStats.consecutiveNet = 0;
    if (info || err) chStats.doneTimes.push(Date.now());
  }
  saveChStats();
  try {
    await withQueue(async () => {
      const q = await readQueue();
      const it = q[h] || newQueueItem(h);
      it.lastTriedAt = Date.now();
      if (net && (it.netErrors || 0) < 5) {
        // 網路錯誤不計入嘗試次數（不是這個 handle 的問題），稍後再試；同一個 handle 連 5 次網路錯誤後才照一般失敗計
        it.nextAt = Date.now() + 30000;
        it.netErrors = (it.netErrors || 0) + 1;
        q[h] = it;
      } else if (info) {
        delete q[h]; queuedAt.delete(h);
        const rec = { handleOrId: h, displayName: info.displayName, avatar: info.avatar, fetchedAt: Date.now(), credentialsUsed: info.credentialsUsed || null };
        await DB.putChannel(rec);
        broadcast({ type: RT.CHANNEL_RESOLVED, handleOrId: h, displayName: rec.displayName, avatar: rec.avatar });
      } else {
        it.attempts++;
        if (it.attempts >= C.CHANNEL_MAX_ATTEMPTS) {
          delete q[h]; queuedAt.delete(h);
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
// v45（T5.4，審查十一 21.2）既有資料的 phase 重算。用法：await YTCAS_BG.fixPhases()（預覽，只有筆數）→ { dryRun: false }
// v47（T5.6，審查十一 26.1）waiting：待機室被記了開播時間的場次（清除 startedAt、訊息改回 pre）
// v54（T6.4，審查十一 35.4／35.6）list 每場加 replay（只來自重播）／merged（live 與 replay 合併）的改動筆數；
// waitingLive：還在待機室、被存成 live 的直播訊息 → pre
async function fixPhases(opts) {
  const r = await DB.recomputeAllPhases({ dryRun: !(opts && opts.dryRun === false) });
  r.findStream = FIND_HINT; // v55（37.4）
  console.info('[ytcas] phase 重算' + (r.dryRun ? '（預覽）' : ''), r);
  return r;
}
// v47（T5.6，審查十一 26.1 第 1 點）單一場次的時間與來源（SW Console）：await YTCAS_BG.streamTimes('videoId')
// 只有時間（ISO）、來源代碼與旗標，不含標題與頻道
async function streamTimes(videoId) {
  vid({ videoId });
  const s = await DB.getStream(videoId);
  if (!s) return { ok: false, error: 'no-stream' };
  const iso = (t) => (typeof t === 'number' ? new Date(t).toISOString() : null);
  return { ok: true, vid: String(videoId).slice(0, 4), startedAt: iso(s.startedAt), startedAtSource: s.startedAtSource || null,
    startedAtSuspect: !!s.startedAtSuspect, scheduledStartAt: iso(s.scheduledStartAt), scheduledFuture: !!s.scheduledFuture,
    startPending: !!s.startPending, endedAt: iso(s.endedAt), endedAtSource: s.endedAtSource || null, isLive: !!s.isLive,
    effectiveStart: iso(C.effectiveStart(s)), createdAt: iso(s.createdAt),
    liveConfirmed: iso(s.liveConfirmedAt), // v48（27 第 1 點）重新抓取確認正在直播（isLiveNow）的時間
    // v51（T6.2，32.8）第一次得知開播的來源（signal＝播放器長度出現、meta-actual＝頁面或重新抓取的 meta）與得知的時間
    firstStartSource: s.startFirstSource || null, firstStartKnown: iso(s.startFirstAt) };
}
// v55（T6.5，審查十一 37.4）依 videoId 前綴找場次（SW Console）：await YTCAS_BG.findStream('G1Ov')
// 回傳完整 videoId、後台網址、YouTube watch 網址、則數、開播日期與狀態；**不回傳標題與頻道**（Console 不輸出影片標題）。
// videoId 區分大小寫：先找大小寫相符的前綴，沒有才不分大小寫（caseInsensitive: true）
const FIND_HINT = "videoId 只列前 4 碼；完整 videoId 與後台／YouTube 網址：await YTCAS_BG.findStream('前 4 碼')";
function streamLinks(videoId) {
  return { videoId, backend: chrome.runtime.getURL('src/backend.html') + '?v=' + encodeURIComponent(videoId),
    youtube: 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) };
}
async function findStream(prefix) {
  const p = String(prefix || '').trim();
  if (!p) return { ok: false, error: 'empty-prefix' };
  const all = await DB.listStreams();
  const hit = all.filter((s) => typeof s.videoId === 'string' && s.videoId.startsWith(p));
  const list = (hit.length ? hit : all.filter((s) => typeof s.videoId === 'string' && s.videoId.toLowerCase().startsWith(p.toLowerCase())))
    .map((s) => Object.assign(streamLinks(s.videoId), { messages: s.messageCount || 0,
      startedAt: typeof (s.startedAt ?? s.scheduledStartAt) === 'number' ? new Date(s.startedAt ?? s.scheduledStartAt).toISOString() : null,
      status: s.endedAt != null ? 'ended' : C.isFutureScheduled(s) ? 'waiting' : s.isLive ? 'live' : 'unknown' }));
  const r = { ok: true, prefix: p, matches: list.length, list, caseInsensitive: !hit.length && list.length > 0 };
  console.info('[ytcas] findStream', r);
  return r;
}
// v45（T5.4，審查十一 20.4 第 5 點）既有禮物的作者與 @handle 連結。用法：await YTCAS_BG.fixGiftAuthors()（預覽）→ { dryRun: false }
async function fixGiftAuthors(opts) {
  const r = await DB.fixGiftAuthors({ dryRun: !(opts && opts.dryRun === false) });
  console.info('[ytcas] 禮物作者' + (r.dryRun ? '（預覽）' : ''), r);
  return r;
}
// v51（T6.2，審查十一 32.7）訊息時間晚於寫入時間（前幾天的待機室訊息被當成今天）。
// 用法：await YTCAS_BG.fixFutureTimes()（預覽：筆數、phase 會改變的筆數、最多晚幾分鐘、各場筆數，videoId 4 碼）→ { dryRun: false }
async function fixFutureTimes(opts) {
  const r = await DB.fixFutureTimes({ dryRun: !(opts && opts.dryRun === false) });
  console.info('[ytcas] 未來時間的訊息' + (r.dryRun ? '（預覽）' : ''), r);
  return r;
}
// v50（T6.1，審查十一 30.5 第 4 點）自己送出的訊息被存成兩筆（暫時 id＋正式 id）。
// 用法：await YTCAS_BG.fixOwnDuplicates()（預覽：筆數、各場筆數，videoId 4 碼）→ await YTCAS_BG.fixOwnDuplicates({ dryRun: false })
// v54（T6.4，34.3）預覽多了 twinFar（時間差分布、另一筆的 tsSource、sameMinute 候選數）；
// sameMinute 的配對要明確指定才合併：fixOwnDuplicates({ dryRun: false, sameMinute: true })
async function fixOwnDuplicates(opts) {
  const r = await DB.fixOwnDuplicates({ dryRun: !(opts && opts.dryRun === false), sameMinute: !!(opts && opts.sameMinute) });
  r.findStream = FIND_HINT; // v55（37.4）
  console.info('[ytcas] 自己送出的重複訊息' + (r.dryRun ? '（預覽）' : ''), r);
  return r;
}

// T5.3（審查十一 18.1 (K)）live／replay 來源統計（SW Console）：await YTCAS_BG.sourceStats()（已結束的場次，最多 30 場）
// 或 { videoId }。只有數字：videoId 只留前 4 字、沒有標題與訊息內容。
//   sources：只有 live／只有 replay／兩者（已合併）；offsetSource；disorder：依到達時間排序時 v1 offset 倒退（> 1 秒）的筆數（依來源）；
//   cal：VOD 校正值（replay offset − live 估計值的中位數，秒）與配對數；dupPairs：live 與 replay 疑似各存一份的筆數（同作者同內容）
async function sourceStats(opts) {
  const CORE = self.YTCAS_VIEWER_CORE;
  const want = opts && opts.videoId;
  const streams = (await DB.listStreams()).filter((s) => (want ? s.videoId === want : s.endedAt != null)).slice(0, want ? 1 : 30);
  const out = [];
  for (const s of streams) {
    const msgs = await DB.queryMessages(s.videoId);
    const cat = (m) => { const a = Array.isArray(m.sources) ? m.sources : []; const l = a.includes('live'), r = a.includes('replay'); return l && r ? 'both' : l ? 'liveOnly' : r ? 'replayOnly' : 'other'; };
    const r = { vid: String(s.videoId).slice(0, 4), messages: msgs.length, endedAt: s.endedAt ? new Date(s.endedAt).toISOString().slice(0, 16) : null,
      sources: { liveOnly: 0, replayOnly: 0, both: 0, other: 0 }, offsetSource: { replay: 0, estimated: 0, none: 0 },
      disorder: { liveOnly: 0, replayOnly: 0, both: 0, other: 0 } };
    let max = -Infinity;
    for (const m of msgs) {
      const c = cat(m);
      r.sources[c]++;
      r.offsetSource[m.offsetSource === 'replay' ? 'replay' : m.offsetSource === 'estimated' ? 'estimated' : 'none']++;
      if ((m.phase || 'live') !== 'live' || typeof m.videoOffsetSec !== 'number') continue;
      if (m.videoOffsetSec < max - 1) r.disorder[c]++;
      max = Math.max(max, m.videoOffsetSec);
    }
    const cal = CORE.vodCalibration(msgs, s);
    r.cal = { delta: cal.delta == null ? null : Math.round(cal.delta * 10) / 10, pairs: cal.pairs, how: cal.how || null };
    r.dupPairs = cal.dupPairs;
    out.push(r);
  }
  console.info('[ytcas] live／replay 來源統計', out);
  return out;
}

// T4.2（審查十一 9）頻道名稱解析統計（SW Console）：await YTCAS_BG.channelStats()
// 只有筆數與失敗原因分布（不含 handle 與名稱）。佇列中尚未解析的數量一併列出
async function channelStats() {
  const r = await DB.channelStats();
  const q = await readQueue();
  const items = Object.values(q);
  const added = Object.entries(q).map(([h, it]) => queuedTime(h, it)).filter((x) => typeof x === 'number');
  r.queued = items.length;
  r.failRate = r.ok + r.failed ? Math.round((r.failed / (r.ok + r.failed)) * 1000) / 10 : 0;
  // v51（T6.2，審查十一 32.10）網路錯誤、佇列中最舊一筆等了多久、近 10 分鐘的處理速度、優先（畫面上）的筆數、暫停
  await loadChStats();
  const now = Date.now();
  r.netErrors = chStats.netErrors;
  r.netErrorsLastHour = chStats.netErrorTimes.filter((x) => now - x < 3600e3).length;
  r.oldestWaitMin = added.length ? Math.round((now - Math.min(...added)) / 60000) : null;
  r.oldestUnknownAge = items.length - added.length; // 排入時間只在記憶體：SW 重啟前排入的不知道
  r.perMinLast10 = Math.round(chStats.doneTimes.filter((x) => now - x < 600e3).length / 10 * 10) / 10;
  r.prioritized = items.filter((x) => x.prio).length;
  r.inflight = inflight.size;
  r.concurrency = C.CHANNEL_RESOLVE_CONCURRENCY;
  r.pausedSec = chStats.pauseUntil > now ? Math.round((chStats.pauseUntil - now) / 1000) : 0;
  r.consecutiveNetErrors = chStats.consecutiveNet;
  return r;
}
// ---------------------------------------------------------------- v52（T6.3，審查十一 33.1 第 6 點）降落自動開彈出視窗
// 觸發：某分頁的聊天室出現降落橫幅（RAID_SEEN）後 RAID_POPOUT_WINDOW_MS 內，同一分頁導航到別的 videoId（tabs.onUpdated）
// → 以 chrome.windows.create({ type: 'popup', focused: false }) 開 www 彈出式聊天室（小尺寸、不搶焦點），繼續收錄原直播的結束後聊天。
// 不開的情況：設定 raidAutoPopout 關閉、同一 videoId 已有彈出視窗（popoutTabs）、這個 videoId 已自動開過。
// 主分頁的面板顯示一行提示（RAID_POPOUT → top content.js → 面板）。彈出視窗由使用者手動關閉（使用者 2026-11-24 決定，不自動關）
const RAID_KEY = 'raidSeenV52';
const RAID_POPOUT_WINDOW_MS = 3 * 60 * 1000;
async function readRaid() { try { return (await chrome.storage.session.get(RAID_KEY))[RAID_KEY] || { seen: {}, opened: {} }; } catch (_) { return { seen: {}, opened: {} }; } }
const writeRaid = (r) => chrome.storage.session.set({ [RAID_KEY]: r });
async function raidSeen(tabId, videoId) {
  if (typeof tabId !== 'number' || tabId < 0 || !isVideoIdStr(videoId)) return;
  const r = await readRaid();
  r.seen[tabId] = { videoId, at: Date.now() };
  await writeRaid(r);
}
const urlVideoId = (u) => { try { const x = new URL(u); return x.searchParams.get('v') || (/^\/live\/([\w-]{6,20})/.exec(x.pathname) || [])[1] || null; } catch (_) { return null; } };
async function maybeRaidPopout(tabId, url) {
  const r = await readRaid();
  const s = r.seen[tabId];
  if (!s) return null;
  const to = urlVideoId(url);
  if (!to || to === s.videoId) return null;
  delete r.seen[tabId];
  if (Date.now() - s.at > RAID_POPOUT_WINDOW_MS) { await writeRaid(r); return 'expired'; }
  await loadSettings();
  if (!settings.raidAutoPopout) { await writeRaid(r); return 'disabled'; }
  if (r.opened[s.videoId]) { await writeRaid(r); return 'already-opened'; }
  const pop = await readPopout();
  if (Object.values(pop).some((x) => x && x.videoId === s.videoId)) { await writeRaid(r); return 'has-popout'; }
  r.opened[s.videoId] = Date.now();
  await writeRaid(r);
  try {
    await chrome.windows.create({ url: 'https://www.youtube.com/live_chat?is_popout=1&v=' + encodeURIComponent(s.videoId), type: 'popup', focused: false, width: 420, height: 640 });
  } catch (e) { console.info('[ytcas] 降落：無法開彈出視窗', C.asciiOnly(String(e && e.message)).slice(0, 80)); return 'create-failed'; }
  diagLog('P6', 'raid-popout', {}, { env: 'bg', videoId: s.videoId, tab: tabId });
  try { const p = chrome.tabs.sendMessage(tabId, { type: RT.RAID_POPOUT, videoId: s.videoId }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  return 'opened';
}
if (chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info && info.url) maybeRaidPopout(tabId, info.url).catch((e) => console.info('[ytcas] 降落彈出視窗判斷失敗', String(e && e.message)));
  });
}
// SW Console：await YTCAS_BG.setRaidAutoPopout(false)
async function setRaidAutoPopout(on) { await chrome.storage.sync.set({ raidAutoPopout: !!on }); settings.raidAutoPopout = !!on; return { raidAutoPopout: !!on }; }

// ---------------------------------------------------------------- v52（T6.3，審查十一 33.1）降落時的資料正確性
// streamCompare(a, b)：兩場的比對（只有數字、代碼、4 碼 videoId，不含標題、名稱、內容）
const v4 = (v) => String(v || '').slice(0, 4);
const isoOf = (t) => (typeof t === 'number' ? new Date(t).toISOString() : null);
const authorKeyOf = (m) => (m.authorHandle || '').toLowerCase() || m.authorChannelId || m.authorName || '';
async function streamFacts(videoId) {
  const [s, msgs, cs] = await Promise.all([DB.getStream(videoId), DB.queryMessages(videoId), DB.listCaptureSessions(videoId)]);
  const sessions = (cs && cs.sessions) || [];
  const tally = (f) => msgs.reduce((o, m) => { const k = f(m) || '(無)'; o[k] = (o[k] || 0) + 1; return o; }, {});
  const firstCap = sessions.reduce((a, x) => Math.min(a, x.startedAt || Infinity), Infinity);
  return { s, msgs, sessions, firstCap, out: {
    v: v4(videoId), messages: msgs.length, phases: tally((m) => m.phase), tsSource: tally((m) => m.tsSource), types: tally((m) => m.type),
    startedAt: isoOf(s && s.startedAt), startedAtSource: (s && s.startedAtSource) || null, endedAt: isoOf(s && s.endedAt), endedAtSource: (s && s.endedAtSource) || null,
    sessions: sessions.map((x) => ({ source: x.source, start: isoOf(x.startedAt), end: isoOf(x.endedAt), added: x.added || 0, merged: x.merged || 0 })),
    beforeFirstCapture: Number.isFinite(firstCap) ? msgs.filter((m) => typeof m.timestampAbs === 'number' && m.timestampAbs < firstCap).length : null,
    firstMsg: isoOf(msgs.reduce((a, m) => Math.min(a, m.timestampAbs || Infinity), Infinity) === Infinity ? null : msgs.reduce((a, m) => Math.min(a, m.timestampAbs || Infinity), Infinity)),
    lastMsg: isoOf(msgs.reduce((a, m) => Math.max(a, m.timestampAbs || 0), 0) || null),
  } };
}
// v53（T6.3.1，審查十一 34.2.2）原場次「降落出去」的那則：raidDir 'out'（最後一則）；沒有方向的舊資料取**最後一則** raid
// （v52 取第一則：LjiG 的第一則是 18:49 別人降落進來的進場卡，比真正的降落早 21 分鐘）
function raidOutOf(msgs) {
  const raids = msgs.filter((m) => m.type === 'raid' && typeof m.timestampAbs === 'number').sort((x, y) => x.timestampAbs - y.timestampAbs);
  const outs = raids.filter((m) => m.raidDir === 'out');
  if (outs.length) return { m: outs[outs.length - 1], how: 'dir' };
  const legacy = raids.filter((m) => !m.raidDir);
  return legacy.length ? { m: legacy[legacy.length - 1], how: 'last' } : null;
}
// fixRaidLeak 的規則（34.2.2）：(1) b 中與 a 同作者、同內容、絕對時間相差 ≤ 120 秒 → a 已經有了，從 b 刪除；
// (2) b 中與 a 降落橫幅同內容的 raid → 從 b 刪除；(3) 其他（例如跟著降落過來的觀眾在新直播的發言）一律保留
const LEAK_DT_MS = 120 * 1000;
function leakCandidates(A, B, ro) {
  const keyOf = (m) => authorKeyOf(m) + '\u0001' + JSON.stringify(m.runs || []);
  const aTimes = new Map();
  for (const m of A.msgs) {
    if (m.type === 'raid' || !authorKeyOf(m)) continue;
    const k = keyOf(m);
    if (!aTimes.has(k)) aTimes.set(k, []);
    aTimes.get(k).push(m.timestampAbs || 0);
  }
  const raidText = ro ? JSON.stringify(ro.m.runs || []) : null;
  const dup = [], banner = [];
  for (const m of B.msgs) {
    if (m.type === 'raid') { if (raidText && JSON.stringify(m.runs || []) === raidText) banner.push(m); continue; }
    const ts = aTimes.get(keyOf(m));
    if (ts && ts.some((t) => Math.abs(t - (m.timestampAbs || 0)) <= LEAK_DT_MS)) dup.push(m);
  }
  return { dup, banner };
}
async function streamCompare(a, b) {
  if (!isVideoIdStr(a) || !isVideoIdStr(b)) return { ok: false, error: 'bad-video-id' };
  const [A, B] = await Promise.all([streamFacts(a), streamFacts(b)]);
  const authA = new Set(A.msgs.map(authorKeyOf).filter(Boolean)), authB = new Set(B.msgs.map(authorKeyOf).filter(Boolean));
  const textA = new Set(A.msgs.map((m) => authorKeyOf(m) + '\u0001' + JSON.stringify(m.runs || [])));
  const cv = (s, other) => (s && s.crossVideo && s.crossVideo[other]) || 0;
  const ro = raidOutOf(A.msgs);
  const raidA = ro ? [ro.m.timestampAbs] : [];
  const lc = leakCandidates(A, B, ro);
  const tally = (arr, f) => arr.reduce((o, m) => { const k = f(m) || '(無)'; o[k] = (o[k] || 0) + 1; return o; }, {});
  const out = { ok: true, a: A.out, b: B.out,
    // v53（34.2.2）原場次降落出去的那則怎麼選的（dir＝有 raidDir out、last＝舊資料取最後一則）、a 的 raid 方向分布
    aRaidPick: ro ? ro.how : null, aRaidDirs: tally(A.msgs.filter((m) => m.type === 'raid'), (m) => m.raidDir),
    // fixRaidLeak 新規則的筆數：(1) 同作者同內容 ≤ 120 秒、(2) 與 a 降落橫幅同內容的 raid；候選的 tsSource 分布
    leak: { sameAuthorText120s: lc.dup.length, raidBanner: lc.banner.length, bAfterDelete: B.msgs.length - lc.dup.length - lc.banner.length,
      tsSource: tally(lc.dup, (m) => m.tsSource) },
    titleSame: !!(A.s && B.s && A.s.title && A.s.title === B.s.title),
    channelSame: !!(A.s && B.s && (A.s.channelHandle || A.s.channelName) && (A.s.channelHandle || A.s.channelName) === (B.s.channelHandle || B.s.channelName)),
    authors: { a: authA.size, b: authB.size, both: [...authB].filter((x) => authA.has(x)).length },
    // b 中「同作者同內容也在 a 出現過」的筆數（漏進 b 的 a 訊息會在這裡；id 全域唯一，同 id 不會存兩份）
    bSameAuthorTextInA: B.msgs.filter((m) => textA.has(authorKeyOf(m) + '\u0001' + JSON.stringify(m.runs || []))).length,
    // id 已存在另一場、合併到那一筆的次數（寫入時記錄，v52 起）
    crossVideo: { aHitB: cv(A.s, b), bHitA: cv(B.s, a) },
    // a 的第一個降落橫幅之後，b 收到、作者只在 a 出現的訊息數（fixRaidLeak 的候選；a 沒有降落則 null）
    bAfterARaidAuthorOnlyInA: raidA.length ? B.msgs.filter((m) => m.timestampAbs >= raidA[0] - 60e3 && authA.has(authorKeyOf(m)) && !authOnlyB(B, m, raidA[0])).length : null,
    aRaidAt: isoOf(raidA[0] || null) };
  return out;
}
// 作者在 b 的「a 降落之前」或「a 降落 10 分鐘後」也出現過 → 是 b 自己的觀眾
function authOnlyB(B, m, raidAt) {
  const k = authorKeyOf(m);
  return B.msgs.some((x) => authorKeyOf(x) === k && (x.timestampAbs < raidAt - 60e3 || x.timestampAbs > raidAt + 10 * 60e3));
}
const isVideoIdStr = (v) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v);

// fixRaidLeak(新, 原)：原場次（a＝orig）降落後，新場次（b＝new）收到的「其實是原場次聊天室」的訊息 → 搬回原場次（post）。
// 規則（streamCompare 的 bAfterARaidAuthorOnlyInA）：b 中時間在 a 第一個降落橫幅前 1 分鐘之後、作者在 a 出現過、
// 而且作者在 b 的其他時段（降落前、降落 10 分鐘後）都沒有出現的訊息；另含 a 的降落橫幅本身（b 中同內容的 raid）。
// 預覽只列筆數；{ dryRun: false } 才搬。**規則依使用者 streamCompare 的結果確認後才執行**
// v53（T6.3.1，審查十一 34.2.2）規則依使用者的 streamCompare 證據改寫（v52 的「作者只在原場次出現」會誤抓跟著降落過來的觀眾，
// 而且以第一則 raid 為基準）：(1) 新場次中與原場次同作者、同內容、絕對時間相差 ≤ 120 秒 → 原場次已經有了，從新場次刪除；
// (2) 新場次中與原場次降落橫幅同內容的 raid → 從新場次刪除；(3) 其他一律保留。不搬移（原場次本來就有那幾則）
async function fixRaidLeak(newVid, origVid, opts) {
  if (!isVideoIdStr(newVid) || !isVideoIdStr(origVid)) return { ok: false, error: 'bad-video-id' };
  const dryRun = !(opts && opts.dryRun === false);
  const [A, B] = await Promise.all([streamFacts(origVid), streamFacts(newVid)]);
  if (!A.msgs.length) return { ok: false, dryRun, error: 'orig-empty' }; // 34.1：videoId 打錯時 a 是空的
  const ro = raidOutOf(A.msgs);
  const { dup, banner } = leakCandidates(A, B, ro);
  const out = { ok: true, dryRun, orig: v4(origVid), new: v4(newVid), raidPick: ro ? ro.how : null,
    sameAuthorText120s: dup.length, raidBanner: banner.length, bBefore: B.msgs.length, bAfter: B.msgs.length - dup.length - banner.length,
    phases: dup.concat(banner).reduce((o, m) => { o[m.phase || '(無)'] = (o[m.phase || '(無)'] || 0) + 1; return o; }, {}), deleted: 0 };
  if (dryRun) return out;
  const r = await DB.deleteMessagesIn(newVid, dup.concat(banner).map((m) => m.id));
  out.deleted = r.deleted;
  console.info('[ytcas] 降落後漏進新場次的重複訊息', out);
  return out;
}

// v53（T6.3.1，審查十一 34.2.1 第 4 點）v52 期間誤設的「降落暫定結束」（endedAtSource 'raid'）。
// meta 的 endDate 之後有到（等級較高）的場次會自動覆蓋並重算 phase，fixPhases 也照新的 endedAt 重算；
// 但重新抓取期間（3 小時）沒拿到 endDate 的場次仍停在 raid 的時間 → 這裡逐場重新抓 watch 頁：
//   有 endDate → 以 meta 的結束時間覆蓋（重算 phase）；isLiveNow true 且沒有 endDate → 撤銷；其他 → 不動。
// 預覽只列場次數與 4 碼 videoId；{ dryRun: false } 才抓取與寫入（credentials: 'omit'，與平常的重新抓取相同）
async function fixRaidEnds(opts) {
  const dryRun = !(opts && opts.dryRun === false);
  const list = (await DB.listStreams()).filter((s) => s.endedAt != null && s.endedAtSource === 'raid');
  const out = { dryRun, streams: list.length, vids: list.slice(0, 30).map((s) => v4(s.videoId)), replaced: 0, revoked: 0, kept: 0, failed: 0, changed: 0 };
  if (dryRun) return out;
  for (const s of list) {
    let meta;
    try { meta = await fetchStreamMeta(s.videoId, s.scheduledStartAt); } catch (_) { out.failed++; continue; }
    if (meta && meta.endedAt != null) {
      const r = await DB.saveMessages({ videoId: s.videoId, source: 'live', stream: { endedAt: meta.endedAt, endedAtSource: meta.endedAtSource || 'meta-actual' }, messages: [] });
      if (r && r.stream && r.stream.endedAtSource !== 'raid') out.replaced++; else out.kept++;
    } else if (meta && meta.isLiveNow === true) {
      const r = await DB.revokeRaidEnd(s.videoId);
      if (r.revoked) { out.revoked++; out.changed += r.changed; } else out.kept++;
    } else out.kept++;
  }
  console.info('[ytcas] 降落暫定的結束時間', out);
  return out;
}

// fixStreamMeta(videoId)：重新抓 watch 頁，覆蓋標題與頻道（導航時存了上一場的標題）。不帶參數：列出同頻道同標題、
// 開始時間相差 6 小時內的場次組（只有 4 碼與筆數）。預覽只比較是否相同；{ dryRun: false } 才寫入
async function fixStreamMeta(videoId, opts) {
  const dryRun = !(opts && opts.dryRun === false);
  if (!videoId) {
    const list = await DB.listStreams();
    const groups = new Map();
    for (const s of list) { if (!s.title) continue; const k = s.title; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const dup = [];
    for (const arr of groups.values()) if (arr.length > 1) dup.push(arr.map((s) => ({ v: v4(s.videoId), messages: s.messageCount || 0, created: isoOf(s.createdAt) })));
    return { dryRun: true, sameTitleGroups: dup.length, groups: dup.slice(0, 20), hint: 'fixStreamMeta(videoId) 逐場預覽' };
  }
  if (!isVideoIdStr(videoId)) return { ok: false, error: 'bad-video-id' };
  const s = await DB.getStream(videoId);
  if (!s) return { ok: false, error: 'no-stream' };
  let meta;
  try { meta = await fetchStreamMeta(videoId, s.scheduledStartAt); } catch (e) { return { ok: false, error: 'fetch:' + C.asciiOnly(String(e && e.message)).slice(0, 40) }; }
  if (!meta || !meta.title) return { ok: false, error: 'no-title' };
  const out = { ok: true, dryRun, v: v4(videoId), titleChanges: meta.title !== s.title, channelChanges: (meta.channelHandle || '') !== (s.channelHandle || '') || (meta.channelName || '') !== (s.channelName || '') };
  if (dryRun || !(out.titleChanges || out.channelChanges)) return Object.assign(out, { updated: false });
  await DB.updateStream(videoId, (x) => {
    x.title = meta.title;
    for (const k of ['channelName', 'channelHandle', 'channelUrl']) if (meta[k]) x[k] = meta[k];
  });
  return Object.assign(out, { updated: true });
}

// v51（T6.2，審查十一 32.11）SC 的金額分級：await YTCAS_BG.scTiers()（或 { videoId }）
// 依「幣別前綴＋顏色」統計 SC／超級貼圖的筆數與金額最小／最大值（不含名稱、內容、videoId）。
// overlaps：同一幣別裡，兩種顏色的金額範圍重疊（同幣別但金額與顏色分級不一致的線索，例如 $170 卻是 $75～149 的顏色）
function parseAmount(text) {
  const s = String(text || '').trim();
  const prefix = s.replace(/[\d.,\s  ']/g, '') || '?';
  const m = /\d[\d.,\s  ']*/.exec(s);
  if (!m) return { prefix, value: null };
  let n = m[0].replace(/[\s  ']/g, '');
  const dec = /[.,](\d{1,2})$/.exec(n);
  n = dec ? n.slice(0, dec.index).replace(/[.,]/g, '') + '.' + dec[1] : n.replace(/[.,]/g, '');
  const value = Number(n);
  return { prefix, value: Number.isFinite(value) ? value : null };
}
async function scTiers(opts) {
  const want = opts && typeof opts.videoId === 'string' ? opts.videoId : null;
  const db = await DB.open();
  const all = await new Promise((res, rej) => { const q = db.transaction('messages').objectStore('messages').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const groups = new Map();
  let total = 0, noAmount = 0;
  for (const m of all) {
    if (m.type !== 'superchat' && m.type !== 'supersticker') continue;
    if (want && m.videoId !== want) continue;
    total++;
    const a = parseAmount(m.amount);
    if (a.value == null) { noAmount++; continue; }
    const color = typeof m.color === 'string' && m.color ? m.color.replace(/\s+/g, '').slice(0, 40) : '(無)';
    const k = m.type + '\u0001' + a.prefix + '\u0001' + color;
    const g = groups.get(k) || { type: m.type, currency: a.prefix, color, n: 0, min: Infinity, max: -Infinity };
    g.n++; g.min = Math.min(g.min, a.value); g.max = Math.max(g.max, a.value);
    groups.set(k, g);
  }
  const tiers = Array.from(groups.values()).sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0) || a.min - b.min);
  const overlaps = [];
  for (let i = 0; i < tiers.length; i++) for (let j = i + 1; j < tiers.length; j++) {
    const a = tiers[i], b = tiers[j];
    if (a.type === b.type && a.currency === b.currency && a.color !== b.color && a.min <= b.max && b.min <= a.max) overlaps.push({ type: a.type, currency: a.currency, a: a.color + ' ' + a.min + '～' + a.max, b: b.color + ' ' + b.min + '～' + b.max });
  }
  const out = { total, noAmount, tiers, overlaps };
  console.info('[ytcas] SC 金額分級', out);
  return out;
}
// v51（T6.2，審查十一 32.10 第 1 點）單一 handle 的解析狀態：await YTCAS_BG.channelInfo('@handle')
// 只回傳狀態（ok／pending／retry／failed／unknown）、原因代碼、嘗試次數、時間、是否有名稱；不回傳名稱以外的頁面內容
async function channelInfo(handle) {
  const h = String(handle || '').trim();
  if (!HANDLE_RE.test(h)) return { ok: false, error: 'bad-handle' };
  const [rec, q] = await Promise.all([DB.getChannel(h), readQueue()]);
  const it = q[h];
  const iso = (t) => (typeof t === 'number' ? new Date(t).toISOString() : null);
  const now = Date.now();
  let status = 'unknown';
  if (it) status = inflight.has(h) ? 'resolving' : it.nextAt > now ? 'retry' : 'pending';
  else if (rec && rec.failed) status = 'failed';
  else if (rec && rec.displayName) status = isFresh(rec, now) ? 'ok' : 'stale';
  return { ok: true, status, hasName: !!(rec && rec.displayName), attempts: it ? it.attempts : null, netErrors: it ? it.netErrors || 0 : null,
    retryAt: it && it.nextAt > now ? iso(it.nextAt) : null, queuedAt: it ? iso(queuedTime(h, it)) : null, prioritized: !!(it && it.prio),
    lastTriedAt: iso((it && it.lastTriedAt) || (rec && rec.fetchedAt)), fetchedAt: rec ? iso(rec.fetchedAt) : null,
    failReason: rec && rec.failed ? rec.failReason || null : null, failStatus: rec && rec.failed && rec.failInfo ? rec.failInfo.status ?? null : null,
    credentialsUsed: rec ? rec.credentialsUsed || null : null };
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
    for (const h of handles) if (!q[h]) { q[h] = newQueueItem(h); n++; }
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
  // v49（T6）durationMs（「記錄 N 分鐘」）優先：以實際的開始時間計算，不受診斷頁與這裡取時間的毫秒差影響
  const dur = typeof opts.durationMs === 'number' && Number.isFinite(opts.durationMs) && opts.durationMs > 0 ? opts.durationMs : null;
  const endsAt = dur != null ? Math.min(startAt + dur, maxEnd)
    : typeof opts.endAt === 'number' && opts.endAt > startAt ? Math.min(opts.endAt, maxEnd) : maxEnd;
  const scheduled = startAt > now;
  // v44（T5.3，18.4）P9 取樣間隔（分鐘）
  const p9Minutes = Math.min(D.P9_MAX_MINUTES, Math.max(D.P9_MIN_MINUTES, Math.round(Number(opts.p9Minutes) || D.P9_MINUTES)));
  const st = { active: !scheduled, scheduled, startAt, endsAt, probes, hours, p9Minutes, createdAt: now, stoppedAt: null, reason: null,
    version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version };
  if (!scheduled) await DB.diagClear(); // 新的一段記錄：清掉上一段（匯出後才開始新的）
  await saveDiag(st);
  try {
    if (scheduled) chrome.alarms.create('ytcas-diag-start', { when: startAt });
    chrome.alarms.create('ytcas-diag-stop', { when: endsAt });
    chrome.alarms.create('ytcas-diag-p5', { periodInMinutes: D.P5_MINUTES });
  } catch (_) { /* ignore */ }
  setRecBadge(st.active);
  if (st.active) { diagLog('P1', 'diag-start', { probes, hours, endsAt, p9Minutes }); runP5().catch(() => {}); }
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

// v45（T5.4，審查十一 20.4 第 1 點）禮物結構：非記錄期間也保留最近 5 筆（chrome.storage.session；瀏覽器關閉即清除），診斷匯出時附上。
// 只有標籤、屬性名稱、img 網域、尺寸、有無文字、@ 位置、連結種類（content 端本來就不送文字；這裡再消毒一次）
const GIFT_STRUCT_KEY = 'giftStructs';
async function saveGiftStructure(msg) {
  const rec = { ts: Date.now(), source: sanitizeDiag(msg.source), videoId: sanitizeDiag(msg.videoId), data: sanitizeDiag(msg.data || {}) };
  let list = [];
  try { list = ((await chrome.storage.session.get(GIFT_STRUCT_KEY))[GIFT_STRUCT_KEY]) || []; } catch (_) { /* ignore */ }
  list = list.concat([rec]).slice(-5);
  try { await chrome.storage.session.set({ [GIFT_STRUCT_KEY]: list }); } catch (_) { /* ignore */ }
  return list.length;
}
async function giftStructures() {
  try { return ((await chrome.storage.session.get(GIFT_STRUCT_KEY))[GIFT_STRUCT_KEY]) || []; } catch (_) { return []; }
}

async function diagExport() {
  await flushDiag();
  const st = await diagStatus();
  const ua = (self.navigator && navigator.userAgent) || '';
  return { format: 'ytcas-diag', formatVersion: 1, app: C.EXPORT_APP, version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,
    chrome: (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || null, exportedAt: Date.now(),
    period: { startAt: st.startAt || null, endsAt: st.endsAt || null, stoppedAt: st.stoppedAt || null, reason: st.reason || null, active: !!st.active },
    probes: st.probes || [], p9Minutes: st.p9Minutes || D.P9_MINUTES, giftStructures: await giftStructures(), records: await DB.diagAll() };
}
function pad(n) { return String(n).padStart(2, '0'); }
// v45（20.6）檔名依診斷頁設定的格式（chrome.storage.local），時間取記錄開始時間
let diagFileFmt = C.DIAG_FILE_FORMAT_DEFAULT;
function diagFilename(data) {
  return D.DOWNLOAD_DIR + '/' + C.diagFileName(diagFileFmt, (data.period && data.period.startAt) || data.exportedAt, data.probes) + '.json';
}
// SW Console 用：直接下載（data URL；擴充功能頁面 tools/diag.html 以 Blob 下載）
async function diagDownload() {
  try { const o = await chrome.storage.local.get(C.DIAG_FILE_FORMAT_KEY); if (o && typeof o[C.DIAG_FILE_FORMAT_KEY] === 'string') diagFileFmt = o[C.DIAG_FILE_FORMAT_KEY]; } catch (_) { /* ignore */ }
  const data = await diagExport();
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const id = await chrome.downloads.download({ url: 'data:application/json;base64,' + btoa(bin), filename: diagFilename(data), saveAs: false, conflictAction: 'uniquify' });
  await markExported();
  return { downloadId: id, filename: diagFilename(data), records: data.records.length, bytes: bytes.length };
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

// v44（T5.3 (J)）「在後台開啟此場次」失敗：SW console warnOnce（代碼只有 ASCII，不含網址與個人資料）
const openViewerWarned = new Set();
function openViewerWarn(code) {
  const key = 'openViewer:' + C.asciiOnly(code);
  if (openViewerWarned.has(key)) return;
  openViewerWarned.add(key);
  console.warn('[ytcas] 無法開啟後台分頁', key);
  try { if (diagOn('P8')) diagLog('P8', 'warnOnce', { key, level: 'warn', desc: C.diagWarnText(key) }); } catch (_) { /* ignore */ }
}

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
  // v48（T5.7，審查十一 27 第 1 點、27.1）播放器資料的 isLiveNow：
  //   false 且沒有 endDate → 還沒開播：startDate 是過去帶秒數的時間也不採用（27.1 的待機室），改為等待開播確認；
  //   true 且 meta 判為實際開播 → liveConfirmedAt（重新抓到的頁面確認正在直播；之後頁面上沒重新整理的舊 meta 說「在未來」不得蓋過）
  const lm = SEL.watchHtml.isLiveNow.exec(html);
  const isLiveNow = lm ? lm[1] === 'true' : null;
  if (isLiveNow === false && ed == null && d.startedAt != null) {
    d.startedAt = null; d.startedAtSource = null; d.startPending = true;
    if (d.scheduledStartAt == null) d.scheduledStartAt = knownScheduled ?? null;
  }
  for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt']) if (d[k] != null) meta[k] = d[k];
  if (d.startPending) meta.startPending = true;
  if (typeof d.scheduledFuture === 'boolean') meta.scheduledFuture = d.scheduledFuture; // v47（26.1）
  if (isLiveNow !== null) meta.isLiveNow = isLiveNow;
  if (isLiveNow === true && d.startedAtSource === 'meta-actual' && ed == null) meta.liveConfirmedAt = Date.now();
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
  // v52（T6.3，審查十一 33.1 第 4 點）降落暫定的結束時間（endedAtSource 'raid'）：照常重新抓取，等 meta 的 endDate 覆蓋
  if (s && s.endedAt != null && s.endedAtSource === 'raid') {
    const st = metaPoll.get(videoId) || { firstAt: now, lastAt: 0 };
    if (now - (s.endedAt || now) > C.META_POLL_PENDING_MAX_MS) return null;
    return now - st.lastAt >= C.META_POLL_PENDING_MS ? { st, kind: 'raid-end' } : null;
  }
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
  // v48（T5.7，審查十一 27 第 1 點）待機室（預定時間在未來）：提早開播時頁面上的 meta 不會更新 → 也重新抓。
  // 預定時間 30 分鐘內每 2 分鐘、更早每 15 分鐘；只限有分頁開著的場次（alarms 那條路徑本來就只查開著的）
  if (s.startedAt == null && s.isLive && typeof s.scheduledStartAt === 'number' && s.scheduledStartAt > now) {
    const every = s.scheduledStartAt - now <= C.META_POLL_SOON_WINDOW_MS ? C.META_POLL_SOON_MS : C.META_POLL_FUTURE_MS;
    return now - st.lastAt >= every ? { st, kind: 'future' } : null;
  }
  return null;
}
async function maybeRefetchMeta(videoId, timesIn, source) {
  let times = timesIn;
  if (source !== 'live' && source !== 'popout') return null;
  const now = Date.now();
  const due = metaPollDue(videoId, times, now);
  if (!due) return null;
  due.st.lastAt = now;
  metaPoll.set(videoId, due.st);
  let meta;
  try { meta = await fetchStreamMeta(videoId, times.scheduledStartAt); } catch (e) { console.info('[ytcas] 重新抓取場次資訊失敗', String(e && e.message)); return null; }
  // v52（T6.3，審查十一 33.8.2）每次重新抓取的結果（只有代碼與布林）：liveConfirmed 晚到時，看是 isLiveNow 遲遲不是 true 還是間隔太長
  if (diagOn('P4')) diagLog('P4', 'meta-refetch', { kind: due.kind, isLiveNow: meta.isLiveNow ?? null, hasStart: meta.startedAt != null,
    startSrc: meta.startedAtSource || null, hasEnd: meta.endedAt != null, confirm: meta.liveConfirmedAt != null, cred: meta.credentialsUsed || 'omit' }, { env: 'bg', videoId });
  // v53（T6.3.1，審查十一 34.2.1 第 3 點）降落暫定的結束：重新抓取確認仍在直播（isLiveNow true、沒有 endDate）→ 撤銷、重算 phase
  // （v52 把進場卡也當成降落橫幅，被降落的直播會被提前判為結束）
  if (due.kind === 'raid-end' && meta.isLiveNow === true && meta.endedAt == null) {
    const rv = await DB.revokeRaidEnd(videoId);
    if (rv.revoked) {
      console.info('[ytcas] 重新抓取確認仍在直播：撤銷降落暫定的結束時間', { videoId, changed: rv.changed });
      if (diagOn('P4')) diagLog('P4', 'raid-end-revoked', { changed: rv.changed }, { env: 'bg', videoId });
      times = Object.assign({}, times, { endedAt: null, endedAtSource: null });
    }
  }
  const upd = {};
  for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt', 'startPending', 'scheduledFuture', 'liveConfirmedAt']) if (meta[k] != null) upd[k] = meta[k];
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
    const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/watch*', 'https://www.youtube.com/live_chat*', 'https://www.youtube.com/live/*', 'https://studio.youtube.com/live_chat*'] });
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
    // v52（T6.3，審查十一 33.1 第 3 點）嵌入式聊天室在導航後沒有送標題（頁面 microdata 還是上一場的，content.js 不送）→ 背景抓 watch 頁補上
    if (msg.source === 'live' && !stream.title) {
      DB.getStream(videoId).then((s) => {
        if (s && s.title) return null;
        return fetchStreamMeta(videoId, s && s.scheduledStartAt).then((meta) => {
          if (!meta || !meta.title) return null;
          const m = { title: meta.title };
          for (const k of ['channelName', 'channelHandle', 'channelUrl']) if (meta[k]) m[k] = meta[k];
          return DB.saveMessages({ videoId, stream: m, messages: [], source: 'live' });
        });
      }).catch((e) => console.info('[ytcas] 場次標題補抓失敗', String(e && e.message)));
    }
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
    // v53（T6.3.1，審查十一 34 第 4 點）最新、還沒取消的置頂（擷取端比對置頂列上確定沒有它 → 取消置頂的漏網偵測）
    let lastPin = null;
    try {
      const pins = (await DB.queryPinned(videoId)).filter((p) => p && p.unpinnedAt == null).sort((a, b) => C.pinnedTime(b) - C.pinnedTime(a));
      if (pins[0]) lastPin = { id: pins[0].id, authorHandle: pins[0].authorHandle || '', authorName: pins[0].authorName || '', authorChannelId: pins[0].authorChannelId || '', runs: pins[0].runs || [] };
    } catch (_) { /* ignore */ }
    return Object.assign({ allowed: true, stream: pickTimes(await DB.getStream(videoId)), lastPin }, r);
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
    const r = await DB.savePinned({ videoId, message: msg.message, source: msg.source || 'live' });
    if (r.added || r.merged || r.repinned) broadcast({ type: RT.PINNED_CHANGED, videoId }); // v52（33.3）面板立即更新
    return r;
  },
  // v52（T6.3，審查十一 33.3 第 1 點）取消置頂
  async [RT.UNPIN](msg) {
    const videoId = vid(msg);
    const r = await DB.unpinPinned({ videoId, id: String(msg.id || ''), unpinnedAt: msg.unpinnedAt, source: msg.unpinnedAtSource === 'absent' ? 'absent' : 'gone' });
    if (r.changed) broadcast({ type: RT.PINNED_CHANGED, videoId });
    return r;
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
  // v44（T5.3 (J)）：v43 實機仍是 ERR_BLOCKED_BY_CLIENT。改開**不在 web_accessible_resources 的 backend.html**
  // （viewer.html 設了 use_dynamic_url，靜態 ID 網址的導覽可能被當成存取網頁可存取資源）；不設 openerTabId
  //（避免新分頁的導覽被歸到 YouTube 分頁發起）。失敗時回傳原因代碼並 warnOnce（只有代碼）
  async [RT.OPEN_VIEWER](msg, sender) {
    let videoId;
    try { videoId = vid(msg); } catch (_) { openViewerWarn('bad-video-id'); return { ok: false, error: 'bad-video-id' }; }
    const url = chrome.runtime.getURL('src/backend.html') + '?v=' + encodeURIComponent(videoId);
    const opt = { url };
    const tab = sender && sender.tab;
    if (tab && typeof tab.index === 'number') { opt.index = tab.index + 1; if (typeof tab.windowId === 'number') opt.windowId = tab.windowId; }
    try {
      await chrome.tabs.create(opt);
    } catch (e) {
      // 位置參數不合法（分頁已關閉、視窗不存在等）→ 不指定位置再試一次
      try { await chrome.tabs.create({ url }); } catch (e2) {
        openViewerWarn('tabs-create');
        return { ok: false, error: 'tabs-create:' + C.asciiOnly(String((e2 && e2.message) || e2)).slice(0, 80) };
      }
    }
    return {};
  },

  // v52（T6.3，33.1 第 6 點）聊天室出現降落橫幅（content script 的 chat frame；分頁由 sender.tab 決定）
  async [RT.RAID_SEEN](msg, sender) {
    await raidSeen(sender && sender.tab && sender.tab.id, msg.videoId);
    return {};
  },

  // v51（T6.2，審查十一 32.10 第 2 點）面板畫面上還沒有頻道名稱的作者 handle → 排到解析佇列最前面（可見優先）
  async [RT.RESOLVE_CHANNELS](msg) {
    const r = await prioritizeHandles(Array.isArray(msg.handles) ? msg.handles : []);
    return { queued: r.queued, prioritized: r.prioritized };
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
  // v45（20.4）禮物結構（content script，非記錄期間也送）
  async [RT.GIFT_STRUCTURE](msg) {
    return { kept: await saveGiftStructure(msg) };
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
    // v44（T5.3 (J)）：只記網址的協定（不含網址本身）
    if (msg.type === RT.OPEN_VIEWER) openViewerWarn('forbidden:' + (/^([a-z-]+):/i.exec(String((sender && sender.url) || '')) || [0, 'none'])[1]);
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
// v52（T6.3，審查十一 33.1 第 7 點）studio.youtube.com 的彈出式聊天室（只限 /live_chat）
const YT_TAB_URLS = ['https://www.youtube.com/*', 'https://studio.youtube.com/live_chat*'];
const REINJECT_FILES = ['src/constants.js', 'src/selectors.js', 'src/capture.js', 'src/chat-input.js', 'src/panel.js', 'src/content.js']; // T5：加入 panel.js；v49（T6）chat-input.js
async function reinjectYouTubeTabs(tabIds) {
  const out = { tabs: 0, ok: 0, failed: [] };
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: YT_TAB_URLS }); } catch (_) { return out; }
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
  try { tabs = await chrome.tabs.query({ url: YT_TAB_URLS }); } catch (_) { return []; }
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
    try { loading = new Set((await chrome.tabs.query({ url: YT_TAB_URLS })).filter((t) => t.status === 'loading').map((t) => t.id)); } catch (_) {}
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
  autoMigrateLegacy, readQueue, readPopout, maybeRefetchMeta, pollOpenStreams, findStaleTabs, reinjectYouTubeTabs, reconnectStaleTabs, _setWakeChecked: (v) => { wakeChecked = !!v; }, _metaPoll: metaPoll, _metaPollDue: metaPollDue, onPopoutTabRemoved, cleanupJunkSystem, dedupePinned, avatarHosts, fillAvatars, fixGiftAuthors, fixOwnDuplicates, fixFutureTimes, giftStructures, fixPhases, streamTimes, findStream, systemTags: () => DB.systemTagStats(), channelStats, channelInfo, prioritizeHandles, streamCompare, fixRaidLeak, fixStreamMeta, fixRaidEnds, setRaidAutoPopout, _maybeRaidPopout: maybeRaidPopout, scTiers, _parseAmount: parseAmount, _orderQueue: orderQueue, _netBackoffMs: netBackoffMs, _isNetError: isNetError, _resetChStats: () => { Object.assign(chStats, { netErrors: 0, netErrorTimes: [], doneTimes: [], consecutiveNet: 0, pauseUntil: 0 }); }, sourceStats, retryFailedChannels, isJunkTag, reclassifySystem, fieldStats, recomputeStream, diag, _inflight: inflight };
