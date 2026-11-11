import test from 'node:test';
import assert from 'node:assert/strict';
class Vector3{
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
  copyFrom(v){this.x=v.x;this.y=v.y;this.z=v.z;return this}
  clone(){return new Vector3(this.x,this.y,this.z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  setAll(n){return this.set(n,n,n)}
  add(v){return new Vector3(this.x+v.x,this.y+v.y,this.z+v.z)}
  subtract(v){return new Vector3(this.x-v.x,this.y-v.y,this.z-v.z)}
  scale(s){return new Vector3(this.x*s,this.y*s,this.z*s)}
  length(){return Math.hypot(this.x,this.y,this.z)}
}
class Quaternion{
  constructor(n=1){this.n=n}
  clone(){return new Quaternion(this.n)}
  copyFrom(q){this.n=q.n;return this}
}
class Node{
  constructor(name){this.name=name;this.parent=null;this.position=new Vector3();this.rotation=new Vector3();this.scaling=new Vector3(1,1,1);this.absoluteRotationQuaternion=new Quaternion();this.rotationQuaternion=null;this.enabled=true;this.disposed=false;this.visibility=1;}
  setEnabled(v){this.enabled=v}
  isDisposed(){return this.disposed}
  dispose(){this.disposed=true}
  computeWorldMatrix(){return this}
  getAbsolutePosition(){return this.parent?this.parent.getAbsolutePosition().add(this.position):this.position.clone()}
}
class Material{constructor(){this.diffuseColor=null;this.emissiveColor=null;this.alpha=1}dispose(){}}
class Color{constructor(...c){this.c=c}}
const builder={};for(const name of ['CreateBox','CreateSphere','CreateTorus','CreateTube'])builder[name]=id=>new Node(id);
globalThis.BABYLON={TransformNode:Node,MeshBuilder:builder,StandardMaterial:Material,Color3:Color,Vector3,Engine:{ALPHA_ADD:1}};
const {ShadowElementalVfx}=await import('../../js/shadow-elemental-vfx.js');
const scene=()=>({onDisposeObservable:{addOnce() {}}});
function world({unitId='hero',slot='black_sword',element='FIRE',x=9,y=5}={}){
  return {map:{id:'map-one',tiles:[]},round:5,units:[{id:unitId,x,y,renderZ:0,effects:[{type:'WEAPON_ENCHANT',id:`WEAPON_ENCHANT:${slot}`,name:element==='FIRE'?'火元素附魔':'雷元素附魔'}]}]};
}
function figureEntry({weaponX=2,weaponZ=4,bowX=2,bowZ=4}={}){
  const root=new Node('unit-root');root.position.set(weaponX,0,weaponZ);
  const weapon=new Node('weapon-pivot');weapon.parent=root;weapon.position.set(.34,.8,.08);
  const bow=new Node('bow-pivot');bow.parent=root;bow.position.set(-.32,.91,.14);
  return {kind:'FIGURE',root,figureParts:{weapon,bow}};
}
function aura(fx){return [...fx.auras.values()][0]}
test('fire-enchanted sword follows interpolated weapon position instead of committed destination',()=>{
  const entry=figureEntry(),units={entries:new Map([['hero',entry]])},fx=new ShadowElementalVfx(scene(),{units}),snap=world();
  const initial=JSON.stringify(snap);fx.sync(snap,[]);
  // Gameplay has already moved to (9,5); 3D presentation is still (1,2) tiles.
  fx.updateFrame(100);
  const active=aura(fx);assert.equal(active.root.position.x,2+.34);assert.equal(active.root.position.z,4+.08);
  assert.notEqual(active.root.position.x,snap.units[0].x*2);
  // UnitRenderer applies a new WALK pose before VfxManager.updateFrame.
  entry.root.position.set(4,0,6);fx.updateFrame(120);
  assert.equal(active.root.position.x,4+.34);assert.equal(active.root.position.z,6+.08);
  entry.root.position.set(18,0,10);fx.updateFrame(140);
  assert.equal(active.root.position.x,18+.34);assert.equal(active.root.position.z,10+.08);
  assert.equal(JSON.stringify(snap),initial);fx.dispose();
});
test('thunder bow uses real bow pivot, including arm pose and rotation',()=>{
  const entry=figureEntry(),fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',entry]])}});
  fx.sync(world({slot:'kahn_hunter_bow',element:'THUNDER'}),[]);fx.updateFrame(500);
  const active=aura(fx);assert.equal(active.weaponSlot,'kahn_hunter_bow');assert.equal(active.isBow,true);
  assert.equal(active.root.position.x,2-.32);assert.equal(active.root.position.y,.91);
  entry.figureParts.bow.position.y=1.30;entry.figureParts.bow.absoluteRotationQuaternion=new Quaternion(4);
  fx.updateFrame(520);assert.equal(active.root.position.y,1.30);assert.equal(active.root.rotationQuaternion.n,4);
  fx.dispose();
});
test('billboard fallback follows animated figure root rather than final snapshot tile',()=>{
  const root=new Node('billboard-root');root.position.set(6,0,2);
  const fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',{kind:'BILLBOARD',root}]])}});
  fx.sync(world(),[]);fx.updateFrame(100);assert.equal(aura(fx).root.position.x,6);
  root.position.set(7,0,4);fx.updateFrame(115);assert.equal(aura(fx).root.position.x,7);
  assert.equal(aura(fx).root.position.y,.93);fx.dispose();
});
test('no visible rendered unit cannot display enchant at destination',()=>{
  const entries=new Map(),fx=new ShadowElementalVfx(scene(),{units:{entries}});
  fx.sync(world(),[]);fx.updateFrame(100);assert.equal(aura(fx).root.enabled,false);
  entries.set('hero',figureEntry());fx.updateFrame(115);assert.equal(aura(fx).root.enabled,true);
  fx.dispose();
});
test('dispel removes live aura and prevents ghost after movement',()=>{
  const entry=figureEntry(),fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',entry]])}}),snap=world();
  fx.sync(snap,[]);fx.updateFrame(100);const active=aura(fx);
  snap.units[0].effects=[];fx.sync(snap,[]);assert.equal(fx.auras.size,0);assert.equal(active.root.disposed,true);
  fx.updateFrame(120);assert.equal(fx.auras.size,0);fx.dispose();
});
test('existing authoritative event routing does not duplicate enchant skill effect',()=>{
  const fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',figureEntry()]])}}),snap=world();
  const event={type:'UNIT_ANIMATION',unitId:'hero',skillId:'elemental_enchant',sequence:42,
    x:1,y:2,targetX:9,targetY:5,enchantmentElement:'FIRE',targetKind:'UNIT',targetId:'hero'};
  fx.sync(snap,[event]);assert.equal(fx.active.length,1);
  fx.sync(snap,[event]);assert.equal(fx.active.length,1);
  fx.updateFrame(performance.now()+100);assert.equal(fx.auras.size,1);fx.dispose();
});
test('sword and bow enchantments on one actor bind independently to their corresponding hands',()=>{
  const entry=figureEntry(),fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',entry]])}});
  const snap=world();snap.units[0].effects.push({type:'WEAPON_ENCHANT',id:'WEAPON_ENCHANT:kahn_hunter_bow',name:'雷元素附魔'});
  fx.sync(snap,[]);fx.updateFrame(300);
  assert.equal(fx.auras.size,2);
  const sword=[...fx.auras.values()].find(a=>!a.isBow),bow=[...fx.auras.values()].find(a=>a.isBow);
  assert.equal(sword.root.position.x,2+.34);assert.equal(bow.root.position.x,2-.32);
  entry.figureParts.bow.position.x=-.6;fx.updateFrame(330);
  assert.equal(sword.root.position.x,2+.34);assert.equal(bow.root.position.x,2-.6);fx.dispose();
});
test('a fresh game-state sync during an in-progress walk cannot snap the enchant to destination',()=>{
  const entry=figureEntry(),fx=new ShadowElementalVfx(scene(),{units:{entries:new Map([['hero',entry]])}}),snap=world();
  fx.sync(snap,[]);fx.updateFrame(90);
  entry.root.position.set(6,0,8);
  // Status.sync initially reads the final tile, but the same frame must end
  // with the live UnitRenderer pose after its own animation update.
  fx.sync(snap,[]);fx.updateFrame(110);
  assert.equal(aura(fx).root.position.x,6+.34);
  assert.equal(aura(fx).root.position.z,8+.08);fx.dispose();
});
