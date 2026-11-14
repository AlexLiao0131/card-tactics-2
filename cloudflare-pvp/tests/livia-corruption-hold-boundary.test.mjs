import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanics as dual,control,state} from './shared-mechanics-fixture.mjs';

const world=()=>{
  const unit={id:'Livia',alive:true,team:'P',participatesInTurn:true,
    character:{id:'livia',name:'莉維亞'},
    resources:{duality:{label:'雙極',value:90,max:100}},
    resourceMechanicStates:{duality:{round:5,fullRounds:0,holdUntil:0,processedRound:0}},
    acted:false,moved:false,waited:false};
  return {unit,map:{tiles:[],manaWells:[],spatialDistortions:[]}};
};
const tick=(w,round,roll=.99)=>dual.onRoundStart({map:w.map,units:[w.unit],round,random:()=>roll});
const fill=(w)=>{
  dual.afterCommittedSkill(w.unit,{id:'nether_slash'});
  assert.equal(dual.polarity(w.unit),100);
  assert.equal(state(dual,w.unit).holdUntil,6); // commit at round 5; round 6 is the one FULL hold round
};

test('第5回合實際施放達紫滿，第6回合完整鎖定，第7回合開始回藍',()=>{
  const w=world();fill(w);
  tick(w,6);assert.equal(dual.polarity(w.unit),100);
  tick(w,7);assert.equal(dual.polarity(w.unit),90);
  tick(w,8);assert.equal(dual.polarity(w.unit),80);
});

test('第6回合玩家實際再施放高維技能，會刷新下一個完整回合的鎖定',()=>{
  const w=world();fill(w);tick(w,6);
  dual.afterCommittedSkill(w.unit,{id:'shadow_step'});
  assert.equal(state(dual,w.unit).holdUntil,7);
  tick(w,7);assert.equal(dual.polarity(w.unit),100);
  tick(w,8);assert.equal(dual.polarity(w.unit),90);
});

test('開始回藍的回合即使骰到失控，仍不得額外跳過一次回藍',()=>{
  const w=world();fill(w);
  tick(w,6,.99); // hold first; no berserk
  const result=tick(w,7,0); // second corruption round, risk triggers
  assert.deepEqual(result.berserk,['Livia']);
  assert.equal(w.unit.team,'N');
  assert.equal(dual.polarity(w.unit),90);
  tick(w,7,0); // repeated round check must not count again
  assert.equal(dual.polarity(w.unit),90);
  tick(w,8,0);
  assert.equal(dual.polarity(w.unit),80);
});

test('失控如果在鎖定回合觸發，該回合不回藍，下個回合才恢復',()=>{
  const w=world();fill(w);state(dual,w.unit).fullRounds=1;
  const triggered=tick(w,6,0);
  assert.deepEqual(triggered.berserk,['Livia']);
  assert.equal(dual.polarity(w.unit),100);
  tick(w,7,0);assert.equal(dual.polarity(w.unit),90);
});

test('失控中回藍只動一次/回合，回到50才返還原隊伍',()=>{
  const w=world();fill(w);tick(w,6);
  tick(w,7,0);assert.equal(w.unit.team,'N');assert.equal(dual.polarity(w.unit),90);
  for(let round=8;round<=11;round++){
    const expected=90-(round-7)*10;
    tick(w,round);assert.equal(dual.polarity(w.unit),expected);
    if(round<11)assert.equal(w.unit.team,'N');
  }
  assert.equal(w.unit.team,'P');assert.equal(dual.status(w.unit).berserk,false);
});
