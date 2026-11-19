import test from 'node:test';
import assert from 'node:assert/strict';
import {tickRoundStatusEffects,beginPlayerRoundSequence} from '../../js/battle-round-sequence.js';
function fixture(hp=8){
 const attacker={id:'source',team:'P',alive:true,hp:100,effects:[]};
 const target={id:'victim',team:'E',alive:true,hp,effects:[
  {type:'DAMAGE_OVER_TIME',id:'BLEEDING',name:'流血',sourceUnitId:'source',amount:12,remaining:1}]};
 let finalized=[];
 const engine={tick(u){const fx=[...(u.effects||[])],events=[];for(const e of fx){
  if(e.type!=='DAMAGE_OVER_TIME')continue;
  const actual=Math.min(u.hp,Number(e.amount));u.hp-=actual;if(u.hp<=0)u.alive=false;
  events.push({type:e.type,effectId:e.id,amount:actual});
 }u.effects=[];return events;}};
 return{attacker,target,units:[attacker,target],engine,finalized,
  onDefeated:(unit,source,cause)=>finalized.push({id:unit.id,source:source?.id,cause:cause?.id})};
}
test('bleeding lethal DOT calls one canonical defeat cleanup after effect expires',()=>{
 const f=fixture();
 const dead=tickRoundStatusEffects({units:f.units,effectEngine:f.engine,onDefeated:f.onDefeated});
 assert.deepEqual(dead,['victim']);
 assert.deepEqual(f.finalized,[{id:'victim',source:'source',cause:'BLEEDING'}]);
 assert.equal(f.target.alive,false);
 tickRoundStatusEffects({units:f.units,effectEngine:f.engine,onDefeated:f.onDefeated});
 assert.equal(f.finalized.length,1);
});
test('nonlethal bleeding does not create defeat or change HP twice',()=>{
 const f=fixture(60);
 assert.deepEqual(tickRoundStatusEffects({units:f.units,effectEngine:f.engine,onDefeated:f.onDefeated}),[]);
 assert.equal(f.target.hp,48);assert.equal(f.target.alive,true);
 assert.equal(f.finalized.length,0);
});
test('round sequencing continues after fatal bleed in manual-objective BattleTest',()=>{
 const f=fixture();let round=5,phase='E',cardBegin=0;
 beginPlayerRoundSequence({
  endEnemyPerception:()=>{},checkMatchEnd:()=>false,
  advanceRound:()=>{round++;phase='P';},expireSmoke:()=>{},resetActions:()=>{},
  clearInput:()=>{},logRoundStart:()=>{},environmentAvailable:()=>false,
  applyEnvironmentHazards:()=>{},tickEffects:()=>tickRoundStatusEffects({units:f.units,effectEngine:f.engine,onDefeated:f.onDefeated}),
  tickSanctuaries:()=>{},stageRoundStart:()=>{},tickEnvironment:()=>{},
  resolveWeatherEvents:()=>{},beginPlayerPerception:()=>{},beginCardPhase:()=>{cardBegin++;}
 });
 assert.equal(round,6);assert.equal(phase,'P');assert.equal(cardBegin,1);
 assert.equal(f.finalized.length,1);
});
test('multiple different DOT sources finalize each defeated unit once',()=>{
 const f=fixture();const other={id:'other',team:'E',alive:true,hp:4,effects:[{type:'DAMAGE_OVER_TIME',id:'POISON',sourceUnitId:'source',amount:6,remaining:1}]};
 f.units.push(other);
 const dead=tickRoundStatusEffects({units:f.units,effectEngine:f.engine,onDefeated:f.onDefeated});
 assert.deepEqual(dead,['victim','other']);
 assert.equal(f.finalized.length,2);
});
