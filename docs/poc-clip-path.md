# T1：clip-path PoC 測試

> 目的：驗證 SPEC 第 6 節方案 A 的關鍵前提。對原生聊天室套 `clip-path` 後，被裁掉的上半部收到的點擊和滾輪，要穿透到下層的測試面板；底部露出的原生輸入框仍要能正常打字。
> 另外觀察：「完全不裁切」時原生彈窗的展開情形，以及 `$` 付款視窗開在聊天室內還是頁面中央。
> PoC 程式：`src/poc/clip-path-poc.js`（top frame）、`src/poc/poc-chat.js`（chat frame：量測、頂部列開關）、`src/poc/poc-panel.html/js`（擴充功能 iframe 下層）。T9 發版前全部移除。

## 狀態
- 第一次實測（2026-11-14）：**通過，F-10 定案方案 A**。結果見文末「結論」。
- v23 版 PoC：使用者已補測（2026-11-14 20:48，以 Alt+Shift+P 開啟），結果見下方「v23 補測結果」：付款視窗偵測成立；露出高度量測對象錯誤；劇院模式與窄版面不可用；開關在目前版面不出現。
- v24 版 PoC：使用者補測第 1 項（2026-11-15 03:27）時，自動量測 v2 算出 545px（實際應為 109px），面板只剩約 45px，且「展開 ▼」被擠掉，無法切換手動，補測中斷。原因是全高透明覆蓋層 `ytls-widget-overlay-manager` 被算進底部互動區（見 `docs/review-2026-11-15.md`）。
- v24.1 版 PoC：⬜ **待使用者補測**（見「補測（v24.1）」）。
- 模擬頁（非 YouTube）：**邏輯檢查通過；真實結構待實機**。v24.1 起模擬頁的聊天室內部結構依 `docs/youtube-dom-notes.md` 建構（含全高覆蓋層），量測 v3 得到 109px。依 SPEC 第 9 節（v25），模擬頁結果不可視為 ✅。

## 測試環境注意事項
- 使用者裝有 **Holodex+**（Console 會出現 `[Holodex+] live chat overrides injected`），它也會修改直播聊天室。**實測遇到錯位或樣式異常時，先停用 Holodex+ 重測一次**，以排除干擾。
- 目前 YouTube 版面：聊天室右上角有 `✕`（關閉聊天室），聊天室下方**沒有**「隱藏聊天室」列；聊天室關閉後，影片下方資訊區有「聊天室／加入對話…／開啟面板」卡片。

## PoC 行為（v24.1）
- **沒有任何浮在影片或頁面上的元素**（SPEC 10.1 原則 6）。
- **開關位置（多重錨點，SPEC F-09）**：
  1. 聊天室展開時：**聊天室頂部列**、`⋮` 左側的藍色「**PoC 測試**」。v24.1 修正：v24 誤插進「重點聊天室訊息 ▾」選單內，現在插在 `⋮`（`#live-chat-header-context-menu`）正前方。
  2. PoC 開啟後：**測試面板頂部列最左邊**依序是「展開 ▼」「不裁切」「複製診斷」與紅色「**關閉 PoC**」，後面才是狀態文字。狀態列固定單列，文字過長時以「…」截斷，按鈕不會被擠掉。
  3. 聊天室用 `✕` 關閉後：影片下方「聊天室」卡片中，「開啟面板」右側的「**PoC 測試**」。點擊會先展開聊天室，再開啟測試面板。聊天室展開時這顆按鈕仍可用（原生「開啟面板」會變灰，屬正常）。
  4. 舊版面（有「隱藏聊天室」列）：該列右側。v24.1 起只有在該列**看得見**時才掛上（實機上該元素可能以隱藏狀態殘留）。
  5. 備援：快速鍵 **Alt+Shift+P**。以上位置都找不到時，Console 會出現 `[ytcas-poc] 找不到開關錨點`。
- 開啟後：
  - 測試面板插入 `ytd-live-chat-frame` 內、`iframe#chatframe` 的正後方（z-index 10），跟著聊天室一起被 YouTube 搬移，不計算座標。
  - `clip-path` 直接套在 `iframe#chatframe`（z-index 20）。
  - 「不裁切」（Alt+Shift+U）切換「完全不裁切」。不裁切時原生聊天室會蓋住面板，用快速鍵切回即可。
  - 面板頂部狀態列：目前露出高度與來源（自動／自動・後備／手動）、快速鍵提示（自動時顯示「Alt+Shift+M 手動」）、點擊／滾輪次數、最後點擊。按「展開 ▼」可看到：
    - **露出模式**：自動（預設，**量測 v3**）／手動（滑桿，上限 = iframe 高度）
      - 量測 v3 = iframe 高度 − 下列元素中最高者的頂端：置頂列 `yt-live-chat-banner-manager`、`#panel-pages`、`#input-panel`，以及覆蓋層 `ytls-widget-overlay-manager` 的**可見子元素**（例如投票卡；覆蓋層本身不計）。
      - **合理性檢查**：v3 超過 iframe 高度的 60%，或面板可見高度不到 160px → 判為可疑，改用後備算法（`#input-panel` 頂端到 iframe 底邊），狀態列顯示「（自動・後備）」。
    - **量測**：v3 數值、後備算法數值、iframe 高度、目前採用哪一個與可疑原因
    - **底部互動區**：所有候選元素，格式 `標籤#id@頂端+高度［處理方式］`，處理方式為「計入：白名單…」「計入：覆蓋層子元素」「排除：…」「未列入」
    - **輸入區子元素**（只有標籤名稱和高度，不含文字）
    - **版面**：`ytd-live-chat-frame` 的父元素與屬性、frame／iframe／面板位置、目前 clip、摺疊保護是否觸發
    - **開關錨點**：頂部列／影片下方卡片／舊版列各自是否掛上，以及頂部列的元素結構（只有標籤與 id）
    - **下層類型**：`div`（藍色）／擴充功能 iframe（橘色）
    - **目前可見彈窗／最近一次可見彈窗**：「頁面」（明確選擇器：`#buyFlowDivId` 等）、「頁面浮層」（輔助掃描的大型 `position:fixed` 元素）、「聊天室」（iframe 內）
- **摺疊保護**：聊天室 iframe 高度 < 200px，或露出值 ≥ iframe 高度時，PoC 自動解除裁切、隱藏測試面板，原生聊天室完全不受影響；頂部列按鈕顯示「**PoC 暫停（聊天室摺疊）**」。高度恢復後自動重啟。暫停時面板看不到，請用 **Alt+Shift+D** 複製診斷。
- **複製診斷**（按鈕或 Alt+Shift+D）：把版面、量測、底部互動區、開關錨點、彈窗狀態複製到剪貼簿（只有標籤、id、位置與尺寸，**不含任何文字**）。複製失敗時會改印在 Console（`[ytcas-poc] 複製失敗…`）。
- 用 `✕` 關閉聊天室時，PoC 會自動關閉並還原。

### 快速鍵（v24.1）
焦點在頁面或聊天室內（包括輸入框）都可以用，不依賴畫面上的按鈕：

| 快速鍵 | 作用 |
|---|---|
| Alt+Shift+P | 開關 PoC |
| Alt+Shift+U | 不裁切／恢復裁切 |
| Alt+Shift+D | 複製診斷（摺疊暫停、面板看不到時也能用） |
| Alt+Shift+M | 自動／手動切換（切到手動時，從目前實際露出值開始） |
| Alt+Shift+↑／↓ | 手動露出值 +8／−8px（自動模式下按會先切到手動） |
| Ctrl+Alt+Shift+↑／↓ | 手動露出值 +32／−32px |

## 測試前準備

> ⚠️ **絕對不要移除原本的擴充功能項目**：移除會連同 v2.6.0 的 IndexedDB 舊資料一起永久刪除。只能在該項目上按 🔄 重新載入。也**不要**對同一路徑再按「載入未封裝項目」。

0. **資料備份**：已於 2026-11-14 完成（`E:\Tool\ChromeExtensions\indexeddb_bak`，repo 外）。之後若要再備份：完全關閉 Chrome → 複製 `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_<ID>_0.indexeddb.leveldb`（與同名 `.indexeddb.blob`）到 repo 以外的位置。
1. `chrome://extensions` → 在**原本的擴充功能項目**上按 🔄 重新載入。擴充功能 ID 已核對為 `ejdhefdjjjlajfilfijnanippgdcdeoi`，不需再測。
2. 開一個**你能留言的直播**，重新整理頁面。

## 補測（v24.1）

> 步驟依 `docs/review-2026-11-15.md` 第 5 節。「複製診斷」與附錄腳本的結果只含標籤、id、屬性名、位置與尺寸，可以直接貼回。
> F-12（自動切換「即時聊天室」）尚未實作（規格 v25 已寫入，實作在 T5）。PoC 不會自動切換，所以步驟 3a 只需觀察記錄。

### 步驟
0. `chrome://extensions` → 在原本的項目上按 🔄 重新載入（**不要移除**）→ 重新整理直播頁。
1. **一般直播（有置頂訊息列）**：
   1. 聊天室**頂部列**的 `⋮` 左邊出現「PoC 測試」（不應再出現在「重點聊天室訊息 ▾」裡面）→ 點擊開啟 PoC。
   2. 自動露出值應約 **109～114px**，置頂列與輸入列完整露出（狀態列顯示「露出 ＿＿px（自動）」）。
   3. 若不對：按 **Alt+Shift+M** 切手動，用 **Alt+Shift+↑／↓** 調到剛好 → 記下數字。
   4. 按 **Alt+Shift+D**（或面板的「複製診斷」）把結果貼回。
3. **有投票卡的直播**（步驟編號沿用審查報告，沒有第 2 步）：投票卡是否完整露出、可以投票？按 **Alt+Shift+D** 貼回（用來取得投票卡的實際標籤）。
   - 3a. 記錄聊天室頂部列目前顯示「重點聊天室訊息」還是「即時聊天室」（F-12 實作前的基準）。
   - 3b. **VOD 重播頁**（有聊天重播的影片）：F12 → Console 左上角 frame 選單選聊天室的 iframe（名稱含 `live_chat_replay`）→ 執行**附錄 C** 的 chat frame 結構腳本並貼回。
4. **開關位置**：頂部列是否出現「PoC 測試」（步驟 1 已確認）；按「關閉 PoC」→ 用 `✕` 關閉聊天室 → 影片下方卡片是否出現「PoC 測試」→ 點擊後是否展開聊天室並開啟 PoC。
5. **劇院模式與窄版面**：按 `t` 切劇院模式，以及把視窗拉窄到右側欄移到影片下方：
   - 頂部列按鈕是否顯示「PoC 暫停（聊天室摺疊）」、原生聊天室是否完全正常？
   - 按 **Alt+Shift+D** 貼回；切回後 PoC 是否自動恢復？
   - 註：實機筆記顯示單欄版面聊天室仍是全高（596px），預期**不會**暫停，而是正常裁切。
6. **付款視窗**：按「不裁切」→ `$` → 超級留言 → 走到「完成購買程序」視窗出現（**不要付款**）。面板「目前可見彈窗」應顯示「頁面：div#buyFlowDivId」；關閉後消失。取消流程後按「恢復裁切」。**不附含付款資訊的截圖。**
7. **不遮擋（每輪固定檢查）**：影片與頁面主體上沒有任何 PoC 元素。
8. 有異常時停用 Holodex+ 重測一次。

### 補測回報格式
```
Holodex+：啟用 / 停用
步驟 1 頂部列「PoC 測試」在 ⋮ 左邊 是 / 否；自動露出＿＿px（自動／自動・後備）；剛好 是 / 否；手動調整後＿＿px；Alt+Shift+D：（貼上）
步驟 3 投票卡完整露出、可投票 是 / 否；Alt+Shift+D：（貼上）
步驟 3a 頂部列顯示：重點聊天室訊息 / 即時聊天室
步驟 3b VOD chat frame 結構：（貼上附錄 C 結果）
步驟 4 卡片出現「PoC 測試」是 / 否；點擊後聊天室展開且 PoC 開啟 是 / 否
步驟 5 劇院模式：出現「PoC 暫停」是 / 否；原生聊天室正常 是 / 否；切回後恢復 是 / 否；Alt+Shift+D：（貼上）
步驟 5 窄版面：行為＿＿；Alt+Shift+D：（貼上）
步驟 6 付款視窗時顯示：＿＿；關閉後消失 是 / 否
步驟 7 影片與頁面主體上沒有 PoC 元素：是 / 否
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

## 附錄 C：chat frame 結構腳本（VOD 重播頁或 YouTube 改版時使用）
F12 → Console 左上角 frame 選單選**聊天室的 iframe**（名稱含 `live_chat` 或 `live_chat_replay`）→ 貼上並按 Enter。
- 只輸出標籤、id、屬性名（含少數屬性值，如 `author-type`）與尺寸，**不輸出任何訊息文字**。
- 長度超過 24 字元的 id（YouTube 訊息 id）會以 `<訊息id>` 取代。
- chat frame 內的 `copy()` 可能被覆蓋，所以結果會先印在 Console，再嘗試複製；複製失敗時請在 Console 輸出上按右鍵複製。
```js
(() => {
  const tid = (e) => e.tagName.toLowerCase() + (e.id ? '#' + (e.id.length > 24 ? '<訊息id>' : e.id) : '');
  const attrs = (e) => e ? [...e.attributes].filter((a) => !['style', 'class', 'id'].includes(a.name))
    .map((a) => (['author-type', 'hidden', 'collapsed', 'aria-selected'].includes(a.name) && a.value ? a.name + '=' + a.value : a.name)) : null;
  const rect = (e) => { const r = e.getBoundingClientRect(); return [r.top, r.height].map(Math.round).join('+'); };
  const R = document.querySelector('yt-live-chat-renderer');
  const kinds = {};
  for (const t of ['yt-live-chat-text-message-renderer', 'yt-live-chat-paid-message-renderer', 'yt-live-chat-paid-sticker-renderer',
    'yt-live-chat-membership-item-renderer', 'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer',
    'yt-live-chat-viewer-engagement-message-renderer', 'yt-live-chat-banner-renderer', 'yt-live-chat-banner-redirect-renderer',
    'yt-live-chat-poll-renderer', 'yt-live-chat-ticker-renderer', 'yt-live-chat-header-renderer']) {
    const e = document.querySelector(t);
    kinds[t] = e ? { attrs: attrs(e), ids: [...e.querySelectorAll('[id]')].slice(0, 30).map(tid) } : null;
  }
  const items = document.querySelector('#item-list #items');
  const unknown = items ? [...new Set([...items.children].map((c) => c.tagName.toLowerCase()))] : [];
  const zone = ['yt-live-chat-banner-manager', '#panel-pages', '#input-panel', 'ytls-widget-overlay-manager']
    .map((s) => { const e = document.querySelector(s); return s + ': ' + (e ? rect(e) : '無'); });
  const overlay = document.querySelector('ytls-widget-overlay-manager');
  const out = {
    page: location.pathname, vh: innerHeight, rendererAttrs: attrs(R),
    itemTags: unknown, zone,
    overlayKids: overlay ? [...overlay.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0).slice(0, 20).map((e) => tid(e) + '@' + rect(e)) : null,
    inputPanel: !!document.querySelector('#input-panel'),
    timestamp: (() => { const t = document.querySelector('#items #timestamp'); return t ? { textLength: t.textContent.trim().length, cssVisible: getComputedStyle(t).display !== 'none' } : null; })(),
    viewMenu: [...document.querySelectorAll('#live-chat-view-selector-sub-menu tp-yt-paper-listbox#menu > a')].map((a) => 'a aria-selected=' + a.getAttribute('aria-selected')),
    kinds,
  };
  const s = JSON.stringify(out, null, 1);
  console.log(s);
  try { copy(s); } catch (_) { /* copy 被覆蓋時略過 */ }
  return '完成：結果已印在上方（可能也已複製到剪貼簿）';
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
