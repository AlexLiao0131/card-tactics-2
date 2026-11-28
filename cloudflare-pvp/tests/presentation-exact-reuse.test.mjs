import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {BabylonRenderer} from '../../js/babylon-renderer.js';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {WaterRenderer,waterVisualInput,sameWaterVisualInput,captureWaterVisualInput} from '../../js/water-renderer.js';

const tiles=()=>Array.from({length:704},(_,i)=>({x:i%32,y:Math.floor(i/32),terrain:'PLAIN',elevation:0,material:'SOIL',waterDepth:0,waterSurfaceZ:null,soilMoisture:0,hydrologyEdgeDischarge:{},effects:[]}));
const fixture=run=>{
 const deck=Array(20).fill('imperial_swordsman_card');const game=initializeCanonicalWorld({seed:1234,mapSize:'SMALL',decks:[deck,deck]});
 game.randomState=5;
 return withCanonicalEngines(game,engine=>{
  const map=game.battlefield.map;map.objects=[];
  for(const t of map.tiles)Object.assign(t,{terrain:'PLAIN',elevation:0,waterDepth:0});
  const spawn=(id,c,team,x,y)=>engine.unitRuntime.create({id,characterId:c,team,x,y,map});
  const units=[spawn('a','nereia','P',3,3),spawn('b','imperial_swordsman','P',6,6),spawn('c','imperial_swordsman','E',7,5)];
  const env=EnvironmentEngine.create({weather:'CLEAR',timeOfDay:'DAY'});
  const world={map,units,environmentState:env,cores:[{id:'p',owner:'PLAYER',x:0,y:0,hp:100},{id:'e',owner:'ENEMY',x:9,y:7,hp:100}],stage:{mode:'VERSUS',intelMode:'DYNAMIC_INTEL',deploymentPoints:[]}};
  return run(world);
 });
};
test('batched FOV matches uncached canonical LOS across both teams and mutations',()=>fixture(w=>{
 const check=()=>{for(const team of ['P','E'])assert.deepEqual(TacticalEngine.teamVisibleCells(w,team),new Set(w.map.tiles.filter(t=>TacticalEngine.teamCanSee(w.map,w.units,team,t,w.environmentState,w)).map(t=>`${t.x},${t.y}`)));};
 check();w.environmentState.effects.set('3,3',[{type:'STEAM',duration:2,visionBlock:true}]);check();
 w.environmentState.effects.clear();w.environmentState.timeOfDay='NIGHT';w.environmentState.weather='FOG';check();
 w.units[1].alive=false;w.units[0].x=5;w.cores[0].hp=0;TacticalEngine.tile(w.map,4,3).elevation=3;check();
}));
test('sticky projection flag cannot force a static shadow render; real changes still refresh',()=>{
 let resets=0;const target={getSize:()=>({width:1024,height:1024}),refreshRate:1,resetRefreshCounter:()=>resets++};
 const cache={dirty:true,lastRefreshAt:-Infinity,lastView:null,hasUnitCasters:false,hasWindCasters:false,scheduled:0,reused:0,fullRate:0,staticReuses:0};
 const r=Object.assign(Object.create(BabylonRenderer.prototype),{scene:{activeCamera:{position:{x:0,y:0,z:0}}},sun:{needProjectionMatrixCompute:()=>true,shadowFrustumSize:20},shadowGenerator:{getShadowMap:()=>target},shadowCache:cache,units:{activeAnimations:new Map()}});
 r.prepareShadowRefresh(0);r.prepareShadowRefresh(16);r.prepareShadowRefresh(32);assert.equal(resets,1);assert.equal(cache.reused,2);
 r.sun.shadowFrustumSize=21;r.prepareShadowRefresh(33);assert.equal(resets,2);assert.equal(cache.refreshReasons.view,1);
 cache.hasUnitCasters=true;r.prepareShadowRefresh(49);r.prepareShadowRefresh(68);assert.equal(resets,3);assert.equal(cache.refreshReasons.idleCadence,1);
 r.units.activeAnimations.set('a',{});r.prepareShadowRefresh(69);assert.equal(cache.refreshReasons.active,1);
});
test('water comparison is detached, ignores selection annotations, detects each physical dependency',()=>{
 const resolver=new VisualSurfaceResolver(),state={map:{id:'map',width:32,height:22,tiles:tiles(),objects:[]},presentation:{environment:{wind:{x:0,y:1,strength:1}}},revision:1};
 const input=()=>waterVisualInput(state,resolver),prior=captureWaterVisualInput(input());
 const tile=state.map.tiles[0];tile.aimPreview=true;tile.reachable=true;tile.attackable=true;tile.activeFields=['x'];assert.ok(sameWaterVisualInput(input(),prior));
 for(const [key,value] of [['waterDepth',.01],['waterSurfaceZ',1],['fogged',true],['iceThickness',.02],['effectDetails',[{type:'WHIRLPOOL'}]],['hydrologyEdgeDischarge',{E:{rate:1}}]]){
  const old=tile[key],had=Object.hasOwn(tile,key);tile[key]=value;assert.equal(sameWaterVisualInput(input(),prior),false,key);if(had)tile[key]=old;else delete tile[key];
 }
 state.map.objects.push({id:'rock'});assert.equal(sameWaterVisualInput(input(),prior),false);state.map.objects.pop();
 state.presentation.environment.wind.strength=2;assert.equal(sameWaterVisualInput(input(),prior),false);state.presentation.environment.wind.strength=1;
 resolver.renderedSurfaceGeometryRevision++;assert.equal(sameWaterVisualInput(input(),prior),false);resolver.renderedSurfaceGeometryRevision--;
 assert.ok(sameWaterVisualInput(input(),prior));
 const r=Object.assign(Object.create(WaterRenderer.prototype),{surfaceResolver:resolver,lastWaterVisualInput:prior,lastWaterVisualRevision:1,visualInputAudit:{identicalInputsSkipped:0}});
 r.sync(state);assert.equal(r.visualInputAudit.identicalInputsSkipped,1);
});
test('grass skips ranking only when the existing physical dependencies match',()=>{
 const t=tiles(),r=Object.assign(Object.create(TerrainRenderer.prototype),{surfaceResolver:new VisualSurfaceResolver(),grassInvalidation:{checks:0,skipped:0,rebuilds:0}});
 r.grassSignature=r.grassInputs(t).signature;let calls=0;const original=r.grassInputs;r.grassInputs=function(...args){calls++;return original.apply(this,args);};
 r.syncGrass({},t);t[0].attackable=true;r.syncGrass({presentation:{environment:{wind:{strength:2}}}},t);assert.equal(calls,1);assert.equal(r.grassWind.strength,2);
 for(const tile of t)tile.waterDepth=1;r.syncGrass({},t);assert.equal(calls,2);assert.equal(r.grassInvalidation.selectedClumps,0);r.syncGrass({},t);assert.equal(calls,2);assert.equal(r.grassInvalidation.fastSkips,2);
});
const publish=(r,t,raised=0)=>{
 const x=t.x*2,z=t.y*2,a={x:x-1,y:0,z:z-1},b={x:x+1,y:0,z:z-1},c={x:x+1,y:0,z:z+1},d={x:x-1,y:0,z:z+1},m={x,y:raised,z};
 r.registerRenderedSurfaceGeometry(t,{triangles:[[a,b,m],[b,c,m],[c,d,m],[d,a,m]]});
};
test('directed transport reuse is identical, safe against caller mutation, invalidates on actual geometry and bypasses cliffs',()=>{
 const r=new VisualSurfaceResolver(),from={x:0,y:0,waterDepth:0},to={x:1,y:0,waterDepth:0};publish(r,from);publish(r,to);
 const edge={from,to},expected=r.solveTransportSurfacePath(from,to,1,0);assert.ok(expected.length>0);
 const a=r.transportSurfacePath(edge);assert.deepEqual(a,expected);a[0].y=999;r.beginPublishedSurfaceSampling();assert.deepEqual(r.transportSurfacePath(edge),expected);assert.equal(r.transportRouteStats.hits,1);
 r.transportSurfacePath({from:to,to:from});assert.equal(r.transportRouteStats.misses,2);
 publish(r,from,.2);r.beginPublishedSurfaceSampling();const changed=r.transportSurfacePath(edge);assert.deepEqual(changed,r.solveTransportSurfacePath(from,to,1,0));assert.notDeepEqual(changed,expected);
 r.registerRenderedCliffGeometry(from,{dx:1,dy:0},{lip:[],segments:[],drop:1});assert.deepEqual(r.transportSurfacePath(edge),[]);assert.equal(r.transportRouteStats.cliffBypasses,1);
});
