import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpBattleRenderBridge} from '../../js/pvp-battle-render-bridge.js';
function makeBridge(){
 const calls=[];
 const active=new Set();
 const canvas={id:'c',parentElement:{classList:{
   contains:key=>active.has(key),add:key=>active.add(key),remove:key=>active.delete(key)
 }}};
 const bridge=new PvpBattleRenderBridge({canvas,seat:1,
   onTilePicked:tile=>calls.push(['tile',tile]),
   createRenderer:(canvas,snapshot,options)=>{
     calls.push(['construct',canvas.id,snapshot.revision]);
     return {sync:next=>calls.push(['sync',next.revision]),
       pick:options.onTilePicked,
       engine:{stopRenderLoop:()=>calls.push(['stop']),dispose:()=>calls.push(['engine-dispose'])},
       scene:{dispose:()=>calls.push(['scene-dispose'])}};
   }});
 return {bridge,calls,active};
}
const packet=(revision,seat=1,matchId='m1')=>({
  matchId,seat,revision,
  snapshot:{revision,map:{tiles:[]},cores:[],units:[],presentation:{}}
});
test('seat-specific bridge uses official renderer once, synchronizes only increasing server revisions',()=>{
 const {bridge,calls,active}=makeBridge();
 assert.equal(bridge.accept(packet(0)),true);
 assert.ok(active.has('active'));
 assert.equal(bridge.accept(packet(0)),false);
 assert.equal(bridge.accept(packet(3)),true);
 assert.equal(bridge.accept(packet(2)),false);
 assert.deepEqual(calls,[['construct','c',0],['sync',0],['sync',3]]);
 bridge.renderer.pick(2,4);
 assert.deepEqual(calls.at(-1),['tile',{matchId:'m1',seat:1,x:2,y:4}]);
 bridge.close();bridge.close();
 assert.equal(calls.filter(c=>c[0]==='engine-dispose').length,1);
 assert.equal(active.has('active'),false);
 assert.throws(()=>bridge.accept(packet(4)),/CLOSED/);
});
test('bridge rejects stale cross-room, wrong seat, malformed or client-forged presentation',()=>{
 const {bridge,calls}=makeBridge();
 for(const bad of [packet(1,0),packet(-1),{...packet(0),snapshot:{...packet(0).snapshot,revision:12}},
   {...packet(0),snapshot:{...packet(0).snapshot,map:{bad:true}}}])
  assert.throws(()=>bridge.accept(bad));
 assert.equal(calls.length,0);
 assert.equal(bridge.accept(packet(0)),true);
 assert.throws(()=>bridge.accept(packet(2,1,'other-room')),/MATCH_MISMATCH/);
 assert.equal(bridge.accept(packet(1)),true);
});
