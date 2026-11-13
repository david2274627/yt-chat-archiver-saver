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
> - 未封裝擴充功能的 ID 由資料夾路徑決定。v3 與 v2.6.0 都從 `E:\Tool\ChromeExtensions\yt-chat-archiver-saver` 載入，所以 Chrome 裡**原本那個擴充功能項目**現在跑的就是 v3 程式碼，而舊資料（IndexedDB `YTLiveChatArchiverDB_V6`）還在這個項目底下。
> - **絕對不要移除原本的擴充功能項目**：移除會連同 IndexedDB 一起永久刪除。只能在該項目上按 🔄 重新載入。
> - **不要對同一路徑再按「載入未封裝項目」**，以免產生重複或取代的項目。
> - 第一次實測前，先做第 0 步「資料備份」。

0. **資料備份（第一次實測前必做，之後每個大版本前建議重做）**
   1. 在 `chrome://extensions` 記下該擴充功能項目的 **ID**。
   2. 完全關閉 Chrome（確認工作列和系統匣都沒有 Chrome）。
   3. 把資料夾 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_<ID>_0.indexeddb.leveldb` 複製到安全位置；如果有同名的 `.indexeddb.blob` 資料夾，也一起複製。使用其他 Chrome 設定檔時，把 `Default` 換成該設定檔的資料夾名稱（例如 `Profile 1`）。
   4. 備份放在 repo 內 `bak/` 也可以（已列入 `.gitignore`，不會被 commit）。但最好另存一份到 repo 以外的位置，以免執行 `git clean -fdx` 之類的指令時被刪除。
1. Chrome 開啟 `chrome://extensions`，打開右上角「開發人員模式」。
2. 已經有原本的擴充功能項目時：**直接在該項目按 🔄 重新載入**，不要移除，也不要重新載入未封裝項目。只有全新電腦、從未載入過時，才點「載入未封裝項目」選 repo 資料夾。
3. 之後每次改完：在擴充功能卡片上按 🔄 重新載入，再**重新整理 YouTube 分頁**。
4. 有問題時：
   - YouTube 頁面按 F12 看 Console（頁面與聊天室 iframe 可在 Console 左上角切換 frame）
   - Service Worker 的錯誤：擴充功能卡片上點「Service Worker」連結
   - 把錯誤訊息或截圖直接貼給 Claude Code

## 四、停下來等你的關卡
| 關卡 | 你要做的事 |
|---|---|
| T1 clip-path 實測 | 照 `docs/poc-clip-path.md` 步驟測：上半部能否捲動/點擊測試面板、下方輸入框能否打字。回報「成功」或「失敗＋截圖」 |
| D1 設計稿 | 用 Chrome 開 `design/mockups.html`，切換方向 A/B、淺色/深色，選一個並說明想調整的地方 |
| T5 VOD 與按鈕 | 開一部有聊天重播的 VOD，測自動跟隨、手動捲動、點時間碼跳轉 |
| T6 F-10 | 直播中依 SPEC 6.5 AC 1～7 測輸入、表符、`$` |
| T8 全面回歸 | 照 `docs/test-checklist.md` 全部測一次並填寫 |

## 五、版本與 GitHub
- 每個任務完成，Claude Code 會 commit 並 push 到 `main`。
- 版本資訊記錄在 `CHANGELOG.md`；完成 T9 後版本為 3.0.0。
- 本機 Claude Code 可以直接推送 git 標籤，發版時可請它執行 `git tag v3.0.0 && git push origin v3.0.0`。
