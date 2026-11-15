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

async function resolveOne(handle) {
  const url = 'https://www.youtube.com/@' + encodeURIComponent(handle.slice(1));
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const info = parseChannelHtml(await r.text());
  if (!info.displayName) throw new Error('no og:title');
  return info;
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
        const rec = { handleOrId: h, displayName: info.displayName, avatar: info.avatar, fetchedAt: Date.now() };
        await DB.putChannel(rec);
        broadcast({ type: RT.CHANNEL_RESOLVED, handleOrId: h, displayName: rec.displayName, avatar: rec.avatar });
      } else {
        it.attempts++;
        if (it.attempts >= C.CHANNEL_MAX_ATTEMPTS) {
          delete q[h];
          // 失敗紀錄（1 天內不再重試）；檢視器退回顯示 @Handle
          await DB.putChannel({ handleOrId: h, displayName: '', avatar: '', fetchedAt: Date.now(), failed: true });
        } else {
          it.nextAt = Date.now() + Math.min(30000 * 2 ** (it.attempts - 1), 6 * 3600 * 1000); // 指數退避
          q[h] = it;
        }
      }
      await writeQueue(q);
    });
  } finally {
    inflight.delete(h);
    if (err) console.info('[ytcas] 頻道名稱解析失敗', h, String(err && err.message));
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

// ---------------------------------------------------------------- 訊息處理
// 只有擴充功能頁面（viewer、popup）可以執行破壞性或管理操作；content script（https 頁面）不行
const isExtensionPage = (sender) => !!sender && sender.id === chrome.runtime.id && !String(sender.url || '').startsWith('https://');
const ADMIN = new Set([RT.DELETE_STREAM, RT.DELETE_STREAMS, RT.RESET_STREAM, RT.RECLASSIFY_SYSTEM, RT.MIGRATE_LEGACY,
  RT.IMPORT_DATA, RT.EXPORT_STREAM, RT.SET_VERSION_LABEL, RT.LINK_VIDEO, RT.UNLINK_VIDEO, RT.GET_STORAGE_USAGE]);

function vid(msg) {
  if (typeof msg.videoId !== 'string' || !/^[\w-]{6,20}$/.test(msg.videoId)) throw new Error('invalid videoId');
  return msg.videoId;
}

const handlers = {
  async [RT.CAPTURE_START](msg) {
    const videoId = vid(msg);
    const policy = await capturePolicy(await handleOf(videoId, msg.stream));
    if (!policy.allowed) return { allowed: false, reason: policy.reason };
    const r = await DB.captureStart({ videoId, source: msg.source, duration: msg.duration, stream: msg.stream });
    return Object.assign({ allowed: true }, r);
  },

  async [RT.CAPTURE_END](msg) {
    const s = await DB.captureEnd({ captureSessionId: msg.captureSessionId, endedAt: msg.endedAt });
    // F-19：彈出視窗結束 → 通知同一 videoId 的主分頁（自動接手由 T3 的 content script 處理）
    if (s && s.source === 'popout') {
      const st = await loadSettings();
      if (st.popoutHandoff !== false) notifyTabs(s.videoId, { type: RT.CAPTURE_END, videoId: s.videoId, source: 'popout' });
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
    return { added: r.added, merged: r.merged, unchanged: r.unchanged, fpMerged: r.fpMerged };
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
}

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[ytcas] installed', details.reason, chrome.runtime.getManifest().version_name);
  autoMigrateLegacy(false).catch((e) => console.warn('[ytcas] 舊資料遷移失敗', e));
});
chrome.runtime.onStartup.addListener(() => {
  autoMigrateLegacy(false).catch((e) => console.warn('[ytcas] 舊資料遷移失敗', e));
});

onWake();

// 測試頁使用（Service Worker 中無副作用）
self.YTCAS_BG = { handlers, capturePolicy, enqueueHandles, parseChannelHtml, kickQueue, autoMigrateLegacy, readQueue,
  _inflight: inflight };
