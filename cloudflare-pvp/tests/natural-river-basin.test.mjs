import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import {HydrologyEngine as H} from '../../js/hydrology-engine.js';
import {MapGenerator as G} from '../../js/map-generator.js';
const close=(a,b,tolerance=H.EPSILON)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} (tol ${tolerance})`);
const tile=(x,y,elevation,extra={})=>({x,y,elevation,terrain:'PLAIN',material:'ROCK',waterDepth:0,...extra});
const river=(x,y,elevation,extra={})=>tile(x,y,elevation,{river:true,hydrologyTransportInitialized:true,hydrologyBedMaterial:'ROCK',baseDischarge:1,discharge:1,baseFlowSpeed:.62,flowSpeed:.62,hydrologyChannelIncision:.25,flowX:1,flowY:0,...extra});
const world=(tiles,width,height)=>({id:'basin-audit',width,height,tiles,objects:[],hydrology:{generatedRiverProfile:true,preserveRiverProfile:true}});
const drained=events=>events.filter(e=>e.type==='RIVER_THROUGHFLOW_DRAINED'||e.type==='WATER_DRAINED_OFF_MAP').reduce((sum,e)=>sum+e.amount,0);
test('natural geology permits no pool; irregular larger pools are deterministic and retain zero initial water',()=>{
 const empty=G.generateVersus({size:'SMALL',seed:0});assert.equal(empty.map.generatedRiverProfile.pools.length,0);
 const params={size:'XLARGE',seed:10},a=G.generateVersus(params),b=G.generateVersus(params);
 assert.deepEqual(a,b);assert.equal(a.meta.validation,'PASS');
 const map=a.map,pools=map.generatedRiverProfile.pools;
 assert.ok(pools.some(p=>p.shoulders.length>=5));
 assert.ok(pools.some(p=>p.shoulders.some(c=>c.interior)&&p.shoulders.some(c=>!c.interior)));
 const occupied=new Set();
 for(const pool of pools){const cells=[{x:pool.x,y:pool.y},...pool.shoulders];let volume=0;
  for(const c of cells){const t=H.tileAt(map,c.x,c.y);assert.ok(t.hydrologyNaturalChannelPool);assert.equal(t.river,undefined);assert.ok(!t.routeId&&!t.captureZone&&!t.core);assert.equal(t.waterDepth,0);assert.equal(t.waterSurfaceZ,null);assert.ok(!occupied.has(`${c.x},${c.y}`));occupied.add(`${c.x},${c.y}`);volume+=pool.outletBed-t.elevation;}
  const outlet=H.tileAt(map,pool.downstreamX,pool.downstreamY);assert.ok(outlet.river);close(pool.storageAtSpill,volume,cells.length*H.EPSILON);
  assert.ok(!map.objects.some(o=>o.blocksMovement&&cells.some(c=>o.x===c.x&&o.y===c.y)));
 }
});
test('an actual outlet accepts and releases same-step inflow without creating or deleting water',()=>{
 const a=river(0,0,0,{waterDepth:.35}),b=river(1,0,-.01,{waterDepth:.3}),out=river(2,0,-.02,{hydrologyDrain:true,flowX:0});
 const m=world([a,b,out],3,1),before=H.totalWater(m);
 const events=H.redistribute(m,{source:'OUTLET_TEST'});assert.ok(drained(events)>0);assert.ok(out.waterDepth>0);assert.ok(out.hydrologyMeasuredOutletRate>0);close(before-H.totalWater(m),drained(events),3*H.EPSILON);
 assert.ok(out.hydrologyMeasuredOutletRate<=out.outletEffectiveCapacity+H.FLOW_EPSILON);
});
test('same-step outlet projection still cannot transport water uphill across a dry high sill',()=>{
 const a=river(0,0,0,{waterDepth:.2}),b=river(1,0,3),out=river(2,0,2,{hydrologyDrain:true,flowX:0});
 const m=world([a,b,out],3,1);const events=H.redistribute(m,{source:'DAM_TEST'});
 assert.equal(b.waterDepth,0);assert.equal(out.waterDepth,0);assert.equal(drained(events),0);close(H.totalWater(m),.2);
});
test('a connected carved basin accepts flow at more than one physically open river mouth',()=>{
 const a=river(1,1,0,{waterDepth:.35,flowX:0,flowY:1}),b=river(1,2,-.01,{waterDepth:.35,flowX:0,flowY:1});
 const c=tile(2,1,-1,{waterDepth:.15,hydrologyNaturalChannelPool:true}),d=tile(2,2,-1.01,{waterDepth:.15,hydrologyNaturalChannelPool:true});
 const m=world([a,b,c,d],4,4),before=H.totalWater(m),events=H.redistribute(m,{source:'MOUTHS_TEST'});
 assert.ok(events.some(e=>e.type==='RIVER_STORED_FLOW'&&e.lakeInflow>0));assert.ok(c.waterDepth>.15&&d.waterDepth>.15);close(H.totalWater(m),before,4*H.EPSILON);
});
test('initial source history records measured supply, physical drains, local convergence and bounded work',()=>{
 const {map}=G.generateVersus({size:'MEDIUM',seed:42});H.initializeMap(map);const r=map.hydrologyInitialSourceSettle;
 assert.ok(r.plan.estimatedStorage>0&&r.plan.sourceVolumePerTurn>0);assert.ok(r.plan.estimatedTurns>192);assert.ok(r.turns>192);assert.ok(r.turns<=r.plan.workLimit);assert.ok(r.injectedVolume>0);assert.ok(r.drainedVolume>=0);assert.ok(Number.isFinite(r.maxDepthDelta)&&Number.isFinite(r.maxSoilDelta));
 close(r.beforeVolume+r.injectedVolume-r.drainedVolume-r.afterVolume,r.massBalanceError,H.EPSILON*2);
 assert.ok(Math.abs(r.massBalanceError)<=H.EPSILON*r.turns*map.tiles.length);
 if(r.stable){assert.equal(r.stopReason,'EQUILIBRIUM');assert.ok(r.reachedOutlet);assert.ok(Math.abs(r.lastNetVolume)<=H.FLOW_EPSILON);assert.ok(r.maxDepthDelta<=H.FLOW_EPSILON&&r.maxSoilDelta<=H.FLOW_EPSILON);}
 else assert.notEqual(r.stopReason,'EQUILIBRIUM');
 const explicit=H.settleInitialSources(map,{maxTurns:2});assert.ok(explicit.turns<=2);if(!explicit.stable)assert.equal(explicit.stopReason,'CALLER_LIMIT');
});
