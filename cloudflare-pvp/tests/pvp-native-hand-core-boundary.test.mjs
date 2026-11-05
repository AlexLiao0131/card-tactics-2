import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PvpLobbyController} from '../../js/pvp-lobby.js';
import {CardHandUI} from '../../js/card-hand-ui.js';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';

function dom(){
  const before={document:globalThis.document,sessionStorage:globalThis.sessionStorage,WebSocket:globalThis.WebSocket};
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{id,hidden:false,disabled:false,style:{},textContent:'',title:'',dataset:{},value:'',
        classList:{toggle:(x,yes)=>{if(yes)classes.add(x);else classes.delete(x)},contains:x=>classes.has(x),remove:x=>classes.delete(x),add:x=>classes.add(x)},
        setAttribute(name,value){this[name]=String(value)},querySelector:()=>null});
    }
    return nodes.get(id);
  };
  globalThis.document={getElementById:node,body:{dataset:{}}};
  const db=new Map();globalThis.sessionStorage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)};
  globalThis.WebSocket={OPEN:1};
  return{node,restore(){Object.assign(globalThis,before)}};
}

const cards=[{id:'imperial_swordsman_card',name:'劍兵',cost:3,type:'CHARACTER'}];
const bf={map:{id:'authoritative-map',width:14,height:10},cores:[
  {owner:'PLAYER',hp:600,maxHp:600},{owner:'ENEMY',hp:550,maxHp:600}],
  deploymentPoints:[],meta:{size:'SMALL',seed:31415}};
const match=(revision,phase,cores=bf.cores)=>({revision,protocol:'test',tacticalEnabled:true,
  view:{seat:0,phase,activeSeat:0,own:{hand:cards,deckCount:15,crystals:4},opponent:{handCount:5},
    battlefield:{...bf,cores}}});

test('remote hand remains mounted and read-only after card phase without exposing local offline hand',()=>{
  const old=globalThis.CardDatabase;globalThis.CardDatabase={get:id=>id==='imperial_swordsman_card'?cards[0]:null};
  const ui=Object.create(CardHandUI.prototype);let rendered=0;
  ui.render=()=>rendered++;ui.mulligan=new Set();ui.handKey=null;
  try{
    const opts={phase:'CARD_PHASE',matchId:'ABCDEFGH',seat:0,hand:cards,deckCount:15,opponentHandCount:5,crystals:4,
      canAct:true,onDecision:()=>{},onPlayCard:()=>{},onEndCard:()=>{},onCancel:()=>{}};
    ui.setRemoteCards(opts);
    const key=ui.remoteCards.handKey;
    ui.setRemoteCards({...opts,phase:'TACTICAL_PHASE',canAct:false});
    assert.deepEqual(ui.remoteCards.handIds,['imperial_swordsman_card']);
    assert.equal(ui.remoteCards.canAct,false);
    assert.equal(ui.remoteCards.handKey,key,'phase transition must not replace hand identity');
    assert.equal(rendered,2);
  }finally{globalThis.CardDatabase=old;}
});

test('native PvP lobby preserves the hand and updates both Core HP bars on MATCH_STATE before Babylon render',()=>{
  const {node,restore}=dom();
  try{
    const states=[],clears=[];
    const p=new PvpLobbyController({shell:{show:()=>{}},cardUI:{setRemoteCards:data=>states.push(data),clearRemoteCards:()=>clears.push(true)},createSharedRenderer:()=>({sync(){}})});
    p.session={code:'ABCDEFGH',seat:0,token:'a'.repeat(64)};p.battleVisible=true;
    p.tacticalUI={receiveMatch:()=>{},update:()=>{},setPresented:()=>{}};
    p.displayMatch(match(1,'PLAYER_CARD_PHASE'));
    assert.equal(states.at(-1).phase,'CARD_PHASE');
    const previousClear=clears.length;
    p.displayMatch(match(2,'PLAYER_TACTICAL_PHASE',[
      {owner:'PLAYER',hp:480,maxHp:600},{owner:'ENEMY',hp:510,maxHp:600}]));
    assert.equal(clears.length,previousClear);
    assert.equal(states.at(-1).phase,'TACTICAL_PHASE');
    assert.equal(states.at(-1).canAct,false);
    assert.deepEqual(states.at(-1).hand,cards);
    assert.equal(node('playerCoreHp').textContent,'480/600');
    assert.equal(node('enemyCoreHp').textContent,'510/600');
    assert.equal(node('playerCoreBar').style.width,'80%');
    assert.equal(node('enemyCoreBar').style.width,'85%');
    assert.equal(node('versusCoreHud').classList.contains('available'),true);
    assert.equal(node('versusCoreHud').classList.contains('open'),true);
    p.displayMatch(match(3,'ENEMY_TACTICAL_PHASE'));
    assert.equal(states.at(-1).phase,'TACTICAL_PHASE');
    p.displayMatch(match(4,'PLAYER_CARD_PHASE'));
    assert.equal(states.at(-1).phase,'CARD_PHASE');
  }finally{restore()}
});

test('match-state contains Core and map dimensions only; full terrain is confined to authoritative render snapshots',async()=>{
  const {createOpeningGame,openingGameCore}=await import('../src/pvp-match-core.mjs');
  const {createAuthoritySession,commitAuthorityCommand,projectAuthoritySession}=await import('../src/battle-authority.mjs');
  const {PVP_COMMAND_PROTOCOL}=await import('../../shared/pvp-command-contract.mjs');
  const {pvpAuthoritativeMatchCore}=await import('../src/pvp-authoritative-match-core.mjs');
  const deck=Array(20).fill('imperial_swordsman_card');
  let s=createAuthoritySession({initialState:createOpeningGame({decks:[deck,deck],serverSeed:45235}),core:openingGameCore});
  for(const seat of [0,1]){
    s=commitAuthorityCommand({session:s,seat,core:openingGameCore,
      envelope:{protocol:PVP_COMMAND_PROTOCOL,baseRevision:s.revision,commandId:`begin-card-${seat}-0001`,action:{type:'KEEP_OPENING_HAND'}}}).nextSession;
  }
  const v=projectAuthoritySession(s,0,pvpAuthoritativeMatchCore).view;
  assert.equal(v.battlefield.map.tiles,undefined);
  assert.equal(v.battlefield.map.width,20);
  assert.equal(v.battlefield.cores.length,2);
  assert.ok(s.state.battlefield.map.tiles.length>0,'server retains canonical map');
  assert.ok(JSON.stringify(v).length<JSON.stringify(s.state.battlefield.map).length,
    'private match status is smaller than redundant full map');
});

test('terrain owns all four boundary wall meshes even for minimum-elevation lone tile',()=>{
  const old=globalThis.BABYLON;
  globalThis.BABYLON={Mesh:class{setVerticesData(){}},VertexBuffer:{ColorKind:'color'},
    VertexData:class{applyToMesh(mesh){mesh.positions=this.positions;mesh.indices=this.indices}}};
  try{
    const terrain=Object.create(TerrainRenderer.prototype);
    terrain.surfaceResolver=new VisualSurfaceResolver();
    terrain.updateCounts={cliffBuilds:0};terrain.cliffColorBindings=[];terrain.cliffMaterial={};terrain.scene={};
    const tile={x:0,y:0,elevation:0,terrain:'PLAIN'};
    const cliff=terrain.buildCliffs([tile],new Map([['0,0',tile]]));
    assert.ok(cliff);
    assert.equal(cliff.metadata.ruggedEdges,4);
    assert.equal(terrain.surfaceResolver.renderedCliffGeometry.size,4);
    assert.ok(cliff.positions.length>0);
    const faceNames=[...terrain.surfaceResolver.renderedCliffGeometry.keys()];
    assert.equal(faceNames.some(x=>x.endsWith(':N')),true);
    assert.equal(faceNames.some(x=>x.endsWith(':E')),true);
    assert.equal(faceNames.some(x=>x.endsWith(':S')),true);
    assert.equal(faceNames.some(x=>x.endsWith(':W')),true);
  }finally{globalThis.BABYLON=old}
});

test('worker broadcasts lightweight state to both seats before starting expensive Babylon projections',()=>{
  const source=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');
  assert.match(source,/for\(const ws of sockets\)\s*this\.sendMatchState\(ws,session,ws\.deserializeAttachment\(\)\?\.seat,roomCode,\{stateOnly:true\}\)/);
  assert.match(source,/for\(const ws of sockets\)\s*this\.sendMatchRender\(ws,session,ws\.deserializeAttachment\(\)\?\.seat,roomCode\)/);
});

test('all exterior border edges are constructed in four official generated map sizes',async()=>{
  const {createOfficialBattlefield}=await import('../src/pvp-battlefield.mjs');
  const old=globalThis.BABYLON;
  globalThis.BABYLON={Mesh:class{setVerticesData(){}},VertexBuffer:{ColorKind:'color'},
    VertexData:class{applyToMesh(mesh){mesh.positions=this.positions;mesh.indices=this.indices}}};
  try{
    for(const size of ['SMALL','MEDIUM','LARGE','XLARGE']){
      const map=createOfficialBattlefield({serverSeed:31415,mapSize:size}).map;
      const terrain=Object.create(TerrainRenderer.prototype);
      terrain.surfaceResolver=new VisualSurfaceResolver();terrain.updateCounts={cliffBuilds:0};
      terrain.cliffColorBindings=[];terrain.cliffMaterial={};terrain.scene={};
      terrain.buildCliffs(map.tiles,new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t])));
      const registered=terrain.surfaceResolver.renderedCliffGeometry;
      for(const t of map.tiles)for(const [dir,dx,dy] of [
        ['N',0,-1],['E',1,0],['S',0,1],['W',-1,0]]){
        if(t.x+dx>=0&&t.x+dx<map.width&&t.y+dy>=0&&t.y+dy<map.height)continue;
        assert.ok(registered.has(`${t.x},${t.y}:${dir}`),`${size}: missing exterior side ${t.x},${t.y}:${dir}`);
      }
    }
  }finally{globalThis.BABYLON=old}
});
