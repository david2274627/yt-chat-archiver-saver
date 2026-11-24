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

  const listeners = { message: [], changed: [], installed: [], startup: [], removed: [], alarm: [], updated: [] };
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
      // url 篩選（match pattern 的 * 視為萬用字元）；沒有 url 時回傳全部
      query: async (q) => {
        const pats = q && q.url ? [].concat(q.url) : null;
        const ok = (u) => !pats || pats.some((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(u));
        return self.chrome.tabs._tabs.filter((t) => ok(t.url || '')).slice();
      },
      // _alive：回應 PING 的分頁（content script 仍連線）；其他分頁回 undefined（= 沒有接收端）
      _alive: new Set(),
      sendMessage: async (tabId, m) => {
        self.chrome.tabs.sent.push({ tabId, msg: JSON.parse(JSON.stringify(m)) });
        if (m && m.type === 'YTCAS_PING') return self.chrome.tabs._alive.has(tabId) ? { ok: true, env: 'top' } : undefined;
        return undefined;
      },
      onRemoved: { addListener: (f) => listeners.removed.push(f) },
      onUpdated: { addListener: (f) => listeners.updated.push(f) }, // v52（T6.3）

      // v43：create（只記錄）
      _created: [],
      create: async (o) => { self.chrome.tabs._created.push(JSON.parse(JSON.stringify(o))); return { id: 1000 + self.chrome.tabs._created.length }; },
    },
    // v52（T6.3，33.1 第 6 點）windows.create（只記錄）
    windows: { _created: [], create: async (o) => { self.chrome.windows._created.push(JSON.parse(JSON.stringify(o))); return { id: 2000 + self.chrome.windows._created.length, tabs: [{ id: 3000 + self.chrome.windows._created.length }] }; } },
    // T3.7：alarms（只記錄，不會自動觸發；測試以 __mock.fireAlarm 觸發）、action（徽章）、downloads（只記錄）
    alarms: {
      _list: new Map(),
      create: (name, info) => { self.chrome.alarms._list.set(name, Object.assign({ name }, info)); },
      get: (name, cb) => { const a = self.chrome.alarms._list.get(name); if (cb) cb(a); return Promise.resolve(a); },
      clear: (name, cb) => { const ok = self.chrome.alarms._list.delete(name); if (cb) cb(ok); return Promise.resolve(ok); },
      onAlarm: { addListener: (f) => listeners.alarm.push(f) },
    },
    action: {
      _badge: { text: '', color: null, title: '' },
      setBadgeText: (o) => { self.chrome.action._badge.text = o.text; return Promise.resolve(); },
      setBadgeBackgroundColor: (o) => { self.chrome.action._badge.color = o.color; return Promise.resolve(); },
      setTitle: (o) => { self.chrome.action._badge.title = o.title; return Promise.resolve(); },
    },
    // T3.8：scripting（只記錄；_fail 內的 tabId 會拋錯）
    scripting: {
      _calls: [], _fail: new Set(),
      executeScript: async (o) => {
        self.chrome.scripting._calls.push(JSON.parse(JSON.stringify(o)));
        if (self.chrome.scripting._fail.has(o.target.tabId)) throw new Error('Cannot access contents of the page');
        return [{ frameId: 0, result: null }];
      },
    },
    // v46（T5.5，24.5）下載項目與實際檔名：_override(o, kind) 模擬其他擴充功能的 downloads.onDeterminingFilename
    //（kind：'api'＝downloads.download、'anchor'＝<a download>；回傳改寫後的檔名，null＝不改）。實際檔名在 50ms 後才有（與實機相同，先是空字串）
    downloads: {
      _list: [], _items: [], _override: null, _dir: 'C:\\Users\\test\\Downloads\\',
      _add: (o, kind) => {
        const d = self.chrome.downloads;
        const id = d._items.length + 1;
        let name = o.filename || (String(o.url).startsWith('blob:') ? String(o.url).split('/').pop() : 'download');
        const v = d._override ? d._override(o, kind) : null;
        if (v) name = v;
        const it = { id, filename: '', startTime: new Date().toISOString(), state: 'in_progress' };
        d._items.push(it);
        setTimeout(() => { it.filename = d._dir + name.replace(/\//g, '\\'); it.state = 'complete'; }, 50);
        return id;
      },
      download: (o) => { const d = self.chrome.downloads; d._list.push(o); return Promise.resolve(d._add(o, 'api')); },
      search: (q) => {
        const d = self.chrome.downloads;
        let a = d._items.slice();
        if (q && q.id != null) a = a.filter((x) => x.id === q.id);
        if (q && q.startedAfter) a = a.filter((x) => x.startTime > q.startedAfter);
        if (q && Array.isArray(q.orderBy) && q.orderBy[0] === '-startTime') a.reverse();
        if (q && q.limit) a = a.slice(0, q.limit);
        return Promise.resolve(a.map((x) => Object.assign({}, x)));
      },
    },
  };
  self.__mock = { listeners, broadcasts, TEST_DB, TEST_LEGACY,
    fireAlarm: (name) => { for (const f of listeners.alarm) f({ name, scheduledTime: Date.now() }); } };
})();
