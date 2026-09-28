Card Tactics 2.0 — 海世界補充包 + 六維派生修正
Base GitHub main: 6b4093693438fb5219dfd925b296e326fb6f6444

上傳到專案相同路徑：
js/stat-formula-engine.js          NEW
js/main.js                         MODIFIED
js/unit-runtime-engine.js          MODIFIED
js/effect-engine.js                MODIFIED
js/aquatic-content.js              MODIFIED
js/pack-database.js                MODIFIED
js/shell-ui.js                     MODIFIED

主要變更：
1. 新增中央 StatFormulaEngine。
2. 六維基礎換算：
   HP   = 50 + VIT * 8
   ATK  = 34 + STR * 3
   MATK = 10 + INT * 4
   DEF  = 15 + VIT * 2
   MDEF = 10 + WIL * 4
   AGI/LUK 仍由現有 BattleEngine 負責命中/迴避差、速度、暴擊；MOVE 仍獨立設定。
3. 現有角色採 MIGRATED 校準模式：初始面板保持不變，但六維被 Buff/Override 改變後，派生能力會跟著變。
4. 涅瑞雅改成 FORMULA 原生模式，不再直接手填 hp/atk/matk/def/mdef。
   三叉戟提供 ATK +6 / MATK +10；鱗甲戰衣提供 HP +90 / DEF +27 / MDEF +6。
   最終初始值仍為 HP300 / ATK100 / MATK100 / DEF82 / MDEF96 / MOVE4。
5. Seraphina 的 ATTRIBUTE_OVERRIDE（例如恢復 5V）現在會真正重算派生能力。
6. 海世界固定補充包在商店點選後會直接預覽固定內容，不再看起來是空包。
7. PackDatabase 新增 productCards() 並加強卡牌解析。

驗證：
- 所有 7 個 JS：node --check PASS
- 涅瑞雅公式結果：300/100/100/82/96 PASS
- 莉維亞原始面板保持：210/94/90/55/90 PASS
- Seraphina 5V 重算與效果結束回復 PASS
- SEA_WORLD_SUPPLEMENT 可解析 nereia_card PASS
- SEA_WORLD_FIXED 可解析 nereia_card PASS
