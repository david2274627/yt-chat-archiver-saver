// 共用常數（content script、background、viewer 皆會載入；不得依賴 DOM 或 chrome.* 以外的環境）
(function (root) {
  'use strict';

  const C = {
    NS: 'ytcas',
    YT_ORIGIN: 'https://www.youtube.com',

    // F-01 DOM 修剪
    DOM_MAX_MESSAGES: 45,
    DOM_TRIM_INTERVAL_MS: 3500,

    // 擷取批次送出
    BATCH_INTERVAL_MS: 1000,
    BATCH_MAX: 50,

    // F-03 頻道名稱解析
    CHANNEL_RESOLVE_CONCURRENCY: 3,
    CHANNEL_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,

    // F-06 搜尋 debounce
    SEARCH_DEBOUNCE_MS: 200,

    // F-08 VOD 時間同步
    VOD_TIME_INTERVAL_MS: 250,

    // F-09 影片下方「聊天室」卡片的原生按鈕文字（用來挑出聊天室那張卡片）
    OPEN_PANEL_LABELS: Object.freeze(['開啟面板', '开启面板', 'Open panel', 'パネルを開く']),

    // F-10 輸入區狀態
    INPUT_STATE_DEBOUNCE_MS: 50,
    POPUP_POLL_INTERVAL_MS: 500,
    POPUP_TOP_MARGIN_PX: 8,

    // IndexedDB
    DB_NAME: 'ytcas-v3',
    DB_VERSION: 3, // v27/v28：capture_sessions、fp／aliasIds 索引、offsets、versions；v35：diag_log（F-20）（SPEC 4.1）
    // v3 匯出格式（F-11；v28 升為 2：versions／offsets／linkedVideos／captureSessions）
    EXPORT_FORMAT_VERSION: 2,
    EXPORT_APP: 'ytcas',
    // F-14 後備去重：offset 分桶秒數
    FP_BUCKET_SEC: 3,
    // F-18 版本偵測：影片長度差 ≤ 此秒數視為同一版本
    VERSION_DURATION_TOLERANCE_SEC: 2,
    // 未收到 CAPTURE_END 的 session，超過此時間沒有寫入就以 lastWriteAt 補 endedAt
    CAPTURE_STALE_MS: 2 * 60 * 1000,
    // T3.5：同一 videoId＋source，上一筆收錄在這段時間內結束 → 重新載入，沿用同一筆收錄紀錄
    CAPTURE_MERGE_GAP_MS: 60 * 1000,
    // 覆蓋範圍合併時，小於此間隔的空檔忽略（批次送出的間隔）
    COVERAGE_GAP_TOLERANCE_MS: 5000,
    // F-11 遷移每批筆數
    LEGACY_BATCH: 500,
    // F-03 解析失敗：最多嘗試次數；失敗紀錄的快取時間
    CHANNEL_MAX_ATTEMPTS: 6,
    CHANNEL_FAIL_TTL_MS: 24 * 60 * 60 * 1000,

    // 設定（v28）：F-15、F-16。sync 有容量上限，長清單放 local（SPEC 3.8b）
    SETTINGS: Object.freeze({
      captureEnabled: { area: 'sync', default: true },
      captureExcludedChannels: { area: 'local', default: [] },
      storageWarnBytes: { area: 'sync', default: 2 * 1024 * 1024 * 1024 },
      popoutHandoff: { area: 'sync', default: true },
    }),
    // chrome.storage.session：頻道名稱解析待辦佇列（SPEC 3.2）
    CHANNEL_QUEUE_KEY: 'channelQueue',
    // v2.6.0 舊資料庫（F-11：只能唯讀複製，不得升級、修改或刪除；結構見 docs/legacy-v2.6.0-data.md）
    LEGACY_DB_NAME: 'YTLiveChatArchiverDB_V6',

    // 訊息類型
    MSG_TYPE: Object.freeze({
      TEXT: 'text',
      SUPERCHAT: 'superchat',
      SUPERSTICKER: 'supersticker',
      GIFT: 'gift', // v27：YouTube 禮物（Jewels），F-13
      MEMBERSHIP: 'membership',
      MILESTONE: 'milestone',
      RAID: 'raid',
      SYSTEM: 'system',
    }),

    // runtime 訊息（chrome.runtime.sendMessage）
    RT: Object.freeze({
      SAVE_MESSAGES: 'SAVE_MESSAGES',
      SAVE_PINNED: 'SAVE_PINNED',
      NEW_MESSAGES: 'NEW_MESSAGES',
      QUERY_MESSAGES: 'QUERY_MESSAGES',
      LIST_STREAMS: 'LIST_STREAMS',
      DELETE_STREAM: 'DELETE_STREAM',
      EXPORT_STREAM: 'EXPORT_STREAM',
      RESOLVE_CHANNELS: 'RESOLVE_CHANNELS',
      CHANNEL_RESOLVED: 'CHANNEL_RESOLVED',
      // v27
      CAPTURE_START: 'CAPTURE_START',
      CAPTURE_END: 'CAPTURE_END',
      RESET_STREAM: 'RESET_STREAM',
      RECLASSIFY_SYSTEM: 'RECLASSIFY_SYSTEM',
      MESSAGE_DELETED: 'MESSAGE_DELETED',
      // v28
      GET_CAPTURE_POLICY: 'GET_CAPTURE_POLICY',
      GET_STORAGE_USAGE: 'GET_STORAGE_USAGE',
      DELETE_STREAMS: 'DELETE_STREAMS',
      LIST_CAPTURE_SESSIONS: 'LIST_CAPTURE_SESSIONS',
      MIGRATE_LEGACY: 'MIGRATE_LEGACY',
      IMPORT_DATA: 'IMPORT_DATA',
      SET_VERSION_LABEL: 'SET_VERSION_LABEL',
      LINK_VIDEO: 'LINK_VIDEO',
      UNLINK_VIDEO: 'UNLINK_VIDEO',
      // v35 F-20：DIAG_LOG（content → bg，記錄中才送）、DIAG_CONTROL（擴充功能頁面 → bg：start／stop／status／export／summary／clear）
      DIAG_LOG: 'DIAG_LOG',
      DIAG_CONTROL: 'DIAG_CONTROL',
      // v36（T3.8）：bg → 分頁的 top frame，確認 content script 仍連線（無回應 = 斷線，需要重新整理或重新注入）
      PING: 'YTCAS_PING',
    }),

    // capture_sessions.source（v28 加 popout，F-19）
    CAPTURE_SOURCES: Object.freeze(['live', 'replay', 'popout']),

    // frame 間訊息（window.postMessage）
    FM: Object.freeze({
      CHAT_INPUT_STATE: 'CHAT_INPUT_STATE',
      VOD_TIME: 'VOD_TIME',
      SEEK_TO: 'SEEK_TO',
      TOGGLE_PANEL: 'TOGGLE_PANEL', // v24：chat frame 頂部列的 F-09 開關被點擊
      THEME: 'THEME', // v27：top → 面板 iframe，{ theme: 'light'|'dark' }（YouTube 實際外觀，SPEC 10.2）
      // v29（SPEC 4.3）：top frame 提供場次資訊與影片長度給 chat frame；chat frame 回報收錄狀態
      STREAM_INFO_REQUEST: 'STREAM_INFO_REQUEST',
      STREAM_INFO: 'STREAM_INFO',
      CAPTURE_STATUS: 'CAPTURE_STATUS',
      // v41（T5）：面板 iframe ↔ top frame。PANEL_READY：面板載入完成（top 回送 THEME、CAPTURE_STATUS、VOD_TIME）；
      // PANEL_CLOSE：面板頂部列的「關閉優化面板」；PANEL_STATE：top → chat frame，頂部列按鈕顯示用 { on, paused, reason }
      PANEL_READY: 'PANEL_READY',
      PANEL_CLOSE: 'PANEL_CLOSE',
      PANEL_STATE: 'PANEL_STATE',
    }),
    // v41（T5）優化面板（F-08、F-09、6.2）
    PANEL: Object.freeze({
      COLLAPSE_MIN_H: 200,     // iframe#chatframe 高度低於此值視為摺疊 → 退讓（6.2；T6 定案）
      VOD_TIME_MS: 250,        // VOD_TIME 送出間隔（4.3）
      LIVE_EDGE_SEC: 15,       // 直播中距離直播邊緣幾秒內視為「在最新」：一般跟隨到底；超過則依時間軸同步
      ANCHOR_GRACE_MS: 8000,   // 頁面載入後多久仍找不到任何開關錨點才 warnOnce
      EXPAND_WAIT_MS: 5000,    // 從影片下方卡片展開聊天室後，等待 iframe 出現的上限
      SYNC_SMOOTH_MAX_PX: 1500, // 時間軸同步：距離在此以內平滑捲動，否則直接跳
    }),
    // v29：chat frame 等 STREAM_INFO 的重送間隔與上限
    STREAM_INFO_RETRY_MS: 1000,
    STREAM_INFO_MAX_WAIT_MS: 30000,
    // F-19：FETCH_STREAM_META 等待上限（彈出視窗 CAPTURE_START 時）
    STREAM_META_TIMEOUT_MS: 5000,
    // F-19（v30）：彈出視窗分頁 → 收錄 session 對照（chrome.storage.session，SW 重啟可接續）
    POPOUT_TABS_KEY: 'popoutTabs',
    // pagehide 送來的 CAPTURE_END 等這麼久再接手：期間同一分頁重新開始收錄（重新整理）就不接手
    POPOUT_RELOAD_GRACE_MS: 3000,
    // T3.4 cleanupJunkSystem：只清除 T3 部署之後收錄產生的垃圾 system 紀錄（2026-11-15 23:00 +08:00）
    T3_DEPLOYED_AT: Date.parse('2026-11-15T23:00:00+08:00'),
    // T3.6：T3.4（只擷取 #items 直接子節點）部署時間。之後收錄的 system 紀錄都是真訊息，清除函式不再處理（歡迎提示去重除外）
    T34_DEPLOYED_AT: Date.parse('2026-11-16T01:51:00+08:00'),
    // T3.6（審查十追加五 E-3）background 重新抓取 watch 頁 meta 的間隔：等待開播確認 60 秒（上限 3 小時）、直播中等結束 5 分鐘
    META_POLL_PENDING_MS: 60 * 1000,
    META_POLL_PENDING_MAX_MS: 3 * 60 * 60 * 1000,
    META_POLL_LIVE_MS: 5 * 60 * 1000,
    // F-20 診斷記錄模式（T3.7，審查十追加六 B）
    DIAG: Object.freeze({
      STATE_KEY: 'diagState',                       // chrome.storage.local：{ active, scheduled, startAt, endsAt, probes, … }
      PROBES: Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']),
      DEFAULT_HOURS: 6, MIN_HOURS: 1, MAX_HOURS: 24, // 一律有最長時限
      MAX_RECORDS: 50000, MAX_BYTES: 20 * 1024 * 1024,
      RETAIN_DAYS: 30,                               // 停止 30 天後自動清除
      P5_MINUTES: 10,
      P9_MINUTES: 5,                                 // T4.2 記憶體探針
      P7_MAX_PER_TAG: 3,                             // 結構探針：同一標籤每場最多 3 次
      FLUSH_MS: 5000, FLUSH_MAX: 50,                 // content script 端批次送出
      DOWNLOAD_DIR: 'YT聊天室診斷',
    }),
    // 播放器長度由無變有視為開播訊號：頁面載入後至少這麼久才採信（避免把「載入已在直播的頁面」誤認為剛開播）
    LIVE_SIGNAL_MIN_PAGE_AGE_MS: 60 * 1000,

    // v27 主題設定（chrome.storage.sync；邏輯在 src/theme.js）
    THEME_MODE_KEY: 'themeMode',
    THEME_MODES: Object.freeze(['auto', 'light', 'dark']),

    // F-05 機器人排除名單（比對不分大小寫，同時比對名稱與 @Handle）
    BOT_BLOCKLIST: Object.freeze([
      'nightbot',
      'streamelements',
      'streamlabs',
      'moobot',
      'fossabot',
    ]),

    // 第 7 節：允許顯示的圖片網域
    IMAGE_HOST_ALLOWLIST: Object.freeze([
      /(^|\.)ggpht\.com$/,
      /(^|\.)ytimg\.com$/,
      /(^|\.)googleusercontent\.com$/,
      /^fonts\.gstatic\.com$/,
      /^www\.gstatic\.com$/,
    ]),
  };

  // T3.5：聊天室歡迎／守則提示（viewer-engagement）每次重新整理 id 都不同 → 同一場次以內容產生固定 id，只存一筆。
  // capture.js（收錄）與 db.js（cleanupJunkSystem 合併既有重複）共用，確保兩邊算出相同的 id。
  const fnv = function (str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
      h2 = (h2 ^ (h2 >>> 15)) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  };
  C.runsKeyText = function (runs) {
    if (!Array.isArray(runs)) return '';
    return runs.map((r) => (r && r.emoji ? (r.emoji.alt || r.emoji.shortcut || '') : (r && r.text) || ''))
      .join('').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  C.viewerEngagementId = function (videoId, runs) {
    return 'ytcas-ve-' + fnv(String(videoId || '') + '\u0001' + C.runsKeyText(runs));
  };

  // T3.6（審查十追加五 E、E-3）開播／結束時間的來源等級：等級高者覆蓋低者
  //   scheduled（預定，不得寫入 startedAt）< signal（頁面訊號，誤差 ≤ 30 秒）< meta-actual（重新取得 watch 頁的實際時間）< replay
  //   沒有來源的既有值（T3.5 以前、遷移、匯入）視同 signal：meta-actual 以上可以覆蓋
  C.START_SOURCE_RANK = Object.freeze({ scheduled: 0, signal: 1, 'meta-actual': 2, replay: 3 });
  C.startRank = function (src) {
    return Object.prototype.hasOwnProperty.call(C.START_SOURCE_RANK, src) ? C.START_SOURCE_RANK[src] : 1;
  };
  // watch 頁 meta 的 startDate／endDate（ms）→ 時間與來源。實機（2026-11-16）：待機室時 startDate 是預定時間（整分），
  // 開播後不重新整理不會更新；重新取得頁面後為實際開播時間（有秒數）。
  // 規則：有 endDate → 已結束（startDate 為實際）；startDate 未到 → 預定；startDate 已過且「秒數不為 0」或
  // 「與已知的預定時間不同」→ 實際開播；否則 startPending（預定時間已過、尚未確認開播），不寫入 startedAt。
  C.deriveStartTimes = function (o) {
    const sd = typeof o.startDate === 'number' && Number.isFinite(o.startDate) ? o.startDate : null;
    const ed = typeof o.endDate === 'number' && Number.isFinite(o.endDate) ? o.endDate : null;
    const sch = typeof o.knownScheduled === 'number' ? o.knownScheduled : null;
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const t = { startedAt: null, startedAtSource: null, endedAt: null, endedAtSource: null, scheduledStartAt: null, startPending: false };
    if (ed != null) {
      t.endedAt = ed; t.endedAtSource = 'meta-actual';
      if (sd != null) { t.startedAt = sd; t.startedAtSource = 'meta-actual'; }
      return t;
    }
    if (sd == null) return t;
    if (sd > now) { t.scheduledStartAt = sd; return t; }
    if (sd % 60000 !== 0 || (sch != null && sd !== sch)) { t.startedAt = sd; t.startedAtSource = 'meta-actual'; return t; }
    t.scheduledStartAt = sd; t.startPending = true;
    return t;
  };

  // T3.8（審查十追加七 B-1）F-20 P8：只記 warnOnce 的 key（ASCII）＋等級＋這裡預先定義的說明，不取執行期字串。
  // key 以「前綴」比對（例：'F-12:failed:not-selected' 對到 'F-12:'）
  C.DIAG_WARN_TEXT = Object.freeze({
    'chat.items': '聊天室已渲染，但 10 秒內找不到訊息列表',
    'F-12:': '無法自動切換到「即時聊天室」',
    'popout:videoId': '彈出式聊天室網址沒有 v 參數，無法收錄',
    'chatframe:STREAM_INFO': '30 秒內沒有收到 top frame 的場次資訊，本聊天室不收錄',
    'handoff:teaser': '找不到可用的「開啟面板」，無法自動展開聊天室',
    'poc:': 'PoC 錨點或結構找不到',
    'panel:': '優化面板的開關位置找不到',
  });
  C.diagWarnText = function (key) {
    const k = String(key || '');
    if (Object.prototype.hasOwnProperty.call(C.DIAG_WARN_TEXT, k)) return C.DIAG_WARN_TEXT[k];
    const hit = Object.keys(C.DIAG_WARN_TEXT).find((p) => p.endsWith(':') && k.startsWith(p));
    return hit ? C.DIAG_WARN_TEXT[hit] : null;
  };
  // 執行期字串只保留 ASCII（中日韓文字等換成 […]）：錯誤訊息若意外帶到聊天內容也不會進入診斷檔
  C.asciiOnly = function (s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7E\n]+/g, '[…]').slice(0, 800);
  };

  C.isAllowedImageUrl = function (url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && C.IMAGE_HOST_ALLOWLIST.some((re) => re.test(u.hostname));
    } catch (_) {
      return false;
    }
  };

  // T4.1（審查十一 5.1）置頂的「同一則」判斷：正規化內容（NFKC、小寫、去掉所有空白；表符取 alt、含禮物名稱）相同，
  // 且作者相同或其中一筆沒有作者資訊。同一則在不同時間可能被擷取成不同 id（YouTube 重新渲染置頂列）。
  // background（寫入合併、既有資料整理）與檢視器（顯示去重）共用
  C.pinnedContentKey = function (m) {
    const parts = [];
    for (const r of (m && m.runs) || []) {
      if (r && r.emoji) parts.push(r.emoji.alt || r.emoji.shortcut || '');
      else if (r && r.text) parts.push(r.text);
    }
    if (m && m.giftName) parts.push(m.giftName);
    if (!parts.length && m && typeof m.text === 'string') parts.push(m.text);
    return parts.join('').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  };
  // 作者識別：handle、頻道 id、名稱任一相同即視為同一作者（同一則置頂的兩次擷取可能只有其中一筆有 handle）
  C.pinnedAuthors = function (m) {
    const n = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/^@/, '').trim();
    return [m && m.authorHandle, m && m.authorChannelId, m && m.authorName].map(n).filter(Boolean);
  };
  C.samePinned = function (a, b) {
    if (C.pinnedContentKey(a) !== C.pinnedContentKey(b)) return false;
    const x = C.pinnedAuthors(a), y = C.pinnedAuthors(b);
    return !x.length || !y.length || x.some((v) => y.includes(v));
  };
  // 依最後一次置頂時間（pinnedLastAt，舊資料為 pinnedAt）
  C.pinnedTime = function (p) { return (p && (p.pinnedLastAt || p.pinnedAt || p.timestampAbs)) || 0; };

  // T5.1（審查十一第 10 節）頭像共用的作者識別：只用 @handle 或頻道 id（名稱可能重複，不用）
  C.avatarAuthorKey = function (m) {
    return (m && (m.authorHandle || (m.authorChannelId ? 'ch:' + m.authorChannelId : ''))) || '';
  };

  root.YTCAS_CONST = Object.freeze(C);
})(typeof globalThis !== 'undefined' ? globalThis : self);
