# 進度報告：T0、T1 完成，等待 T1 實測

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-13 |
| 專案 | YT 加強版聊天室套件（`yt-chat-archiver-saver`） |
| 目標版本 | 3.0.0（目前 `3.0.0-dev`） |
| 規格版本 | v21 |
| 目前關卡 | **T1 ⏸**：等使用者在真實直播實測 clip-path PoC |
| GitHub 狀態 | ✅ 已推送（使用者完成 GitHub 登入後，`5a7b435`、`8439208`、`1ea108e` 皆已在 `origin/main`） |
| 後續 | 審查意見見 `docs/review-2026-11-13.md`，修正後升為規格 v22 |

---

## 1. 摘要
- T0（專案骨架）和 T1（clip-path PoC）都已完成，並 commit 在本機 `main`。
- 開工前提出的規格疑慮已經使用者決定，更新為規格 **v21**。
- 撰寫當下因為缺少 GitHub 憑證，push 失敗；使用者登入後已全部推送（見 6.1）。
- T1 在本機模擬頁面上通過命中測試，但**真實 YouTube 直播尚未驗證**，不能視為通過。

---

## 2. 本機資料夾處理
- 原路徑 `E:\Tool\ChromeExtensions\yt-chat-archiver-saver` 原本是 **v2.6.0 舊程式碼**，不是 git repo，無法 `git pull`。
- 依使用者決定：
  - 舊資料夾改名為 `yt-chat-archiver-saver_v2.6.0_backup`（保留，未刪除）。
  - 在原路徑重新 clone repo。
- repo 的 git 使用者設定（只在這個 repo 生效）沿用過去 commit 的作者：`david2274627 <121411475+david2274627@users.noreply.github.com>`。

---

## 3. 規格疑慮與決定

### 3.1 需要使用者決定的項目
| # | 疑慮 | 決定 | 影響 |
|---|---|---|---|
| 1 | 本機資料夾是舊程式碼，不是 repo | 改名備份後 clone | 見第 2 節 |
| 2 | 10 萬則訊息都經過 background 序列化，很難做到首屏 ≤ 2 秒 | **viewer 直接唯讀 IndexedDB**，寫入只由 background 執行 | SPEC 3.2 |
| 3 | YouTube 標準 Unicode 表符圖片來自 gstatic，不在白名單 | **白名單加入** `fonts.gstatic.com`、`www.gstatic.com` | SPEC 第 7 節、`constants.js` |
| 4 | 匯出離線 HTML 的圖片處理 | **內嵌為 data URL**，新增圖片網域 host_permissions | SPEC F-04、第 7 節、`manifest.json` |

### 3.2 自行處理並寫入規格的項目
| # | 疑慮 | 處理方式 |
|---|---|---|
| 5 | CLAUDE.md 說 tag 由使用者補打，與 HANDOFF 和使用者指示不一致 | 改為：本機 Claude Code 發版時直接打 tag 並推送 |
| 6 | Chrome 的 `version` 只接受數字，三處版本號難以一致 | 開發期間 manifest 用 `version: 3.0.0` 加 `version_name: 3.0.0-dev`，`VERSION` 寫 `3.0.0-dev`，發版時拿掉 `-dev` |
| 7 | SPEC 4.3 規定 origin 一律檢查 youtube.com，但 viewer iframe 是擴充功能 origin | 分兩種情況：chat ↔ top 檢查 youtube.com；top ↔ viewer 檢查擴充功能 origin；兩者都比對 `event.source` |
| 8 | 置頂、降落橫幅可能拿不到 YouTube 訊息 id | 改用 `type + 作者 + 內容 + timestampAbs` 的雜湊（前綴 `ytcas-`）去重 |
| 9 | 直播中 `videoOffsetSec` 沒有定義算法 | 由直播開始時間（`meta[itemprop="startDate"]`）推算，取不到時存 `null` |

### 3.3 v21 新增的權限
`host_permissions`（使用者已同意）：
- `https://www.youtube.com/*`（原有）
- `https://*.ggpht.com/*`
- `https://*.ytimg.com/*`
- `https://*.googleusercontent.com/*`
- `https://fonts.gstatic.com/*`
- `https://www.gstatic.com/*`

---

## 4. 任務完成情況

### T0 專案骨架（commit `8439208`）
| 產出 | 說明 |
|---|---|
| `manifest.json` | MV3，`3.0.0-dev`，權限依 v21 |
| `src/constants.js` | 上限數字、訊息類型、runtime 與 frame 訊息常數、機器人名單、圖片白名單檢查 |
| `src/selectors.js` | 所有 YouTube DOM 選擇器（top frame 與 chat frame），含 `warnOnce()` 降級警告 |
| `src/db.js`、`background.js`、`content.js`、`popup.*`、`viewer.*` | 空殼，待 T2 之後實作 |
| `src/styles/tokens.css` | token 骨架（字體、字級、間距、圓角、動態已填；顏色待 D2 定稿） |
| `src/styles/viewer.css`、`inject.css` | 空檔 |
| `src/icons/` | 自繪 SVG（藍綠漸層對話泡泡，不含 YouTube 標誌），用 headless Chrome 轉成 16/32/48/128 px PNG |

自動檢查結果：
- ✅ manifest 引用的檔案全部存在
- ✅ 所有 JS 通過語法檢查（`node --check`）
- ✅ 圖片白名單函式測試正確
- ⬜ **Chrome「載入未封裝項目」無錯誤：待使用者確認**

### T1 clip-path PoC（commit `1ea108e`）⏸
| 產出 | 說明 |
|---|---|
| `src/poc/clip-path-poc.js` | 只在 top frame 執行。左下角切換按鈕（Alt+Shift+P）。在原生聊天室正後方放置同尺寸的測試面板（z-index 10），原生聊天室移到上層（z-index 20）並套用 clip-path。可調整露出高度（40–240px），可切換裁切對象。T6 完成後移除。 |
| `docs/poc-clip-path.md` | 測試步驟、回報格式、結論欄 |

**與 SPEC 寫法不同的地方**：YouTube 的「隱藏聊天室」列位於 iframe 下方，同樣包在 `ytd-live-chat-frame` 內。如果照 SPEC 從整個元素底部算 84px，會有一部分被那一列佔掉。所以 PoC 改成**從 iframe 底邊往上露出 84px**，「隱藏聊天室」列一起露出（F-09 按鈕之後也會放在這一列）。

本機模擬頁面測試（Chrome 156.0.8078.75，非 YouTube）：
| 位置 | `elementFromPoint` 結果 | 判定 |
|---|---|---|
| 聊天室上半部（裁切區） | 測試面板 | ✅ 穿透 |
| 輸入框上方 100px（裁切區） | 測試面板 | ✅ 穿透 |
| iframe 底部 20px（露出區） | `iframe#chatframe` | ✅ 原生可互動 |
| 最底部 | 「隱藏聊天室」列 | ✅ 露出 |
| 面板與聊天室尺寸 | 寬高一致 | ✅ |

模擬頁面上「實際打字」的測試沒有完成，原因見第 6 節。

---

## 5. Commit 紀錄（已推送到 `origin/main`）
| SHA | 訊息 |
|---|---|
| `5a7b435` | docs(spec): 規格 v21：viewer 唯讀 DB、origin 檢查、圖片白名單與匯出內嵌 |
| `8439208` | chore: T0 專案骨架（manifest 3.0.0-dev、src 結構、選擇器與常數、圖示） |
| `1ea108e` | test(top-frame): T1 clip-path PoC 與測試步驟文件 |

同步更新了 `CHANGELOG.md`（新增「規格 v21」與「開發進度」段落）、`docs/test-checklist.md`（新增「開發任務關卡」表）、`VERSION`（`3.0.0-dev`）。

---

## 6. 問題與事件

### 6.1 Git push 失敗
- 錯誤訊息：`fatal: could not read Username for 'https://github.com': terminal prompts disabled`
- 原因：這台電腦的 Git Credential Manager 沒有登入過 GitHub，Claude Code 無法跳出互動式登入。
- 結果：✅ 已解決，使用者完成 GitHub 授權後全部推送成功。
- 當時的處理方式：使用者在自己的終端機執行一次以下指令，完成 GitHub 授權：
  ```bash
  git -C E:/Tool/ChromeExtensions/yt-chat-archiver-saver push origin main
  ```

### 6.2 內建瀏覽器誤輸入
- 用模擬頁面測試 PoC 時，內建瀏覽器的分頁切換成使用者正在進行的 GitHub 登入頁。
- 原本要給模擬頁的 **2 次點擊和輸入文字 `hello`，誤送到了 GitHub 登入頁**。
- 發現後立即停止操作那個分頁，沒有再做其他動作。當時頁面停在「Device verification」。
- 建議：如果登入欄位出現不明文字，請清除後重新輸入。

---

## 7. 待使用者處理
1. **授權 GitHub push**：見 6.1。
2. **T0 確認**：`chrome://extensions` → 停用舊版 v2.6.0 → 「載入未封裝項目」選 `E:\Tool\ChromeExtensions\yt-chat-archiver-saver` → 卡片上沒有紅色「錯誤」，版本顯示 `3.0.0-dev`。
3. **T1 實測**（完整步驟見 `docs/poc-clip-path.md`）：
   1. 開一個你能留言的直播，聊天室保持展開。
   2. 按左下角「PoC：開啟」。
   3. 底部是否只露出輸入框？如果不剛好，用滑桿調整並記下數字。
   4. 點上半部「測試列」：該列變綠、點擊數 +1。
   5. 在上半部滾動滑鼠：列表捲動、滾輪數增加。
   6. 底部原生輸入框可以打字。
   7. 切成 `iframe#chatframe` 模式重測；切換劇院模式；按「PoC：關閉」確認完全還原。

回報格式：
```
Chrome 版本：
露出 84px 是否剛好（不剛好時調整後的數字）：
點擊穿透：成功 / 失敗
滾輪穿透：成功 / 失敗
輸入框可打字：成功 / 失敗
iframe 模式：一樣 / 不同
劇院模式、關閉還原：
（失敗時附截圖，以及 Console 中 [ytcas-poc] 開頭的訊息）
```

---

## 8. 下一步
- T1 成功 → 確定方案 A，填寫 `docs/poc-clip-path.md` 結論 → 進入 **D1 設計稿**（`design/mockups.html`，方向 A/B × 淺色/深色）。
- T1 失敗 → 記錄失敗證據，改走方案 B（SPEC 6.6），並更新 SPEC。
