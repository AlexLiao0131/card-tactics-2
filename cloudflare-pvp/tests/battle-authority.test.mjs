import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthoritySession,projectAuthoritySession,commitAuthorityCommand
} from '../src/battle-authority.mjs';
import {PVP_COMMAND_PROTOCOL,validateCommandEnvelope} from '../../shared/pvp-command-contract.mjs';

// Deliberately a TEST-ONLY fake reducer. It must never be deployed as gameplay.
const core={
  activeSeat: state => state.turn,
  project:(state,seat)=>({turn:state.turn,score:state.score,
    hand:seat===0?state.privateHands[0]:state.privateHands[1]}),
  reduce:(state,action,{seat})=>{
    if(action.type!=='TEST_PASS') return {accepted:false};
    state.score+=1; state.turn=seat===0?1:0;
    return {accepted:true,state};
  }
};
const initial=()=>({turn:0,score:0,privateHands:[['A_CARD'],['B_SECRET']]});
const envelope=(commandId,baseRevision,action={type:'TEST_PASS'})=>({
  protocol:PVP_COMMAND_PROTOCOL,commandId,baseRevision,action
});
function err(code){return e=>e.code===code;}

test('requires the actual canonical GameCore adapter before opening a match',()=>{
  assert.throws(()=>createAuthoritySession({initialState:initial()}),err('CANONICAL_GAME_CORE_REQUIRED'));
  assert.throws(()=>createAuthoritySession({initialState:initial(),core:{reduce(){}}}),err('CANONICAL_GAME_CORE_REQUIRED'));
});

test('the server only projects each seat own hidden hand',()=>{
  const session=createAuthoritySession({initialState:initial(),core});
  const view0=projectAuthoritySession(session,0,core);
  const view1=projectAuthoritySession(session,1,core);
  assert.deepEqual(view0.view.hand,['A_CARD']);
  assert.deepEqual(view1.view.hand,['B_SECRET']);
  assert.equal(JSON.stringify(view0).includes('B_SECRET'),false);
  assert.equal(JSON.stringify(view1).includes('A_CARD'),false);
  assert.equal(JSON.stringify(session).includes('B_SECRET'),true); // server owns full state
});

test('valid command advances once, duplicate is idempotent even after turn rotates',()=>{
  const start=createAuthoritySession({initialState:initial(),core});
  const cmd=envelope('host_action_001',0);
  const first=commitAuthorityCommand({session:start,seat:0,envelope:cmd,core});
  assert.equal(first.nextSession.revision,1);
  assert.equal(first.nextSession.state.score,1);
  assert.equal(start.state.score,0);
  assert.equal(first.nextSession.state.turn,1);
  const retry=commitAuthorityCommand({session:first.nextSession,seat:0,envelope:cmd,core});
  assert.equal(retry.duplicate,true);
  assert.equal(retry.nextSession.state.score,1);
  assert.equal(retry.ack.acceptedRevision,1);
});

test('opponent cannot act out of turn, but can act after ownership changes',()=>{
  const s=createAuthoritySession({initialState:initial(),core});
  assert.throws(()=>commitAuthorityCommand({session:s,seat:1,envelope:envelope('guest_001',0,{type:'TEST_PASS'}),core}),err('NOT_YOUR_TURN'));
  const a=commitAuthorityCommand({session:s,seat:0,envelope:envelope('host_001',0),core});
  const b=commitAuthorityCommand({session:a.nextSession,seat:1,envelope:envelope('guest_001',1,{type:'TEST_PASS'}),core});
  assert.equal(b.nextSession.state.score,2);
  assert.equal(b.nextSession.state.turn,0);
});

test('rejects stale revision and command-id collision without mutation',()=>{
  const s=createAuthoritySession({initialState:initial(),core});
  const a=commitAuthorityCommand({session:s,seat:0,envelope:envelope('host_001',0),core});
  assert.throws(()=>commitAuthorityCommand({session:a.nextSession,seat:1,envelope:envelope('guest_001',0,{type:'TEST_PASS'}),core}),err('STALE_REVISION'));
  assert.throws(()=>commitAuthorityCommand({session:a.nextSession,seat:0,envelope:envelope('host_001',0,{type:'TEST_PASS',target:{x:1,y:2}}),core}),err('COMMAND_ID_COLLISION'));
  assert.equal(a.nextSession.revision,1);
});

test('gameplay rejection or reducer mutation followed by rejection leaves state unchanged',()=>{
  const s=createAuthoritySession({initialState:initial(),core});
  assert.throws(()=>commitAuthorityCommand({session:s,seat:0,envelope:envelope('host_invalid',0,{type:'INVALID'}),core}),err('ILLEGAL_GAME_ACTION'));
  assert.equal(s.state.score,0);
  const mutatingReject={...core,reduce:(state)=>{state.score=999;return {accepted:false}}};
  assert.throws(()=>commitAuthorityCommand({session:s,seat:0,envelope:envelope('host_reject',0),core:mutatingReject}),err('ILLEGAL_GAME_ACTION'));
  assert.equal(s.state.score,0);
});

test('clients cannot submit state, results, randomness, damage or a forged seat',()=>{
  const base=envelope('host_001',0);
  for(const forbidden of [
    {...base,state:{turn:0}},
    {...base,events:[{type:'DAMAGE'}]},
    {...base,action:{type:'TEST_PASS',damage:9000}},
    {...base,action:{type:'TEST_PASS',nested:{rng:0.5}}},
    {...base,action:{type:'TEST_PASS',result:{victory:true}}}
  ])assert.throws(()=>validateCommandEnvelope(forbidden));
  const s=createAuthoritySession({initialState:initial(),core});
  assert.throws(()=>commitAuthorityCommand({session:s,seat:2,envelope:base,core}),err('BAD_SEAT'));
  assert.throws(()=>validateCommandEnvelope(envelope('host_fake',0,{type:'TEST_PASS',seat:1})),err('CLIENT_RESULT_FORBIDDEN'));
});

test('objects with reordered properties are still the same command for replay safety',()=>{
  const s=createAuthoritySession({initialState:initial(),core});
  const cmd=envelope('host_001',0,{type:'TEST_PASS',target:{x:1,y:2}});
  const first=commitAuthorityCommand({session:s,seat:0,envelope:cmd,core});
  const retry={action:{target:{y:2,x:1},type:'TEST_PASS'},baseRevision:0,commandId:'host_001',protocol:PVP_COMMAND_PROTOCOL};
  assert.equal(commitAuthorityCommand({session:first.nextSession,seat:0,envelope:retry,core}).duplicate,true);
});
