import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {BattleResolution} from '../../js/battle-resolution.js';
const tr={passives:['FOREST_SOUL_RESONANCE'],resourceRules:{forestSoul:{label:'森靈之魂',max:30,initial:0},mana:true},weapons:{elven_bow:{kind:'WEAPON',weaponKind:'BOW',attackType:'SHOT'}},attributes:{int:20,wil:20},combat:{hp:225,matk:88,atk:98}};
let actor={id:'p1',alive:true,team:'P',x:2,y:2,character:{...tr,id:'ophi'},resources:{forestSoul:{value:30,max:30,label:'森靈之魂'}},mana:120};
let target={id:'e1',alive:true,team:'E',x:3,y:2,character:{id:'enemy',combat:{hp:200,def:30,mdef:30},passives:[],weapons:{}},hp:200};
const map={tiles:Array.from({length:36},(_,i)=>({x:i%6,y:Math.floor(i/6),terrain:'PLAIN',elevation:0}))};
let hitCount=0,attackEvents=0,hookEntries=[];
globalThis.TacticalEngine={
 ensureFacing:u=>u.facing||'N',faceToward:()=>{},
 resolve:(m,a,d,s)=>({result:{hit:++hitCount!==2,damage:12,weaponDamage:12,type:'SHOT',el:'NONE',crit:hitCount===3,hc:85,cc:10,graze:false},defense:null,terrain:{acc:0,eva:0}}),
 tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
 canActiveMove:(m,us,u,x,y)=>!!m.tiles.find(t=>t.x===x&&t.y===y)&&!us.some(t=>t.alive&&t!==u&&t.x===x&&t.y===y)
};
globalThis.BattleEngine={actionSpeed:()=>0,attackClass:()=> 'RANGED',critChance:()=>0,
 elementalEnchantmentDamage:({matk,bonusPower,element})=>element==='NATURE'?Math.round(matk*bonusPower):0};
globalThis.EquipmentDatabase={defenseProfiles:()=>[]};
globalThis.EffectEngine={applyDamage:(u,n)=>{const amount=Math.max(0,Math.min(u.hp,n));u.hp-=amount;return{hpLoss:amount,absorbed:0}},
 breakStealth:()=>{},consumeWeaponEnchantment:()=>null,interruptChannel:()=>{},markVengeance:()=>{},vengeanceMultiplier:()=>1};
globalThis.UnitAnimationEngine={emitAction:()=>{attackEvents++;return{}},emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{}};
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;
globalThis.VerticalMobilityEngine={syncUnit:(u,t)=>{u.z=t.elevation}};
assert.equal(globalThis.SKILLS.ophi_multishot,undefined,'obsolete Multi-shot is not registered');
assert.equal(SkillDatabase.get('ophi_backstep_shot').evasiveCounter,true,'backstep shot is a true evade-counter');
const hitSkill=SkillDatabase.get('ophi_triple_shot');
const combat=BattleResolution.resolve({map,units:[actor,target],initiator:actor,target,skill:hitSkill,actions:[]},{
 canUseSkill:()=>true,consumeSkill:(a,s)=>UnitRuntimeEngine.consumeSkill(a,s),onAction:e=>hookEntries.push(e),onDefeated:()=>{}
});
assert.equal(hitCount,3,'every arrow has independent hit and critical roll');
assert.equal(combat.results.length,3,'one action with three hit results');
assert.equal(hookEntries.length,3);
assert.equal(attackEvents,1,'only one attack animation/event');
assert.equal(combat.results[1].result.hit,false,'second arrow can miss independently');
assert.equal(combat.results[0].result.magicHpDamage,40,'full soul nature bonus independent of physical');
assert.equal(target.hp,200-(12+40)*2);
assert.equal(actor.resources.forestSoul.value,30,'triple-shot must not drain souls');
// Backshot sends one attack, then physically relocates once to an empty legal tile.
actor.x=2;actor.y=2;target.x=3;target.y=2;target.hp=200;target.alive=true;hitCount=10;hookEntries=[];
let entered=0;
const back=BattleResolution.resolve({map,units:[actor,target],initiator:actor,target,skill:SkillDatabase.get('ophi_backstep_shot'),actions:[]},{
 canUseSkill:()=>true,consumeSkill:(a,s)=>UnitRuntimeEngine.consumeSkill(a,s),onAction:e=>hookEntries.push(e),onDefeated:()=>{},
 onBackstep:()=>{entered++}
});
assert.equal(back.results.length,1);
assert.equal(actor.x,1);
assert.equal(actor.y,2);
assert.equal(entered,1);
console.log('Ophi 3 independent attacks and backstep: all assertions passed');
