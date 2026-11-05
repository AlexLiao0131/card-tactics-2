/**
 * Online session coordinator for the EXISTING Card Tactics 2.0 game shell.
 *
 * The room has no game renderer, deck editor, battle rules, or independent
 * gameplay scene. ShellUI owns screen changes and the official battle screen;
 * DeckEngine/ItemInventoryEngine own preparation; the server owns outcomes.
 * This module owns only authenticated room I/O, reconnects, and private views.
 */
import { PVP_API_BASE } from './pvp-config.js';
import { DeckEngine } from './deck-engine.js';
import { ItemInventoryEngine } from './item-inventory-engine.js';
import { PvpTacticalUI } from './pvp-tactical-ui.js';
import { PvpBattleRenderBridge } from './pvp-battle-render-bridge.js';
import { applyRenderUpdate } from './pvp-render-delta.js';
import { presentBattleOverview, presentBattleWeather } from './battle-ui.js';

const $=id=>document.getElementById(id);
const SESSION_KEY='ct2:pvp-lobby-session:v1';
const GAME_PHASES=new Set(['BATTLEFIELD_READY','PLAYER_CARD_PHASE','PLAYER_TACTICAL_PHASE',
  'ENEMY_CARD_PHASE','ENEMY_TACTICAL_PHASE','PVP_REACTION_PENDING','MATCH_ENDED']);
function codeOrNull(input){
  const code=String(input||'').toUpperCase().replace(/[\s-]/g,'');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code)?code:null;
}
function nameOrNull(input){
  return String(input||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,24)||null;
}
function apiOrigin(){
  try {
    const origin=new URL(PVP_API_BASE);
    return origin.protocol==='https:'&&!origin.username&&!origin.password&&
      !origin.search&&!origin.hash&&origin.pathname==='/'?origin.origin:null;
  }catch{return null;}
}
function isValidSession(value){
  return !!(value&&codeOrNull(value.code)===value.code&&
    /^[a-f0-9]{64}$/.test(value.token||'')&&[0,1].includes(value.seat));
}
export class PvpLobbyController {
  constructor({shell,createSharedRenderer,cardUI,battleUI,unitControlUI}={}){
    if(!shell||typeof createSharedRenderer!=='function'||
       typeof cardUI?.setRemoteCards!=='function'||typeof cardUI?.clearRemoteCards!=='function')
      throw Error('NATIVE_PVP_SHELL_REQUIRED');
    this.shell=shell;
    this.createSharedRenderer=createSharedRenderer;
    this.cardUI=cardUI;
    this.battleUI=battleUI||null;
    this.unitControlUI=unitControlUI||null;
    this.session=null;
    this.socket=null;
    this.room=null;
    this.match=null;
    this.tacticalUI=null;
    this.reconnects=0;
    this.reconnectTimer=null;
    this.commandInFlight=false;
    this.lastCommand=null;
    this.renderError=null;
    this.generation=0;
    this.readyToBattle=false;
    this.battleVisible=false;
    this.suspendedBattle=false;
    this.pendingRender=null;
    this.renderBaseline=null;
    this.renderResyncPending=false;
  }
  isBattleActive(){return !!(this.session&&this.battleVisible);}
  isConnected(){return this.socket?.readyState===WebSocket.OPEN;}
  status(message,bad=false){
    $('lobbyStatus').textContent=message;
    $('lobbyStatus').dataset.error=String(bad);
    if(this.battleVisible&&bad){const display=$('turnStatus');
      // Server command rejection is not a dropped socket. Preserve the exact
      // reason instead of mislabeling every gameplay validation as a disconnect.
      if(display)display.textContent=message;}
  }
  async api(path,{name,token,cards,inventory}={}){
    const origin=apiOrigin();if(!origin)throw Error('PVP_SERVER_NOT_CONFIGURED');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch(`${origin}${path}`,{
        method:'POST',headers:{'Content-Type':'application/json',
          ...(token?{'Authorization':`Bearer ${token}`}:{})},
        body:JSON.stringify(cards?{cards,...(inventory?{inventory}:{})}:name?{name}:{}),signal:controller.signal
      });
      const body=await response.json();
      if(!response.ok)throw Error(body.error||`HTTP_${response.status}`);
      return body;
    }finally{clearTimeout(timeout);}
  }
  bind(){
    $('createRoom').onclick=()=>this.createRoom();
    $('joinRoom').onclick=()=>this.joinRoom();
    $('pvpRoomBack').onclick=()=>this.leaveLobby();
    $('pvpPrepareDeck').onclick=()=>this.openPreparation();
    $('pvpResumeBattle').onclick=()=>this.enterBattle();
    $('readyToggle').onclick=()=>{
      if(!this.isConnected()||!this.room||!this.session)return;
      const me=this.room.seats?.[this.session.seat];
      this.socket.send(JSON.stringify({type:'SET_READY',ready:!me?.ready}));
    };
    $('retryRoom').onclick=()=>{this.reconnects=0;void this.connect();};
    $('exitRoom').onclick=()=>this.exitRoom();
    $('copyInvite').onclick=async()=>{
      if(!this.session)return;
      const invite=new URL('./index.html',location.href);
      invite.searchParams.set('mode','pvp');
      invite.searchParams.set('room',this.session.code);
      try{await navigator.clipboard.writeText(invite.href);this.status('已複製邀請連結。');}
      catch{this.status(`邀請連結：${invite.href}`);}
    };
    $('joinCode').value=codeOrNull(new URL(location.href).searchParams.get('room'))||'';
    const origin=apiOrigin();
    $('connect').textContent=origin?`連線伺服器：${origin}`:'Cloudflare 伺服器網址尚未設定';
    $('createRoom').disabled=!origin;
    $('joinRoom').disabled=!origin;
    try{
      const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
      if(isValidSession(saved))this.setSession(saved);
    }catch{sessionStorage.removeItem(SESSION_KEY);}
    if(new URL(location.href).searchParams.get('mode')==='pvp')this.openLobby();
    this.refreshRoom();
  }
  openLobby(){
    this.cardUI.clearRemoteCards();
    delete document.body.dataset.pvpPhase;
    this.battleVisible=false;
    this.tacticalUI?.setPresented(false);
    this.battleUI?.leaveOnline?.();
    this.shell.show('pvpRoomScreen');
    if(this.session&&!this.isConnected())void this.connect();
    this.refreshRoom();
  }
  backToLobby(){this.suspendedBattle=true;this.openLobby();}
  leaveLobby(){
    this.cardUI.clearRemoteCards();
    delete document.body.dataset.pvpPhase;
    // Returning to the mode menu suspends this online presentation. Remote
    // packets continue to be received without stealing the native battle UI.
    this.suspendedBattle=true;
    this.battleVisible=false;
    this.tacticalUI?.setPresented(false);
    this.battleUI?.leaveOnline?.();
    this.shell.show('versusScreen');
  }
  // Going to a local/Gemini match leaves the room connected but hands all
  // presentation and input ownership to the original local game runtime.
  suspendForLocalBattle(){
    if(!this.session)return;
    this.cardUI.clearRemoteCards();
    delete document.body.dataset.pvpPhase;
    this.suspendedBattle=true;
    this.battleVisible=false;
    this.tacticalUI?.setPresented(false);
    this.battleUI?.leaveOnline?.();
  }
  openPreparation(){
    if(!this.session)return this.status('請先建立或加入房間。',true);
    if(this.room?.phase&&this.room.phase!=='LOBBY')return this.status('對戰已建立，不能再更換牌組。',true);
    // EXACTLY the same ShellUI collection -> deck -> equipment preparation
    // workflow as local/Gemini: no PvP-specific deck picker or replica rules.
    this.shell.openDeck({from:'pvpRoomScreen',deploy:true});
  }
  async submitPreparedDeck(deck){
    if(!this.session||this.room?.phase!=='LOBBY')
      throw Error('ROOM_NOT_ACCEPTING_DECK');
    const checked=DeckEngine.validate(deck);
    if(!checked.valid)throw Error(checked.errors.join('；'));
    this.status('正在提交正式 20 張出擊牌組…');
    const seat=this.session;
    const result=await this.api(`/v1/rooms/${seat.code}/deck`,{
      token:seat.token,cards:checked.deck,inventory:ItemInventoryEngine.matchPreparationForDeck(checked.deck)
    });
    if(this.session!==seat)throw Error('SESSION_CHANGED');
    if(!result.deckSubmitted)throw Error('DECK_NOT_SUBMITTED');
    this.status('出擊牌組已驗證；等待兩位玩家準備。');
    this.refreshRoom();
    return true;
  }
  setSession(value){
    this.cardUI.clearRemoteCards();
    delete document.body.dataset.pvpPhase;
    this.closeSocket();
    this.tacticalUI?.close();this.tacticalUI=null;
    this.battleUI?.leaveOnline?.();
    this.session=value;
    this.room=null;this.match=null;
    this.readyToBattle=false;this.battleVisible=false;
    this.suspendedBattle=false;this.pendingRender=null;
    this.renderBaseline=null;this.renderResyncPending=false;
    this.renderError=null;
    if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
    this.refreshRoom();
  }
  closeSocket(){
    this.generation++;
    clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
    const previous=this.socket;
    this.socket=null;
    if(previous){
      previous.onopen=previous.onmessage=previous.onerror=previous.onclose=null;
      try{previous.close(1000,'CLOSED');}catch{}
    }
    this.commandInFlight=false;
  }
  exitRoom(){
    this.setSession(null);
    this.shell.show('versusScreen');
    document.body.dataset.battleMode='LOCAL';
    this.status('已離開房間畫面。');
  }
  async createRoom(){
    const name=nameOrNull($('playerName').value);
    if(!name)return this.status('請輸入玩家暱稱。',true);
    $('createRoom').disabled=true;
    try{
      this.status('建立房間中…');
      const response=await this.api('/v1/rooms',{name});
      this.setSession({code:response.code,token:response.token,seat:response.seat});
      await this.connect();
    }catch(error){this.status(`建立房間失敗：${error.message}`,true);}
    finally{$('createRoom').disabled=false;}
  }
  async joinRoom(){
    const name=nameOrNull($('playerName').value),code=codeOrNull($('joinCode').value);
    if(!name||!code)return this.status('請輸入玩家暱稱與合法房間碼。',true);
    $('joinRoom').disabled=true;
    try{
      this.status('加入房間中…');
      const response=await this.api(`/v1/rooms/${code}/join`,{name});
      this.setSession({code:response.code,token:response.token,seat:response.seat});
      await this.connect();
    }catch(error){this.status(`加入房間失敗：${error.message}`,true);}
    finally{$('joinRoom').disabled=false;}
  }
  refreshRoom(){
    $('setupView').hidden=!!this.session;
    $('roomView').hidden=!this.session;
    if(!this.session)return;
    $('roomCode').textContent=this.session.code;
    for(let i=0;i<2;i++){
      const source=this.room?.seats?.[i]||null,root=$(i===0?'seatA':'seatB');
      root.querySelector('[data-name]').textContent=source?.name||'等待玩家加入';
      root.querySelector('[data-status]').textContent=source
        ?`${source.online?'在線':'離線'}｜${source.ready?'準備完成':'尚未準備'}｜${source.deckSubmitted?'牌組已提交':'尚未提交'}${this.session.seat===i?'｜你':''}`
        :'空位';
    }
    const stage=this.room?.phase||'LOBBY',me=this.room?.seats?.[this.session.seat];
    $('pvpPrepareDeck').disabled=stage!=='LOBBY';
    $('pvpResumeBattle').hidden=!this.readyToBattle;
    $('readyToggle').disabled=stage!=='LOBBY'||!this.isConnected()||!me?.deckSubmitted;
    $('readyToggle').textContent=me?.ready?'取消準備':'我已準備';
    $('pvpDeckSummary').textContent=me?.deckSubmitted?'已提交：伺服器確認合法的 20 張牌組'
      :'請先使用原本卡牌整備流程選定出擊牌組（20 張）。';
    $('bothReady').textContent=stage==='LOBBY'?'等待雙方提交牌組及準備':
      stage==='OPENING_HAND'?'雙方確認起手牌中':
      '已進入伺服器權威對局；返回戰場可繼續操作。';
    if(stage!=='LOBBY'){
      $('pvpPrepareDeck').disabled=true;
    }
  }
  syncNativeCards(){
    const view=this.match?.view;
    const opening=view?.phase==='OPENING_HAND';
    const cardPhase=['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'].includes(view?.phase);
    const tacticalPhase=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE','PVP_REACTION_PENDING'].includes(view?.phase);
    // The original CardHandUI stays mounted through tactical and reaction phases.
    // The authority's private hand must never be replaced by the offline hand.
    if(!this.battleVisible||(!opening&&!cardPhase&&!tacticalPhase)){
      this.cardUI.clearRemoteCards();
      delete document.body.dataset.pvpPhase;
      return;
    }
    document.body.dataset.pvpPhase=opening?'OPENING_HAND':cardPhase?'CARD_PHASE':'TACTICAL_PHASE';
    this.cardUI.setRemoteCards({
      phase:opening?'OPENING_HAND':cardPhase?'CARD_PHASE':'TACTICAL_PHASE',
      matchId:this.session.code,seat:this.session.seat,
      hand:view.own?.hand||[],deckCount:view.own?.deckCount,
      opponentHandCount:view.opponent?.handCount,
      crystals:cardPhase?view.own?.crystals??null:null,
      canAct:(opening||cardPhase)&&view.activeSeat===this.session.seat&&
        (!opening||view.own?.openingDecisionAvailable===true)&&
        this.isConnected()&&!this.commandInFlight,
      onDecision:action=>this.sendCommand(action),
      onPlayCard:cardId=>this.tacticalUI?.chooseCard(cardId)||false,
      onEndCard:()=>this.sendCommand({type:'END_CARD_PHASE'}),
      onCancel:()=>this.tacticalUI?.cancelCardTarget()
    });
    if(opening)$('turnStatus').textContent='PVP｜起手牌確認';
  }
  // Same original Core presenter, updated from the lightweight authority view.
  // It must not depend on completion of an unrelated Babylon rendering cycle.
  syncMatchCoreHud(){
    if(!this.battleVisible||!this.match?.view?.battlefield?.cores)return;
    const view=this.match.view,battlefield=view.battlefield;
    const stage={mode:'VERSUS',ruleset:'CORE_CAPTURE',
      deploymentPoints:battlefield.deploymentPoints||[],
      generatedBattlefield:{size:battlefield.meta?.size,seed:battlefield.meta?.seed}};
    presentBattleOverview({snapshot:{units:this.tacticalUI?.serverSnapshot?.units||[],
      map:battlefield.map,presentation:{deploymentPoints:stage.deploymentPoints}},
      cores:battlefield.cores,stage,phase:view.phase,seat:this.session?.seat,online:true});
  }
  createTacticalUI(){
    if(this.tacticalUI)return this.tacticalUI;
    const seat=this.session.seat;
    this.tacticalUI=new PvpTacticalUI({
      onRendered:snapshot=>this.presentServerBattle(snapshot),
      root:$('skillBar'),canvas:$('battleCanvas'),seat,
      onInspect:id=>this.battleUI?.openStatus(id),
      onSelection:(unit,options)=>this.unitControlUI?.renderOnline(unit,options),
      sendCommand:action=>this.sendCommand(action),
      isConnected:()=>this.isConnected(),
      ensureBabylon:async()=>{
        if(typeof globalThis.BABYLON?.Engine!=='function')throw Error('BABYLON_RUNTIME_NOT_LOADED');
      },
      createBridge:async(options)=>new PvpBattleRenderBridge({
        ...options,ownsRenderer:false,
        createRenderer:(canvas,snapshot)=>this.createSharedRenderer(canvas,snapshot)
      })
    });
    this.tacticalUI.setPresented(this.battleVisible);
    return this.tacticalUI;
  }
  displayMatch(data){
    if(!this.session||data?.view?.seat!==this.session.seat)return;
    if(this.match&&data.revision<this.match.revision)return;
    this.match=data;
    // The original ItemInventoryEngine reconciles canonical consumptions once
    // per room/seat, including WebSocket reconnect and repeated revisions.
    if(data.view?.own?.itemConsumptions)
      ItemInventoryEngine.reconcileMatchConsumption(this.session.code,this.session.seat,
        data.view.own.itemConsumptions);
    this.commandInFlight=false;
    const view=data.view;
    if(view.phase==='OPENING_HAND'){
      this.readyToBattle=true;
      this.refreshRoom();
      if(!this.battleVisible&&!this.suspendedBattle)this.enterBattle();
      else this.syncNativeCards();
      return;
    }
    if(GAME_PHASES.has(view.phase)){
      if(data.tacticalEnabled!==true){
        this.syncNativeCards();
        this.status('Cloudflare Worker 未開啟戰棋權威連線，請核對已部署的 Worker 版本。',true);
        return;
      }
      this.readyToBattle=true;
      this.createTacticalUI().receiveMatch(data);
      this.syncNativeCards();
      this.syncMatchCoreHud();
      if(view.phase==='BATTLEFIELD_READY'&&this.session.seat===0)
        this.sendCommand({type:'BEGIN_BATTLE'});
      if(!this.battleVisible&&!this.suspendedBattle)this.enterBattle();
    }else{
      this.syncNativeCards();
      this.refreshRoom();
      this.openLobby();
    }
  }
  enterBattle(){
    if(!this.session||!this.readyToBattle)return;
    this.suspendedBattle=false;
    this.battleVisible=true;
    document.body.dataset.battleMode='PVP';
    this.syncNativeCards();
    this.shell.show('battleScreen');
    this.syncMatchCoreHud();
    this.tacticalUI?.setPresented(true);
    if(this.pendingRender){
      const latest=this.pendingRender;this.pendingRender=null;
      void this.tacticalUI?.receiveRender(latest);
    }
  }
  presentServerBattle(snapshot){
    // HUD is the SAME presenter used by the single-player BattleUI. Server
    // presentation is read-only; this never derives or changes battle rules.
    const battlefield=this.match?.view?.battlefield;
    const cores=battlefield?.cores||snapshot?.cores||[];
    const stage={mode:'VERSUS',ruleset:'CORE_CAPTURE',
      deploymentPoints:battlefield?.deploymentPoints||snapshot?.presentation?.deploymentPoints||[],
      generatedBattlefield:{size:battlefield?.meta?.size,seed:battlefield?.meta?.seed}};
    if(this.battleUI)this.battleUI.presentOnline(snapshot,{cores,stage,
      phase:this.match?.view?.phase,seat:this.session?.seat,
      battleLog:this.match?.view?.battleLog||[]});
    else{
      presentBattleOverview({snapshot,cores,stage,
        phase:this.match?.view?.phase,seat:this.session?.seat,online:true});
      presentBattleWeather(snapshot);
    }
    const phase=this.match?.view?.phase||'',seat=this.session?.seat;
    const mine=this.match?.view?.activeSeat===seat;
    const phaseLabel=phase==='MATCH_ENDED'?'戰鬥結束':
      phase==='PVP_REACTION_PENDING'?'交戰應對':
      phase==='BATTLEFIELD_READY'?'準備進入戰場':
      phase.includes('CARD_PHASE')?`${mine?'我方':'敵方'}卡牌階段`:
      phase.includes('TACTICAL_PHASE')?`${mine?'我方':'敵方'}戰棋階段`:'對戰中';
    $('turnStatus').textContent=`Round ${snapshot.round}｜${phaseLabel}`;
  }
  tilePicked(x,y){
    if(this.battleVisible)this.tacticalUI?.tilePicked({seat:this.session?.seat,x,y});
  }
  sendCommand(action){
    if(!this.session||!this.match||this.commandInFlight||!this.isConnected())return false;
    const allowed=this.match.view?.activeSeat===this.session.seat ||
      (action?.type==='BEGIN_BATTLE'&&this.session.seat===0&&this.match.view?.phase==='BATTLEFIELD_READY');
    if(!allowed)return false;
    const commandId=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
    this.commandInFlight=true;
    // Prevent repeated online mulligans until a newer server state/ACK arrives.
    if(this.match.view?.phase==='OPENING_HAND')this.syncNativeCards();
    this.lastCommand={type:'MATCH_COMMAND',envelope:{
      protocol:this.match.protocol,baseRevision:this.match.revision,commandId,action
    }};
    try{this.socket.send(JSON.stringify(this.lastCommand));return true;}
    catch(error){this.commandInFlight=false;this.syncNativeCards();this.status(`提交操作失敗：${error.message}`,true);return false;}
  }
  requestFullRender(){
    if(this.renderResyncPending||!this.isConnected()||!this.session)return false;
    this.renderResyncPending=true;
    try {this.socket.send(JSON.stringify({type:'REQUEST_RENDER_SNAPSHOT'}));return true;}
    catch {this.renderResyncPending=false;return false;}
  }
  async connect(){
    if(!this.session)return;
    this.closeSocket();
    const generation=this.generation;
    const session=this.session;
    this.status('正在取得一次性連線票證…');
    try{
      const response=await this.api(`/v1/rooms/${session.code}/ticket`,{token:session.token});
      if(generation!==this.generation||this.session!==session)return;
      const socket=new WebSocket(`${apiOrigin().replace(/^https:/,'wss:')}/v1/rooms/${session.code}/socket?ticket=${response.ticket}`);
      this.socket=socket;
      this.renderBaseline=null;
      this.renderResyncPending=false;
      this.pendingRender=null;
      socket.onopen=()=>{
        if(socket!==this.socket)return;
        this.reconnects=0;
        this.status('已連上房間。');
        this.refreshRoom();this.tacticalUI?.update();this.syncNativeCards();
        if(this.match?.view?.phase==='BATTLEFIELD_READY'&&session.seat===0)
          this.sendCommand({type:'BEGIN_BATTLE'});
      };
      socket.onmessage=event=>{
        if(socket!==this.socket)return;
        let packet;
        try{packet=JSON.parse(event.data);}catch{return;}
        if(!packet||typeof packet!=='object')return;
        if(packet.type==='ROOM_STATE'||packet.type==='WELCOME'){
          if(packet.room?.code===session.code){this.room=packet.room;this.refreshRoom();}
        }
        if(packet.type==='MATCH_STATE')this.displayMatch(packet.match);
        if(packet.type==='PVP_RENDER_SNAPSHOT'||packet.type==='PVP_RENDER_DELTA'){
          // Decode against the authenticated seat stream, never local game rules.
          // A lost delta is repaired by an explicit server FULL, not guessed.
          try {
            const full=applyRenderUpdate(this.renderBaseline,packet);
            if(full.matchId!==this.session.code||full.seat!==this.session.seat)
              throw Error('PVP_RENDER_SESSION_MISMATCH');
            this.renderBaseline=full;
            this.renderResyncPending=false;
            if(this.battleVisible)void this.tacticalUI?.receiveRender(full);
            else if(!this.pendingRender||full.revision>=this.pendingRender.revision)
              this.pendingRender=full;
          } catch {
            this.requestFullRender();
          }
        }
        if(packet.type==='PVP_RENDER_ERROR'){
          this.renderError=packet.error;
          this.status(`權威 3D 畫面產生失敗：${packet.error}`,true);
        }
        if(packet.type==='MATCH_ACK'){
          const pending=this.lastCommand?.envelope;
          if(pending && packet.commandId!==pending.commandId)return;
          // Server committed the requested card, not merely received a socket
          // frame. Only NOW may the shared hand and battlefield exit aiming.
          if(pending?.commandId===packet.commandId &&
              ['DEPLOY_CARD','PLAY_TARGET_CARD'].includes(pending.action?.type)){
            this.tacticalUI?.cancelCardTarget();
            this.cardUI?.acceptRemoteCardTarget?.();
          }
          this.commandInFlight=false;
          this.lastCommand=null;
          this.syncNativeCards();
        }
        if(packet.type==='ERROR'){
          // A declined deployment does NOT consume the card or end targeting.
          this.commandInFlight=false;
          this.lastCommand=null;
          this.syncNativeCards();
          this.status(`伺服器拒絕操作：${packet.error}`,true);
          this.tacticalUI?.update();
        }
      };
      socket.onerror=()=>this.status('WebSocket 連線異常。',true);
      socket.onclose=event=>{
        if(socket!==this.socket||!this.session)return;
        this.socket=null;
        this.refreshRoom();
        this.tacticalUI?.update();this.syncNativeCards();
        if(event.code===4002){this.status('房間已過期，請重新建立。',true);return;}
        if(event.code===4001){this.status('同席位已由其他裝置連線。',true);return;}
        if(this.reconnects>=5){this.status('自動重連失敗，請使用「重新連線」。',true);return;}
        this.reconnects++;
        this.status(`連線中斷，重試中（${this.reconnects}/5）…`,true);
        this.reconnectTimer=setTimeout(()=>void this.connect(),Math.min(15000,1000*2**this.reconnects));
      };
    }catch(error){this.status(`連線失敗：${error.message}`,true);}
  }
}
