export const CARDS={
  livia_card:{id:"livia_card",name:"莉維亞",type:"CHARACTER",characterId:"livia",faction:"HUNTER",unitType:"HERO",cost:6},
  leon_card:{id:"leon_card",name:"第一劍士・雷昂",type:"CHARACTER",characterId:"leon",faction:"IMPERIAL",unitType:"HERO",cost:6},
  kahn_card:{id:"kahn_card",name:"卡恩",type:"CHARACTER",characterId:"kahn",faction:"HUNTER",unitType:"HERO",cost:6},
  cassandra_card:{id:"cassandra_card",name:"卡珊多拉",type:"CHARACTER",characterId:"cassandra",faction:"HUNTER",unitType:"HERO",cost:6},
  imperial_swordsman_card:{id:"imperial_swordsman_card",name:"帝國劍兵",type:"CHARACTER",characterId:"imperial_swordsman",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_spearman_card:{id:"imperial_spearman_card",name:"帝國槍兵",type:"CHARACTER",characterId:"imperial_spearman",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_archer_card:{id:"imperial_archer_card",name:"帝國弓手",type:"CHARACTER",characterId:"imperial_archer",faction:"IMPERIAL",unitType:"UNIT",cost:3},
  imperial_heavy_guard_card:{id:"imperial_heavy_guard_card",name:"帝國重甲兵",type:"CHARACTER",characterId:"imperial_heavy_guard",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_hammer_card:{id:"imperial_hammer_card",name:"帝國錘兵",type:"CHARACTER",characterId:"imperial_hammer",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_mage_card:{id:"imperial_mage_card",name:"帝國法師",type:"CHARACTER",characterId:"imperial_mage",faction:"IMPERIAL",unitType:"UNIT",cost:4},
  imperial_cavalry_card:{id:"imperial_cavalry_card",name:"帝國騎兵",type:"CHARACTER",characterId:"imperial_cavalry",faction:"IMPERIAL",unitType:"UNIT",cost:5},
  thunderstorm_card:{id:"thunderstorm_card",name:"雷雨",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:5,effect:{type:"WEATHER",weather:"THUNDERSTORM",lightning:true,durationTurns:2}},
  wildfire_card:{id:"wildfire_card",name:"野火",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:4,effect:{type:"AREA_FIRE",radius:1,forces:["FIRE"]}},
  tornado_card:{id:"tornado_card",name:"龍捲風",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:5,effect:{type:"AREA_PUSH",radius:1,distance:2,lift:3,damage:20,resistAxes:{horizontal:false,vertical:true},forces:["WIND"],fireTornadoDamage:45}},
  miracle_card:{id:"miracle_card",name:"神跡",type:"SPELL",spellType:"HEAL",faction:"NEUTRAL",cost:6,effect:{type:"AREA_HEAL",radius:1,heal:80,team:"PLAYER"}},
  fog_card:{id:"fog_card",name:"迷霧",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:3,effect:{type:"WEATHER",weather:"FOG",durationTurns:2}},
  starfall_card:{id:"starfall_card",name:"星隕",type:"SPELL",spellType:"TACTICAL",faction:"NEUTRAL",cost:10,effect:{type:"AREA_DAMAGE",radius:2,damage:100,forces:["HEAVY_FIRE","EXPLOSION","IMPACT"]}},
  snow_card:{id:"snow_card",name:"降雪",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:4,effect:{type:"WEATHER",weather:"SNOW",durationTurns:3}},
  blizzard_card:{id:"blizzard_card",name:"暴風雪",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:6,effect:{type:"WEATHER",weather:"BLIZZARD",durationTurns:2}},
  bear_trap_card:{id:"bear_trap_card",name:"捕熊陷阱",type:"SPELL",spellType:"TRAP",faction:"HUNTER",cost:2,effect:{type:"TRAP"}},
  avalanche_card:{id:"avalanche_card",name:"雪崩",type:"SPELL",spellType:"TACTICAL",faction:"HUNTER",cost:6,effect:{type:"AREA_DAMAGE",radius:0,damage:0,forces:["AVALANCHE_TRIGGER"]}},
  cassandra_blessing_card:{id:"cassandra_blessing_card",name:"卡珊多拉的祝福",type:"SPELL",spellType:"BUFF",faction:"HUNTER",cost:4,effect:{type:"BUFF"}},
  rain_card:{id:"rain_card",name:"豪大雨",type:"SPELL",spellType:"WEATHER",faction:"NEUTRAL",cost:4,effect:{type:"WEATHER",weather:"HEAVY_RAIN",durationTurns:2}},
  resurrection_card:{id:"resurrection_card",name:"復甦",type:"SPELL",spellType:"REVIVE",faction:"NEUTRAL",cost:7,effect:{type:"REVIVE",zone:"GRAVEYARD"}},
  reina_card:{id:"reina_card",name:"蕾娜",type:"CHARACTER",characterId:"reina",faction:"ELF_EMPIRE",unitType:"HERO",cost:6},
  elf_shapeshifter_card:{id:"elf_shapeshifter_card",name:"精靈幻獸者",type:"CHARACTER",characterId:"elf_shapeshifter",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_ranger_card:{id:"elf_ranger_card",name:"精靈遊俠",type:"CHARACTER",characterId:"elf_ranger",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_guard_card:{id:"elf_guard_card",name:"精靈衛士",type:"CHARACTER",characterId:"elf_guard",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4},
  elf_priest_card:{id:"elf_priest_card",name:"精靈祭司",type:"CHARACTER",characterId:"elf_priest",faction:"ELF_EMPIRE",unitType:"UNIT",cost:4}
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
