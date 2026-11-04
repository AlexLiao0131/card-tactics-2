import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpTacticalUI} from '../../js/pvp-tactical-ui.js';

// Standalone shared CardHandUI adapter calls the SAME card-phase API as
// every battle; the server only receives official card IDs and tile targets.
test('native online card choice is server-bound and cannot mutate a local hand',()=>{
  const orders=[];
  const ui={seat:0,match:{view:{phase:'PLAYER_CARD_PHASE',activeSeat:0,own:{hand:[
      {id:'imperial_swordsman_card'},{id:'fog_card'},{id:'starfall_card'}]}}},
    isCardPhase:()=>true,myTurn:()=>true,isConnected:()=>true,
    update(){},request(action){orders.push(action);return true;}};
  assert.equal(PvpTacticalUI.prototype.chooseCard.call(ui,'imperial_swordsman_card'),'TARGET');
  assert.deepEqual(ui.target,{cardId:'imperial_swordsman_card'});
  assert.equal(PvpTacticalUI.prototype.chooseCard.call(ui,'fog_card'),'SENT');
  assert.deepEqual(orders,[{type:'PLAY_INSTANT_CARD',cardId:'fog_card'}]);
  assert.equal(PvpTacticalUI.prototype.chooseCard.call(ui,'starfall_card'),'TARGET');
  assert.deepEqual(ui.target,{cardId:'starfall_card'});
  assert.equal(PvpTacticalUI.prototype.chooseCard.call(ui,'unknown'),false);
  assert.deepEqual(ui.match.view.own.hand,[
    {id:'imperial_swordsman_card'},{id:'fog_card'},{id:'starfall_card'}]);
});

test('remote online hand cannot issue card actions for the other seat',()=>{
  const ui={seat:0,match:{view:{phase:'PLAYER_CARD_PHASE',activeSeat:1,own:{hand:[
    {id:'imperial_swordsman_card'}]}}},isCardPhase:()=>true,myTurn:()=>false,isConnected:()=>true};
  assert.equal(PvpTacticalUI.prototype.chooseCard.call(ui,'imperial_swordsman_card'),false);
});
