# 本機 Claude Code 交接說明

## 一、事前準備（只需做一次）
1. 安裝 Claude Code，並用你的 Claude 帳號登入。
2. 安裝 Git，確認可以存取 GitHub（`git clone` 私人 repo 需要登入或 SSH key）。
3. 準備測試環境：
   - Chrome 最新穩定版
   - 一個高流量直播（測記憶體與擷取）
   - 一個你能留言的直播，最好是你有加入會員的頻道（測輸入框、會員表符、`$` 選單）

## 二、開始開發
```bash
git clone https://github.com/david2274627/yt-chat-archiver-saver.git
cd yt-chat-archiver-saver
claude
```
Claude Code 會自動讀取 `CLAUDE.md`。進入後貼上：

```
請閱讀 SPEC.md（v20）、CLAUDE.md、CHANGELOG.md、docs/HANDOFF.md，
這是一個全新重寫的專案，不沿用任何舊程式碼，UI 樣式全部依 SPEC 第 10 節重新設計。

請依 SPEC 第 8 節從 T0 開始依序執行：
- 遇到標示 ⏸ 的任務，完成後先停下來，告訴我具體的測試或檢視步驟，等我回報再繼續。
- 每完成一個任務就 commit 並 push，並更新 docs/test-checklist.md。
- 開始前先列出你對規格不清楚或有疑慮的地方。
```

## 三、每一輪的測試方式

> ⚠️ **保護 v2.6.0 舊資料**
> - 未封裝擴充功能的 ID 由資料夾路徑決定。v3 與 v2.6.0 都從 `E:\Tool\ChromeExtensions\yt-chat-archiver-saver` 載入，所以 Chrome 裡**原本那個擴充功能項目**現在跑的就是 v3 程式碼，舊資料（IndexedDB `YTLiveChatArchiverDB_V6`）原本也在這個項目底下。（2026-11-15 實測：v3 第一次啟動時，這個項目的 IndexedDB 已經是空的，舊資料只剩 `indexeddb_bak\bak_v1` 備份；還原方式見第 0 步第 5 點。）
> - **絕對不要在 `chrome://extensions` 按「移除」**：移除會連同 IndexedDB（所有聊天存檔，含 v3 與舊版）一起永久刪除。**更新程式碼請 `git pull` 後在該項目按 🔄 重新載入**。v3 完成 F-17 後會每週自動備份到下載資料夾，但仍不要移除。
> - **不要對同一路徑再按「載入未封裝項目」**，以免產生重複或取代的項目。
> - 第一次實測前，先做第 0 步「資料備份」。

0. **資料備份（第一次實測前必做，之後每個大版本前建議重做）**
   1. 在 `chrome://extensions` 記下該擴充功能項目的 **ID**。
   2. 完全關閉 Chrome（確認工作列和系統匣都沒有 Chrome）。
   3. 把資料夾 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_<ID>_0.indexeddb.leveldb` 複製到安全位置；如果有同名的 `.indexeddb.blob` 資料夾，也一起複製。使用其他 Chrome 設定檔時，把 `Default` 換成該設定檔的資料夾名稱（例如 `Profile 1`）。
   4. **備份放在 repo 以外的位置**，例如 `E:\Tool\ChromeExtensions\indexeddb_bak\`（目前使用者的備份就在這裡：`bak_v1` 為 2026-11-13 含 v2.6.0 舊資料的完整備份，`bak_v2` 為 2026-11-15 v3 第一次啟動後）。不要放在 repo 內，以免 `git clean -fdx` 之類的指令刪除，也避免誤 commit（repo 的 `.gitignore` 仍保留 `bak/` 作為保險）。
   5. **從備份還原**（例如舊資料不在 Chrome 裡、需要重新遷移時）：完全關閉 Chrome → 把目前的 `chrome-extension_<ID>_0.indexeddb.leveldb` 資料夾**改名保留**（不要刪除）→ 把備份的同名資料夾**複製**（不是移動）回原位置 → 開啟 Chrome。若備份或目前位置還有同名的 `chrome-extension_<ID>_0.indexeddb.blob` 資料夾，以同樣方式處理（現有的改名保留、備份的複製回去；2026-11-15 檢查時 `bak_v1` 與 Chrome 目前位置都沒有 `.blob`）。還原會讓該擴充功能的 IndexedDB 回到備份當時的狀態：**還原之前收錄的資料會被換掉**（仍保存在改名後的資料夾中），所以一定要在開始實際收錄前做（T3 實測步驟 A 必須在 B 之前）。還原後在 Service Worker Console 執行 `YTCAS_BG.autoMigrateLegacy(true)` 重新遷移（T7 起改由後台「設定 → 進階」的按鈕執行）。
1. Chrome 開啟 `chrome://extensions`，打開右上角「開發人員模式」。
2. 已經有原本的擴充功能項目時：**直接在該項目按 🔄 重新載入**，不要移除，也不要重新載入未封裝項目。只有全新電腦、從未載入過時，才點「載入未封裝項目」選 repo 資料夾。
3. 之後每次改完：在擴充功能卡片上按 🔄 重新載入，再**重新整理 YouTube 分頁**。
4. 有問題時：
   - YouTube 頁面按 F12 看 Console（頁面與聊天室 iframe 可在 Console 左上角切換 frame）
   - Service Worker 的錯誤：擴充功能卡片上點「Service Worker」連結
   - 把錯誤訊息或截圖直接貼給 Claude Code

## 三之一、診斷記錄（F-20）
- 控制頁：在 Chrome 網址列輸入 **`chrome-extension://ejdhefdjjjlajfilfijnanippgdcdeoi/tools/diag.html`**（擴充功能 ID 已核對，見 `docs/test-checklist.md`）。T7 完成後也可從後台「設定 → 進階 → 診斷記錄」開啟。
- 用法：選擇要記錄多久（或指定結束時間）→「開始記錄」（套件圖示出現紅色 REC）→ 正常觀看 → 時間到自動停止 →「匯出診斷記錄」。
- 匯出檔在「下載\YT聊天室診斷\」。**放到 repo 的 `docs/diag/raw/`**（已列入 `.gitignore`，含觀看紀錄，不會被 commit），告訴 Claude Code 檔名；Claude Code 產生的摘要放在 `docs/diag/` 並 commit。
- 擴充功能 🔄 之後，已開著的 YouTube 分頁會自動重新接上（T3.8 起，`scripting` 權限）；控制頁若顯示「需要重新整理的分頁」，請對那些分頁按 F5。

## 四、停下來等你的關卡
| 關卡 | 你要做的事 |
|---|---|
| T1 clip-path 實測 | 照 `docs/poc-clip-path.md` 步驟測：上半部能否捲動/點擊測試面板、下方輸入框能否打字。回報「成功」或「失敗＋截圖」 |
| D1 設計稿 | 用 Chrome 開 `design/mockups.html`，切換方向 A/B、淺色/深色，選一個並說明想調整的地方 |
| T3 收錄實測 | 依 T3 報告（`docs/reports/2026-11-15-t3-capture.md`）第 5 節：直播收錄、DOM 節點數、背景分頁、彈出式聊天室、重播 id 比對；回貼 Console 的 `[ytcas]` 統計與診斷行（只有筆數、屬性與時間） |
| T5 VOD 與按鈕 | 開一部有聊天重播的 VOD，測自動跟隨、手動捲動、點時間碼跳轉 |
| T6 F-10 | 直播中依 SPEC 6.5 AC 1～7 測輸入、表符、`$` |
| T8 全面回歸 | 照 `docs/test-checklist.md` 全部測一次並填寫 |

## 五、版本與 GitHub
- 每個任務完成，Claude Code 會 commit 並 push 到 `main`。
- 版本資訊記錄在 `CHANGELOG.md`；完成 T9 後版本為 3.0.0。
- 本機 Claude Code 可以直接推送 git 標籤，發版時可請它執行 `git tag v3.0.0 && git push origin v3.0.0`。
