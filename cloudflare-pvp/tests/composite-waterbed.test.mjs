import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainMaterial as M} from '../../js/terrain-database.js';
import {HydrologyEngine as H} from '../../js/hydrology-engine.js';
import {MapGenerator as G} from '../../js/map-generator.js';
import {VisualSurfaceResolver as V} from '../../js/visual-surface-resolver.js';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {makeBattleTestMap} from '../../js/battletest-arena.js';
import {createRenderUpdate,applyRenderUpdate} from '../../js/pvp-render-delta.js';
import '../../js/tactical-engine.js';
import '../../js/environment-engine.js';
import '../../js/deployment-engine.js';
import '../../js/battle-presentation-controller.js';
const close=(a,b,tol=H.EPSILON)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);
const cell=(extra={})=>({x:0,y:0,terrain:'PLAIN',elevation:0,waterDepth:0,...extra});
const world=t=>({id:'bed-fixture',width:1,height:1,tiles:[t],objects:[]});
const mixed={ROCK:.5,GRAVEL:.25,SILT:.25};
test('legacy pure bed coefficients remain unchanged and composite shares determine storage and infiltration',()=>{
 const rock=cell({hydrologyBedMaterial:'ROCK'}),gravel=cell({hydrologyBedMaterial:'GRAVEL'}),silt=cell({hydrologyBedMaterial:'SILT'}),sand=cell({hydrologyBedMaterial:'SAND'});
 assert.equal(H.infiltrationRate(rock),0);assert.equal(H.infiltrationRate(gravel),.006);assert.equal(H.infiltrationRate(silt),.013);
 assert.equal(H.soilCapacity(gravel),H.SOIL_SATURATION_CAPACITY);assert.equal(H.soilCapacity(silt),H.SOIL_SATURATION_CAPACITY);assert.equal(H.soilCapacity(rock),0);
 const t=cell({hydrologyBedComposition:mixed});assert.ok(H.hasSoil(t));
 close(H.soilCapacity(t),(H.soilCapacity(gravel)+H.soilCapacity(silt))/4);
 close(H.infiltrationRate(t),(H.infiltrationRate(gravel)+H.infiltrationRate(silt))/4,1e-10);
 assert.equal(H.soilCapacity(sand),H.SAND_SOIL_CAPACITY);
});
test('same dry-bed rainfall uses one real infiltration budget and retains the remaining water in D',()=>{
 const result={};
 for(const [kind,extra] of [['rock',{hydrologyBedMaterial:'ROCK'}],['gravel',{hydrologyBedMaterial:'GRAVEL'}],['silt',{hydrologyBedMaterial:'SILT'}],['mix',{hydrologyBedComposition:mixed}]]){
  const t=cell(extra),map=world(t),rate=H.infiltrationRate(t);H.applyRain(map);
  close(H.soilMoisture(t),Math.min(H.RAIN_FILL_PER_EVENT,rate));close(H.totalWater(map),H.RAIN_FILL_PER_EVENT);
  close(H.waterDepth(t),H.RAIN_FILL_PER_EVENT-H.soilMoisture(t));result[kind]=H.waterDepth(t);
 }
 assert.ok(result.rock>result.mix&&result.mix>result.gravel&&result.gravel>result.silt);
});
test('real material replacement invalidates prior fractions and preserves pore water',()=>{
 const t=cell({hydrologyBedMaterial:'ROCK',hydrologyBedComposition:mixed,soilMoisture:.2,waterDepth:.3}),map=world(t),before=H.totalWater(map);
 H.setGroundMaterial(t,'ROCK');assert.deepEqual(M.bedComposition(t),{ROCK:1});assert.equal(H.soilMoisture(t),0);close(H.totalWater(map),before);
 H.setGroundMaterial(t,'SILT');assert.deepEqual(M.bedComposition(t),{SILT:1});close(H.totalWater(map),before);
 const beforeDepth=H.waterDepth(t);H.redistribute(map);assert.ok(H.waterDepth(t)<beforeDepth);close(H.totalWater(map),before);
});
test('generated bed fractions are deterministic, normalized and do not prefill the basin',()=>{
 let mixedCount=0,poolCount=0;
 for(const size of Object.keys(G.SIZE_PRESETS))for(const seed of [0,10,42,10101]){
  const {map,meta}=G.generateVersus({size,seed});assert.equal(meta.validation,'PASS');
  for(const t of map.tiles){const b=M.bedComposition(t);if(t.river||t.hydrologyNaturalChannelPool){assert.ok(b,`${size}/${seed}/${t.x},${t.y}`);close(Object.values(b).reduce((s,n)=>s+n,0),1,1e-12);assert.ok(Object.values(b).every(n=>n>0&&n<=1));assert.equal(t.waterDepth,0);if(Object.keys(b).length>1)mixedCount++;if(t.hydrologyNaturalChannelPool)poolCount++;}else assert.equal(b,null);}
 }
 assert.ok(mixedCount>0&&poolCount>0);
 assert.deepEqual(G.generateVersus({size:'LARGE',seed:10}),G.generateVersus({size:'LARGE',seed:10}));
});
test('renderer consumes the same fractions while wet/dry changes do not alter texture identity',()=>{
 const v=new V(),t=cell({hydrologyBedComposition:mixed}),by=new Map([['0,0',t]]);
 assert.deepEqual(v.materialWeightsAt(t,by),[0,.25,.75,0]);
 const before=v.dryColor(t);t.terrain='WATER';t.dryTerrain='PLAIN';t.waterDepth=.3;
 assert.deepEqual(v.materialWeightsAt(t,by),[0,.25,.75,0]);assert.deepEqual(v.dryColor(t),before);assert.notDeepEqual(v.colorOf(t),before);
 assert.notDeepEqual(v.dryColor(cell({hydrologyBedMaterial:'GRAVEL'})),v.dryColor(cell({hydrologyBedMaterial:'ROCK'})));
 const r=Object.create(TerrainRenderer.prototype);r.surfaceResolver=v;
 const sig=r.tileColorSignature(t);t.hydrologyBedComposition={ROCK:.5,GRAVEL:.125,SILT:.375};assert.notEqual(r.tileColorSignature(t),sig);
});
test('official presentation snapshot carries fractions and PVP incremental codec preserves them',()=>{
 const t=cell({hydrologyBedComposition:mixed,waterDepth:.3,soilMoisture:.1}),map=world(t),stage={mode:'CAMPAIGN',intelMode:'FULL_VISIBILITY',deploymentPoints:[]};
 let rev=1;const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},PHASE:{PLAYER:'PLAYER',CARD:'CARD'},state:()=>({map,stage,cores:[],units:[],environmentState:globalThis.EnvironmentEngine.create(),phase:'PLAYER',round:1,mode:'idle',renderRevision:rev}),unitAt:()=>null,coreAt:()=>null};
 const p=globalThis.BattlePresentationController.create(ctx),frame=()=>({type:'PVP_RENDER_SNAPSHOT',matchId:'BEDTEST',seat:0,revision:rev,snapshot:p.battleSnapshot()});
 const a=frame();assert.deepEqual(a.snapshot.map.tiles[0].hydrologyBedComposition,mixed);close(a.snapshot.map.tiles[0].soilCapacity,H.soilCapacity(t));
 rev++;H.setGroundMaterial(t,'SILT');const b=frame();assert.deepEqual(b.snapshot.map.tiles[0].hydrologyBedComposition,{SILT:1});
 const update=createRenderUpdate(a,b,{maxDeltaRatio:2});assert.equal(update.type,'PVP_RENDER_DELTA');assert.deepEqual(applyRenderUpdate(a,JSON.parse(JSON.stringify(update))),JSON.parse(JSON.stringify(b)));
});
test('BattleTest has both pure and mixed beds without changing any water depth',()=>{
 const lab=makeBattleTestMap().terrain;
 for(const y of [4,6,8])for(const x of [5,10]){
  const row=lab.filter(t=>t.y===y&&t.x>=x&&t.x<x+5);assert.deepEqual(row.slice(0,4).map(t=>M.bedLabel(t)),['ROCK','GRAVEL','SILT','SAND']);assert.equal(Object.keys(M.bedComposition(row[4])).length,4);assert.ok(row.every(t=>t.waterDepth===row[0].waterDepth));
 }
});
test('existing soil and rock mass-flow deposition transitions update the same bed material',async()=>{
 const {MassFlowEngine:F}=await import('../../js/mass-flow-engine.js');
 for(const kind of ['SOIL','ROCK']){
  const top=cell({elevation:3,soilMoisture:.3}),bottom=cell({x:1,elevation:0,hydrologyBedMaterial:'GRAVEL',hydrologyBedComposition:mixed,waterDepth:.4});
  const map={id:'deposit',width:2,height:1,tiles:[top,bottom],objects:[]};
  const flow=F.trace(map,top,kind,1);const events=[];F.apply(map,flow,{events});
  assert.deepEqual(M.bedComposition(bottom),kind==='SOIL'?{SILT:1}:{ROCK:1});
  assert.ok(events.some(e=>e.type==='GROUND_MATERIAL_CHANGED'&&e.x===1));
 }
});
