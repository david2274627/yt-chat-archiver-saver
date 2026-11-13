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

    // F-10 輸入區狀態
    INPUT_STATE_DEBOUNCE_MS: 50,
    POPUP_POLL_INTERVAL_MS: 500,
    POPUP_TOP_MARGIN_PX: 8,

    // IndexedDB
    DB_NAME: 'ytChatArchive',
    DB_VERSION: 1,

    // 訊息類型
    MSG_TYPE: Object.freeze({
      TEXT: 'text',
      SUPERCHAT: 'superchat',
      SUPERSTICKER: 'supersticker',
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
    }),

    // frame 間訊息（window.postMessage）
    FM: Object.freeze({
      CHAT_INPUT_STATE: 'CHAT_INPUT_STATE',
      VOD_TIME: 'VOD_TIME',
      SEEK_TO: 'SEEK_TO',
    }),

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
