import test from 'node:test';
import assert from 'node:assert/strict';
import {UnitRenderer} from '../../js/unit-renderer.js';
import {VisualDatabase} from '../../js/visual-database.js';

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copyFrom(q){return this.set(q.x,q.y,q.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  setAll(s){return this.set(s,s,s);}
  scale(s){return new Vector3(this.x*s,this.y*s,this.z*s);}
  static Lerp(a,b,t){return new Vector3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
}
class Color3 extends Vector3 {static FromHexString(x){return new Color3(1,1,1);}static Black(){return new Color3();}}
let world;
class Mesh {
  constructor(name,scene=world){this.name=name;this.position=new Vector3();this.rotation=new Vector3();this.scaling=new Vector3(1,1,1);this.metadata={};this.visibility=1;scene.meshes.push(this);}
  dispose(){this.disposed=true;}
  setEnabled(){}
}
class TransformNode extends Mesh {}
const build=(name,options,scene)=>new Mesh(name,scene);
globalThis.BABYLON={Vector3,Color3,TransformNode,Mesh,MeshBuilder:{CreateSphere:build,CreateLines:build}};
const make=(form='CHEETAH')=>{
  world={meshes:[]};
  const renderer=Object.create(UnitRenderer.prototype);
  renderer.scene=world;renderer.figureMaterial=()=>({});
  renderer.entries=new Map();renderer.activeAnimations=new Map();renderer.animationQueues=new Map();
  renderer.formMorphs=new Map();renderer.animationDebug=false;
  renderer.applyFacing=()=>{};renderer.setBillboardAsset=()=>{};
  renderer.applyColinShieldPose=()=>{};renderer.updateAnimationBadge=()=>{};
  renderer.syncShieldPassengers=()=>{};renderer.updateFormMorphs=()=>{};
  const definition=VisualDatabase.characterBattle(form==='CHEETAH'?'avreshi_cheetah':'avreshi_seal');
  const unit={id:'druid',visualId:form==='CHEETAH'?'avreshi_cheetah':'avreshi_seal',facing:'E',x:2,y:2,z:0,renderZ:0};
  const entry=renderer.createQuadruped(unit,definition);
  entry.definition=definition;entry.lastUnit=unit;entry.basePosition=new Vector3(4,0,4);entry.baseMarkerPosition=new Vector3(4,0,4);entry.baseScale=1;
  entry.facingMarker={root:{position:new Vector3(4,0,4),rotation:new Vector3()}};
  entry.poseResetParts=Object.values(entry.quadParts).map(node=>({node,base:node.metadata.quadBase}));
  renderer.entries.set(unit.id,entry);
  return {renderer,entry,unit};
};
const pose=(entry)=>Object.fromEntries(Object.entries(entry.quadParts).map(([id,p])=>[id,{x:p.rotation.x,y:p.rotation.y,z:p.rotation.z,footY:p.position.y}]));
const EPS=1e-4;
const different=(a,b)=>Math.abs(a-b)>EPS;

test('獵豹真正建立前後四腳的獨立膝掌關節與下顎',()=>{
  const {entry}=make();
  for(const z of ['front','rear'])for(const side of ['l','r']){
    const upper=entry.quadParts[`${z}-${side}`],paw=entry.quadParts[`${z}-${side}-paw`];
    assert(upper&&paw,'四條腿必須有上肢＋下掌');
    assert.equal(paw.parent,upper,'腳掌必須由腿關節帶動');
  }
  assert.equal(entry.quadParts.jaw.parent,entry.quadParts.head);
});

test('正式 WALK 事件在 1 個地格期間四隻腿都會動，不是只有模型中心位移',()=>{
  const {renderer,entry,unit}=make();
  const event={type:'UNIT_ANIMATION',state:'WALK',unitId:unit.id,facing:'E',kind:'UNIT',
    path:[{x:2,y:2,z:0},{x:3,y:2,z:0}],duration:205};
  renderer.animationQueues.set(unit.id,[event]);
  renderer.updateFrame(1000);
  const states=[];
  for(const frame of [1033,1066,1100,1133,1166]){
    renderer.updateFrame(frame);states.push(pose(entry));
  }
  for(const where of ['front-l','front-r','rear-l','rear-r']){
    const angles=states.map(x=>x[where].x);
    assert(Math.max(...angles)-Math.min(...angles)>.50,`${where} 腿部必須有真正踏步角度`);
    const footAngles=states.map(x=>x[`${where}-paw`].x);
    assert(Math.max(...footAngles)-Math.min(...footAngles)>.30,`${where} 腳掌必須彎曲`);
  }
  assert(states.some(x=>different(x['front-l'].x,x['front-r'].x)),'左右腿必須交錯而不是同步掃動');
  assert.notEqual(entry.root.position.x,4,'正式路徑動畫必須同步移動模型');
});

test('撲咬：躍起伸前肢、收後肢、張口，身體實際前衝',()=>{
  const {renderer,entry,unit}=make();
  renderer.resetPose(entry,unit);
  renderer.applyProcedural(entry,unit,'ATTACK',.5,0,{state:'ATTACK',skillId:'avreshi_pounce',facing:'E'},definitionOf(entry));
  assert(entry.root.position.y>.20);
  assert(entry.root.position.x>4.3);
  assert(entry.quadParts['front-l'].rotation.x<-.75);
  assert(entry.quadParts['rear-r'].rotation.x>.55);
  assert(entry.quadParts.jaw.rotation.x>.2);
});
const definitionOf=(entry)=>entry.definition.animations.ATTACK;

test('撕咬：嘴巴張合且咬中時向前，與爪擊姿態不同',()=>{
  const {renderer,entry,unit}=make();
  renderer.resetPose(entry,unit);
  renderer.applyProcedural(entry,unit,'ATTACK',.30,0,{skillId:'avreshi_bite',facing:'E'},definitionOf(entry));
  const jaw=entry.quadParts.jaw.rotation.x;
  assert(jaw>.4,'咬擊必須有明顯張嘴');
  renderer.resetPose(entry,unit);
  renderer.applyProcedural(entry,unit,'ATTACK',.40,0,{skillId:'avreshi_claw',facing:'E'},definitionOf(entry));
  assert.equal(entry.quadParts.jaw.rotation.x,0,'爪擊不能播放咬擊下顎動作');
  assert(entry.quadParts['front-l'].rotation.x<-.8,'爪擊必須真正揮動前爪');
});

test('撕碎：多段交替揮爪，不是反覆播放同一個頭部點頭',()=>{
  const {renderer,entry,unit}=make();
  const states=[];
  for(const t of [.22,.39,.56,.74]){
    renderer.resetPose(entry,unit);
    renderer.applyProcedural(entry,unit,'ATTACK',t,0,{skillId:'avreshi_shred',facing:'E'},definitionOf(entry));
    states.push([entry.quadParts['front-l'].rotation.x,entry.quadParts['front-r'].rotation.x]);
  }
  assert(states.some(([l,r])=>l<-.4&&r>-.1));
  assert(states.some(([l,r])=>r<-.4&&l>-.1));
});

test('姿勢每幀重置，不能永久彎腿或穿模',()=>{
  const {renderer,entry,unit}=make();
  renderer.resetPose(entry,unit);
  renderer.applyQuadrupedGait(entry,.19);
  assert(Math.abs(entry.quadParts['front-l'].rotation.x)>.1);
  renderer.resetPose(entry,unit);
  for(const [key,p] of Object.entries(entry.quadParts)){
    const base=p.metadata.quadBase;
    assert.equal(p.rotation.x,base.rotation.x,`${key} 必須回到基準姿勢`);
    assert.equal(p.position.y,base.position.y,`${key} 地面落點不能累積偏移`);
  }
});

test('海豹使用擺尾與前鰭滑行，不會生成獵豹腳掌或揮爪',()=>{
  const {renderer,entry,unit}=make('SEAL');
  assert(!entry.quadParts['front-l-paw']);
  renderer.resetPose(entry,unit);
  renderer.applyQuadrupedGait(entry,.27,{moving:true});
  assert(Math.abs(entry.quadParts['front-l'].rotation.z)>.10);
  assert(Math.abs(entry.quadParts.tail.rotation.y)>.10);
});

test('獵豹 ATTACK 的正式佇列進入不同動作，動畫時間取自正式 VISUALS',()=>{
  const {renderer,entry,unit}=make();
  const visual=VisualDatabase.characterBattle(unit.visualId);
  assert(visual.animations.ATTACK.duration>=600);
  renderer.animationQueues.set(unit.id,[{type:'UNIT_ANIMATION',state:'ATTACK',skillId:'avreshi_claw',unitId:unit.id,facing:'E',duration:visual.animations.ATTACK.duration}]);
  renderer.updateFrame(2000);
  renderer.updateFrame(2350);
  assert(entry.quadParts['front-l'].rotation.x<-.4);
  renderer.updateFrame(2800);
  assert.equal(renderer.activeAnimations.size,0,'動畫結束後不應卡住下一次行動');
});
