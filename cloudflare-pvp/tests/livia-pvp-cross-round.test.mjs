import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LiviaDualityEngine as dual} from '../../js/livia-duality-engine.js';

const tacticalSrc=readFileSync(new URL('../src/pvp-headless-tactical.mjs',import.meta.url),'utf8');
const originalTurns=readFileSync(new URL('../src/pvp-headless-turns.mjs',import.meta.url),'utf8');
const makeHarness=()=>{
  const stages=[];
  const source=originalTurns.replace(/^import\s.*;\s*$/gm,'').replace('export function advanceCanonicalRound','function advanceCanonicalRound');
  const stubs={
    beginPlayerRoundSequence:(sequence)=>{
      stages.push('advance');sequence.advanceRound();
      stages.push('reset');sequence.resetActions();
      stages.push('card');sequence.beginCardPhase();
    },
    CardPhaseEngine:{resolveTurnEndEffects(){},begin(){}},
    StageDatabase:{get:()=>({cardRules:{handSize:5}})},
    EnvironmentEngine:{tick(){}},
    PvpCommandError:class extends Error{},
    createCanonicalEnvironmentController:()=>({}),
    createCanonicalAreaFields:()=>({}),
    createCanonicalPerception:()=>({})
  };
  const keys=Object.keys(stubs);
  const fn=Function(...keys,source+'\nreturn advanceCanonicalRound;')(...Object.values(stubs));
  return {fn,stages};
};
const setup=(gauge=100)=>{
  const unit={id:'L',team:'N',alive:true,acted:true,moved:true,waited:true,
    character:{id:'livia'},participatesInTurn:false,
    resources:{duality:{value:gauge,max:100,label:'雙極'}},
    _liviaRound:4,_liviaCorruptionRounds:0,_liviaHoldUntil:0,
    _liviaBerserkEndRound:4,_liviaBerserkCheckedRound:4,
    _liviaOriginalTeam:'P',_liviaOriginalParticipation:true,_liviaBerserkActionDone:true};
  const map={tiles:[],manaWells:[],spatialDistortions:[]};
  const game={round:4,phase:'ENEMY_TACTICAL_PHASE',activeSeat:1,pendingAttack:null,
    units:[unit],battlefield:{map},cards:[{},{}],stageId:'test',environmentState:{}};
  const engine={random:()=>.5,unitRuntime:{resetActions(units,team){
    for(const u of units)if(u.team===team){u.acted=false;u.waited=false;u.moved=false;}
  }},effect:{syncConditionalPassives(){}}};
  const callbacks={pushLog(){},stageEvent(){}};
  const start={onRoundStart:round=>dual.onRoundStart({map,units:game.units,round,random:()=>.5})};
  return{game,engine,callbacks,unit,start};
};

test('PVP 失控可以合法跨回合，紫色依資源遞減、不會被強制還原',()=>{
  const w=setup();const h=makeHarness();
  const result=h.fn(w.game,w.engine,w.callbacks,()=>false,w.start);
  assert.equal(result.accepted,true);
  assert.equal(w.game.round,5);
  assert.equal(w.unit.team,'N');
  assert.equal(w.unit.resources.duality.value,90);
  assert.equal(w.unit._liviaBerserkActionDone,undefined);
  assert.deepEqual(h.stages,['advance','reset','card']);
});

test('PVP 回藍達中央時在重置玩家行動前恢復陣營，該回合可正常操控',()=>{
  const w=setup(60);const h=makeHarness();
  h.fn(w.game,w.engine,w.callbacks,()=>false,w.start);
  assert.equal(w.unit.team,'P');
  assert.equal(w.unit.resources.duality.value,50);
  assert.equal(w.unit.acted,false);
  assert.equal(w.unit.waited,false);
  assert.equal(w.unit.moved,false);
});

test('PVP 不能藉失控例外讓普通中立單位跳過回合協調',()=>{
  const w=setup();w.unit.character.id='monster';const h=makeHarness();
  assert.throws(()=>h.fn(w.game,w.engine,w.callbacks,()=>false,w.start),/UNSUPPORTED_CROSS_ROUND_MECHANIC/);
});

test('PVP 主程式仍在每輪結束時安排暴走行動，並把 onRoundStart 交由回合協調層',()=>{
  assert.match(tacticalSrc,/u\._liviaBerserkEndRound&&u\._liviaBerserkEndRound<=game\.round/);
  assert.match(tacticalSrc,/advanceCanonicalRound\(game,engine,hooks,/);
  assert.match(tacticalSrc,/onRoundStart:round=>LiviaDualityEngine\.onRoundStart/);
  assert.doesNotMatch(tacticalSrc,/LiviaDualityEngine\.completeBerserk\(u\)/);
});
