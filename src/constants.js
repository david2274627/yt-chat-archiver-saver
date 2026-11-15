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
    DB_VERSION: 2, // v27/v28：capture_sessions、fp／aliasIds 索引、offsets、versions（SPEC 4.1）
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

  C.isAllowedImageUrl = function (url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && C.IMAGE_HOST_ALLOWLIST.some((re) => re.test(u.hostname));
    } catch (_) {
      return false;
    }
  };

  root.YTCAS_CONST = Object.freeze(C);
})(typeof globalThis !== 'undefined' ? globalThis : self);
