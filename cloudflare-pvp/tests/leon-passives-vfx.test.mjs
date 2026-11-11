import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {CHARACTERS} from '../../js/character-database.js';
import {VfxDatabase} from '../../js/vfx-database.js';
import {createBattleResolution} from '../../js/battle-resolution.js';

// Canonical BattleResolution is exercised with fixed engine ports. No forked
// character-specific battle algorithm is placed in the headless test.
const skillAttack={id:'enemy_slash',name:'enemy slash',weapon:'sword',power:1,
  category:'ATTACK',attackType:'SLASH',target:'ENEMY',range:{min:1,max:1},speed:10};
let events=[];
globalThis.EquipmentDatabase={defenseProfiles:u=>u?.id==='leon'?
  [{id:'star_iron_parry',method:'PARRY',vs:{SLASH:{chance:80}}}]:[]};
globalThis.BattleEngine={
  actionSpeed:(char,skill)=>char.attributes.agi*4+(skill.speed||0),
  physicalMatch:(kind,target)=>({SLASH:1,PIERCE:0,STRIKE:0}[kind]??0)
};
globalThis.TacticalEngine={
  ensureFacing:u=>(u.facing??='N'),faceToward:()=>{},
  canTarget:(_map,a,b,s)=>!!a&&!!b&&Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=s.range.max,
  resolve:(_map,a,t,skill,{forceHit=false,random=()=>.2}={})=>({result:{
    type:skill.attackType,el:'NONE',hit:forceHit||random()<.7,
    hc:70,crit:false,damage:25
  }})
};
globalThis.UnitRuntimeEngine={applyResourceScaling:(_u,s)=>s,beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,criticalManaRefund:()=>0};
globalThis.EffectEngine={
  applyDamage:(u,n)=>{const amount=Math.min(u.hp,n);u.hp-=amount;return{hpLoss:amount,absorbed:0}},
  interruptChannel:()=>{},breakStealth:()=>{},consumeWeaponEnchantment:()=>null,
  markVengeance:()=>{},state:()=>[]
};
globalThis.UnitAnimationEngine={
  emitAction:(a,b,s,options)=>{const event={type:'UNIT_ANIMATION',unitId:a.id,targetId:b.id,skillId:s.id,...options};events.push(event);return event},
  emitOutcome:(u,kind)=>events.push({type:'UNIT_FLOAT_TEXT',unitId:u.id,kind}),
  emitResolvedHit:()=>{},emitHit:()=>{},emitPresentation:()=>{}
};
globalThis.PostEngagementEngine={process:()=>({queue:[],results:[]})};

function actors({thirdEnemy=false,thirdFriend=false,hp=260,passive=true}={}){
  const leon={id:'l',x:1,y:1,team:'P',hp,alive:true,waited:true,
    character:{id:'leon',attributes:{agi:18},combat:{hp:260},
      skills:['leon_slash','leon_thrust','leon_strike','lion_flash'],
      passives:passive?['FIRST_SWORD','OFFENSE_DEFENSE_UNITY']:[],
      weapons:{star_iron_sword:{weaponKind:'SWORD',attackType:'SLASH'}}}};
  const enemy={id:'e',x:2,y:1,team:'E',hp:300,alive:true,
    character:{id:'enemy',attributes:{agi:22},combat:{hp:300},
      skills:['enemy_slash'],passives:[],weapons:{sword:{weaponKind:'SWORD',attackType:'SLASH'}}}};
  const units=[leon,enemy];
  if(thirdEnemy)units.push({id:'e2',x:1,y:2,team:'E',alive:true,occupiesTile:true});
  if(thirdFriend)units.push({id:'a2',x:2,y:2,team:'P',alive:true,occupiesTile:true});
  return{leon,enemy,units};
}
const engine=()=>createBattleResolution({random:()=>.01});
const hooks={canUseSkill:()=>true,consumeSkill:()=>({cost:0,resources:{}}),onAction:()=>{}};

test('passives are data-owned; retired sword-only speed bonus is not equipped',()=>{
  assert.deepEqual(CHARACTERS.leon.passives,['FIRST_SWORD','OFFENSE_DEFENSE_UNITY']);
  assert.equal(SkillDatabase.getPassive('FIRST_SWORD').duelRules.initiative,'FIRST');
  assert.equal(SkillDatabase.getPassive('FIRST_SWORD').duelRules.defenseIgnoreRatio,null);
});
test('duel grants first action in legal one-to-one, using actual queue priority',()=>{
  const {leon,enemy,units}=actors();
  const r=engine(),skill=SkillDatabase.get('leon_slash');
  const c=r.createContext({map:{},units,initiator:enemy,target:leon,skill:skillAttack,
    actions:[r.createCounterAction(leon,enemy,skill)]});
  const q=r.buildQueue(c);
  assert.equal(q[0].actor.id,leon.id);
  assert.equal(q[0].duelFirst,true);
});
test('duel is removed by other adjacent enemy or friendly pincer',()=>{
  for(const extra of [{thirdEnemy:true},{thirdFriend:true}]){
    const {leon,enemy,units}=actors(extra),r=engine();
    const c=r.createContext({map:{},units,initiator:enemy,target:leon,skill:skillAttack,
      actions:[r.createCounterAction(leon,enemy,SkillDatabase.get('leon_slash'))]});
    assert.equal(r.buildQueue(c).find(a=>a.actor.id===leon.id).duelFirst,false);
  }
});
test('successful existing PARRY triggers one legal automatic counter after attack',()=>{
  events=[];
  const {leon,enemy,units}=actors();const r=engine();
  const outcome=r.resolve({map:{},units,initiator:enemy,target:leon,skill:skillAttack,
    reaction:{type:'DEFENSE',methodId:'star_iron_parry'}},hooks);
  assert.deepEqual(outcome.results.map(x=>x.role),['INITIATOR','COUNTER']);
  assert.equal(outcome.results[0].result.damage,0);
  assert.equal(outcome.results[1].actor.id,leon.id);
  assert.ok(events.some(e=>e.kind==='PARRY'));
  assert.ok(events.some(e=>e.skillId==='leon_slash'&&e.role==='COUNTER'));
});
test('full E VADE triggers auto counter; GRAZE does not',()=>{
  for(const [roll,wantCounter] of [[.95,true],[.6,false]]){
    events=[];
    const {leon,enemy,units}=actors(),r=createBattleResolution({random:()=>roll});
    const result=r.resolve({map:{},units,initiator:enemy,target:leon,skill:skillAttack,
      reaction:{type:'EVADE'}},hooks);
    assert.equal(result.results.some(a=>a.role==='COUNTER'),wantCounter);
    assert.equal(result.results[0].result.evadeOutcome,wantCounter?'MISS':'GRAZE');
  }
});
test('counter not emitted when Leon has no passive, or attacker out of range',()=>{
  const without=actors({passive:false}),r=engine();
  assert.equal(r.resolve({map:{},units:without.units,initiator:without.enemy,target:without.leon,
    skill:skillAttack,reaction:{type:'DEFENSE',methodId:'star_iron_parry'}},hooks).results.length,1);
  const withRange=actors();const original=globalThis.TacticalEngine.canTarget;
  globalThis.TacticalEngine.canTarget=()=>false;
  try {assert.equal(r.resolve({map:{},units:withRange.units,initiator:withRange.enemy,target:withRange.leon,
    skill:skillAttack,reaction:{type:'DEFENSE',methodId:'star_iron_parry'}},hooks).results.length,1)}
  finally {globalThis.TacticalEngine.canTarget=original}
});
test('four swords route to one VFX behavior; no damage/armor changes',()=>{
  for(const s of ['leon_slash','leon_thrust','leon_strike','lion_flash'])
    assert.deepEqual(VfxDatabase.routeSkill(s),['swordsmanship']);
  assert.equal(VfxDatabase.hasEvent('swordsmanship','UNIT_FLOAT_TEXT'),true);
  assert.equal(SkillDatabase.get('leon_strike').power,1.1);
  assert.equal(SkillDatabase.get('lion_flash').manaCost,28);
  for(const s of ['leon_slash','leon_thrust','leon_strike','lion_flash'])
    assert.ok(SkillDatabase.inspect(SkillDatabase.get(s)).description.length>20);
});

// A Babylon-compatible lightweight scene port verifies the real effect class
// creates and retires presentation meshes without touching gameplay units.
test('Babylon sword trails and successful parry/dodge FX are event-owned',async()=>{
  class V3{
    constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z}
    copyFrom(v){this.x=v.x;this.y=v.y;this.z=v.z;return this}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
    setAll(n){return this.set(n,n,n)}
    subtract(v){return new V3(this.x-v.x,this.y-v.y,this.z-v.z)}
    static Lerp(a,b,t){return new V3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t)}
  }
  class Mesh{
    constructor(){this.position=new V3();this.rotation=new V3();this.scaling=new V3(1,1,1);this.visibility=1}
    dispose(){this.disposed=true}
  }
  globalThis.BABYLON={
    Color3:class{constructor(r,g,b){this.r=r;this.g=g;this.b=b}},
    StandardMaterial:class{dispose(){}},
    TransformNode:class extends Mesh{},Vector3:V3,Engine:{ALPHA_ADD:1},
    MeshBuilder:{CreateBox:()=>new Mesh(),CreateSphere:()=>new Mesh(),
      CreateTorus:()=>new Mesh(),CreateTube:()=>new Mesh()}
  };
  const {SwordsmanshipVfx}=await import('../../js/swordsmanship-vfx.js');
  const scene={onDisposeObservable:{addOnce:()=>{}}},fx=new SwordsmanshipVfx(scene);
  const snapshot={map:{id:'field',tiles:[]},round:3,units:[
    {id:'l',characterId:'leon',alive:true,x:1,y:1,z:0},
    {id:'e',characterId:'enemy',alive:true,x:2,y:1,z:0}]};
  const event={type:'UNIT_ANIMATION',sequence:1,unitId:'l',targetId:'e',skillId:'leon_thrust',
    x:1,y:1,targetX:2,targetY:1,duelActive:true};
  fx.sync(snapshot,[event]);assert.equal(fx.active.length,1);
  assert.equal(fx.active[0].kind,'PIERCE');assert.ok(fx.active[0].duelRing);
  fx.sync(snapshot,[{...event,skillId:'lion_flash',sequence:11,landingX:3,landingY:1}]);
  assert.equal(fx.active[1].kind,'FLASH');
  assert.ok(fx.active[1].to.x > fx.active[0].to.x); // Validated landing beyond target.
  fx.active.splice(1,1)[0].root.dispose();
  fx.sync(snapshot,[event]);assert.equal(fx.active.length,1);
  fx.sync(snapshot,[{type:'UNIT_FLOAT_TEXT',sequence:2,unitId:'l',x:1,y:1,kind:'PARRY'},
    {type:'UNIT_FLOAT_TEXT',sequence:3,unitId:'l',x:1,y:1,kind:'DODGE'},
    {type:'UNIT_FLOAT_TEXT',sequence:4,unitId:'e',x:2,y:1,kind:'PARRY'}]);
  assert.deepEqual(fx.active.map(a=>a.kind),['PIERCE','PARRY','DODGE']);
  fx.updateFrame(performance.now()+300);
  assert.ok(fx.active.every(a=>!a.root.disposed));
  fx.updateFrame(performance.now()+1000);
  assert.equal(fx.active.length,0);
  fx.dispose();
});
