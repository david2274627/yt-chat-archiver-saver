# YT 加強版聊天室套件（yt-chat-archiver-saver）

Chrome 擴充功能（Manifest V3）：長時間觀看 YouTube 直播時降低分頁記憶體，並把聊天室完整保存在本機，支援搜尋、Super Chat / 實況主降落篩選、置頂卡片、VOD 時間軸同步回放與離線匯出。

- 目前版本：見 [`VERSION`](VERSION) 與 [`CHANGELOG.md`](CHANGELOG.md)
- 開發規格：[`SPEC.md`](SPEC.md)
- Claude Code 工作規則：[`CLAUDE.md`](CLAUDE.md)
- 本機交接說明：[`docs/HANDOFF.md`](docs/HANDOFF.md)
- 測試清單：[`docs/test-checklist.md`](docs/test-checklist.md)

## 交給 Claude Code 開發
```bash
git clone https://github.com/david2274627/yt-chat-archiver-saver.git
cd yt-chat-archiver-saver
claude   # 開頭指令見 docs/HANDOFF.md
```

## 安裝（開發版）
1. Chrome 開啟 `chrome://extensions`，打開「開發人員模式」
2. 「載入未封裝項目」→ 選擇本資料夾（含 `manifest.json` 的那層）
