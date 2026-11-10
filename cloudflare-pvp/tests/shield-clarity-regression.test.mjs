import test from 'node:test';
import assert from 'node:assert/strict';

class Vec {
  constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
  set(x,y,z){Object.assign(this,{x,y,z});return this}
  setAll(v){return this.set(v,v,v)}
  copyFrom(v){return this.set(v.x,v.y,v.z)}
  add(v){return new Vec(this.x+v.x,this.y+v.y,this.z+v.z)}
  subtract(v){return new Vec(this.x-v.x,this.y-v.y,this.z-v.z)}
  scale(k){return new Vec(this.x*k,this.y*k,this.z*k)}
}
class Node {
  constructor(name,params={}){
    this.name=name;this.params=params;this.position=new Vec();this.rotation=new Vec();
    this.scaling=new Vec(1,1,1);this.visibility=1;this.children=[];this.disposed=false;
  }
  set parent(v){if(this._parent)this._parent.children=this._parent.children.filter(c=>c!==this);
    this._parent=v;if(v)v.children.push(this)}
  get parent(){return this._parent}
  dispose(){this.disposed=true;for(const c of this.children)c.dispose()}
}
class Mat {constructor(name){this.name=name;this.alpha=1}dispose(){this.disposed=true}}
class Color {constructor(r,g,b){Object.assign(this,{r,g,b})}}
const MeshBuilder={};
for(const name of ['CreateTorus','CreateSphere','CreateBox','CreateCylinder','CreateTube'])
  MeshBuilder[name]=(id,params)=>new Node(id,params);
globalThis.BABYLON={Vector3:Vec,TransformNode:Node,MeshBuilder,StandardMaterial:Mat,Color3:Color,
  Engine:{ALPHA_ADD:1,ALPHA_COMBINE:2}};
const {HolyRitualVfx}=await import('../../js/holy-ritual-vfx.js');
const {AquaticMagicVfx}=await import('../../js/aquatic-magic-vfx.js');
const scene=()=>({onDisposeObservable:{addOnce(){}}});
const effect=(id,type='SHIELD',shieldHp=32)=>({id,type,shieldHp,classification:'POSITIVE'});
const player=(effects=[],id='ally',x=2,y=2)=>({id,x,y,z:0,renderZ:0,alive:true,effects});
const world=(units=[player()],round=1)=>({map:{id:'arena',tiles:[]},units,round,presentation:{}});
const holy=effect('SAINT_OVERHEAL_SHIELD','SHIELD',45);
const water=effect('NEREIA_TSUNAMI_WATER_SHIELD','SHIELD',60);
const invulnerable=effect('HOLY_SHIELD','BUFF',0);

function assertVisualOnly(fx,w){const old=JSON.stringify(w);fx.sync(w,[]);fx.updateFrame(performance.now()+100);
  assert.equal(JSON.stringify(w),old,'VFX must not alter gameplay');}

test('Saint overheal: real SHIELD state creates full pearl-white 3D barrier',()=>{
  const fx=new HolyRitualVfx(scene());const w=world([player([holy])]);
  assertVisualOnly(fx,w);const s=fx.auras.get('OVERHEAL:ally');
  assert.ok(s?.shell);assert.match(s.shell.name,/saint-overheal-pearl-shell/);
  assert.equal(s.shell.params.diameter,1.92);assert.ok(s.shell.scaling.y>1);
  assert.equal(s.shell.parent,s.root);
  assert.ok(s.equator&&s.outer&&s.inner&&s.crown);
  assert.equal(s.motes.length,6);
  assert.equal(fx.materials.prayerShell.alphaMode,BABYLON.Engine.ALPHA_COMBINE);
  assert.ok(fx.materials.prayerEdge.alpha>.9);
  assert.equal(s.shell.isPickable,false);fx.dispose();
});
test('Saint overheal: no shield when missing, spoofed BUFF, or 0 HP',()=>{
  const fx=new HolyRitualVfx(scene());
  for(const bogus of [[],[effect('SAINT_OVERHEAL_SHIELD','BUFF',32)],
      [effect('SAINT_OVERHEAL_SHIELD','SHIELD',0)],[effect('SOME_OTHER_SHIELD','SHIELD',60)]]){
    fx.sync(world([player(bogus)]),[]);assert.equal(fx.auras.size,0);
  }fx.dispose();
});
test('Saint overheal: authoritative projected SHIELD without numeric HP remains valid',()=>{
  const fx=new HolyRitualVfx(scene());fx.sync(world([player([{id:'SAINT_OVERHEAL_SHIELD',type:'SHIELD'}])]),[]);
  assert.equal(fx.auras.size,1);fx.dispose();
});
test('Saint overheal: follows unit movement; removed with exact SHIELD status',()=>{
  const fx=new HolyRitualVfx(scene());fx.sync(world([player([holy])]),[]);
  const a=fx.auras.get('OVERHEAL:ally');fx.sync(world([player([holy],'ally',4,3)]),[]);
  assert.equal(fx.auras.get('OVERHEAL:ally'),a);
  assert.equal(a.root.position.x,8);assert.equal(a.root.position.z,6);
  fx.sync(world([player()]),[]);
  assert.equal(fx.auras.size,0);assert.ok(a.root.disposed);assert.ok(a.shell.disposed);
  fx.dispose();
});
test('Saint overheal: caster off-map and invisible units cannot paint hidden shields',()=>{
  const fx=new HolyRitualVfx(scene());fx.sync(world([]),[]);
  assert.equal(fx.auras.size,0);fx.dispose();
});
test('Saint overheal and Templar Holy Shield use independent visual assets',()=>{
  const fx=new HolyRitualVfx(scene());fx.sync(world([player([holy,invulnerable])]),[]);
  assert.equal(fx.auras.size,2);
  const over=fx.auras.get('OVERHEAL:ally'),god=fx.auras.get('SHIELD:ally');
  assert.ok(god.shell.name.includes('holy-shield'));
  assert.ok(over.shell.name.includes('saint-overheal'));
  assert.notEqual(over.shell.material,god.shell.material);
  fx.dispose();
});
test('Tsunami water shield: true SHIELD produces ocean-blue 3D bubble',()=>{
  const fx=new AquaticMagicVfx(scene());const w=world([player([water])]);
  assertVisualOnly(fx,w);const a=fx.auras.get('WATER_SHIELD:ally');
  assert.ok(a?.shell);assert.equal(a.shell.params.diameter,2.02);
  assert.ok(a.shell.scaling.y>1);assert.ok(a.cross&&a.inner&&a.outer&&a.crest);
  assert.equal(a.bubbles.length,7);assert.ok(fx.materials.waveRim.alpha>.9);
  assert.equal(fx.materials.waveShell.alphaMode,BABYLON.Engine.ALPHA_COMBINE);
  assert.notDeepEqual(fx.materials.waveShell.emissiveColor,undefined);
  assert.equal(a.shell.isPickable,false);fx.dispose();
});
test('Tsunami water shield: no false bubble for water tile, absent Buff, or empty shield',()=>{
  const fx=new AquaticMagicVfx(scene());
  for(const bogus of [[],[effect('NEREIA_TSUNAMI_WATER_SHIELD','BUFF',60)],
      [effect('NEREIA_TSUNAMI_WATER_SHIELD','SHIELD',0)],[effect('OTHER','SHIELD',60)]]){
    const w=world([player(bogus)]);w.map.tiles=[{x:2,y:2,waterDepth:9,elevation:0}];
    fx.sync(w,[]);assert.equal(fx.auras.size,0);
  }fx.dispose();
});
test('Tsunami water shield: authoritative projected SHIELD with no numeric HP still shows',()=>{
  const fx=new AquaticMagicVfx(scene());fx.sync(world([player([{id:'NEREIA_TSUNAMI_WATER_SHIELD',type:'SHIELD'}])]),[]);
  assert.equal(fx.auras.size,1);fx.dispose();
});
test('Tsunami water shield: bubble moves and animates, disappears with status',()=>{
  const fx=new AquaticMagicVfx(scene());fx.sync(world([player([water])]),[]);
  const a=fx.auras.get('WATER_SHIELD:ally');fx.sync(world([player([water],'ally',0,1)]),[]);
  assert.equal(fx.auras.get('WATER_SHIELD:ally'),a);
  assert.equal(a.root.position.x,0);assert.equal(a.root.position.z,2);
  fx.updateFrame(performance.now()+300);
  assert.ok(a.shell.visibility>.7);assert.ok(a.crest.visibility>.7);
  fx.sync(world([player()]),[]);assert.equal(fx.auras.size,0);
  assert.ok(a.root.disposed);assert.ok(a.shell.disposed);fx.dispose();
});
test('Tsunami water shield: sight mask prevents enemy unseen bubble',()=>{
  const fx=new AquaticMagicVfx(scene());fx.sync(world([]),[]);
  assert.equal(fx.auras.size,0);fx.dispose();
});
test('Saint overheal is NOT Templar invulnerability (no cosmetic conflation)',()=>{
  const fx=new HolyRitualVfx(scene());fx.sync(world([player([holy])]),[]);
  assert.equal(fx.auras.has('SHIELD:ally'),false);
  assert.equal(fx.auras.has('OVERHEAL:ally'),true);
  fx.dispose();
});
