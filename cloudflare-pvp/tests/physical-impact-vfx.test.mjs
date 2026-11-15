import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VfxDatabase} from '../../js/vfx-database.js';
import {PhysicalImpactVfx} from '../../js/physical-impact-vfx.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

function mockBabylon(){
  class Vec{
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    copyFrom(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
    subtract(v){return new Vec(this.x-v.x,this.y-v.y,this.z-v.z);}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
    static Lerp(a,b,t){return new Vec(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
  }
  class Node{
    constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling={value:1,setAll(v){this.value=v}};this.visibility=1;this.disposed=false;this.metadata={};}
    dispose(){this.disposed=true;}
  }
  class Material{constructor(name){this.name=name;}dispose(){} }
  const create=name=>(n)=>new Node(n||name);
  return {Vector3:Vec,Color3:class{constructor(r,g,b){Object.assign(this,{r,g,b});}},TransformNode:Node,
    StandardMaterial:Material,Engine:{ALPHA_ADD:1},MeshBuilder:{CreateTorus:create('torus'),CreateSphere:create('sphere'),CreateBox:create('box'),CreateTube:create('tube'),CreateCylinder:create('cylinder')}};
}

function fixture(){
  globalThis.BABYLON=mockBabylon();
  let time=8000;
  const orig=globalThis.performance;
  globalThis.performance={now:()=>time};
  const callbacks=[];
  const scene={activeCamera:{targetScreenOffset:{x:1,y:2}},
    onDisposeObservable:{addOnce:()=>{}},
    onAfterRenderObservable:{addOnce(fn){callbacks.push(fn)}}};
  const units={entries:new Map([['magda',{kind:'FIGURE'}]]),activeAnimations:new Map(),animationQueues:new Map()};
  const effect=new PhysicalImpactVfx(scene,{units});
  const snapshot={map:{id:'test-battle',tiles:[{x:2,y:2,elevation:1},{x:3,y:2,elevation:1}]},round:4,
    units:[{id:'magda',characterId:'magda',alive:true,x:2,y:2,z:1}]};
  let serial=200;
  const action=skillId=>({type:'UNIT_ANIMATION',sequence:++serial,skillId,unitId:'magda',
    state:skillId==='magda_leap_quake'?'CAST':'ATTACK',x:2,y:2,targetX:3,targetY:2,
    targetKind:skillId==='magda_leap_quake'?'MAP':'UNIT'});
  return {effect,scene,units,snapshot,action,callbacks,
    advance(t){time=t;effect.updateFrame(time);},
    restore(){effect.dispose();globalThis.performance=orig;}};
}

test('all four official skills route through one reusable physical impact module',()=>{
  const expected={magda_rage_slash:'RAGE_SLASH',magda_leap_quake:'QUAKE',
    magda_breaking_cleave:'CLEAVE',magda_execution:'EXECUTION'};
  for(const [skill,role] of Object.entries(expected)){
    assert.equal(VfxDatabase.roleFor('physical-impact',skill),role);
    assert.deepEqual(VfxDatabase.routeSkill(skill),['physical-impact']);
  }
  const manager=fs.readFileSync(path.join(root,'js/vfx-manager.js'),'utf8');
  assert.match(manager,/import\s*\{PhysicalImpactVfx\}\s*from\s*['"]\.\/physical-impact-vfx\.js['"]/);
  assert.match(manager,/'physical-impact':\(scene,ctx\)=>new PhysicalImpactVfx\(scene,\{units:ctx\.units\}\)/);
});

test('quake cannot spawn in midair: it awaits the real CAST after LEAP',()=>{
  const f=fixture();
  try{
    const event=f.action('magda_leap_quake');
    f.units.activeAnimations.set('magda',{event:{type:'UNIT_ANIMATION',sequence:event.sequence-1,kind:'LEAP',state:'WALK'}});
    f.units.animationQueues.set('magda',[event]);
    f.effect.sync(f.snapshot,[event]);
    f.advance(8100);
    assert.equal(f.effect.active.length,0,'no premature earthquake before landing');
    assert.equal(f.effect.pending.size,1);
    f.units.activeAnimations.set('magda',{event});f.units.animationQueues.delete('magda');
    f.advance(8200);
    assert.equal(f.effect.pending.size,0);
    assert.equal(f.effect.active.length,1);
    assert.equal(f.effect.active[0].role,'QUAKE');
    assert.equal(f.effect.active[0].cracks.length,9);
    assert.equal(f.effect.active[0].rocks.length,8);
    assert.equal(f.effect.active[0].dust.length,6);
    assert.equal(f.effect.active[0].root.position.y,.8+.055,'terrain elevation follows official map');
    f.advance(8250);
    assert(f.callbacks.length>0,'quaking camera uses the existing frame callback');
    for(const cb of f.callbacks.splice(0))cb();
    assert.equal(f.scene.activeCamera.targetScreenOffset.x,1,'camera pan restored after render');
    assert.equal(f.scene.activeCamera.targetScreenOffset.y,2,'camera pan restored after render');
    f.advance(9500);
    assert.equal(f.effect.active.length,0,'all short-lived VFX disposed after lifetime');
  }finally{f.restore()}
});

test('rage, cleave and execution create different render-only blade behaviors',()=>{
  const f=fixture();
  try{
    for(const id of ['magda_rage_slash','magda_breaking_cleave','magda_execution']){
      const e=f.action(id);f.units.activeAnimations.set('magda',{event:e});
      f.effect.sync(f.snapshot,[e]);f.advance(8050);
      assert(f.effect.active.some(fx=>fx.event.skillId===id));
    }
    const roles=f.effect.active.map(fx=>fx.role);
    assert.deepEqual(roles,['RAGE_SLASH','CLEAVE','EXECUTION']);
    const [rage,cleave,execution]=f.effect.active;
    assert(rage.charge,'rage slash glow');
    assert(cleave.impact,'heavy cleave impact');
    assert(execution.bursts.length>cleave.bursts.length,'execution larger but not another damage roll');
  }finally{f.restore()}
});

test('the same presented event is idempotent and map changes clear stale effects',()=>{
  const f=fixture();
  try{
    const e=f.action('magda_leap_quake');
    f.units.activeAnimations.set('magda',{event:e});
    f.effect.sync(f.snapshot,[e]);f.advance(8000);
    f.effect.sync(f.snapshot,[e]);f.advance(8001);
    assert.equal(f.effect.active.length,1);
    f.effect.sync({...f.snapshot,map:{...f.snapshot.map,id:'another-map'}},[]);
    assert.equal(f.effect.active.length,0);
    assert.equal(f.effect.pending.size,0);
  }finally{f.restore()}
});

test('camera sync replacement is never undone as if it were the old quake jitter',()=>{
  const f=fixture();
  try{
    const e=f.action('magda_leap_quake');
    f.units.activeAnimations.set('magda',{event:e});f.effect.sync(f.snapshot,[e]);
    f.advance(8000);f.advance(8070);
    assert(f.callbacks.length>0);
    f.scene.activeCamera.targetScreenOffset.x=42;
    f.scene.activeCamera.targetScreenOffset.y=31;
    for(const cb of f.callbacks.splice(0))cb();
    assert.equal(f.scene.activeCamera.targetScreenOffset.x,42);
    assert.equal(f.scene.activeCamera.targetScreenOffset.y,31);
  }finally{f.restore()}
});
