import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpBattleRenderBridge} from '../../js/pvp-battle-render-bridge.js';
function makeBridge(){
 const calls=[];
 const active=new Set(['active']);
 const canvas={id:'c',parentElement:{classList:{
   contains:key=>active.has(key),add:key=>active.add(key),remove:key=>active.delete(key)
 }}};
 const bridge=new PvpBattleRenderBridge({canvas,seat:1,ownsRenderer:true,
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
 assert.equal(active.has('active'),true,'ShellUI still owns the active battle screen');
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

test('shared native renderer is not disposed by room disconnect and remains usable for the offline battle',()=>{
 const calls=[];
 const canvas={parentElement:{classList:{contains:()=>true,add:()=>{},remove:()=>{throw Error('DO_NOT_REMOVE_NATIVE_SCREEN')}}}};
 const renderer={sync:state=>calls.push(state.revision),dispose:()=>{throw Error('DISPOSED_SHARED_RENDERER')}};
 const bridge=new PvpBattleRenderBridge({canvas,seat:0,ownsRenderer:false,createRenderer:()=>renderer});
 assert.equal(bridge.accept(packet(0,0)),true);
 bridge.close();
 renderer.sync({revision:8});
 assert.deepEqual(calls,[0,8]);
});

test('native shell render bridge cannot force the original battle screen visible while player is in a menu',()=>{
 const active=new Set();
 const canvas={parentElement:{classList:{contains:x=>active.has(x),add:x=>active.add(x),remove:x=>active.delete(x)}}};
 const bridge=new PvpBattleRenderBridge({canvas,seat:0,ownsRenderer:false,
   createRenderer:()=>({sync(){}})});
 assert.throws(()=>bridge.accept(packet(1,0)),/NATIVE_PVP_SCREEN_NOT_ACTIVE/);
 assert.equal(active.size,0);
});

test('server render revision only commits after official Babylon renderer reports successful subsystem publication',()=>{
 const active=new Set(['active']);
 const canvas={parentElement:{classList:{contains:x=>active.has(x),add:x=>active.add(x),remove:x=>active.delete(x)}}};
 let renderComplete=false;
 const renderer={presentationCommitHistory:[],sync(snapshot){
   this.presentationCommitHistory.push({revision:snapshot.revision,complete:renderComplete,
     failedStages:renderComplete?[]:['terrain','units']});
 }};
 const bridge=new PvpBattleRenderBridge({canvas,seat:0,ownsRenderer:false,createRenderer:()=>renderer});
 assert.throws(()=>bridge.accept(packet(1,0)),/PVP_RENDER_INCOMPLETE/);
 assert.equal(bridge.revision,-1,'partial terrain or mesh render is not a committed 3D frame');
 renderComplete=true;
 assert.equal(bridge.accept(packet(1,0)),true,'same authoritative revision can retry after a failure');
 assert.equal(bridge.revision,1);
});
