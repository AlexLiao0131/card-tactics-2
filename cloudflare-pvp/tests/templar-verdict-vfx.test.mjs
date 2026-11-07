import test from 'node:test';
import assert from 'node:assert/strict';
import {TemplarVerdictVfx} from '../../js/templar-verdict-vfx.js';
import {PvpBattleRenderBridge} from '../../js/pvp-battle-render-bridge.js';
globalThis.FallEngine={FALL_THRESHOLD:1,FALL_DAMAGE_PER_LEVEL:1};
await import('../../js/post-engagement-engine.js');

class XYZ{
  constructor(){this.x=0;this.y=0;this.z=0}
  set(x,y,z){this.x=x;this.y=y;this.z=z}
  setAll(v){this.set(v,v,v)}
}
class FakeNode{
  constructor(name,scene){this.name=name;this.scene=scene;this.position=new XYZ();this.rotation=new XYZ();this.scaling=new XYZ();this.enabled=true;this.isPickable=true;this.visibility=1;this.disposed=false}
  setEnabled(v){this.enabled=!!v}
  dispose(recursive=false,disposeMaterials=false){this.disposed=true;this.disposedMaterials=disposeMaterials}
}
class FakeMaterial{
  constructor(name){this.name=name;this.disposed=false}
  dispose(){this.disposed=true}
}
globalThis.BABYLON={
  StandardMaterial:FakeMaterial,Color3:class{constructor(r,g,b){Object.assign(this,{r,g,b})}},
  TransformNode:FakeNode,Engine:{ALPHA_ADD:1},
  MeshBuilder:Object.fromEntries(['CreateBox','CreateCylinder','CreateSphere','CreateTorus'].map(name=>[name,(n,opts,scene)=>{
    const mesh=new FakeNode(n,scene);mesh.geometry=opts;return mesh;
  }]))
};
const snapshot={round:1,map:{id:'test',tiles:[{x:2,y:2,elevation:1}]},units:[{id:'templar',team:'P',x:0,y:2,renderZ:0}]};
const slash=(targetX=2,targetY=2)=>({type:'UNIT_ANIMATION',unitId:'templar',targetId:'enemy',skillId:'templar_verdict',x:0,y:2,targetX,targetY,state:'CAST',sequence:1});
const impact=()=>({type:'TEMPLAR_VERDICT_IMPACT',unitId:'templar',targetId:'enemy',skillId:'templar_verdict',targetX:2,targetY:2,sequence:2});

test('actual verdict strike summons a gold greatsword above the authored target and hit impact triggers holy burst',()=>{
  const fx=new TemplarVerdictVfx({onDisposeObservable:{addOnce(){}}});
  fx.sync(snapshot,[slash(),impact()]);
  assert.equal(fx.active.length,1);
  assert.equal(fx.active[0].impact,true);
  assert.equal(fx.active[0].blast.root.enabled,false);
  fx.updateFrame(fx.active[0].started+510);
  assert.equal(fx.active[0].blast.root.enabled,false);
  fx.updateFrame(fx.active[0].started+550);
  assert.equal(fx.active[0].blast.root.enabled,true);
  assert.equal(fx.active[0].blast.cross.length,4);
  assert.ok(fx.active[0].sword.root.position.y>fx.active[0].groundY);
  const mesh=fx.active[0].sword.root;
  fx.updateFrame(fx.active[0].started+1200);
  assert.equal(mesh.disposed,true);
  assert.equal(fx.active.length,0);
  assert.equal(fx.materials.white.disposed,false,'shared emissive material must survive per-cast cleanup');
  fx.dispose();assert.equal(fx.materials.white.disposed,true);
});

test('miss plays downward sword only, never golden blast or cross',()=>{
  const fx=new TemplarVerdictVfx({});
  fx.sync(snapshot,[slash()]);
  assert.equal(fx.active.length,1);
  assert.equal(fx.active[0].blast,null);
  fx.updateFrame(fx.active[0].started+700);
  assert.equal(fx.active[0].blast,null);
});

test('hidden actor or removed target coordinates cannot leak visual attack information',()=>{
  const fx=new TemplarVerdictVfx({});
  fx.sync(snapshot,[{...slash(),unitId:'hidden'},impact()]);
  assert.equal(fx.active.length,0);
  fx.sync(snapshot,[{...slash(),targetX:undefined},impact()]);
  assert.equal(fx.active.length,0);
});

test('PvP existing native renderer bridge forwards filtered impact events exactly once',()=>{
  const got=[];const fake={sync:(snapshot,events)=>got.push(events),unitHud:{presentEvents(){}}};
  const div={parentElement:{classList:{contains:n=>n==='active'}}};
  const b=new PvpBattleRenderBridge({canvas:div,seat:0,createRenderer:()=>fake});
  const shot={...snapshot,revision:1,cores:[],presentation:{}};
  assert.equal(b.accept({matchId:'m',seat:0,revision:1,snapshot:shot,presentationEvents:[slash(),impact(),impact()]}),true);
  assert.deepEqual(got[0].map(e=>e.type),['UNIT_ANIMATION','TEMPLAR_VERDICT_IMPACT']);
  assert.equal(b.accept({matchId:'m',seat:0,revision:1,snapshot:shot,presentationEvents:[impact()]}),false);
});

test('official shared verdict outcome publishes impact ONLY on actual primary hit; hit does not depend on HP loss',()=>{
  const previous={UnitAnimationEngine:globalThis.UnitAnimationEngine,BattleEngine:globalThis.BattleEngine,EffectEngine:globalThis.EffectEngine};
  const events=[],actor={id:'templar',team:'P',character:{name:'艾莉西亞'}},enemy={id:'enemy',team:'E',x:2,y:2,hp:100,alive:true,character:{name:'敵人'}};
  const skill={id:'templar_verdict',verdictCross:{radius:2,blastPower:.8},pureHoly:true,element:'HOLY',offenseStat:'ATK',skipInherentMagic:true};
  try{
    globalThis.UnitAnimationEngine={emitPresentation:(type,data)=>events.push({type,...data}),emitResolvedHit:()=>{}};
    globalThis.BattleEngine={calculate:()=>({damage:20,crit:false})};
    globalThis.EffectEngine={applyDamage:()=>({hpLoss:0})};
    const engage=hit=>({results:[{role:'INITIATOR',actor,result:{hit}}]});
    globalThis.PostEngagementEngine.resolveVerdictCross({attacker:actor,defender:enemy,skill,engagement:engage(false),units:[enemy]});
    assert.equal(events.length,0);
    const result=globalThis.PostEngagementEngine.resolveVerdictCross({attacker:actor,defender:enemy,skill,engagement:engage(true),units:[enemy]});
    assert.equal(result.length,1);
    assert.equal(events.length,1);
    assert.equal(events[0].type,'TEMPLAR_VERDICT_IMPACT');
    assert.equal(events[0].targetX,2);
  }finally{Object.assign(globalThis,previous)}
});
