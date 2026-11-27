import test from 'node:test';
import assert from 'node:assert/strict';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {MapObjectRenderer} from '../../js/map-object-renderer.js';
import {BabylonRenderer} from '../../js/babylon-renderer.js';
class Mesh {
  constructor(name){this.name=name;this.buffers={};this.indices=[];this.uploads=[];}
  setVerticesData(k,v){this.buffers[k]=Array.from(v);this.uploads.push(k);}
  updateVerticesData(k,v){this.setVerticesData(k,v);}
  getVerticesData(k){return this.buffers[k];}
  getIndices(){return this.indices;}
  getTotalVertices(){return (this.buffers.position||[]).length/3;}
}
class VertexData {applyToMesh(m){m.indices=Array.from(this.indices);m.setVerticesData('position',this.positions);m.setVerticesData('normal',this.normals);if(this.uvs)m.setVerticesData('uv',this.uvs);}}
globalThis.BABYLON={Mesh,VertexData,VertexBuffer:{PositionKind:'position',NormalKind:'normal',ColorKind:'color',UVKind:'uv'}};
const fakeTerrain=()=>Object.assign(Object.create(TerrainRenderer.prototype),{scene:{},surfaceResolver:new VisualSurfaceResolver(),surfaceMaterial:{},cliffMaterial:{},textureBounds:{minX:-.5,minY:-.5,spanX:12,spanY:12},landformFragments:{surface:new Map(),cliffs:new Map()},landformWork:{surfaceRebuilt:0,surfaceReused:0,cliffRebuilt:0,cliffReused:0,topologyReused:0,topologyUploads:0},updateCounts:{surfaceBuilds:0,cliffBuilds:0},surfaceColorBindings:[],cliffColorBindings:[]});
function tiles(){return Array.from({length:144},(_,i)=>{const x=i%12,y=Math.floor(i/12);return{x,y,elevation:x===5&&y===5?4:x===5&&y===6?2:0,terrain:'PLAIN',material:'SOIL',waterDepth:0,soilMoisture:0};});}
const index=t=>new Map(t.map(v=>[`${v.x},${v.y}`,v]));
const meshes=(r,t,previous=[])=>{const by=index(t);return[r.buildSurface(t,by,previous[0]),r.buildCliffs(t,by,previous[1])];};
function equalMesh(actual,expected){assert.deepEqual(actual.indices,expected.indices);assert.deepEqual(actual.buffers,expected.buffers);assert.deepEqual(actual.metadata,expected.metadata);}
function geomContent(map){return [...map].map(([k,{revision,...data}])=>[k,data]).sort(([a],[b])=>a.localeCompare(b));}
test('one changed elevation rebuilds only the conservative two-cell halo, equals full cold geometry and retains unaffected registry identity',()=>{
  const t=tiles(),r=fakeTerrain(),old=meshes(r,t),untouched=r.surfaceResolver.getRenderedSurfaceGeometry(t[0]);
  const cliffKey=r.surfaceResolver.cliffGeometryKey(t[0],{id:'N'}),untouchedCliff=r.surfaceResolver.renderedCliffGeometry.get(cliffKey);
  t[5+5*12].elevation-=.12;
  const updated=meshes(r,t,old),fresh=fakeTerrain(),full=meshes(fresh,t);
  assert.equal(r.landformWork.surfaceRebuilt,144+25);assert.equal(r.landformWork.cliffRebuilt,144+25);
  assert.equal(r.landformWork.surfaceReused,119);assert.equal(r.landformWork.cliffReused,119);
  assert.equal(r.surfaceResolver.getRenderedSurfaceGeometry(t[0]),untouched);
  assert.equal(r.surfaceResolver.renderedCliffGeometry.get(cliffKey),untouchedCliff);
  assert.equal(updated[0],old[0]);assert.equal(updated[1],old[1]);
  assert.equal(r.landformWork.topologyReused,2);
  equalMesh(updated[0],full[0]);equalMesh(updated[1],full[1]);
  assert.deepEqual(geomContent(r.surfaceResolver.renderedSurfaceGeometry),geomContent(fresh.surfaceResolver.renderedSurfaceGeometry));
  assert.deepEqual(geomContent(r.surfaceResolver.renderedCliffGeometry),geomContent(fresh.surfaceResolver.renderedCliffGeometry));
});
test('material-only change outside changed height halo recolors cached geometry exactly and preserves its revision',()=>{
  const t=tiles(),r=fakeTerrain(),old=meshes(r,t),prior=r.surfaceResolver.getRenderedSurfaceGeometry(t[0]);
  t[0].terrain='MUD';t[0].soilMoisture=.45;t[0].fogged=true;t[5+5*12].elevation-=.1;
  const updated=meshes(r,t,old),fresh=fakeTerrain(),full=meshes(fresh,t);
  equalMesh(updated[0],full[0]);equalMesh(updated[1],full[1]);
  assert.equal(r.surfaceResolver.getRenderedSurfaceGeometry(t[0]),prior);
});
test('minimum elevation change invalidates boundary wall footprints and cliff topology crossing matches cold build',()=>{
  const t=tiles(),r=fakeTerrain(),old=meshes(r,t);t[5+5*12].elevation=.5;t[9+9*12].elevation=-.4;
  const updated=meshes(r,t,old),full=meshes(fakeTerrain(),t);
  equalMesh(updated[0],full[0]);equalMesh(updated[1],full[1]);assert.ok(r.landformWork.topologyUploads>=3);
});
test('GPU wind batches update only a mutable clock at animation time, not CPU vertices or buffers',()=>{
  let uploads=0,clock=null,bounds=0;
  const batch={windAttributes:{},mesh:{updateVerticesData:()=>uploads++}},source={metadata:{leafSway:{weights:[1]}},isEnabled:()=>true};
  const r=Object.assign(Object.create(MapObjectRenderer.prototype),{vegetationTime:0,vegetationFrameTime:0,vegetationWasCalm:true,vegetationWind:{strength:1,x:3,y:4},gpuWindClock:{set:(...v)=>clock=v},gpuWindMaterial:{},staticBatches:new Map([['a',batch]]),vegetationSways:new Set([source]),batchedSwayMembers:new Map([[source,{batch}]]),windBatchMetrics:{gpuGroups:0,gpuUniformTicks:0,positionUploads:0},ensureWindBatchBounds:()=>bounds++});
  r.updateVegetationWind(.04);assert.equal(uploads,0);assert.equal(r.windBatchMetrics.positionUploads,0);assert.deepEqual(clock,[.04,.6,.8,1]);assert.equal(bounds,1);
  r.vegetationWind={strength:0,x:0,y:0};r.updateVegetationWind(.04);assert.equal(clock[3],0);assert.equal(uploads,0);
});
test('GPU leaf attributes encode the original transformed, weighted displacement including default bush amplitude',()=>{
  const batch={windAttributes:{local:new Float32Array(4),x:new Float32Array(4),z:new Float32Array(4)}};
  const member={count:1,offset:0,worldMatrix:[2,0,0,0,0,1,0,0,0,0,3,0,0,0,0,1],mesh:{metadata:{leafSway:{weights:[.5],phase:1,localWindBasis:{xx:.5,xz:0,zx:0,zz:1/3}}}}};
  MapObjectRenderer.prototype.writeGpuWindMember(batch,member);
  assert.equal(batch.windAttributes.x[0],Math.fround(2*.5*.022));assert.equal(batch.windAttributes.z[2],Math.fround(3*.5*.022));
  assert.equal(batch.windAttributes.x[3],1);assert.equal(batch.windAttributes.z[3],Math.fround(1.9));
});
test('grass animation uses clock only on GPU path, with calm state resetting the bend',()=>{
  let writes=0,last=null;const r=Object.assign(Object.create(TerrainRenderer.prototype),{grassTime:0,grassFrameTime:0,grassWasCalm:true,grassGpuWind:true,grassWindClock:{set:(...a)=>last=a},grassWindMetrics:{uniformTicks:0},grassMesh:{isEnabled:()=>true,updateVerticesData:()=>writes++},grassWind:{strength:2,x:0,y:-1}});
  r.animateGrass(.04);assert.deepEqual(last,[.04,0,-1,2]);r.grassWind.strength=0;r.animateGrass(.04);assert.equal(last[3],0);assert.equal(writes,0);
});
test('single shadow target caches static frames, refreshes idle moving casters at 30 Hz and full-rate combat, invalidates on camera and snapshot changes',()=>{
  let resets=0;const target={refreshRate:1,resetRefreshCounter:()=>resets++,getSize:()=>({width:1024,height:1024})},cam={position:{x:0,y:0,z:0}},cache={dirty:true,lastRefreshAt:-Infinity,lastView:null,hasUnitCasters:false,hasWindCasters:false,scheduled:0,reused:0,fullRate:0,staticReuses:0};
  const r=Object.assign(Object.create(BabylonRenderer.prototype),{scene:{activeCamera:cam},sun:{},shadowGenerator:{getShadowMap:()=>target},shadowCache:cache,units:{activeAnimations:new Map(),animationQueues:new Map()}});
  r.prepareShadowRefresh(0);assert.equal(resets,1);assert.equal(target.refreshRate,0);
  r.prepareShadowRefresh(16);r.prepareShadowRefresh(100);assert.equal(resets,1);assert.equal(cache.staticReuses,2);
  cache.hasUnitCasters=true;r.prepareShadowRefresh(101);r.prepareShadowRefresh(117);r.prepareShadowRefresh(135);assert.equal(resets,3);
  r.units.activeAnimations.set('unit',{});r.prepareShadowRefresh(140);r.prepareShadowRefresh(145);assert.equal(resets,5);
  r.units.activeAnimations.clear();r.prepareShadowRefresh(146);assert.equal(resets,6);
  cam.position.x=1;r.prepareShadowRefresh(147);assert.equal(resets,7);
  cache.dirty=true;r.prepareShadowRefresh(148);assert.equal(resets,8);
});
