# 版本紀錄

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號採 [語意化版本](https://semver.org/lang/zh-TW/)。

## [未發布] — 目標 2.7.0
### 規格（commit `5b48eb6`，2026-11-13）
- 規格書 v19：重寫為可交給 Claude Code 的開發規格（`SPEC.md`），新增資料模型、訊息協定、驗收條件與任務清單。
- F-10 改採「原生 iframe 完整高度 + `clip-path` 動態裁切」（方案 A），方案 B 列為備案。
- 新增 `selectors.js` / `constants.js` 集中管理選擇器與常數的要求。
- 機器人排除名單擴充：Nightbot、StreamElements、Streamlabs、Moobot、Fossabot。

### 待開發
- F-10 直播中保留原生輸入區、表符、SC、超級貼圖、會員里程碑。

## [2.6.0] — 規格 v18
### 已完成（實測正常）
- F-01 聊天室 DOM 修剪（上限 45 則，每 3.5 秒）
- F-02 富媒體歷史保存（IndexedDB）
- F-03 自動解析頻道名稱與頭像（快取 7 天）
- F-04 前後台介面分離
- F-05 分類膠囊列（全部 / Super Chat / 實況主降落，排除機器人）
- F-06 搜尋列（使用者過濾 + 關鍵字高亮）
- F-07 懸浮主播置頂卡片
- F-08 VOD 時間軸雙向同步
- F-09 單一「開啟/關閉優化面板」按鈕

### 已知問題
- F-10 直播中開啟優化面板時原生輸入區空白、彈窗重疊或錯位（v13～v18 嘗試皆失敗，詳見 `docs/handover-v18.md`）。
