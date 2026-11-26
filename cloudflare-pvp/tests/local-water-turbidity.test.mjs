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
 applyToMesh(m){for(const k of ['positions','normals','uvs','colors'])m.setVerticesData(k,this[k]);m.indices=this.indices.slice();}
}
globalThis.BABYLON={Mesh,VertexData,VertexBuffer:{ColorKind:'colors',PositionKind:'positions',NormalKind:'normals',UVKind:'uvs'}};
const resolved=tiles=>({tiles:tiles.map(t=>({tile:t,key:key(t),polygons:square(t),motion:{x:0,z:0,speed:0}})),excludedSubmergedShoulders:0,clippedSubmergedShoulders:0});
function colorAt(mesh,x,z=0){const p=mesh.getVerticesData('positions'),c=mesh.getVerticesData('colors');for(let i=0;i<p.length;i+=3)if(p[i]===x&&p[i+2]===z)return Array.from(c.slice(i/3*4,i/3*4+4));throw Error('vertex not found');}
function checkColor(actual,visual){actual.forEach((v,i)=>close(v,[...visual.color,visual.alpha][i]));}

test('official water vertices reflect local concentrations, connected seams and clear far shore',()=>{
 const r=water(),tiles=[tile(0,0,1),tile(1,0,0),tile(2,0,0)],component={id:'lake',group:'visible',tiles,sources:[]};
 r.waterTiles({map:{tiles}});const mesh=r.buildSurface(component,{},null,resolved(tiles),lookup(tiles));
 checkColor(colorAt(mesh,0),r.waterVertexVisual({depth:1},null,1));
 checkColor(colorAt(mesh,2*TILE_SIZE),r.waterVertexVisual({depth:1},null,0));
 // The shared vertex has one mixed concentration, not one colour per tile.
 checkColor(colorAt(mesh,TILE_SIZE/2,TILE_SIZE/2),r.waterVertexVisual({depth:1},null,.5));
 const positions=Array.from(mesh.getVerticesData('positions')),indices=mesh.indices.slice(),before=Array.from(mesh.getVerticesData('colors'));
 // Same component-average but relocated sediment must trigger new local colours.
 tiles[0].waterTurbidity=0;tiles[2].waterTurbidity=1;
 r.resetWaterSeamRegistry();const animation=r.surfaceAnimations.get(component.id);
 assert.equal(r.refreshSurfaceAttributes(component,resolved(tiles),{},mesh,animation,lookup(tiles)),true);
 assert.deepEqual(mesh.uploads,['colors']);assert.notDeepEqual(Array.from(mesh.getVerticesData('colors')),before);
 assert.deepEqual(Array.from(mesh.getVerticesData('positions')),positions);assert.deepEqual(mesh.indices,indices);
 checkColor(colorAt(mesh,0),r.waterVertexVisual({depth:1},null,0));
 checkColor(colorAt(mesh,2*TILE_SIZE),r.waterVertexVisual({depth:1},null,1));
 // Clearing all sediment restores the original optical baseline.
 tiles[2].waterTurbidity=0;r.gpuSurfaceWaves=false;r.resetWaterSeamRegistry();assert.ok(r.refreshSurfaceAttributes(component,resolved(tiles),{},mesh,animation,lookup(tiles)));
 checkColor(colorAt(mesh,2*TILE_SIZE),r.waterVertexVisual({depth:1},null,0));
});

test('local sampler obeys hard cliff, diagonal isolation and stored D ownership at D/Q join',()=>{
 const r=water(),a=tile(0,0,0),b=tile(1,0,1),diagonal=tile(1,1,1),q=tile(0,1,1,{waterDepth:0});
 r.surfaceEdgeContinuous=(left,right)=>left===right||(left===a&&right===q)||(left===q&&right===a);
 const by=lookup([a,b,diagonal,q]);
 close(r.localWaterTurbidity(TILE_SIZE/2,0,[a],by,true),0);
 close(r.localWaterTurbidity(TILE_SIZE/2,TILE_SIZE/2,[a],by,true),0);
 close(r.localWaterTurbidity(0,TILE_SIZE/2,[q,a],by,true),0);
 close(r.localWaterTurbidity(0,TILE_SIZE/2,[q],by,false),1);
 close(r.localWaterTurbidity(TILE_SIZE/2,0,[b],by,true),1);
});

test('real hydrology transport and official snapshot retain per-cell concentration, including PVP delta',()=>{
 const tiles=[tile(0,0,1,{waterDepth:2}),tile(1,0,0,{waterDepth:.25}),tile(2,0,0,{waterDepth:.25})],map={id:'sediment',width:3,height:1,tiles,objects:[]};
 const stage={mode:'CAMPAIGN',intelMode:'FULL_VISIBILITY',deploymentPoints:[]},environmentState=globalThis.EnvironmentEngine.create();
 let revision=1;const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},PHASE:{PLAYER:'PLAYER',CARD:'CARD'},state:()=>({map,stage,cores:[],units:[],environmentState,phase:'PLAYER',round:1,mode:'idle',renderRevision:revision}),unitAt:()=>null,coreAt:()=>null};
 const p=globalThis.BattlePresentationController.create(ctx),frame=()=>({type:'PVP_RENDER_SNAPSHOT',matchId:'sediment',seat:0,revision,snapshot:p.battleSnapshot()});
 const first=frame();assert.deepEqual(first.snapshot.map.tiles.map(t=>t.waterTurbidity),[1,0,0]);
 H.redistribute(map);revision++;const second=frame();assert.ok(tiles[1].waterTurbidity>0);assert.deepEqual(second.snapshot.map.tiles.map(t=>t.waterTurbidity),tiles.map(t=>t.waterTurbidity));
 const packet=createRenderUpdate(first,second,{maxDeltaRatio:2});assert.equal(packet.type,'PVP_RENDER_DELTA');assert.deepEqual(applyRenderUpdate(first,packet),second);
});

function wetEnvironment(){
 const w=water(); // actual barycentric intersection against the published wet footprint
 w.publishedWaterTileTriangles=new Map([['1,0',{positions:Float32Array.from([1,1,-1,3,1,-1,3,1,1,1,1,1]),indices:[0,1,2,0,2,3],range:{startIndex:0,indexCount:6}}]]);
 return Object.assign(Object.create(EnvironmentRenderer.prototype),{water:w,surfaceResolver:w.surfaceResolver,massFlowEffects:[],massFlowStats:{completed:0}});
}
test('wet-footprint query uses published water triangles, not tile centre or terrain label',()=>{
 const r=wetEnvironment();assert.equal(r.massFlowUnderWater(2,0,0),true);assert.equal(r.massFlowUnderWater(0,0,0),false);assert.equal(r.massFlowUnderWater(2,2,0),false);
});
const mesh=()=>({enabled:false,setEnabled(v){this.enabled=v;},position:{set(){}},rotation:{set(){}},scaling:{set(){}}});
function effect(kind){return{kind,age:0,duration:1,scale:1,nodes:[{x:0,z:0},{x:2,z:0}],segments:[[...Array(9)].map(()=>({start:0,end:0}))],patches:[],lines:[],pieces:[0,1,2].map(part=>({part,index:0,mesh:mesh()}))};}
test('soil sphere stops on real wet footprint, rock fragments and snow remain distinct, no lingering mesh',()=>{
 const r=wetEnvironment(),soil=effect('SOIL'),rock=effect('ROCK'),snow=effect('SNOW');r.massFlowEffects=[soil,rock,snow];
 r.updateMassFlows(.05);assert.ok(soil.pieces.every(p=>p.mesh.enabled));
 r.updateMassFlows(.50);assert.ok(soil.pieces.every(p=>!p.mesh.enabled));assert.equal(rock.pieces[0].mesh.enabled,false);assert.equal(rock.pieces[1].mesh.enabled,true);assert.equal(rock.pieces[2].mesh.enabled,false);assert.ok(snow.pieces.every(p=>p.mesh.enabled));
 r.updateMassFlows(1);assert.equal(r.massFlowEffects.length,0);assert.ok([...soil.pieces,...rock.pieces,...snow.pieces].every(p=>!p.mesh.enabled));
});

 test('sub-thousandth concentration changes enter the exact surface signature without dirtying polygons',()=>{
 const r=water(),t=tile(0,0,0),state={map:{tiles:[t]}};
 const before=r.surfaceSignatureFor([],state);r.surfaceTileInputSignatures=r.surfaceTileInputs(state);
 t.waterTurbidity=.0001;
 assert.notEqual(r.surfaceSignatureFor([],state),before);
 const after=r.surfaceTileInputs(state);assert.ok(r.changedSurfaceTileKeys(after).has('0,0'));
 assert.equal(r.changedSurfaceTileKeys(after,{geometryOnly:true}).size,0);
 });
