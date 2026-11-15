// 測試用 chrome.* 假物件（只實作 background.js 用到的部分）。必須在 background.js 之前載入。
// 同時攔截所有對外連線（tools/tests/README.md）：fetch 一律回 404，XMLHttpRequest 直接拋錯。
(function () {
  'use strict';
  self.__blockedFetch = async () => new Response('', { status: 404 });
  self.fetch = self.__blockedFetch;
  if (self.XMLHttpRequest) {
    const block = () => { throw new Error('測試頁禁止 XMLHttpRequest'); };
    self.XMLHttpRequest.prototype.open = block;
    self.XMLHttpRequest.prototype.send = block;
  }

  const TEST_DB = 'test-ytcas-v3';
  const TEST_LEGACY = 'test-legacy-YTLiveChatArchiverDB_V6';
  if (self.YTCAS_DB) self.YTCAS_DB.configure({ dbName: TEST_DB, legacyDbName: TEST_LEGACY });
  self.importScripts = function () { /* 已由 <script> 載入 */ };

  const listeners = { message: [], changed: [], installed: [], startup: [], removed: [] };
  function area(name) {
    let data = {};
    return {
      _reset() {
        const changes = {};
        for (const k of Object.keys(data)) changes[k] = { oldValue: data[k] };
        data = {};
        for (const l of listeners.changed) l(changes, name);
      },
      async get(keys) {
        const out = {};
        const list = keys == null ? Object.keys(data) : (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys)));
        for (const k of list) if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: JSON.parse(JSON.stringify(v)) };
          data[k] = JSON.parse(JSON.stringify(v));
        }
        for (const l of listeners.changed) l(changes, name);
      },
      async remove(keys) {
        const changes = {};
        for (const k of [].concat(keys)) { changes[k] = { oldValue: data[k] }; delete data[k]; }
        for (const l of listeners.changed) l(changes, name);
      },
    };
  }
  const broadcasts = [];
  self.chrome = {
    runtime: {
      id: 'testextid',
      getManifest: () => ({ version_name: 'test' }),
      getURL: (p) => 'chrome-extension://testextid/' + (p || ''),
      onMessage: { addListener: (f) => listeners.message.push(f) },
      onInstalled: { addListener: (f) => listeners.installed.push(f) },
      onStartup: { addListener: (f) => listeners.startup.push(f) },
      sendMessage: (m) => { broadcasts.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(); },
    },
    storage: {
      sync: area('sync'), local: area('local'), session: area('session'),
      onChanged: { addListener: (f) => listeners.changed.push(f) },
    },
    // tabs：_tabs 為假分頁清單（query 一律回傳全部，由 background 自行比對網址），sent 記錄 sendMessage
    tabs: {
      _tabs: [], sent: [],
      query: async () => self.chrome.tabs._tabs.slice(),
      sendMessage: async (tabId, m) => { self.chrome.tabs.sent.push({ tabId, msg: JSON.parse(JSON.stringify(m)) }); },
      onRemoved: { addListener: (f) => listeners.removed.push(f) },
    },
  };
  self.__mock = { listeners, broadcasts, TEST_DB, TEST_LEGACY };
})();
