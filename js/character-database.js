import {BattleEngine} from "./battle-engine.js";
import {RESOURCE_PROFILES} from "./resource-profile-database.js";
export const CHARACTERS={
// 3V = AGI / INT / WIL. All combat figures derive from the canonical CASTER six-stat profile.
alchemist:{id:'alchemist',name:'梅莉安・羅森菲爾',title:'旅行煉金術士・萬象的採集者',visualId:'alchemist_default',
  race:'HUMAN',faction:'ALCHEMY',archetype:'MAGE',genetics:{grade:'3V',values:['AGI','INT','WIL']},
  attributes:{str:8,agi:20,int:20,wil:20,vit:12,luk:14},
  combat:{move:5},resourceRules:{mana:false,alchemyRune:{label:'煉成紋路',max:3,initial:0,naturalRecovery:0}},
  alchemyHarvest:true,passives:['ALCHEMIST_GATHERING'],
  lore:{role:'透過無損採集戰場素材施展五種煉成術，三次有效煉成後能重塑真實地形',
    notes:'3V 為 AGI、INT、WIL。沒有 MP。普通素材與帶元素高品質素材二擇一；高品質本身自帶元素。單一腹部煉成符文由左到右逐漸發光。'}},
magda:{id:'magda',name:'瑪格妲・瓦爾加',title:'競技場的戰獅',visualId:'magda_default',
  race:'GIANT_BLOODLINE',faction:'ARENA',archetype:'GLADIATOR',genetics:{grade:'3V',values:['STR','AGI','VIT']},
  attributes:{str:20,agi:20,int:8,wil:14,vit:20,luk:12},
  combat:{move:5},statAdjustments:{hp:1,atk:2,matk:-15,def:-9,mdef:-4},
  resourceRules:{mana:false,rage:RESOURCE_PROFILES.rage},displacement:{weightClass:'HEAVY',resistance:2},
  passives:['MAGDA_BATTLE_HUNGER','MAGDA_GIANT_STRENGTH'],
  lore:{role:'豪放的女競技場鬥士／巨人後裔',daughter:'蘿莎・瓦爾加',
    notes:'豪放坦率，繼承巨人血統；競技場外是疼愛女兒的母親。'}} ,
livia:{id:"livia",name:"莉維亞",visualId:"livia_default",archetype:"RANGED",resourceRules:{mana:true,duality:{}},attributes:{str:20,agi:20,int:20,wil:20,vit:20,luk:16},combat:{move:5},statAdjustments:{hp:-41,atk:-8,matk:-2,def:-17,mdef:3},passives:["CAPTAIN_HIGHEST_AUTHORITY","MANA_SENSE","AMBUSH"]},
leon:{id:"leon",name:"第一劍士・雷昂",visualId:"leon_default",archetype:"MELEE",attributes:{str:20,agi:18,int:8,wil:14,vit:17,luk:12},combat:{move:4},statAdjustments:{hp:-8,atk:-6,matk:0,def:0,mdef:-5},passives:["FIRST_SWORD","OFFENSE_DEFENSE_UNITY"]},
kahn:{id:"kahn",name:"卡恩",archetype:"RANGED",attributes:{str:17,agi:20,int:10,wil:17,vit:15,luk:18},combat:{move:5},statAdjustments:{hp:1,atk:6,matk:-2,def:-1,mdef:-10},passives:["HUNTER_OF_THE_EDGE"]},
cassandra:{id:"cassandra",name:"卡珊多拉",visualId:"cassandra_default",archetype:"MAGE",attributes:{str:6,agi:11,int:20,wil:19,vit:10,luk:13},combat:{move:4},statAdjustments:{hp:-5,atk:0,matk:-2,def:-1,mdef:1},passives:["HERETIC"]},
imperial_swordsman:{id:"imperial_swordsman",name:"帝國劍兵",visualId:"imperial_swordsman_default",archetype:"MELEE",attributes:{str:12,agi:10,int:6,wil:9,vit:12,luk:8},combat:{move:4},statAdjustments:{hp:-1,atk:2,matk:2,def:7,mdef:2},passives:["SWORDSMAN"]},
imperial_spearman:{id:"imperial_spearman",visualId:"imperial_spearman_default",name:"帝國槍兵",archetype:"MELEE",attributes:{str:12,agi:10,int:5,wil:9,vit:12,luk:7},combat:{move:4},statAdjustments:{hp:-6,atk:0,matk:3,def:1,mdef:0},passives:["POLEARM"]},
imperial_archer:{id:"imperial_archer",name:"帝國弓手",visualId:"imperial_archer_default",archetype:"RANGED",attributes:{str:10,agi:12,int:6,wil:9,vit:9,luk:9},combat:{move:4},statAdjustments:{hp:13,atk:8,matk:3,def:5,mdef:2},passives:["ARCHERY"]},
imperial_heavy_guard:{id:"imperial_heavy_guard",name:"帝國重甲兵",archetype:"DEFENDER",attributes:{str:13,agi:7,int:5,wil:10,vit:15,luk:7},combat:{move:3},statAdjustments:{hp:21,atk:4,matk:-4,def:15,mdef:-2},passives:["GUARD_ALLY"]},
imperial_hammer:{id:"imperial_hammer",name:"帝國錘兵",archetype:"MELEE",attributes:{str:14,agi:7,int:5,wil:9,vit:14,luk:6},combat:{move:3},statAdjustments:{hp:8,atk:0,matk:3,def:3,mdef:2},passives:["HEAVY_STRIKE"]},
imperial_mage:{id:"imperial_mage",name:"帝國法師",archetype:"MAGE",attributes:{str:5,agi:8,int:14,wil:12,vit:8,luk:9},combat:{move:4},statAdjustments:{hp:0,atk:1,matk:9,def:3,mdef:2},passives:["ARCANE_TRAINING"]},
imperial_cavalry:{id:"imperial_cavalry",name:"帝國騎兵",archetype:"MOBILE",attributes:{str:14,agi:14,int:5,wil:10,vit:13,luk:8},combat:{move:7},statAdjustments:{hp:8,atk:2,matk:3,def:4,mdef:-1},passives:["RIDING"]},
forest_beast:{id:"forest_beast",name:"森林魔物",archetype:"MELEE",attributes:{str:11,agi:11,int:5,wil:8,vit:11,luk:7},combat:{move:4},statAdjustments:{hp:4,atk:-2,matk:-1,def:-9,mdef:2}},
unarmored_dummy:{id:"unarmored_dummy",name:"無甲訓練假人（測試）",archetype:"DEFENDER",attributes:{str:5,agi:5,int:5,wil:5,vit:10,luk:5},combat:{move:0},statAdjustments:{hp:-33,atk:-6,matk:-8,def:-37,mdef:-4}},
water_guard_test:{id:"water_guard_test",name:"水屬性護甲兵（測試）",archetype:"DEFENDER",attributes:{str:10,agi:8,int:8,wil:12,vit:12,luk:7},combat:{move:4},statAdjustments:{hp:-13,atk:0,matk:3,def:-7,mdef:8}},
elf_guard_test:{id:"elf_guard_test",name:"精靈護衛（神器招架測試）",archetype:"DEFENDER",attributes:{str:13,agi:15,int:12,wil:15,vit:12,luk:12},combat:{move:5},statAdjustments:{hp:-13,atk:0,matk:1,def:0,mdef:4}},

avreshi:{id:"avreshi",name:"艾芙蕾希・月痕",title:"月林祭司",race:"ELF",faction:"ELVEN",
  visualId:"avreshi_human",archetype:"DRUID_SHAPESHIFTER",
  attributes:{str:13,agi:18,int:20,wil:20,vit:14,luk:16},
  combat:{move:5},statAdjustments:{hp:13,atk:14,matk:-5,def:6,mdef:-5},
  resourceRules:{mana:true,astralPower:{}},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],
  passives:["ELVEN_PATHFINDER","AVRESHI_NATURE_STRIKE","AVRESHI_BARKSKIN"],
  forms:{default:"HUMAN",available:["HUMAN","CHEETAH","SEAL","RAVEN"],
    HUMAN:{name:"人形態",visualId:"avreshi_human",skillIds:['avreshi_moonfire', 'avreshi_tornado', 'avreshi_lightning', 'avreshi_rejuvenation', 'avreshi_starfall', 'avreshi_spear_throw', 'avreshi_spear_thrust', 'avreshi_to_human', 'avreshi_to_cheetah', 'avreshi_to_seal', 'avreshi_to_raven'],
      terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],passives:["ELVEN_PATHFINDER","AVRESHI_NATURE_STRIKE","AVRESHI_BARKSKIN"],movementMode:"GROUND"},
    CHEETAH:{name:"獵豹形態",visualId:"avreshi_cheetah",skillIds:['avreshi_pounce', 'avreshi_bite', 'avreshi_claw', 'avreshi_shred', 'avreshi_swipe', 'avreshi_hide', 'avreshi_to_human', 'avreshi_to_cheetah', 'avreshi_to_seal', 'avreshi_to_raven'],
      terrainTraits:["FOREST_WALK"],passives:["AVRESHI_NATURE_STRIKE","FELINE_NIGHT_VISION","AVRESHI_WOUND_INFECTION","AVRESHI_BARKSKIN"],
      movementMode:"GROUND",movementModifier:1,autostealth:true},
    SEAL:{name:"海豹形態",visualId:"avreshi_seal",skillIds:['avreshi_dive', 'avreshi_surface', 'avreshi_carry', 'avreshi_release', 'avreshi_whirlpool', 'avreshi_press', 'avreshi_to_human', 'avreshi_to_cheetah', 'avreshi_to_seal', 'avreshi_to_raven'],
      terrainTraits:["AQUATIC","AMPHIBIOUS","DIVING"],passives:["AVRESHI_NATURE_STRIKE","AVRESHI_BARKSKIN"],
      movementMode:"SWIMMING",movementModifier:-2,
      verticalMobility:{modes:["SWIMMING","DIVING"],canDive:true,surfaceImmersion:.65,diveDepth:1.5,maxDiveDepth:6},
      transport:{capacityClass:"MEDIUM"}},
    RAVEN:{name:"烏鴉形態",visualId:"avreshi_raven",skillIds:['avreshi_share_vision', 'avreshi_item_delivery', 'avreshi_to_human', 'avreshi_to_cheetah', 'avreshi_to_seal', 'avreshi_to_raven'],
      terrainTraits:["FLYING"],passives:["AVRESHI_NATURE_STRIKE","AVRESHI_BARKSKIN"],
      movementMode:"FLYING",movementModifier:2,
      verticalMobility:{defaultMode:"FLYING",modes:["FLYING"],canFly:true,flightAltitude:3,maxFlightAltitude:6,visionRangePerAltitude:1},
      cargo:{capacity:1,payloadTypes:["ITEM"]},inventorySlots:1}
  },
  lore:{role:"侍奉月神的精靈德魯伊／四形態戰場支援",notes:"使用月林儀式長矛，世界八階段月相與月光影響星能累積；月火、回春術、落雷產生星能，星隕消耗40星能且不額外消耗MP；四形態共享生命、法力、星能、行動與異常狀態。"}},
reina:{id:"reina",name:"蕾娜",visualId:"reina_default",race:"ELF",faction:"ELF_EMPIRE",archetype:"RANGER_CAPTAIN",attributes:{str:18,agi:20,int:16,wil:19,vit:18,luk:15},combat:{move:5},statAdjustments:{hp:15,atk:2,matk:-4,def:11,mdef:-1},passives:["RANGER_COMMANDER","RANGER_STEADY"],terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],lore:{role:"精靈帝國遊俠隊長／中距離指揮支援",notes:"能以弓劍切換作戰，並從較寬的隊形距離參與支援攻擊。"}},
elf_shapeshifter:{id:"elf_shapeshifter",name:"精靈幻獸者",race:"ELF",faction:"ELF_EMPIRE",archetype:"SHAPESHIFTER",attributes:{str:14,agi:15,int:14,wil:16,vit:14,luk:10},combat:{move:5},statAdjustments:{hp:8,atk:8,matk:-9,def:1,mdef:-12},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],forms:{default:"ELF",available:["ELF","BEAR"],BEAR:{name:"熊形態",armorType:"HEAVY",combatModifiers:{hp:70,atk:18,def:35,move:-1},attackType:"STRIKE"}}},
elf_ranger:{id:"elf_ranger",name:"精靈遊俠",race:"ELF",faction:"ELF_EMPIRE",archetype:"RANGED",attributes:{str:15,agi:17,int:12,wil:14,vit:14,luk:12},combat:{move:5},statAdjustments:{hp:6,atk:-1,matk:-1,def:8,mdef:2},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],passives:["ARCHERY"]},
elf_guard:{id:"elf_guard",name:"精靈衛士",race:"ELF",faction:"ELF_EMPIRE",archetype:"DEFENDER",attributes:{str:16,agi:11,int:10,wil:16,vit:18,luk:9},combat:{move:4},statAdjustments:{hp:0,atk:-5,matk:-7,def:8,mdef:-2},passives:["GUARD_ALLY"],terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"]},
elf_priest:{id:"elf_priest",name:"精靈祭司",race:"ELF",faction:"ELF_EMPIRE",archetype:"HEALER",attributes:{str:8,agi:13,int:17,wil:18,vit:12,luk:13},combat:{move:5},statAdjustments:{hp:-6,atk:-4,matk:-1,def:0,mdef:-2},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],passives:["ARCANE_TRAINING"]},

ophi:{id:"ophi",name:"奧菲",race:"ELF",faction:"ELVEN",visualId:"ophi_default",archetype:"RANGED",attributes:{str:20,agi:20,int:20,wil:20,vit:18,luk:18},combat:{move:5},statAdjustments:{hp:-15,atk:-4,matk:-4,def:-7,mdef:1},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],resourceRules:{mana:true,forestSoul:{label:"森靈之魂",max:30,initial:0,naturalRecovery:0,collectionRadius:2,regenerationRounds:3}},passives:["ELVEN_PATHFINDER","FOREST_LANGUAGE","EAGLE_SHARED_VISION","FOREST_CHILD","FOREST_SOUL_RESONANCE"],lore:{role:"莉維亞第一位夥伴",genetics:"4V",notes:"精靈由遠古人類基因改造而來，為適應現今環境而分化。"}},
ophi_eagle:{id:"ophi_eagle",name:"奧菲的老鷹",race:"ANIMAL",faction:"ELVEN",visualId:"ophi_eagle",archetype:"COMPANION_SCOUT",unitRole:"COMPANION",companionId:"ophi_eagle",ownerCharacterId:"ophi",participatesInTurn:true,occupiesTile:true,canAttack:false,canCapture:false,countsForObjectives:false,attributes:{str:6,agi:20,int:4,wil:10,vit:8,luk:16},combat:{move:7},statAdjustments:{hp:0,atk:0,matk:0,def:0,mdef:0},terrainTraits:["FLYING"],verticalMobility:{defaultMode:"FLYING",modes:["FLYING"],canFly:true,minFlightAltitude:1,flightAltitude:4,maxFlightAltitude:8,flightAltitudeStep:1,visionRangePerAltitude:1},cargo:{capacity:1,payloadTypes:["ITEM"]},displacement:{weightClass:"LIGHT"},collision:{height:.7},visionRange:5,resourceRules:{mana:false},lore:{role:"奧菲的高空偵察／後勤夥伴",notes:"由奧菲部署後生成的戰鬥限定夥伴卡。可自由調整飛行高度、共享高空視野並攜帶一件 ITEM 類道具；不能攻擊或佔領據點。"}},
colin:{id:"colin",name:"寇林",race:"ELF",faction:"ELVEN",visualId:"colin_default",archetype:"DEFENDER",attributes:{str:20,agi:20,int:13,wil:17,vit:18,luk:14},combat:{move:4},statAdjustments:{hp:15,atk:-4,matk:-6,def:4,mdef:-2},terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"],passives:["ELVEN_PATHFINDER","STRONG_PHYSIQUE","COLIN_LAST_LINE","COLIN_SHIELD_MASTERY"],lore:{role:"專職坦克",genetics:"2V",notes:"STR、AGI為V。以足以遮蔽全身的大盾守住戰線，戰錘負責破甲與擊退。"}},

church_apprentice:{id:"church_apprentice",name:"騎士學徒",faction:"CHURCH",archetype:"MELEE",attributes:{str:11,agi:10,int:7,wil:10,vit:11,luk:8},combat:{move:4},statAdjustments:{hp:-6,atk:2,matk:5,def:3,mdef:6}},
church_heavy_knight:{id:"church_heavy_knight",name:"重裝騎士",faction:"CHURCH",archetype:"DEFENDER",attributes:{str:14,agi:7,int:7,wil:12,vit:15,luk:8},combat:{move:3},statAdjustments:{hp:21,atk:3,matk:1,def:16,mdef:0},passives:[]},
church_templar:{id:"church_templar",name:"聖殿騎士",faction:"CHURCH",archetype:"DEFENDER",attributes:{str:16,agi:10,int:10,wil:16,vit:17,luk:9},combat:{move:4},statAdjustments:{hp:-5,atk:3,matk:8,def:4,mdef:0},passives:[]},
church_bishop:{id:"church_bishop",name:"主教",faction:"CHURCH",archetype:"HEALER",attributes:{str:7,agi:9,int:17,wil:18,vit:11,luk:12},combat:{move:4},statAdjustments:{hp:-1,atk:-2,matk:1,def:2,mdef:2}},
church_templar_hero:{id:"church_templar_hero",name:"艾莉西亞・羅恩菲爾",title:"女聖殿騎士",faction:"CHURCH",race:"ANCIENT_HUMAN",visualId:"church_templar_hero_default",archetype:"TEMPLAR_HERO",genetics:{grade:"3V"},attributes:{str:20,agi:16,int:14,wil:20,vit:20,luk:13},combat:{move:4},statAdjustments:{hp:14,atk:6,matk:11,def:10,mdef:-3},resourceRules:{mana:true,holyPower:{label:"聖能",max:3,initial:0,naturalRecovery:0}},passives:["FERVOR","VENGEANCE"],lore:{fullName:"Alicia Rohenfeld",relation:"伊莉絲・羅恩菲爾之姊",genetics:"3V",role:"亡國第一王女／前線守護型聖殿騎士",notes:"逃亡時妹妹覺醒，雙手劍自此維持常駐神聖附魔。擅長衝鋒建立戰線、援護友軍與固守陣地。"}},
church_saint:{id:"church_saint",visualId:"church_saint_default",name:"伊莉絲・羅恩菲爾",title:"聖女",faction:"CHURCH",race:"ANCIENT_HUMAN",archetype:"SAINT",genetics:{grade:"3V"},attributes:{str:9,agi:14,int:20,wil:20,vit:13,luk:20},combat:{move:4},statAdjustments:{hp:-1,atk:-7,matk:3,def:-1,mdef:9},resourceRules:{mana:true,faith:{label:"信仰",max:100,initial:50,naturalRecovery:0}},passives:["STIGMATA"],lore:{fullName:"Elise Rohenfeld",relation:"艾莉西亞・羅恩菲爾之妹",genetics:"3V",role:"亡國第二王女／聖女／神聖領域支援",notes:"以聖裁、治療、淨化、祝福與聖域支援戰線。聖痕能令她的主要祝禱為目標留下恩寵，抵消下一次可防禦的負面狀態。"}},

seraphina:{id:"seraphina",name:"瑟拉菲娜",race:"ANCIENT_HUMAN",traits:["VAMPIRE"],faction:"VAMPIRE",visualId:"seraphina_default",archetype:"BLOOD_DUELIST_EVASION_TANK",genetics:{grade:"IMPERFECT_ANCIENT_HUMAN",restoredGrade:"5V",trigger:"BLOOD"},attributes:{str:18,agi:19,int:17,wil:16,vit:15,luk:14},combat:{move:5},statAdjustments:{hp:5,atk:6,matk:-1,def:1,mdef:0},modifiers:{evasion:20,crit:5,speed:10},resourceRules:{mana:true,blood:{label:"血能",max:100,initial:0,naturalRecovery:0}},passives:["PATIENT","NIGHT_VEIL"],lore:{genetics:"IMPERFECT_ANCIENT_HUMAN",role:"細劍閃避坦／血術決鬥者",notes:"遠古人類病患。直接HP傷害的30%及流血DOT實際HP傷害的15%轉換血能；每次技能最多獲得35點，滿100點覺醒5V；攻擊、血盾及血液記憶共用血能。"}},

water_lurker:{id:"water_lurker",name:"深潭巨章",race:"AQUATIC_MONSTER",faction:"MONSTER",archetype:"MELEE",attributes:{str:15,agi:10,int:8,wil:12,vit:17,luk:8},combat:{move:3},statAdjustments:{hp:0,atk:0,matk:0,def:0,mdef:0},statProfile:'BOSS',displacement:{weightClass:"HEAVY"},terrainTraits:["AQUATIC"],verticalMobility:{defaultMode:"DIVING",modes:["SWIMMING","DIVING"],surfaceImmersion:1,diveDepth:1.5,maxDiveDepth:4}},

nereia:{id:"nereia",name:"涅瑞雅",title:"深海女王",race:"AQUATIC",faction:"SEA_WORLD",visualId:"nereia_default",archetype:"AQUATIC_DEFENDER",genetics:{grade:"4V"},resourceRules:{mana:true,humidity:{label:"濕度",max:100,initial:100,naturalRecovery:0,magicDefenseMaxBonus:.30,waterManaDiscountMax:.30}},attributes:{str:20,agi:14,int:20,wil:20,vit:20,luk:12},combat:{move:4},statAdjustments:{hp:-6,atk:-2,matk:1,def:-12,mdef:1},terrainTraits:["AQUATIC","AMPHIBIOUS","DIVING"],movementProfile:{waterCost:2/3},verticalMobility:{modes:["SWIMMING","DIVING"],canDive:true,surfaceImmersion:.7,diveDepth:1.5,maxDiveDepth:6},passives:["DEEP_SEA_PHYSIQUE","SEA_SOVEREIGN","ABYSSAL_NIGHT_VISION"],lore:{genetics:"4V",role:"海世界女王／水域坦克",notes:"STR、INT、WIL、VIT 為 V。能承受深海水壓，在水域擁有遠高於陸地的機動力。"}},
cat_thief_hero:{id:"cat_thief_hero",name:"米菈",title:"貓女盜賊",race:"CATKIN",faction:"BEAST",visualId:"cat_thief_default",archetype:"STEALTH_THIEF",genetics:{grade:"3V"},attributes:{str:20,agi:20,int:9,wil:11,vit:12,luk:20},combat:{move:6},statAdjustments:{hp:-5,atk:-6,matk:1,def:-1,mdef:0},modifiers:{evasion:15,crit:5},passives:["FELINE_BODY","CAT_OPENING_STEALTH","FELINE_NIGHT_VISION"],lore:{genetics:"3V",role:"高速潛行盜賊",notes:"STR、AGI、LUK 為 V。擅長背刺、奪取敵方財物、煙霧掩護、毒投擲與高低差機動。"}},
angel_archer_hero:{id:"angel_archer_hero",name:"艾蕾希雅",race:"ANGEL",faction:"ANGEL",visualId:"angel_archer_default",archetype:"FLYING_ARCHER_SUPPORT",genetics:{grade:"4V"},attributes:{str:20,agi:20,int:16,wil:20,vit:14,luk:20},combat:{move:5},statAdjustments:{hp:21,atk:-4,matk:10,def:2,mdef:5},terrainTraits:["FLYING"],verticalMobility:{defaultMode:"FLYING",modes:["FLYING"],canFly:true,flightAltitude:2,maxFlightAltitude:4},displacement:{weightClass:"MEDIUM"},transport:{capacityClass:"MEDIUM"},lore:{genetics:"4V",role:"空中長射程／神聖支援",notes:"STR、AGI、WIL、LUK 為 V。可主動降落、搬運輕型友軍，或將較輕敵人升空摔落。"}},

velsa:{id:"velsa",name:"薇爾莎・奈赫爾",race:"DEMON",traits:["HIGH_DIMENSION_CORRUPTED"],faction:"DEMON",visualId:"velsa_default",archetype:"DIMENSION_MAGE",genetics:{grade:"4V",origin:"ANCIENT_PERFECT_HUMAN"},attributes:{str:10,agi:20,int:20,wil:20,vit:20,luk:8},combat:{move:4},statAdjustments:{hp:-9,atk:-9,matk:5,def:-9,mdef:5},resourceRules:{mana:true,sanity:{label:"Sanity",max:100,initial:100,naturalRecovery:0,costMode:"DRAIN",allowOverdraft:true,magicScaling:{maxBonus:.5}}},passives:["INCOMPLETE_HIGH_DIMENSION_CORRUPTION","COGNITIVE_BACKLASH"],lore:{genetics:"4V",role:"高維污染法師／空間術式",notes:"遠古高科技完美人類在探索中接觸高維存在，污染先侵入伺服器、AI與腦機網路，再如病毒般改寫使用者的認知與肉體。多數受污染者逐漸失去三維人類的自我；薇爾莎卻因污染不完整而保留人格與溝通能力。Sanity 越低，她越接近完整魔族狀態，魔法也越強。"}},

imperial_spearman_test:null,imperial_hammer_test:null,imperial_mage_test:null
};
CHARACTERS.imperial_spearman_test=CHARACTERS.imperial_spearman;
CHARACTERS.imperial_hammer_test=CHARACTERS.imperial_hammer;
CHARACTERS.imperial_mage_test=CHARACTERS.imperial_mage;

// Base combat is derived once from the shared six-attribute + class template.
// Calibration offsets are fixed differences from the pre-migration main roster,
// not a second attack/defense formula. New characters need no offsets.
const initializedCharacters=new WeakSet();
for(const character of Object.values(CHARACTERS)){
  if(!character?.attributes||!character?.combat||initializedCharacters.has(character))continue;
  initializedCharacters.add(character);
  character.combat=BattleEngine.deriveCombatFromAttributes(
    character.combat,character.attributes,character.attributes,character);
}

export const CharacterDatabase=(()=>{
  function get(id){return CHARACTERS[id]||null}
  function list(ids=[]){return(ids||[]).map(get).filter(Boolean)}
  return Object.freeze({get,list});
})();

globalThis.CHARACTERS=CHARACTERS;
globalThis.CharacterDatabase=CharacterDatabase;
