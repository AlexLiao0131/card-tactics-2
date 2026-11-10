import test from 'node:test';
import assert from 'node:assert/strict';
import {HolyBladeVfx as TemplarVerdictVfx} from '../../js/holy-blade-vfx.js';
import {UnitRenderer} from '../../js/unit-renderer.js';
import {PvpBattleRenderBridge} from '../../js/pvp-battle-render-bridge.js';
globalThis.FallEngine={FALL_THRESHOLD:1,FALL_DAMAGE_PER_LEVEL:1};
await import('../../js/post-engagement-engine.js');

class XYZ{
  constructor(){this.x=0;this.y=0;this.z=0}
  set(x,y,z){this.x=x;this.y=y;this.z=z}
  setAll(v){this.set(v,v,v)}
}
class FakeNode{
  constructor(name,scene){this.name=name;this.scene=scene;this.position=new XYZ();this.rotation=new XYZ();this.scaling=new XYZ();this.enabled=true;this.isPickable=true;this.visibility=1;this.disposed=false;this.parent=null;}
  setEnabled(v){this.enabled=!!v}
  dispose(recursive=false,disposeMaterials=false){this.disposed=true;this.disposedMaterials=disposeMaterials}
}
class FakeMaterial{
  constructor(name){this.name=name;this.disposed=false}
  dispose(){this.disposed=true}
}
class FakeVector3{constructor(x,y,z){Object.assign(this,{x,y,z})}}
const MESH=['CreateBox','CreateCylinder','CreateSphere','CreateTorus','CreateRibbon'];
globalThis.BABYLON={
  StandardMaterial:FakeMaterial,Color3:class{constructor(r,g,b){Object.assign(this,{r,g,b})}},
  Vector3:FakeVector3,TransformNode:FakeNode,Engine:{ALPHA_ADD:1},Mesh:{DOUBLESIDE:2},
  MeshBuilder:Object.fromEntries(MESH.map(name=>[name,(n,opts,scene)=>{
    const mesh=new FakeNode(n,scene);mesh.geometry=opts;return mesh;
  }]))
};
const snapshot={round:1,map:{id:'test',tiles:[{x:2,y:2,elevation:1}]},units:[{id:'templar',team:'P',x:0,y:2,renderZ:0}]};
const slash=(targetX=2,targetY=2)=>({type:'UNIT_ANIMATION',unitId:'templar',targetId:'enemy',skillId:'templar_verdict',x:0,y:2,targetX,targetY,state:'CAST',sequence:1});
const impact=()=>({type:'TEMPLAR_VERDICT_IMPACT',unitId:'templar',targetId:'enemy',skillId:'templar_verdict',targetX:2,targetY:2,sequence:2});
const pivot=()=>{
  const weapon=new FakeNode('official-templar-wrist-weapon');weapon.metadata={figurePivot:[.307,.70,.070]};return weapon;
};
const figure=()=>({kind:'FIGURE',definition:{height:1.72,figure:{greatsword:true,twoHanded:true}},figureParts:{weapon:pivot()}});
const createVfx=(entry=figure())=>new TemplarVerdictVfx({onDisposeObservable:{addOnce(){}}},
  {units:{entries:new Map([['templar',entry]])}});

test('Verdict gathers on Alicia actual greatsword weapon node; nothing appears over enemy in windup',()=>{
  const entry=figure(),fx=createVfx(entry);
  fx.sync(snapshot,[slash()]);
  assert.equal(fx.active.length,1);
  const current=fx.active[0];
  assert.equal(current.sword.articulated,true);
  assert.equal(current.sword.root.parent,entry.figureParts.weapon,'the visible sword must remain parented to official wrist weapon');
  assert.equal(current.sword.root.position.x,0);
  assert.equal(current.sword.root.position.z,0);
  assert.equal(current.sword.motes.length,9);
  assert.equal(current.wave.root.enabled,false);
  fx.updateFrame(current.started+100);
  assert.ok(current.sword.parts[0].visibility>0,'sword absorbs light during raise');
  assert.equal(current.wave.root.enabled,false);
  assert.equal(current.blast,null);
  fx.dispose();
});

test('Actual golden slash wave moves forward FROM caster toward target, never drops from sky',()=>{
  const fx=createVfx();fx.sync(snapshot,[slash(),impact()]);
  const current=fx.active[0],start=current.started;
  fx.updateFrame(start+270);
  assert.equal(current.wave.root.enabled,true);
  const first=current.wave.root.position.x;
  assert.ok(first<current.x,'wave begins close to Alicia, not at target');
  assert.ok(current.wave.parts.every(x=>x.geometry.pathArray.length===2),'wave is a curved ribbon, not a sky beam');
  assert.equal(current.blast.root.enabled,false);
  fx.updateFrame(start+545);
  assert.equal(current.wave.root.enabled,true);
  assert.ok(current.wave.root.position.x>first,'sweeping arc must advance toward enemy');
  assert.ok(current.wave.root.position.x<=current.x+.01);
  assert.equal(current.blast.root.enabled,true);
  assert.equal(current.blast.cross.length,4,'preserve original holy cross burst');
  const sword=current.sword.root;fx.updateFrame(start+1200);
  assert.equal(sword.disposed,true);
  assert.equal(fx.active.length,0);
  fx.dispose();
});

test('Real FIGURE choreography raises its right-hand sword, then swings; combat magic type remains untouched',()=>{
  const entry=figure();const reg=globalThis.SkillDatabase;
  try{
    globalThis.SkillDatabase={get:id=>({id,attackType:'MAGIC'})};
    const type=UnitRenderer.prototype.figureAttackType.call({attackTypeFor:()=> 'MAGIC'},entry,slash());
    assert.equal(type,'VERDICT_SLASH');
    const generic=UnitRenderer.prototype.figureAttackType.call({attackTypeFor:()=> 'MAGIC'},entry,{skillId:'saint_judgement'});
    assert.equal(generic,'MAGIC','other holy magic must not turn into a slash');
    const rot=()=>({x:0,y:0,z:0}),vec=()=>({x:0,y:0,z:0});
    Object.assign(entry.figureParts,{rightArm:{rotation:rot()},leftArm:{rotation:rot()},body:{rotation:rot()},cape:{rotation:rot()},hairBack:{rotation:rot()}});
    entry.figureParts.weapon.rotation=rot();entry.root={position:vec()};
    const pretend={figureAttackType:()=>type};
    const unit={id:'templar',facing:'E'};
    assert.equal(UnitRenderer.prototype.applyFigureAttack.call(pretend,entry,unit,slash(),.20),true);
    const windup=entry.figureParts.rightArm.rotation.z;
    assert.ok(windup<0,'weapon arm raises before release');
    for(const part of Object.values(entry.figureParts))if(part.rotation){part.rotation.x=0;part.rotation.y=0;part.rotation.z=0;}
    assert.equal(UnitRenderer.prototype.applyFigureAttack.call(pretend,entry,unit,slash(),.60),true);
    assert.ok(entry.figureParts.rightArm.rotation.z<windup,'arm makes a stronger forward cut after charge');
    assert.ok(entry.root.position.x>0,'Alicia commits body weight in the facing direction');
  }finally{globalThis.SkillDatabase=reg;}
});

test('Miss still shows held sword and traveling arc but NO fabricated holy explosion',()=>{
  const fx=createVfx();fx.sync(snapshot,[slash()]);
  fx.updateFrame(fx.active[0].started+570);
  assert.equal(fx.active[0].blast,null);
  assert.equal(fx.active[0].wave.root.enabled,true);
  fx.dispose();
});

test('Hidden actors and removed target coordinates never generate VFX',()=>{
  const fx=createVfx();
  fx.sync(snapshot,[{...slash(),unitId:'hidden'},impact()]);
  assert.equal(fx.active.length,0);
  fx.sync(snapshot,[{...slash(),targetX:undefined},impact()]);
  assert.equal(fx.active.length,0);
  fx.dispose();
});

test('PvP native bridge forwards only filtered verdict events once, with no duplicate game core',()=>{
  const got=[];const fake={sync:(state,events)=>got.push(events),unitHud:{presentEvents(){}}};
  const div={parentElement:{classList:{contains:n=>n==='active'}}};
  const b=new PvpBattleRenderBridge({canvas:div,seat:0,createRenderer:()=>fake});
  const snap={...snapshot,revision:1,cores:[],presentation:{}};
  assert.equal(b.accept({matchId:'m',seat:0,revision:1,snapshot:snap,presentationEvents:[slash(),impact(),impact()]}),true);
  assert.deepEqual(got[0].map(x=>x.type),['UNIT_ANIMATION','TEMPLAR_VERDICT_IMPACT']);
  assert.equal(b.accept({matchId:'m',seat:0,revision:1,snapshot:snap,presentationEvents:[impact()]}),false);
});

test('Shared verdict emits impact only if primary attack really hits, even when shield absorbs HP damage',()=>{
  const old={UnitAnimationEngine:globalThis.UnitAnimationEngine,BattleEngine:globalThis.BattleEngine,EffectEngine:globalThis.EffectEngine};
  const events=[],actor={id:'templar',team:'P',character:{name:'艾莉西亞'}},enemy={id:'enemy',team:'E',x:2,y:2,hp:100,alive:true,character:{name:'敵人'}};
  const skill={id:'templar_verdict',verdictCross:{radius:2,blastPower:.8},pureHoly:true,element:'HOLY',offenseStat:'ATK',skipInherentMagic:true};
  try{
    globalThis.UnitAnimationEngine={emitPresentation:(type,data)=>events.push({type,...data}),emitResolvedHit:()=>{}};
    globalThis.BattleEngine={calculate:()=>({damage:20,crit:false})};
    globalThis.EffectEngine={applyDamage:()=>({hpLoss:0})};
    const engage=hit=>({results:[{role:'INITIATOR',actor,result:{hit}}]});
    globalThis.PostEngagementEngine.resolveVerdictCross({attacker:actor,defender:enemy,skill,engagement:engage(false),units:[enemy]});
    assert.equal(events.length,0);
    globalThis.PostEngagementEngine.resolveVerdictCross({attacker:actor,defender:enemy,skill,engagement:engage(true),units:[enemy]});
    assert.equal(events.length,1);
    assert.equal(events[0].type,'TEMPLAR_VERDICT_IMPACT');
  }finally{Object.assign(globalThis,old);}
});
