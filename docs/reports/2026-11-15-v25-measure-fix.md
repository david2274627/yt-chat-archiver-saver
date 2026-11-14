# 回報：規格 v25、量測 v3（白名單）、控制列與鍵盤調整（等待補測）

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-15 |
| 依據 | `docs/review-2026-11-15.md` 第 4 節（4.0～4.4）、`docs/youtube-dom-notes.md` |
| 規格版本 | v24 → **v25** |
| 套件版本 | `3.0.0-dev`（PoC 標示 v24.1） |
| 目前關卡 | **T1 補測 ⏸**：等待使用者依 `docs/poc-clip-path.md`「補測（v24.1）」回報 |
| GitHub | ✅ 全部已推送（main = origin/main） |

> 只讀 `docs/` 內的檔案，沒有使用 `Claude outputs/` 或 `_to_delete/` 內的副本。

---

## 1. 摘要
- **545px 的原因**：v24 的量測 v2 把蓋在訊息列表上的 YouTube 原生透明覆蓋層 `ytls-widget-overlay-manager` 算成底部元素。這個覆蓋層 top 49、高 436，所以算出 545px（應為 109px），面板只剩約 45px。
- **量測 v3**：改為白名單，只計置頂列 `yt-live-chat-banner-manager`、`#panel-pages`、`#input-panel`，以及覆蓋層的「可見子元素」，覆蓋層本身不計。另加合理性檢查：結果超過 iframe 高度 60%，或面板可見高度不到 160px，就退回 `#input-panel` 算法，並在狀態列標示「自動・後備」。
- **逃生路徑**：
  - 控制列改為單列，按鈕固定在最前面，不會再被擠掉。
  - 新增 Alt+Shift+M（切換自動／手動）與 Alt+Shift+↑／↓（手動 ±8px，加 Ctrl 為 ±32px）。
  - 焦點在聊天室輸入框時，快速鍵也能用。
- **頂部列按鈕位置**：v24 誤插進「重點聊天室訊息 ▾」選單內（`#view-selector`），現在改插在 `⋮`（`#live-chat-header-context-menu`）正前方。
- **規格 v25**：
  - 依實機 DOM 筆記定案：底部互動區白名單、彈窗選擇器、三種版面的判斷屬性。
  - F-02：讀 `#timestamp` 還原時間、身分改讀 `author-type` 屬性、不認識的訊息元件存為 `system`。
  - F-03：以 `@handle` 為鍵。
  - 新增 **F-12 自動切換「即時聊天室」**。
  - 1.3 非目標新增一句：只能保存 YouTube 實際送到分頁的訊息。
- **流程規則**（寫入 CLAUDE.md 與 SPEC 第 9 節）：依賴 YouTube DOM 的功能以 `docs/youtube-dom-notes.md` 為準；模擬頁結果只能標「邏輯檢查通過；真實結構待實機」。

---

## 2. 完成項目

| # | 任務 | Commit | 內容 |
|---|---|---|---|
| 4.0 | `selectors.js` 依實機筆記更新 | `3e55e36` | `⋮` 改為 `#live-chat-header-context-menu`；`chat.bottomZone` 白名單、`bottomZoneOverlay`、`bottomZoneExclude`、`ticker`；`#emoji`、`#product-picker`、`#pickers` 內的 `$` 選單；`authorTypeAttr`、`#chat-badges`；F-12 `viewSelector`；`top.layout` 版面屬性；未出現的訊息類型標「待實機確認」 |
| 4.1 | 量測收緊與合理性退回 | `fc5c17b` | 量測 v3；可疑時退回後備算法；診斷清單列出每個候選的處理方式（計入／排除原因／未列入）；頂部列按鈕位置修正，並回報實際命中的選擇器與父元素；舊版列只在可見時掛載 |
| 4.2 | 控制列與鍵盤調整 | `8c44fe9` | 狀態列單列不換行，按鈕固定在最前；Alt+Shift+M／↑／↓（加 Ctrl ±32px）；chat frame 以 `POC_KEY` 轉送快速鍵，來源檢查與 `TOGGLE_PANEL` 相同 |
| 4.3 | DOM 筆記、診斷檔、規格 v25 | `4cf37c3` | commit `docs/youtube-dom-notes.md` 與 `docs/diag/` 的 4 個檔；CLAUDE.md 兩條規則；SPEC v25（見第 1 節）；CHANGELOG |
| 4.4 | 補測步驟與審查報告 | `6bd6b3b` | `poc-clip-path.md`：v24 實機結果、PoC v24.1 行為、快速鍵表、補測步驟（審查第 5 節）、**附錄 C** chat frame 結構腳本（VOD 用）；`test-checklist.md`；commit `docs/review-2026-11-15.md` |
| 報告 | 本報告 | 本報告所在的 commit | — |

---

## 3. 驗證結果

### 3.1 自動檢查
JS 語法：`selectors.js`、`clip-path-poc.js`、`poc-chat.js`、附錄 C 腳本都通過 `node --check`。

模擬頁的聊天室內部改為依 `docs/youtube-dom-notes.md` 2.1 建構：頂部列含 `#view-selector` 內的 `#menu-button`、`#live-chat-header-context-menu`、全高覆蓋層、置頂列 52px、`#panel-pages`／`#input-panel` 56px，iframe 594px。依 SPEC 第 9 節（v25），以下結果**只代表邏輯檢查通過，真實結構待實機**：

| 項目 | 模擬頁結果 |
|---|---|
| 頂部列按鈕插在 `#live-chat-header-context-menu` 前、父元素是頂部列、不在 `#view-selector` 內 | 邏輯檢查通過 |
| 隱藏的 `#show-hide-button` 不掛舊版列按鈕 | 邏輯檢查通過 |
| 量測 v3 = 109px（全高覆蓋層標「排除：覆蓋層容器本身」，`#item-list` 標「排除」） | 邏輯檢查通過 |
| 覆蓋層內出現 200px 投票卡模擬 → 317px；消失後回到 109px | 邏輯檢查通過 |
| 覆蓋層內出現全高可見子元素 → v3 545px 判為可疑（> 60%），改用後備 56px 並標示原因 | 邏輯檢查通過 |
| 狀態列單列、所有按鈕同一列，第一個是「展開」；面板寬 300px 時按鈕仍在面板內 | 邏輯檢查通過 |
| Alt+Shift+M 切手動（從 109px 開始）→ ↑ 117 → Ctrl+↑ 149 → 在聊天室內按 ↓ 141 → 在聊天室內按 M 回自動 109 | 邏輯檢查通過（以腳本送出的鍵盤事件） |
| 附錄 C 腳本在模擬 chat frame 可執行並回傳 | 邏輯檢查通過 |

### 3.2 待使用者補測（不可視為通過）
- 真實頁面量測 v3 是否約 109～114px，置頂列與輸入列是否完整露出
- 頂部列「PoC 測試」是否在 `⋮` 左邊
- 投票卡的實際標籤與是否完整露出
- 實體鍵盤的 Alt+Shift+M／↑／↓：Windows 上 Alt+Shift 可能被設為切換輸入法，需確認
- 影片下方卡片開關、劇院模式／窄版面、付款視窗、Holodex+
- VOD 重播頁的 chat frame 結構（附錄 C）
- 影片與頁面主體上沒有 PoC 元素

---

## 4. 問題、事件與偏離之處
1. **4.0 單獨成一個 commit**：審查把 `selectors.js` 的更新寫在 4.3，但 4.1 的量測 v3 需要白名單與 `⋮` 選擇器，所以先在 4.0 commit（`3e55e36`）。4.3 只做文件、SPEC 與 CLAUDE.md。
2. **`headerOverflow` 與審查文字略有不同**：審查要求 `'#live-chat-header-context-menu', '#overflow', '#menu-button'`。我把後兩個限定為**頂部列的直接子元素**（`yt-live-chat-header-renderer > #menu-button`），因為 v24 正是用後代選擇器 `#menu-button` 命中了 `#view-selector` 內的選單按鈕，才把按鈕插錯位置。
3. **合理性檢查的副作用**：iframe 594px 時，門檻 60% 約 356px。若真實投票卡加置頂列與輸入列超過約 356px，會被判為可疑並退回後備算法，投票卡就會被裁掉。此時可用 Alt+Shift+M／↑ 手動調整。補測拿到投票卡實際高度後，再評估門檻。
4. **`$` 選單的彈窗判定**：`#pickers > …#product-picker` 已列入 `chat.popups`，但它在關閉時是否仍「可見」尚未確認。PoC 只顯示、不據此改變裁切；SPEC 註明若關閉時仍可見，不得列為 `popupOpen` 條件。
5. **F-12 與 F-02 只寫入規格，尚未實作**：分別屬於 T5 與 T3。PoC 不會自動切到「即時聊天室」，補測步驟 3a 只記錄目前狀態。
6. **時間戳格式**：實機只知道長度約 7 字元，確切格式未知。SPEC 要求解析時同時容許上午／下午與 AM／PM，T3 實作時再確認。
7. **`docs/diag/` 的內容**：commit 前已逐一讀過，沒有訊息文字。其中含有直播主的公開 handle（來自按鈕的無障礙標籤），以及一個 YouTube 訊息 id。附錄 C 腳本已改為把長 id 以 `<訊息id>` 取代。
8. **`_to_delete/` 又出現了**：內有 5 個舊版副本（`review-2026-11-15.r2～r4.md`、`youtube-dom-notes.r1～r2.md`）。我沒有動，也沒有 commit。要不要刪掉，或把 `_to_delete/` 加入 `.gitignore`，請使用者決定。
9. **模擬頁的限制**：瀏覽器面板隱藏時 `ResizeObserver`／`requestAnimationFrame` 不執行；鍵盤以腳本送出的事件測試；剪貼簿需要真實的使用者手勢。這三項都要靠實機確認。
10. 本輪沒有發生誤操作事件。瀏覽器只操作自己開的 `127.0.0.1` 模擬頁分頁。

---

## 5. 需要使用者做的事
依 `docs/poc-clip-path.md` 的「**補測（v24.1）**」操作，並用該節的回報格式回覆：
0. `chrome://extensions` → 🔄 重新載入（**不要移除**）→ 重新整理直播頁。
1. **一般直播**：
   - 確認頂部列 `⋮` 左邊有「PoC 測試」→ 開啟。
   - 自動露出應約 109～114px。不對的話，按 Alt+Shift+M 切手動、Alt+Shift+↑／↓ 調到剛好，記下數字。
   - 按 Alt+Shift+D 貼回。
2. **有投票卡的直播**：確認投票卡完整露出、可以投票，按 Alt+Shift+D 貼回。
   - 3a：記錄頂部列顯示「重點聊天室訊息」還是「即時聊天室」。
   - 3b：在 **VOD 重播頁**的聊天室 iframe 執行附錄 C 腳本並貼回。
3. **卡片開關**：用 `✕` 關閉聊天室後，影片下方卡片出現「PoC 測試」，點擊後聊天室展開並開啟 PoC。
4. **劇院模式與窄版面**：
   - 劇院模式應顯示「PoC 暫停」。
   - 窄版面依筆記聊天室仍是全高，預期會正常裁切、不暫停。
   - 兩者都按 Alt+Shift+D 貼回。
5. **付款視窗**：顯示「頁面：div#buyFlowDivId」，關閉後消失。**不要付款**，也不附含付款資訊的截圖。
6. 影片與頁面主體上沒有 PoC 元素；有異常時停用 Holodex+ 重測。
7. 決定 `_to_delete/` 的處理方式。

---

## 6. 下一步
- 補測結果出來後：
  1. 把投票卡標籤、VOD chat frame 結構、劇院模式版面診斷寫入 `docs/youtube-dom-notes.md` 與 `docs/diag/`。
  2. 補完 `chat.bottomZone`、評估合理性門檻。
  3. 確認 `$` 選單關閉時的可見性。
  4. 更新 test-checklist。
- T1 補測全部通過後，進入 **D1 設計稿**。D1 需遵守 10.1 原則 6，並處理 F-07 置頂卡片與原生置頂列的關係。
- 若量測仍不對：附 Alt+Shift+D 的結果（內含每個候選元素的處理方式），再依實機結構調整白名單。
