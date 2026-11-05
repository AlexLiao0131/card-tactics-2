import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PvpLobbyController} from '../../js/pvp-lobby.js';

const read = path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('native app has one Babylon battle canvas, original deck and preparation screens, and no parallel 2D online game',()=>{
  const html=read('index.html');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length,'DOM IDs must be unique');
  for(const id of ['deckScreen','preparationScreen','startPreparedBattle','battleScreen','battleCanvas',
    'pvpRoomScreen','pvpPrepareDeck','skillBar','versusPvp'])
    assert.ok(ids.includes(id),`${id} must be part of the original game shell`);
  assert.deepEqual([...html.matchAll(/<canvas\s[^>]*id="([^"]+)"/g)].map(m=>m[1]),['battleCanvas']);
  assert.doesNotMatch(html,/iframe|battlefieldCanvas|pvp3dCanvas/);
  assert.doesNotMatch(html,/id=\"openingPanel\"|id=\"mulliganOpening\"|id=\"openingHand\"/);
  assert.match(html,/src="\.\/js\/main\.js"/);
  const legacy=read('multiplayer.html');
  assert.match(legacy,/location\.replace\(to\.href\)/);
  assert.doesNotMatch(legacy,/pvp-lobby\.js|babylon\.js|<canvas/);
  const main=read('js/main.js');
  assert.match(main,/new ShellUI\(runtime,null\)/);
  assert.match(main,/new PvpLobbyController\(\{shell,createSharedRenderer:sharedBattleRenderer,cardUI,battleUI,unitControlUI\}\)/);
  assert.match(main,/onTilePicked:\(x,y\)=>pvp\?\.isBattleActive\(\)/);
  // The PVP controller owns original deck-screen entry; ShellUI only forwards navigation.
  const shell=read('js/shell-ui.js'),pvpLobby=read('js/pvp-lobby.js');
  assert.match(shell,/attachPvp\(controller\)\{this\.pvp=controller/);
  assert.match(shell,/this\.pvp\?\.openLobby\(/);
  assert.match(shell,/this\.pvp\?\.suspendForLocalBattle\(/);
  assert.match(pvpLobby,/this\.shell\.openDeck\(/);
  assert.match(read('js/card-hand-ui.js'),/setRemoteCards\(/);
  assert.doesNotMatch(read('js/pvp-lobby.js'),/displayOpening\(|mulliganOpening|openingHand/);
});

function fakeDom(){
  const map=new Map();
  const node=name=>{
    if(!map.has(name)){
      const el={hidden:false,disabled:false,textContent:'',dataset:{},value:'',
        querySelector:selector=>node(`${name}:${selector}`)};
      map.set(name,el);
    }
    return map.get(name);
  };
  const previous={document:globalThis.document,sessionStorage:globalThis.sessionStorage,WebSocket:globalThis.WebSocket};
  const storage=new Map();
  globalThis.document={getElementById:node,body:{dataset:{}}};
  globalThis.sessionStorage={setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)};
  globalThis.WebSocket={OPEN:1};
  return {node,restore(){Object.assign(globalThis,previous);}};
}

test('existing ShellUI owns online room -> original deck -> full-screen battle; reconnect messages cannot hijack an offline game',()=>{
  const {node,restore}=fakeDom();
  try{
    const shown=[],decks=[],presented=[],matches=[];
    const shell={show:id=>shown.push(id),openDeck:args=>decks.push(args)};
    const cardViews=[];
    const cardUI={setRemoteCards:args=>cardViews.push(args),clearRemoteCards:()=>cardViews.push(null)};
    const controller=new PvpLobbyController({shell,cardUI,createSharedRenderer:()=>({sync(){}})});
    controller.connect=async()=>{}; // Network is covered by the separate Worker WebSocket tests.
    controller.setSession({code:'ABCDEFGH',token:'a'.repeat(64),seat:0});
    controller.room={phase:'LOBBY',seats:[{name:'host',deckSubmitted:true,ready:false,online:true},null]};
    controller.openLobby();
    controller.openPreparation();
    assert.deepEqual(decks,[{from:'pvpRoomScreen',deploy:true}]);
    assert.equal(shown.at(-1),'pvpRoomScreen');
    controller.createTacticalUI=()=>{
      if(!controller.tacticalUI)controller.tacticalUI={
        setPresented:value=>presented.push(value),receiveMatch:match=>matches.push(match),
        update:()=>{},receiveRender:async()=>{},close:()=>{}
      };
      return controller.tacticalUI;
    };
    controller.displayMatch({revision:0,tacticalEnabled:true,
      view:{seat:0,phase:'BATTLEFIELD_READY',activeSeat:null}});
    assert.equal(shown.at(-1),'battleScreen');
    assert.equal(controller.isBattleActive(),true);
    assert.equal(globalThis.document.body.dataset.battleMode,'PVP');
    assert.equal(presented.at(-1),true);
    controller.backToLobby();
    assert.equal(shown.at(-1),'pvpRoomScreen');
    assert.equal(presented.at(-1),false);
    const count=shown.length;
    controller.displayMatch({revision:1,tacticalEnabled:true,
      view:{seat:0,phase:'PLAYER_CARD_PHASE',activeSeat:0}});
    assert.equal(shown.length,count,'a WebSocket match state must not force the player out of the room');
    controller.suspendForLocalBattle();
    controller.displayMatch({revision:2,tacticalEnabled:true,
      view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0}});
    assert.equal(shown.length,count,'no remote snapshot may steal a local battle screen');
    assert.equal(presented.at(-1),false);
    controller.leaveLobby();
    assert.equal(shown.at(-1),'versusScreen');
    assert.equal(controller.suspendedBattle,true);
    const left=shown.length;
    controller.displayMatch({revision:3,tacticalEnabled:true,
      view:{seat:0,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0}});
    assert.equal(shown.length,left,'a pending remote match cannot open battle after leaving the room');
    controller.enterBattle();
    assert.equal(shown.at(-1),'battleScreen');
    assert.equal(presented.at(-1),true);
    controller.exitRoom();
    assert.equal(globalThis.document.body.dataset.battleMode,'LOCAL');
    assert.equal(shown.at(-1),'versusScreen');
    assert.equal(controller.isBattleActive(),false);
    assert.ok(matches.length>=3);
  }finally{restore();}
});


test('PvP opening hand uses the original CardHandUI on battleScreen, never a second lobby list',()=>{
  const {node,restore}=fakeDom();
  try{
    const displayed=[],sync=[],commands=[];
    const cardUI={setRemoteCards:v=>sync.push(v),clearRemoteCards:()=>sync.push(null)};
    const shell={show:id=>displayed.push(id),openDeck:()=>{}};
    const p=new PvpLobbyController({shell,cardUI,createSharedRenderer:()=>({sync(){}})});
    p.setSession({code:'ABCDEFGH',token:'a'.repeat(64),seat:0});
    p.room={phase:'OPENING_HAND',seats:[{name:'Host',ready:true,deckSubmitted:true},
      {name:'Guest',ready:true,deckSubmitted:true}]};
    p.socket={readyState:1,send:s=>commands.push(JSON.parse(s))};
    const cards=[{id:'alpha',name:'A'},{id:'beta',name:'B'}];
    p.displayMatch({revision:3,protocol:'test',tacticalEnabled:true,
      view:{phase:'OPENING_HAND',seat:0,activeSeat:0,
        own:{hand:cards,deckCount:18,openingDecisionAvailable:true},
        opponent:{handCount:3}}});
    assert.equal(displayed.at(-1),'battleScreen');
    assert.equal(node('openingPanel').hidden,false,'the controller never touches the legacy opening DOM');
    assert.equal(globalThis.document.body.dataset.pvpPhase,'OPENING_HAND');
    assert.deepEqual(sync.at(-1).hand,cards);
    assert.equal(sync.at(-1).canAct,true);
    assert.equal(sync.at(-1).deckCount,18);
    assert.equal(sync.at(-1).opponentHandCount,3);
    assert.equal(sync.at(-1).onDecision({type:'MULLIGAN',indices:[1]}),true);
    assert.equal(commands.length,1);
    assert.deepEqual(commands[0].envelope.action,{type:'MULLIGAN',indices:[1]});
    assert.equal(sync.at(-1).canAct,false,'after sending, online card UI is disabled');
    p.backToLobby();
    assert.equal(displayed.at(-1),'pvpRoomScreen');
    assert.equal(sync.at(-1),null);
    assert.equal('pvpPhase' in globalThis.document.body.dataset,false);
    p.suspendForLocalBattle();
    const count=displayed.length;
    p.displayMatch({revision:4,protocol:'test',tacticalEnabled:true,
      view:{phase:'OPENING_HAND',seat:0,activeSeat:1,
        own:{hand:cards,deckCount:18,openingDecisionAvailable:false},
        opponent:{handCount:3}}});
    assert.equal(displayed.length,count,'no auto-hijack after suspension');
    assert.equal(sync.at(-1),null);
    // Resuming during the real card phase must present the same fan-card UI.
    p.enterBattle();
    p.tacticalUI={setPresented:()=>{},receiveMatch:()=>{},update:()=>{},close:()=>{},
      chooseCard:id=>`TARGET:${id}`,cancelCardTarget:()=>{}};
    p.displayMatch({revision:5,protocol:'test',tacticalEnabled:true,
      view:{phase:'PLAYER_CARD_PHASE',seat:0,activeSeat:0,
        own:{hand:cards,deckCount:18,crystals:4},opponent:{handCount:3}}});
    assert.equal(globalThis.document.body.dataset.pvpPhase,'CARD_PHASE');
    assert.equal(sync.at(-1).phase,'CARD_PHASE');
    assert.equal(sync.at(-1).onPlayCard('alpha'),'TARGET:alpha');
    assert.equal(sync.at(-1).onEndCard(),true);
    assert.deepEqual(commands.at(-1).envelope.action,{type:'END_CARD_PHASE'});
  }finally{restore();}
});
