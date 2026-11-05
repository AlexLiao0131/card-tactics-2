import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BattleCommandMenuUI,battleItemMenuEntries} from '../../js/battle-command-menu-ui.js';
import {CardDatabase} from '../../js/card-database.js';
import '../../js/card-phase-controller.js';
import '../../js/battle-log.js';
import {BattleUI} from '../../js/battle-ui.js';
import {beginPlayerRoundSequence} from '../../js/battle-round-sequence.js';

const read=file=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
test('PvP card type is classified by EXACT original CardPhaseController',()=>{
  for(const id of ['fog_card','thunderstorm_card','starfall_card','wildfire_card','miracle_card']){
    const card=CardDatabase.get(id);
    assert.ok(card);
    const kind=globalThis.CardPhaseController.commandKind(card);
    assert.ok(kind==='INSTANT'||kind==='TARGETED');
  }
  assert.equal(globalThis.CardPhaseController.commandKind(CardDatabase.get('imperial_swordsman_card')),null);
  const pvp=read('js/pvp-tactical-ui.js');
  assert.match(pvp,/CardPhaseController\?\.commandKind/);
  assert.doesNotMatch(pvp,/TARGET_SPELLS|INSTANT_SPELLS/);
});
test('original item menu and online item menu share the same authored two-level model',()=>{
  const items=[{payloadId:'a',name:'藥水',usable:true}];
  const ground=[{groundId:'b',name:'火把',usable:true}];
  const allies=[{unitId:'ally',name:'友軍'}];
  const base={items,ground,allies,interactionAvailable:true};
  assert.deepEqual(battleItemMenuEntries({...base,mode:'item-menu'}).map(x=>x.label),
    ['使用｜藥水','拾取｜火把','放下／轉交']);
  assert.deepEqual(battleItemMenuEntries({...base,mode:'item-manage'}).map(x=>x.label),
    ['放下｜藥水','交給 友軍｜藥水']);
  assert.equal(battleItemMenuEntries({...base,interactionAvailable:false})[2].disabled,true);
  assert.match(read('js/tactical-game.js'),/battleItemMenuEntries\(/);
  assert.match(read('js/pvp-tactical-ui.js'),/battleItemMenuEntries\(/);
});
test('original and online reactions use the ONE engagement DOM presenter',()=>{
  assert.equal(typeof BattleCommandMenuUI.prototype.renderEngagementModel,'function');
  assert.match(read('js/battle-ui.js'),/presenter\.renderEngagementModel\(model/);
  assert.match(read('js/pvp-tactical-ui.js'),/this\.menuUI\.renderEngagementModel\(model/);
});
test('the original battle log presents server-authorized entries, not an always-empty list',()=>{
  const previous=globalThis.document;
  globalThis.document={body:{dataset:{battleMode:'PVP'}}};
  const panel={innerHTML:'',scrollTop:0,scrollHeight:40};
  const screen={classList:{contains:key=>key==='active'}};
  const ui={onlineLogTab:'BATTLE',onlineLogEntries:[
    {type:'BATTLE',text:'我方角色 使用斬擊'},
    {type:'SYSTEM',text:'回合開始'}],
    logShell:screen,logPanel:panel,logTabs:{querySelectorAll:()=>[]},
    logRenderedTail:null,logRenderedLength:-1,logRenderedTab:null};
  try{
    BattleUI.prototype.renderLog.call(ui);
    assert.match(panel.innerHTML,/我方角色 使用斬擊/);
    assert.doesNotMatch(panel.innerHTML,/回合開始/);
    ui.onlineLogTab='SYSTEM';BattleUI.prototype.renderLog.call(ui);
    assert.match(panel.innerHTML,/回合開始/);
    assert.doesNotMatch(panel.innerHTML,/使用斬擊/);
  }finally{globalThis.document=previous;}
});
test('same round coordinator preserves environment-before-DOT, stage and card order',()=>{
  const order=[],c={};
  for(const name of ['endEnemyPerception','advanceRound','expireSmoke','resetActions','clearInput',
    'logRoundStart','applyEnvironmentHazards','tickEffects','tickSanctuaries','stageRoundStart',
    'tickEnvironment','resolveWeatherEvents','beginPlayerPerception','beginCardPhase'])
    c[name]=()=>order.push(name);
  c.checkMatchEnd=()=>false;c.environmentAvailable=()=>true;
  assert.equal(beginPlayerRoundSequence(c),true);
  assert.deepEqual(order,[ 'endEnemyPerception','advanceRound','expireSmoke','resetActions',
    'clearInput','logRoundStart','applyEnvironmentHazards','tickEffects','tickSanctuaries',
    'stageRoundStart','tickEnvironment','resolveWeatherEvents','beginPlayerPerception','beginCardPhase']);
  assert.match(read('js/tactical-game.js'),/beginPlayerRoundSequence\(/);
  assert.match(read('cloudflare-pvp/src/pvp-headless-turns.mjs'),/beginPlayerRoundSequence\(/);
});
test('round start immediately stops on a canonical victory condition',()=>{
  const order=[];const calls={};
  for(const name of ['endEnemyPerception','advanceRound','expireSmoke','resetActions','clearInput',
    'logRoundStart','applyEnvironmentHazards','tickEffects','tickSanctuaries','stageRoundStart',
    'tickEnvironment','resolveWeatherEvents','beginPlayerPerception','beginCardPhase'])
    calls[name]=()=>order.push(name);
  calls.checkMatchEnd=()=>true;calls.environmentAvailable=()=>true;
  assert.equal(beginPlayerRoundSequence(calls),false);
  assert.deepEqual(order,['endEnemyPerception']);
});
test('server battle log never publishes an unfiltered global event stream',()=>{
  const src=read('cloudflare-pvp/src/pvp-headless-tactical.mjs');
  assert.match(src,/seat:game\.activeSeat/);
  assert.match(src,/e\?\.seat===seat/);
  assert.match(src,/hiddenNames\.some\(name=>e\.text\.includes\(name\)\)/);
  assert.doesNotMatch(read('js/battle-ui.js'),/\?\{active:'BATTLE',entries:\[\]\}/);
});
