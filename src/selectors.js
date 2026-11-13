// 所有 YouTube DOM 選擇器集中於此（YouTube 改版時只改這個檔案）
// 找不到元素時呼叫端須 graceful degrade：透過 YTCAS_SEL.warnOnce() 只警告一次，不拋錯。
(function (root) {
  'use strict';

  const S = {
    // ---------- top frame（www.youtube.com/watch） ----------
    top: {
      liveChatFrame: 'ytd-live-chat-frame',
      chatIframe: 'iframe#chatframe',
      // 原生聊天室收合/展開橫幅的按鈕（F-09 注入按鈕放在其右側）
      showHideButton: 'ytd-live-chat-frame #show-hide-button',
      watchFlexy: 'ytd-watch-flexy',
      video: 'video.html5-main-video',
      // 直播開始時間（推算 videoOffsetSec）
      startDateMeta: 'meta[itemprop="startDate"]',
      titleMeta: 'meta[name="title"]',
      channelLink: 'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a',
      darkThemeAttr: 'html[dark]',
      // F-10 top frame 彈窗偵測（v22：$ 付款確認視窗可能開在整頁中央）
      popupContainer: 'ytd-popup-container',
      popups: [
        'tp-yt-paper-dialog',
        'tp-yt-iron-dropdown',
        'yt-dialog-view-model',
        'ytd-popup-container > *', // 未知的 ytd-* 付款元件：T1 實測後補上實際標籤名稱
      ],
    },

    // ---------- chat frame（www.youtube.com/live_chat、live_chat_replay） ----------
    chat: {
      app: 'yt-live-chat-app',
      header: 'yt-live-chat-header-renderer',
      itemList: '#item-list',
      items: '#item-list #items',
      inputPanel: '#input-panel',
      messageInput: 'yt-live-chat-message-input-renderer',

      // 訊息元件
      textMessage: 'yt-live-chat-text-message-renderer',
      paidMessage: 'yt-live-chat-paid-message-renderer',
      paidSticker: 'yt-live-chat-paid-sticker-renderer',
      membershipItem: 'yt-live-chat-membership-item-renderer',
      giftAnnouncement: 'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer',
      viewerEngagement: 'yt-live-chat-viewer-engagement-message-renderer',
      // 置頂 / 降落橫幅
      bannerContainer: 'yt-live-chat-banner-manager',
      banner: 'yt-live-chat-banner-renderer',
      bannerRedirect: 'yt-live-chat-banner-redirect-renderer',

      // 訊息內部欄位
      author: {
        name: '#author-name',
        photo: '#author-photo img, #img',
        badges: 'yt-live-chat-author-badge-renderer',
      },
      message: '#message',
      timestamp: '#timestamp',
      purchaseAmount: '#purchase-amount, #purchase-amount-chip',

      // F-10 彈窗偵測
      popups: [
        'yt-emoji-picker-renderer',
        'yt-live-chat-product-picker-renderer',
        'yt-live-chat-message-buy-flow-renderer',
        'tp-yt-iron-dropdown',
        'tp-yt-paper-dialog',
      ],
      emojiPickerButton: '#emoji-picker-button',
    },
  };

  const warned = new Set();
  S.warnOnce = function (key, detail) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[ytcas] 找不到 YouTube 元素：' + key, detail || '');
  };

  root.YTCAS_SEL = S;
})(typeof globalThis !== 'undefined' ? globalThis : self);
