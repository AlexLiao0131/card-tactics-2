export const SKILLS={
  bow_shot:{id:"bow_shot",name:"弓箭射擊",category:"ATTACK",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  black_slash:{id:"black_slash",name:"黑劍斬擊",category:"ATTACK",weapon:"black_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  shadow_step:{id:"shadow_step",name:"幽影步",category:"SPECIAL",power:0,range:{min:1,max:4},target:"TILE",targetType:"AOE",shape:"W_STEP",moveToTarget:true,ignorePath:true,support:false,resource:{type:"USES",max:2},affixes:[]},
  nether_slash:{id:"nether_slash",name:"幽冥斬擊",category:"SPECIAL",weapon:"black_sword",power:1.25,range:{min:1,max:3},attackType:"SLASH",element:"DARK",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:["SPACE_RIFT"]},
  thunder_enchant:{id:"thunder_enchant",name:"雷元素附魔",category:"MAGIC",weapon:"kahns_bow",power:1,range:{min:1,max:4},attackType:"SHOT",element:"THUNDER",speed:0,target:"ENEMY",targetType:"SINGLE",support:false,resource:{type:"USES",max:3},affixes:[],variants:[
    {id:"THUNDER_ARROW_SINGLE",name:"雷箭・單體",weapon:"kahns_bow",power:1.05,range:{min:2,max:4},attackType:"SHOT",element:"THUNDER",target:"ENEMY",targetType:"SINGLE"},
    {id:"THUNDER_ARROW_AOE",name:"雷箭・環境傳導",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"THUNDER",target:"TILE",targetType:"AOE",radius:1,environmentRequirement:"CONDUCTIVE",environmentForces:["THUNDER"],aoeDamage:55},
    {id:"THUNDER_SWORD",name:"雷劍",weapon:"black_sword",power:1.1,range:{min:1,max:1},attackType:"SLASH",element:"THUNDER",target:"ENEMY",targetType:"SINGLE"}
  ]},
  fire_enchant:{id:"fire_enchant",name:"火元素附魔",category:"MAGIC",weapon:"kahns_bow",power:1,range:{min:1,max:4},attackType:"SHOT",element:"FIRE",speed:0,target:"ENEMY",targetType:"SINGLE",support:false,resource:{type:"USES",max:3},affixes:[],variants:[
    {id:"FIRE_ARROW_SINGLE",name:"火箭・單體",weapon:"kahns_bow",power:1.05,range:{min:2,max:4},attackType:"SHOT",element:"FIRE",target:"ENEMY",targetType:"SINGLE",statusEffects:[{type:"BURN",chance:100}]},
    {id:"FIRE_ARROW_AOE",name:"火箭・爆裂",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"FIRE",target:"TILE",targetType:"AOE",radius:1,environmentForces:["FIRE","EXPLOSION"],aoeDamage:45},
    {id:"FIRE_SWORD",name:"火劍",weapon:"black_sword",power:1.1,range:{min:1,max:1},attackType:"SLASH",element:"FIRE",target:"ENEMY",targetType:"SINGLE",statusEffects:[{type:"BURN",chance:100}]}
  ]},
  slash:{id:"slash",name:"制式斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  heavy_slash:{id:"heavy_slash",name:"重裝斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:-5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  claw:{id:"claw",name:"利爪攻擊",category:"ATTACK",weapon:"claw",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  club:{id:"club",name:"木棒敲擊",category:"ATTACK",weapon:"club",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  blessed_slash:{id:"blessed_slash",name:"祝福劍斬擊",category:"ATTACK",weapon:"blessed_sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  thrust:{id:"thrust",name:"制式突刺",category:"ATTACK",weapon:"spear",power:1,range:{min:1,max:2},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  smash:{id:"smash",name:"戰錘重擊",category:"ATTACK",weapon:"hammer",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[],postEffects:[{type:"KNOCKBACK",distance:2}]},
  magic_bolt:{id:"magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"staff",power:1,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  imperial_bow_shot:{id:"imperial_bow_shot",name:"帝國弓射",category:"ATTACK",weapon:"bow",power:1,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  cavalry_slash:{id:"cavalry_slash",name:"騎兵斬擊",category:"ATTACK",weapon:"sword",power:1.05,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_slash:{id:"leon_slash",name:"劍斬",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_thrust:{id:"leon_thrust",name:"精準突刺",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_strike:{id:"leon_strike",name:"破甲劍擊",category:"ATTACK",weapon:"star_iron_sword",power:1.1,range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  lion_flash:{id:"lion_flash",name:"奧義・獅子瞬斬",category:"ATTACK",weapon:"star_iron_sword",power:1.4,range:{min:1,max:4},attackType:"SLASH",element:"INHERIT",speed:10,target:"TILE",targetType:"AOE",shape:"LINE",moveToTarget:true,support:false,resource:{type:"USES",max:2},affixes:[]},
  kahn_precision:{id:"kahn_precision",name:"精準射擊",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  kahn_snipe:{id:"kahn_snipe",name:"狙殺",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.4,range:{min:3,max:6},attackType:"SHOT",element:"INHERIT",speed:-15,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:[]},
  kahn_knife:{id:"kahn_knife",name:"近身獵殺",category:"ATTACK",weapon:"hunting_knife",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  cassandra_magic_bolt:{id:"cassandra_magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"cassandra_staff",power:1,range:{min:2,max:4},attackType:"MAGIC",element:"NONE",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  cassandra_fire_burst:{id:"cassandra_fire_burst",name:"炎爆術",category:"MAGIC",weapon:"cassandra_staff",power:1.25,range:{min:2,max:4},attackType:"MAGIC",element:"FIRE",speed:-5,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:[],statusEffects:[{type:"BURN",chance:100}]},
  cassandra_frost:{id:"cassandra_frost",name:"寒霜術",category:"MAGIC",weapon:"cassandra_staff",power:1.1,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:[]},
  cassandra_dissolve:{id:"cassandra_dissolve",name:"異端術式・崩解",category:"MAGIC",weapon:"cassandra_staff",power:1.5,range:{min:2,max:5},attackType:"MAGIC",element:"NONE",speed:-15,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:[]},

  nereia_trident_thrust:{id:"nereia_trident_thrust",name:"三叉戟突刺",category:"ATTACK",weapon:"trident",power:1.10,range:{min:1,max:2},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  nereia_water_bullet:{id:"nereia_water_bullet",name:"水彈",category:"MAGIC",weapon:"trident",power:1.05,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  nereia_tsunami:{id:"nereia_tsunami",name:"海嘯",category:"MAGIC",weapon:"trident",power:0,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,speed:-10,support:false,resource:{type:"USES",max:2},requiresVision:true,hydrologyFlood:{surfaceRise:1.25},affixes:["WATER_TERRAIN_CONTROL"]},
  aquatic_depth_control:{id:"aquatic_depth_control",name:"水深控制",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"UNLIMITED"},variants:[
    {id:"AQUATIC_DIVE",name:"下潛",requirements:{water:true},utilityAction:{type:"SET_VERTICAL_MODE",mode:"DIVING",consumeTurn:false}},
    {id:"AQUATIC_SURFACE",name:"浮上海面",requirements:{water:true},utilityAction:{type:"SET_VERTICAL_MODE",mode:"SWIMMING",consumeTurn:false}}
  ]},

  cat_dual_slash:{id:"cat_dual_slash",name:"雙匕首連斬",category:"ATTACK",weapon:"daggers",power:1.0,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:15,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  cat_backstab:{id:"cat_backstab",name:"背刺",category:"ATTACK",weapon:"daggers",power:1.05,range:{min:1,max:1},attackType:"PIERCE",element:"INHERIT",speed:20,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},backstabMultiplier:1.65,affixes:["BACKSTAB"]},
  cat_poison_knife:{id:"cat_poison_knife",name:"淬毒投擲刀",category:"ATTACK",weapon:"throwing_knife",power:.8,range:{min:2,max:4},attackType:"PIERCE",attackClass:"RANGED",element:"INHERIT",speed:10,target:"ENEMY",support:false,resource:{type:"USES",max:3},onHitBonusDamage:{amount:18,damageType:"POISON",name:"毒藥"},affixes:["POISON"]},
  cat_thief_trap:{id:"cat_thief_trap",name:"盜賊陷阱",category:"SPECIAL",power:0,range:{min:1,max:3},target:"TILE",targetType:"AOE",radius:0,support:false,resource:{type:"USES",max:2},trapPlacement:{duration:4,damage:25,name:"盜賊陷阱"}},
  cat_steal_card:{id:"cat_steal_card",name:"偷竊",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ENEMY",support:false,resource:{type:"USES",max:2},utilityAction:{type:"STEAL_CARD",consumeTurn:true}},
  cat_hide:{id:"cat_hide",name:"再次潛行",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"UNLIMITED"},utilityAction:{type:"ENTER_STEALTH",consumeTurn:true}},

  angel_bow_shot:{id:"angel_bow_shot",name:"天使弓射",category:"ATTACK",weapon:"bow",power:1.05,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:10,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  angel_holy_shot:{id:"angel_holy_shot",name:"神聖附魔射擊",category:"MAGIC",weapon:"bow",power:1.15,range:{min:2,max:5},attackType:"SHOT",attackClass:"RANGED",element:"HOLY",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:["HOLY_ENCHANT"]},
  angel_heal:{id:"angel_heal",name:"治療魔法",category:"MAGIC",power:0,range:{min:1,max:4},target:"ALLY",support:false,resource:{type:"USES",max:3},effects:[{type:"HEAL",amount:80}]},
  angel_lift_drop:{id:"angel_lift_drop",name:"升空摔落",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ENEMY",support:false,resource:{type:"USES",max:2},utilityAction:{type:"LIFT_DROP",consumeTurn:true,minDrop:3}},
  angel_carry_ally:{id:"angel_carry_ally",name:"空運友軍",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ALLY",support:false,resource:{type:"UNLIMITED"},requirements:{notCarrying:true,notMoved:true},utilityAction:{type:"CARRY_ALLY",releaseSkillId:"angel_release_ally",consumeTurn:false}},
  angel_release_ally:{id:"angel_release_ally",name:"放下友軍",category:"SPECIAL",power:0,range:{min:1,max:5},target:"TILE",targetType:"AOE",radius:0,support:false,resource:{type:"UNLIMITED"},requirements:{carrying:true},utilityAction:{type:"RELEASE_CARRIED",consumeTurn:true}},
  angel_wing_control:{id:"angel_wing_control",name:"翼行控制",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"UNLIMITED"},variants:[
    {id:"ANGEL_LAND",name:"降落",utilityAction:{type:"SET_VERTICAL_MODE",mode:"GROUND",consumeTurn:false}},
    {id:"ANGEL_TAKEOFF",name:"起飛",utilityAction:{type:"SET_VERTICAL_MODE",mode:"FLYING",consumeTurn:false}}
  ]}
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
  CHAMPION_SWORDSMAN:{id:"CHAMPION_SWORDSMAN",name:"冠軍劍士",category:"PASSIVE",vsWeaponKind:"SWORD",speedBonus:20},
  HUNTER_OF_THE_EDGE:{id:"HUNTER_OF_THE_EDGE",name:"林邊的獵人",category:"PASSIVE",terrain:"FOREST",modifiers:{accuracy:10,evasion:10}},
  HERETIC:{id:"HERETIC",name:"異端",category:"PASSIVE",ignoreElementResistance:true},
  AMBUSH:{id:"AMBUSH",name:"伏擊",category:"PASSIVE",terrain:"FOREST",weaponKind:"BOW",powerMultiplier:1.20,speedBonus:20},
  PERFECT_GENOME_5V:{id:"PERFECT_GENOME_5V",name:"純種舊人類",category:"PASSIVE"},
  NO_CHANT:{id:"NO_CHANT",name:"無詠唱",category:"PASSIVE",magicNegativeSpeedAsZero:true},
  CAPTAIN_HIGHEST_AUTHORITY:{id:"CAPTAIN_HIGHEST_AUTHORITY",name:"最高艦長權限",category:"PASSIVE",turnEndEffect:{type:"DRAW",count:1}},
  DEEP_SEA_PHYSIQUE:{id:"DEEP_SEA_PHYSIQUE",name:"深海體魄",category:"PASSIVE",description:"能承受深海水壓的異常強韌體魄。受到近戰傷害降低 30%。",damageTakenRules:[{attackClass:"MELEE",multiplier:.70}]},
  SEA_SOVEREIGN:{id:"SEA_SOVEREIGN",name:"王者",category:"PASSIVE",description:"海世界女王的支配權。可直接控制深潭巨章，並在不擊敗牠的情況下取得其洪水卡牌。",encounterDominion:{monsterIds:["water_lurker"],fromTeams:["N"],grantEncounterRewards:true}},
  FELINE_BODY:{id:"FELINE_BODY",name:"貓族體態",category:"PASSIVE",description:"靈活的貓族身體能直接攀上兩層高差，並大幅減輕墜落傷害。",movementRules:{maxClimb:2},fallRules:{safeDrop:2,damageMultiplier:.5}},
  CAT_OPENING_STEALTH:{id:"CAT_OPENING_STEALTH",name:"夜行潛伏",category:"PASSIVE",description:"戰鬥開始時進入潛行。潛行無法阻止範圍攻擊，主動出手或被近距離發現時解除。",openingEffects:[{id:"STEALTH",type:"STEALTH",classification:"POSITIVE",detectionRange:1}]}
};
export const SkillDatabase=(()=>{
  function get(id){const skill=SKILLS[id];if(!skill)throw new Error("Unknown skill: "+id);return skill}
  function list(ids){return(ids||[]).map(get)}
  function getPassive(id){return PASSIVES[id]||null}
  function passiveList(ids){return(ids||[]).map(getPassive).filter(Boolean)}
  function passiveDefenseProfiles(ids){const profiles=[];for(const passive of passiveList(ids))for(const profile of passive.defenseProfiles||[])profiles.push({...profile,sourceId:passive.id,sourceName:passive.name,sourceType:"PASSIVE"});return profiles}
  return{get,list,getPassive,passiveList,passiveDefenseProfiles}
})();
globalThis.SKILLS=SKILLS;
globalThis.PASSIVES=PASSIVES;
globalThis.SkillDatabase=SkillDatabase;
