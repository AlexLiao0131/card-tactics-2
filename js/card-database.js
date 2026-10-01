export const CARDS={
  livia_card:{id:"livia_card",name:"莉維亞",type:"CHARACTER",characterId:"livia",loadoutId:"livia_default",faction:"HUNTER",unitType:"HERO",cost:6},
  leon_card:{id:"leon_card",name:"第一劍士・雷昂",type:"CHARACTER",characterId:"leon",loadoutId:"leon_default",faction:"IMPERIAL",unitType:"HERO",cost:6},
  kahn_card:{id:"kahn_card",name:"卡恩",type:"CHARACTER",characterId:"kahn",loadoutId:"kahn_default",faction:"HUNTER",unitType:"HERO",cost:6},
  cassandra_card:{id:"cassandra_card",name:"卡珊多拉",type:"CHARACTER",characterId:"cassandra",loadoutId:"cassandra_default",faction:"HUNTER",unitType:"HERO",cost:6},
  imperial_swordsman_card:{id:"imperial_swordsman_card",name:"帝國劍兵",type:"CHARACTER",characterId:"imperial_swordsman",loadoutId:"imperial_swordsman_default",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_spearman_card:{id:"imperial_spearman_card",name:"帝國槍兵",type:"CHARACTER",characterId:"imperial_spearman",loadoutId:"imperial_spearman_default",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_archer_card:{id:"imperial_archer_card",name:"帝國弓手",type:"CHARACTER",characterId:"imperial_archer",loadoutId:"imperial_archer_default",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_heavy_guard_card:{id:"imperial_heavy_guard_card",name:"帝國重甲兵",type:"CHARACTER",characterId:"imperial_heavy_guard",loadoutId:"imperial_heavy_guard_default",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_hammer_card:{id:"imperial_hammer_card",name:"帝國錘兵",type:"CHARACTER",characterId:"imperial_hammer",loadoutId:"imperial_hammer_default",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_mage_card:{id:"imperial_mage_card",name:"帝國法師",type:"CHARACTER",characterId:"imperial_mage",loadoutId:"imperial_mage_default",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_cavalry_card:{id:"imperial_cavalry_card",name:"帝國騎兵",type:"CHARACTER",characterId:"imperial_cavalry",loadoutId:"imperial_cavalry_default",faction:"IMPERIAL",unitType:"UNIT",cost:5},
  thunderstorm_card:{id:"thunderstorm_card",name:"雷雨",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:5,effect:{type:"WEATHER",weather:"THUNDERSTORM",lightning:true,durationTurns:2}},
  wildfire_card:{id:"wildfire_card",name:"野火",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:4,effect:{type:"AREA_FIRE",radius:1,forces:["FIRE"]}},
  tornado_card:{id:"tornado_card",name:"龍捲風",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:5,effect:{type:"AREA_PUSH",radius:1,distance:2,lift:3,damage:20,resistAxes:{horizontal:false,vertical:true},forces:["WIND"],fireTornadoDamage:45}},
  miracle_card:{id:"miracle_card",name:"神跡",type:"SPELL",spellType:"HEAL",faction:"NEUTRAL",cost:6,effect:{type:"AREA_HEAL",radius:1,heal:80,team:"PLAYER"}},
  fog_card:{id:"fog_card",name:"迷霧",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:3,effect:{type:"WEATHER",weather:"FOG",durationTurns:2}},
  starfall_card:{id:"starfall_card",name:"星隕",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:10,effect:{type:"AREA_DAMAGE",radius:2,damage:100,forces:["HEAVY_FIRE","EXPLOSION","IMPACT"]}},
  snow_card:{id:"snow_card",name:"降雪",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:4,effect:{type:"WEATHER",weather:"SNOW",durationTurns:3}},
  scorching_sun_card:{id:"scorching_sun_card",name:"烈日",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:5,effect:{type:"WEATHER",weather:"SCORCHING_SUN",durationTurns:3}},
  blizzard_card:{id:"blizzard_card",name:"暴風雪",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:6,effect:{type:"WEATHER",weather:"BLIZZARD",durationTurns:2}},
  bear_trap_card:{id:"bear_trap_card",name:"捕熊陷阱",type:"SPELL",spellType:"TRAP",faction:"HUNTER",cost:2,effect:{type:"TRAP"}},
  avalanche_card:{id:"avalanche_card",name:"雪崩",type:"SPELL",spellType:"TACTICAL",faction:"HUNTER",cost:6,effect:{type:"AREA_DAMAGE",radius:0,damage:0,forces:["AVALANCHE_TRIGGER"]}},
  cassandra_blessing_card:{id:"cassandra_blessing_card",name:"卡珊多拉的祝福",type:"SPELL",spellType:"BUFF",faction:"HUNTER",cost:4,effect:{type:"BUFF"}},
  rain_card:{id:"rain_card",name:"豪大雨",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:4,effect:{type:"WEATHER",weather:"HEAVY_RAIN",durationTurns:2}},
  resurrection_card:{id:"resurrection_card",name:"復甦",type:"SPELL",spellType:"REVIVE",faction:"NEUTRAL",cost:7,effect:{type:"REVIVE",zone:"GRAVEYARD"}},
  reina_card:{id:"reina_card",name:"蕾娜",type:"CHARACTER",characterId:"reina",loadoutId:"reina_default",faction:"ELF_EMPIRE",unitType:"HERO",cost:6},
  elf_shapeshifter_card:{id:"elf_shapeshifter_card",name:"精靈幻獸者",type:"CHARACTER",characterId:"elf_shapeshifter",loadoutId:"elf_shapeshifter_default",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_ranger_card:{id:"elf_ranger_card",name:"精靈遊俠",type:"CHARACTER",characterId:"elf_ranger",loadoutId:"elf_ranger_default",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_guard_card:{id:"elf_guard_card",name:"精靈衛士",type:"CHARACTER",characterId:"elf_guard",loadoutId:"elf_guard_default",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_priest_card:{id:"elf_priest_card",name:"精靈祭司",type:"CHARACTER",characterId:"elf_priest",loadoutId:"elf_priest_default",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},

  flood_card:{id:"flood_card",name:"洪水術",type:"SPELL",spellType:"TACTICAL",faction:"MONSTER",cost:4,acquisition:"ENCOUNTER",lifetime:"BATTLE",collectible:false,availability:"BATTLE_ONLY",source:"ENCOUNTER",effect:{type:"HYDROLOGY_FLOOD",radius:2,surfaceRise:1}},

  ophi_card:{id:"ophi_card",name:"奧菲",type:"CHARACTER",characterId:"ophi",loadoutId:"ophi_default",faction:"ELVEN",unitType:"HERO",cost:6,pack:"OPHI_SUPPLEMENT"},
  ophi_eagle_card:{id:"ophi_eagle_card",name:"奧菲的老鷹",type:"CHARACTER",characterId:"ophi_eagle",loadoutId:"ophi_eagle_default",faction:"ELVEN",unitType:"COMPANION",cost:0,acquisition:"GENERATED",lifetime:"BATTLE",collectible:false,availability:"BATTLE_ONLY",source:"OPHI_COMPANION",handSizeExempt:true,mulliganEligible:false},
  colin_card:{id:"colin_card",name:"寇林",type:"CHARACTER",characterId:"colin",loadoutId:"colin_default",faction:"ELVEN",unitType:"HERO",cost:6,pack:"OPHI_SUPPLEMENT"},
  moon_goddess_blessing_card:{id:"moon_goddess_blessing_card",name:"月神祝福",type:"SPELL",spellType:"BUFF",faction:"ELVEN",cost:4,pack:"OPHI_SUPPLEMENT",effect:{type:"RACE_NIGHT_BUFF",race:"ELF",scope:"ALL_FRIENDLY_ON_FIELD",requiresTimeOfDay:"NIGHT",modifiers:{powerMultiplier:1.15,speed:10}}},

  church_apprentice_card:{id:"church_apprentice_card",name:"騎士學徒",type:"CHARACTER",characterId:"church_apprentice",loadoutId:"church_apprentice_default",faction:"CHURCH",unitType:"UNIT",cost:3},
  church_heavy_knight_card:{id:"church_heavy_knight_card",name:"重裝騎士",type:"CHARACTER",characterId:"church_heavy_knight",loadoutId:"church_heavy_knight_default",faction:"CHURCH",unitType:"UNIT",cost:4},
  church_templar_card:{id:"church_templar_card",name:"聖殿騎士",type:"CHARACTER",characterId:"church_templar",loadoutId:"church_templar_default",faction:"CHURCH",unitType:"UNIT",cost:5},
  church_bishop_card:{id:"church_bishop_card",name:"主教",type:"CHARACTER",characterId:"church_bishop",loadoutId:"church_bishop_default",faction:"CHURCH",unitType:"UNIT",cost:4},
  church_templar_hero_card:{id:"church_templar_hero_card",name:"艾莉西亞・羅恩菲爾",type:"CHARACTER",characterId:"church_templar_hero",loadoutId:"church_templar_hero_default",faction:"CHURCH",unitType:"HERO",cost:6},
  church_redemption_card:{id:"church_redemption_card",name:"救贖",type:"SPELL",spellType:"REVIVE",faction:"CHURCH",cost:6,effect:{type:"REVIVE",zone:"GRAVEYARD"}},
  church_dispel_card:{id:"church_dispel_card",name:"驅散",type:"SPELL",spellType:"DISPEL",faction:"CHURCH",cost:3,effect:{type:"DISPEL",classification:"NEGATIVE",target:"ALLY"}},
  church_judgement_card:{id:"church_judgement_card",name:"懲戒",type:"SPELL",spellType:"TACTICAL",faction:"CHURCH",cost:5,effect:{type:"AREA_RELATION",radius:1,effects:[{relation:"ALLY",type:"HEAL",amount:60},{relation:"ENEMY",type:"MAGIC_DAMAGE",amount:65,element:"HOLY",traitMultipliers:{UNDEAD:2}}]}},
  church_entrenchment_card:{id:"church_entrenchment_card",name:"陣地戰",type:"SPELL",spellType:"BUFF",faction:"CHURCH",cost:4,effect:{type:"AREA_BUFF",radius:2,duration:3,targetFilter:{relation:"ALLY",faction:"CHURCH"},buff:{id:"CHURCH_ENTRENCHMENT",classification:"POSITIVE",modifiers:{def:15,mdef:10,guardMultiplier:.8}}}},
  church_saint_card:{id:"church_saint_card",name:"伊莉絲・羅恩菲爾",type:"CHARACTER",characterId:"church_saint",loadoutId:"church_saint_default",faction:"CHURCH",unitType:"HERO",cost:6,pack:"SAINT_SUPPLEMENT"},

  seraphina_card:{id:"seraphina_card",name:"瑟拉菲娜",type:"CHARACTER",characterId:"seraphina",loadoutId:"seraphina_default",faction:"VAMPIRE",unitType:"HERO",cost:6,pack:"SERAPHINA_SUPPLEMENT"},
  nereia_card:{id:"nereia_card",name:"深海女王・涅瑞雅",type:"CHARACTER",characterId:"nereia",loadoutId:"nereia_default",faction:"SEA_WORLD",unitType:"HERO",cost:6,pack:"SEA_WORLD_SUPPLEMENT"},
  cat_thief_hero_card:{id:"cat_thief_hero_card",name:"米菈",type:"CHARACTER",characterId:"cat_thief_hero",loadoutId:"cat_thief_hero_default",faction:"BEAST",unitType:"HERO",cost:6,pack:"BEAST_SUPPLEMENT"},
  angel_archer_hero_card:{id:"angel_archer_hero_card",name:"天使族弓箭手",type:"CHARACTER",characterId:"angel_archer_hero",loadoutId:"angel_archer_hero_default",faction:"ANGEL",unitType:"HERO",cost:6,pack:"ANGEL_SUPPLEMENT"}
};
export const CardDatabase=(()=>{
  const AVAILABILITY=Object.freeze({COLLECTION:"COLLECTION",BATTLE_ONLY:"BATTLE_ONLY"});
  const ACQUISITION=Object.freeze({COLLECTION:"COLLECTION",ENCOUNTER:"ENCOUNTER",GENERATED:"GENERATED",SCRIPTED:"SCRIPTED"});
  const LIFETIME=Object.freeze({PERMANENT:"PERMANENT",BATTLE:"BATTLE",TURN:"TURN"});
  function get(id){return CARDS[id]||null;} function list(ids){return(ids||[]).map(id=>CARDS[id]).filter(Boolean);}
  function availability(card){return card?.availability||AVAILABILITY.COLLECTION;} function acquisition(card){return card?.acquisition||ACQUISITION.COLLECTION;}
  function lifetime(card){if(card?.lifetime)return card.lifetime;return availability(card)===AVAILABILITY.BATTLE_ONLY?LIFETIME.BATTLE:LIFETIME.PERMANENT;}
  function isBattleOnly(card){return lifetime(card)===LIFETIME.BATTLE||availability(card)===AVAILABILITY.BATTLE_ONLY;} function canPersist(card){return !!card&&lifetime(card)===LIFETIME.PERMANENT&&card.collectible!==false;}
  function isCharacter(card){return card?.type==="CHARACTER";} function isSpell(card){return card?.type==="SPELL";}
  return Object.freeze({AVAILABILITY,ACQUISITION,LIFETIME,get,list,availability,acquisition,lifetime,isBattleOnly,canPersist,isCharacter,isSpell});
})();
globalThis.CARDS=CARDS;
globalThis.CardDatabase=CardDatabase;
