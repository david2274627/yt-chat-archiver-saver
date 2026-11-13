// IndexedDB 封裝（T2 實作）。
// 寫入只由 background.js 呼叫；viewer.js 只能使用唯讀查詢（SPEC 3.2 v21）。
(function (root) {
  'use strict';
  root.YTCAS_DB = {};
})(typeof globalThis !== 'undefined' ? globalThis : self);
