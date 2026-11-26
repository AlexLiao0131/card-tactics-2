import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../js/skill-database.js';
import {HydrologyEngine} from '../../js/hydrology-engine.js';
import '../../js/tactical-engine.js';
import '../../js/mass-flow-engine.js';
import '../../js/battle-environment-controller.js';
import {UnitAnimationEngine as Anim} from '../../js/unit-animation-engine.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {EnvironmentRenderer} from '../../js/environment-renderer.js';
import {projectMassFlowPresentation} from '../src/pvp-headless-presentation.mjs';
import {PvpBattleRenderBridge} from '../../js/pvp-battle-render-bridge.js';

const mapOf=(kind)=>({id:'mass-flow',width:4,height:1,objects:[],tiles:[4,3,1,0].map((elevation,x)=>({x,y:0,elevation,terrain:'PLAIN',material:kind==='ROCK'?'ROCK':'SOIL',waterDepth:0,soilMoisture:kind==='SOIL'?.4:0,snowDepth:kind==='SNOW'?1.5:0,snowWaterEquivalent:kind==='SNOW'?.5:0,rockMass:kind==='ROCK'?1.5:0}))});
function actualFlow(kind){
  const map=mapOf(kind),before=structuredClone(map),flow=globalThis.MassFlowEngine.trace(map,map.tiles[0],kind,1.2),events=[];
  globalThis.MassFlowEngine.apply(map,flow,{events,source:'TEST'});
  const event=globalThis.MassFlowEngine.event(flow,{type:kind==='SNOW'?'AVALANCHE':'MASS_FLOW',damage:12});
  return {map,before,event,events};
}
const noOp=()=>{};
const vec=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}});
class MockMesh{
  constructor(name){this.name=name;this.position=vec();this.rotation=vec();this.scaling=vec();this.enabled=true;this.disposed=false;}
  setEnabled(v){this.enabled=v;}
  dispose(){this.disposed=true;}
  updateVerticesData(kind,data){this[kind]=[...data];}
}
class MockData{
  static ComputeNormals(p,i,n){n.splice(0,n.length,...p.map((v,j)=>j%3===1?1:0));}
  applyToMesh(m){m.positionBuffer=[...this.positions];m.indices=[...this.indices];}
}
function fakeRenderer(){
  globalThis.BABYLON={Mesh:MockMesh,VertexData:MockData,VertexBuffer:{PositionKind:'positionBuffer',NormalKind:'normals'},Color3:class{},Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}},StandardMaterial:class{},MeshBuilder:{CreatePolyhedron:n=>new MockMesh(n),CreateSphere:n=>new MockMesh(n),CreateLines:n=>new MockMesh(n)}};
  return Object.assign(Object.create(EnvironmentRenderer.prototype),{scene:{},surfaceResolver:new VisualSurfaceResolver(),massFlowEffects:[],massFlowMaterials:new Map(),massFlowPool:[],massFlowTokens:new Set(),massFlowStats:{started:0,warnings:0,completed:0}});
}
for(const kind of ['SOIL','ROCK','SNOW'])test(`${kind}: real mass-flow path, canonical changes, common presentation and bounded transient geometry`,()=>{
  const {map,before,event,events}=actualFlow(kind);
  if(kind==='SNOW'){
    assert.equal(map.tiles[0].elevation,before.tiles[0].elevation);
    assert.ok(event.path.every(p=>Number.isFinite(p.snowDepthBefore)&&Number.isFinite(p.snowDepthAfter)));
    assert.ok(map.tiles[0].snowDepth<before.tiles[0].snowDepth);
    assert.ok(map.tiles.at(-1).snowDepth>before.tiles.at(-1).snowDepth);
  }else{
    assert.ok(map.tiles[0].elevation<before.tiles[0].elevation);
    assert.ok(map.tiles.at(-1).elevation>before.tiles.at(-1).elevation);
    assert.ok(event.path.every(p=>Number.isFinite(p.elevationBefore)&&Number.isFinite(p.elevationAfter)));
  }
  Anim.clear();
  const controller=globalThis.BattleEnvironmentController.create({state:()=>({map,units:[],environmentState:{}}),pushLog:noOp,handleDefeated:noOp,stageEvent:noOp});
  controller.resolveEnvironmentEvents([...events,event]);
  const actual=Anim.drain().filter(e=>e.type==='MASS_FLOW');
  assert.equal(actual.length,1);assert.deepEqual(actual[0].path,event.path);
  const original=structuredClone(map),r=fakeRenderer(),state={revision:9,map};
  r.syncPresentationEvents(actual,state,{map:before});
  r.syncPresentationEvents(actual,state,{map:before});
  assert.equal(r.massFlowStats.started,1);assert.equal(r.massFlowEffects.length,1);
  const effect=r.massFlowEffects[0],patch=effect.patches[0];
  assert.ok(effect.pieces.length>0);assert.ok(patch);assert.ok(effect.segments.every(s=>s.every(p=>Number.isFinite(p.start)&&Number.isFinite(p.end))));
  const initial=patch.positions[1];r.updateMassFlows(.1);
  assert.ok(effect.pieces.some(p=>p.mesh.enabled));assert.ok(patch.buffer[1]<=initial);
  r.updateMassFlows(effect.duration);assert.equal(r.massFlowEffects.length,0);
  assert.ok(patch.mesh.disposed);assert.ok(r.massFlowPool.every(p=>!p.busy&&!p.mesh.enabled));
  assert.deepEqual(map,original,'renderer must never alter authoritative tile data');
  const allocated=r.massFlowPool.length;
  r.syncPresentationEvents([{...actual[0],sequence:actual[0].sequence+1}],{...state,revision:10},{map:before});
  assert.equal(r.massFlowPool.length,allocated,'meshes reused');r.clearMassFlows();
  assert.ok(r.massFlowPool.every(p=>!p.busy&&!p.mesh.enabled));
});
test('authoritative contact creates an immediate local splash and no duplicate contact pulse',()=>{
  const {map,before,event}=actualFlow('SOIL'),r=fakeRenderer();
  r.syncPresentationEvents([{...event,type:'MASS_FLOW',sequence:2,contacts:[{x:1,y:0},{x:1,y:0}]}],{map,revision:2},{map:before});
  const effect=r.massFlowEffects[0],contact=effect.pieces.filter(p=>p.contact);assert.equal(contact.length,1);r.updateMassFlows(.05);assert.ok(contact[0].mesh.enabled);r.updateMassFlows(.4);assert.equal(contact[0].mesh.enabled,false);r.clearMassFlows();
});
test('warning draws one temporary crack and does not change terrain',()=>{
  const map=mapOf('SOIL'),r=fakeRenderer(),event={type:'MASS_FLOW_WARNING',sequence:1,material:'SOIL',path:[{x:0,y:0},{x:1,y:0}]};
  r.syncPresentationEvents([event],{map,revision:1});
  assert.equal(r.massFlowStats.warnings,1);const e=r.massFlowEffects[0];assert.equal(e.lines.length,1);assert.equal(e.pieces.length,0);
  r.updateMassFlows(e.duration);assert.ok(e.lines[0].disposed);
});
test('PVP only transmits fully visible terrain paths, with no actor or hidden identities',()=>{
  const {map,event}=actualFlow('SOIL');
  // Place an observer on each cell: visibility comes from the actual rules.
  const observers=map.tiles.map((p,i)=>({id:'viewer-'+i,team:'P',alive:true,x:p.x,y:p.y,character:{visionRange:4,passives:[]}}));
  const input={...event,unitId:'secret',targetId:'hidden',contacts:[{unitId:'visible',x:0,y:0},{unitId:'secret',x:1,y:0}],path:event.path.map(p=>({...p,unitId:'secret'}))};
  const visible=projectMassFlowPresentation(input,map,observers,'P',null,new Set(['visible']));
  assert.deepEqual(visible.contacts,[{x:0,y:0}]);
  assert.ok(visible);assert.equal(visible.path.length,event.path.length);
  assert.equal(JSON.stringify(visible).includes('secret'),false);assert.equal(JSON.stringify(visible).includes('hidden'),false);
  assert.equal(projectMassFlowPresentation(input,map,observers,'E',null),null);
  assert.equal(projectMassFlowPresentation({...input,path:[...input.path,{x:100,y:100}]},map,observers,'P',null),null);
});
test('PVP bridge accepts environmental actorless event and deduplicates revision',()=>{
  const calls=[],canvas={parentElement:{classList:{contains:()=>true}}};
  const bridge=new PvpBattleRenderBridge({canvas,seat:0,ownsRenderer:false,createRenderer:()=>({sync:(s,e)=>calls.push(e)})});
  const packet={matchId:'flow',seat:0,revision:1,snapshot:{revision:1,map:{tiles:[]},units:[],cores:[],presentation:{}},presentationEvents:[{type:'MASS_FLOW',sequence:10,path:[]},{type:'MASS_FLOW',sequence:10,path:[]},{type:'MASS_FLOW_WARNING',sequence:11,path:[]}]};
  assert.equal(bridge.accept(packet),true);assert.deepEqual(calls[0].map(e=>e.type),['MASS_FLOW','MASS_FLOW_WARNING']);
  assert.equal(bridge.accept(packet),false);assert.equal(calls.length,1);
});
test('the PVP client preserves actorless environmental events and the per-frame effect never rebuilds global terrain',()=>{
  const ui=readFileSync(new URL('../../js/pvp-tactical-ui.js',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../../js/environment-renderer.js',import.meta.url),'utf8');
  assert.match(ui,/event\.type==='MASS_FLOW'\|\|event\.type==='MASS_FLOW_WARNING'/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf('  updateMassFlows(dt){'),renderer.indexOf('  syncPresentationEvents(events,state,previousState=null){')),/buildSurface\(|buildCliffs\(/);
});
