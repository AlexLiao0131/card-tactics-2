import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpLobbyController} from '../../js/pvp-lobby.js';
import {createRenderUpdate} from '../../js/pvp-render-delta.js';

const makeFrame=(revision,hp=100)=>({type:'PVP_RENDER_SNAPSHOT',matchId:'ABCDEFGH',seat:0,revision,
 snapshot:{revision,phase:'PLAYER_TACTICAL_PHASE',round:1,mode:'command',
 map:{id:'m',width:2,height:1,tiles:[{x:0,y:0,terrain:'PLAIN'},{x:1,y:0,terrain:'PLAIN'}],objects:[]},
 cores:[{id:'P',hp:600}],units:[{id:'unit',hp,x:0,y:0}],
 presentation:{deploymentPoints:[],environment:{weather:'CLEAR'}}}});
const getDocument=()=>{
 const controls=new Map();
 const node=id=>{
  if(!controls.has(id))controls.set(id,{id,hidden:false,disabled:false,dataset:{},textContent:'',
   value:'',querySelector:()=>node(`${id}:sub`)});
  return controls.get(id);
 };
 return {getElementById:node,body:{dataset:{}}};
};
class FakeSocket{
 static OPEN=1;static created=[];
 readyState=1;sent=[];
 constructor(url){this.url=url;FakeSocket.created.push(this);}
 send(raw){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;}
 receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}
}

test('real PvP WebSocket handler reconstructs updates for original 3D UI and requests full after lost baseline',async()=>{
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,
   WebSocket:globalThis.WebSocket,location:globalThis.location};
 const store=new Map();
 globalThis.document=getDocument();
 globalThis.sessionStorage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)};
 globalThis.WebSocket=FakeSocket;
 globalThis.location={href:'https://example.com/index.html'};
 try{
  const received=[];
  const p=new PvpLobbyController({shell:{show:()=>{}},cardUI:{clearRemoteCards:()=>{},setRemoteCards:()=>{}},createSharedRenderer:()=>({sync:()=>{}})});
  p.setSession({code:'ABCDEFGH',seat:0,token:'a'.repeat(64)});
  p.api=async()=>({ticket:'b'.repeat(64)});
  p.tacticalUI={receiveRender:frame=>{received.push(frame);return true;},update:()=>{},
   setPresented:()=>{},close:()=>{},receiveMatch:()=>{}};
  p.battleVisible=true;
  await p.connect();
  const socket=FakeSocket.created.at(-1);
  const v1=makeFrame(1),v2=makeFrame(2,81),v3=makeFrame(3,45);
  socket.receive(v1);
  socket.receive(createRenderUpdate(v1,v2));
  assert.deepEqual(received,[v1,v2]);
  // Simulate a dropped baseline: request FULL once, never apply speculative damage.
  p.renderBaseline=null;
  socket.receive(createRenderUpdate(v2,v3));
  socket.receive(createRenderUpdate(v2,v3));
  assert.equal(socket.sent.filter(p=>p.type==='REQUEST_RENDER_SNAPSHOT').length,1);
  assert.equal(received.length,2);
  socket.receive(v3);
  assert.deepEqual(received.at(-1),v3);
  assert.equal(p.renderResyncPending,false);
  assert.equal(p.renderBaseline.snapshot.units[0].hp,45);
  // While viewing lobby, keep the decoded full packet, not the transport delta.
  p.battleVisible=false;
  const v4=makeFrame(4,31);
  socket.receive(createRenderUpdate(v3,v4));
  assert.equal(p.pendingRender.type,'PVP_RENDER_SNAPSHOT');
  assert.equal(p.pendingRender.snapshot.units[0].hp,31);
  assert.equal(received.length,3);
 }finally{Object.assign(globalThis,old);}
});
