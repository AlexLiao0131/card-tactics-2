import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=path=>readFileSync(resolve(root,path),'utf8');

function makeDanceHarness(){
  let currentTime=0;
  const created=[];
  class Vector3{
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    copyFrom(other){this.x=other.x;this.y=other.y;this.z=other.z;return this;}
    static Lerp(a,b,t){return new Vector3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
  }
  class Scale{
    constructor(){this.value=1;}
    setAll(value){this.value=value;}
  }
  class Node{
    constructor(kind){this.kind=kind;this.children=[];this.position=new Vector3();this.rotation={x:0,y:0,z:0};this.scaling=new Scale();this.disposed=false;this.enabled=true;created.push(this);}
    set parent(next){this._parent=next;if(next)next.children.push(this);}
    get parent(){return this._parent;}
    setEnabled(value){this.enabled=value;}
    dispose(){if(this.disposed)throw Error(`DOUBLE_DISPOSE_${this.kind}`);this.disposed=true;for(const child of this.children)child.dispose();}
  }
  class StandardMaterial{
    constructor(){this.diffuseColor=null;this.emissiveColor=null;this.disposed=false;}
    dispose(){this.disposed=true;}
  }
  class Color3{constructor(...components){this.components=components;}}
  const BABYLON={Vector3,Color3,StandardMaterial,TransformNode:class extends Node{constructor(){super('root');}},
    Mesh:{BILLBOARDMODE_ALL:1},MeshBuilder:{
      CreateTorus:()=>new Node('torus'),CreateTube:()=>new Node('tube'),CreatePlane:()=>new Node('plane')
    }};
  const code=source('js/vfx-manager.js').match(/class DanceSongVfx\{[\s\S]*?\n\}\n\n\/\*\*\n \* Water-lurker/)?.[0];
  assert.ok(code);
  const clazz=runInNewContext(`${code.slice(0,code.lastIndexOf('\n\n/**'))}\nDanceSongVfx`,{
    BABYLON,performance:{now:()=>currentTime},VfxDatabase:{roleFor:(_module,id)=>id==='safiya_sword_dance'?'SWORD':id==='safiya_dance_of_death'?'DEATH':null},
    TILE_SIZE:1,ELEVATION_HEIGHT:1,
  });
  const units={animationQueues:new Map(),activeAnimations:new Map()};
  const scene={onDisposeObservable:{addOnce:()=>{}}};
  return{vfx:new clazz(scene,{units}),units,created,now:value=>{currentTime=value;}};
}

test('three sword dance cuts wait for their own animation; repeat casts reuse bounded geometry',()=>{
  const h=makeDanceHarness();const {vfx,units,created}=h;
  const snapshot={map:{tiles:[]},units:[]};let lastMeshes=null;
  for(let cast=0;cast<10;cast++){
    const events=[1,2,3].map(step=>({type:'UNIT_ANIMATION',unitId:'safiya',
      sequence:cast*3+step,skillId:'safiya_sword_dance',danceStep:step,
      x:step-1,y:0,z:0,targetX:3,targetY:0,duration:320}));
    units.animationQueues.set('safiya',[...events]);
    vfx.sync(snapshot,events);
    assert.equal(vfx.diagnostics().pending,3);
    assert.equal(vfx.diagnostics().active,0,'all three meshes must NOT spawn in one frame');
    for(const e of events){
      units.animationQueues.set('safiya',units.animationQueues.get('safiya').filter(a=>a!==e));
      units.activeAnimations.set('safiya',{event:e});
      h.now(cast*3000+e.danceStep*700);
      vfx.updateFrame(cast*3000+e.danceStep*700);
      assert.equal(vfx.diagnostics().active,1);
      assert.equal(vfx.diagnostics().pending,3-e.danceStep);
      vfx.updateFrame(cast*3000+e.danceStep*700+650);
      assert.equal(vfx.diagnostics().active,0);
      assert.equal(vfx.diagnostics().pooled,1);
      units.activeAnimations.delete('safiya');
    }
    const meshes=created.filter(n=>['torus','tube'].includes(n.kind)).length;
    if(lastMeshes===null)lastMeshes=meshes;
    assert.equal(meshes,lastMeshes,'repeat sword dance must not allocate additional GPU meshes');
  }
  assert.equal(lastMeshes,3,'one pooled torus + two tube trails');
  vfx.dispose();vfx.dispose();
  assert.ok(created.every(n=>n.disposed),'all created sword blade nodes disposed on teardown');
});

test('cancelled or invisible dance events are not materialized',()=>{
  const {vfx,created}=makeDanceHarness();
  vfx.sync({map:{tiles:[]},units:[]},[{type:'UNIT_ANIMATION',sequence:101,unitId:'hidden',
    skillId:'safiya_sword_dance',danceStep:1,x:0,y:0,z:0,targetX:1,targetY:0}]);
  assert.equal(vfx.diagnostics().pending,1);
  vfx.updateFrame(500);
  assert.equal(vfx.diagnostics().pending,0);
  assert.equal(created.length,0);
  vfx.dispose();
});

test('danceMove records a single continuous animation path and enters every actual tile',()=>{
  const src=source('js/battle-resolution.js');
  const fn=src.match(/    const danceMove=\(actor,target,arc\)=>\{[\s\S]*?\n    \};\n    const enqueueDance=/)?.[0];
  assert.ok(fn);
  const events=[],entered=[];
  const tiles=[{x:2,y:0,elevation:0}];
  const path=[{x:1,y:0,elevation:0},{x:2,y:0,elevation:0}];
  const actor={id:'safiya',x:0,y:0,z:0,alive:true};
  const target={id:'opponent',x:2,y:1,z:0,alive:true};
  const danceMove=runInNewContext(`${fn.slice(0,fn.lastIndexOf('\n    const enqueueDance='))}\ndanceMove`,{
    c:{map:{tiles},units:[actor,target]},distance:(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),
    TacticalEngine:{relativeArc:()=> 'SIDE',pathTo:()=>path,canActiveMove:()=>true,faceToward:()=>{}},
    globalThis:{UnitAnimationEngine:{emitMove:(unit,detail)=>events.push({unit:{...unit},detail})}},
    hooks:{onBackstep:(unit,tile)=>entered.push({x:unit.x,y:unit.y,tile:tile.x})}
  });
  assert.equal(danceMove(actor,target,'SIDE'),true);
  assert.deepEqual({x:actor.x,y:actor.y},{x:2,y:0});
  assert.equal(entered.length,2,'terrain callbacks must remain per tile');
  assert.equal(events.length,1,'walk playback must NOT create a new animation for every intermediate tile');
  assert.equal(events[0].detail.kind,'DANCE_STEP');
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].detail.path.map(p=>[p.x,p.y]))),[[1,0],[2,0]]);
});

test('client keeps sword slash as ATTACK without modifying magic resource category',()=>{
  const skill=source('js/skill-database.js');
  assert.match(skill,/safiya_sword_dance:[\s\S]{0,350}animationState:"ATTACK",danceSequence:true/);
  const unit=source('js/unit-renderer.js');
  assert.match(unit,/state!=="WALK"&&Number\.isFinite\(event\.x\)/);
  assert.match(unit,/this\.positionFor\(entry,event\)/);
});

test('real UnitRenderer.updateFrame re-anchors consecutive strike poses instead of rewinding to the final snapshot',()=>{
  const file=source('js/unit-renderer.js');
  const section=file.match(/  updateFrame\(now=performance\.now\(\)\)\{[\s\S]*?\n  \}\n\n  \/\/ Rim\/reflective/)?.[0];
  assert.ok(section);
  const method=section.slice(0,section.lastIndexOf('\n\n  // Rim/reflective'));
  const Renderer=runInNewContext(`class Renderer {\n${method}\n}\nRenderer`,{
    performance:{now:()=>100},clamp01:n=>Math.max(0,Math.min(1,n))
  });
  const renderer=new Renderer();
  const point={x:2,y:0,z:0};
  const pose={position:{x:2,y:0,z:0,copyFrom(v){Object.assign(this,v);}}};
  const marker={root:{position:{x:2,y:0,z:0,copyFrom(v){Object.assign(this,v);}}}};
  const entry={root:pose,facingMarker:marker,lastUnit:{id:'safiya',x:2,y:0,z:0}};
  renderer.entries=new Map([['safiya',entry]]);
  renderer.activeAnimations=new Map();
  renderer.animationQueues=new Map();
  renderer.startNext=()=>null;
  renderer.resetPose=e=>{e.root.position.x=2;e.facingMarker.root.position.x=2;};
  renderer.animationDefinition=()=>({});
  renderer.applyFacing=()=>{};renderer.setBillboardAsset=()=>{};
  renderer.applyProcedural=()=>{};renderer.applyColinShieldPose=()=>{};
  renderer.updateAnimationBadge=()=>{};renderer.syncShieldPassengers=()=>{};
  renderer.updateFormMorphs=()=>{};
  renderer.positionFor=(_entry,e)=>({x:e.x,y:e.z,z:e.y});
  renderer.markerPositionFor=e=>({x:e.x,y:e.z,z:e.y});
  function currentStrike(x){return {event:{type:'UNIT_ANIMATION',sequence:x+1,state:'ATTACK',x,y:0,z:0,unitId:'safiya'},startedAt:0,duration:320};}
  renderer.activeAnimations.set('safiya',currentStrike(0));
  renderer.updateFrame(100);
  assert.equal(entry.root.position.x,0,'first slash stays at first contact, not final snapshot');
  renderer.activeAnimations.set('safiya',currentStrike(1));
  renderer.updateFrame(150);
  assert.equal(entry.root.position.x,1,'second slash advances to second contact, not back to original');
  assert.equal(entry.facingMarker.root.position.x,1);
});
