// Service Worker：唯一的 IndexedDB 寫入者、推播、頻道名稱解析（T2 實作）
importScripts('constants.js', 'db.js');

const C = self.YTCAS_CONST;

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[ytcas] installed', details.reason, chrome.runtime.getManifest().version_name);
});

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  // T2 實作各訊息處理
  return false;
});
