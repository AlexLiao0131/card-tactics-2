/**
 * Battle Test Lab: data fixture for the canonical map / stage databases.
 * No rendering, damage, targeting, hydrology solver, or turn rules live here.
 * Only battletestindex.html imports this module; index.html is unaffected.
 */
export const LAB_STAGE_ID = 'battletest_lab';
export const LAB_MAP_ID = 'battletest_rectangular_field';
export const LAB_WIDTH = 20;
export const LAB_HEIGHT = 14;

export const LAB_REGIONS = Object.freeze([
  {id:'plain',name:'平地',x0:0,y0:0,x1:4,y1:3,terrain:'PLAIN',elevation:0,color:'#658362'},
  {id:'forest',name:'森林',x0:5,y0:0,x1:9,y1:3,terrain:'FOREST',elevation:0,color:'#326b4d'},
  {id:'high',name:'高地 H+2',x0:10,y0:0,x1:14,y1:3,terrain:'HIGH_GROUND',elevation:2,color:'#a99a72'},
  {id:'wall',name:'岩壁',x0:15,y0:0,x1:19,y1:3,terrain:'WALL',elevation:2,color:'#5b626c'},
  {id:'mud',name:'泥地',x0:0,y0:4,x1:4,y1:8,terrain:'MUD',elevation:0,color:'#7a654b'},
  {id:'shallow',name:'淺水 0.45',x0:5,y0:4,x1:9,y1:8,terrain:'WATER',waterDepth:.45,elevation:-.45,color:'#38a4b7'},
  {id:'deep',name:'深水 2.2',x0:10,y0:4,x1:14,y1:8,terrain:'WATER',waterDepth:2.2,elevation:-2.2,color:'#246994'},
  {id:'cliff',name:'斷崖 H+3',x0:15,y0:4,x1:19,y1:8,terrain:'HIGH_GROUND',elevation:3,color:'#997f63'},
  {id:'plain2',name:'平地',x0:0,y0:9,x1:4,y1:13,terrain:'PLAIN',elevation:0,color:'#658362'},
  {id:'sand',name:'砂地',x0:5,y0:9,x1:9,y1:13,terrain:'SAND',elevation:0,color:'#c4af74'},
  {id:'plain3',name:'平地',x0:10,y0:9,x1:14,y1:13,terrain:'PLAIN',elevation:0,color:'#658362'},
  {id:'plain4',name:'平地',x0:15,y0:9,x1:19,y1:13,terrain:'PLAIN',elevation:0,color:'#658362'}
]);

export function regionAt(x,y){
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=LAB_WIDTH||y>=LAB_HEIGHT)return null;
  return LAB_REGIONS.find(r=>x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1)||null;
}

export function makeBattleTestMap(){
  const terrain=[];
  for(let y=0;y<LAB_HEIGHT;y++)for(let x=0;x<LAB_WIDTH;x++){
    const region=regionAt(x,y);
    if(!region)throw Error(`BATTLE_TEST_UNDEFINED_TILE:${x},${y}`);
    const entry={x,y,terrain:region.terrain,elevation:region.elevation};
    if(region.terrain==='WATER'){
      entry.waterDepth=region.waterDepth;
      entry.dryTerrain='PLAIN';
    }
    terrain.push(entry);
  }
  return {id:LAB_MAP_ID,name:'Battle Test｜整齊方形地形',width:LAB_WIDTH,height:LAB_HEIGHT,terrain,objects:[]};
}

export function makeBattleTestStage(){
  return {
    id:LAB_STAGE_ID,name:'Battle Test｜自由召喚場',
    mode:'CAMPAIGN',intelMode:'FULL_VISIBILITY',mapId:LAB_MAP_ID,
    environment:{timeOfDay:'DAY',weather:'CLEAR',wind:{x:0,y:0,strength:0}},
    playerSpawns:[],enemySpawns:[],battleDeck:[],enemyDeck:[],deploymentPoints:[],encounters:[],
    cardRules:{startingCrystals:10,maxCrystals:10,crystalGrowth:0,handSize:0},
    enemyCardRules:{startingCrystals:10,maxCrystals:10,crystalGrowth:0,handSize:0},
    // Unknown objectives evaluate false in the canonical ObjectiveEngine.
    // Testing the last enemy death must not close this sandbox match.
    victory:{type:'BATTLE_TEST_MANUAL'},defeat:{type:'BATTLE_TEST_MANUAL'},
    scriptId:null
  };
}

/** Register only a NEW fixture, never overwrite a production stage/map. */
export function registerBattleTestArena(maps,stages){
  if(!maps||!stages)throw Error('BATTLE_TEST_DATABASE_NOT_READY');
  if(Object.prototype.hasOwnProperty.call(maps,LAB_MAP_ID)||Object.prototype.hasOwnProperty.call(stages,LAB_STAGE_ID))
    throw Error('BATTLE_TEST_FIXTURE_ID_COLLISION');
  maps[LAB_MAP_ID]=makeBattleTestMap();
  stages[LAB_STAGE_ID]=makeBattleTestStage();
  return {mapId:LAB_MAP_ID,stageId:LAB_STAGE_ID};
}
