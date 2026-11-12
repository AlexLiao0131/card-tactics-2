import assert from 'node:assert/strict';
import {BattleResolution} from '../../js/battle-resolution.js';
import {SkillDatabase} from '../../js/skill-database.js';

const tiles=Array.from({length:100},(_,i)=>({x:i%10,y:Math.floor(i/10),terrain:'PLAIN',elevation:0}));
const map={tiles};
let moves=[],entrances=0,spent=0;
const get=(x,y)=>map.tiles.find(t=>t.x===x&&t.y===y);
let participants=[];
globalThis.TacticalEngine={
  ensureFacing:u=>u.facing||(u.facing='N'), faceToward:()=>{},
  canTarget:()=>true, tile:(m,x,y)=>get(x,y),
  canOccupyTerrain:()=>true,isBlockedByObject:()=>false,
  pathTo:(m,us,u,x,y)=>get(x,y)&&Math.abs(x-u.x)+Math.abs(y-u.y)<=u.character.combat.move&&
   !us.some(v=>v.alive&&v.id!==u.id&&v.x===x&&v.y===y)?[get(x,y)]:[],
  canActiveMove:(m,us,u,x,y)=>!!get(x,y)&&!us.some(v=>v.alive&&v.id!==u.id&&v.x===x&&v.y===y),
  resolve:(m,a,d,s)=>({result:{hit:true,damage:8,weaponDamage:8,type:s.attackType,crit:false,el:'NONE',hc:90,cc:0},terrain:{}})
};
globalThis.BattleEngine={actionSpeed:(c,s)=>s?.id==='trigger'?5:0,attackClass:()=> 'MELEE',critChance:()=>0,elementalEnchantmentDamage:()=>0};
globalThis.EquipmentDatabase={defenseProfiles:()=>[]};
globalThis.EffectEngine={applyDamage:(u,n)=>{const amount=Math.min(u.hp,n);u.hp-=amount;return{hpLoss:amount,absorbed:0}},apply:()=>({applied:true}),breakStealth:()=>{},consumeWeaponEnchantment:()=>null,interruptChannel:()=>{},markVengeance:()=>{},vengeanceMultiplier:()=>1};
globalThis.UnitAnimationEngine={emitAction:()=>({}),emitResolvedHit:()=>{},emitHit:()=>{},emitOutcome:()=>{},emitMove:(unit,details)=>moves.push({unit:unit.id,...details})};
globalThis.VerticalMobilityEngine={syncUnit:(u,t)=>{u.z=t.elevation||0}};
const basic={id:'trigger',weapon:'sword',name:'trigger',attackType:'SLASH',power:1,target:'ENEMY',range:{min:1,max:5}};
function make(id,x,y,facing='N',heroId='other'){
  return{id,alive:true,team:id==='a'?'E':'P',x,y,z:0,facing,hp:1000,
  character:{id:heroId,combat:{hp:1000,move:5,atk:100,matk:100},weapons:{sword:{weaponKind:'SWORD'},rapier:{weaponKind:'RAPIER'},elven_bow:{weaponKind:'BOW'}},passives:[],skills:[]}};
}
function react(counter,defender,attacker,extra=[]){
  spent=0;moves=[];entrances=0;participants=[attacker,defender,...extra];
  const result=BattleResolution.resolve({map,units:participants,initiator:attacker,target:defender,skill:basic,
    actions:[],reaction:{type:'COUNTER',skill:counter}},{
    canUseSkill:()=>true,consumeSkill:()=>{spent++;return {cost:0,resources:{}}},
    onAction:()=>{},onDefeated:()=>{},onBackstep:()=>{entrances++}
  });
  return result;
}
{
  const attacker=make('a',4,3,'N'),defender=make('b',4,5,'S','ophi');
  const result=react(SkillDatabase.get('ophi_backstep_shot'),defender,attacker);
  assert.equal(result.results.some(e=>e.role==='COUNTER'),true);
  assert.deepEqual([defender.x,defender.y],[4,6]);
  assert.equal(moves.filter(m=>m.unit==='b'&&m.kind==='BACKSTEP').length,1);
  assert.equal(entrances,1);
}
{
  const attacker=make('a',4,3,'N'),defender=make('b',4,6,'S','church_templar_hero');
  const result=react(SkillDatabase.get('templar_charge'),defender,attacker);
  assert.equal(result.results.some(e=>e.role==='COUNTER'),true);
  assert.equal(Math.abs(defender.x-attacker.x)+Math.abs(defender.y-attacker.y),1);
  assert.equal(moves.some(m=>m.kind==='CHARGE'),true);
  assert.equal(entrances,1);
}
{
  const attacker=make('a',4,3,'N'),defender=make('b',4,6,'S','seraphina');
  const result=react(SkillDatabase.get('seraphina_blood_drain'),defender,attacker);
  assert.equal(result.results.some(e=>e.role==='COUNTER'),true);
  assert.deepEqual([defender.x,defender.y],[4,4], 'teleport behind N-facing attacker');
  assert.equal(moves.filter(m=>m.kind==='TELEPORT').length,1);
  assert.equal(entrances,1);
}
{
  const attacker=make('a',4,3,'N'),defender=make('b',4,6,'S','seraphina');
  const blocker=make('c',4,4,'S');
  const result=react(SkillDatabase.get('seraphina_blood_drain'),defender,attacker,[blocker]);
  assert.equal(result.results.some(e=>e.role==='COUNTER'),false, 'blocked rear landing rejects counter before cost');
  assert.equal(spent,1, 'only initiator spent a skill');
  assert.deepEqual([defender.x,defender.y],[4,6]);
}
console.log('Counter movement integration: backward shot, charge, blood shadow, blocked teleport passed');
