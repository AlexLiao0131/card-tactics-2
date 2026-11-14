import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=(file)=>readFileSync(new URL('../../js/'+file,import.meta.url),'utf8');
const sword={id:'black_sword',weaponKind:'SWORD',attackType:'SLASH'};
const nether={id:'nether_slash',name:'奧義・幽影連斬',weapon:'black_sword',power:1.25,range:{min:1,max:3},attackType:'SLASH',target:'ENEMY',hitCount:4};
const shadow={id:'shadow_step',range:{min:1,max:4}};
function scene({blocked=[],actorX=1,actorY=2,enemyX=3,enemyY=2,hp=500}={}){
  const events=[],receipts=[],commits=[],entered=[];
  const a={id:'l',team:'P',character:{id:'livia',name:'莉維亞',weapons:{black_sword:sword},passives:[],skills:['nether_slash'],combat:{hp:600,atk:100,def:50,mdef:50}},alive:true,hp:600,mana:120,x:actorX,y:actorY,z:0};
  const b={id:'e',team:'E',character:{id:'enemy',name:'對手',weapons:{},passives:[],skills:[],combat:{hp,atk:30,def:50,mdef:50}},alive:true,hp,x:enemyX,y:enemyY,z:0};
  const map={tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0}))};
  const tactical={
    ensureFacing:u=>u.facing||'N',faceToward:()=>{},
    tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
    canTarget:(m,act,target,s)=>!!act.alive&&!!target.alive&&act.team!==target.team&&
      Math.abs(act.x-target.x)+Math.abs(act.y-target.y)>=s.range.min&&
      Math.abs(act.x-target.x)+Math.abs(act.y-target.y)<=s.range.max,
    canOccupyTerrain:(u,t)=>!blocked.some(p=>p.x===t.x&&p.y===t.y),
    isBlockedByObject:()=>false,
    attackDelivery:()=>"MELEE",
    resolve:(m,act,target,sk)=>({result:{hit:true,damage:40,crit:false,physicalCrit:false,magicCrit:false,graze:false,type:'SLASH',el:'NONE',hc:100,cc:0,accuracy:0,evasion:0},terrain:{acc:0,eva:0}})
  };
  const sandbox={
    SkillDatabase:{get:k=>k==='shadow_step'?shadow:nether,passiveList:()=>[]},
    EquipmentDatabase:{defenseProfiles:()=>[]},
    BattleEngine:{actionSpeed:()=>0},
    TacticalEngine:tactical,
    ColinShieldMobilityEngine:{shieldOccupied:()=>false},
    WeaponMaterialEngine:{},
    chooseAutonomousBattleReaction:()=>null,
    CombatContactRules:{isPureMagic:()=>false,canGanfanDefend:()=>false},
    UnitRuntimeEngine:{applyResourceScaling:(u,s)=>s,rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},endBloodTransaction:()=>{},criticalManaRefund:()=>0,attackEnhancement:()=>1},
    EffectEngine:{consumeWeaponEnchantment:()=>null,interruptChannel:()=>{},breakStealth:()=>{},applyDamage:(u,d)=>{const actual=Math.min(u.hp,Math.max(0,d));u.hp-=actual;return{hpLoss:actual,absorbed:0}},markVengeance:()=>{},consumeVengeance:()=>{}},
    PostEngagementEngine:{process:({queue})=>({queue,results:[]})},
    UnitAnimationEngine:{emitAction:(...args)=>{events.push({type:'ATTACK',actorId:args[0].id,detail:args[3]});return{}},emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{},emitMove:(u,info)=>events.push({type:'MOVE',...info}),emitPresentation:(type,info)=>events.push({type,...info})},
  };
  sandbox.globalThis=sandbox;
  const code=src('battle-resolution.js').replace(/^import .+;$/gm,'').replace(/^export (function|const) /gm,'$1 ');
  vm.runInNewContext(code,sandbox,{filename:'battle-resolution.js'});
  const r=sandbox.createBattleResolution({random:()=>0});
  r.resolve({map,units:[a,b],initiator:a,target:b,skill:nether,actions:[]},{
    canUseSkill:()=>true,consumeSkill:(u,s)=>{commits.push(s.id);return{cost:20,resources:{}}},onAction:x=>receipts.push(x),onDefeated:()=>{},onBackstep:(u,t)=>entered.push([u.x,u.y])
  });
  return{a,b,events,receipts,commits,entered};
}
test('real four-contact combo commits one skill and lands on valid neighboring tiles',()=>{
  const t=scene();
  assert.equal(t.receipts.length,4);
  assert.equal(t.b.hp,340);
  assert.deepEqual(t.commits,['nether_slash']);
  assert.equal(t.entered.length,3);
  const event=t.events.find(x=>x.type==='LIVIA_FLURRY_PATH');
  assert.ok(event);
  assert.equal(event.path.length,4);
  const seen=new Set();
  for(const p of event.path.slice(1)){
    assert.equal(Math.abs(p.x-3)+Math.abs(p.y-2),1);
    const k=`${p.x},${p.y}`;assert.equal(seen.has(k),false);seen.add(k);
  }
  assert.equal(t.a.x,event.path.at(-1).x);
  assert.equal(t.a.y,event.path.at(-1).y);
  assert.equal(t.events.filter(e=>e.type==='MOVE').length,1);
});
test('blocked ring tiles prevent invented relocation while all four original contacts still settle',()=>{
  const t=scene({blocked:[{x:3,y:1},{x:4,y:2},{x:3,y:3},{x:2,y:2}]});
  assert.equal(t.entered.length,0);
  assert.equal(t.receipts.length,4);
  assert.equal(t.a.x,1);assert.equal(t.a.y,2);
  assert.equal(t.events.filter(e=>e.type==='MOVE').length,0);
});
test('flurry stops contact damage when the target is defeated',()=>{
  const t=scene({hp:40});
  assert.equal(t.receipts.length,1);assert.equal(t.b.alive,false);
  assert.equal(t.entered.length,0);
});
test('no second resource is spent on intra-skill blinks',()=>{
  const t=scene();
  assert.equal(t.events.filter(e=>e.type==='ATTACK').length,1);
  assert.deepEqual(t.commits,['nether_slash']);
});
test('berserk snapshot exports authoritative flag and vfx event is routed',()=>{
  assert.match(src('unit-runtime-engine.js'),/berserk:UnitTraitEngine\.status\(unit\)\?\.berserk===true/);
  assert.match(src('vfx-database.js'),/events:\['LIVIA_FLURRY_PATH'\]/);
  assert.match(src('livia-duality-vfx.js'),/resources\?\.duality\?\.berserk===true/);
  assert.match(src('livia-duality-vfx.js'),/this\.units\.positionFor\(entry,point\)/);
});

function makeBabylonMock(){
  class V{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}set(x,y,z){this.x=x;this.y=y;this.z=z;}copyFrom(other){this.set(other.x,other.y,other.z);}}
  class Node{constructor(name){this.name=name;this.position=new V();this.rotation=new V();this.scaling={value:1,setAll:v=>{this.scaling.value=v}};this.children=[];this.enabled=true;this._disposed=false;}
    set parent(n){if(n){n.children.push(this);this._parent=n}}
    setEnabled(b){this.enabled=b}
    getChildMeshes(){return this.children.filter(x=>x.isMesh).concat(this.children.flatMap(x=>x.getChildMeshes()))}
    dispose(){this._disposed=true;for(const c of this.children)c.dispose()}
    isDisposed(){return this._disposed}
  }
  class Color3{constructor(...c){this.c=c;}scale(){return this}}
  class Mesh extends Node{constructor(name){super(name);this.isMesh=true;this.visibility=1;this.metadata={};}}
  class Material{constructor(name){this.name=name;this.diffuseColor=null;this.emissiveColor=null;this.alpha=1;}dispose(){}}
  return {TransformNode:Node,Mesh,StandardMaterial:Material,Color3,MeshBuilder:Object.fromEntries([
      'CreateCylinder','CreateSphere','CreateTorus','CreateBox','CreatePolyhedron','CreatePlane'
    ].map(k=>[k,(name)=>new Mesh(name)])),Vector3:V};
}
test('specter is present only for berserk, restores figure visibility, and flurry moves the actual mesh',()=>{
  const B=makeBabylonMock();
  const sandbox={BABYLON:B,performance:{now:()=>1000},TILE_SIZE:1,ELEVATION_HEIGHT:1};
  sandbox.globalThis=sandbox;
  const source=src('livia-duality-vfx.js').replace(/^import .+;$/gm,'').replace(/^export (function|class|const) /gm,'$1 ');
  vm.runInNewContext(source+'\n globalThis.LiviaDualityVfx = LiviaDualityVfx;',sandbox,{filename:'livia-duality-vfx.js'});
  const mesh=new B.Mesh('real-livia-figure'),entry={lastUnit:{id:'l'},meshes:[mesh],root:new B.TransformNode('real-livia'),
    baseScale:1,facingMarker:{root:new B.TransformNode('marker')}};
  const units={entries:new Map([['l',entry]]),
    positionFor:(entry,p)=>new B.Vector3(p.x,p.z||0,p.y),
    markerPositionFor:p=>new B.Vector3(p.x,p.z||0,p.y)};
  const scene={onDisposeObservable:{addOnce:()=>{}}};
  const fx=new sandbox.LiviaDualityVfx(scene,{units});
  const unit={id:'l',characterId:'livia',x:3,y:2,z:0,resources:{duality:{berserk:true,value:100}}};
  fx.sync({map:{id:'m',tiles:[]},units:[unit]},[]);
  assert.equal(fx.diagnostics().berserkGhosts,1);
  assert.equal(mesh.visibility,.16);
  const path={type:'LIVIA_FLURRY_PATH',sequence:17,unitId:'l',path:[
    {x:1,y:2,z:0},{x:2,y:1,z:0},{x:4,y:2,z:0},{x:3,y:3,z:0}
  ]};
  fx.sync({map:{id:'m',tiles:[]},units:[unit]},[path]);
  assert.equal(fx.diagnostics().flurryAnimations,1);
  assert.equal(fx.active[0].event.unitId,'l'); // Local engagement must await VFX.
  fx.updateFrame(1300);
  assert.equal(entry.root.position.x,1);
  fx.updateFrame(1550);
  assert.equal(entry.root.position.x,2);
  assert.equal(entry.root.position.z,1);
  fx.updateFrame(2400);
  assert.equal(fx.diagnostics().flurryAnimations,0);
  assert.equal(fx.active.length,0);
  mesh.visibility=1; // the official UnitRenderer has already synced its next snapshot.
  fx.sync({map:{id:'m',tiles:[]},units:[{...unit,resources:{duality:{value:90,berserk:false}}}]},[]);
  assert.equal(fx.diagnostics().berserkGhosts,0);
  assert.equal(mesh.visibility,1);
  fx.dispose();
});

// PVP's existing presenter filters nonfriendly event.path coordinates.
test('flurry publishes the existing PVP privacy-filtered path field',()=>{
  const r=scene();const evt=r.events.find(e=>e.type==='LIVIA_FLURRY_PATH');
  assert.equal(evt.team,'P');
  assert.ok(Array.isArray(evt.path));
  assert.equal('points' in evt,false);
});
