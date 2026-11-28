import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterRenderer} from '../../js/water-renderer.js';
import {EnvironmentRenderer} from '../../js/environment-renderer.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {TILE_SIZE,ELEVATION_HEIGHT} from '../../js/coordinate-system.js';
import {HydrologyEngine as H} from '../../js/hydrology-engine.js';
import {createRenderUpdate,applyRenderUpdate} from '../../js/pvp-render-delta.js';
import '../../js/tactical-engine.js';
import '../../js/environment-engine.js';
import '../../js/deployment-engine.js';
import '../../js/battle-presentation-controller.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const tile=(x,y,turbidity=0,extra={})=>({x,y,terrain:'WATER',elevation:0,waterDepth:1,waterSurfaceZ:1,waterTurbidity:turbidity,...extra});
const key=t=>`${t.x},${t.y}`;
const lookup=tiles=>new Map(tiles.map(t=>[key(t),t]));
function water(){
 return Object.assign(Object.create(WaterRenderer.prototype),{scene:{},surfaceResolver:new VisualSurfaceResolver(),waterSeamRegistry:new Map(),surfaceTopologyLayouts:new Map(),surfacePolygonTriangulations:new Map(),surfaceAnimations:new Map(),sheetFlowNetwork:new Map(),waterEdgeContinuityStats:{hits:0,misses:0},surfaceMeshUpdate:{estimatedUploadBytes:0,colorUploads:0},surfaceTriangulationStats:{reusedFaces:0,recomputedFaces:0,topologyVerifiedFacesReused:0,exactLayoutHits:0,exactLayoutMisses:0,elapsedMs:0},gpuSurfaceWaves:true,activeHydrologySources:()=>[],tileMotion:()=>({x:0,z:0,speed:0})});
}
const square=t=>{
 const cx=t.x*TILE_SIZE,cz=t.y*TILE_SIZE,h=TILE_SIZE/2;
 const p=(x,z)=>({x,z,level:1,depth:1});
 return [[p(cx-h,cz-h),p(cx,cz),p(cx+h,cz-h)],[p(cx+h,cz-h),p(cx,cz),p(cx+h,cz+h)],[p(cx+h,cz+h),p(cx,cz),p(cx-h,cz+h)],[p(cx-h,cz+h),p(cx,cz),p(cx-h,cz-h)]];
};
class Mesh{
 constructor(name){this.name=name;this.buffers={};this.uploads=[];}
 setVerticesData(k,v){this.buffers[k]=Float32Array.from(v);}
 getVerticesData(k){return this.buffers[k];}
 updateVerticesData(k,v){this.setVerticesData(k,v);this.uploads.push(k);}
 getIndices(){return this.indices;}
 freezeWorldMatrix(){}
}
class VertexData{
 static ComputeNormals(p,i,n){n.push(...p.map((v,j)=>j%3===1?1:0));}
 applyToMesh(m){for(const k of ['positions','normals','uvs','colors'])if(this[k])m.setVerticesData(k,this[k]);m.indices=this.indices.slice();}
}
globalThis.BABYLON={Mesh,VertexData,VertexBuffer:{ColorKind:'colors',PositionKind:'positions',NormalKind:'normals',UVKind:'uvs'}};
const resolved=tiles=>({tiles:tiles.map(t=>({tile:t,key:key(t),polygons:square(t),motion:{x:0,z:0,speed:0}})),excludedSubmergedShoulders:0,clippedSubmergedShoulders:0});
function colorAt(mesh,x,z=0){const p=mesh.getVerticesData('positions'),c=mesh.getVerticesData('colors');for(let i=0;i<p.length;i+=3)if(p[i]===x&&p[i+2]===z)return Array.from(c.slice(i/3*4,i/3*4+4));throw Error('vertex not found');}
function checkColor(actual,visual){actual.forEach((v,i)=>close(v,[...visual.color,visual.alpha][i]));}

import {ClimateEngine as C} from '../../js/climate-engine.js';
import {MassFlowEngine as M} from '../../js/mass-flow-engine.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const triangleStats=mesh=>{
 const p=mesh.getVerticesData('positions'),edges=new Map();let area=0;
 for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3);area+=Math.abs((p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2])-(p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3]))/2;
 for(const [u,v] of [[a,b],[b,c],[c,a]]){const k=[u,v].sort((a,b)=>a-b).join(':');edges.set(k,(edges.get(k)||0)+1);}}
 return {area,nonManifold:[...edges.values()].filter(n=>n>2).length};
};
test('late bridging contact produces one GPU vertex and a conforming union',()=>{
 const r=water(),tiles=[tile(0,0),tile(1,1),tile(1,0)],component={id:'bridge',group:'visible',tiles,sources:[]};
 r.surfaceEdgeContinuous=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=1;
 const p=resolved(tiles);p.tiles[0].motion={x:1,z:0,speed:1};p.tiles[1].motion={x:0,z:1,speed:2};
 const mesh=r.buildSurface(component,{},null,p,lookup(tiles)),pos=mesh.getVerticesData('positions');
 const xyz=[];for(let i=0;i<pos.length;i+=3)if(pos[i]===TILE_SIZE/2&&pos[i+2]===TILE_SIZE/2)xyz.push(i/3);
 assert.equal(xyz.length,1);near(triangleStats(mesh).area,3*TILE_SIZE*TILE_SIZE);assert.equal(triangleStats(mesh).nonManifold,0);
 const anim=r.surfaceAnimations.get(component.id);assert.equal(anim.flowSpeeds.length,pos.length/3);
});
test('overlapping published faces are partitioned rather than alpha drawn twice',()=>{
 const r=water(),t=tile(0,0),component={id:'overlap',group:'visible',tiles:[t],sources:[]};
 const p=(x,z)=>({x,z,level:1,depth:1}),a=p(-1,-1),b=p(1,-1),c=p(1,1),d=p(-1,1),e=p(0,0);
 const input={tiles:[{tile:t,key:key(t),polygons:[[a,b,c],[a,c,d],[a,b,d],[b,c,d],[a,b,e]],motion:{x:0,z:0,speed:0}}],excludedSubmergedShoulders:0,clippedSubmergedShoulders:0};
 const mesh=r.buildSurface(component,{},null,input,lookup([t]));near(triangleStats(mesh).area,4);assert.equal(triangleStats(mesh).nonManifold,0);
});
test('different disconnected height layers are not welded by the same xz',()=>{
 const r=water(),a=tile(0,0),b=tile(1,1,0,{waterDepth:2,waterSurfaceZ:2}),tiles=[a,b];
 r.surfaceEdgeContinuous=(a,b)=>a===b;const input=resolved(tiles);input.tiles[1].polygons=input.tiles[1].polygons.map(poly=>poly.map(p=>({...p,level:2,depth:2})));
 const mesh=r.buildSurface({id:'layers',group:'visible',tiles,sources:[]},{},null,input,lookup(tiles));const pos=mesh.getVerticesData('positions');const ys=[];for(let i=0;i<pos.length;i+=3)if(pos[i]===TILE_SIZE/2&&pos[i+2]===TILE_SIZE/2)ys.push(pos[i+1]);assert.equal(ys.length,2);assert.notEqual(ys[0],ys[1]);
});
function basin(depths){const w=depths.length+2,h=3;return {id:'closed-basin',width:w,height:h,objects:[],hydrology:{generatedRiverProfile:true},tiles:Array.from({length:w*h},(_,i)=>{const x=i%w,y=Math.floor(i/w),wall=y!==1||x===0||x===w-1;return {x,y,terrain:wall?'WALL':'WATER',dryTerrain:wall?'WALL':'PLAIN',material:'ROCK',elevation:wall?20:0,waterDepth:wall?0:depths[x-1],soilMoisture:0};})};}
test('committed tiny net flux is preserved and tiny residual remains physical water',()=>{
 const m=basin([1.002,1.001,1.0002]),before=H.waterInventory(m).total;H.redistribute(m);near(H.waterInventory(m).total,before);
 const t=m.tiles.find(t=>t.x===1&&t.y===1);H.setWaterDepth(t,H.EPSILON/4);near(H.waterDepth(t),H.EPSILON/4);near(H.removeWater(t,H.EPSILON/8),H.EPSILON/8);near(H.waterDepth(t),H.EPSILON/8);
});
test('tornado cargo and expiry are accounted as physical water',()=>{
 const E=globalThis.EnvironmentEngine,m=basin([2,2,2,2,2]),s=E.create({weather:'CLEAR',wind:{x:0,y:0,strength:0}});
 const before=H.waterInventory(m,s).total;E.createTornado(s,3,1,{map:m,duration:2});const first=H.waterInventory(m,s);assert.ok(first.tornadoWater>0);near(first.total,before);
 for(let i=0;i<2;i++){const events=E.advanceEnvironmentTurn(m,s),balance=events.find(e=>e.type==='HYDROLOGY_CYCLE_BALANCE');near(balance.unattributedDelta,0);E.tick(s);near(H.waterInventory(m,s).total,balance.after.total);}
 near(H.waterInventory(m,s).tornadoWater,0);
});
test('snow melt transfers exact water equivalent to the same physical store',()=>{
 const t=tile(0,0,0,{material:'ROCK',snowDepth:1.223,snowWaterEquivalent:.492867123}),m={tiles:[t]};const before=H.waterInventory(m).total;
 const melt=C.meltSnow(t,.0371234);H.addWater(t,melt.water);near(H.waterInventory(m).total,before);
});
test('mass-flow dry soil changes do not implicitly create a full pore-water store',()=>{
 const m={id:'dry-fan',width:5,height:3,objects:[],tiles:Array.from({length:15},(_,i)=>({x:i%5,y:Math.floor(i/5),elevation:i%5===0?1:0,terrain:'PLAIN',material:'SOIL',waterDepth:0}))};
 const before=H.waterInventory(m).total,f=M.trace(m,m.tiles[5],'SOIL',.88);M.apply(m,f,{events:[],source:'TEST'});near(H.waterInventory(m).total,before);
});

import {TerrainRenderer} from '../../js/terrain-renderer.js';
test('published terrain and submerged cliff mesh produce finite indexed water triangles',()=>{
 const ts=Array.from({length:144},(_,i)=>{const x=i%12,y=Math.floor(i/12);const z=x===5&&y===5?2:x===5&&y===6?1:0;return tile(x,y,0,{elevation:z,waterDepth:x>=3&&x<=8&&y>=3&&y<=8?2.5-z:0,waterSurfaceZ:2.5,material:'ROCK',terrain:x>=3&&x<=8&&y>=3&&y<=8?'WATER':'PLAIN',soilMoisture:0});});
 const resolver=new VisualSurfaceResolver(),by=lookup(ts),tr=Object.assign(Object.create(TerrainRenderer.prototype),{scene:{},surfaceResolver:resolver,surfaceMaterial:{},cliffMaterial:{},textureBounds:{minX:-.5,minY:-.5,spanX:12,spanY:12},landformFragments:{surface:new Map(),cliffs:new Map()},landformWork:{surfaceRebuilt:0,surfaceReused:0,cliffRebuilt:0,cliffReused:0,topologyReused:0,topologyUploads:0},updateCounts:{surfaceBuilds:0,cliffBuilds:0},surfaceColorBindings:[],cliffColorBindings:[]});
 tr.buildSurface(ts,by);tr.buildCliffs(ts,by);const r=water();r.surfaceResolver=resolver;r.waterTiles({map:{tiles:ts}});r.levelSamples=new Map();r.waterEdgeContinuity=new Map();resolver.beginPublishedSurfaceSampling();
 const p=resolver.presentationWaterSurfaces(ts,r.sheetFlowNetwork,(t,x,z)=>r.waterLevelAtWorld(t,x,z,by));const components=r.presentationComponents(p);assert.ok(components.length>0);r.surfacePresentation=p;r.surfaceMeshes=new Map();r.cascades=new Map();r.seamAuditRevision=1;r.waveTime=0;let tris=0,nonManifold=0,aliases=0;
 for(const c of components){const mesh=r.buildSurface(c,{},p,null,by);if(!mesh)continue;r.surfaceMeshes.set(c.id,mesh);const positions=mesh.getVerticesData('positions');assert.ok(positions.every(Number.isFinite));assert.ok(mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length/3));tris+=mesh.indices.length/3;nonManifold+=triangleStats(mesh).nonManifold;const seen=new Set();for(let i=0;i<positions.length;i+=3){const k=Array.from(positions.slice(i,i+3)).join(':');if(seen.has(k))aliases++;seen.add(k);}}
 assert.ok(tris>100);assert.equal(aliases,0);assert.equal(nonManifold,0);const audit=r.waterSeamDiagnostics();console.log("actual terrain audit",JSON.stringify({triangles:audit.triangles,nonManifoldEdges:audit.nonManifoldEdges,sameMeshWaveInputMismatch:audit.sameMeshWaveInputMismatch,degenerateTriangles:audit.degenerateTriangles,internalBoundaries:audit.internalBoundaries}));assert.equal(audit.nonManifoldEdges,0);assert.equal(audit.sameMeshWaveInputMismatch,0);assert.equal(audit.internalBoundaries.internalMissingSurfaceEdges,0);
});

test('partially intersecting clipped polygons publish exactly their union area',()=>{
 const r=water(),t=tile(0,0),component={id:'partial-overlap',group:'visible',tiles:[t],sources:[]};const p=(x,z)=>({x,z,level:1,depth:1});
 const a=[p(-1,-.75),p(.5,-.75),p(.5,.75),p(-1,.75)],b=[p(-.5,-.5),p(1,-.5),p(1,1),p(-.5,1)];
 const input={tiles:[{tile:t,key:key(t),polygons:[a,b],motion:{x:0,z:0,speed:0}}],excludedSubmergedShoulders:0,clippedSubmergedShoulders:0};
 const mesh=r.buildSurface(component,{},null,input,lookup([t]));near(triangleStats(mesh).area,3.25);assert.equal(triangleStats(mesh).nonManifold,0);
});

test('three source faces sharing one edge cannot create a non-manifold water edge',()=>{
 const r=water(),t=tile(0,0),p=(x,z)=>({x,z,level:1,depth:1});const a=p(-1,0),b=p(1,0),c=p(-.5,1),d=p(.5,1),e=p(0,-1);
 const input={tiles:[{tile:t,key:key(t),polygons:[[a,b,c],[a,b,d],[b,a,e]],motion:{x:0,z:0,speed:0}}],excludedSubmergedShoulders:0,clippedSubmergedShoulders:0};
 const mesh=r.buildSurface({id:'three-face-edge',group:'visible',tiles:[t],sources:[]},{},null,input,lookup([t]));const stats=triangleStats(mesh);assert.equal(stats.nonManifold,0);assert.ok(Math.abs(stats.area-7/3)<1e-6,`union area ${stats.area}`);
});
