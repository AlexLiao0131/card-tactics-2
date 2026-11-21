import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {VfxDatabase} from '../../js/vfx-database.js';

class Vec3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
  copyFrom(other){this.x=other.x;this.y=other.y;this.z=other.z;return this}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  setAll(value){this.x=value;this.y=value;this.z=value;return this}
  add(other){return new Vec3(this.x+other.x,this.y+other.y,this.z+other.z)}
  subtract(other){return new Vec3(this.x-other.x,this.y-other.y,this.z-other.z)}
  scale(v){return new Vec3(this.x*v,this.y*v,this.z*v)}
  length(){return Math.hypot(this.x,this.y,this.z)}
}
class MockNode {
  constructor(name,scene){this.name=name;this.scene=scene;this.position=new Vec3();this.rotation=new Vec3();this.scaling=new Vec3(1,1,1);this.visibility=1;this._parent=null;this.children=[];this.enabled=true;this.disposed=false;scene.nodes.add(this)}
  set parent(value){if(this._parent){this._parent.children=this._parent.children.filter(x=>x!==this)}this._parent=value;if(value)value.children.push(this)}
  get parent(){return this._parent}
  setEnabled(enabled){this.enabled=enabled}
  lookAt(target){this.lookAtTarget=target}
  dispose(){if(this.disposed)return;for(const child of [...this.children])child.dispose();this.disposed=true;this.scene.nodes.delete(this);if(this.parent)this.parent=null}
}
class MockMaterial {
  constructor(name,scene){this.name=name;this.scene=scene;scene.materials.add(this)}
  dispose(){this.scene.materials.delete(this)}
}
class Color3 {constructor(r,g,b){this.r=r;this.g=g;this.b=b}}
const MeshBuilder=Object.fromEntries(['CreateTorus','CreateSphere','CreateBox','CreateCylinder'].map(kind=>[kind,(name,args,scene)=>{
  const node=new MockNode(name,scene);node.geometry={kind,args};return node;
}]));
globalThis.BABYLON={Vector3:Vec3,StandardMaterial:MockMaterial,TransformNode:MockNode,MeshBuilder,Color3,Engine:{ALPHA_ADD:1,ALPHA_COMBINE:2}};
const {ArcaneSigilVfx,isCassandraSpellPresentationEvent,isAlchemySpellPresentationEvent}=await import('../../js/arcane-sigil-vfx.js');
const makeScene=()=>({nodes:new Set(),materials:new Set(),onDisposeObservable:{addOnce(){}}});
const snapshot={map:{id:'alchemist-test',tiles:[{x:1,y:1,elevation:0},{x:2,y:2,elevation:0},{x:3,y:2,elevation:0},{x:4,y:2,elevation:0}]},round:1,units:[{id:'alchemist-1',x:1,y:1,alive:true,effects:[]}]};
const event=(skillId,sequence=1,rest={})=>({type:'UNIT_ANIMATION',unitId:'alchemist-1',skillId,
  x:1,y:1,targetX:3,targetY:2,sequence,...rest});
const base=['alchemy_mana_stone','alchemy_healing_potion','alchemy_power_potion','alchemy_hard_shell_potion','alchemy_explosion','alchemy_swiftness_potion','alchemy_underwater_breathing_potion'];
const terrains=['WATER_TO_LAND','FLOOD','FREEZE','MUD','SHATTER','WALL','CLIFF'];
const affinities=['NONE','NATURE','WATER','ICE','FIRE','THUNDER','HOLY','DARK','STONE'];

test('all eight alchemy skills route into the EXISTING shared arcane VFX handler',()=>{
  for(const id of [...base,'alchemy_world_transmutation']){
    assert.ok(VfxDatabase.routeSkill(id).includes('arcane'),id);
    assert.equal(VfxDatabase.roleFor('arcane',id)?.startsWith('ALCHEMY_'),true,id);
    assert.ok(isAlchemySpellPresentationEvent(event(id)));
    assert.equal(isCassandraSpellPresentationEvent(event(id)),false);
  }
  assert.ok(isCassandraSpellPresentationEvent(event('cassandra_magic_bolt')));
  assert.equal(isAlchemySpellPresentationEvent(event('cassandra_magic_bolt')),false);
});

test('all seven basic spells and nine possible visual affinities create actual Babylon meshes, progress and clean up',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  let sequence=0;
  for(const id of base)for(const affinity of affinities){
    const e=event(id,++sequence,{alchemyAffinity:affinity,alchemyQuality:affinity==='NONE'?'NORMAL':'HIGH'});
    vfx.sync(snapshot,[e]);
    const fx=vfx.active.at(-1);
    assert.equal(fx.kind, VfxDatabase.roleFor('arcane',id));
    assert.equal(fx.affinity,affinity);
    assert.ok(scene.nodes.size>0);
    assert.equal(fx.formation!=null,true);
    assert.ok(fx.rings.length===2);
    assert.equal(fx.terrain,null);
    vfx.updateFrame(fx.start+100);
    vfx.updateFrame(fx.start+510);
    vfx.updateFrame(fx.start+890);
    vfx.updateFrame(fx.start+1160);
    for(const node of scene.nodes){
      assert.ok(Number.isFinite(node.position.x),`${id} ${affinity}: ${node.name} x`);
      assert.ok(Number.isFinite(node.position.y),`${id} ${affinity}: ${node.name} y`);
      assert.ok(Number.isFinite(node.scaling.x),`${id} ${affinity}: ${node.name} scaling`);
    }
    // The official behavior bounds active effects independent of repeated casts.
    assert.ok(vfx.active.length<=4);
  }
  assert.ok(scene.materials.size>8);
  vfx.clear();
  assert.equal(scene.nodes.size,0,'completed attacks leave no Babylon meshes alive');
  vfx.dispose();
  assert.equal(scene.materials.size,0,'dispose releases the shared material palette');
});

test('seven world transmutations animate only the committed target footprint',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  let n=0;
  for(const terrain of terrains){
    const positions=terrain==='CLIFF'?[{x:2,y:2},{x:3,y:2},{x:4,y:2}]:[{x:3,y:2}];
    const e=event('alchemy_world_transmutation',++n,{alchemyTerrain:terrain,alchemyFootprint:positions});
    vfx.sync(snapshot,[e]);
    const fx=vfx.active.at(-1);
    assert.equal(fx.terrain,terrain);
    assert.equal(fx.field.length,positions.length);
    assert.ok(fx.field.every((a,i)=>a.parts.length>0&&a.root.position.x===positions[i].x*2),terrain);
    vfx.updateFrame(fx.start+1060);
    vfx.updateFrame(fx.start+1410);
    assert.ok(vfx.active.length<=4);
  }
  vfx.clear();assert.equal(scene.nodes.size,0);
  vfx.dispose();assert.equal(scene.materials.size,0);
});

test('visual events deduplicate by official sequence, reject unknown IDs and reset on rewind',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene),e=event('alchemy_explosion',101,{alchemyAffinity:'FIRE'});
  vfx.sync(snapshot,[e]);vfx.sync(snapshot,[e]);assert.equal(vfx.active.length,1);
  vfx.sync(snapshot,[event('alchemy_invalid',102)]);assert.equal(vfx.active.length,1);
  vfx.sync({...snapshot,round:0},[]);
  assert.equal(vfx.active.length,0);
  assert.equal(scene.nodes.size,0);
  vfx.dispose();
});

test('target allegiance and terrain are never inferred from fake effects',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  const e=event('alchemy_world_transmutation',10,{alchemyTerrain:'NOT_REAL'});
  vfx.sync(snapshot,[e]);
  assert.equal(vfx.active.at(-1).terrain,null);
  assert.equal(vfx.active.at(-1).field.length,0);
  vfx.dispose();assert.equal(scene.nodes.size,0);
});


test('original Cassandra four-skill Babylon pipeline remains functional',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  for(const [index,skillId] of ['cassandra_magic_bolt','cassandra_fire_burst',
    'cassandra_frost','cassandra_dissolve'].entries()){
    vfx.sync(snapshot,[event(skillId,index+200)]);
    const fx=vfx.active.at(-1);
    assert.equal(fx.alchemy,undefined);
    vfx.updateFrame(fx.start+210);
    vfx.updateFrame(fx.start+610);
    vfx.updateFrame(fx.start+960);
  }
  vfx.dispose();assert.equal(scene.nodes.size,0);assert.equal(scene.materials.size,0);
});

test('all seven basic alchemy recipes and rune-only ultimate are visually distinct',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  const expected=[
    ['alchemy_mana_stone','alchemy-mana-cut-crystal','alchemy-mana-restoration-crystal'],
    ['alchemy_healing_potion','alchemy-glass-vial','alchemy-healing-cross'],
    ['alchemy_power_potion','alchemy-glass-vial','alchemy-power-arrow'],
    ['alchemy_swiftness_potion','alchemy-glass-vial','alchemy-swiftness-sprint-arrow'],
    ['alchemy_underwater_breathing_potion','alchemy-glass-vial','alchemy-underwater-breathing-bubble'],
    ['alchemy_hard_shell_potion','alchemy-glass-vial','alchemy-shell-hex-facet'],
    ['alchemy_explosion','alchemy-glass-vial','alchemy-volumetric-explosion-core'],
    ['alchemy_world_transmutation','alchemy-world-transmutation-focus','alchemy-world-synthesis-ring']
  ];
  for(const [id,prop,impact] of expected){
    vfx.clear();vfx.sync(snapshot,[event(id,expected.findIndex(x=>x[0]===id)+500,{
      alchemyTerrain:id==='alchemy_world_transmutation'?'WALL':null})]);
    const names=[...scene.nodes].map(node=>node.name);
    assert.ok(names.some(n=>n.includes(prop)),`${id}: missing ${prop}`);
    assert.ok(names.some(n=>n.includes(impact)),`${id}: missing ${impact}`);
    if(id==='alchemy_world_transmutation')assert.ok(!names.some(n=>n==='alchemy-glass-vial'),
      'the rune-only ultimate must not create a fake consumed potion');
  }
  vfx.dispose();assert.equal(scene.nodes.size,0);
});

test('flood/ice VFX follows authoritative water surface, not submerged bed',()=>{
  const scene=makeScene(),vfx=new ArcaneSigilVfx(scene);
  const watery={...snapshot,map:{id:'water-map',tiles:[{x:1,y:1,elevation:0},
    {x:3,y:2,elevation:-3,waterDepth:4,waterSurfaceZ:1}]}};
  vfx.sync(watery,[event('alchemy_world_transmutation',44,
    {alchemyTerrain:'FREEZE',alchemyFootprint:[{x:3,y:2}]})]);
  const fx=vfx.active.at(-1);
  assert.equal(fx.field[0].root.position.y,1*.8+.05);
  assert.equal(fx.impact.position.y,1*.8+.62);
  vfx.dispose();
});

test('committed basic variants and authoritative terrain footprint feed only visual metadata',()=>{
  const code=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8');
  assert.ok(code.includes("alchemyAffinity:skill.materialCost?.affinity||'NONE'"));
  assert.ok(code.includes("alchemyQuality:skill.materialCost?.quality||'NORMAL'"));
  assert.ok(code.includes('alchemyFootprint:plan.tiles.map'));
  // Neither VFX module nor VfxDatabase may mutate resource/hydrology truth.
  const vfx=readFileSync(new URL('../../js/arcane-sigil-vfx.js',import.meta.url),'utf8');
  assert.ok(!/ResourceEngine\.(?:change|set|changeMaterial)/.test(vfx));
  assert.ok(!/HydrologyEngine\.(?:floodArea|deformTerrain|addWater)/.test(vfx));
});
