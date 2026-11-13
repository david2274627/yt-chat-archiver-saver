# 回報：審查修正（review-2026-11-13）完成，等待 T1 實測

| 項目 | 內容 |
|---|---|
| 日期 | 2026-11-14（作業於 2026-11-13 完成） |
| 依據 | `docs/review-2026-11-13.md` 第 4 節修正任務 4.1～4.6 |
| 規格版本 | v21 → **v22** |
| 套件版本 | `3.0.0-dev` |
| 目前關卡 | **T1 ⏸**：等待使用者在真實直播實測 clip-path PoC |
| GitHub | ✅ 全部已推送，`main` 與 `origin/main` 一致 |

---

## 1. 摘要
- 審查報告第 4 節的 6 項修正全部完成，每項一個 commit，並已 push。
- 規格升為 **v22**：clip 改從 iframe 底邊計算、新增 top frame 付款視窗偵測、新增 F-11（v2.6.0 舊資料遷移與 JSON 匯入）、v3 資料庫改名 `ytcas-v3`、縮小 `web_accessible_resources`。
- 依審查第 3.1 節，**在任何 Chrome 實測之前**完成了舊資料保護：文件加入第 0 步備份、禁止移除擴充功能項目、記錄舊資料庫結構。
- 使用者放在 repo 內的 IndexedDB 備份 `bak/` 已列入 `.gitignore`，確認沒有進入任何 commit。

---

## 2. 審查第 6 節回報格式
```
規格版本：v22（commit：88dc272；a3c66e8 補充 origin 檢查說明）
v2.6.0 舊資料庫：名稱 YTLiveChatArchiverDB_V6　版本 1　store：streams / messages / pinned_messages / channels（詳見 docs/legacy-v2.6.0-data.md）
4.1～4.6 各項 commit SHA：88dc272 / e960c82 / 2bd8f92 / a3c66e8 / 34aa959 / df2a4fd
已 push：是
T1 實測步驟：已更新於 docs/poc-clip-path.md（含第 0 步備份）
需要使用者做的事：見第 6 節
```

---

## 3. 完成項目

| # | 任務 | Commit | 內容 |
|---|---|---|---|
| 4.1 | 規格 v22 | `88dc272` | 6.2 收起狀態 clip 改為 `inset(${iframeBottom - frameTop - inputHeight}px 0 0 0)`；6.2 狀態表新增「top frame 付款視窗」列；6.3 新增 top frame 彈窗偵測；新增 F-11；4.1 改名 `ytcas-v3` 並禁止動舊資料庫；F-04 匯出加 `formatVersion`、新增匯入；第 7 節新增「網頁可存取資源」列；第 8 節 T1、T2、T7、T9 同步更新；CHANGELOG 新增 v22 段落 |
| 4.2 | 舊資料保護 | `e960c82` | `docs/poc-clip-path.md`、`docs/HANDOFF.md` 加入第 0 步備份與「絕對不要移除擴充功能項目」警告；新增 `docs/legacy-v2.6.0-data.md`；`constants.js`：`DB_NAME = 'ytcas-v3'`、`LEGACY_DB_NAME = 'YTLiveChatArchiverDB_V6'`；`.gitignore` 排除 `bak/` 與 `*.indexeddb.leveldb/`、`*.indexeddb.blob/` |
| 4.3 | PoC 補強 | `2bd8f92` | 下層可切換 div / 擴充功能 iframe（新增 `src/poc/poc-panel.html`、`poc-panel.js`，以 postMessage 回報點擊與滾輪）；新增「完全不裁切」切換；監看 top frame `ytd-popup-container` 與聊天室 iframe 內的可見彈窗；`selectors.js` 新增 `top.popupContainer`、`top.popups`；測試步驟與回報格式改版 |
| 4.4 | manifest | `a3c66e8` | `web_accessible_resources` 只留 `src/viewer.html`、`src/poc/poc-panel.html`，加上 `use_dynamic_url: true`；SPEC 4.3 補充 origin 檢查方式 |
| 4.5 | 文件整理 | `34aa959` | CHANGELOG 填入 v20 `704b91f`、v21 `5a7b435`、v22 `88dc272`、T0 `8439208`、T1 `1ea108e` 及各修正 SHA；`progress-report` 改為「已推送」並 commit；commit 審查報告 |
| 4.6 | 瀏覽器規則 | `df2a4fd` | CLAUDE.md 新增「瀏覽器」一節（只操作自己開的分頁、操作前確認網址、不碰登入／付款頁、能用頁面腳本就不用座標點擊、操作到錯誤分頁立即停止並回報），以及「資料保護」一節 |
| — | 報告規則 | 本報告所在的 commit | CLAUDE.md 新增「每輪作業完成後寫 `.md` 報告」規則；本報告 |

---

## 4. v2.6.0 舊資料庫重點
完整對照表見 `docs/legacy-v2.6.0-data.md`。

| 項目 | 內容 |
|---|---|
| 名稱 / 版本 | `YTLiveChatArchiverDB_V6` / `1` |
| `streams` | keyPath `videoId`；索引 `updatedAt` |
| `messages` | keyPath `id`；索引 `videoId`、`videoId_timestamp` |
| `pinned_messages` | keyPath `id`；索引 `videoId` |
| `channels` | keyPath `key` |
| 匯出 JSON | `{ videoId, streamMeta, pinnedMessages, messages[] }`，沒有 `formatVersion` |
| 擴充功能 ID | `bak/` 中只有 `ejdhefdjjjlajfilfijnanippgdcdeoi` 那份含此資料庫名稱，**推定**為原擴充功能 ID（待使用者核對） |

遷移時要注意的差異：
- 舊 `timestamp` 是擷取當下的時間，不是訊息的實際送出時間。
- 舊 `type` 存的是 YouTube 元件標籤名稱，需要對應轉換。
- 舊資料沒有 SC 顏色、貼圖網址、管理員或會員徽章。

由於 v2.6.0 與 v3 從同一路徑載入，**擴充功能 ID 相同**，v3 可以直接唯讀開啟舊資料庫完成自動遷移（T2 實作）。

---

## 5. 驗證結果

### 5.1 自動檢查（已通過）
| 項目 | 結果 |
|---|---|
| manifest 引用的檔案全部存在 | ✅ |
| `viewer.html`、`popup.html`、`poc-panel.html` 的 js/css 相對路徑都存在 | ✅ |
| 所有 JS 語法檢查（`node --check`） | ✅ |
| `bak/` 被 git 忽略，沒有進入任何 commit | ✅ |
| 本機模擬頁面（非 YouTube）PoC 測試：裁切時上半部點擊落到面板 | ✅ |
| 模擬頁：「完全不裁切」時上半部落到原生 iframe | ✅ |
| 模擬頁：假的 `tp-yt-paper-dialog` 放進 `ytd-popup-container` 後，控制盒顯示「頁面：tp-yt-paper-dialog#fakepay」；移除後「目前」恢復為 —、「最近一次」保留 | ✅ |
| 模擬頁：下層切成 iframe 後面板正常載入 | ✅ |
| 模擬頁：關閉後 clip、面板、控制盒、樣式全部移除 | ✅ |

模擬頁測試只用頁面腳本在我自己開的分頁上執行，沒有座標點擊或鍵盤輸入，符合新的瀏覽器規則。

### 5.2 待使用者實測（不可視為通過）
- T0：在 Chrome 中重新載入後卡片無錯誤、版本 `3.0.0-dev`
- T1：在真實直播中的點擊和滾輪穿透（div 與擴充功能 iframe 兩種下層）、輸入框打字、露出高度
- 不裁切時表符與 `$` 選單的展開情形
- 付款確認視窗開在聊天室還是頁面中央
- 劇院模式、關閉還原
- 擴充功能 iframe 在 `use_dynamic_url` 下能否載入，以及 postMessage 的來源檢查是否通過（模擬頁無法驗證）

---

## 6. 需要使用者做的事
1. **實測前備份**：依 `docs/poc-clip-path.md` 第 0 步備份 IndexedDB。`bak/` 已有一份，建議再另存一份到 repo 以外的位置，以免執行 `git clean -fdx` 之類的指令時被刪除。
2. **不要移除**原本的擴充功能項目，只能按 🔄 重新載入；也不要對同一路徑再按「載入未封裝項目」。
3. **核對擴充功能 ID** 是否為 `ejdhefdjjjlajfilfijnanippgdcdeoi`。
4. **檢查 GitHub 帳號安全**：GitHub → Settings → **Sessions** 與 **Security log**，確認沒有不明的登入或授權（前次內建瀏覽器誤輸入事件）。
5. **T1 實測**：依 `docs/poc-clip-path.md` 步驟 1～10 測試，並用文件最後的回報格式回報。

---

## 7. 問題、事件與偏離之處
- **4.6 的 SHA**：一個 commit 無法在自身內容寫入自己的 SHA，所以 CHANGELOG 中 `df2a4fd` 寫為「本段落所在的 commit」，實際 SHA 列在本報告。
- **PoC 控制項的位置**：控制項從面板內移到獨立的浮動控制盒。原因是勾選「完全不裁切」後，原生聊天室會蓋住整個面板，放在面板內就按不到。
- **v22 補充**：4.4 額外修改 SPEC 4.3。`use_dynamic_url` 下嵌入 iframe 的來源可能是動態 ID，所以 top frame 檢查來源時，同時接受 iframe `src` 本身的來源。
- **`top.popups` 是暫定清單**：最後一項 `ytd-popup-container > *` 會抓容器下所有可見的子元素。T1 實測取得實際的付款元件標籤名稱後，再收斂這份清單。
- 本輪沒有發生誤操作事件。

---

## 8. 下一步
- 使用者回報 T1 結果後：
  - 成功 → 在 `docs/poc-clip-path.md` 填寫結論（方案 A），依付款視窗位置補完 SPEC 6.2「top frame 付款視窗」列與 `top.popups` 清單 → 進入 **D1 設計稿**。
  - 失敗 → 記錄證據，改走方案 B（SPEC 6.6）並更新 SPEC。
- 更新 `docs/test-checklist.md` 中 T0、T1 各項的狀態。
