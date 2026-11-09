const BLEEDING_STATUS=Object.freeze({type:"DAMAGE_OVER_TIME",id:"BLEEDING",name:"流血",classification:"NEGATIVE",amount:12,duration:3,chance:100});
const POISON_THROW_TOTAL_DAMAGE=18; // Existing poison knife bonus, distributed over its newly specified 3 ticks.
const POISON_THROW_DURATION=3;
export const SKILLS={
  bow_shot:{id:"bow_shot",name:"弓箭射擊",description:"莉維亞引弦凝神，以精準箭術追擊遠處敵人。若長弓受到火焰或雷霆祝福，下一次離弦的箭矢也將釋放元素之力。",category:"ATTACK",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,affixes:[]},
  black_slash:{id:"black_slash",name:"黑劍斬擊",description:"黑劍劃破敵人防線，沉穩而凌厲。若武器已受火或雷元素祝福，斬擊將一併釋放那股力量。",category:"ATTACK",weapon:"black_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  shadow_step:{id:"shadow_step",name:"幽影步",description:"莉維亞借暗影掩護身形，踏過尋常步伐難以跨越的距離，在戰場上迅速轉移位置。",category:"SPECIAL",power:0,manaCost:16,range:{min:1,max:4},target:"TILE",targetType:"AOE",shape:"W_STEP",moveToTarget:true,ignorePath:true,support:false,affixes:[]},
  nether_slash:{id:"nether_slash",name:"幽冥斬擊",category:"SPECIAL",weapon:"black_sword",power:1.25,manaCost:20,range:{min:1,max:3},attackType:"SLASH",element:"DARK",speed:5,target:"ENEMY",support:false,affixes:["SPACE_RIFT"],
    description:"莉維亞以黑劍劃開幽冥帷幕，劍芒穿過阻隔，直取已察覺的敵影。敵人仍可閃避、格擋、招架或反擊；斬出此劍後，她將結束行動。若黑劍已獲火焰或雷霆祝福，幽冥之力也會挾帶元素一同襲來。"},
  elemental_enchant:{id:"elemental_enchant",name:"元素附魔",category:"MAGIC",power:1,manaCost:18,range:{min:0,max:4},target:"ALLY",targetType:"SINGLE",support:false,
    description:"莉維亞喚醒火焰或雷霆，將祝福附在自己或戰友的實體武器上。祝福會停留在指定兵刃，直到下一次真正出手；即使一擊落空或被敵人擋下，也會隨攻擊消散。若為自己的武器附魔，可順勢攻擊或收招待機。火之箭矢命中後引發爆裂，雷之攻擊則能讓相連水域迸發電光，波及所有接觸者。",
    utilityAction:{type:"ENCHANT_WEAPON"},enchantment:{power:1,attackTypes:["SLASH","PIERCE","STRIKE","SHOT"],
      onBowImpact:{FIRE:{radius:1,aoeDamage:45,environmentForces:["FIRE","EXPLOSION"]}}},
    variants:[{id:"ENCHANT_FIRE",name:"火元素",element:"FIRE",description:"將烈焰封入實體武器。附魔箭矢命中後，火勢會隨爆裂擴散至周遭地形與單位。"},{id:"ENCHANT_THUNDER",name:"雷元素",element:"THUNDER",description:"以奔雷祝福實體武器。雷霆觸及相連水域時，電光會向外傳導，不分敵我。"}]},
  slash:{id:"slash",name:"制式斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  heavy_slash:{id:"heavy_slash",name:"重裝斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:-5,target:"ENEMY",support:false,affixes:[]},
  claw:{id:"claw",name:"利爪攻擊",category:"ATTACK",weapon:"claw",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:5,target:"ENEMY",support:false,affixes:[]},
  club:{id:"club",name:"木棒敲擊",category:"ATTACK",weapon:"club",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  blessed_slash:{id:"blessed_slash",name:"祝福劍斬擊",category:"ATTACK",weapon:"blessed_sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,affixes:[]},
  thrust:{id:"thrust",name:"制式突刺",category:"ATTACK",weapon:"spear",power:1,range:{min:1,max:2},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  smash:{id:"smash",name:"戰錘重擊",category:"ATTACK",weapon:"hammer",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:-10,target:"ENEMY",support:false,affixes:[],postEffects:[{type:"KNOCKBACK",distance:2}]},
  magic_bolt:{id:"magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"staff",power:1,manaCost:10,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,affixes:[]},
  imperial_bow_shot:{id:"imperial_bow_shot",name:"帝國弓射",category:"ATTACK",weapon:"bow",power:1,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,affixes:[]},
  cavalry_slash:{id:"cavalry_slash",name:"騎兵斬擊",category:"ATTACK",weapon:"sword",power:1.05,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,affixes:[]},
  leon_slash:{id:"leon_slash",name:"劍斬",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,affixes:[]},
  leon_thrust:{id:"leon_thrust",name:"精準突刺",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  leon_strike:{id:"leon_strike",name:"破甲劍擊",category:"ATTACK",weapon:"star_iron_sword",power:1.1,range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,affixes:[]},
  lion_flash:{id:"lion_flash",name:"奧義・獅子瞬斬",category:"ATTACK",weapon:"star_iron_sword",power:1.4,manaCost:28,range:{min:1,max:4},attackType:"SLASH",element:"INHERIT",speed:10,target:"TILE",targetType:"AOE",shape:"LINE",moveToTarget:true,support:false,affixes:[]},
  kahn_precision:{id:"kahn_precision",name:"精準射擊",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,affixes:[]},
  kahn_snipe:{id:"kahn_snipe",name:"狙殺",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.4,manaCost:18,range:{min:3,max:6},attackType:"SHOT",element:"INHERIT",speed:-15,target:"ENEMY",support:false,affixes:[]},
  kahn_knife:{id:"kahn_knife",name:"近身獵殺",category:"ATTACK",weapon:"hunting_knife",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,affixes:[]},
  cassandra_magic_bolt:{id:"cassandra_magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"cassandra_staff",power:1,manaCost:12,range:{min:2,max:4},attackType:"MAGIC",element:"NONE",speed:0,target:"ENEMY",support:true,affixes:[]},
  cassandra_fire_burst:{id:"cassandra_fire_burst",name:"炎爆術",category:"MAGIC",weapon:"cassandra_staff",power:1.25,manaCost:24,range:{min:2,max:4},attackType:"MAGIC",element:"FIRE",speed:-5,target:"ENEMY",support:false,affixes:[],statusEffects:[{type:"BURN",chance:100}]},
  cassandra_frost:{id:"cassandra_frost",name:"寒霜術",category:"MAGIC",weapon:"cassandra_staff",power:1.1,manaCost:18,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,affixes:[],statusEffects:[{type:"BUFF",id:"FROST_SLOW",name:"寒霜遲滯",classification:"NEGATIVE",duration:2,modifiers:{move:-1,speed:-20},chance:100}]},
  cassandra_dissolve:{id:"cassandra_dissolve",name:"異端術式・崩解",category:"MAGIC",weapon:"cassandra_staff",power:1.5,manaCost:30,range:{min:2,max:5},attackType:"MAGIC",element:"NONE",speed:-15,target:"ENEMY",support:false,affixes:[]},

  reina_blessed_slash:{id:"reina_blessed_slash",name:"精靈祝福之劍",description:"以精靈祝福長劍斬擊單一敵人，物理斬擊與武器常駐的自然魔法分別結算傷害及爆擊。祝福長劍可使用神器招架抵擋一般魔法與莉維亞黑劍的穿防斬擊；招架不是必定成功。",category:"ATTACK",weapon:"blessed_sword",power:1.15,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:10,target:"ENEMY",support:false,affixes:[]},
  reina_blessed_bow:{id:"reina_blessed_bow",name:"精靈祝福之弓",description:"蕾娜以精靈長弓射擊單一敵人，造成物理箭傷與武器常駐的自然魔法附傷。兩段傷害分開計算防禦及爆擊；弓身的自然魔法不因射擊消耗，也能另外接受火／雷附魔。",category:"ATTACK",weapon:"bow",power:1.10,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:5,target:"ENEMY",support:true,affixes:[]},
  reina_command_shot:{id:"reina_command_shot",name:"集團齊射",description:"以蕾娜為中心的指揮範圍內，所有尚未完成行動且持弓的友軍一同射向指定區域。蕾娜決定射程及對各敵人的命中率；全員依自身攻擊力統整成一次範圍火力，各敵人仍分別結算防禦及護盾。持弓者的自然魔法及火、雷附魔獨立累加；火附魔只在指定中心爆炸一次，爆炸覆蓋齊射區域並照常波及敵我。所有參戰者消耗本回合攻擊行動。",category:"SPECIAL",weapon:"bow",power:1.10,manaCost:30,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,attackType:"SHOT",element:"INHERIT",speed:5,support:false,rangerVolley:true,affixes:[]},
  reina_rally:{id:"reina_rally",name:"急行軍",description:"蕾娜指揮範圍內尚未移動及完成行動的友軍保持相對隊形，暫時共享蕾娜的移動距離、森林及山地適性，原本更優秀的移動能力不被削弱。指定蕾娜的目的地後，全員必須擁有合法落點及路徑才能執行；全員僅消耗原本的移動機會，之後仍可攻擊。",category:"SPECIAL",power:0,manaCost:20,range:{min:1,max:5},target:"TILE",targetType:"AOE",radius:0,requiresVision:false,support:false,requirements:{notMoved:true},utilityAction:{type:"RANGER_FORMATION_MARCH"}},
  reina_supply:{id:"reina_supply",name:"戰地補給",description:"蕾娜以自己為中心，立即為指揮範圍內所有存活友軍（包含自己）回復 20 MP，無法超過各自上限。只消耗蕾娜一次施法行動，不需逐一選取友軍。",category:"MAGIC",power:0,manaCost:24,range:{min:0,max:0},target:"SELF",commandAura:true,support:false,effects:[{type:"RESTORE_MANA",amount:20}]},
  reina_sentries:{id:"reina_sentries",name:"聯合衛哨",description:"以蕾娜為中心，讓指揮範圍內友軍（包含自己）取得額外 2 格視野，持續 2 回合。各隊友從自身位置提供觀測並共享戰場情報，仍受到夜晚、暴風雪、濃煙、牆壁及潛行等正式視線限制。",category:"MAGIC",power:0,manaCost:18,range:{min:0,max:0},target:"SELF",commandAura:true,support:false,effects:[{type:"BUFF",id:"RANGER_SENTRIES",name:"聯合衛哨",classification:"POSITIVE",duration:2,visionBonus:2}]},

  nereia_trident_thrust:{id:"nereia_trident_thrust",name:"三叉戟突刺",category:"ATTACK",weapon:"trident",power:1.10,range:{min:1,max:2},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  nereia_trident_throw:{id:"nereia_trident_throw",name:"三叉戟投擲",description:"投出王海三叉戟，造成遠程物理穿刺傷害，武器不需要拾回；敵人仍可依合法射程與反擊規則反擊。",category:"ATTACK",weapon:"trident",power:.8,range:{min:2,max:4},attackType:"PIERCE",attackClass:"RANGED",element:"INHERIT",speed:0,target:"ENEMY",support:false,affixes:[]},
  nereia_water_bullet:{id:"nereia_water_bullet",name:"水彈",description:"以三叉戟凝聚水屬性魔法彈攻擊單一敵人，並與燃燒地形發生原有水火接觸效果。",waterMagic:true,category:"MAGIC",weapon:"trident",power:1.05,manaCost:12,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,affixes:[],waterContact:"RAIN_EVENT",environmentTarget:"BURNING"},
  nereia_whirlpool:{id:"nereia_whirlpool",name:"漩渦",description:"在真實連通水域製造兩回合的漩渦，半徑兩格；僅牽引敵軍並限制其主動移動。觸水不立即造成溺水傷害，真正沉沒後才按環境回合結算。",waterMagic:true,category:"MAGIC",weapon:"trident",power:0,manaCost:20,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,speed:-5,support:false,requiresVision:true,element:"WATER",whirlpool:{duration:2,onlyEnemies:true},affixes:["WATER_TERRAIN_CONTROL"]},
  nereia_deep_drag:{id:"nereia_deep_drag",name:"深潛拖拽",description:"下潛時拖住鄰近水域的敵人，將其拉入水下。必須有足以淹沒目標的真實水深；不造成即時溺水傷害，後續依既有水下呼吸及溺水規則結算。",category:"ATTACK",power:0,range:{min:1,max:1},target:"ENEMY",support:false,requirements:{diving:true},utilityAction:{type:"SUBMERGE_ENEMY",consumeTurn:true}},
  nereia_tsunami:{id:"nereia_tsunami",name:"海嘯",description:"召喚沿選定方向推進的五格寬浪潮。敵人沿原有強制位移與碰撞規則沖散；真正被浪潮掃到的友軍獲得等於女王施放時MATK的水盾，持續兩回合或被擊破。浪潮之後留下真實水量，依地形流動及水深判定。",waterMagic:true,element:"WATER",tsunamiWave:{width:5},category:"MAGIC",weapon:"trident",power:0,manaCost:28,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,speed:-10,support:false,requiresVision:true,hydrologyFlood:{surfaceRise:1.25},affixes:["WATER_TERRAIN_CONTROL"]},

  cat_dual_slash:{id:"cat_dual_slash",name:"雙匕首連斬",description:"雙匕首獨立命中與爆擊，整組只產生一次反擊機會；任一刀造成傷害便施加流血。",category:"ATTACK",weapon:"daggers",power:1.0,hitCount:2,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:15,target:"ENEMY",support:false,statusEffects:[{...BLEEDING_STATUS}],affixes:[]},
  cat_backstab:{id:"cat_backstab",name:"背刺",category:"ATTACK",weapon:"daggers",power:1.05,range:{min:1,max:1},attackType:"PIERCE",element:"INHERIT",speed:20,target:"ENEMY",support:false,backstabMultiplier:1.65,affixes:["BACKSTAB"]},
  cat_poison_knife:{id:"cat_poison_knife",name:"淬毒投擲刀",category:"ATTACK",weapon:"throwing_knife",power:.8,manaCost:12,range:{min:2,max:4},attackType:"PIERCE",attackClass:"RANGED",element:"INHERIT",speed:10,target:"ENEMY",support:false,statusEffects:[{type:"DAMAGE_OVER_TIME",id:"POISON",name:"中毒",classification:"NEGATIVE",duration:POISON_THROW_DURATION,amount:POISON_THROW_TOTAL_DAMAGE/POISON_THROW_DURATION,chance:100}],affixes:["POISON"]},
  cat_smoke_bomb:{id:"cat_smoke_bomb",name:"煙霧彈",description:"以米菈自身為中心展開固定兩回合的煙幕，範圍內友軍獲得掩護；離開煙霧或出手會暴露。",category:"SPECIAL",power:0,manaCost:16,range:{min:0,max:0},target:"SELF",targetType:"SINGLE",radius:2,support:false,smokeField:{duration:2}},
  cat_pickpocket:{id:"cat_pickpocket",name:"妙手空空",description:"每名敵人在本場戰鬥只能被成功偷取一次；奪取實際持有的道具及尚未領取的金幣獎勵。",category:"SPECIAL",power:0,manaCost:18,range:{min:1,max:1},target:"ENEMY",support:false,utilityAction:{type:"STEAL_LOOT",consumeTurn:true}},
  cat_hide:{id:"cat_hide",name:"潛行",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,utilityAction:{type:"ENTER_STEALTH",consumeTurn:true}},

  angel_bow_shot:{id:"angel_bow_shot",name:"天使弓射",category:"ATTACK",weapon:"bow",power:1.05,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:10,target:"ENEMY",support:true,affixes:[]},
  angel_holy_shot:{id:"angel_holy_shot",name:"神聖附魔射擊",category:"MAGIC",weapon:"bow",power:1.15,manaCost:14,range:{min:2,max:5},attackType:"SHOT",attackClass:"RANGED",element:"HOLY",speed:5,target:"ENEMY",support:false,affixes:["HOLY_ENCHANT"]},
  angel_heal:{id:"angel_heal",name:"治療魔法",category:"MAGIC",power:0,manaCost:20,range:{min:0,max:4},target:"ALLY",support:false,effects:[{type:"HEAL",amount:80}]},
  angel_lift_drop:{id:"angel_lift_drop",name:"升空摔落",category:"ATTACK",power:0,manaCost:20,range:{min:1,max:1},target:"ENEMY",support:false,utilityAction:{type:"CARRY_ENEMY",releaseSkillId:"angel_drop_enemy",consumeTurn:true,minDrop:3}},
  angel_drop_enemy:{id:"angel_drop_enemy",name:"摔落敵人",category:"SPECIAL",power:0,range:{min:0,max:0},displayRangeLabel:"依天使實際飛行範圍",target:"TILE",targetType:"AOE",radius:0,support:false,utilityAction:{type:"RELEASE_CARRIED",mode:"DROP",consumeTurn:true}},
  angel_carry_ally:{id:"angel_carry_ally",name:"空運友軍",category:"SPECIAL",power:0,range:{min:1,max:1},displayRangeLabel:"可移動接近／空運依天使移動範圍",target:"ALLY",support:false,requirements:{notCarrying:true},utilityAction:{type:"CARRY_ALLY",releaseSkillId:"angel_release_ally",consumeTurn:false}},
  angel_release_ally:{id:"angel_release_ally",name:"放下友軍",category:"SPECIAL",power:0,range:{min:0,max:0},displayRangeLabel:"依天使當前可移動範圍",target:"TILE",targetType:"AOE",radius:0,support:false,requirements:{carrying:true},utilityAction:{type:"RELEASE_CARRIED",consumeTurn:true}},
  // This skill owns landing + a temporary, directional four-cell obstruction.
  // The wall is maintained by the grounded angel rather than an invented timer.
  angel_holy_arrow_rain:{id:"angel_holy_arrow_rain",name:"神聖箭雨",
    description:"艾蕾希雅於飛行中以弓為施法媒介凝聚聖光，射出金白色光箭群，在指定中心格周圍形成十三格菱形箭雨。範圍內敵軍由聖光箭雨直接接觸、各結算一次純神聖魔法傷害，使用 MATK 與敵方 MDEF（護盾及免疫依正式規則）；不計算弓箭物理傷害、不消耗武器附魔，也不傷害友軍。射程 2～5 格，消耗 32 MP，施放後結束行動。",
    category:"MAGIC",power:.95,manaCost:32,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,
    attackType:"MAGIC",attackClass:"RANGED",offenseStat:"MATK",defenseStat:"MDEF",animationState:"ATTACK",visualAttackType:"SHOT",
    element:"HOLY",requirements:{flying:true},areaDamage:{mode:"MAGIC_POWER",relation:"ENEMY",hitRule:"AREA_CONTACT"},
    support:false,affixes:[]},
  angel_holy_wing_barrier:{id:"angel_holy_wing_barrier",name:"聖翼壁障",
    description:"消耗 28 MP。艾蕾希雅在地面可直接選擇合法地格展翼施放；若在空中，則先降落至合法落點再展開羽翼。在面向正前方生成一排四格神聖盾牆。敵軍只能繞路，弓箭與魔法不能從牆前攻擊後方友軍；友軍的移動、近戰、遠射、魔法與反擊不受妨礙。艾蕾希雅離開落點、起飛或被擊倒時，盾牆消散。",
    category:"MAGIC",power:0,manaCost:28,range:{min:0,max:5},target:"TILE",targetType:"AOE",radius:0,
    utilityAction:{type:"LAND_WING_BARRIER"},support:false},

  ophi_forest_thrust:{id:"ophi_forest_thrust",name:"森靈突刺",description:"以森靈之矛對近距離敵人發動穿刺攻擊。\n傷害：穿刺物理傷害＋武器常駐的自然魔法附傷，兩部分分別計算、同一次攻擊結算；不需額外附魔。\n射程：1～2 格。攻擊後結束本次行動。",category:"ATTACK",weapon:"forest_spear",power:1,range:{min:1,max:2},attackType:"PIERCE",attackClass:"MELEE",element:"NONE",speed:0,target:"ENEMY",support:false},
  ophi_forest_throw:{id:"ophi_forest_throw",name:"森靈投矛",description:"向中距離敵人投出森靈之矛。\n傷害：穿刺物理傷害＋武器常駐的自然魔法附傷，兩部分分別計算、同一次攻擊結算；不需拾回長矛，也不消耗彈藥。\n射程：2～4 格。敵人仍可依合法的射程及反擊條件反擊。",category:"ATTACK",weapon:"forest_spear",power:.8,range:{min:2,max:4},attackType:"PIERCE",attackClass:"RANGED",element:"NONE",speed:0,target:"ENEMY",support:false},
  ophi_elven_shot:{id:"ophi_elven_shot",name:"精靈弓射",description:"以精靈長弓進行一般遠距離射擊，造成弓箭物理傷害。\n射程：2～5 格。可依現有合法條件參與友軍支援攻擊。若長弓帶有元素附魔，實際發動這次攻擊時會消耗附魔並結算元素效果。",category:"ATTACK",weapon:"elven_bow",power:1.05,range:{min:2,max:5},attackType:"SHOT",attackClass:"RANGED",element:"INHERIT",speed:5,target:"ENEMY",support:true,affixes:[]},
  ophi_eagle_arc_shot:{id:"ophi_eagle_arc_shot",name:"鷹眼曲射",description:"借助奧菲自身、老鷹或森語植物節點的觀測，向已確認的敵人發動高拋遠距離弓擊。\n直接觀測：距離 2～6 格可由奧菲的視野鎖定。遠端觀測：距離 4～12 格須由存活植物節點或仍在場的老鷹提供合法觀測；老鷹被擊落後仍可使用植物觀測。\n消耗：18 MP。",category:"ATTACK",weapon:"elven_bow",power:1.25,manaCost:18,range:{min:2,max:12},attackType:"SHOT",attackClass:"RANGED",element:"INHERIT",speed:-10,target:"ENEMY",support:false,trajectory:"ARC",targeting:{mode:"INDIRECT_OBSERVED",directRange:{min:2,max:6},remoteRange:{min:4,max:12},companionId:"ophi_eagle",observationNetwork:true},affixes:["ARC_SHOT"]},
  ophi_healing_song:{id:"ophi_healing_song",name:"治癒歌聲",category:"MAGIC",power:0,manaCost:24,range:{min:0,max:0},target:"SELF",targetType:"SINGLE",speed:-5,support:false,soundMagic:true,tags:["HEALING"],channel:{type:"HEALING_CHANNEL",id:"OPHI_HEALING_SONG",name:"治癒歌聲",duration:3,radius:2,amount:10},description:"奧菲在原地持續吟唱，維持以自身為中心的治療範圍。\n治療：持續 3 回合，每回合開始時，使範圍 2 格內的奧菲與友軍各恢復 10 HP；每次結算重新判斷範圍，不會在離開範圍後繼續治療。\n中斷：奧菲移動、主動攻擊或進入迴避／防禦／反擊流程時立即停止；待機不會中斷。",affixes:["HEAL_OVER_TIME"]},

  ophi_forest_entangle:{id:"ophi_forest_entangle",name:"森之束縛",description:"利用存活樹木伸出藤蔓，束縛受到森語植物觀測的敵人。\n施放條件：目標必須位於任一棵存活樹木所在格或其周圍一格（包含斜角），並符合技能原本的射程與視野規則；灌木可提供觀測，但不算束縛來源。\n效果：目標 2 回合無法移動，並承受每回合 18 點持續傷害。消耗 22 MP。",category:"MAGIC",power:0,manaCost:22,range:{min:1,max:6},target:"ENEMY",targetType:"SINGLE",speed:-5,support:false,targeting:{requiresObservationNetwork:"PLANT",treeProximity:{objectTypes:["TREE"],radius:1,diagonals:true}},effects:[{type:"BUFF",id:"FOREST_ENTANGLED",name:"藤蔓纏繞",classification:"NEGATIVE",duration:2,movementRules:{immobilized:true}},{type:"DAMAGE_OVER_TIME",id:"FOREST_ENTANGLE_DAMAGE",name:"纏繞傷害",classification:"NEGATIVE",amount:18,duration:2}],affixes:["FOREST_CONTROL","DAMAGE_OVER_TIME"]},
  colin_full_shield_defense:{id:"colin_full_shield_defense",name:"大盾防禦",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",speed:-5,support:false,requiresEquipment:"colin_full_body_shield",stance:{type:"FULL_SHIELD_DEFENSE",protectsBehind:true,blocksEnemyRoute:true,enhancedGuard:true},effects:[{type:"BUFF",id:"FULL_SHIELD_DEFENSE",name:"大盾防禦",classification:"POSITIVE",duration:1,modifiers:{damageTakenMultiplier:.85},collision:{kind:"SHIELD",solid:true,height:3,hardness:4,response:"STOP",impactMultiplier:1.25,priority:90},defenseProfiles:[{id:"full_shield_stance_guard",method:"GUARD",name:"全身大盾架勢",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.25},PIERCE:{damageMultiplier:.30},SHOT:{damageMultiplier:.20},STRIKE:{damageMultiplier:.45},MAGIC:{damageMultiplier:.70}}}]}],affixes:["FULL_SHIELD_DEFENSE"]},
  colin_armor_breaking_strike:{id:"colin_armor_breaking_strike",name:"破甲打擊",category:"ATTACK",weapon:"colin_hammer",power:1.15,range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,affixes:["ARMOR_BREAK"],statusEffects:[{type:"DEF_DOWN",value:20,duration:2}],postEffects:[{type:"KNOCKBACK",distance:2}]},

  church_slash:{id:"church_slash",name:"騎士斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false},
  church_heavy_slash:{id:"church_heavy_slash",name:"重劍斬擊",category:"ATTACK",weapon:"greatsword",power:1.1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:-5,target:"ENEMY",support:false},
  church_holy_bolt:{id:"church_holy_bolt",name:"聖光術",category:"MAGIC",weapon:"staff",power:1,manaCost:12,range:{min:1,max:4},attackType:"MAGIC",element:"HOLY",speed:0,target:"ENEMY",support:true},
  church_bishop_heal:{id:"church_bishop_heal",name:"治癒祈禱",description:"教會主教以祈禱治療友軍，恢復 95 點生命。",category:"MAGIC",power:0,manaCost:24,range:{min:0,max:4},target:"ALLY",support:false,effects:[{type:"HEAL",amount:95}]},
  church_bishop_dispel:{id:"church_bishop_dispel",name:"淨化祈禱",description:"教會主教以聖光驅除友軍的負面異常。",category:"MAGIC",power:0,manaCost:18,range:{min:0,max:4},target:"ALLY",support:false,effects:[{type:"DISPEL",classification:"NEGATIVE"}]},
  templar_holy_slash:{id:"templar_holy_slash",name:"聖劍斬",description:"以常駐神聖附魔的雙手聖劍斬擊敵人。白色物理斬擊與黃色神聖附傷各自判定爆擊；神聖附傷無視格擋與抗性。命中獲得一顆聖能；物理或神聖任一爆擊時，「狂熱」追加一次聖劍斬，不再次觸發狂熱。",category:"ATTACK",weapon:"greatsword",power:1.2,range:{min:1,max:1},attackType:"SLASH",element:"NONE",speed:0,target:"ENEMY",support:false,holyPowerOnHit:1},
  templar_charge:{id:"templar_charge",name:"聖騎衝鋒",description:"選擇突擊或援護兩種衝鋒。突擊命中敵人後擊退一格，獲得一顆聖能；援護衝至友軍身旁，建立兩回合生命連結，以艾莉西亞的防禦與援護減傷替友軍承受攻擊。",category:"ATTACK",weapon:"greatsword",power:1.15,manaCost:16,range:{min:2,max:4},attackType:"SLASH",element:"NONE",speed:5,target:"ENEMY",support:false,approach:{type:"CHARGE",stopDistance:1},holyPowerOnHit:1,postEffects:[{type:"KNOCKBACK",distance:1}],afterUseEffects:[{type:"BUFF",id:"FRONTLINE_STANCE",name:"陣線",classification:"POSITIVE",duration:1,modifiers:{damageTakenMultiplier:.85}}],variants:[{id:"CHARGE_ASSAULT",name:"突擊衝鋒",target:"ENEMY",description:"衝至敵人面前，以物理斬擊與神聖附傷攻擊並擊退 1 格；命中獲得 1 顆聖能。",holyPowerOnHit:1,postEffects:[{type:"KNOCKBACK",distance:1}],afterUseEffects:[{type:"BUFF",id:"FRONTLINE_STANCE",name:"陣線",classification:"POSITIVE",duration:1,modifiers:{damageTakenMultiplier:.85}}]},{id:"CHARGE_RESCUE",name:"援護衝鋒",category:"MAGIC",target:"ALLY",attackType:null,element:"NONE",holyPowerOnHit:0,postEffects:[],afterUseEffects:[],description:"衝至友軍身旁，建立兩回合生命連結。目標被命中時由艾莉西亞承受，使用她自己的防禦與援護減傷；連結後不限距離，無獨立護盾 HP。",effects:[{type:"HP_LINK",id:"TEMPLAR_HP_LINK",name:"生命連結",classification:"POSITIVE",duration:2}]}]},
  templar_holy_shield:{id:"templar_holy_shield",name:"聖盾",description:"張開不可侵犯的神聖領域，立刻淨化自身負面狀態，兩回合內免疫所有傷害、異常狀態與強制位移。仍能正常移動、攻擊、施法與援護。",category:"MAGIC",power:0,manaCost:20,range:{min:0,max:0},target:"SELF",support:false,effects:[{type:"BUFF",id:"HOLY_SHIELD",name:"聖盾",classification:"POSITIVE",duration:2,invulnerable:true,cleanseNegative:true}]},
  templar_healing:{id:"templar_healing",name:"聖光術",description:"聚集柔和聖光，回復自己或指定友軍 65 點生命。",category:"MAGIC",power:0,manaCost:22,range:{min:0,max:3},target:"ALLY",support:false,effects:[{type:"HEAL",amount:65}]},
  templar_verdict:{id:"templar_verdict",name:"裁決",description:"消耗三顆聖能，將聖劍斬轉為完全神聖的光之巨刃，斬擊 1～3 格內敵人。主斬擊命中時，於目標中心向上下左右各延伸兩格引爆十字聖光；中心敵人承受斬擊與爆炸兩段傷害，各自獨立爆擊。所有神聖傷害無視防禦、格擋與元素抗性。",category:"ATTACK",weapon:"greatsword",power:1.2,manaCost:0,resourceCosts:{holyPower:3},range:{min:1,max:3},attackType:"MAGIC",offenseStat:"ATK",element:"HOLY",pureHoly:true,skipInherentMagic:true,speed:0,target:"ENEMY",support:false,verdictCross:{radius:2,blastPower:.8}},
  saint_judgement:{id:"saint_judgement",name:"聖裁",description:"以王族聖光裁決敵人，對不死族傷害加倍。神聖術式可支援戰友並在合法時機反擊；造成實際生命傷害時會消耗信仰。若攻擊暴擊，聖痕返還此次施放消耗的一半 MP。",category:"MAGIC",weapon:"staff",power:1.05,manaCost:12,range:{min:1,max:4},attackType:"MAGIC",element:"HOLY",speed:0,target:"ENEMY",support:true,traitMultipliers:{UNDEAD:2}},
  saint_hero_heal:{id:"saint_hero_heal",name:"治癒祈禱",description:"祈求聖光撫平自己或友軍的傷痛。超出生命上限的治療量會等量轉化為不會自然消失的聖護，抵擋外來傷害；直到聖護完全破裂，吸收的傷害才一次化為信仰。治療暴擊時，聖痕返還本次消耗的一半 MP。",category:"MAGIC",power:0,manaCost:24,range:{min:0,max:4},target:"ALLY",support:false,tags:["HEALING"],effects:[{type:"HEAL",amount:95,saintHealing:true,overflowShield:{id:"SAINT_OVERHEAL_SHIELD",name:"祈禱聖護"}}]},
  saint_hero_dispel:{id:"saint_hero_dispel",name:"淨化祈禱",description:"以純淨聖光驅除友軍的負面異常，同時治療 30 HP。若目標擁有 Sanity，額外恢復 25 Sanity 並降低認知失控風險。聖痕的恩寵抵擋下一次可防禦的負面效果。",category:"MAGIC",power:0,manaCost:18,range:{min:0,max:4},target:"ALLY",support:false,tags:["PURIFICATION"],effects:[{type:"DISPEL",classification:"NEGATIVE",restoreResource:{key:"sanity",amount:25}},{type:"HEAL",amount:30}]},
  saint_hero_blessing:{id:"saint_hero_blessing",name:"王家祝福",description:"羅恩菲爾王族的祈願庇佑戰友，2 回合內提高 ATK 8、MATK 8、MDEF 10 與命中 10。聖痕為目標留下能抵擋一次負面異常的恩寵。",category:"MAGIC",power:0,manaCost:20,range:{min:0,max:4},target:"ALLY",support:false,tags:["BLESSING"],effects:[{type:"BUFF",id:"ROYAL_BLESSING",name:"王家祝福",classification:"POSITIVE",duration:2,modifiers:{atk:8,matk:8,mdef:10,accuracy:10}}]},
  saint_sanctuary:{id:"saint_sanctuary",name:"聖域",description:"以自身為中心刻下不動的聖域。僅信仰滿值或歸零時可施放，立即生效一次，接著兩個己方回合開始再生效一次，共三次。聖女可自由離開並繼續行動。滿信仰：免費放出治癒、淨化及魔法庇護，信仰回到初始一半；零信仰：耗 32 MP，對敵人降下神聖懲戒。施放時自動以聖女所在地為中心，領域半徑 2 格，只能沿平地及斜坡傳播，斷崖阻斷。",category:"MAGIC",power:0,manaCost:32,range:{min:0,max:0},target:"SELF",targetType:"SINGLE",radius:2,speed:-5,support:false,requiresVision:true,sanctuary:{duration:3,healing:{amount:20,purify:true,immuneMagic:true,immuneNegative:true},punishment:{amount:50,element:"HOLY",traitMultipliers:{UNDEAD:2}}}},

  seraphina_rending_claw:{id:"seraphina_rending_claw",name:"血刃突刺",description:"以血族細劍刺穿敵人，命中並造成傷害時施加流血，每回合造成12點傷害，持續3回合。瑟拉菲娜自己造成的直接HP傷害每1點回充1血能；由自己施加的流血每2點實際HP傷害回充1血能。\n覺醒5V後攻擊最多投入15血能，每點提高本次直接傷害1%；流血後續跳傷不額外消耗血能。",category:"ATTACK",weapon:"rapier",power:1.15,range:{min:1,max:1},attackType:"PIERCE",element:"DARK",speed:15,target:"ENEMY",support:false,statusEffects:[{...BLEEDING_STATUS}]},
  seraphina_blood_drain:{id:"seraphina_blood_drain",name:"血影瞬襲",description:"先正常移動，再依完整移動範圍瞬移至可見敵人的實際背後空格，發動一次必中血刃攻擊；敵方不可閃避、招架、格擋、反擊或由友軍攔截。傷害依正式攻防公式結算，流血目標傷害×1.5。\n按造成的實際HP損失1:1回復HP、50%回復MP，並依血能規則回充。成功吸血可從符合條件的獵物主動技能中選擇一項存入本場無上限的血液記憶庫；可略過，重複技能不再列出。覺醒5V才可使用記憶技能。使用後結束行動。",category:"SPECIAL",weapon:"rapier",power:1,manaCost:18,range:{min:1,max:5},target:"ENEMY",attackType:"PIERCE",element:"DARK",speed:15,support:false,bloodShadow:true},
  seraphina_blood_burst:{id:"seraphina_blood_burst",name:"血爆",description:"施放時自動搜尋自身技能射程內所有正在流血的敵軍，不用手動選擇敵人，不論流血由哪個友軍造成。每個合法流血敵人會立即引爆，不再進行普通武器命中判定；以施放瞬間的合法流血敵人各為爆炸中心，依正式攻防與爆擊規則對周遭敵軍造成範圍傷害；重疊爆點可以多次命中，但不遞迴引爆、不傷害友軍，也不移除流血。\n整次血爆只投入一次最多15血能取得5V攻擊增傷；按本次實際造成的敵軍HP損失回充血能。沒有合法流血敵人時不可施放。",category:"SPECIAL",weapon:"rapier",power:1.4,manaCost:22,range:{min:0,max:1},attackType:"PIERCE",element:"DARK",speed:10,target:"SELF",support:false,bloodBurst:true},
  seraphina_regeneration:{id:"seraphina_regeneration",name:"血之再生",description:"以魔力使自身血肉再生，回復80 HP（不超過最大HP）。這是治療，不是攻擊，不消耗覺醒攻擊的15點血能，也不直接產生血能。",category:"SPECIAL",power:0,manaCost:18,range:{min:0,max:0},target:"SELF",support:false,effects:[{type:"HEAL",amount:80}]},
  water_tentacle:{id:"water_tentacle",name:"觸手拖曳",category:"ATTACK",weapon:"claw",power:.95,range:{min:1,max:2},attackType:"STRIKE",element:"WATER",speed:0,target:"ENEMY",support:false,affixes:[],postEffects:[{type:"PULL",distance:2}]},

  velsa_arcane_bolt:{id:"velsa_arcane_bolt",description:"將黑紫色高維魔力凝成異界魔彈，對射程 2～4 格的敵軍造成暗屬性魔法傷害。可參與合法支援攻擊。Sanity 越低魔法威力越高，認知失控時可能將單體魔法誤導至射程內合法友軍。",name:"異界魔彈",category:"MAGIC",weapon:"staff",power:1.05,manaCost:12,range:{min:2,max:4},attackType:"MAGIC",element:"DARK",speed:0,target:"ENEMY",support:true,affixes:["SANITY_SCALING"]},
  velsa_cognitive_corruption:{id:"velsa_cognitive_corruption",description:"將目標所屬陣營的下一個完整戰棋回合導入獨立的認知幻象，最多產生 2 名已觀測敵影構成的假象。幻象中的 HP 傷亡不寫回真實戰場，真實資源消耗與行動標記則依共同認知規則結算。消耗 30 MP、20 Sanity。",name:"認知污染",category:"MAGIC",weapon:"staff",power:0,manaCost:30,resourceCosts:{sanity:20},range:{min:2,max:4},target:"ENEMY",targetType:"SINGLE",speed:-10,support:false,highDimensional:true,utilityAction:{type:"SCHEDULE_TURN_SIMULATION",mode:"MIRROR_PERCEPTION",durationTurns:1,illusionPool:"OBSERVED_HOSTILES",illusionCount:2},affixes:["HIGH_DIMENSION","COGNITIVE_CORRUPTION"]},
  velsa_space_fold:{id:"velsa_space_fold",description:"折疊中間空間，將薇爾莎直接傳送至射程 1～5 格內合法且無人佔據的落點，不要求視線，也不逐格穿越障礙。目的地的地形與環境仍正常生效；傳送門不持續存在。消耗 30 MP、10 Sanity。",name:"空間折疊",category:"SPECIAL",power:0,manaCost:30,resourceCosts:{sanity:10},range:{min:1,max:5},target:"TILE",targetType:"AOE",radius:0,speed:10,support:false,requiresVision:false,highDimensional:true,utilityAction:{type:"WORMHOLE_TRANSIT",entry:"CASTER_TILE",exit:"TARGET_TILE",ignoreIntermediate:true,requireLegalDestination:true,persists:false},affixes:["HIGH_DIMENSION","SPACE_FOLD"]},
  velsa_dimension_collapse:{id:"velsa_dimension_collapse",description:"指定射程 2～5 格內地格，對中心及其半徑 2 格內敵軍造成暗屬性範圍魔法傷害，中心威力乘 1.35；各目標依正式命中、暴擊、魔防及護盾規則結算。認知失控時有機率連同範圍內友軍一起波及。消耗 45 MP、15 Sanity。",name:"維度坍縮",category:"MAGIC",weapon:"staff",power:1.25,manaCost:45,resourceCosts:{sanity:15},range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,attackType:"MAGIC",element:"DARK",speed:-15,support:false,highDimensional:true,areaDamage:{mode:"MAGIC_POWER",centerMultiplier:1.35,relation:"ENEMY"},affixes:["HIGH_DIMENSION","SANITY_SCALING","DIMENSION_COLLAPSE"]},
  velsa_existence_breakdown:{id:"velsa_existence_breakdown",description:"對射程 2～5 格內單一敵軍施放高威力暗屬性魔法，依正式命中、暴擊、魔防及護盾結算。Sanity 越低魔法越強，認知失控時可能誤擊合法射程內友軍。純高威力單體攻擊，不具即死或無視魔防效果。消耗 55 MP、20 Sanity。",name:"存在崩解",category:"MAGIC",weapon:"staff",power:1.75,manaCost:55,resourceCosts:{sanity:20},range:{min:2,max:5},attackType:"MAGIC",element:"DARK",speed:-20,target:"ENEMY",support:false,highDimensional:true,affixes:["HIGH_DIMENSION","SANITY_SCALING","EXISTENCE_BREAKDOWN"]}
};
export const PASSIVES={
  GUARDIAN_INSTINCT:{id:"GUARDIAN_INSTINCT",name:"守護本能",category:"PASSIVE",defenseProfiles:[{id:"guardian_instinct_guard",method:"GUARD",name:"守護本能",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.70},PIERCE:{damageMultiplier:.75},SHOT:{damageMultiplier:.70},STRIKE:{damageMultiplier:.80},MAGIC:{damageMultiplier:.90}}}]},
  GUARD_ALLY:{id:"GUARD_ALLY",name:"援護防禦",category:"PASSIVE",defenseProfiles:[{id:"guard_ally",method:"GUARD",name:"援護防禦",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.65},PIERCE:{damageMultiplier:.70},SHOT:{damageMultiplier:.60},STRIKE:{damageMultiplier:.75},MAGIC:{damageMultiplier:.90}}}]},
  SWORDSMAN:{id:"SWORDSMAN",name:"劍術",category:"PASSIVE"},
  POLEARM:{id:"POLEARM",name:"長兵器",category:"PASSIVE"},
  ARCHERY:{id:"ARCHERY",name:"弓術",category:"PASSIVE"},
  HEAVY_STRIKE:{id:"HEAVY_STRIKE",name:"重擊",category:"PASSIVE"},
  ARCANE_TRAINING:{id:"ARCANE_TRAINING",name:"魔導",category:"PASSIVE"},
  RIDING:{id:"RIDING",name:"騎乘",category:"PASSIVE"},
  CHAMPION_SWORDSMAN:{id:"CHAMPION_SWORDSMAN",name:"冠軍劍士",category:"PASSIVE",description:"面對持劍對手時，以冠軍級劍術搶得交鋒先機。",vsWeaponKind:"SWORD",speedBonus:20},
  HUNTER_OF_THE_EDGE:{id:"HUNTER_OF_THE_EDGE",name:"林邊的獵人",category:"PASSIVE",description:"森林是卡恩最熟悉的獵場；在森林中提高命中與迴避，並忽略森林移動成本。",terrain:"FOREST",terrainTraits:["FOREST_WALK"],modifiers:{accuracy:10,evasion:10}},
  HERETIC:{id:"HERETIC",name:"異端",category:"PASSIVE",ignoreElementResistance:true},
  AMBUSH:{id:"AMBUSH",name:"伏擊",category:"PASSIVE",terrain:"FOREST",weaponKind:"BOW",powerMultiplier:1.20,speedBonus:20},
  PERFECT_GENOME_5V:{id:"PERFECT_GENOME_5V",name:"純種舊人類",category:"PASSIVE"},
  NO_CHANT:{id:"NO_CHANT",name:"無詠唱",category:"PASSIVE",magicNegativeSpeedAsZero:true},
  CAPTAIN_HIGHEST_AUTHORITY:{id:"CAPTAIN_HIGHEST_AUTHORITY",name:"最高艦長權限",category:"PASSIVE",turnEndEffect:{type:"DRAW",count:1}},
  DEEP_SEA_PHYSIQUE:{id:"DEEP_SEA_PHYSIQUE",name:"深海體魄",category:"PASSIVE",description:"能承受深海水壓的異常強韌體魄。受到近戰傷害降低 30%。",damageTakenRules:[{attackClass:"MELEE",multiplier:.70}]},
  SEA_SOVEREIGN:{id:"SEA_SOVEREIGN",name:"王者",category:"PASSIVE",description:"海世界女王的支配權。可直接控制深潭巨章，並在不擊敗牠的情況下取得其洪水卡牌。",encounterDominion:{monsterIds:["water_lurker"],fromTeams:["N"],grantEncounterRewards:true}},
  FELINE_NIGHT_VISION:{id:"FELINE_NIGHT_VISION",name:"貓眼夜視",category:"PASSIVE",description:"黑暗中能辨認更遠的輪廓；不穿透牆壁、濃煙與環境迷霧。",nightVision:{rangeBonus:2,maxRange:7}},
  ABYSSAL_NIGHT_VISION:{id:"ABYSSAL_NIGHT_VISION",name:"深海夜視",category:"PASSIVE",description:"深海生物的低光視覺；黑暗中的觀測距離高於一般人，但無法穿透物理遮蔽。",nightVision:{rangeBonus:3,maxRange:8}},
  FELINE_BODY:{id:"FELINE_BODY",name:"貓族體態",category:"PASSIVE",description:"攀上兩層高差，也能主動跳下任意高度的合法落點；墜落本身不造成傷害，但仍受地形及環境影響。",movementRules:{maxClimb:2},terrainTraits:["UNRESTRICTED_DESCENT"],fallRules:{safeDrop:2,damageMultiplier:0}},
  CAT_OPENING_STEALTH:{id:"CAT_OPENING_STEALTH",name:"夜行潛伏",category:"PASSIVE",description:"戰鬥開始時進入潛行。潛行無法阻止範圍攻擊，主動出手或被近距離發現時解除。",openingEffects:[{id:"STEALTH",type:"STEALTH",classification:"POSITIVE",detectionRange:1}]},

  ELVEN_PATHFINDER:{id:"ELVEN_PATHFINDER",name:"山林之民",category:"PASSIVE",description:"精靈在森林與山地如履平地。",terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"]},
  FOREST_LANGUAGE:{id:"FOREST_LANGUAGE",name:"森語",category:"PASSIVE",description:"每棵存活的樹與灌木都是奧菲獨立的遠端觀測節點，不需靠近或互相連接；節點遭破壞後立即失效。",observationNetworks:[{tag:"PLANT",objectTypes:["TREE","BUSH"],connectivity:"INDEPENDENT",nodeVisionRange:1,nodeDistance:"CHEBYSHEV",ignoreEnvironmentBlockers:true,revealStealth:true}]},
  FOREST_CHILD:{id:"FOREST_CHILD",name:"森之子",category:"PASSIVE",description:"奧菲部署上場時，戰場上現存的中立森林野獸主動加入我方；不生成野獸，也不額外取得擊敗獎勵。",encounterDominion:{families:["FOREST_BEAST"],fromTeams:["N"],grantEncounterRewards:false}},
  EAGLE_SHARED_VISION:{id:"EAGLE_SHARED_VISION",name:"鷹眼共享",category:"PASSIVE",description:"與實際存在於戰場上的老鷹夥伴共享視覺。老鷹被擊落後，共享觀測立即失效。",companionRules:{sharedVision:true}},
  STRONG_PHYSIQUE:{id:"STRONG_PHYSIQUE",name:"強健體魄",category:"PASSIVE",description:"異常強韌的體格使寇林不會被敵方擊退。",immunities:["KNOCKBACK"]},
  RANGER_COMMANDER:{id:"RANGER_COMMANDER",name:"遊俠隊長",category:"PASSIVE",description:"蕾娜保持原有的常規援護射擊能力：與發起攻擊的隊友距離不超過 2 格時，仍可依射程和視線參與普通支援射擊。額外提供 3 格指揮範圍，供集團齊射、急行軍、戰地補給和聯合衛哨使用；兩種射擊的判定不互相取代。",supportRules:{allyDistance:2},commandRadius:3},
  RANGER_STEADY:{id:"RANGER_STEADY",name:"臨陣不亂",category:"PASSIVE",description:"蕾娜存活時，指揮範圍內的所有友軍（包含自己）抵抗新施加負面異常的機率提高 25%。抵抗不會抵消攻擊本身的生命傷害，也不解除已存在的異常；離開指揮範圍後失效。",commandStatusResistance:25},
  FERVOR:{id:"FERVOR",name:"狂熱",category:"PASSIVE",description:"聖劍斬的物理或神聖傷害只要任一段爆擊，就對存活目標追加一次聖劍斬。追加攻擊獨立命中與雙重爆擊，不會再觸發狂熱，也不額外消耗行動或累積聖能。",followupOnCritical:{skillId:"templar_holy_slash"}},
  VENGEANCE:{id:"VENGEANCE",name:"復仇",category:"PASSIVE",description:"艾莉西亞或受她援護的友軍被敵人命中時，對攻擊者刻下持續兩回合的復仇聖印。只有艾莉西亞本人下一次命中該敵人時，整次技能攻擊傷害增加 25%，命中後消耗聖印；同一敵人不疊加，重複標記刷新時間。",seal:{id:"VENGEANCE_SEAL",duration:2,damageMultiplier:1.25}},
  STIGMATA:{id:"STIGMATA",name:"聖痕",category:"PASSIVE",description:"伊莉絲的治療、淨化與祝福會留下恩寵，抵消下一個可防禦的負面狀態。治癒祈禱或聖裁暴擊時，返還該次實際支付 MP 的一半。",criticalManaRefund:{skillIds:["saint_hero_heal","saint_judgement"],ratio:.5},skillTriggers:[{whenTags:["HEALING","PURIFICATION","BLESSING"],relations:["SELF","ALLY"],effect:{type:"BUFF",id:"GRACE",name:"恩寵",classification:"POSITIVE",duration:2,negativeEffectGuard:{charges:1}}}]},
  PATIENT:{id:"PATIENT",name:"病患／血能覺醒",category:"PASSIVE",description:"瑟拉菲娜的實際直接HP傷害1:1、自己造成的流血DOT傷害2:1累積血能，上限100。滿100立即覺醒5V，STR／AGI／INT／WIL／VIT各達20（LUK不變）。覺醒每次正式攻擊最多消耗15血能、每點+1%直接傷害；普通護盾之後，血盾每點血能吸收1點合法外部傷害，不抵擋中毒／流血、溺水或窒息。血能歸零且當次行動結算完成才解除5V；血液記憶保留到本場結束。",bloodRestoration:{grade:"5V",values:{str:20,agi:20,int:20,wil:20,vit:20}}},
  NIGHT_VEIL:{id:"NIGHT_VEIL",name:"夜色隱蔽",category:"PASSIVE",description:"夜晚自動潛行，攻擊或靠近敵人後會暴露，下個己方回合若仍是夜晚則再次隱蔽；入夜時夜視提升至最多10格。不能穿透牆壁、濃煙或暴風雪。",nightStealth:{id:"NIGHT_VEIL",detectionRange:1},nightVision:{rangeBonus:4,maxRange:10}},
  INCOMPLETE_HIGH_DIMENSION_CORRUPTION:{id:"INCOMPLETE_HIGH_DIMENSION_CORRUPTION",name:"不完全污染",category:"PASSIVE",description:"高維污染沒有完全覆寫薇爾莎的自我。Sanity 越低，魔法傷害越高，歸零時最大增加 50%；但每次實際發動魔法攻擊都有可能認知失控而誤傷友軍。誤傷機率隨 Sanity 線性上升，Sanity 100 時為 0%，歸零時為 25%。單體魔法偏移至射程內合法友軍，維度坍縮則可能連範圍內友軍一起波及。",sanityMisfire:{maxChance:.25}},
  COGNITIVE_BACKLASH:{id:"COGNITIVE_BACKLASH",name:"認知反噬",category:"PASSIVE",description:"認知失控導致的誤傷若造成友軍實際 HP 損失，按該次實際友軍 HP 傷害的 25% 回復 MP（向下取整），最多不超過此次技能實際消耗 MP。Miss、免疫與全額護盾吸收不回魔；多段或範圍技能每次施放只回魔一次。",friendlyFireManaReturn:{hpLossRatio:.25}}
};
export const SkillDatabase=(()=>{
  function get(id){const skill=SKILLS[id];if(!skill)throw new Error("Unknown skill: "+id);return skill}
  function list(ids){return(ids||[]).map(get)}
  // Both the browser's variant selection and authoritative network commands
  // use the SAME skill merge semantics. A variant's values override its parent,
  // without changing the canonical skill ID or inventing a second skill entry.
  function resolveVariant(skill,variantId){
    const base=typeof skill==='string'?get(skill):skill;
    if(!base)return null;
    if(variantId==null)return base;
    const variant=Array.isArray(base.variants)?base.variants.find(v=>v.id===variantId):null;
    if(!variant)return null;
    return {...base,...variant,id:base.id,name:variant.name||base.name,
      baseSkillId:base.id,variantId:variant.id,variants:undefined};
  }
  function getPassive(id){return PASSIVES[id]||null}
  function passiveList(ids){return(ids||[]).map(getPassive).filter(Boolean)}
  function passiveDefenseProfiles(ids){const profiles=[];for(const passive of passiveList(ids))for(const profile of passive.defenseProfiles||[])profiles.push({...profile,sourceId:passive.id,sourceName:passive.name,sourceType:"PASSIVE"});return profiles}
  // Skill text is read-only metadata. Combat numbers always come from the original skill entry.
  function inspect(skill){
    if(!skill)return null;
    const base=SKILLS[skill.baseSkillId]||SKILLS[skill.id]||skill;
    const active={...base,...skill};
    const range=active.range||base.range;
    const element={FIRE:"火",THUNDER:"雷",DARK:"暗",WATER:"水",LIGHT:"光",HOLY:"聖",NATURE:"自然"}[active.element];
    const relation={ALLY:"友軍",ENEMY:"敵軍",SELF:"自身",TILE:"地格"}[active.target];
    const costs=[];
    if(Number(active.manaCost)>0)costs.push(`魔力 ${active.manaCost}`);
    for(const [key,value] of Object.entries(active.resourceCosts||{}))if(Number(value)>0)costs.push(`${{holyPower:"聖能",faith:"信仰",blood:"血能",sanity:"Sanity"}[key]||key} ${value}`);
    const mechanics=[];
    if(range)mechanics.push(`射程 ${range.min}–${range.max}`);
    if(relation)mechanics.push(`目標 ${relation}`);
    if(element)mechanics.push(`屬性 ${element}`);
    if(costs.length)mechanics.push(`消耗 ${costs.join("、")}`);
    if(active._bloodMemory)mechanics.push("血液記憶：僅5V可施放；傷害技能另投入最多15血能增傷");
    if(active.bloodShadow||active.bloodBurst)mechanics.push("5V：攻擊額外投入最多15血能（每點+1%）");
    if(active.support===true)mechanics.push("可支援攻擊");
    const description=String(active.description||base.description||
      (active.target==="ENEMY"?`以「${active.name}」向敵人發動攻勢。`:active.target==="ALLY"?`以「${active.name}」支援隊友。`:active.target==="SELF"?`以「${active.name}」強化自身。`:`施展「${active.name}」，按照技能所指定的目標與效果行動。`));
    return{title:active.name||base.name,description,mechanics};
  }
  return{get,list,resolveVariant,getPassive,passiveList,passiveDefenseProfiles,inspect}
})();
globalThis.SKILLS=SKILLS;
globalThis.PASSIVES=PASSIVES;
globalThis.SkillDatabase=SkillDatabase;
