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
1. Chrome 開啟 `chrome://extensions`，打開右上角「開發人員模式」。
2. 第一次：點「載入未封裝項目」，選 repo 資料夾（有 `manifest.json` 的那層）。
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
