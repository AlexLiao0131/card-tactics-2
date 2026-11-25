import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import {MapGenerator as G} from '../../js/map-generator.js';
const key=(x,y)=>`${x},${y}`,dirs=[[1,0],[-1,0],[0,1],[0,-1]];
// Independent graph audit of generated maps; no private generator helpers or
// mocked pathfinding. Ordinary unit height step is the existing one-grid rule.
function reachable(map,objects,start){
 const by=new Map(map.tiles.map(t=>[key(t.x,t.y),t]));
 const blocked=new Set(objects.filter(o=>o.blocksMovement&&!o.destroyed).map(o=>key(o.x,o.y)));
 const height=t=>Number(t.elevation||0)+Math.max(0,Number(t.waterDepth||0));
 const seen=new Set([key(start.x,start.y)]),q=[start];
 for(let i=0;i<q.length;i++){
  const p=q[i],from=by.get(key(p.x,p.y));
  for(const [dx,dy] of dirs){const k=key(p.x+dx,p.y+dy),t=by.get(k);
   if(!t||seen.has(k)||blocked.has(k)||!TERRAINS[t.terrain]?.passable||Math.abs(height(t)-height(from))>1.0001)continue;
   seen.add(k);q.push(t);
  }
 }
 return seen;
}
const rocksOf=map=>map.objects.filter(o=>o.type==='ROCK');
test('rocks preserve ordinary mountain access from both bases across 200 deterministic maps',()=>{
 for(const size of Object.keys(G.SIZE_PRESETS))for(let seed=0;seed<50;seed++){
  const {map,cores,meta}=G.generateVersus({size,seed}),rocks=rocksOf(map),fixed=map.objects.filter(o=>o.type!=='ROCK');
  const context=`${size}/${seed}`,blocked=new Set(rocks.map(o=>key(o.x,o.y)));
  assert.equal(meta.validation,'PASS',context);
  assert.equal(rocks.length,G.SIZE_PRESETS[size].rocks,context);
  for(const t of map.tiles)if(t.mountainRamp)assert.ok(!blocked.has(key(t.x,t.y)),`${context}: ramp ${t.x},${t.y}`);
  for(const core of cores){const before=reachable(map,fixed,core),after=reachable(map,map.objects,core);
   for(const t of map.tiles){const k=key(t.x,t.y);if(!before.has(k))continue;
    if(t.mountainRamp||(t.elevation>=2&&!blocked.has(k)))assert.ok(after.has(k),`${context}: ${core.owner} lost ${k}`);
   }
  }
 }
});
test('the final validator rejects a rock on a marked ramp independently of the placement filter',()=>{
 let result;
 for(let seed=0;seed<50;seed++){const g=G.generateVersus({size:'SMALL',seed});if(g.map.tiles.some(t=>t.mountainRamp)){result=g;break;}}
 assert.ok(result);const {map,cores,deploymentPoints}=result;
 const t=map.tiles.find(t=>t.mountainRamp),objects=[...map.objects.filter(o=>o.type!=='CORE'),{type:'ROCK',x:t.x,y:t.y,blocksMovement:true}];
 // The full route list is private to generation; isolate the public validator's
 // mountain check using the real generated terrain and neutral capture points.
 const report=G.validateBattlefield(map,objects,cores,deploymentPoints.filter(p=>p.owner==='NEUTRAL'),[],{crossings:[]});
 assert.equal(report.ok,false);assert.ok(report.errors.includes(`MOUNTAIN_RAMP_ROCK_${t.x}_${t.y}`));
});
test('natural slope access is validated even where no artificial ramp flag exists',()=>{
 let found=false;
 for(let seed=0;seed<30&&!found;seed++){
  const {map,cores,deploymentPoints}=G.generateVersus({size:'SMALL',seed});
  const fixed=map.objects.filter(o=>o.type!=='ROCK'),before=cores.map(c=>reachable(map,fixed,c));
  for(const t of map.tiles){if(t.mountainRamp||t.routeId||t.river||t.captureZone||t.hydrologyNaturalChannelPool||fixed.some(o=>o.x===t.x&&o.y===t.y))continue;
   const rock={type:'ROCK',x:t.x,y:t.y,blocksMovement:true};
   if(!cores.some((c,i)=>{const after=reachable(map,[...fixed,rock],c);return map.tiles.some(h=>h.elevation>=2&&!h.mountainRamp&&key(h.x,h.y)!==key(t.x,t.y)&&before[i].has(key(h.x,h.y))&&!after.has(key(h.x,h.y)));}))continue;
   const report=G.validateBattlefield(map,[...fixed.filter(o=>o.type!=='CORE'),rock],cores,deploymentPoints.filter(p=>p.owner==='NEUTRAL'),[],{crossings:[]});
   assert.equal(report.ok,false);assert.ok(report.errors.some(e=>e.startsWith('MOUNTAIN_ACCESS_LOST_')));found=true;break;
  }
 }
 assert.ok(found,'fixture sweep must exercise an unmarked natural slope bottleneck');
});
