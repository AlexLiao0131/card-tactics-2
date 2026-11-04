import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {experimentalTacticalCore} from '../src/pvp-headless-tactical.mjs';
import {createAuthoritySession} from '../src/battle-authority.mjs';
import {rendererEnvelopeForSeat} from '../src/pvp-render-snapshot-transport.mjs';
const cards=Array(20).fill('imperial_swordsman_card');
function setup(){
 let game=createOpeningGame({decks:[cards,cards],serverSeed:945});
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 return createAuthoritySession({initialState:game,core:experimentalTacticalCore});
}
test('official Babylon renderer transport uses authority revision and hides server receipts/secret hands',()=>{
 const session=setup();
 const original=structuredClone(session);
 const a=rendererEnvelopeForSeat({session,seat:0,matchId:'test-match'});
 const b=rendererEnvelopeForSeat({session,seat:1,matchId:'test-match'});
 for(const packet of [a,b]){
  assert.equal(packet.type,'PVP_RENDER_SNAPSHOT');
  assert.equal(packet.matchId,'test-match');
  assert.equal(packet.revision,session.revision);
  assert.equal(packet.snapshot.revision,session.revision);
  assert.equal(packet.snapshot.cores.length,2);
  assert.ok(Array.isArray(packet.snapshot.presentation.deploymentPoints));
  assert.equal('state' in packet,false);
  assert.equal('receipts' in packet,false);
  assert.equal('zones' in packet.snapshot,false);
 }
 assert.equal(JSON.stringify(a.snapshot).includes('imperial_swordsman_card'),false);
 assert.equal(JSON.stringify(b.snapshot).includes('imperial_swordsman_card'),false);
 assert.deepEqual(session,original,'renderer projection must never mutate authoritative state');
 assert.deepEqual(a.snapshot.map.tiles.map(t=>[t.x,t.y,t.terrain]),
                  b.snapshot.map.tiles.map(t=>[t.x,t.y,t.terrain]));
});
test('3D transport rejects wrong seats, missing game authority and empty match ids',()=>{
 const session=setup();
 for(const options of [{session,seat:2,matchId:'x'},
 {session:{revision:0},seat:0,matchId:'x'},
 {session,seat:0,matchId:''}])
  assert.throws(()=>rendererEnvelopeForSeat(options));
});
