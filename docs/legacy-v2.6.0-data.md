# v2.6.0 舊資料結構記錄（F-11 遷移依據）

> 來源：`E:\Tool\ChromeExtensions\yt-chat-archiver-saver_v2.6.0_backup` 的 `db.js`、`content.js`、`background.js`、`viewer.js`（以唯讀方式讀取，未修改任何檔案）。記錄日期：2026-11-13。

## 1. 資料庫位置與重要觀念
- 未封裝擴充功能的 ID 由**資料夾路徑**決定。v2.6.0 與 v3 都從 `E:\Tool\ChromeExtensions\yt-chat-archiver-saver` 載入，所以 **ID 相同、origin 相同**。舊資料庫就放在 v3 可以直接開啟的位置，這是 F-11 自動遷移得以成立的前提。
- 使用者備份（`bak/`，已列入 `.gitignore`，**禁止 commit**）中，`chrome-extension_ejdhefdjjjlajfilfijnanippgdcdeoi_0.indexeddb.leveldb` 含有 `YTLiveChatArchiverDB_V6` 字串，推定為 v2.6.0 的擴充功能 ID。請使用者在 `chrome://extensions` 核對。
- **移除擴充功能項目會連同 IndexedDB 一起刪除**。只能按 🔄 重新載入，不能移除，也不要對同一路徑再按「載入未封裝項目」。

## 2. 資料庫
| 項目 | 值 |
|---|---|
| 名稱 | `YTLiveChatArchiverDB_V6` |
| 版本 | `1` |
| v3 名稱 | `ytcas-v3`（不同名稱，互不影響） |

v3 開啟舊資料庫時**不得指定版本號**（`indexedDB.open('YTLiveChatArchiverDB_V6')`）。如果觸發 `onupgradeneeded`，代表舊庫不存在，必須 `abort()`，以免建立一個空的舊庫。

## 3. Object stores

### 3.1 `streams`（keyPath `videoId`；索引 `updatedAt`）
| 欄位 | 型別 | 說明 | → v3 `streams` |
|---|---|---|---|
| `videoId` | string | | `videoId` |
| `title` | string? | | `title` |
| `channelName` | string? | | `channelName` |
| `streamStartEpochMs` | number? | 直播開始時間 | `startedAt` |
| `lastMessageTime` | number? | 最後收到訊息的時間 | `lastMessageAt` |
| `createdAt` | number | 首次寫入 | `startedAt` 缺值時的備援 |
| `updatedAt` | number | | — |
| （無） | | | `channelUrl`：空；`isLive`：`false`；`messageCount`：遷移後重新計算 |

### 3.2 `messages`（keyPath `id`；索引 `videoId`、`videoId_timestamp` = `[videoId, timestamp]`）
| 欄位 | 型別 | 說明 | → v3 `messages` |
|---|---|---|---|
| `id` | string | `${videoId}_${元素 id}`；元素沒有 id 時是 `${Date.now()}_${亂數}` | `id`（原樣保留以便去重） |
| `videoId` | string | | `videoId` |
| `timestamp` | number | **擷取當下的 `Date.now()`**，不是訊息實際時間 | `timestampAbs` |
| `displayTime` | string | 畫面時間文字（如 `下午 8:01` 或 `1:02:10`） | 不保留（可推導） |
| `videoOffsetSec` | number\|null | | `videoOffsetSec` |
| `authorId` | string | `@handle`、`channel/UC…`、`@名稱`，或 `unknown:<ms>` | 依形式拆成 `authorHandle`／`authorChannelId` |
| `authorName` | string | 顯示名稱（可能就是 `@handle`） | 若 `@` 開頭 → `authorHandle`；否則作為頻道快取的顯示名稱候選 |
| `authorUrl` | string | | `authorUrl` |
| `avatarUrl` | string | | `authorAvatar` |
| `parts` | `{type:'text',text}` \| `{type:'emoji',alt,src}` 陣列 | | `runs`：`{text}` / `{emoji:{src,alt,shortcut:''}}` |
| `plainText` | string | | 不保留（可推導） |
| `amount` | string | SC 金額 | `amount` |
| `isSuperChat` | boolean | | 與 `type` 一起判斷 |
| `isCreatorLanding` | boolean | 降落／認證實況主 | `type:'raid'` 或 `authorBadges` 加 `verified`（見 3.5） |
| `isOwner` | boolean | | `authorBadges` 加 `owner` |
| `type` | string | **YouTube 元件標籤名稱**（見 3.5） | 對應到 v3 `type` |

v2.6.0 沒有儲存的欄位：`color`、`stickerSrc`、`moderator`／`member` 徽章。遷移後這些欄位留空。

### 3.3 `pinned_messages`（keyPath `id`；索引 `videoId`）
| 欄位 | 說明 | → v3 |
|---|---|---|
| `id` | `${videoId}::${authorName}::${plainText}` | 原樣保留 |
| `videoId`、`timestamp`、`displayTime`、`videoOffsetSec`、`authorId`、`authorName`、`authorUrl`、`avatarUrl`、`parts`、`plainText` | 同 messages | 同 3.2 對照；`pinnedAt` = `timestamp`；`type` = `text` |

### 3.4 `channels`（keyPath `key`）
| 欄位 | 說明 | → v3 `channels` |
|---|---|---|
| `key` | 等於訊息的 `authorId` | `handleOrId`（去掉 `channel/` 前綴） |
| `displayName` | | `displayName` |
| `avatarUrl` | | `avatar` |
| `channelUrl` | canonical URL | — |
| `updatedAt` | | `fetchedAt`（過期後會重新解析） |

### 3.5 `type`（標籤名稱）→ v3 `type`
| v2.6.0 `type` | v3 `type` |
|---|---|
| `yt-live-chat-text-message-renderer` | `text` |
| `yt-live-chat-paid-message-renderer` | `superchat` |
| `yt-live-chat-paid-sticker-renderer` | `supersticker` |
| `yt-live-chat-membership-item-renderer` | `membership`（v2.6.0 未區分里程碑） |
| `yt-live-chat-viewer-engagement-message-renderer` | `raid` |
| `yt-live-chat-banner-redirect-renderer` | `raid` |
| 其他／缺值 | `system` |

`isCreatorLanding: true` 但 `type` 為一般訊息時，在 `authorBadges` 加入 `verified`。

## 4. v2.6.0 匯出 JSON 格式（`YT_Chat_<videoId>.json`）
```json
{
  "videoId": "string",
  "streamMeta": { /* 3.1 的 streams 物件，或 null */ },
  "pinnedMessages": [ /* 3.3 的物件 */ ],
  "messages": [
    { /* 3.2 的物件 */, "resolvedChannelName": "string", "resolvedChannelUrl": "string" }
  ]
}
```
- 沒有 `formatVersion` 欄位。判斷方式：頂層有 `videoId`、`messages` 陣列，且元素含 `parts` 或 `plainText`。
- `resolvedChannelName`／`resolvedChannelUrl` 可用來補 v3 `channels` 快取。

## 5. 遷移注意事項
1. 舊的 `id` 原樣沿用作為 v3 的 `id`。同一份資料重複遷移或匯入時不會重複寫入。
2. 舊訊息的 `timestamp` 是擷取時間，而不是送出時間。VOD 回放以 `videoOffsetSec` 為準。
3. `authorId` 為 `unknown:<ms>` 的訊息，`authorHandle` 與 `authorChannelId` 都留空。
4. 舊庫 `messages` 可能很大（備份中 leveldb 約 1.9 MB），遷移需分批讀寫（例如每批 500 筆），避免 Service Worker 逾時。
