# Workers Builds 設定值（直接複製到 Cloudflare 畫面）

本專案不需要手動申請 Cloudflare API Token，也不使用 GitHub Actions；Cloudflare 在連接 GitHub Repo 時自行管理部署授權。

- Repository：`AlexLiao0131/card-tactics-2`
- Branch：`main`
- Worker / project name：`card-tactics-pvp`（必須和 wrangler.jsonc 的 name 相同）
- Root directory：`cloudflare-pvp`（從 GitHub Repo 根目錄算起）
- Build command：`npm test`
- Deploy command：`npx wrangler deploy`
- Build watch paths（Settings → Build）：Includes `cloudflare-pvp/*`、Excludes 空白。
- 連線 URL：部署成功後，從 Cloudflare Worker 頁面複製真實 `workers.dev` 地址，填入 `js/pvp-config.js` 的 `PVP_API_BASE`。

不要手動建立 D1；這裡用的是 SQLite Durable Objects。不要修改原有 Gemini Worker。不要開啟未實作的 PvP 戰鬥操作。

完整繁體中文教程：專案根目錄 `【先看這份】Cloudflare直連GitHub_零Token部署教學.pdf`，HTML／Markdown 同內容。
