import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SKILLS} from '../../js/skill-database.js';

// Run the REAL authored BattleResolution and TacticalActionController core
// attack function; replace only map/rng/animation/UI boundaries with deterministic
// fixtures. These tests deliberately execute the official attack branches,
// not gainAstralPower() directly.
const battleSource=readFileSync(new URL('../../js/battle-resolution.js',import.meta.url),'utf8');
const controllerSource=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8');
function unit(id,team){
  return {id,team,alive:true,x:team==='P'?1:3,y:2,hp:250,mana:96,maxMana:96,
    resources:{astralPower:{value:0,max:100,label:'星能'}},
    character:{id:team==='P'?'avreshi':'test_enemy',name:team==='P'?'艾芙蕾希':'敵人',
      resourceRules:team==='P'?{mana:true,astralPower:{}}:{mana:true},passives:[],
      skills:team==='P'?['avreshi_moonfire']:['test_slash'],
      combat:{hp:250,atk:75,matk:102,def:45,mdef:50,move:5},weapons:{}}};
}
const slash={id:'test_slash',name:'劍擊',category:'ATTACK',target:'ENEMY',attackType:'SLASH',power:1,range:{min:1,max:2}};
function fixture({hit=true}={}){
  const hero=unit('hero','P'),enemy=unit('enemy','E');
  const presentation=[];
  const runtime={
    applyResourceScaling:(_u,s)=>s,rollSanityMisfire:()=>false,
    beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1,
    criticalManaRefund:()=>0,bloodUser:()=>false,resourceSnapshot:u=>u.resources,
    gainAstralPower:(actor,skill)=>{
      if(!actor?.character?.resourceRules?.astralPower||!actor.alive)return 0;
      const before=actor.resources.astralPower.value;
      actor.resources.astralPower.value=Math.min(actor.resources.astralPower.max,before+Number(skill.astralGain||0));
      return actor.resources.astralPower.value-before;
    }
  };
  const TacticalEngine={ensureFacing:()=>{},faceToward:()=>{},canTarget:()=>true,
    resolve:()=>({result:{hit,damage:hit?21:0,type:'MAGIC',crit:false,el:'NATURE',hc:90}})};
  const BattleEngine={actionSpeed:()=>10,critChance:()=>0};
  const SkillDatabase={get:id=>SKILLS[id]||null,passiveList:()=>[],passiveDefenseProfiles:()=>[]};
  const EquipmentDatabase={defenseProfiles:()=>[]};
  const EffectEngine={applyDamage:(u,raw)=>{const hpLoss=Math.min(Math.max(0,u.hp),Math.max(0,Number(raw||0)));u.hp-=hpLoss;return {hpLoss,absorbed:0}},
    markVengeance:()=>{},breakStealth:()=>{},interruptChannel:()=>{},
    consumeWeaponEnchantment:()=>null,weaponEnchantment:()=>null,
    linkedGuardian:()=>null,apply:()=>({applied:true})};
  const UnitAnimationEngine={emitAction:()=>{},emitResolvedHit:()=>{},emitOutcome:()=>{},
    emitHit:()=>{},emitPresentation:(type,data)=>presentation.push({type,...data})};
  const mocked={TacticalEngine,BattleEngine,SkillDatabase,EquipmentDatabase,EffectEngine,
    UnitRuntimeEngine:runtime,UnitAnimationEngine,
    ColinShieldMobilityEngine:{shieldOccupied:()=>false},WeaponMaterialEngine:{},
    CombatContactRules:{isPureMagic:()=>true},PostEngagementEngine:null,
    chooseAutonomousBattleReaction:()=>null};
  const globalThis={...mocked};
  const stripped=battleSource.replace(/^import .*;\s*$/gm,'')
    .replace(/^export function /gm,'function ').replace(/^export const /gm,'const ');
  const BattleResolution=Function('globalThis',...Object.keys(mocked),
    `${stripped}\nreturn BattleResolution;`)(globalThis,...Object.values(mocked));
  const hooks={canUseSkill:(u,s)=>u.mana>=Number(s.manaCost||0),
    consumeSkill:(u,s)=>{const cost=Number(s.manaCost||0);u.mana-=cost;return {cost,resources:{}}},
    onDefeated:()=>{},onAction:()=>{},onPostEffect:()=>{}};
  return {hero,enemy,presentation,BattleResolution,hooks,runtime,TacticalEngine,EffectEngine,globalThis};
}

test('regular Moonfire primary hit: 16 MP pays once and exactly 12 astral is credited',()=>{
  const f=fixture();
  const r=f.BattleResolution.resolve({map:{},units:[f.hero,f.enemy],initiator:f.hero,
    target:f.enemy,skill:SKILLS.avreshi_moonfire,actions:[]},f.hooks);
  assert.ok(r.results.some(e=>e.skill.id==='avreshi_moonfire'&&e.result.hit===true));
  assert.equal(f.hero.mana,80);assert.equal(f.hero.resources.astralPower.value,12);
  assert.equal(f.presentation.filter(e=>e.type==='RESOURCE_GAINED').length,1);
});

test('Moonfire used as counterattack ALSO gains astral after paying MP',()=>{
  const f=fixture();
  const r=f.BattleResolution.resolve({map:{},units:[f.hero,f.enemy],initiator:f.enemy,
    target:f.hero,skill:slash,actions:[],reaction:{type:'COUNTER',skill:SKILLS.avreshi_moonfire}},f.hooks);
  assert.ok(r.results.some(e=>e.role==='COUNTER'&&e.skill.id==='avreshi_moonfire'&&e.result.hit));
  assert.equal(f.hero.mana,80);assert.equal(f.hero.resources.astralPower.value,12);
  assert.equal(f.presentation.filter(e=>e.type==='RESOURCE_GAINED').length,1);
});

test('multi-contact Moonfire credited only once for its single committed cast',()=>{
  const f=fixture();
  const r=f.BattleResolution.resolve({map:{},units:[f.hero,f.enemy],initiator:f.hero,
    target:f.enemy,skill:{...SKILLS.avreshi_moonfire,hitCount:3},actions:[]},f.hooks);
  assert.equal(r.results.filter(e=>e.skill.id==='avreshi_moonfire').length,3);
  assert.equal(f.hero.mana,80);assert.equal(f.hero.resources.astralPower.value,12);
  assert.equal(f.presentation.filter(e=>e.type==='RESOURCE_GAINED').length,1);
});

test('miss spends Moonfire MP but grants zero astral',()=>{
  const f=fixture({hit:false});
  f.BattleResolution.resolve({map:{},units:[f.hero,f.enemy],initiator:f.hero,
    target:f.enemy,skill:SKILLS.avreshi_moonfire,actions:[]},f.hooks);
  assert.equal(f.hero.mana,80);assert.equal(f.hero.resources.astralPower.value,0);
});

test('Moonfire against enemy Core gains astral using actual core HP loss',()=>{
  const f=fixture();
  const first=controllerSource.indexOf('    function resolveDirectTargetAttack(unit,target,skill){');
  const end=controllerSource.indexOf('    // LINE + moveToTarget',first);
  assert.ok(first>=0&&end>first);
  const source=controllerSource.slice(first,end);
  const core={owner:'ENEMY',hp:600,defense:30};
  const target={id:'enemy-core',kind:'CORE',alive:true,x:3,y:2,core};
  const logs=[];
  const ctx={effectiveSkill:(_u,s)=>s,consumeSkill:f.hooks.consumeSkill,
    damageCore:(_owner,amount)=>{core.hp=Math.max(0,core.hp-amount)},
    pushLog:(message)=>logs.push(String(message)),setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setMode:()=>{},maybeAutoEndPlayerTurn:()=>false,render:()=>{}};
  const runtime={...f.runtime};
  const EffectEngine={...f.EffectEngine,interruptChannel:()=>{}};
  const exec=Function('ctx','state','skillFailure','UnitRuntimeEngine','EffectEngine',
    'TacticalEngine','globalThis','commitPendingMove','resolveEnchantmentImpact',
    `${source}\nreturn resolveDirectTargetAttack;`)(ctx,()=>({map:{},environmentState:null}),
    ()=>false,runtime,EffectEngine,f.TacticalEngine,f.globalThis,()=>{},()=>{});
  assert.equal(exec(f.hero,target,SKILLS.avreshi_moonfire),true);
  assert.ok(core.hp<600);assert.equal(f.hero.mana,80);
  assert.equal(f.hero.resources.astralPower.value,12);
  assert.equal(f.presentation.filter(e=>e.type==='RESOURCE_GAINED').length,1);
});

test('two separate Moonfire casts in one engagement each earn their own single credit',()=>{
  const f=fixture();
  f.enemy.character.resourceRules={mana:true,astralPower:{}};
  f.enemy.character.skills=['avreshi_moonfire'];
  const r=f.BattleResolution.resolve({map:{},units:[f.hero,f.enemy],initiator:f.hero,
    target:f.enemy,skill:SKILLS.avreshi_moonfire,actions:[],
    reaction:{type:'COUNTER',skill:SKILLS.avreshi_moonfire}},f.hooks);
  assert.equal(r.results.filter(e=>e.skill.id==='avreshi_moonfire'&&e.result.hit).length,2);
  assert.equal(f.hero.resources.astralPower.value,12);
  assert.equal(f.enemy.resources.astralPower.value,12);
  assert.equal(f.presentation.filter(e=>e.type==='RESOURCE_GAINED').length,2);
});

test('zero actual Core HP loss never yields free astral charge',()=>{
  const f=fixture(),core={owner:'ENEMY',hp:0,defense:30};
  const target={id:'enemy-core',kind:'CORE',alive:true,x:3,y:2,core};
  const first=controllerSource.indexOf('    function resolveDirectTargetAttack(unit,target,skill){');
  const end=controllerSource.indexOf('    // LINE + moveToTarget',first);
  const source=controllerSource.slice(first,end);
  const ctx={effectiveSkill:(_u,s)=>s,consumeSkill:f.hooks.consumeSkill,
    damageCore:(_owner,amount)=>{core.hp=Math.max(0,core.hp-amount)},
    pushLog:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setMode:()=>{},maybeAutoEndPlayerTurn:()=>false,render:()=>{}};
  const exec=Function('ctx','state','skillFailure','UnitRuntimeEngine','EffectEngine',
    'TacticalEngine','globalThis','commitPendingMove','resolveEnchantmentImpact',
    `${source}\nreturn resolveDirectTargetAttack;`)(ctx,()=>({map:{},environmentState:null}),
    ()=>false,f.runtime,f.EffectEngine,f.TacticalEngine,f.globalThis,()=>{},()=>{});
  assert.equal(exec(f.hero,target,SKILLS.avreshi_moonfire),true);
  assert.equal(f.hero.resources.astralPower.value,0);
});
