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
      // v43（T5.2 (I)）面板 → bg：以 chrome.tabs.create 開啟後台檢視器（嵌入的面板自己開會被 use_dynamic_url 擋下）
      OPEN_VIEWER: 'OPEN_VIEWER',
      // v35 F-20：DIAG_LOG（content → bg，記錄中才送）、DIAG_CONTROL（擴充功能頁面 → bg：start／stop／status／export／summary／clear）
      DIAG_LOG: 'DIAG_LOG',
      DIAG_CONTROL: 'DIAG_CONTROL',
      // v45（T5.4，審查十一 20.4）content → bg：禮物元件的結構（不含文字），非記錄期間也送；bg 存 storage.session 最近 5 筆
      GIFT_STRUCTURE: 'GIFT_STRUCTURE',
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
      // （v43）PANEL_STATE 也由 top 送給面板 iframe { paused }：退讓中面板暫停補讀
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
      // v43（T5.2）：播放位置與預期（上一次＋經過時間）差超過此秒數視為跳轉（seeked 沒觸發時的後備）
      SEEK_JUMP_SEC: 3,
      BASELINE_DRIFT: 0.05,    // 直播「在最新時的延遲」基準：延遲變大（仍在最新範圍內）時每次只往上追這個比例
      MENU_REFRESH_MS: 1000,   // ⋯ 選單開著時連線狀態的刷新間隔
      FULL_POLL_MS: 120000,    // 補讀後備：offset 未知、只能讀整場時的最短間隔（v42 為 30 秒）
      // v44（T5.3 (L)）直播同步微調（畫面落後真實時間的秒數）的初始值：沒有任何頻道校正過時使用。
      // 頻道校正過 → 用該頻道的值；沒校正過的頻道 → 用最近一次校正的值（等於使用者實測的典型延遲）
      LIVE_LATENCY_DEFAULT_SEC: 0,
      // v45（T5.4，審查十一 20.2）直播牆上時間錨點：在最新時每秒一個樣本，取最近這麼多個的中位數
      WALL_ANCHOR_SAMPLES: 60,
      // v47（T5.6，審查十一 26.2）錨點的有效條件：徽章「最新」且播放中連續穩定這麼久、期間沒有 seek，樣本才採用；
      // 採用後這段時間內被 seek 到「非最新」→ 作廢（載入初期短暫在最新、之後跳到 t= 的位置）；
      // 網址帶 t=（或讀不到徽章）時，第一個錨點要等使用者點過「直播」或穩定 URL_T 毫秒
      ANCHOR_STABLE_MS: 3000,
      ANCHOR_GUARD_MS: 5000,
      ANCHOR_URL_T_MS: 10000,
      // v45（審查十一 20.3）面板頭像快取上限（同場次同作者的後備；LRU）
      AVATAR_CACHE_MAX: 2000,
      // v46（T5.5，審查十一第 23 節）「↓ 恢復自動捲動／回到播放位置」顯示時清單底部的留白（按鈕高度＋上下間距）
      RESUME_PAD_PX: 44,
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
      PROBES: Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']),
      // v45（T5.4，審查十一 20.2 第 5 點）P10 直播時鐘：直播中每 10 秒記 { now, currentTime, seekStart, seekEnd, 徽章 }（只有數字）
      P10_SEC: 10,
      DEFAULT_HOURS: 6, MIN_HOURS: 1, MAX_HOURS: 24, // 一律有最長時限
      MAX_RECORDS: 50000, MAX_BYTES: 20 * 1024 * 1024,
      RETAIN_DAYS: 30,                               // 停止 30 天後自動清除
      P5_MINUTES: 10,
      P9_MINUTES: 5,                                 // T4.2 記憶體探針（start 沒指定 p9Minutes 時，例如 SW Console）
      // v44（T5.3，審查十一 18.4）P9 取樣間隔可設定（分鐘，1～30）；診斷頁預設 1 分鐘
      P9_MIN_MINUTES: 1, P9_MAX_MINUTES: 30, P9_PAGE_DEFAULT_MINUTES: 1,
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
      // v46（T5.5，審查十一 24.3）禮物圖片（yt-image#gift-image img）的網域；host_permissions 已有 https://www.youtube.com/*
      /^www\.youtube\.com$/,
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
    return C.NOTICE_ID_PREFIX + fnv(String(videoId || '') + '\u0001' + C.runsKeyText(runs));
  };

  // v48（T5.7，審查十一 28.3）分頁在背景時，同一次 MutationObserver 回呼新增超過這麼多則 → 視為「一批到達」（Chrome 節流），
  // 這批訊息不用到達時間、改用顯示時間（只到分鐘）
  C.ARRIVAL_HIDDEN_BATCH_MAX = 2;

  // v45（T5.4，審查十一 21.3）頁面狀態提示（歡迎／守則、聊天室模式、重播已啟用等「每次載入聊天室都會出現」的提示）：
  // 擷取時依元件標籤（selectors.js 的 viewerEngagement）標 notice: true；既有紀錄以 T3.5 起的內容 id（ytcas-ve-…）判斷。不比對任何文字
  C.NOTICE_ID_PREFIX = 'ytcas-ve-';
  C.isNotice = function (m) {
    return !!m && (m.notice === true || (typeof m.id === 'string' && m.id.startsWith(C.NOTICE_ID_PREFIX)));
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
    // v47（T5.6，審查十一 26.1）scheduledFuture：這份 meta 說「預定開播時間在未來、沒有 endDate」（true）／
    // 說已開播或已結束（false）／沒有 startDate（null）。true 時一律是待機室（C.effectiveStart）
    const t = { startedAt: null, startedAtSource: null, endedAt: null, endedAtSource: null, scheduledStartAt: null, startPending: false, scheduledFuture: null };
    if (ed != null) {
      t.endedAt = ed; t.endedAtSource = 'meta-actual'; t.scheduledFuture = false;
      if (sd != null) { t.startedAt = sd; t.startedAtSource = 'meta-actual'; }
      return t;
    }
    if (sd == null) return t;
    if (sd > now) { t.scheduledStartAt = sd; t.scheduledFuture = true; return t; }
    t.scheduledFuture = false;
    if (sd % 60000 !== 0 || (sch != null && sd !== sch)) { t.startedAt = sd; t.startedAtSource = 'meta-actual'; return t; }
    t.scheduledStartAt = sd; t.startPending = true;
    return t;
  };

  // v47（T5.6，審查十一 26.1）硬性規則：最近一次看到的頁面 meta 說「預定開播時間在未來、沒有 endDate」→ 待機室，
  // 不論 startedAt 是否已有值（重播來源 replay 例外）。startedAtSuspect：曾在待機室狀態下發現已有 startedAt（降級，視同沒有；
  // 之後由實際開播時間 meta-actual／replay 覆蓋，或以 YTCAS_BG.fixPhases() 兩段式清除）
  C.isFutureScheduled = function (s, now) {
    if (!s || s.endedAt != null || !s.scheduledFuture) return false;
    return typeof s.scheduledStartAt === 'number' && s.scheduledStartAt > (typeof now === 'number' ? now : Date.now());
  };
  // 實際採用的開播時間：待機室（上一條）或已降級 → null
  C.effectiveStart = function (s, now) {
    if (!s || s.startedAt == null) return null;
    if (s.startedAtSource === 'replay') return s.startedAt;
    if (s.startedAtSuspect || C.isFutureScheduled(s, now)) return null;
    return s.startedAt;
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
    'openViewer:': '無法開啟後台分頁',
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

  // v45（T5.4，審查十一 20.6 第 2 點）診斷匯出檔名格式。參數：{yy} {yyyy} {MM} {dd} {HH} {mm} {ss}（記錄開始時間，本機時區）、{probes}（例 P1-P9-P10）。
  // 只允許英數、_ - .；其他字元（含未知的 {參數}）轉成 _；不提供 videoId、頻道等參數（個資規則）。結果不含副檔名與資料夾
  C.DIAG_FILE_FORMAT_KEY = 'diagFileFormat';
  C.DIAG_FILE_FORMAT_DEFAULT = 'ytcas-diag-{yy}_{MM}_{dd}_{HH}_{mm}';
  C.DIAG_FILE_FORMAT_PRESETS = Object.freeze([
    'ytcas-diag-{yy}_{MM}_{dd}_{HH}_{mm}',
    'ytcas-diag-{yyyy}{MM}{dd}-{HH}{mm}',
    'ytcas-diag-{yyyy}-{MM}-{dd}_{HH}{mm}{ss}',
    'ytcas-diag-{yy}_{MM}_{dd}_{HH}_{mm}_{probes}',
  ]);
  C.diagFileName = function (fmt, t, probes) {
    const d = new Date(typeof t === 'number' && Number.isFinite(t) ? t : Date.now());
    const p2 = (n) => String(n).padStart(2, '0');
    const v = { yyyy: String(d.getFullYear()), yy: p2(d.getFullYear() % 100), MM: p2(d.getMonth() + 1), dd: p2(d.getDate()),
      HH: p2(d.getHours()), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()),
      probes: (Array.isArray(probes) ? probes : []).filter((x) => /^P\d{1,2}$/.test(x)).join('-') };
    const f = typeof fmt === 'string' && fmt.trim() ? fmt.trim().slice(0, 120) : C.DIAG_FILE_FORMAT_DEFAULT;
    let s = f.replace(/\{(yyyy|yy|MM|dd|HH|mm|ss|probes)\}/g, (_, k) => v[k]);
    s = s.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[.\-_]+/, '').replace(/\.+$/, '').slice(0, 120);
    return s || C.diagFileName(C.DIAG_FILE_FORMAT_DEFAULT, t, probes);
  };

  // v45（T5.4，審查十一 20.4）文字開頭的 @handle（YouTube handle：3～30 個字母、數字、. _ -，可含各語系文字）→ '@handle'；不是 → ''。
  // 只看 @ 與 handle 的字元格式，不比對任何語言的文字。
  // v48（T5.7，審查十一 28.2）**只用於「從內文推出 handle」等後備**（嚴格：3～30 字，且後面要接空白或標點）。
  C.handleOf = function (text) {
    const m = /^\s*(@[\p{L}\p{N}\p{M}._\-·]{3,30})(?=$|[\s:：,，、)）])/u.exec(String(text == null ? '' : text));
    return m ? m[1] : '';
  };
  // v48（T5.7，審查十一 28.2）聊天室 DOM 給的 @handle（作者名稱元件、@提及連結的文字、已存的 authorHandle）：YouTube 已驗證，
  // 長度下限 1（實機：`@无恋`、`@魚` 這類非拉丁文字的 handle 短於 3 個字元）、上限 100；字元類別與 handleOf 相同。
  // 整個字串（去掉前後空白）必須就是 handle → '@handle'；不是 → ''。background 的頻道解析佇列（HANDLE_RE）也用這條
  C.DOM_HANDLE_RE = /^@[\p{L}\p{N}\p{M}._\-·]{1,100}$/u;
  C.domHandle = function (text) {
    const t = String(text == null ? '' : text).trim();
    return C.DOM_HANDLE_RE.test(t) ? t : '';
  };
  C.handleUrl = function (h) {
    return h && h[0] === '@' ? 'https://www.youtube.com/@' + encodeURIComponent(h.slice(1)) : '';
  };

  root.YTCAS_CONST = Object.freeze(C);
})(typeof globalThis !== 'undefined' ? globalThis : self);
