# Card Tactics 2.0｜PvP 房間服務（Workers Builds 版）

**第一件事：請閱讀專案根目錄的 `【先看這份】Cloudflare直連GitHub_零Token部署教學.pdf` 或 `.html`。**

## 已確定的部署方式

這份 Worker 改用 Cloudflare **Workers Builds 直接連 GitHub**，無須由使用者建立 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 或 GitHub Actions。

| 設定 | 值 |
| --- | --- |
| Repository | `AlexLiao0131/card-tactics-2` |
| Production branch | `main` |
| Worker name | `card-tactics-pvp` |
| Root directory | `cloudflare-pvp` |
| Build command | `npm test` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | Include `cloudflare-pvp/*`, exclude 留空 |

參照：`cloudflare-pvp/BUILD_SETTINGS.md` 以及 `wrangler.jsonc`。**不要部署到既有 Gemini Worker。**

房間功能：8 碼邀請碼、雙人席位、WebSocket 準備同步、斷線重連、七天房間過期、Origin 限制、SQLite Durable Object。伺服器拒絕遊戲動作，因此 **不支援真正 PvP 戰棋**。

本機測試：`cd cloudflare-pvp && node --test tests/*.test.mjs`。實際 Cloudflare 部署與雙手機測試尚未完成。

**先前 GitHub Actions 的 `.github/workflows/deploy-pvp-lobby.yml` 必須移除（若已上傳），不能讓兩套方式並存。**
