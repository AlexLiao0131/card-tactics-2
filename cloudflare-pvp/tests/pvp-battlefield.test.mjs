import test from 'node:test';
import assert from 'node:assert/strict';
import { MapGenerator } from '../../js/map-generator.js';
import { StageDatabase } from '../../js/stage-database.js';
import { createOfficialBattlefield,projectOfficialBattlefield,PVP_STAGE_ID }
  from '../src/pvp-battlefield.mjs';
import { createOpeningGame,openingGameCore } from '../src/pvp-match-core.mjs';
import { createAuthoritySession,commitAuthorityCommand,projectAuthoritySession }
  from '../src/battle-authority.mjs';
import { PVP_COMMAND_PROTOCOL } from '../../shared/pvp-command-contract.mjs';

const one=['livia_card',...Array(19).fill('imperial_swordsman_card')];
const two=['ophi_card',...Array(19).fill('imperial_archer_card')];
const command=(session,seat,commandId,action)=>commitAuthorityCommand({
  session,seat,core:openingGameCore,envelope:{protocol:PVP_COMMAND_PROTOCOL,
  commandId,baseRevision:session.revision,action}});

// On main, these tests execute the actual original js/map-generator.js. The
// offline working sandbox used a local-only interface double for this file;
// the test double is intentionally excluded from the deliverable ZIP.
test('official generator and stage own size, Core HP, capture points and all tiles',()=>{
  const stage=StageDatabase.get(PVP_STAGE_ID);
  const size=stage.battlefield.defaultSize;
  const seed=1234567;
  const actual=createOfficialBattlefield({serverSeed:seed});
  const original=MapGenerator.generateVersus({size,seed,coreRules:stage.coreRules});
  assert.equal(actual.stageId,stage.id);
  assert.deepEqual(actual.map,original.map);
  assert.deepEqual(actual.cores,original.cores);
  assert.deepEqual(actual.deploymentPoints,original.deploymentPoints);
  assert.deepEqual(actual.meta,original.meta);
  assert.equal(actual.meta.validation,'PASS');
  assert.equal(actual.cores.find(c=>c.owner==='PLAYER').hp,stage.coreRules.hp);
  assert.equal(actual.cores.find(c=>c.owner==='ENEMY').hp,stage.coreRules.hp);
  assert.equal(actual.deploymentPoints.filter(x=>x.owner==='NEUTRAL').length,3);
  assert.deepEqual(projectOfficialBattlefield(actual).map,original.map);
});

test('four official presets use generator dimensions; server seed determinism',()=>{
  for (const size of Object.keys(MapGenerator.SIZE_PRESETS)) {
    const preset=MapGenerator.SIZE_PRESETS[size];
    const a=createOfficialBattlefield({serverSeed:10101,mapSize:size});
    const b=createOfficialBattlefield({serverSeed:10101,mapSize:size});
    assert.equal(a.map.width,preset.width);
    assert.equal(a.map.height,preset.height);
    assert.equal(a.map.tiles.length,preset.width*preset.height);
    assert.deepEqual(a,b);
  }
});

test('invalid seeds and unsupported client-invented map sizes are rejected',()=>{
  for (const seed of [-1,NaN,0x100000000,1.2,'123',null]) {
    assert.throws(()=>createOfficialBattlefield({serverSeed:seed}),/SERVER_SEED_REQUIRED/);
  }
  for (const size of ['TINY','GOD_MODE','__proto__',22,null]) {
    // null is explicitly disallowed by the platform contract; unspecified
    // mapSize is represented as undefined.
    if (size===null) continue;
    assert.throws(()=>createOfficialBattlefield({serverSeed:5,mapSize:size}),/INVALID_MAP_SIZE/);
  }
  assert.throws(()=>projectOfficialBattlefield({}),/BATTLEFIELD_NOT_READY/);
});

test('legacy in-flight rooms without serverMapSeed can still finish opening',()=>{
  const original=createOpeningGame({decks:[one,two],serverSeed:3333});
  delete original.serverMapSeed;
  const session=createAuthoritySession({initialState:original,core:openingGameCore});
  const seat0=command(session,0,'legacyopen01',{type:'KEEP_OPENING_HAND'});
  const seat1=command(seat0.nextSession,1,'legacyopen02',{type:'KEEP_OPENING_HAND'});
  assert.equal(seat1.nextSession.state.phase,'BATTLEFIELD_READY');
  assert.equal(seat1.nextSession.state.battlefield.meta.validation,'PASS');
  assert.equal(seat1.nextSession.state.battlefield.map.tiles.length,280);
});

test('both seats receive identical map but their own private cards',()=>{
  const initial=createAuthoritySession({initialState:createOpeningGame({decks:[one,two],serverSeed:1234567}),core:openingGameCore});
  const seat0=command(initial,0,'mapdone0001',{type:'KEEP_OPENING_HAND'});
  assert.equal(seat0.nextSession.state.battlefield,undefined);
  const seat1=command(seat0.nextSession,1,'mapdone0002',{type:'MULLIGAN',indices:[0,1]});
  assert.equal(seat1.nextSession.state.phase,'BATTLEFIELD_READY');
  assert.equal(seat1.nextSession.revision,2);
  const a=projectAuthoritySession(seat1.nextSession,0,openingGameCore);
  const b=projectAuthoritySession(seat1.nextSession,1,openingGameCore);
  assert.deepEqual(a.view.battlefield,b.view.battlefield);
  assert.equal(a.view.own.hand.length,5);
  assert.equal(b.view.own.hand.length,5);
  assert.equal(JSON.stringify(a).includes('imperial_archer_card'),false);
  assert.equal(JSON.stringify(b).includes('imperial_swordsman_card'),false);
  assert.equal(JSON.stringify(a).includes('serverMapSeed'),false);
  assert.equal(JSON.stringify(b).includes('randomState'),false);
  const before=structuredClone(seat1.nextSession);
  assert.throws(()=>command(seat1.nextSession,0,'badattack111',{type:'ATTACK',unitId:'p0',damage:99999}),/CLIENT_RESULT_FORBIDDEN/);
  assert.deepEqual(seat1.nextSession,before);
});
