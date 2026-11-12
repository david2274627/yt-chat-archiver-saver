# YouTube 直播聊天室省記憶體與歷史回放套件 — 技術交接規格書

> 歷史文件（v18，對應套件 2.6.0），原樣保留供參考。最新規格請見根目錄 `SPEC.md`。

**文件版本**：v18（對應套件版本 `2.6.0`）  
**目標環境**：Google Chrome 桌面版（Manifest V3）  
**核心目標**：在長時間觀看 YouTube 直播時維持分頁低記憶體佔用，同時完整保存富媒體（文字、表符、時間軸、頭像、SC、置頂、降落）聊天室歷史紀錄，並提供直播中互動與直播後 VOD 同步回放功能。

---

## 一、 背景知識與核心技術發現

### 1. Chrome 觀看 YouTube 吃光記憶體的根源
1. **直播聊天室 DOM 無限堆積（最大元兇）**：YouTube 直播聊天室嵌入在獨立的 `<iframe>`（`youtube.com/live_chat`）中。高流量直播下，頻繁的 `MutationObserver`、Polymer/Lit 元件狀態、會員貼圖快取與 Super Chat 動畫會讓單一分頁在數小時內突破 2GB～4GB RAM。
2. **單頁應用程式（SPA）狀態累積**：同一分頁連續切換多部影片時，舊留言區與事件監聽器未完全釋放造成 Memory Leak。
3. **MSE 影音緩衝與 GPU 合成層**：頻繁拖拉進度條或開啟「環境燈光效果（Ambient Mode）」會推高系統記憶體映射佔用。

### 2. 已驗證有效的核心架構設計
* **雙層資料流架構（DOM Pruner + IndexedDB）**：
  * 在 `live_chat` iframe 內透過 `MutationObserver` 即時截取新進入的訊息節點，解析出文字與表符 `<img>` 後批次傳送給 `background.js` 寫入本地 `IndexedDB`（`unlimitedStorage` 權限）。
  * 每 3.5 秒自動修剪（`remove()`）超過 **45 則**的舊聊天室 DOM 節點，將原生聊天室的渲染記憶體鎖定在極低水位。
* **解決 Origin 隔離問題**：
  * `youtube.com` 與 `chrome-extension://` 的 IndexedDB 彼此隔離。必須統一由 `background.js`（Service Worker）操作 `chrome-extension://` 下的 IndexedDB，再透過 `chrome.runtime.sendMessage` 推播給前台內嵌與後台獨立檢視器。
* **自動解析頻道顯示「名稱」與頭像**：
  * 聊天室 DOM 的 `#author-name` 預設只顯示 `@Handle`（帳號代碼）。透過 `background.js` 併發節流抓取頻道頁面的 `og:title` 與 `og:image` 並快取 7 天，可自動將 `@Handle` 轉換為對方設定的 YouTube 頻道「名稱」並補齊頭像。

---

## 二、 期望產品規格清單（完整需求）

### A. 效能與資料收錄規格
1. **直播低記憶體佔用**：自動修剪聊天室 DOM 節點（上限 45 則），並監聽 `yt-navigate-finish` 清理殘留空白圖片節點。
2. **完整富媒體歷史保存**：保存純文字、官方 Emoji 與會員自訂貼圖（`<img>` 網址與 `alt` 代碼）、雙重時間軸（絕對時間 + 影片相對秒數 `videoOffsetSec`）、使用者頭像與頻道首頁直連網址（`https://www.youtube.com/@Handle` 或 `/channel/UC...`）。
3. **無手動改名，全自動頻道名稱解析**：移除手動「改名」按鈕，由套件自動解析並顯示對方在 YouTube 設定的頻道「名稱」（副標淡色顯示原 `@Handle`）。

### B. 檢視器 UI 與互動規格（`viewer.html` / `viewer.js`）
4. **前後台介面分離**：
   * **前台（內嵌於 YouTube 頁面右側欄，`embed=1`）**：隱藏場次下拉選單與匯出/刪除管理列，最大化垂直閱讀空間。
   * **後台（點擊擴充功能圖示開啟獨立分頁）**：完整顯示場次切換、匯出獨立離線 HTML（內建表符與離線搜尋框）、匯出 JSON 與刪除按鈕。
5. **快速分類膠囊列**：
   * **全部訊息**（顯示總數）
   * **💰 Super Chat**（一鍵篩選所有 SC 與超級貼圖）
   * **✨ 實況主降落**（高光強調 YouTube 觀眾導流 Raid 橫幅與其他認證實況主來訪；**必須排除 `Nightbot`、`StreamElements` 等常見聊天室機器人與本台管理員**）
6. **搜尋列順序（符合聊天室直覺）**：
   * 左側為 **「過濾使用者 (頻道名稱 / @代碼)...」**（亦支援點擊列表中的使用者名稱一鍵過濾）。
   * 右側為 **「搜尋訊息關鍵字或表符...」**（支援關鍵字高亮標記）。
7. **原生風格懸浮「主播置頂卡片」**：
   * 置頂訊息不重複混入一般聊天流，而是去重後固定懸浮在搜尋列下方，支援點擊展開/收合完整內容，並顯示主播頭像。
8. **VOD 播放時間軸雙向同步（無需開關，內建為預設規格）**：
   * 觀看 VOD 時，內嵌聊天室自動隨播放器 `currentTime` 二分搜尋定位並平滑捲動、藍框高亮當前發言。
   * 使用者手動往上滾動瀏覽舊訊息時自動暫停跟隨，並於底部浮現 **「↓ 恢復自動捲動」** 按鈕。
   * 點擊任一訊息前方的藍色時間碼（如 `2:02:10`），左側 VOD 播放器直接跳轉至該秒數播放（Click-to-Seek）。

### C. YouTube 頁面整合按鈕與直播底部互動區規格（`content.js`）
9. **單一精簡控制按鈕**：
   * 不顯示佔版面的大型說明橫幅。
   * 將按鈕直接整合進原生聊天室收合橫幅的 **「開啟面板」** 按鈕正旁邊（水平並排），字樣為 **「開啟優化面板」**，點擊展開後變為紅色 **「關閉優化面板」**。
   * 點擊「開啟優化面板」時，若原生聊天室處於收合狀態，需自動喚醒展開以開始擷取訊息。
10. **直播中保留底部互動輸入區（目前主要未解決難點）**：
    * 直播進行中開啟優化面板時，必須保留最下方的原生輸入功能（輸入文字、展開會員表情符號選單、點擊 `$` 開啟超級留言／超級貼圖／免費會員資格里程碑訊息）。
    * 期望交互行為：**平常輸入框維持在最底部單行高度；當點擊表情符號或 `$` 購買流程時，彈窗從最底部自然向上長出並直接覆蓋在優化面板上方**，不應被裁切、不應產生大片空白、也不應與底層選單文字重疊。

---

## 三、 目前套件檔案結構

```text
yt-chat-archiver-saver/
├── manifest.json    # MV3 設定檔 (storage, unlimitedStorage, tabs, web_accessible_resources)
├── db.js            # IndexedDB 封裝 (streams, messages, pinned_messages, channels 四張資料表)
├── background.js    # Service Worker 統一資料庫中心、即時訊息推播與頻道名稱/頭像非同步解析器
├── content.js       # 雙環境腳本：live_chat iframe 擷取/DOM修剪/輸入區樣式控制 + top frame 按鈕注入與時間軸同步
├── popup.html       # 工具列彈出視窗 UI
├── popup.js         # 快速開啟目前分頁檢視器與最近存檔列表
├── viewer.html      # 歷史檢視與搜尋器 UI（含前後台版面切換與懸浮置頂卡片）
└── viewer.js        # 搜尋過濾、表符渲染、置頂卡片控制、VOD 二分搜尋時間軸同步與 HTML/JSON 匯出
```

---

## 四、 目前遇到的困難與失敗經驗總結（供接手者避坑）

截至 v18，**第一至第九項規格（記憶體優化、資料庫、自動抓頻道名稱與頭像、懸浮置頂卡片、機器人排除、降落高光、VOD 時間軸雙向同步、前後台分離、單一按鈕整合）皆已實測正常運作**。

**目前唯一卡關的困難在於第 10 項：「在直播中開啟優化面板時，如何讓下方的原生 YouTube 輸入框（含表符選單、SC、超級貼圖、免費會員里程碑）完美運作且不破版」**。

### 歷次嘗試與失敗原因分析

1. **嘗試一（v13～v16）：強制縮小外層 `ytd-live-chat-frame` 高度為 `88px`，再透過 `postMessage` 動態偵測內部彈窗高度撐高**
   * **失敗原因**：YouTube 內部的 `tp-yt-iron-dropdown`、`yt-live-chat-product-picker-renderer` 與 `yt-live-chat-message-buy-flow-renderer` 是依賴外層完整視窗高度（約 `560px`）進行定位與計算的。強行把 `iframe#chatframe` 壓扁成 `88px` 後：
     * 高度偵測會有時間差，剛開啟或關閉彈窗時容易在下方留下一整塊空白區塊（如 `image_1c84bf.png`、`image_1c0866.png` 所示，整個輸入框內部變成空白白框）。
     * 進入購買流程第二步時，若未徹底隱藏底層下拉選單，兩層元件文字會直接重疊（如 `image_1c7cbe.png`）。
     * 在 `live_chat` 內部對 `yt-live-chat-app` 強制加上 `display: flex; justify-content: flex-end; height: 100%` 會破壞 Polymer 內部元件的渲染週期，導致輸入框在矮高度下直接空白不渲染。

2. **嘗試二（v17）：保持 `nativeChat` 完整高度不變，設為 `pointer-events: none` 並疊在優化面板上方**
   * **失敗原因**：在瀏覽器規範中，一旦對 `<iframe>` 元素本身或外層容器設定 `pointer-events: none`，整個 `iframe` 區域會完全喪失滑鼠事件接收能力，內部的 `#input-panel` 即使設定 `pointer-events: auto` 也無法被點擊；同時強制 `position: fixed` 會讓購買視窗跑到頂部而非底部（如 `image_1c1be0.png`）。

3. **嘗試三（v18）：固定總高度 `568px` 上下堆疊並動態分配高度**
   * **失敗原因**：由於在 `live_chat` CSS 中仍保留了對 `yt-live-chat-app, #contents, #chat-messages` 的 `height: 100% !important` 強制覆寫，當 `iframe#chatframe` 高度被設為 `88px` 時，YouTube 內部的 `yt-live-chat-renderer` 因為偵測到容器高度過小（小於最小可用高度閾值），直接觸發內部響應式隱藏或渲染異常，導致下方白框內完全看不到輸入框（如 `image_1c0866.png` 所示）。

### 給接手開發者的技術突破建議

要徹底解決「保留原生輸入／表符／SC 互動，同時上方顯示優化面板」，建議放棄「把 `iframe#chatframe` 壓扁成 `88px` 並修改 `yt-live-chat-app` 佈局」的做法，改採以下兩種方向之一：

* **建議方案 A（CSS `clip-path` 動態裁切原生完整高度 `iframe`，不改動任何內部佈局）**：
  1. 讓 `ytd-live-chat-frame` 與 `iframe#chatframe` **完全維持 YouTube 原生尺寸（例如 `560px`）與原生 CSS 結構**（絕對不要改 `yt-live-chat-app` 的 `display` 或 `height`，只單純 `display: none` 隱藏 `#item-list` 與 `yt-live-chat-header-renderer`）。這樣 YouTube 的輸入框、表情符號、SC、超級貼圖與里程碑永遠處於正常的 `560px` 環境中，100% 不會出現空白或定位錯亂。
  2. 將「優化面板」與「原生 `nativeChat`」放在同一個 `position: relative` 容器內完全重疊（同寬同高 `560px`），讓 `nativeChat` 在上層（`z-index: 20`），優化面板在下層（`z-index: 10`）。
  3. **關鍵技巧**：對上層的 `nativeChat` 使用 CSS **`clip-path: inset(calc(100% - 84px) 0 0 0)`**！
     * `clip-path` 在 Chrome 中**不僅會裁切視覺畫面，還會自動讓被裁切掉的上半部區域完全穿透滑鼠事件（點擊與滾動直接穿透到下層的優化面板）**，同時不影響 `iframe` 內部的任何 `560px` 佈局計算！
     * 當偵測到 `live_chat` 內有開啟表情符號面板、`$` 選單或購買流程時，只需將 `clip-path` 改為 `inset(0 0 0 0)`（解除裁切），原生彈窗就會從底部完美向上覆蓋整個優化面板；關閉彈窗後再設回 `inset(calc(100% - 84px) 0 0 0)` 即可。

* **建議方案 B（直接透過 YouTube 內部 API 發送訊息，完全隱藏原生 `chatframe`）**：
  * 若不需要在面板內處理金流（SC 付款），純文字與會員表符發送可直接透過攔截 `youtubei/v1/live_chat/send_message` 請求參數，在優化面板底部自建一個輕量輸入框與表符選擇器，徹底擺脫原生 `iframe` 的樣式限制。
