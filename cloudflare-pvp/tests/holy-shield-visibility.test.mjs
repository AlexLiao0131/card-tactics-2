import test from 'node:test';
import assert from 'node:assert/strict';

class Vec {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setAll(n){return this.set(n,n,n)}
  copyFrom(v){return this.set(v.x,v.y,v.z)}
  clone(){return new Vec(this.x,this.y,this.z)}
  add(v){return new Vec(this.x+v.x,this.y+v.y,this.z+v.z)}
  subtract(v){return new Vec(this.x-v.x,this.y-v.y,this.z-v.z)}
  scale(n){return new Vec(this.x*n,this.y*n,this.z*n)}
}
class Node {
  constructor(name,params={}){
    this.name=name;this.params=params;this.position=new Vec();this.rotation=new Vec();
    this.scaling=new Vec(1,1,1);this.visibility=1;this.children=[];this.disposed=false;
  }
  set parent(value){
    if(this._parent)this._parent.children=this._parent.children.filter(c=>c!==this);
    this._parent=value;
    if(value)value.children.push(this);
  }
  get parent(){return this._parent}
  dispose(){this.disposed=true;for(const child of [...this.children])child.dispose()}
}
class Material {
  constructor(name){this.name=name;this.alpha=1;this.disposed=false;}
  dispose(){this.disposed=true}
}
class Color {constructor(r,g,b){this.r=r;this.g=g;this.b=b}}
const types={};
for(const kind of ['CreateTorus','CreateSphere','CreateBox','CreateTube','CreateCylinder'])
  types[kind]=(name,params)=>new Node(name,params);
globalThis.BABYLON={
  TransformNode:Node,MeshBuilder:types,StandardMaterial:Material,Color3:Color,Vector3:Vec,
  Engine:{ALPHA_ADD:1,ALPHA_COMBINE:2}
};
const {HolyRitualVfx}=await import('../../js/holy-ritual-vfx.js');
const {VfxDatabase}=await import('../../js/vfx-database.js');
const makeScene=()=>({onDisposeObservable:{addOnce(){}}});
const unit=(effects=[],x=2,y=2)=>({id:'templar',x,y,renderZ:0,alive:true,effects,characterId:'church_templar_hero'});
const world=(effects=[],x=2,y=2)=>({map:{id:'arena',tiles:[]},round:3,units:[unit(effects,x,y)],presentation:{}});
const buff={id:'HOLY_SHIELD',type:'BUFF',classification:'POSITIVE',remaining:2};
const cast={type:'UNIT_ANIMATION',sequence:27,skillId:'templar_holy_shield',unitId:'templar',targetId:'templar',targetKind:'SELF',x:2,y:2,targetX:2,targetY:2};

function shieldStatus(fx){return fx.auras.get('SHIELD:templar')}

test('canonical HOLY_SHIELD is the only status which creates the protective bubble',()=>{
  const fx=new HolyRitualVfx(makeScene());
  fx.sync(world([{id:'FRONTLINE_STANCE',type:'BUFF'}]),[]);
  assert.equal(shieldStatus(fx),undefined);
  fx.sync(world([buff]),[]);
  assert.ok(shieldStatus(fx));
  fx.dispose();
});

test('3D shield wraps the whole body: translucent volume, three meridians and crown',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync(world([buff]),[]);
  const s=shieldStatus(fx);
  assert.ok(s.shell.name.includes('translucent-shell'));
  assert.equal(s.shell.params.diameter,2.02);
  assert.equal(s.shell.params.segments,20);
  assert.ok(s.shell.scaling.y>1,'shield covers feet to head, not a flat ring');
  assert.equal(s.outer.params.diameter,2.04);
  assert.equal(s.inner.params.diameter,2.04);
  assert.equal(s.equator.params.diameter,2.06);
  assert.equal(s.crown.params.diameter,1.14);
  assert.equal(s.motes.length,8);
  assert.equal(s.shell.parent,s.root);
  assert.equal(s.equator.parent,s.root);
  assert.ok(s.outer.rotation.x!==0&&s.inner.rotation.z!==0,'two vertical meridians');
  assert.equal(s.equator.rotation.x,0,'equatorial horizontal band');
  fx.dispose();
});

test('shield uses non-additive translucent fill plus emissive high-contrast edges, no light or colliders',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync(world([buff]),[]);
  const s=shieldStatus(fx);
  assert.equal(fx.materials.barrier.alphaMode,BABYLON.Engine.ALPHA_COMBINE);
  assert.ok(fx.materials.barrier.alpha>0&&fx.materials.barrier.alpha<.4);
  assert.ok(fx.materials.barrierEdge.alpha>.9);
  assert.equal(s.shell.isPickable,false);
  assert.equal(s.shell.metadata.castShadow,false);
  assert.equal(s.shell.receiveShadows,false);
  assert.equal('light' in s,false);
  fx.dispose();
});

test('aura tracks unit movement and remains stable through multiple snapshot syncs',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync(world([buff]),[]);
  const before=shieldStatus(fx);
  fx.sync(world([buff],3,4),[]);
  assert.equal(shieldStatus(fx),before,'no duplicate meshes on every frame');
  assert.equal(before.root.position.x,6);
  assert.equal(before.root.position.z,8);
  assert.ok(before.root.position.y>1);
  fx.updateFrame(performance.now()+250);
  assert.ok(before.shell.visibility>.7);
  assert.ok(before.outer.visibility>.7);
  fx.dispose();
});

test('aura follows authoritative dispel / expiration, not an independent timer',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync(world([buff]),[]);
  const s=shieldStatus(fx);fx.sync(world(),[]);
  assert.equal(fx.auras.size,0);
  assert.equal(s.root.disposed,true);
  assert.equal(s.shell.disposed,true);
  fx.dispose();
});

test('hidden enemy is never granted a visible shield mesh',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync({map:{id:'arena',tiles:[]},round:3,units:[],presentation:{}},[cast]);
  assert.equal(fx.auras.size,0);
  assert.equal(fx.active.length,0);
  fx.dispose();
});

test('a cast-only visual expires, but buff sphere persists while actual HOLY_SHIELD exists',()=>{
  const fx=new HolyRitualVfx(makeScene());fx.sync(world([buff]),[cast]);
  assert.equal(fx.active.length,1);
  assert.ok(shieldStatus(fx));
  fx.updateFrame(performance.now()+1500);
  assert.equal(fx.active.length,0);
  assert.ok(shieldStatus(fx));
  fx.dispose();
});

test('visual database still maps Holy Shield to the existing shared holy-ritual behavior',()=>{
  assert.equal(VfxDatabase.roleFor('holy-ritual','templar_holy_shield'),'SHIELD');
});
