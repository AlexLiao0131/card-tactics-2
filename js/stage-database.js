export const STAGES={
  prototype_battle:{
    id:"prototype_battle",name:"Prototype Battle",mapId:"prototype_field",environment:{timeOfDay:"NIGHT"},
    playerSpawns:[],enemySpawns:[],
    enemyDeck:["imperial_swordsman_card","imperial_spearman_card","imperial_archer_card","imperial_heavy_guard_card","imperial_hammer_card","imperial_mage_card","imperial_cavalry_card"],
    battleDeck:["livia_card","ophi_card","leon_card","kahn_card","cassandra_card","thunderstorm_card","wildfire_card","tornado_card","miracle_card","fog_card","starfall_card","moon_goddess_blessing_card"],
    deploymentPoints:[
      {id:"player_base",name:"我方本陣",owner:"PLAYER",captureTiles:[{x:0,y:2}],area:[{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:0,y:4},{x:1,y:0},{x:1,y:1},{x:1,y:2},{x:1,y:3},{x:1,y:4}]},
      {id:"center_outpost",name:"中央中立據點",owner:"NEUTRAL",captureTiles:[{x:3,y:2}],area:[{x:2,y:2},{x:3,y:2},{x:3,y:1},{x:3,y:3}]},
      {id:"enemy_base",name:"敵方本陣",owner:"ENEMY",captureTiles:[{x:7,y:2}],area:[{x:6,y:0},{x:6,y:1},{x:6,y:2},{x:6,y:3},{x:6,y:4},{x:7,y:0},{x:7,y:1},{x:7,y:2},{x:7,y:3},{x:7,y:4}]}
    ],
    cardRules:{startingCrystals:4,maxCrystals:10,crystalGrowth:1,handSize:5},
    victory:{type:"ENEMY_WIPED"},defeat:{type:"PLAYER_WIPED"},scriptId:"prototype_script"
  },

  versus_core_battle:{
    id:"versus_core_battle",name:"Core Conquest",mode:"VERSUS",ruleset:"CORE_CAPTURE",
    battlefield:{type:"PROCEDURAL",generator:"VERSUS_CORE",defaultSize:"MEDIUM"},
    environment:{
      timeOfDay:"DAY",
      weatherPool:[
        {weather:"CLEAR",weight:35},
        {weather:"FOG",weight:15},
        {weather:"RAIN",weight:20},
        {weather:"HEAVY_RAIN",weight:10},
        {weather:"THUNDERSTORM",weight:8},
        {weather:"SNOW",weight:8},
        {weather:"BLIZZARD",weight:4}
      ]
    },
    playerSpawns:[],enemySpawns:[],
    enemyDeck:["imperial_swordsman_card","imperial_spearman_card","imperial_archer_card","imperial_heavy_guard_card","imperial_hammer_card","imperial_mage_card","imperial_cavalry_card","leon_card"],
    battleDeck:["livia_card","ophi_card","kahn_card","cassandra_card","thunderstorm_card","wildfire_card","tornado_card","miracle_card","fog_card","starfall_card"],
    coreRules:{hp:600,shield:0,defense:0},
    captureDamage:120,
    cardRules:{startingCrystals:4,maxCrystals:10,crystalGrowth:1,handSize:5},
    enemyCardRules:{startingCrystals:4,maxCrystals:10,crystalGrowth:1,handSize:5},
    victory:{type:"DESTROY_CORE",owner:"ENEMY"},defeat:{type:"DESTROY_CORE",owner:"PLAYER"},scriptId:"prototype_script"
  }
};
export const StageDatabase=(()=>({get(id){const stage=STAGES[id];return stage?JSON.parse(JSON.stringify(stage)):null;}}))();
globalThis.STAGES=STAGES;
globalThis.StageDatabase=StageDatabase;
