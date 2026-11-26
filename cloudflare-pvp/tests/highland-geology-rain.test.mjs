import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainMaterial} from '../../js/terrain-database.js';
import '../../js/skill-database.js';
import {HydrologyEngine as H} from '../../js/hydrology-engine.js';
import {MapGenerator} from '../../js/map-generator.js';
import {TacticalEngine as T} from '../../js/tactical-engine.js';
import '../../js/mass-flow-engine.js';
import {EnvironmentResolver as E} from '../../js/environment-resolver.js';
import '../../js/battle-presentation-controller.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {makeBattleTestMap} from '../../js/battletest-arena.js';
const tile=(x,y,elevation,extra={})=>({x,y,elevation,terrain:'PLAIN',waterDepth:0,...extra});
const world=tiles=>({id:'highland-test',tiles,width:Math.max(...tiles.map(t=>t.x))+1,height:Math.max(...tiles.map(t=>t.y))+1,objects:[]});
test('procedural height does not determine soil: all four sizes keep elevated soil and explicitly authored rock',()=>{
 for(const size of Object.keys(MapGenerator.SIZE_PRESETS)){
  const {map}=MapGenerator.generateVersus({size,seed:10101});
  assert.ok(map.tiles.some(t=>t.elevation>=2&&TerrainMaterial.hasSoil(t)),size);
  assert.ok(map.tiles.some(t=>t.material==='ROCK'&& !H.hasSoil(t)),size);
  assert.ok(map.tiles.every(t=>t.terrain!=='HIGH_GROUND'),size);
 }
});
test('same rainfall on isolated soil and rock uses material rather than elevation; budget is conserved',()=>{
 for(const elevation of [-2,0,3,7])for(const material of ['SOIL','ROCK']){
  const t=tile(0,0,elevation,{material}),m=world([t]);
  H.applyRain(m);assert.equal(H.soilMoisture(t),material==='SOIL'?H.RAIN_FILL_PER_EVENT:0);
  assert.equal(H.waterDepth(t),material==='ROCK'?H.RAIN_FILL_PER_EVENT:0);
  assert.ok(Math.abs(H.totalWater(m)-H.RAIN_FILL_PER_EVENT)<.0002);
 }
});
test('pore-water conversion to bare rock preserves water volume and disables further soil absorption',()=>{
 const t=tile(0,0,4,{soilMoisture:.3}),m=world([t]);
 H.setGroundMaterial(t,'ROCK');assert.equal(H.soilMoisture(t),0);assert.equal(H.waterDepth(t),.3);
 assert.equal(H.totalWater(m),.3);assert.equal(TerrainMaterial.of(t),'ROCK');
});
test('natural soil slope warns then fails after real rainfall, including wet ground; no disturbance',()=>{
 const top=tile(0,0,4),mid=tile(1,0,2),bottom=tile(2,0,0),m=world([top,mid,bottom]);
 let warning=false,flow=false,wetWarning=false;
 for(let turn=1;turn<=14;turn++){
  H.applyRain(m,{heavy:true});
  const state={temperature:7,climate:{turn}};
  const events=E.resolve(m,state);
  if(events.some(e=>e.type==='MASS_FLOW_WARNING'&&e.material==='SOIL'&&e.x===0)){warning=true;wetWarning ||= H.waterDepth(top)>0;}
  if(events.some(e=>e.type==='MASS_FLOW'&&e.material==='SOIL'&&e.x===0)){flow=true;break;}
 }
 assert.ok(warning,'must warn');assert.ok(flow,'must naturally flow');assert.ok(top.elevation<4,'terrain erosion');
});
test('surface water does not suppress saturated soil warning and bare rock never triggers soil failure',()=>{
 for(const material of ['SOIL','ROCK']){
  const top=tile(0,0,4,{terrain:'WATER',dryTerrain:'PLAIN',material,soilMoisture:.45,waterDepth:.02});
  const m=world([top,tile(1,0,0)]);const events=E.resolve(m,{temperature:7,climate:{turn:1}});
  assert.equal(events.some(e=>e.type==='MASS_FLOW_WARNING'&&e.material==='SOIL'),material==='SOIL');
 }
});
test('relative high-ground bonus uses the same terrain projection for real combat and preview',()=>{
 const a={id:'a',x:0,y:0,alive:true,team:'P',character:{weapons:{bow:{attackType:'SHOT'}},modifiers:{},passives:[]}},b={id:'b',x:1,y:0,alive:true,team:'E',character:{weapons:{},modifiers:{},passives:[]}};
 const skill={id:'shot',name:'shot',weapon:'bow',attackType:'SHOT',range:{min:1,max:3},target:'ENEMY'};
 const battle=globalThis.BattleEngine;
 globalThis.BattleEngine={calculate:(ac,dc)=>({hit:true,damage:1,accuracy:ac.modifiers.accuracy}),hitChance:(ac)=>ac.modifiers.accuracy,critChance:()=>0};
 try{
  for(const [ha,hb,mat,bonus] of [[1,0,'SOIL',10],[3,5,'ROCK',0],[5,5,'ROCK',0],[-1,-2,'SOIL',10],[5,2,'ROCK',10]]){
   const m=world([tile(0,0,ha,{material:mat}),tile(1,0,hb)]);
   const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},PHASE:{PLAYER:'PLAYER'},state:()=>({map:m,environmentState:null}),effectiveSkill:(_u,s)=>s};
   const p=globalThis.BattlePresentationController.create(ctx).combatPreview(a,b,skill);
   assert.equal(T.combatTerrain(m,a,b,skill).acc,bonus);assert.equal(p.terrainAcc,bonus);assert.equal(T.resolve(m,a,b,skill).terrain.acc,bonus);
   assert.equal(T.combatTerrain(m,a,b,{...skill,attackType:'MAGIC'}).acc,bonus);
   assert.equal(T.combatTerrain(m,a,b,{...skill,attackType:'SLASH'}).acc,0);
  }
 }finally{globalThis.BattleEngine=battle;}
});
test('BattleTest contains high soil and exposed rock as separately authored materials',()=>{
 const lab=makeBattleTestMap().terrain;
 assert.equal(TerrainMaterial.of(lab.find(t=>t.x===12&&t.y===1)),'SOIL');
 assert.equal(TerrainMaterial.of(lab.find(t=>t.x===17&&t.y===6)),'ROCK');
});

test('Babylon surface resolver reads geology, not altitude or legacy height label',()=>{
 const r=new VisualSurfaceResolver();
 assert.equal(r.baseTerrainOf(tile(0,0,7,{material:'SOIL'})),'PLAIN');
 assert.equal(r.baseTerrainOf(tile(0,0,0,{material:'ROCK'})),'HIGH_GROUND');
 assert.equal(r.baseTerrainOf(tile(0,0,2,{terrain:'HIGH_GROUND',material:'SOIL'})),'PLAIN');
 assert.equal(r.baseTerrainOf(tile(0,0,-1,{terrain:'WATER',dryTerrain:'PLAIN',material:'ROCK'})),'HIGH_GROUND');
});

// Natural bedrock exposure is separate from movable/blocking rock objects,
// and from absolute height. Inspect actual generated maps instead of a mock.
test('projecting cliff spurs expose natural rock without converting all high ground or protected paths',()=>{
 const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
 let totalNatural=0;
 for(const size of Object.keys(MapGenerator.SIZE_PRESETS)){
  const {map,meta}=MapGenerator.generateVersus({size,seed:10101});
  const by=new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t]));
  const objects=new Set(map.objects.filter(o=>o.type==='ROCK').map(o=>`${o.x},${o.y}`));
  const natural=map.tiles.filter(t=>t.material==='ROCK'&&!objects.has(`${t.x},${t.y}`));
  assert.equal(natural.length,meta.naturalOutcropTiles,size);totalNatural+=natural.length;
  // Some seeds have no exposed spur; rock walls still render independently.
  for(const t of natural){
   const exposed=dirs.map(([dx,dy])=>{const n=by.get(`${t.x+dx},${t.y+dy}`);return !!n&&n.terrain!=='WALL'&&t.elevation-n.elevation>1.0001;});
   assert.ok(exposed.filter(Boolean).length>=3,size);
   assert.equal(t.terrain,'PLAIN');assert.ok(TERRAINS[t.terrain].passable);
   assert.ok(!t.river&&!t.hydrologyNaturalChannelPool&&!t.routeId&&!t.mountainRamp&&!t.captureZone);
   assert.equal(H.hasSoil(t),false);assert.equal(H.waterDepth(t),0);
  }
  assert.ok(map.tiles.some(t=>t.elevation>=2&&TerrainMaterial.hasSoil(t)&&TerrainMaterial.exposedCliffFace(map,t)),size);
 }
 assert.ok(totalNatural>0);
});

test('cliff face uses rock palette regardless of topsoil, retaining waterline and fog effects',async()=>{
 const {TerrainRenderer}=await import('../../js/terrain-renderer.js');
 const {VISUAL_TERRAIN_COLORS}=await import('../../js/visual-surface-resolver.js');
 const renderer=Object.create(TerrainRenderer.prototype);renderer.surfaceResolver=new VisualSurfaceResolver();
 const soil=tile(0,0,4,{material:'SOIL',soilMoisture:.25}),rock=tile(0,0,4,{material:'ROCK'}),forest=tile(0,0,4,{terrain:'FOREST'}),lower=tile(1,0,1);
 const dir={dx:1,dy:0};const palette=t=>renderer.cliffPalette(t,lower,dir,new Map([['0,0',t],['1,0',lower]]),3);
 const dry=palette(soil);
 assert.deepEqual(dry.wallColor,palette(rock).wallColor);assert.deepEqual(dry.wallColor,palette(forest).wallColor);
 assert.deepEqual(dry.wallColor,VISUAL_TERRAIN_COLORS.HIGH_GROUND.map(c=>c*(.86-3*.015)));
 assert.notDeepEqual(renderer.surfaceResolver.colorOf(soil),renderer.surfaceResolver.colorOf(rock));
 lower.waterDepth=.5;lower.waterSurfaceZ=1.5;
 assert.deepEqual(palette(soil).wallColor,dry.wallColor);
 assert.ok(renderer.surfaceResolver.cliffWaterContact(soil,lower).strength>0);
 assert.ok(palette({...soil,fogged:true}).wallColor.every((c,i)=>c<dry.wallColor[i]));
 assert.equal(H.hasSoil(soil),true);
});
