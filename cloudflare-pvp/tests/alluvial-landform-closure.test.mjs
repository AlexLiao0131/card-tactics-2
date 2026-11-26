import test from 'node:test';
import assert from 'node:assert/strict';
import {HydrologyEngine as H} from '../../js/hydrology-engine.js';
import '../../js/tactical-engine.js';
import {EnvironmentResolver as E} from '../../js/environment-resolver.js';
import {MassFlowEngine as M} from '../../js/mass-flow-engine.js';
import {BurialEngine as B} from '../../js/burial-engine.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {projectMassFlowPresentation} from '../src/pvp-headless-presentation.mjs';
const near=(a,b,tol=.00011)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const mapOf=(height=(x,y)=>x===0?1:0,kind='SOIL',w=5,h=3)=>({id:'alluvial',width:w,height:h,objects:[],tiles:Array.from({length:w*h},(_,i)=>{const x=i%w,y=Math.floor(i/w);return{x,y,elevation:height(x,y),terrain:'PLAIN',material:kind,waterDepth:0,soilMoisture:kind==='SOIL'?.4:0};})});
const at=(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y);
const sum=(m,f)=>m.tiles.reduce((n,t)=>n+f(t),0);
const solid=m=>sum(m,t=>t.elevation+H.sedimentMass(t));
const run=(map,kind,initial,start=at(map,0,1))=>{const flow=M.trace(map,start,kind,initial),events=[],result=M.apply(map,flow,{events,source:'TEST'});return{flow,events,result}};

test('0.88 downhill release reaches level terrain and deposits across a real fan; source and final geometry differ',()=>{
 const m=mapOf(),before=structuredClone(m),massBefore=solid(m),renderer=Object.assign(Object.create(TerrainRenderer.prototype),{surfaceResolver:new VisualSurfaceResolver()});
 const signature=renderer.geometrySignature(before.tiles),{flow,result}=run(m,'SOIL',.88);
 assert.ok(flow.path.length>2);assert.equal(flow.path[2].drop,0);assert.ok(flow.cells.length>flow.path.length);
 near(at(m,0,1).elevation,.12);near(result.totalErosion,.88);near(result.totalDeposit,.88);near(solid(m),massBefore);
 assert.ok(at(m,2,0).elevation>0&&at(m,2,2).elevation>0);assert.notEqual(renderer.geometrySignature(m.tiles),signature);
 const by=new Map(m.tiles.map(t=>[`${t.x},${t.y}`,t])),old=new Map(before.tiles.map(t=>[`${t.x},${t.y}`,t]));
 assert.ok(renderer.surfaceResolver.sampleRenderedHeight(at(m,0,1),by)<renderer.surfaceResolver.sampleRenderedHeight(at(before,0,1),old));
});
test('no new route can cross a wall or climb an uphill rim',()=>{
 const m=mapOf((x,y)=>x===0?2:x===1?0:3);at(m,1,0).terrain='WALL';at(m,1,2).terrain='WALL';
 const {flow,result}=run(m,'SOIL',.88);assert.equal(flow.path.length,2);assert.equal(flow.cells.length,2);near(result.totalErosion,result.totalDeposit);assert.equal(at(m,1,0).elevation,0);
});
test('ground source, wet fan, suspended solids and actual bed settling close volume balance',()=>{
 const m=mapOf((x,y)=>x===0?1:0);for(const t of m.tiles.filter(t=>t.x>0)){t.terrain='WATER';t.dryTerrain='PLAIN';t.waterDepth=1;t.waterSurfaceZ=1;t.hydrologyBedMaterial='SILT';}
 const start=solid(m),{flow,result}=run(m,'SOIL',.88);assert.ok(result.totalSuspended>0);near(result.totalErosion,result.totalDeposit+result.totalSuspended);near(solid(m),start);
 const wet=m.tiles.find(t=>H.sedimentMass(t)>0);assert.ok(wet.waterTurbidity>0);const previous=wet.elevation,prior=H.sedimentMass(wet),events=[];
 const deposited=H.settleSediment(wet,E.CFG.TURBIDITY_SETTLE_PER_TURN,events);assert.ok(deposited>0);near(wet.elevation-previous,deposited);near(H.sedimentMass(wet)+deposited,prior);near(solid(m),start);assert.ok(events.some(e=>e.type==='ELEVATION_CHANGED'));
});
test('adding clear water dilutes without manufacturing sediment; evaporation preserves solids',()=>{
 const t={x:0,y:0,elevation:0,terrain:'WATER',dryTerrain:'PLAIN',material:'ROCK',waterDepth:2,waterTurbidity:.25};
 near(H.sedimentMass(t),.5);H.setWaterDepth(t,4);near(t.waterTurbidity,.125);near(H.sedimentMass(t),.5);H.setWaterDepth(t,1);near(t.waterTurbidity,.5);near(H.sedimentMass(t),.5);
 H.setWaterDepth(t,0);near(H.sedimentMass(t),.5);H.settleSediment(t,E.CFG.TURBIDITY_SETTLE_PER_TURN);near(t.elevation,.5);near(H.sedimentMass(t),0);
});
test('actual hydrology flux exports suspended sediment only through a reported outlet, otherwise transports or retains it',()=>{
 const m=mapOf((x,y)=>-x,'ROCK',4,1);for(const t of m.tiles){t.terrain='WATER';t.dryTerrain='HIGH_GROUND';t.waterDepth=t.x===0?3:.3;}
 const events=[];H.suspendSediment(m.tiles[0],.3,events,'TEST');const initial=solid(m);H.redistribute(m,{events,source:'TEST'});
 const exported=events.filter(e=>e.type==='SEDIMENT_DRAINED_OFF_MAP').reduce((s,e)=>s+e.amount,0);
 near(solid(m)+exported,initial,.001);assert.ok(m.tiles.slice(1).some(t=>H.sedimentMass(t)>0)||exported>0);
});
test('only measured flow remobilizes deposited fines, bounded by stock and water capacity',()=>{
 const m=mapOf((x,y)=>-x,'ROCK',4,1);for(const t of m.tiles){t.terrain='WATER';t.dryTerrain='HIGH_GROUND';t.waterDepth=t.x===0?8:1;}
 const t=m.tiles[0];t.sedimentDeposit=.4;const initial=solid(m),events=[];H.redistribute(m,{events,source:'TEST'});
 const res=events.filter(e=>e.type==='SEDIMENT_REENTRAINED'),exports=events.filter(e=>e.type==='SEDIMENT_DRAINED_OFF_MAP').reduce((s,e)=>s+e.amount,0);
 assert.ok(res.length>0);assert.ok(t.sedimentDeposit<.4&&t.sedimentDeposit>=0);near(solid(m)+exports,initial,.001);
});
test('snow spreads without changing mineral ground or losing water equivalent',()=>{
 const m=mapOf((x,y)=>x===0?2:0);for(const t of m.tiles){t.snowDepth=t.x===0?2:.3;t.snowWaterEquivalent=t.snowDepth*.4;}
 const depths=sum(m,t=>t.snowDepth),swe=sum(m,t=>t.snowWaterEquivalent),ground=sum(m,t=>t.elevation),{flow}=run(m,'SNOW',1.6);
 assert.ok(flow.cells.length>flow.path.length);near(sum(m,t=>t.snowDepth),depths);near(sum(m,t=>t.snowWaterEquivalent),swe);near(sum(m,t=>t.elevation),ground);
});
test('rock shoulder can fail only when loss of support crosses existing cliff threshold; no rock duplication',()=>{
 const m=mapOf((x,y)=>x===0?(y===0?2.5:2):0,'ROCK',4,3);for(const t of m.tiles){t.rockMass=2;t.rockCohesion=.5;}
 const shoulder=at(m,0,0),before=solid(m),old=shoulder.elevation,inventory=sum(m,t=>t.rockMass),{flow,result}=run(m,'ROCK',1.2);
 assert.ok(shoulder.elevation<old);assert.ok(flow.cells.some(p=>p.x===0&&p.y===0&&p.erosion>0));near(solid(m),before);near(sum(m,t=>t.rockMass),inventory,.005);near(result.totalErosion,result.totalDeposit);
});
test('lateral fan deposition participates in the original burial and filtered PVP event',()=>{
 const m=mapOf(),{flow,events}=run(m,'SOIL',.88),keys=new Set(flow.path.map(p=>`${p.x},${p.y}`)),side=flow.cells.find(p=>!keys.has(`${p.x},${p.y}`)&&p.deposit>0);
 const unit={id:'side',alive:true,x:side.x,y:side.y,character:{name:'side',collision:{height:1}}};assert.equal(B.applyEnvironmentEvents([unit],m,events).length,1);assert.ok(unit.burial.depth>0);
 const observers=m.tiles.map((t,i)=>({id:`p${i}`,team:'P',alive:true,x:t.x,y:t.y,character:{visionRange:4,passives:[]}}));
 const event=M.event(flow),visible=projectMassFlowPresentation(event,m,observers,'P',null);
 assert.ok(visible.cells.some(p=>p.x===side.x&&p.y===side.y));assert.equal(projectMassFlowPresentation(event,m,observers,'E',null),null);
});
