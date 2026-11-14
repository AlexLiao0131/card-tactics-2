import test from 'node:test';
import assert from 'node:assert/strict';
import {mechanics as dual,control,state} from './shared-mechanics-fixture.mjs';

const world=(team='P')=>{
  const unit={id:'livia01',alive:true,team,participatesInTurn:true,
    character:{id:'livia',name:'莉維亞',skills:[]},
    resources:{duality:{label:'雙極',value:100,max:100}},
    resourceMechanicStates:{duality:{round:3,fullRounds:1,holdUntil:4,processedRound:0}},
    acted:false,moved:false,waited:false};
  return {unit,units:[unit],map:{tiles:[],manaWells:[],spatialDistortions:[]}};
};
const tick=(w,round)=>dual.onRoundStart({...w,round,random:()=>0});

test('失控開啟不直接清零或跳回中央',()=>{
  const w=world();const result=tick(w,4);
  assert.deepEqual(result.berserk,['livia01']);
  assert.equal(w.unit.team,'N');
  assert.equal(w.unit.resources.duality.value,100);
  assert.equal(dual.status(w.unit).berserk,true);
  assert.equal(w.unit.controlOverride?.startedRound,4);
  assert.equal(dual.completeBerserk(w.unit),false);
  assert.equal(w.unit.participatesInTurn,false);
});

test('每回合藍色實際覆蓋 10，直到中央才恢復操控，並且每輪重設中立行動',()=>{
  const w=world();tick(w,4);
  for(const [round,value] of [[5,90],[6,80],[7,70],[8,60]]){
    w.unit.controlOverride.actionDoneRound=round-1;
    tick(w,round);
    assert.equal(w.unit.resources.duality.value,value);
    assert.equal(w.unit.team,'N');
    assert.equal(dual.status(w.unit).berserk,true);
    assert.notEqual(w.unit.controlOverride?.actionDoneRound,round);
    assert.equal(dual.status(w.unit).recoveryRemaining,value-50);
  }
  w.unit.controlOverride.actionDoneRound=8;
  tick(w,9);
  assert.equal(w.unit.resources.duality.value,50);
  assert.equal(w.unit.team,'P');
  assert.equal(w.unit.participatesInTurn,true);
  assert.equal(dual.status(w.unit).berserk,false);
  assert.equal(w.unit.controlOverride?.startedRound,undefined);
  assert.equal(w.unit.controlOverride,undefined);
});

test('高維技能造成的既有恢復停頓仍適用，延後恢復但不固定失控一回合',()=>{
  const w=world();state(dual,w.unit).holdUntil=6;
  tick(w,4);
  tick(w,5);assert.equal(w.unit.resources.duality.value,100);
  tick(w,6);assert.equal(w.unit.resources.duality.value,100);
  tick(w,7);assert.equal(w.unit.resources.duality.value,90);
  for(let round=8;round<=11;round++)tick(w,round);
  assert.equal(w.unit.team,'P');assert.equal(w.unit.resources.duality.value,50);
});

test('被污染的敵軍莉維亞應回到原敵軍，而非轉為玩家友軍',()=>{
  const w=world('E');tick(w,4);
  for(let round=5;round<=9;round++)tick(w,round);
  assert.equal(w.unit.team,'E');assert.equal(dual.status(w.unit).berserk,false);
});

test('失控期間不強制結束，直到實際藍紫達到中央',()=>{
  const w=world();tick(w,4);
  dual.setPolarity(w.unit,51);
  assert.equal(dual.completeBerserk(w.unit),false);
  assert.equal(w.unit.team,'N');
  tick(w,5);
  assert.equal(w.unit.resources.duality.value,41);
  assert.equal(w.unit.team,'P');
  assert.equal(dual.status(w.unit).berserk,false);
});

test('普通未失控莉維亞仍按原規則自然回藍',()=>{
  const w=world();state(dual,w.unit).fullRounds=0;state(dual,w.unit).holdUntil=0;
  dual.setPolarity(w.unit,80);
  tick(w,4);assert.equal(w.unit.resources.duality.value,70);
  assert.equal(w.unit.team,'P');assert.equal(dual.status(w.unit).berserk,false);
});

test('同回合多次輪轉檢查不會加速回藍或讓中立行動重做',()=>{
  const w=world();tick(w,4);tick(w,5);
  assert.equal(w.unit.resources.duality.value,90);
  w.unit.controlOverride.actionDoneRound=5;
  tick(w,5);
  assert.equal(w.unit.resources.duality.value,90);
  assert.equal(w.unit.controlOverride?.actionDoneRound,5);
});

test('暴走 AI 自行使用幽冥斬擊不能刷新紫色停頓造成無限失控',()=>{
  const w=world();tick(w,4);tick(w,5);
  const before=state(dual,w.unit).holdUntil;
  dual.afterCommittedSkill(w.unit,{id:'nether_slash'});
  assert.equal(state(dual,w.unit).holdUntil,before);
  assert.equal(w.unit.resources.duality.value,90);
  for(let round=6;round<=9;round++)tick(w,round);
  assert.equal(w.unit.team,'P');
});
