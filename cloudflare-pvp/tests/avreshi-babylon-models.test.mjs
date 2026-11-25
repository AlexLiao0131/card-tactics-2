import test from 'node:test';
import assert from 'node:assert/strict';
import {UnitRenderer} from '../../js/unit-renderer.js';
import {VisualDatabase} from '../../js/visual-database.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import '../../js/terrain-database.js';
import '../../js/skill-database.js';
import '../../js/character-database.js';
import '../../js/loadout-database.js';
import '../../js/equipment-database.js';
import '../../js/hydrology-engine.js';
import '../../js/vertical-mobility-engine.js';
import '../../js/effect-engine.js';
import '../../js/tactical-engine.js';

// Deterministic Babylon API stand-in: instantiate every real primitive
// generator, pivot and attach point. A VISUALS schema-only check cannot pass.
class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copyFrom(v){return this.set(v.x,v.y,v.z);}
  setAll(v){return this.set(v,v,v);}
  scale(v){return new Vector3(this.x*v,this.y*v,this.z*v);}
  static Lerp(a,b,t){return new Vector3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
}
class Color3 extends Vector3 {
  static FromHexString(hex){const s=hex.slice(1);return new Color3(parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255);}
  static Black(){return new Color3();}
}
let scene;
class Mesh {
  constructor(name,world=scene){this.name=name;this.parent=null;this.position=new Vector3();this.rotation=new Vector3();this.scaling=new Vector3(1,1,1);this.metadata={};this.visibility=1;this.world=world;world.meshes.push(this);}
  dispose(){this.disposed=true;}
  setEnabled(e){this.enabled=e;}
  getClassName(){return 'Mesh';}
}
class TransformNode extends Mesh {constructor(name,world=scene){super(name,world);world.transformNodes.push(this);}}
class StandardMaterial {
  constructor(name){this.name=name;this.diffuseColor=new Color3();this.emissiveColor=new Color3();this.specularColor=new Color3();}
  dispose(){}
}
const create=(name,params,world)=>new Mesh(name,world);
globalThis.BABYLON={Vector3,Color3,Mesh,TransformNode,StandardMaterial,MeshBuilder:{
  CreateSphere:create,CreateBox:create,CreateCylinder:create,CreateTorus:create,
  CreateLines:create,CreateTube:create,CreatePlane:create,CreateCapsule:create},
  VertexData:class {static ComputeNormals(){}applyToMesh(){}},
};
const newScene=()=>{scene={meshes:[],transformNodes:[]};return scene;};
const makeRenderer=()=>{
  const world=newScene();
  const renderer=Object.create(UnitRenderer.prototype);
  renderer.scene=world;
  renderer.entries=new Map();renderer.meshes=new Map();renderer.animationQueues=new Map();renderer.activeAnimations=new Map();
  renderer.figureMaterials=new Map();renderer.figureTemplates=new Map();renderer.figureTintMaterials=new Map();
  renderer.figureBuildStats={templatesReused:0,buildMs:0,cloneMs:0,entriesCreated:0,entryBuildMs:0,entriesDisposed:0};
  // Existing figure batching is a geometry optimization: it does not change
  // which primitives are generated. Keep every source mesh observable here.
  renderer.batchFigureParts=(unit,signature,root,parts,meshes,material,height,definition,kind='FIGURE')=>
    ({root,meshes,[kind==='BIRD'?'birdParts':'figureParts']:parts,kind,height,lift:Number(definition.lift||0)});
  renderer.createAnimationBadge=()=>({root:{dispose(){},setEnabled(){}},meshes:[],dispose(){}});
  renderer.createFacingMarker=()=>({root:{dispose(){},position:new Vector3(),rotation:new Vector3()},meshes:[],dispose(){}});
  renderer.createVerticalCue=()=>({root:{dispose(){}},dispose(){}});
  return {renderer,world};
};
const map=()=>({width:6,height:6,tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0,waterDepth:0})),objects:[]});
const spawn=()=>UnitRuntimeEngine.create({id:'unit-model-test',team:'P',characterId:'avreshi',x:2,y:2,map:map()});

const assertOnlySpear=names=>{
  assert(names.some(n=>n.includes('field-spear-shaft')),'must draw a held spear shaft');
  assert(names.some(n=>n.includes('field-spear-steel-point')),'must draw a real spear point');
  assert(names.some(n=>n.includes('moon-spear-pearl')),'must draw moon-spear detail');
  assert(!names.some(n=>/figure-(?:bow|quiver|arrow-|fletching|side-sword)/.test(n)),
    'must not create a bow, arrow, quiver or second sword');
};
test('人形 Babylon 實際建立長矛／月冠／羽飾，不會偷偷生成弓、箭袋或側劍',()=>{
  const {renderer,world}=makeRenderer();const unit=spawn();
  const definition=renderer.battleVisual({visualId:unit.character.visualId});
  assert.equal(definition.kind,'FIGURE');
  const entry=renderer.createFigure(unit,definition);
  assert.equal(entry.kind,'FIGURE');
  const names=world.meshes.map(m=>m.name);
  assertOnlySpear(names);
  assert(names.some(n=>n.includes('moon-circlet')));
  assert(names.some(n=>n.includes('moon-crest-feather')));
  assert(names.some(n=>n.includes('moon-shoulder-pelt')));
  const spearMesh=world.meshes.find(m=>m.name.includes('field-spear-shaft'));
  assert.equal(spearMesh.parent,entry.figureParts.leftWeapon,'the spear must attach to left-hand weapon pivot');
  assert.equal(entry.figureParts.leftWeapon.parent,entry.figureParts.leftArm,'spear pivot must follow left arm');
});

test('實際建立獵豹、海豹、烏鴉不同 Babylon mesh，且換形態會切換視覺簽章',()=>{
  const {renderer,world}=makeRenderer(),unit=spawn();
  let previous=renderer.visualSignature({visualId:unit.character.visualId},renderer.battleVisual({visualId:unit.character.visualId}));
  const forms=[
    ['CHEETAH','QUADRUPED',['cat-head','cat-tail','cat-paw','cat-eye','cat-tear']],
    ['SEAL','QUADRUPED',['seal-body','seal-flipper','seal-eye','seal-whisker','seal-tailfin']],
    ['RAVEN','BIRD',['bird-wing','bird-tail-feather','bird-raven-ruff','bird-primary']]
  ];
  for(const [id,kind,parts] of forms){
    assert(UnitRuntimeEngine.shiftForm(unit,id),`must switch to ${id}`);
    const current=unit.character.visualId,definition=renderer.battleVisual({visualId:current});
    assert.equal(definition.kind,kind);
    const signature=renderer.visualSignature({visualId:current},definition);
    assert.notEqual(signature,previous,'same unit must rebuild Babylon geometry on shape switch');
    previous=signature;
    const before=world.meshes.length;
    const e=kind==='BIRD'?renderer.createBird(unit,definition,signature):renderer.createQuadruped(unit,definition);
    assert.equal(e.kind,kind);
    const meshes=world.meshes.slice(before).map(m=>m.name);
    for(const p of parts)assert(meshes.some(n=>n.includes(p)),`${id} missing ${p}`);
    assert(meshes.length>=15,`${id} must create multiple real 3D body meshes`);
    assert(!meshes.some(n=>n.includes('field-spear')||n.includes('figure-bow')),`${id} must not carry human weapons`);
    assert(Object.values(e[kind==='BIRD'?'birdParts':'quadParts']).length>=5);
  }
  assert(UnitRuntimeEngine.shiftForm(unit,'HUMAN'));
  assert.equal(unit.character.visualId,'avreshi_human');
});

test('正式 UnitRenderer.sync 依變身快照移除舊模型、生成新模型與銀白變身特效',()=>{
  const {renderer,world}=makeRenderer(),unit=spawn();
  renderer.formMorphs=new Map();renderer.formMorphReceipts=new Set();
  renderer.updateVerticalCue=()=>{};
  renderer.syncNightReadability=()=>{};
  const snapshot=()=>({id:unit.id,visualId:unit.character.visualId,team:'PLAYER',
    characterId:unit.character.id,currentForm:unit.currentForm,alive:true,
    facing:'E',x:unit.x,y:unit.y,z:unit.z,renderZ:unit.z,verticalMode:unit.verticalState?.mode||'GROUND',
    selected:false,finished:false,stealthed:false,friendlyToViewer:true});
  renderer.sync({units:[snapshot()]},[]);
  let original=renderer.entries.get(unit.id);
  assert.equal(original.kind,'FIGURE');
  let sequence=500;
  for(const [form,kind] of [['CHEETAH','QUADRUPED'],['SEAL','QUADRUPED'],['RAVEN','BIRD'],['HUMAN','FIGURE']]){
    assert(UnitRuntimeEngine.shiftForm(unit,form));
    const old=renderer.entries.get(unit.id);
    renderer.sync({units:[snapshot()]},[{type:'UNIT_FORM_CHANGED',unitId:unit.id,
      to:form,characterId:'avreshi',sequence:sequence++}]);
    const current=renderer.entries.get(unit.id);
    assert.equal(current.kind,kind);
    assert.notEqual(current.root,old.root,'must instantiate a DIFFERENT Babylon body mesh root');
    assert(old.root.disposed===true,'must dispose old Babylon root on form change');
    assert.equal(renderer.formMorphs.size,1,'must spawn temporary moonlight effect');
    assert.equal(renderer.formMorphs.get(unit.id).sparks.length,6);
  }
  const pulse=renderer.formMorphs.get(unit.id);
  renderer.updateFormMorphs(pulse.startedAt+800);
  assert.equal(renderer.formMorphs.size,0,'temporary VFX must be disposed after completion');
  assert(pulse.root.disposed===true);
  assert(world.meshes.some(m=>m.name.startsWith('form-moon-ring-')));
});

// All registered human figures use the same real primitive generator. Reuse
// the Babylon stand-in above rather than introducing a second renderer.
test('all FIGURE weapons are opt-in; authored bow variants and side arms are preserved',()=>{
  for(const [visualId,visual] of Object.entries(globalThis.VISUALS.characters)){
    if(visual.battle?.kind!=='FIGURE')continue;
    const {renderer,world}=makeRenderer();
    const unit={id:'weapon-test',visualId};
    const definition=renderer.battleVisual(unit),f=definition.figure;
    const entry=renderer.createFigure(unit,definition);
    const names=world.meshes.map(m=>m.name);
    const has=pattern=>names.some(n=>pattern.test(n));
    assert.equal(has(/^figure-bow-/),f.bow===true&&!f.fieldBow&&!f.holyBow,`${visualId}: recurve bow`);
    assert.equal(has(/^figure-field-bow-/),!!f.fieldBow,`${visualId}: field bow`);
    assert.equal(has(/^figure-holy-bow-/),!!f.holyBow,`${visualId}: holy bow`);
    assert.equal(has(/^figure-(?:quiver-|arrow-|fletching-)/),f.quiver===true,`${visualId}: quiver and arrows`);
    assert.equal(has(/^figure-side-(?:sword|guard|pommel)-/),f.sideSword===true,`${visualId}: side sword`);
    assert.equal(has(/^figure-arcane-staff-/),!!f.arcaneStaff,`${visualId}: staff`);
    assert.equal(entry.kind,'FIGURE');
  }
});
test('Cassandra keeps her actual staff and CAST animation, without invented secondary weapons',()=>{
  const {renderer,world}=makeRenderer();
  const unit={id:'cassandra-weapon',visualId:'cassandra_default'};
  const definition=renderer.battleVisual(unit);
  const entry=renderer.createFigure(unit,definition);
  const staff=world.meshes.find(m=>m.name.startsWith('figure-arcane-staff-shaft-'));
  assert(staff);assert.equal(staff.parent,entry.figureParts.weapon);
  assert.equal(definition.animations.CAST.procedural,'CAST');
  assert(!world.meshes.some(m=>/^figure-(?:bow-|field-bow-|holy-bow-|quiver-|arrow-|fletching-|side-sword-|side-guard-|side-pommel-)/.test(m.name)));
});
test('unspecified optional weapons are absent; specialized holy bow never duplicates the ordinary bow',()=>{
  const {renderer,world}=makeRenderer();
  const def={kind:'FIGURE',height:1.7,figure:{}};
  renderer.createFigure({id:'unarmed',visualId:'unarmed-regression'},def);
  assert(!world.meshes.some(m=>/^figure-(?:bow-|quiver-|arrow-|fletching-|side-sword-)/.test(m.name)));
  const next=makeRenderer();
  next.renderer.createFigure({id:'holy',visualId:'holy-regression'},{...def,figure:{bow:true,holyBow:true}});
  assert(next.world.meshes.some(m=>m.name.startsWith('figure-holy-bow-')));
  assert(!next.world.meshes.some(m=>m.name.startsWith('figure-bow-')));
});
