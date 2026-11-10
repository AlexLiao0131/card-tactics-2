import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../js/',import.meta.url);
class Vec{
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  copyFrom(v){if(!v)throw new Error('missing vector');this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setAll(x){return this.set(x,x,x)}
  clone(){return new Vec(this.x,this.y,this.z)}
  add(v){return new Vec(this.x+v.x,this.y+v.y,this.z+v.z)}
  subtract(v){return new Vec(this.x-v.x,this.y-v.y,this.z-v.z)}
  subtractInPlace(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this}
  scale(n){return new Vec(this.x*n,this.y*n,this.z*n)}
  length(){return Math.hypot(this.x,this.y,this.z)}
  lookAt(){return this}
  static Lerp(a,b,t){return a.add(b.subtract(a).scale(t))}
  static Distance(a,b){return a.subtract(b).length()}
}
class Node{
  constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.visibility=1;this.parent=null;this.children=[];this.enabled=true;this.disposed=false;}
  setEnabled(x){this.enabled=x}
  dispose(){this.disposed=true;for(const c of this.children)c.dispose?.()}
  lookAt(){}
  getChildMeshes(){return this.children}
}
class Mat{constructor(name){this.name=name;this.disposed=false;this.alpha=1;}dispose(){this.disposed=true}}
class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}
const builder={};for(const name of ['CreateBox','CreateSphere','CreateTorus','CreateTube','CreateCylinder','CreatePlane','CreateLines'])builder[name]=(id)=>new Node(id);
globalThis.BABYLON={TransformNode:Node,MeshBuilder:builder,StandardMaterial:Mat,Color3:Color,Vector3:Vec,Engine:{ALPHA_ADD:1}};
const {VfxDatabase}=await import(new URL('vfx-database.js',root));
const {SkillDatabase}=await import(new URL('skill-database.js',root));
const {HolyRitualVfx}=await import(new URL('holy-ritual-vfx.js',root));
const {AquaticMagicVfx}=await import(new URL('aquatic-magic-vfx.js',root));
const {BladeStealthVfx}=await import(new URL('blade-stealth-vfx.js',root));
const {VfxManager,vfxRoutesForEvent}=await import(new URL('vfx-manager.js',root));
const scene=()=>({onDisposeObservable:{addOnce(){}},materials:[],meshes:[]});
const actor=(id='caster')=>({id,x:2,y:2,z:0,renderZ:0,alive:true,friendlyToViewer:true,stealthed:false,effects:[],characterId:id});
const target=(id='target')=>({...actor(id),x:4,y:2,friendlyToViewer:false});
const tile=(x,y)=>({x,y,elevation:0,terrain:'PLAIN',waterDepth:0});
const snapshot=(round=5,others=[])=>({map:{id:'arena',tiles:Array.from({length:25},(_,i)=>tile(i%5,Math.floor(i/5)))},round,revision:round,units:[actor(),target(),...others],presentation:{}});
const event=(skillId,sequence=1,extra={})=>({type:'UNIT_ANIMATION',skillId,sequence,unitId:'caster',targetId:'target',targetKind:'UNIT',x:2,y:2,targetX:4,targetY:2,...extra});
const behaviors=[['holy-ritual',HolyRitualVfx],['aquatic-magic',AquaticMagicVfx],['blade-stealth',BladeStealthVfx]];

test('exactly 21 new hero skills are routed by reusable behavior recipes',()=>{
 const ids=behaviors.flatMap(([name])=>VfxDatabase.skillIds(name));
 assert.equal(ids.length,21);assert.equal(new Set(ids).size,21);
 for(const id of ids){assert.ok(SkillDatabase.get(id),`canonical skill exists ${id}`);assert.equal(vfxRoutesForEvent(event(id))[0],behaviors.find(([module])=>VfxDatabase.skillIds(module).includes(id))[0]);}
});
test('existing Verdict, holy rain, fire burst, smoke, waves and whirlpool keep their original render owners',()=>{
 assert.deepEqual(VfxDatabase.routeSkill('templar_verdict'),['holy-blade']);
 assert.deepEqual(VfxDatabase.routeSkill('angel_holy_arrow_rain'),['holy-volley']);
 assert.equal(VfxDatabase.hasEvent('aquatic-magic','TSUNAMI_WAVE'),false);
 assert.equal(VfxDatabase.hasEvent('blade-stealth','SMOKE'),false);
 assert.ok(!VfxDatabase.routeSkill('nereia_tsunami').includes('holy-blade'));
});
for(const [name,Klass] of behaviors){
 const roles=VfxDatabase.skillIds(name);
 test(`${name}: every mapped skill creates scene objects without game-state mutations`,()=>{
  const fx=new Klass(scene());const world=snapshot();const before=JSON.stringify(world);
  for(let i=0;i<roles.length;i++){
   const s=roles[i];const opts=s==='saint_sanctuary'?{sanctuaryMode:'HEALING',targetKind:'MAP'}:s==='nereia_tsunami'||s==='nereia_whirlpool'?{targetKind:'MAP'}:{};
   fx.sync(world,[event(s,i+1,opts)]);
   assert.ok(fx.active.length,`${s} has an animation`);
   fx.updateFrame(performance.now()+140);
  }
  assert.equal(JSON.stringify(world),before,'visual component did not modify snapshot');
  fx.dispose();assert.equal(fx.active.length,0);
 });
 test(`${name}: invisible caster or hidden target does not spawn an animation`,()=>{
  const fx=new Klass(scene()),original=roles[0],world=snapshot();
  world.units.shift();fx.sync(world,[event(original,1)]);assert.equal(fx.active.length,0);
  world.units.unshift(actor());world.units=world.units.filter(u=>u.id!=='target');
  fx.sync(world,[event(original,2)]);assert.equal(fx.active.length,0);
  fx.dispose();
 });
 test(`${name}: repeated event sequence and map reset are idempotent`,()=>{
  const fx=new Klass(scene()),role=roles[0],e=event(role,42),world=snapshot();
  fx.sync(world,[e]);const count=fx.active.length;
  fx.sync(world,[e]);assert.equal(fx.active.length,count);
  const newMap={...world,map:{...world.map,id:'other-map'},round:1};
  fx.sync(newMap,[]);assert.equal(fx.active.length,0);
  fx.dispose();
 });
}
test('saint sanctuary anchors persist for exactly official duration rounds, distinguish modes',()=>{
 const fx=new HolyRitualVfx(scene());const s=snapshot(7);
 fx.sync(s,[event('saint_sanctuary',71,{sanctuaryMode:'HEALING',targetKind:'MAP',targetId:null})]);
 assert.equal(fx.fields.size,1);
 assert.equal([...fx.fields.values()][0].mode,'HEALING');
 const expires=[...fx.fields.values()][0].expiresRound;
 assert.equal(expires,7+SkillDatabase.get('saint_sanctuary').sanctuary.duration);
 fx.sync(snapshot(expires-1),[]);assert.equal(fx.fields.size,1);
 fx.sync(snapshot(expires),[]);assert.equal(fx.fields.size,0);
 fx.sync(snapshot(expires),[event('saint_sanctuary',72,{sanctuaryMode:'PUNISHMENT',targetKind:'MAP',targetId:null})]);
 assert.equal([...fx.fields.values()][0].mode,'PUNISHMENT');fx.dispose();
});
test('holy wards, blessings, grace and HP link follow actual projected effect IDs',()=>{
 const fx=new HolyRitualVfx(scene());const world=snapshot();
 world.units[0].effects=['HOLY_SHIELD','GRACE','ROYAL_BLESSING','TEMPLAR_HP_LINK','SAINT_OVERHEAL_SHIELD'].map(id=>({id,type:'BUFF'}));
 fx.sync(world,[]);assert.equal(fx.auras.size,5);
 world.units[0].effects=[];fx.sync(world,[]);assert.equal(fx.auras.size,0);
 fx.dispose();
});
test('water shield only appears for official shield state, not for standing in water',()=>{
 const fx=new AquaticMagicVfx(scene());const world=snapshot();
 world.map.tiles[12].waterDepth=3;fx.sync(world,[]);assert.equal(fx.auras.size,0);
 world.units[1].effects=[{id:'NEREIA_TSUNAMI_WATER_SHIELD',type:'SHIELD'}];fx.sync(world,[]);
 assert.equal(fx.auras.size,1);world.units[1].effects=[];fx.sync(world,[]);
 assert.equal(fx.auras.size,0);fx.dispose();
});
test('poison status and stealth only follow visible viewer projection',()=>{
 const fx=new BladeStealthVfx(scene()),world=snapshot();world.units[1].effects=[{id:'POISON',type:'DAMAGE_OVER_TIME'}];
 world.units[0].stealthed=true;fx.sync(world,[]);
 assert.equal(fx.auras.size,2);
 world.units[1].effects=[];world.units[0].stealthed=false;fx.sync(world,[]);assert.equal(fx.auras.size,0);
 fx.dispose();
});
test('manager registers all behavior modules once and keeps a single shared frame loop',()=>{
 const manager=new VfxManager(scene());
 assert.equal(manager.instances.size,VfxDatabase.modules().length);
 for(const [name] of behaviors)assert.ok(manager.get(name));
 manager.sync(snapshot(),[event('cat_backstab',1)]);
 assert.equal(manager.get('blade-stealth').active.length,1);
 manager.updateFrame();manager.dispose();assert.equal(manager.instances.size,0);
});
test('successful pickpocket and stealth emit scene events without exposing stolen item payload',()=>{
 const code=readFileSync(new URL('tactical-action-controller.js',root),'utf8');
 const stealth=code.slice(code.indexOf('if(action.type==="ENTER_STEALTH")'),code.indexOf('if(action.type==="STEAL_LOOT")'));
 assert.match(stealth,/UnitAnimationEngine\?\.emitAction\?\.\(attacker,attacker,skill/);
 const loot=code.slice(code.indexOf('if(action.type==="STEAL_LOOT")'),code.indexOf('if(action.type==="SCHEDULE_TURN_SIMULATION")'));
 assert.ok(loot.indexOf('stealLoot(attacker,target)')<loot.indexOf('emitAction?.(attacker,target,skill'));
 assert.ok(loot.indexOf('emitAction?.(attacker,target,skill')<loot.indexOf('const itemName'));
 assert.ok(!loot.includes('stolenItemId:'));
});
test('sanctuary presentation carries authoritative mode without modifying faith or area-field rules',()=>{
 const code=readFileSync(new URL('tactical-action-controller.js',root),'utf8');
 const pos=code.indexOf('if(skill?.sanctuary)');const section=code.slice(pos,pos+1330);
 assert.match(section,/sanctuaryMode:mode/);
 assert.ok(section.indexOf('sanctuaryMode:mode')<section.indexOf('ctx.activateSanctuary'));
});
test('sanctuary refuses to invent healing versus punishment if authoritative mode is absent',()=>{
 const fx=new HolyRitualVfx(scene());
 fx.sync(snapshot(),[event('saint_sanctuary',115,{targetKind:'MAP',targetId:null})]);
 assert.equal(fx.fields.size,0,'do not guess mode from drained faith');
 fx.dispose();
});
test('water shield uses exact canon ID and type, not vaguely matching status names',()=>{
 const fx=new AquaticMagicVfx(scene()),world=snapshot();
 world.units[1].effects=[{id:'FAKE_WATER_SHIELD',type:'BUFF'}];
 fx.sync(world,[]);assert.equal(fx.auras.size,0);
 world.units[1].effects=[{id:'NEREIA_TSUNAMI_WATER_SHIELD',type:'SHIELD'}];
 fx.sync(world,[]);assert.equal(fx.auras.size,1);
 fx.dispose();
});
test('deep drag uses a visible tube connection, not another displacement rule',()=>{
 const fx=new AquaticMagicVfx(scene());fx.sync(snapshot(),[event('nereia_deep_drag',104)]);
 assert.ok(fx.active[0].current?.name.includes('deep-drag-current'));
 assert.equal(fx.active[0].bubbles.length,4);
 fx.dispose();
});
test('smoke cast shows only the tossed canister, no extra smoke cloud engine',()=>{
 const fx=new BladeStealthVfx(scene());fx.sync(snapshot(),[event('cat_smoke_bomb',105,{targetKind:'SELF',targetId:'caster',targetX:2,targetY:2})]);
 assert.ok(fx.active[0].canister);
 assert.equal('particleSystem' in fx,false);
 fx.dispose();
});
test('successful pickpocket has neutral visual glint without loot payload',()=>{
 const fx=new BladeStealthVfx(scene());fx.sync(snapshot(),[event('cat_pickpocket',106)]);
 assert.ok(fx.active[0].sleight);
 assert.equal(fx.active[0].event.itemId,undefined);
 assert.equal(fx.active[0].event.gold,undefined);
 fx.dispose();
});
test('every entry in the four hero skill loadouts is covered exactly once including existing Verdict',()=>{
 const roleIds=new Set([...behaviors.flatMap(([m])=>VfxDatabase.skillIds(m)),'templar_verdict']);
 const official={saint:['saint_judgement','saint_hero_heal','saint_hero_dispel','saint_hero_blessing','saint_sanctuary'],
  templar:['templar_holy_slash','templar_charge','templar_holy_shield','templar_healing','templar_verdict'],
  nereia:['nereia_trident_thrust','nereia_trident_throw','nereia_water_bullet','nereia_whirlpool','nereia_tsunami','nereia_deep_drag'],
  cat:['cat_dual_slash','cat_backstab','cat_poison_knife','cat_smoke_bomb','cat_pickpocket','cat_hide']};
 for(const [name,skills] of Object.entries(official))for(const skill of skills){
   assert.ok(roleIds.has(skill),`${name} ${skill} is covered`);
   assert.ok(SkillDatabase.get(skill));
 }
 assert.equal(roleIds.size,22);
});
