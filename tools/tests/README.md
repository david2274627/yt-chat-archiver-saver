# tools/tests — 測試頁

在瀏覽器執行的測試頁，不使用 npm（CLAUDE.md）。`tools/` 不被 `manifest.json` 引用，不會打包進套件。

| 頁面 | 內容 |
|---|---|
| `test-db.html` | 資料層與 background 單元測試（真實 IndexedDB，`chrome.*` 以 `mock-chrome.js` 假物件替代） |
| `test-capture.html` | 擷取引擎（`src/capture.js`）測試：解析、回溯擷取、修剪、批次、重試、刪除通知順序。模擬聊天室的結構**只依 `docs/youtube-dom-notes.md` 建構**，結果只代表「模擬頁：邏輯檢查通過；真實結構待實機」 |
| `test-stress.html` | 寫入壓力測試（SPEC 第 7 節「寫入效能」）：每批 50 則的處理時間分布、10 萬則連續寫入 |
| `test-viewer.html` | T4 檢視器：`viewer-core.js` 純函式（分類、篩選、高亮、時段分隔、時間碼、SC 顏色、置頂去重）與 `viewer.js` 實際渲染（訊息類型、注入字串不執行、圖片白名單、膠囊／chip／搜尋／選單互動、推播更新）、**10 萬則效能**（首屏 ≤ 2 秒、搜尋 ≤ 300ms）。頁面以 CSP 禁止載入外部圖片（測試資料含白名單網域的圖片網址） |
| `test-diag-page.html` | F-20 診斷控制頁（`tools/diag.html`／`diag.js`）：載入真正的頁面內容與 background 處理函式，測按鈕三種狀態、結束方式互斥、時限提示、尚未匯出提示 |
| `test-panel.html` | T5 優化面板 top frame 控制器（`src/panel.js`）：以同源模擬頁（`panel-fixtures/`）驗證插入位置、退讓、重新插入、開關錨點、與面板及聊天室 iframe 的訊息與來源檢查 |
| `test-content-chat.html` | T5.1（審查十一第 12 節）：iframe 以 `history.replaceState` 改成 `/live_chat` 網址後**載入真實的 `content.js`**（含 `capture.js`、`panel.js`；`YT_ORIGIN` 換成本機 origin），本頁扮演 top frame：頂部列按鈕位置、`PANEL_STATE`／`TOGGLE_PANEL`／`STREAM_INFO`／`CAPTURE_STATUS` 訊息、只接受 parent 的訊息、**沒有未捕捉的例外**。修正前的 `content.js` 會 0／5（重現 `post is not defined`） |
| `test-e2e-panel.html` | T5.1／T5.2 端對端：真實 `panel.js` → 真實 `viewer.js`（面板 `src` 用 localhost、實際 origin 為 127.0.0.1，模擬 `use_dynamic_url`）：VOD 同步、使用者捲動暫停、直播跟隨與倒轉、**直播 sync 中先捲動再 seek → 跳到新位置**（T5.2）、推播即時更新 |

另有靜態檢查 `node tools/check-scope.js`（不帶參數檢查 `src/*.js`）：IIFE 內最外層函式使用了只宣告在另一個最外層函式內的識別字（例：`headerButton()` 使用 `runChat()` 的 `post`）。近似檢查、沒有相依套件；修改 `content.js`、`panel.js` 等之後執行，結果應為「沒有跨最外層函式引用區域識別字」。

- `keep-fetch.js`：需要讀取 repo 內同一來源檔案（例如 `tools/diag.html`）的測試頁，在 `mock-chrome.js` 之前載入，改用 `__sameOriginFetch`；其他來源一律拒絕。

## 執行方式
以本機靜態伺服器提供 repo 根目錄（只綁 `127.0.0.1`），用 Chrome 開 `http://127.0.0.1:<port>/tools/tests/<頁面>.html`。測試使用 `test-` 開頭的獨立資料庫名稱，不會碰到擴充功能本身的資料（擴充功能的 IndexedDB 屬於 `chrome-extension://` 來源，與測試頁的 `http://127.0.0.1` 來源完全隔離）。

## 規則
- **一律攔截對外連線**：`mock-chrome.js` 在載入時把 `fetch` 換成回傳 404 的假函式，並讓 `XMLHttpRequest.prototype.open`／`send` 直接拋錯。會渲染 `<img>` 的測試頁另加 CSP（`img-src 'self' data:`），外部圖片不會實際連線。測試需要的回應由各測試自行替換 `fetch`，用完還原為攔截版本。新測試頁必須先載入 `mock-chrome.js`（或自行做同等攔截）。
- **（審查十一 15 節第 1 點）新增任何測試頁時，一律先在 `<head>` 加 CSP**，只允許本機：至少 `default-src 'self'; img-src 'self' data:; connect-src 'self'`（需要 inline script 時加 `'unsafe-inline'`，需要 iframe 時 `frame-src 'self'` 或明列本機 origin）。不論頁面是否預期會渲染圖片都要加；T3 起的 `test-capture.html` 曾因沒有 CSP 而向 YouTube 圖片網域請求虛構網址。
- 測試資料一律是虛構內容；不得把使用者的真實聊天資料放進測試頁或 repo。
- 測試輸出只顯示筆數、耗時與通過／失敗，不顯示訊息內容。
