import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpeningGame,openingGameCore } from '../src/pvp-match-core.mjs';
import { createAuthoritySession,commitAuthorityCommand,projectAuthoritySession } from '../src/battle-authority.mjs';
import { PVP_COMMAND_PROTOCOL } from '../../shared/pvp-command-contract.mjs';
import { EnvironmentEngine } from '../../js/environment-engine.js';

const deck0=['livia_card',...Array(19).fill('imperial_swordsman_card')];
const deck1=['ophi_card',...Array(19).fill('imperial_archer_card')];
const command=(session,seat,cmdId,action)=>commitAuthorityCommand({
  session,seat,core:openingGameCore,
  envelope:{protocol:PVP_COMMAND_PROTOCOL,baseRevision:session.revision,
  commandId:cmdId,action}
});
function preparedMatch(seed){
  const original=createAuthoritySession({initialState:createOpeningGame({decks:[deck0,deck1],serverSeed:seed}),core:openingGameCore});
  const first=command(original,0,'first-readyx',{type:'KEEP_OPENING_HAND'});
  return command(first.nextSession,1,'next-readyxx',{type:'KEEP_OPENING_HAND'}).nextSession;
}
test('server match saves complete Stage/Climate/Hydrology initial world without a browser',()=>{
  assert.equal(globalThis.window,undefined);
  const session=preparedMatch(12123);
  const s=session.state;
  assert.equal(s.phase,'BATTLEFIELD_READY');
  assert.ok(s.stageState);
  assert.ok(s.environmentState);
  assert.ok(s.environmentState.effects instanceof Map);
  assert.ok(s.battlefield.map.hydrologyInitialSourceSettle);
  assert.ok(s.battlefield.map.hydrologyRiverProfiles);
  assert.equal(s.battlefield.cores.length,2);
  assert.equal(s.round,1);
  assert.deepEqual(s.units,[]);
  assert.doesNotThrow(()=>structuredClone(session));
  assert.equal(s.cards[0].zones.hand.length,5);
  assert.equal(s.cards[1].zones.hand.length,5);
});
test('Durable Object serialized world advances official environment once without mutating stored session',()=>{
  const original=preparedMatch(75319);
  const stored=structuredClone(original);
  const world=structuredClone(stored.state);
  const beforeMap=structuredClone(stored.state.battlefield.map);
  const events=EnvironmentEngine.advanceEnvironmentTurn(world.battlefield.map,world.environmentState);
  EnvironmentEngine.tick(world.environmentState);
  assert.ok(Array.isArray(events));
  assert.ok(events.some(e=>e.type==='HYDROLOGY_PHYSICAL_STEP'));
  assert.deepEqual(original,stored);
  assert.deepEqual(stored.state.battlefield.map,beforeMap);
});
test('two player projections see same canonical hydrated map and no private RNG or opponent hand',()=>{
  const session=preparedMatch(200);const a=projectAuthoritySession(session,0,openingGameCore);
  const b=projectAuthoritySession(session,1,openingGameCore);
  assert.deepEqual(a.view.battlefield,b.view.battlefield);
  assert.equal(a.view.own.hand.length,5);
  assert.equal(b.view.own.hand.length,5);
  assert.equal(a.view.opponent.handCount,5);
  assert.equal(b.view.opponent.handCount,5);
  assert.equal(JSON.stringify(a.view).includes('serverMapSeed'),false);
  assert.equal(JSON.stringify(a.view).includes('randomState'),false);
  assert.equal(JSON.stringify(a.view).includes('imperial_archer_card'),false);
  assert.equal(JSON.stringify(b.view).includes('imperial_swordsman_card'),false);
});
test('malicious gameplay command is still rejected after full world bootstrap',()=>{
  const session=preparedMatch(9901);
  const before=structuredClone(session);
  assert.throws(()=>command(session,0,'fake-hit1234',{type:'ATTACK',damage:9000000}),/CLIENT_RESULT_FORBIDDEN/);
  assert.deepEqual(session,before);
});
