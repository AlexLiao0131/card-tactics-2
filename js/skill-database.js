export const SKILLS={
  bow_shot:{id:"bow_shot",name:"弓箭射擊",category:"ATTACK",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  black_slash:{id:"black_slash",name:"黑劍斬擊",category:"ATTACK",weapon:"black_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  shadow_step:{id:"shadow_step",name:"幽影步",category:"SPECIAL",power:0,range:{min:1,max:4},target:"TILE",targetType:"AOE",shape:"W_STEP",moveToTarget:true,ignorePath:true,support:false,resource:{type:"USES",max:2},affixes:[]},
  nether_slash:{id:"nether_slash",name:"幽冥斬擊",category:"SPECIAL",weapon:"black_sword",power:1.25,range:{min:1,max:3},attackType:"SLASH",element:"DARK",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:["SPACE_RIFT"]},
  thunder_enchant:{id:"thunder_enchant",name:"雷元素附魔",category:"MAGIC",weapon:"kahns_bow",power:1,manaCost:18,range:{min:1,max:4},attackType:"SHOT",element:"THUNDER",speed:0,target:"ENEMY",targetType:"SINGLE",support:false,resource:{type:"USES",max:3},affixes:[],variants:[
    {id:"THUNDER_ARROW_SINGLE",name:"雷箭・單體",weapon:"kahns_bow",power:1.05,range:{min:2,max:4},attackType:"SHOT",element:"THUNDER",target:"ENEMY",targetType:"SINGLE"},
    {id:"THUNDER_ARROW_AOE",name:"雷箭・環境傳導",weapon:"kahns_bow",power:1,range:{min:2,max:4},attackType:"SHOT",element:"THUNDER",target:"TILE",targetType:"AOE",radius:1,environmentRequirement:"CONDUCTIVE",environmentForces:["THUNDER"],aoeDamage:55},
    {id:"THUNDER_SWORD",name:"雷劍",weapon:"black_sword",power:1.1,range:{min:1,max:1},attackType:"SLASH",element:"THUNDER",target:"ENEMY",targetType:"SINGLE"}
  ]},
  fire_enchant:{id:"fire_enchant",name:"火元素附魔",category:"MAGIC",weapon:"kahns_bow",power:1,manaCost:18,range:{min:1,max:4},attackType:"SHOT",element:"FIRE",speed:0,target:"ENEMY",targetType:"SINGLE",support:false,resource:{type:"USES",max:3},affixes:[],variants:[
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
  magic_bolt:{id:"magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"staff",power:1,manaCost:10,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  imperial_bow_shot:{id:"imperial_bow_shot",name:"帝國弓射",category:"ATTACK",weapon:"bow",power:1,range:{min:2,max:4},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  cavalry_slash:{id:"cavalry_slash",name:"騎兵斬擊",category:"ATTACK",weapon:"sword",power:1.05,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_slash:{id:"leon_slash",name:"劍斬",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_thrust:{id:"leon_thrust",name:"精準突刺",category:"ATTACK",weapon:"star_iron_sword",power:1,range:{min:1,max:1},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  leon_strike:{id:"leon_strike",name:"破甲劍擊",category:"ATTACK",weapon:"star_iron_sword",power:1.1,range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  lion_flash:{id:"lion_flash",name:"奧義・獅子瞬斬",category:"ATTACK",weapon:"star_iron_sword",power:1.4,range:{min:1,max:4},attackType:"SLASH",element:"INHERIT",speed:10,target:"TILE",targetType:"AOE",shape:"LINE",moveToTarget:true,support:false,resource:{type:"USES",max:2},affixes:[]},
  kahn_precision:{id:"kahn_precision",name:"精準射擊",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  kahn_snipe:{id:"kahn_snipe",name:"狙殺",category:"ATTACK",weapon:"kahn_hunter_bow",power:1.4,range:{min:3,max:6},attackType:"SHOT",element:"INHERIT",speed:-15,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:[]},
  kahn_knife:{id:"kahn_knife",name:"近身獵殺",category:"ATTACK",weapon:"hunting_knife",power:1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  cassandra_magic_bolt:{id:"cassandra_magic_bolt",name:"魔力彈",category:"MAGIC",weapon:"cassandra_staff",power:1,manaCost:12,range:{min:2,max:4},attackType:"MAGIC",element:"NONE",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  cassandra_fire_burst:{id:"cassandra_fire_burst",name:"炎爆術",category:"MAGIC",weapon:"cassandra_staff",power:1.25,manaCost:24,range:{min:2,max:4},attackType:"MAGIC",element:"FIRE",speed:-5,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:[],statusEffects:[{type:"BURN",chance:100}]},
  cassandra_frost:{id:"cassandra_frost",name:"寒霜術",category:"MAGIC",weapon:"cassandra_staff",power:1.1,manaCost:18,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:[],statusEffects:[{type:"BUFF",id:"FROST_SLOW",name:"寒霜遲滯",classification:"NEGATIVE",duration:2,modifiers:{move:-1,speed:-20},chance:100}]},
  cassandra_dissolve:{id:"cassandra_dissolve",name:"異端術式・崩解",category:"MAGIC",weapon:"cassandra_staff",power:1.5,manaCost:30,range:{min:2,max:5},attackType:"MAGIC",element:"NONE",speed:-15,target:"ENEMY",support:false,resource:{type:"USES",max:2},affixes:[]},

  reina_blessed_slash:{id:"reina_blessed_slash",name:"隊長劍術",category:"ATTACK",weapon:"blessed_sword",power:1.15,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  reina_command_shot:{id:"reina_command_shot",name:"指揮射擊",category:"ATTACK",weapon:"bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:5,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  reina_rally:{id:"reina_rally",name:"遊俠號令",category:"SPECIAL",power:0,manaCost:14,range:{min:0,max:3},target:"ALLY",support:false,resource:{type:"USES",max:3},effects:[{type:"BUFF",id:"RANGER_CAPTAIN_ORDER",name:"遊俠號令",classification:"POSITIVE",duration:2,modifiers:{accuracy:10,evasion:10,speed:10}}]},

  nereia_trident_thrust:{id:"nereia_trident_thrust",name:"三叉戟突刺",category:"ATTACK",weapon:"trident",power:1.10,range:{min:1,max:2},attackType:"PIERCE",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  nereia_water_bullet:{id:"nereia_water_bullet",name:"水彈",category:"MAGIC",weapon:"trident",power:1.05,manaCost:12,range:{min:2,max:4},attackType:"MAGIC",element:"WATER",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[]},
  nereia_tsunami:{id:"nereia_tsunami",name:"海嘯",category:"MAGIC",weapon:"trident",power:0,manaCost:28,range:{min:2,max:5},target:"TILE",targetType:"AOE",radius:2,speed:-10,support:false,resource:{type:"USES",max:2},requiresVision:true,hydrologyFlood:{surfaceRise:1.25},affixes:["WATER_TERRAIN_CONTROL"]},
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
  angel_holy_shot:{id:"angel_holy_shot",name:"神聖附魔射擊",category:"MAGIC",weapon:"bow",power:1.15,manaCost:14,range:{min:2,max:5},attackType:"SHOT",attackClass:"RANGED",element:"HOLY",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:3},affixes:["HOLY_ENCHANT"]},
  angel_heal:{id:"angel_heal",name:"治療魔法",category:"MAGIC",power:0,manaCost:20,range:{min:1,max:4},target:"ALLY",support:false,resource:{type:"USES",max:3},effects:[{type:"HEAL",amount:80}]},
  angel_lift_drop:{id:"angel_lift_drop",name:"升空摔落",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ENEMY",support:false,resource:{type:"USES",max:2},utilityAction:{type:"LIFT_DROP",consumeTurn:true,minDrop:3}},
  angel_carry_ally:{id:"angel_carry_ally",name:"空運友軍",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ALLY",support:false,resource:{type:"UNLIMITED"},requirements:{notCarrying:true,notMoved:true},utilityAction:{type:"CARRY_ALLY",releaseSkillId:"angel_release_ally",consumeTurn:false}},
  angel_release_ally:{id:"angel_release_ally",name:"放下友軍",category:"SPECIAL",power:0,range:{min:1,max:5},target:"TILE",targetType:"AOE",radius:0,support:false,resource:{type:"UNLIMITED"},requirements:{carrying:true},utilityAction:{type:"RELEASE_CARRIED",consumeTurn:true}},
  angel_wing_control:{id:"angel_wing_control",name:"翼行控制",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"UNLIMITED"},variants:[
    {id:"ANGEL_LAND",name:"降落",utilityAction:{type:"SET_VERTICAL_MODE",mode:"GROUND",consumeTurn:false}},
    {id:"ANGEL_TAKEOFF",name:"起飛",utilityAction:{type:"SET_VERTICAL_MODE",mode:"FLYING",consumeTurn:false}}
  ]},

  ophi_elven_shot:{id:"ophi_elven_shot",name:"精靈弓射",category:"ATTACK",weapon:"elven_bow",power:1.1,range:{min:2,max:5},attackType:"SHOT",element:"INHERIT",speed:5,target:"ENEMY",support:true,resource:{type:"UNLIMITED"},affixes:[]},
  ophi_eagle_arc_shot:{id:"ophi_eagle_arc_shot",name:"鷹眼曲射",category:"ATTACK",weapon:"elven_bow",power:1.25,range:{min:3,max:8},attackType:"SHOT",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"USES",max:2},trajectory:"ARC",requiresCompanionVision:"ophi_eagle",affixes:["ARC_SHOT"]},
  ophi_healing_song:{id:"ophi_healing_song",name:"治癒歌聲",category:"MAGIC",power:0,manaCost:24,range:{min:0,max:3},target:"ALLY",targetType:"AOE",radius:2,speed:-5,support:false,resource:{type:"USES",max:2},effects:[{type:"HEAL_OVER_TIME",id:"OPHI_HEALING_SONG",name:"治癒歌聲",classification:"POSITIVE",amount:20,duration:3}],soundMagic:true,affixes:["HEAL_OVER_TIME"]},
  ophi_listen_to_forest:{id:"ophi_listen_to_forest",name:"聆聽森語",category:"SPECIAL",power:0,manaCost:12,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"UNLIMITED"},effects:[{type:"BUFF",id:"FOREST_SENSE",name:"森語感知",classification:"POSITIVE",duration:2,revealStealthRange:4,visionRules:{ignoreEnvironmentBlockers:true,maxRange:4},modifiers:{accuracy:10}}],informationSkill:true,affixes:["FOREST_SENSE"]},
  colin_full_shield_defense:{id:"colin_full_shield_defense",name:"大盾防禦",category:"SPECIAL",power:0,range:{min:0,max:0},target:"SELF",speed:-5,support:false,resource:{type:"UNLIMITED"},requiresEquipment:"colin_full_body_shield",stance:{type:"FULL_SHIELD_DEFENSE",protectsBehind:true,blocksEnemyRoute:true,enhancedGuard:true},effects:[{type:"BUFF",id:"FULL_SHIELD_DEFENSE",name:"大盾防禦",classification:"POSITIVE",duration:1,modifiers:{damageTakenMultiplier:.85},collision:{kind:"SHIELD",solid:true,height:3,hardness:4,response:"STOP",impactMultiplier:1.25,priority:90},defenseProfiles:[{id:"full_shield_stance_guard",method:"GUARD",name:"全身大盾架勢",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.25},PIERCE:{damageMultiplier:.30},SHOT:{damageMultiplier:.20},STRIKE:{damageMultiplier:.45},MAGIC:{damageMultiplier:.70}}}]}],affixes:["FULL_SHIELD_DEFENSE"]},
  colin_armor_breaking_strike:{id:"colin_armor_breaking_strike",name:"破甲打擊",category:"ATTACK",weapon:"colin_hammer",power:1.15,range:{min:1,max:1},attackType:"STRIKE",element:"INHERIT",speed:-10,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:["ARMOR_BREAK"],statusEffects:[{type:"DEF_DOWN",value:20,duration:2}],postEffects:[{type:"KNOCKBACK",distance:2}]},

  church_slash:{id:"church_slash",name:"騎士斬擊",category:"ATTACK",weapon:"sword",power:1,range:{min:1,max:1},attackType:"INHERIT",element:"INHERIT",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"}},
  church_heavy_slash:{id:"church_heavy_slash",name:"重劍斬擊",category:"ATTACK",weapon:"greatsword",power:1.1,range:{min:1,max:1},attackType:"SLASH",element:"INHERIT",speed:-5,target:"ENEMY",support:false,resource:{type:"UNLIMITED"}},
  church_holy_bolt:{id:"church_holy_bolt",name:"聖光術",category:"MAGIC",weapon:"staff",power:1,manaCost:12,range:{min:1,max:4},attackType:"MAGIC",element:"HOLY",speed:0,target:"ENEMY",support:true,resource:{type:"UNLIMITED"}},
  templar_holy_slash:{id:"templar_holy_slash",name:"聖光斬",category:"ATTACK",weapon:"greatsword",power:1.2,range:{min:1,max:1},attackType:"SLASH",element:"HOLY",defenseStat:"MDEF",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"}},
  templar_charge:{id:"templar_charge",name:"衝鋒",category:"ATTACK",weapon:"greatsword",power:1.15,range:{min:2,max:4},attackType:"SLASH",element:"INHERIT",speed:5,target:"ENEMY",support:false,resource:{type:"USES",max:3},approach:{type:"CHARGE",stopDistance:1}},
  templar_holy_shield:{id:"templar_holy_shield",name:"聖盾",category:"MAGIC",power:0,manaCost:20,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"USES",max:2},effects:[{type:"BUFF",id:"HOLY_SHIELD",classification:"POSITIVE",duration:2,modifiers:{damageTakenMultiplier:.65,guardMultiplier:.75},collision:{kind:"SHIELD",solid:true,height:3,hardness:4,response:"STOP",impactMultiplier:1.35,priority:100}}]},
  templar_healing:{id:"templar_healing",name:"治療術",category:"MAGIC",power:0,manaCost:22,range:{min:1,max:3},target:"ALLY_OR_ENEMY",support:false,resource:{type:"USES",max:3},relationEffects:[{relation:"ALLY",type:"HEAL",amount:65},{relation:"SELF",type:"HEAL",amount:65},{relation:"ENEMY",type:"MAGIC_DAMAGE",power:.8,element:"HOLY",traitMultipliers:{UNDEAD:2}}]},
  saint_heal:{id:"saint_heal",name:"治癒祈禱",category:"MAGIC",power:0,manaCost:24,range:{min:1,max:4},target:"ALLY",support:false,resource:{type:"USES",max:4},effects:[{type:"HEAL",amount:95}]},
  saint_dispel:{id:"saint_dispel",name:"淨化祈禱",category:"MAGIC",power:0,manaCost:18,range:{min:1,max:4},target:"ALLY",support:false,resource:{type:"USES",max:3},effects:[{type:"DISPEL",classification:"NEGATIVE"}]},
  saint_blessing:{id:"saint_blessing",name:"祝福",category:"MAGIC",power:0,manaCost:20,range:{min:1,max:4},target:"ALLY",support:false,resource:{type:"USES",max:3},effects:[{type:"BUFF",id:"SAINT_BLESSING",classification:"POSITIVE",duration:2,modifiers:{atk:10,matk:10,def:10,mdef:10}}]},

  seraphina_rending_claw:{id:"seraphina_rending_claw",name:"血刃突刺",category:"ATTACK",weapon:"rapier",power:1.15,range:{min:1,max:1},attackType:"PIERCE",element:"DARK",speed:15,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},statusEffects:[{type:"DAMAGE_OVER_TIME",id:"BLEEDING",name:"流血",classification:"NEGATIVE",amount:12,duration:3,chance:100}]},
  seraphina_blood_drain:{id:"seraphina_blood_drain",name:"吸血",category:"SPECIAL",power:0,range:{min:1,max:1},target:"ALLY_OR_ENEMY",support:false,resource:{type:"USES",max:3},bloodAction:{damage:45,healRatio:1,manaRatio:.5,restoreFromPassive:"PATIENT",bonusAgainstEffect:{id:"BLEEDING",multiplier:1.5},copySkill:true,copyDuration:3}},
  seraphina_blood_shield:{id:"seraphina_blood_shield",name:"血盾",category:"SPECIAL",power:0,manaCost:20,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"USES",max:3},effects:[{type:"SHIELD",id:"BLOOD_SHIELD",name:"血盾",classification:"POSITIVE",amount:80,duration:3}]},
  seraphina_blood_burst:{id:"seraphina_blood_burst",name:"血爆",category:"ATTACK",weapon:"rapier",power:1.4,range:{min:1,max:1},attackType:"PIERCE",element:"DARK",speed:10,target:"ENEMY",support:false,resource:{type:"USES",max:2}},
  seraphina_regeneration:{id:"seraphina_regeneration",name:"血之再生",category:"SPECIAL",power:0,manaCost:18,range:{min:0,max:0},target:"SELF",support:false,resource:{type:"USES",max:2},effects:[{type:"HEAL",amount:80}]},

  water_tentacle:{id:"water_tentacle",name:"觸手拖曳",category:"ATTACK",weapon:"claw",power:.95,range:{min:1,max:2},attackType:"STRIKE",element:"WATER",speed:0,target:"ENEMY",support:false,resource:{type:"UNLIMITED"},affixes:[],postEffects:[{type:"PULL",distance:2}]}
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
  FELINE_BODY:{id:"FELINE_BODY",name:"貓族體態",category:"PASSIVE",description:"靈活的貓族身體能直接攀上兩層高差，並大幅減輕墜落傷害。",movementRules:{maxClimb:2},fallRules:{safeDrop:2,damageMultiplier:.5}},
  CAT_OPENING_STEALTH:{id:"CAT_OPENING_STEALTH",name:"夜行潛伏",category:"PASSIVE",description:"戰鬥開始時進入潛行。潛行無法阻止範圍攻擊，主動出手或被近距離發現時解除。",openingEffects:[{id:"STEALTH",type:"STEALTH",classification:"POSITIVE",detectionRange:1}]},

  ELVEN_PATHFINDER:{id:"ELVEN_PATHFINDER",name:"山林之民",category:"PASSIVE",description:"精靈在森林與山地如履平地。",terrainTraits:["FOREST_WALK","MOUNTAIN_WALK"]},
  FOREST_LANGUAGE:{id:"FOREST_LANGUAGE",name:"森語",category:"PASSIVE",description:"以聽覺感知魔力，並能聽見植物的語言。"},
  EAGLE_SHARED_VISION:{id:"EAGLE_SHARED_VISION",name:"鷹眼共享",category:"PASSIVE",description:"與老鷹夥伴共享視覺，作為超遠距離曲射的觀測來源。"},
  STRONG_PHYSIQUE:{id:"STRONG_PHYSIQUE",name:"強健體魄",category:"PASSIVE",description:"異常強韌的體格使寇林不會被敵方擊退。",immunities:["KNOCKBACK"]},
  RANGER_COMMANDER:{id:"RANGER_COMMANDER",name:"遊俠隊長",category:"PASSIVE",description:"蕾娜能在更大的隊形範圍內發動支援射擊。",supportRules:{allyDistance:2}},
  CHURCH_GUARDIAN:{id:"CHURCH_GUARDIAN",name:"聖殿援護",category:"PASSIVE",defenseProfiles:[{id:"church_guard_ally",method:"GUARD",name:"聖殿援護",canGuardAlly:true,vs:{SLASH:{damageMultiplier:.55},PIERCE:{damageMultiplier:.60},SHOT:{damageMultiplier:.55},STRIKE:{damageMultiplier:.70},MAGIC:{damageMultiplier:.80}}}]},
  PATIENT:{id:"PATIENT",name:"病患",category:"PASSIVE",description:"不完整的遠古人類病患。吸血後可暫時恢復為5V規格。",bloodRestoration:{grade:"5V",duration:3,values:{str:20,agi:20,int:20,wil:20,vit:20}}}
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
