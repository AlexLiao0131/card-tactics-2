import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
const deck=Array(20).fill('imperial_archer_card');
const make=()=>{
  let game=createOpeningGame({decks:[deck,deck],serverSeed:1111});
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
  game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
  return createAuthoritySession({initialState:game,core:experimentalTacticalCore});
};
const cmd=(id,revision,action)=>({protocol:PVP_COMMAND_PROTOCOL,
  commandId:id,baseRevision:revision,action});
const accept=(session,seat,id,action)=>commitAuthorityCommand({session,seat,
  envelope:cmd(id,session.revision,action),core:experimentalTacticalCore});

test('experimental canonical PvP game passes real authority envelope, private projection, and exactly-once receipts',()=>{
  const initial=make();
  assert.equal(initial.state.phase,'BATTLEFIELD_READY');
  const start=accept(initial,0,'begin_battle_0001',{type:'BEGIN_BATTLE'});
  assert.equal(initial.state.phase,'BATTLEFIELD_READY'); // clone/commit isolation
  assert.equal(start.nextSession.state.phase,'PLAYER_CARD_PHASE');
  assert.equal(start.nextSession.revision,1);
  const repeat=commitAuthorityCommand({session:start.nextSession,seat:0,
    envelope:cmd('begin_battle_0001',0,{type:'BEGIN_BATTLE'}),core:experimentalTacticalCore});
  assert.equal(repeat.duplicate,true);assert.equal(repeat.nextSession.revision,1);
  const view=projectAuthoritySession(start.nextSession,1,experimentalTacticalCore).view;
  assert.equal('hand' in view.opponent,false);assert.equal(view.own.hand.length,5);
  assert.equal(view.opponent.handCount,5);
});

test('deployment, turn ownership and enemy redeploy pass through canonical authority host',()=>{
  let session=make();
  session=accept(session,0,'begin_battle_0002',{type:'BEGIN_BATTLE'}).nextSession;
  const playerBase=session.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  const enemyBase=session.state.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  session=accept(session,0,'deploy_player_0001',{type:'DEPLOY_CARD',cardId:'imperial_archer_card',...playerBase}).nextSession;
  assert.equal(session.state.units.length,1);
  assert.throws(()=>accept(session,1,'forge_move_0001',{type:'END_CARD_PHASE'}),{code:'NOT_YOUR_TURN'});
  session=accept(session,0,'finish_cards_0001',{type:'END_CARD_PHASE'}).nextSession;
  session=accept(session,0,'finish_move_0001',{type:'END_TACTICAL_PHASE'}).nextSession;
  assert.equal(session.state.activeSeat,1);
  session=accept(session,1,'deploy_enemy_0001',{type:'DEPLOY_CARD',cardId:'imperial_archer_card',...enemyBase}).nextSession;
  assert.equal(session.state.units.length,2);
  assert.equal(session.state.units[1].team,'E');
  assert.equal(session.state.cards[0].crystals,1);
  assert.equal(session.state.cards[1].crystals,1);
  assert.throws(()=>accept(session,1,'fake_damage_0001',{type:'DAMAGE',amount:5000}),{code:'FULL_TACTICAL_ACTION_NOT_CONNECTED'});
});
