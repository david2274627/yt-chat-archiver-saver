# T1：clip-path PoC 測試

> 目的：驗證 SPEC 第 6 節方案 A 的關鍵前提。對原生聊天室套 `clip-path` 後，被裁掉的上半部收到的點擊和滾輪，要穿透到下層的測試面板；底部露出的原生輸入框仍要能正常打字。
> 另外觀察：「完全不裁切」時原生彈窗的展開情形，以及 `$` 付款視窗開在聊天室內還是頁面中央。
> PoC 程式：`src/poc/clip-path-poc.js`（top frame）、`src/poc/poc-chat.js`（chat frame：量測、頂部列開關）、`src/poc/poc-panel.html/js`（擴充功能 iframe 下層）。T9 發版前全部移除。

## 狀態
- 第一次實測（2026-11-14）：**通過，F-10 定案方案 A**。結果見文末「結論」。
- v23 版 PoC：使用者已補測（2026-11-14 20:48，以 Alt+Shift+P 開啟），結果見下方「v23 補測結果」：付款視窗偵測成立；露出高度量測對象錯誤；劇院模式與窄版面不可用；開關在目前版面不出現。
- v24 版 PoC：⬜ **待使用者補測**（見「補測（v24）」）。
- 模擬頁面（非 YouTube）自動檢查（v24 版）：✅ 目前版面（頂部列有 `✕`、無「隱藏聊天室」列、影片下方有「聊天室／開啟面板」卡片）與舊版面兩種模擬頁都通過，細節見 `docs/reports/` 本輪報告。

## 測試環境注意事項
- 使用者裝有 **Holodex+**（Console 會出現 `[Holodex+] live chat overrides injected`），它也會修改直播聊天室。**實測遇到錯位或樣式異常時，先停用 Holodex+ 重測一次**，以排除干擾。
- 目前 YouTube 版面：聊天室右上角有 `✕`（關閉聊天室），聊天室下方**沒有**「隱藏聊天室」列；聊天室關閉後，影片下方資訊區有「聊天室／加入對話…／開啟面板」卡片。

## PoC 行為（v24）
- **沒有任何浮在影片或頁面上的元素**（SPEC 10.1 原則 6）。
- **開關位置（多重錨點，SPEC F-09）**：
  1. 聊天室展開時：**聊天室頂部列**、`⋮` 左側的藍色「**PoC 測試**」。
  2. PoC 開啟後：**測試面板頂部列**右側有「不裁切」「展開 ▼」與紅色「**關閉 PoC**」（原生頂部列此時被裁掉）。
  3. 聊天室用 `✕` 關閉後：影片下方「聊天室」卡片中，「開啟面板」右側的「**PoC 測試**」。點擊會先展開聊天室，再開啟測試面板。聊天室展開時這顆按鈕仍可用（原生「開啟面板」會變灰，屬正常）。
  4. 舊版面（有「隱藏聊天室」列）：該列右側。
  5. 備援：快速鍵 **Alt+Shift+P**。以上位置都找不到時，Console 會出現 `[ytcas-poc] 找不到開關錨點`。
- 開啟後：
  - 測試面板插入 `ytd-live-chat-frame` 內、`iframe#chatframe` 的正後方（z-index 10），跟著聊天室一起被 YouTube 搬移，不計算座標。
  - `clip-path` 直接套在 `iframe#chatframe`（z-index 20）。
  - 「不裁切」（Alt+Shift+U）切換「完全不裁切」。不裁切時原生聊天室會蓋住面板，用快速鍵切回即可。
  - 面板頂部狀態列：點擊／滾輪次數、最後點擊、目前露出高度，以及「不裁切」「**複製診斷**」「展開 ▼」「關閉 PoC」。按「展開 ▼」可看到：
    - **露出模式**：自動（預設，**量測 v2**：iframe 底邊 − 最高的底部互動區元素頂端）／手動（滑桿，上限 = iframe 高度）
    - **量測**：v2 數值、舊算法（`#input-panel`）數值、iframe 高度
    - **底部互動區**：iframe 底部 400px 內的可見元素（排除訊息列表與頂部列），格式 `標籤#id@頂端+高度`
    - **輸入區子元素**（只有標籤名稱和高度，不含文字）
    - **版面**：`ytd-live-chat-frame` 的父元素與屬性、frame／iframe／面板位置、目前 clip、摺疊保護是否觸發
    - **開關錨點**：頂部列／影片下方卡片／舊版列各自是否掛上，以及頂部列的元素結構（只有標籤與 id）
    - **下層類型**：`div`（藍色）／擴充功能 iframe（橘色）
    - **目前可見彈窗／最近一次可見彈窗**：「頁面」（明確選擇器：`#buyFlowDivId` 等）、「頁面浮層」（輔助掃描的大型 `position:fixed` 元素）、「聊天室」（iframe 內）
- **摺疊保護**：聊天室 iframe 高度 < 200px，或露出值 ≥ iframe 高度時，PoC 自動解除裁切、隱藏測試面板，原生聊天室完全不受影響；頂部列按鈕顯示「**PoC 暫停（聊天室摺疊）**」。高度恢復後自動重啟。暫停時面板看不到，請用 **Alt+Shift+D** 複製診斷。
- **複製診斷**（按鈕或 Alt+Shift+D）：把版面、量測、底部互動區、開關錨點、彈窗狀態複製到剪貼簿（只有標籤、id、位置與尺寸，**不含任何文字**）。複製失敗時會改印在 Console（`[ytcas-poc] 複製失敗…`）。
- 用 `✕` 關閉聊天室時，PoC 會自動關閉並還原。

## 測試前準備

> ⚠️ **絕對不要移除原本的擴充功能項目**：移除會連同 v2.6.0 的 IndexedDB 舊資料一起永久刪除。只能在該項目上按 🔄 重新載入。也**不要**對同一路徑再按「載入未封裝項目」。

0. **資料備份**：已於 2026-11-14 完成（`E:\Tool\ChromeExtensions\indexeddb_bak`，repo 外）。之後若要再備份：完全關閉 Chrome → 複製 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_<ID>_0.indexeddb.leveldb`（與同名 `.indexeddb.blob`）到 repo 以外的位置。
1. `chrome://extensions` → 在**原本的擴充功能項目**上按 🔄 重新載入。擴充功能 ID 已核對為 `ejdhefdjjjlajfilfijnanippgdcdeoi`，不需再測。
2. 開一個**你能留言的直播**，重新整理頁面。

## 補測（v24）

> 步驟依 `docs/review-2026-11-14-3.md` 第 5 節，並併入 `docs/review-2026-11-14-2.md` 第 5 節的開關與付款視窗項目。「複製診斷」的結果只含標籤、id、位置與尺寸，可以直接貼回。

### 步驟
1. **一般直播（有置頂訊息列）**：
   1. 聊天室展開時，聊天室**頂部列**（`⋮` 左側）出現「PoC 測試」→ 點擊，出現測試面板。
   2. 底部露出的範圍是否**剛好**是「置頂訊息列＋輸入列」（不切到、也不多露訊息）？
   3. 按面板頂部「**複製診斷**」，把結果貼回（內含底部互動區清單與量測 v2）。
2. **有投票卡的直播**：同步驟 1-2、1-3（投票卡是否完整露出、可以投票）。
3. **劇院模式**：按 `t` 切換劇院模式。
   1. 觀察：是否出現頂部列按鈕顯示「PoC 暫停（聊天室摺疊）」？原生聊天室是否**完全正常**（看得到訊息、可以打字）？
   2. 在劇院模式下按 **Alt+Shift+D**，把版面診斷貼回。
   3. 再按 `t` 切回，PoC 是否自動恢復？來回切換共 3 次。
4. **窄版面**：把視窗拉窄到右側欄移到影片下方，同步驟 3（觀察、Alt+Shift+D 貼回、拉回後是否恢復）。
5. **開關位置**：
   1. 聊天室展開時：頂部列有「PoC 測試」（步驟 1 已確認）。
   2. 按「關閉 PoC」→ 用聊天室右上角 `✕` 關閉聊天室 → 影片下方「聊天室」卡片的「開啟面板」右側出現「PoC 測試」→ 點擊後聊天室展開且測試面板出現。
6. **付款視窗**：按「不裁切」→ `$` → 超級留言 → 走到「完成購買程序」視窗出現（**不要付款**）。面板「目前可見彈窗」應顯示「頁面：div#buyFlowDivId」（另可能有「頁面遮罩：div」）；關閉後消失。取消流程後按「恢復裁切」。
7. **不遮擋（每輪固定檢查）**：開啟 PoC 前後，影片、標題、說明、留言區上**沒有任何** PoC 元素。
8. 若有異常，停用 Holodex+ 後重測一次。

### 補測回報格式
```
Holodex+：啟用 / 停用
步驟 1 一般直播：頂部列有「PoC 測試」是 / 否；露出剛好 是 / 否（多露／切到哪裡）；複製診斷：（貼上）
步驟 2 投票卡：投票卡完整露出、可投票 是 / 否；複製診斷：（貼上）
步驟 3 劇院模式：出現「PoC 暫停」是 / 否；原生聊天室完全正常 是 / 否；切回後自動恢復 是 / 否；Alt+Shift+D 診斷：（貼上）
步驟 4 窄版面：出現「PoC 暫停」是 / 否；原生聊天室完全正常 是 / 否；拉回後自動恢復 是 / 否；Alt+Shift+D 診斷：（貼上）
步驟 5 卡片出現「PoC 測試」是 / 否；點擊後聊天室展開且面板出現 是 / 否
步驟 6 付款視窗時顯示：＿＿；關閉後消失 是 / 否
步驟 7 影片與頁面主體上沒有 PoC 元素：是 / 否
開關都找不到時：Console 中 [ytcas-poc] 開頭的訊息，以及附錄 B 的結構診斷結果
（失敗時附截圖；截圖請避開付款資訊）
```

## 附錄 A：付款視窗診斷指令（YouTube 改版時重跑）
付款視窗**開著時**，F12 → Console，左上角 frame 選單選「**top**」，貼上並按 Enter（第一次貼上時 Chrome 可能要求先輸入 `allow pasting`）。只輸出元素標籤、id、class、位置、父元素路徑與 iframe 網域，**不讀取任何文字或付款資訊**；結果會複製到剪貼簿。
```js
(() => {
  const vp = innerWidth * innerHeight, out = [];
  const host = (u) => { try { return new URL(u, location.href).host; } catch { return '(無)'; } };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < vp * 0.05) continue;
    const z = parseInt(cs.zIndex, 10) || 0;
    if (cs.position === 'absolute' && z < 100) continue;
    const path = [];
    for (let p = el, i = 0; p && p !== document.body && i < 5; p = p.parentElement, i++)
      path.unshift(p.tagName.toLowerCase() + (p.id ? '#' + p.id : ''));
    out.push({
      tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className).slice(0, 80),
      pos: cs.position, z: cs.zIndex, rect: [r.left, r.top, r.width, r.height].map(Math.round).join(','),
      path: path.join(' > '),
      iframes: (el.tagName === 'IFRAME' ? [el] : [...el.querySelectorAll('iframe')]).map((f) => host(f.src)).join(' '),
    });
  }
  console.table(out);
  copy(JSON.stringify(out, null, 1));
  return `找到 ${out.length} 個元素，已複製到剪貼簿`;
})();
```
**已知結果（v24 定案，2026-11-14）**：`body > div#buyFlowDivId > div#:0.contentEl > iframe#buyFlowDivIdIframe`，iframe 網域 `payments.youtube.com`，600×480，不在 `ytd-app`、也不在 `ytd-popup-container` 內。

v23 補測時（付款視窗開啟中、top frame）診斷指令的完整輸出：
```json
[
 { "tag":"div", "id":"", "cls":"modal-dialog-bg b3-modal-dialog b3-modal-dialog-quantum",
   "pos":"absolute", "z":"1999999999", "rect":"0,0,1554,3770", "path":"div", "iframes":"" },
 { "tag":"div", "id":"buyFlowDivId", "cls":"modal-dialog b3-modal-dialog b3-modal-dialog-quantum",
   "pos":"fixed", "z":"2000000000", "rect":"477,127,600,642", "path":"div#buyFlowDivId",
   "iframes":"payments.youtube.com" }
]
```
兩者都是 `body` 的直接子元素：`#buyFlowDivId` 是對話框（`position:fixed`，600×642），`.modal-dialog-bg` 是全頁遮罩（`position:absolute`）。

## 附錄 B：卡片／頂部列結構診斷指令（開關找不到時使用）
**B-1 影片下方卡片**（frame 選單選「top」）：列出 `#teaser-carousel` 內每張卡片的結構；只輸出標籤、id、是否有按鈕／圖示、按鈕是否停用與**按鈕標籤**（YouTube 介面字串，例如「開啟面板」），不輸出卡片內其他文字。
```js
(() => {
  const out = [...document.querySelectorAll('ytd-watch-metadata #teaser-carousel yt-text-carousel-item-view-model')].map((item, i) => {
    const card = item.closest('yt-carousel-item-view-model') || item;
    const btn = item.querySelector('button-view-model button');
    return { i, buttonHost: !!item.querySelector('button-view-model'), button: !!btn,
      label: btn ? btn.textContent.trim().slice(0, 20) : '', disabled: !!btn?.disabled,
      icon: !!card.querySelector('yt-icon, svg'), ytcas: !!document.getElementById('ytcas-poc-teaser-btn') };
  });
  const tc = document.querySelector('#teaser-carousel');
  console.table(out);
  copy(JSON.stringify({ teaserCarousel: !!tc, metadata: !!document.querySelector('ytd-watch-metadata'), cards: out }, null, 1));
  return `卡片 ${out.length} 張，已複製到剪貼簿`;
})();
```
**B-2 聊天室頂部列**（frame 選單選聊天室的 iframe，名稱通常含 `live_chat`）：只輸出頂部列前兩層元素的標籤與 id。
```js
(() => {
  const h = document.querySelector('yt-live-chat-header-renderer');
  const out = h ? [...h.querySelectorAll(':scope > *, :scope > * > *')].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) : ['找不到 yt-live-chat-header-renderer'];
  copy(JSON.stringify(out));
  return out.join(' ');
})();
```

## 歷史：第一次實測步驟（2026-11-14，v22 版 PoC）
> 當時的左下角控制盒已移除（違反 10.1 原則 6），步驟僅保留紀錄：開啟 PoC → 確認露出 84px → 點擊／滾輪穿透（div 與擴充功能 iframe 下層）→ 輸入框可打字 → 完全不裁切時表符、`$`、付款視窗位置 → 裁切對象改為 `iframe#chatframe` 比較 → 劇院模式 → 關閉還原。

## 歷史：補測（v23）
> v23 的開關掛在「隱藏聊天室」列，目前版面沒有該列，使用者以 Alt+Shift+P 開啟完成補測。步驟為：ID 核對、不遮擋、自動量測（一般／58px 狀態）、劇院模式 ×3、窄版面、付款視窗診斷、關閉還原。

### v23 補測結果（2026-11-14 20:48，6 張截圖；含付款資訊的截圖不加入 repo）
| 步驟 | 結果 | 判定 |
|---|---|---|
| 擴充功能 ID | `ejdhefdjjjlajfilfijnanippgdcdeoi` | ✅ 與推定一致 |
| 1 影片與頁面主體無 PoC 元素 | 使用者確認沒有（2026-11-15 再次確認） | ✅ |
| 3-1 一般狀態 | 量測 `#input-panel` 高 56px、頂端距 iframe 底 56px；但手動調到 **114px** 才剛好：輸入列上方還有一條原生**置頂訊息列** | ❌ 量測對象錯誤 → v24 改為底部互動區（量測 v2） |
| 3-2 另一種狀態 | 有**投票卡**時，滑桿最大 240px 仍不夠 | ❌ 同上，且滑桿上限不足 → v24 上限改為 iframe 高度 |
| 4 劇院模式 ×3 | 面板與聊天室重疊但無法使用：只剩面板頂部狀態列，下方露出原生訊息；原生聊天室本身約只有 150px 高 | ❌ → v24 新增摺疊保護與版面診斷 |
| 5 視窗縮放（窄版面） | 面板有跟著聊天室，但同樣只剩狀態列 | ❌ 同上 |
| 6 付款視窗偵測 | PoC 顯示「頁面浮層：div#buyFlowDivId（top 88px）」；診斷指令結果見附錄 A | ✅ |
| 7 關閉還原／PoC 按鈕 | 找不到 PoC 按鈕 | 預期中：v23 錨點已失效 → v24 多重錨點 |
| 快速鍵 Alt+Shift+P | 可開啟 | ✅ 備援有效 |

**58px／84px／114px 的原因（已釐清）**：差異來自輸入列上方是否有置頂訊息列（以及投票卡等其他底部元素），不是 `#input-panel` 本身的變化。只量 `#input-panel` 不夠，SPEC 6.3（v24）改為量測整個底部互動區（`bottomZoneHeight`）。

## 結論（2026-11-14，第一次實測）

**判定：方案 A 的關鍵前提全部成立 → F-10 定案採方案 A。** 關鍵前提指：裁切區可穿透、露出區可互動、不裁切時原生彈窗正常、下層為擴充功能 iframe 時同樣成立。

| 項目 | 結果 |
|---|---|
| Chrome 版本 | 157.0.8103.51（正式版本，64 位元，Stable） |
| 第 0 步備份 | ✅ 已完成，位於 `E:\Tool\ChromeExtensions\indexeddb_bak`（repo 外） |
| 擴充功能 ID | ✅ `ejdhefdjjjlajfilfijnanippgdcdeoi`（v23 補測核對，與推定一致） |
| T0 卡片無錯誤、版本 `3.0.0-dev` | ✅ |
| 步驟 2 露出高度 | 一般情況 84px 可以；**某些直播狀態只需約 58px**（58px 時剛好只露出「聊天...」輸入列） |
| 步驟 3 點擊穿透（div） | ✅ |
| 步驟 4 滾輪穿透（div） | ✅ |
| 步驟 5 輸入框可打字 | ✅ |
| 步驟 6 擴充功能 iframe 下層：點擊 / 滾輪 / 顯示 | ✅ / ✅ / ✅ |
| 步驟 7-1 不裁切時表符選單 | ✅ 正常（偵測到 `聊天室：yt-emoji-picker-renderer#emoji`，top 404px） |
| 步驟 7-2 不裁切時 `$` 選單 | ✅ 正常 |
| 步驟 7-3 付款確認視窗位置 | **頁面中央**，標題「完成購買程序」。當時只偵測到 `聊天室：yt-live-chat-message-buy-flow-renderer`（top 296px）→ 該視窗不在 `ytd-popup-container` 內（v24 定案為 `#buyFlowDivId`，見附錄 A） |
| 步驟 8 `iframe#chatframe` 裁切 | ✅ 與裁 `ytd-live-chat-frame` 效果相同 → v23 起 clip 改套在 iframe |
| 步驟 9 劇院模式 | ❌ 面板與聊天室錯位 → v23 改為錨定在聊天室內部 |
| 步驟 10 關閉還原 | ✅ |

> 截圖含付款資訊，**不加入 repo**；本文件只記錄元素標籤與位置。
