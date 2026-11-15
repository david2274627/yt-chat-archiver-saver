# tools/tests — 測試頁

在瀏覽器執行的測試頁，不使用 npm（CLAUDE.md）。`tools/` 不被 `manifest.json` 引用，不會打包進套件。

| 頁面 | 內容 |
|---|---|
| `test-db.html` | 資料層與 background 單元測試（真實 IndexedDB，`chrome.*` 以 `mock-chrome.js` 假物件替代） |
| `test-capture.html` | 擷取引擎（`src/capture.js`）測試：解析、回溯擷取、修剪、批次、重試、刪除通知順序。模擬聊天室的結構**只依 `docs/youtube-dom-notes.md` 建構**，結果只代表「模擬頁：邏輯檢查通過；真實結構待實機」 |
| `test-stress.html` | 寫入壓力測試（SPEC 第 7 節「寫入效能」）：每批 50 則的處理時間分布、10 萬則連續寫入 |

## 執行方式
以本機靜態伺服器提供 repo 根目錄（只綁 `127.0.0.1`），用 Chrome 開 `http://127.0.0.1:<port>/tools/tests/<頁面>.html`。測試使用 `test-` 開頭的獨立資料庫名稱，不會碰到擴充功能本身的資料（擴充功能的 IndexedDB 屬於 `chrome-extension://` 來源，與測試頁的 `http://127.0.0.1` 來源完全隔離）。

## 規則
- **一律攔截對外連線**：`mock-chrome.js` 在載入時把 `fetch` 換成回傳 404 的假函式，並讓 `XMLHttpRequest.prototype.open`／`send` 直接拋錯。測試需要的回應由各測試自行替換 `fetch`，用完還原為攔截版本。新測試頁必須先載入 `mock-chrome.js`（或自行做同等攔截）。
- 測試資料一律是虛構內容；不得把使用者的真實聊天資料放進測試頁或 repo。
- 測試輸出只顯示筆數、耗時與通過／失敗，不顯示訊息內容。
