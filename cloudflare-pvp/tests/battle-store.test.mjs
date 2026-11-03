import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableBattleStore, BATTLE_STORAGE_KEY} from '../src/battle-store.mjs';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';

class TransactionalMemoryStore {
  data=new Map(); queue=Promise.resolve();
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){this.data.set(key,structuredClone(value));}
  async transaction(callback){
    const run=this.queue.then(()=>callback(this));
    this.queue=run.catch(()=>{});
    return run;
  }
}
const core={
  activeSeat:state=>state.turn,
  reduce:(state,action)=>{
    if(action.type!=='TEST_END_TURN') return {accepted:false};
    state.turn=state.turn===0?1:0;
    state.moves++;return {accepted:true,state};
  },
  project:(state,seat)=>({turn:state.turn,moves:state.moves,privateHand:state.hands[seat]})
};
const command=(id,revision)=>({
  protocol:PVP_COMMAND_PROTOCOL,commandId:id,baseRevision:revision,action:{type:'TEST_END_TURN'}
});
const init=()=>({turn:0,moves:0,hands:[['ONLY_A'],['ONLY_B']]});

test('battle store persists the server state and isolates seat projections',async()=>{
  const db=new TransactionalMemoryStore(),store=new DurableBattleStore(db,core);
  assert.deepEqual(await store.initialize(init()),{revision:0});
  assert.equal((await db.get(BATTLE_STORAGE_KEY)).state.moves,0);
  assert.equal((await store.snapshot(0)).view.privateHand[0],'ONLY_A');
  assert.equal((await store.snapshot(1)).view.privateHand[0],'ONLY_B');
  assert.equal(JSON.stringify(await store.snapshot(0)).includes('ONLY_B'),false);
  assert.rejects(store.initialize(init()),e=>e.code==='BATTLE_ALREADY_INITIALIZED');
});

test('concurrent submits are serialized and only the current seat may commit',async()=>{
  const store=new DurableBattleStore(new TransactionalMemoryStore(),core);
  await store.initialize(init());
  const [a,b]=await Promise.allSettled([
    store.submit({seat:0,envelope:command('host_move_001',0)}),
    store.submit({seat:0,envelope:command('host_move_002',0)})
  ]);
  assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);
  assert.equal([a,b].filter(x=>x.status==='rejected'&&x.reason.code==='STALE_REVISION').length,1);
  assert.equal((await store.snapshot(0)).view.moves,1);
  const guest=await store.submit({seat:1,envelope:command('guest_move_001',1)});
  assert.equal(guest.ack.acceptedRevision,2);
  assert.equal((await store.snapshot(1)).view.moves,2);
});

test('duplicate same command across disconnect keeps one authoritative commit',async()=>{
  const db=new TransactionalMemoryStore();
  const store=new DurableBattleStore(db,core);
  await store.initialize(init());
  const cmd=command('host_replay_001',0);
  const result=await store.submit({seat:0,envelope:cmd});
  // Simulates re-instantiating the DO host while preserving durable storage.
  const resumed=new DurableBattleStore(db,core);
  const retry=await resumed.submit({seat:0,envelope:cmd});
  assert.equal(result.ack.acceptedRevision,1);
  assert.equal(retry.duplicate,true);
  assert.equal((await resumed.snapshot(0)).view.moves,1);
});

test('no canonical core means no battle state can initialize',async()=>{
  const store=new DurableBattleStore(new TransactionalMemoryStore(),null);
  await assert.rejects(store.initialize(init()),e=>e.code==='CANONICAL_GAME_CORE_REQUIRED');
});
