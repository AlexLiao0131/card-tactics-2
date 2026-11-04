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
    'pvpRoomScreen','pvpPrepareDeck','pvpTacticalPanel','versusPvp'])
    assert.ok(ids.includes(id),`${id} must be part of the original game shell`);
  assert.deepEqual([...html.matchAll(/<canvas\s[^>]*id="([^"]+)"/g)].map(m=>m[1]),['battleCanvas']);
  assert.doesNotMatch(html,/iframe|battlefieldCanvas|pvp3dCanvas/);
  assert.match(html,/src="\.\/js\/main\.js"/);
  const legacy=read('multiplayer.html');
  assert.match(legacy,/location\.replace\(to\.href\)/);
  assert.doesNotMatch(legacy,/pvp-lobby\.js|babylon\.js|<canvas/);
  const main=read('js/main.js');
  assert.match(main,/new ShellUI\(runtime,null\)/);
  assert.match(main,/new PvpLobbyController\(\{shell,createSharedRenderer:sharedBattleRenderer\}\)/);
  assert.match(main,/onTilePicked:\(x,y\)=>pvp\?\.isBattleActive\(\)/);
  assert.match(read('js/shell-ui.js'),/this\.shell\.openDeck|this\.pvp\?\.openLobby|this\.pvp\?\.suspendForLocalBattle/);
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
    const controller=new PvpLobbyController({shell,createSharedRenderer:()=>({sync(){}})});
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
