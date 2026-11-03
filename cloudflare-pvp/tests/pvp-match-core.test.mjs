import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpeningGame, openingGameCore } from '../src/pvp-match-core.mjs';
import { createAuthoritySession, commitAuthorityCommand, projectAuthoritySession } from '../src/battle-authority.mjs';
import { CardDatabase } from '../../js/card-database.js';
import { DeckEngine } from '../../js/deck-engine.js';
import { CardPhaseEngine } from '../../js/card-phase-engine.js';
import { PVP_COMMAND_PROTOCOL } from '../../shared/pvp-command-contract.mjs';

const a=['livia_card',...Array(19).fill('imperial_swordsman_card')];
const b=['ophi_card',...Array(19).fill('imperial_archer_card')];
const create=seed=>createOpeningGame({decks:[a,b],serverSeed:seed});
const envelope=(id,rev,action)=>({protocol:PVP_COMMAND_PROTOCOL,commandId:id,baseRevision:rev,action});
const commit=(session,seat,id,rev,action)=>commitAuthorityCommand({
  session,seat,envelope:envelope(id,rev,action),core:openingGameCore});

test('canonical stage card rules and real deck/card-phase operations are used',()=>{
  const game=create(12345);
  assert.equal(game.schema,'ct2-pvp-opening-v1');
  assert.deepEqual(game.pendingSeats,[0,1]);
  for (const player of game.cards) {
    assert.equal(player.zones.hand.length,CardPhaseEngine.DEFAULT_HAND_SIZE);
    assert.equal(player.zones.deck.length,DeckEngine.BATTLE_DECK_SIZE-CardPhaseEngine.DEFAULT_HAND_SIZE);
    assert.equal(player.turnsStarted,0);
    assert.equal(player.crystals,0);
    assert.equal(player.active,true);
    assert.equal(player.mulliganDone,false);
    assert.equal(player.zones.hand.every(id=>CardDatabase.get(id)),true);
  }
  assert.equal(openingGameCore.activeSeat(game),0);
});

test('server seed produces deterministic and isolated shuffle; no shared game mutation',()=>{
  assert.deepEqual(create(1234),create(1234));
  assert.notDeepEqual(create(1234).cards[0].zones,create(6789).cards[0].zones);
  const m=create(4321);m.cards[0].zones.hand[0]='sentinel';
  assert.notEqual(create(4321).cards[0].zones.hand[0],'sentinel');
  assert.deepEqual(a,['livia_card',...Array(19).fill('imperial_swordsman_card')]);
});

test('opponent secret IDs and random state are never projected',()=>{
  const game=create(333);
  const projected0=openingGameCore.project(game,0),projected1=openingGameCore.project(game,1);
  assert.equal(projected0.own.hand.length,5);
  assert.equal(projected0.opponent.handCount,5);
  assert.equal(JSON.stringify(projected0).includes('imperial_archer_card'),false);
  assert.equal(JSON.stringify(projected1).includes('imperial_swordsman_card'),false);
  assert.equal(JSON.stringify(projected0).includes('randomState'),false);
  assert.equal(JSON.stringify(projected0).includes('tokenHash'),false);
  assert.equal(JSON.stringify(projected0).includes('rng'),false);
});

test('one opening decision per seat, using official mulligan rule',()=>{
  const initial=createAuthoritySession({initialState:create(2222),core:openingGameCore});
  assert.throws(()=>commit(initial,1,'seatwrong01',0,{type:'KEEP_OPENING_HAND'}),/NOT_YOUR_TURN/);
  const after0=commit(initial,0,'goodkeep001',0,{type:'KEEP_OPENING_HAND'});
  assert.equal(after0.nextSession.revision,1);
  assert.equal(after0.nextSession.state.cards[0].mulliganDone,true);
  assert.equal(after0.nextSession.state.cards[0].active,false);
  assert.equal(openingGameCore.activeSeat(after0.nextSession.state),1);
  const after1=commit(after0.nextSession,1,'goodmull001',1,{type:'MULLIGAN',indices:[0,2]});
  assert.equal(after1.nextSession.state.cards[1].zones.hand.length,5);
  assert.equal(after1.nextSession.state.cards[1].mulliganDone,true);
  assert.equal(after1.nextSession.state.phase,'BATTLEFIELD_READY');
  assert.equal(after1.nextSession.state.battlefield.map.tiles.length,280);
  assert.equal(after1.nextSession.state.battlefield.cores.length,2);
  assert.equal(openingGameCore.activeSeat(after1.nextSession.state),null);
  assert.throws(()=>commit(after1.nextSession,0,'tooearly01',2,{type:'MOVE',x:1,y:1}),/NOT_YOUR_TURN/);
});

test('bad mulligan indexes and invented tactical actions do not change state or RNG',()=>{
  const s=createAuthoritySession({initialState:create(1980),core:openingGameCore});
  const before=structuredClone(s);
  for (const indices of [[-1],[50],[1,1],['0'],[0,1,2,3,4,5]]) {
    assert.throws(()=>commit(s,0,'mulltest01',0,{type:'MULLIGAN',indices}),/INVALID_MULLIGAN/);
    assert.deepEqual(s,before);
  }
  assert.throws(()=>commit(s,0,'fakeattack01',0,{type:'ATTACK',actorId:'p0'}),/TACTICAL_GAME_CORE_NOT_READY/);
  assert.deepEqual(s,before);
});

test('stale commands, idempotent retries, ID collisions and cross-seat receipts',()=>{
  const s=createAuthoritySession({initialState:create(881),core:openingGameCore});
  const first=commit(s,0,'firstcmd123',0,{type:'MULLIGAN',indices:[0]});
  const again=commit(first.nextSession,0,'firstcmd123',0,{type:'MULLIGAN',indices:[0]});
  assert.equal(again.duplicate,true);
  assert.equal(again.nextSession.revision,1);
  assert.deepEqual(again.nextSession,first.nextSession);
  assert.throws(()=>commit(first.nextSession,0,'firstcmd123',0,{type:'KEEP_OPENING_HAND'}),/COMMAND_ID_COLLISION/);
  assert.throws(()=>commit(first.nextSession,1,'stale01aaa',0,{type:'KEEP_OPENING_HAND'}),/STALE_REVISION/);
  assert.throws(()=>commit(first.nextSession,0,'stolen01aaa',1,{type:'KEEP_OPENING_HAND'}),/NOT_YOUR_TURN/);
  const snap=projectAuthoritySession(first.nextSession,1,openingGameCore);
  assert.equal(snap.revision,1);
  assert.equal(snap.view.activeSeat,1);
});

test('reject any malformed or not officially validated starting deck and server seed',()=>{
  assert.throws(()=>createOpeningGame({decks:[a,b.slice(1)],serverSeed:1}),/TWO_VALID_DECKS_REQUIRED/);
  assert.throws(()=>createOpeningGame({decks:[a,b],serverSeed:-1}),/SERVER_SEED_REQUIRED/);
  assert.throws(()=>createOpeningGame({decks:[a,b],serverSeed:NaN}),/SERVER_SEED_REQUIRED/);
  assert.throws(()=>createOpeningGame({decks:[a,b],serverSeed:0x100000000}),/SERVER_SEED_REQUIRED/);
});
