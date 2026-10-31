import { TILE_SIZE,ELEVATION_HEIGHT,UNIT_VISUAL_HEIGHT } from "./coordinate-system.js";
(()=>{
  const ICON={PLAIN:"",MUD:"≋",FOREST:"🌲",HIGH_GROUND:"▲",WATER:"≈",WALL:"■"};
  const TEAM={PLAYER:"P",ENEMY:"E",NEUTRAL:"N"};
  const skillBar=document.getElementById("skillBar");
  const PHASE={CARD:"CARD_PHASE",PLAYER:"PLAYER_TURN",ENEMY:"ENEMY_TURN",ENDED:"MATCH_ENDED"};

  let map,units,selected,mode,selectedSkill,selectedSkillVariant,logs,round,phase,matchResult,stage,stageState,environmentState,inspectedTile,cores=[];
  let logState=BattleLog.create(),cardState=null,enemyCardState=null,pendingCard=null,unitSerial=0;
  let enemyView={active:false,kind:null,message:"",cardId:null,unitId:null};
  let pendingEngagement=null;
  let engagementFocusSerial=0;
  let supportSelection=new Map();
  let pendingCopySkill=null;
  let battleContext=null,enemyController=null,cardPhaseController=null,presentationController=null,objectiveController=null,environmentController=null,coreCaptureController=null,deathLifecycle=null,encounterRewards=null;
  let renderRevision=0;
  let debugEnvironmentSteps=0;
  let pendingEnemyAttack=null;
  let pendingReactionType=null;
  let selectedGuardian=null;
  let selectedGuardInterception=null;
  let commandPanelCollapsed=false;
  let hallucinationSession=null;
  const pendingHallucinations=new Map();
  let hallucinationSerial=0;

  // Gemini is opt-in, with a user-entered bearer token kept only in this page's
  // runtime memory. Never commit secrets into GitHub Pages, localStorage, or logs.
  const GEMINI_WORKER="https://card-tactics-gemini-ai.as315012.workers.dev";
  let geminiSession=null,geminiSerial=0;
  const matchId=()=>"match_"+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,"0")).join("");
  async function geminiRequest(endpoint,payload){
    const session=geminiSession;
    if(!session?.token)return null;
    const requestSerial=++geminiSerial;
    session.lastError=null;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),18000);
    try{
      const response=await fetch(`${GEMINI_WORKER}${endpoint}`,{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.token}`},
        body:JSON.stringify({...payload,battle_id:session.battleId,revision:requestSerial}),signal:controller.signal
      });
      let data=null;
      try{data=await response.json();}catch{throw Error(`HTTP_${response.status}_INVALID_JSON`);}
      if(geminiSession!==session)return null;
      if(!response.ok)throw Error(String(data?.error||`HTTP_${response.status}`));
      if(data?.battle_id!==session.battleId||data?.revision!==requestSerial)throw Error("RESPONSE_MISMATCH");
      return data;
    }catch(error){
      if(session===geminiSession){
        session.lastError=error?.name==="AbortError"?"REQUEST_TIMEOUT":
          error instanceof TypeError?"NETWORK_OR_CORS_ERROR":String(error?.message||"NETWORK_ERROR").slice(0,100);
      }
      return null;
    }finally{clearTimeout(timeout);}
  }
  async function geminiDecide({phase,legalActions,snapshot,roundNumber}){
    if(!geminiSession?.enabled||!legalActions?.length)return null;
    const result=await geminiRequest("/v1/decision",{
      turn:Math.max(0,Number(roundNumber||round||0)),phase,
      snapshot,legal_actions:legalActions.map(a=>({id:a.id,kind:a.kind,label:a.label}))
    });
    if(!result && geminiSession?.lastError){
      const message=geminiSession.lastError;
      if(geminiSession.lastLoggedError!==message){
        geminiSession.lastLoggedError=message;
        pushLog(`Gemini 暫時無法決策（${message}），本次改用原本 AI。`,"SYSTEM");
      }
    }
    return legalActions.some(a=>a.id===result?.action_id)?result.action_id:null;
  }
  async function geminiMulligan(state){
    if(!geminiSession?.enabled)return null;
    const hand=(state?.zones?.hand||[]).map((id,index)=>({id,index,name:CardDatabase.get(id)?.name||id,cost:CardDatabase.get(id)?.cost||0}));
    const result=await geminiRequest("/v1/prepare",{phase:"ENEMY_MULLIGAN",hand,starting_crystals:state.startingCrystals});
    return Array.isArray(result?.indices)?result.indices:null;
  }
  function geminiPreparationScreen(){
    return new Promise(resolve=>{
      const cover=document.createElement("div");
      cover.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(6,12,24,.94);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;color:#fff;font:16px system-ui,sans-serif;overflow-y:auto";
      const panel=document.createElement("section");
      panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","Gemini 對戰敵方選牌整備");
      panel.style.cssText="max-width:420px;width:100%;max-height:calc(100dvh - 24px);overflow-y:auto;background:#18233a;border:1px solid #465474;border-radius:16px;padding:20px;box-sizing:border-box;display:grid;gap:12px";
      const title=document.createElement("h2");title.textContent="Gemini 對戰｜敵方選牌整備";title.style.cssText="margin:0;font-size:20px";
      const help=document.createElement("p");help.textContent="輸入 Cloudflare 的 GAME_ACCESS_TOKEN，並非 Google API Key。密碼只保留在這場對戰的瀏覽器記憶體中。";help.style.cssText="font-size:14px;line-height:1.5;margin:0";
      const key=document.createElement("input");key.type="password";key.placeholder="GAME_ACCESS_TOKEN";key.autocomplete="off";key.autocapitalize="off";key.spellcheck=false;
      key.setAttribute("aria-label","Cloudflare GAME_ACCESS_TOKEN");
      key.style.cssText="width:100%;padding:12px;border-radius:8px;box-sizing:border-box;font-size:16px;min-height:48px";
      const status=document.createElement("p");status.textContent="準備就緒。點下方按鈕後，這裡會顯示連線狀態。";
      status.setAttribute("role","status");status.setAttribute("aria-live","polite");
      status.style.cssText="font-size:14px;line-height:1.5;color:#e2e8f0;margin:0;min-height:42px;padding:10px;border-radius:8px;background:#27364e;overflow-wrap:anywhere";
      const start=document.createElement("button");start.type="button";start.textContent="讓 Gemini 整備並開戰";
      start.style.cssText="padding:13px;border-radius:8px;background:#517df7;color:white;border:0;font-size:16px;min-height:48px;touch-action:manipulation;cursor:pointer";
      const offline=document.createElement("button");offline.type="button";offline.textContent="改玩原本電腦 AI";
      offline.style.cssText="padding:10px;border:1px solid #8997b1;border-radius:8px;background:transparent;color:white;min-height:44px;touch-action:manipulation";
      let completed=false;
      const setStatus=(message,error=false)=>{status.textContent=message;status.style.color=error?"#fecaca":"#e2e8f0";};
      const close=()=>{completed=true;key.value="";cover.remove();};
      const errorDescription=code=>({
        NOT_FOUND:"Cloudflare Worker 尚未更新至支援選牌的版本。請先更新後端 worker.mjs，並確認自動部署成功。",
        METHOD_NOT_ALLOWED:"Worker 的選牌 API 不接受此請求，請確認後端版本。",
        UNAUTHORIZED:"通行密碼與 Cloudflare 的 GAME_ACCESS_TOKEN 不一致。請重新輸入；不是 Google API Key。",
        SERVER_NOT_CONFIGURED:"Cloudflare 缺少 GEMINI_API_KEY 或 GAME_ACCESS_TOKEN Secret。",
        ORIGIN_DENIED:"Cloudflare 的 ALLOWED_ORIGIN 與遊戲網域不一致。",
        RATE_LIMITER_NOT_CONFIGURED:"Cloudflare 未建立 AI_RATE_LIMITER 限流綁定，請核對 wrangler.toml 與部署設定。",
        REQUEST_LIMIT:"Cloudflare 限流已達上限，請稍後再試。",
        MODEL_QUOTA:"Google Gemini API 已超過目前配額，請確認 AI Studio 的使用額度。",
        MODEL_UNAVAILABLE:"Google Gemini API 呼叫失敗，請檢查模型可用性與 Cloudflare 的 Worker 日誌。",
        INVALID_MODEL_RESPONSE:"Gemini 沒有回傳有效資料，可以再試一次。",
        INVALID_DECK:"Gemini 回傳的牌組不合法，可以再試一次。",
        DUPLICATE_HERO:"Gemini 的牌組包含重複英雄，可以再試一次。",
        INVALID_DECISION_REQUEST:"遊戲與 Worker 的整備請求格式不一致，請確認兩端都已更新。",
        REQUEST_TIMEOUT:"Gemini 整備連線逾時。可以再試一次，不需要重新開始整備。",
        NETWORK_OR_CORS_ERROR:"無法連線到 Cloudflare，或跨來源授權被阻擋。請確認網路與 Worker 的 ALLOWED_ORIGIN。",
        RESPONSE_MISMATCH:"Worker 回傳的對戰識別資料不一致，已拒絕套用這次結果。"
      })[code]||`後端回覆錯誤：${code||"沒有取得合法牌組"}。請查看 Cloudflare Worker 日誌。`;
      offline.onclick=()=>{
        if(completed)return;
        geminiSession=null;
        if(window.CardTacticsBattleSetup)delete window.CardTacticsBattleSetup.enemyDeck;
        close();resolve("offline");
      };
      start.onclick=async()=>{
        if(completed||start.disabled)return;
        // Cloudflare authenticates against the *exact* configured Secret.
        // No minimum length is enforced by the Worker; reject only an empty input.
        const token=key.value;
        if(token.length===0){setStatus("請輸入你在 Cloudflare 設定的 GAME_ACCESS_TOKEN。",true);return;}
        // Make the status visible immediately on a phone; keyboard dismissal
        // must not wait for the network, which may take several seconds.
        key.blur();start.disabled=true;start.textContent="Gemini 整備中…";
        setStatus("已收到指令，正在向 Cloudflare 送出選牌要求。請看這裡的連線結果。" );
        try{
          const battleId=matchId();
          const session={token,battleId,enabled:true,lastError:null};
          geminiSession=session;
          const allowed=Object.values(globalThis.CARDS||{}).filter(card=>CardDatabase.canPersist(card)&&
            (CardDatabase.isCharacter(card)||(CardDatabase.isSpell(card)&&card.effect?.type==="WEATHER")))
            .map(card=>({id:card.id,name:card.name,cost:Number(card.cost||0),kind:card.unitType==="HERO"?"HERO":CardDatabase.isCharacter(card)?"UNIT":"SPELL"}));
          if(!allowed.length)throw Error("合法卡池為空，請檢查卡牌資料庫。");
          const reply=await geminiRequest("/v1/prepare",{phase:"ENEMY_DECK",cards:allowed,stage:window.CardTacticsBattleSetup?.stageId||"versus_core_battle"});
          if(completed)return;
          if(!reply){setStatus(`整備失敗：${errorDescription(session.lastError)}`,true);return;}
          const selected=reply.deck;
          const valid=DeckEngine.validate(Array.isArray(selected)?selected:[]);
          if(!valid.valid||!selected.every(id=>allowed.some(card=>card.id===id))){
            setStatus("Gemini 傳回的 20 張牌組不符合 DeckEngine 的合法規則，已阻止開戰。",true);return;
          }
          window.CardTacticsBattleSetup??={};window.CardTacticsBattleSetup.enemyDeck=[...valid.deck];
          setStatus("Gemini 已完成敵方 20 張選牌，正在建立戰場。");
          close();resolve("gemini");
        }catch(error){
          if(!completed)setStatus(`整備發生程式錯誤：${String(error?.message||error).slice(0,160)}`,true);
        }finally{
          if(!completed){geminiSession=null;start.disabled=false;start.textContent="重新讓 Gemini 整備並開戰";}
        }
      };
      panel.append(title,help,key,status,start,offline);
      cover.append(panel);document.body.append(cover);
    });
  }

  // Game-state snapshots contain data, Maps and Sets, never renderer or callback authority.
  // Keep this serialization independent of browser structuredClone support and
  // exclude callable presentation/cache fields from the temporary perception snapshot.
  function cloneRuntime(value,seen=new WeakMap()){
    if(typeof value==="function"||typeof value==="symbol")return undefined;
    if(value===null||typeof value!=="object")return value;
    if(seen.has(value))return seen.get(value);
    const tag=Object.prototype.toString.call(value);
    if(tag==="[object Date]")return new Date(value.getTime());
    if(tag==="[object ArrayBuffer]")return value.slice(0);
    if(tag==="[object DataView]")return new DataView(cloneRuntime(value.buffer,seen),value.byteOffset,value.byteLength);
    if(ArrayBuffer.isView(value))return new value.constructor(value);
    const result=tag==="[object Map]"?new Map():tag==="[object Set]"?new Set():Array.isArray(value)?[]:{};
    seen.set(value,result);
    if(tag==="[object Map]"){
      for(const [key,item]of value)result.set(cloneRuntime(key,seen),cloneRuntime(item,seen));
    }else if(tag==="[object Set]"){
      for(const item of value)result.add(cloneRuntime(item,seen));
    }else for(const [key,item]of Object.entries(value)){
      if(typeof item!=="function"&&typeof item!=="symbol")result[key]=cloneRuntime(item,seen);
    }
    return result;
  }
  function currentWorld(){return{map,units,stage,stageState,environmentState,cores};}
  function realWorld(){return hallucinationSession?.real||currentWorld();}
  function presentationWorld(){return hallucinationSession?.active&&hallucinationSession.team===TEAM.ENEMY?hallucinationSession.real:currentWorld();}
  function presentationState(){const w=presentationWorld();return{...w,round,phase,mode,selected:w===hallucinationSession?.real?null:selected,selectedSkill:w===hallucinationSession?.real?null:selectedSkill,inspectedTile,pendingCard,enemyCardState,renderRevision};}
  function presentationUnitAt(x,y){return presentationWorld().units.find(u=>u.alive&&u.x===x&&u.y===y)||null;}
  function presentationCoreAt(x,y){return presentationWorld().cores.find(core=>core.x===x&&core.y===y)||null;}
  function checkMatchEnd(){return hallucinationSession?.active?false:objectiveController.checkMatchEnd();}
  // The perception world is an isolated simulation. It owns its own HP, death,
  // effects, positions, objects and terrain; none of those values may commit to
  // the authoritative world. The only cross-world writes are explicit action
  // costs and truly consumed inventory items.
  function realCounterpart(mirrorUnit){
    if(!hallucinationSession?.active||!mirrorUnit?.mirrorOfUnitId)return null;
    return hallucinationSession.real.units.find(unit=>unit.id===mirrorUnit.mirrorOfUnitId)||null;
  }
  function commitHallucinationSkillExpense(mirrorUnit,spent){
    if(!spent||!hallucinationSession?.active||mirrorUnit?.hallucination)return false;
    const realUnit=realCounterpart(mirrorUnit);
    if(!realUnit)return false;
    // Debit only costs reported by the official UnitRuntimeEngine. Do not copy
    // the mirror's resource values: healing, buffs and recovered resources may
    // exist only inside the perception simulation.
    realUnit.mana=Math.max(0,Number(realUnit.mana||0)-Math.max(0,Number(spent.cost||0)));
    for(const [key,payment] of Object.entries(spent.resources||{})){
      const state=realUnit.resources?.[key];
      if(!state)continue;
      state.value=Math.max(0,Number(state.value||0)-Math.max(0,Number(payment?.cost||0)));
    }
    return true;
  }
  function hallucinationLivePayloadIds(){
    const ids=new Set();
    for(const unit of units||[])for(const key of ["inventory","cargo"])for(const payload of unit?.[key]||[])if(payload?.id)ids.add(payload.id);
    for(const payload of globalThis.ItemInventoryEngine?.battleGroundItems?.()||[])if(payload?.id)ids.add(payload.id);
    return ids;
  }
  function visibleHostilesFor(team,state=currentWorld()){
    const observers=(state.units||[]).filter(unit=>unit?.alive&&unit.team===team&&!unit.hallucination);
    const hostiles=(state.units||[]).filter(unit=>unit?.alive&&unit.team!==team&&!unit.hallucination&&unit.team!==TEAM.NEUTRAL);
    if(!observers.length)return[];
    return hostiles.filter(target=>observers.some(observer=>TacticalEngine.canSee(state.map,observer,target,state.environmentState||null)));
  }
  function scheduleTurnSimulation({source,targetTeam,skill,action}={}){
    if(!source?.alive||![TEAM.PLAYER,TEAM.ENEMY].includes(targetTeam)||targetTeam===source.team)return null;
    const observed=visibleHostilesFor(targetTeam).map(unit=>unit.id),existing=pendingHallucinations.get(targetTeam),turns=Math.max(1,Number(action?.durationTurns||1)),illusionCount=Math.max(0,Number(action?.illusionCount||2));
    const record={targetTeam,sourceUnitId:source.id,sourceSkillId:skill?.id||null,turnsRemaining:Math.max(turns,Number(existing?.turnsRemaining||0)),illusionCount:Math.max(illusionCount,Number(existing?.illusionCount||0)),observedSourceIds:[...new Set([...(existing?.observedSourceIds||[]),...observed])]};
    pendingHallucinations.set(targetTeam,record);return record;
  }
  function injectHallucinations(record,world){
    const {map,units,cores,environmentState}=world;
    const observers=units.filter(unit=>unit?.alive&&unit.team===record.targetTeam&&!unit.hallucination),occupied=new Set(units.filter(unit=>unit?.alive).map(unit=>`${unit.x},${unit.y}`)),coreCells=new Set((cores||[]).map(core=>`${core.x},${core.y}`));
    const candidates=map.tiles.filter(tile=>!occupied.has(`${tile.x},${tile.y}`)&&!coreCells.has(`${tile.x},${tile.y}`)&&observers.some(observer=>TacticalEngine.canSee(map,observer,tile,environmentState||null)));
    const sources=(record.observedSourceIds||[]).map(id=>units.find(unit=>unit.id===id&&unit.alive&&!unit.hallucination&&unit.team!==record.targetTeam)).filter(Boolean);
    if(!sources.length||!candidates.length)return[];
    const made=[],count=Math.min(Math.max(0,Number(record.illusionCount||2)),candidates.length);
    for(let i=0;i<count;i++){
      const source=sources[i%sources.length],valid=candidates.filter(tile=>TacticalEngine.canOccupyTerrain(source,tile)&&!TacticalEngine.isBlockedByObject(map,tile.x,tile.y,source));if(!valid.length)break;
      const tile=valid[Math.floor(Math.random()*valid.length)],fake=cloneRuntime({...source,_runtimeMap:null});
      fake.id=`hallucination_${++hallucinationSerial}`;fake.x=tile.x;fake.y=tile.y;fake.z=Number(TacticalEngine.elevation(tile)||0);fake.hp=1;fake.alive=true;fake.hallucination=true;fake.mirrorOnly=true;fake.mirrorOfUnitId=null;fake.hallucinationSourceId=source.id;fake.perceivedHp=Math.max(1,Number(source.hp||source.character?.combat?.hp||1));fake.perceivedMaxHp=Math.max(fake.perceivedHp,Number(source.character?.combat?.hp||fake.perceivedHp));fake.cardId=null;fake.effects=(fake.effects||[]).filter(effect=>effect?.type!=="STEALTH");fake.participatesInTurn=false;fake.canCapture=false;fake.countsForObjectives=false;fake.moved=true;fake.acted=true;fake.waited=true;fake._runtimeMap=map;
      units.push(fake);occupied.add(`${tile.x},${tile.y}`);made.push(fake);
      const idx=candidates.indexOf(tile);if(idx>=0)candidates.splice(idx,1);
    }
    return made;
  }
  function beginHallucinationTurn(team){
    if(hallucinationSession?.active)return false;
    const record=pendingHallucinations.get(team);if(!record||Number(record.turnsRemaining||0)<=0)return false;
    const real=currentWorld(),groundSnapshot=globalThis.ItemInventoryEngine?.battleGroundItems?.()||[];
    const mirror={map:cloneRuntime(real.map),stage:cloneRuntime(real.stage),stageState:cloneRuntime(real.stageState),environmentState:cloneRuntime(real.environmentState),cores:cloneRuntime(real.cores),units:real.units.map(unit=>cloneRuntime({...unit,_runtimeMap:null}))};
    for(const unit of mirror.units){unit._runtimeMap=mirror.map;unit.mirrorOfUnitId=unit.id;}
    // Prepare the complete perception projection before switching the battle's
    // world references. An unfinished simulation must never become the active world.
    injectHallucinations(record,mirror);
    ({map,units,stage,stageState,environmentState,cores}=mirror);
    hallucinationSession={active:true,team,real,groundSnapshot,record};
    record.turnsRemaining=Math.max(0,Number(record.turnsRemaining||1)-1);if(record.turnsRemaining<=0)pendingHallucinations.delete(team);else pendingHallucinations.set(team,record);
    UnitRuntimeEngine.syncLiveRoster(units);clearSelection();clearEnemyReaction();return true;
  }
  function reconcileConsumedItems(realUnit,mirrorUnit,livePayloadIds){
    for(const key of ["inventory","cargo"]){
      const original=Array.isArray(realUnit?.[key])?realUnit[key]:[];
      realUnit[key]=original.filter(payload=>{if(!payload?.id)return true;if(livePayloadIds.has(payload.id))return true;const item=globalThis.ItemDatabase?.get?.(payload.itemId);return item?.use?.consume!==true;});
    }
  }
  function endHallucinationTurn(team){
    const session=hallucinationSession;if(!session?.active||session.team!==team)return false;
    const livePayloadIds=hallucinationLivePayloadIds();
    // Transfer only action completion and real consumable expenditures made by
    // the affected side. Simulated combat outcomes never leave the mirror world.
    for(const mirrorUnit of units||[]){
      if(!mirrorUnit?.mirrorOfUnitId||mirrorUnit.hallucination)continue;
      const realUnit=realCounterpart(mirrorUnit);
      if(!realUnit)continue;
      if(mirrorUnit.team===session.team){
        realUnit.moved=!!mirrorUnit.moved;
        realUnit.acted=!!mirrorUnit.acted;
        realUnit.waited=!!mirrorUnit.waited;
        realUnit.itemInteractionUsed=Number(mirrorUnit.itemInteractionUsed||0);
      }
      reconcileConsumedItems(realUnit,mirrorUnit,livePayloadIds);
    }
    // Restore the original world references atomically. Mirror-only damage,
    // defeat records, tiles, ground-item placement and Core changes are discarded.
    ({map,units,stage,stageState,environmentState,cores}=session.real);
    globalThis.ItemInventoryEngine?.restoreBattleGroundItems?.(session.groundSnapshot);
    hallucinationSession=null;
    UnitRuntimeEngine.syncLiveRoster(units);
    UnitRuntimeEngine.reconcileCompanions(units);
    clearSelection();clearEnemyReaction();return true;
  }
  function hallucinationActiveFor(team){return !!hallucinationSession?.active&&hallucinationSession.team===team;}

  function pushLog(text,type="SYSTEM"){logs.push(String(text));if(logs.length>240)logs.splice(0,logs.length-240);BattleLog.add(logState,type,String(text));window.dispatchEvent(new CustomEvent("cardtactics:log",{detail:{type,text:String(text)}}));}
  function logPostEffect(entry){const {source,target,effect,result}=entry;if(!result)return;if(!result.applied){pushLog(`${target.character.name}｜${effect.type} 未生效${result.reason?`（${result.reason}）`:""}。`,"DETAIL");return;}const moved=result.steps?.length||0;if(moved>0)EffectEngine.interruptChannel(target,"FORCED_MOVE");const visitCollisions=(r,mover=target)=>{for(const collision of r?.collisions||[]){environmentController.resolveCollisionRuntime(collision,{mover,source});if(collision.chain&&collision.surface?.unit)visitCollisions(collision.chain,collision.surface.unit);}};visitCollisions(result);pushLog(`${source.character.name} → ${target.character.name}：${effect.type==="PULL"?"拉近":"擊退"} ${moved} 格。`,"BATTLE");if(result.falls?.length){const drops=result.falls.map(f=>`Z${f.from}→H${f.to}`).join("、");pushLog(`${target.character.name} 墜落 ${drops}｜墜落傷害 ${result.fallDamage}｜HP ${target.hp}。`,"BATTLE");}else pushLog(`${target.character.name} 強制位移完成｜無墜落傷害。`,"DETAIL");if(result.applied&&target.alive)enterTile(target);}
  function handleDefeated(unit,source,skillOrEffect){
    if(unit?.hallucination){unit.hp=0;unit.alive=false;return{hallucination:true};}
    if(hallucinationSession?.active&&unit?.mirrorOfUnitId){
      unit.hp=0;unit.alive=false;
      // No deferred real-world death: the original actor was never hit.
      return{perceptionDefeat:true};
    }
    return deathLifecycle.finalize(unit,source,skillOrEffect);
  }
  function resolveCollisionRuntime(...args){return environmentController.resolveCollisionRuntime(...args);}
  function applyForcedMovement(...args){return environmentController.applyForcedMovement(...args);}
  function traverseUnitPath(...args){
    const unit=args[0],before=unit?{x:unit.x,y:unit.y}:null;
    const result=environmentController.traverseUnitPath(...args);
    if(unit&&before&&(unit.x!==before.x||unit.y!==before.y))EffectEngine.interruptChannel(unit,"MOVE");
    return result;
  }
  function damageUnitFlat(unit,damage,sourceName){if(!unit?.alive)return;const dealt=EffectEngine.applyDamage(unit,Math.max(0,Number(damage||0)),{kind:"EXTERNAL"}).hpLoss;pushLog(`${sourceName} → ${unit.character.name}｜${dealt} 傷害｜HP ${unit.hp}。`,"BATTLE");if(unit.hp<=0&&unit.alive){unit.alive=false;handleDefeated(unit,null,{type:"CARD_SPELL",name:sourceName});}}
  function createMap(){return MapDatabase.createMap(stage.mapId);}
  function grantInitialGeneratedCards(){if(!cardState?.zones?.hand||!globalThis.CardPhaseEngine?.grantGeneratedCards)return[];const ids=[];for(const unit of units||[]){if(!unit?.alive||unit.team!==TEAM.PLAYER)continue;ids.push(...(unit.character?.generatedCardsOnDeploy||[]));}return CardPhaseEngine.grantGeneratedCards(cardState,ids);}
  function createUnit(id,team,characterId,x,y){return UnitRuntimeEngine.create({id,team,characterId,x,y,map});}

  function resetBattle(){
    debugEnvironmentSteps=0;
    enemyController?.reset?.();actionController?.reset?.();hallucinationSession=null;pendingHallucinations.clear();
    globalThis.ItemInventoryEngine?.beginBattle?.(window.CardTacticsBattleSetup?.itemLoadouts||{});
    const requestedStageId=window.CardTacticsBattleSetup?.stageId||"prototype_battle";
    const setup=BattleSetupEngine.create({stageId:requestedStageId,battleSetup:window.CardTacticsBattleSetup,TEAM});
    ({stage,map,stageState,cores,environmentState,units,cardState,enemyCardState,unitSerial}=setup);
    enchantIdentityById.clear();enchantIdentityCounters.clear();releaseEnchantmentMarkers();
    EffectEngine.syncConditionalPassives(units,environmentState);
    logState=BattleLog.create();deathLifecycle?.reset?.();selected=null;inspectedTile=null;selectedSkill=null;selectedSkillVariant=null;pendingEngagement=null;supportSelection=new Map();pendingEnemyAttack=null;pendingReactionType=null;selectedGuardian=null;selectedGuardInterception=null;mode="idle";logs=[];grantInitialGeneratedCards();UnitRuntimeEngine.reconcileCompanions(units);round=1;phase=PHASE.CARD;matchResult=null;stageEvent({type:"ROUND_START",round,team:"PLAYER"});cardPhaseController.begin({initial:true});
  }
  function unitAt(x,y){return units.find(u=>u.alive&&u.x===x&&u.y===y);}
  function spawnFromScript(action){const requested=String(action.team||"ENEMY").toUpperCase();const team=requested==="PLAYER"?TEAM.PLAYER:requested==="NEUTRAL"?TEAM.NEUTRAL:TEAM.ENEMY;if(unitAt(action.x,action.y))return null;const character=CHARACTERS[action.characterId];if(!character)return null;const prefix=team===TEAM.PLAYER?"p":team===TEAM.NEUTRAL?"n":"e";let n=0,id;do{id=`${prefix}s${n++}`;}while(units.some(u=>u.id===id));const unit=createUnit(id,team,action.characterId,action.x,action.y);units.push(unit);onUnitCreated(unit);pushLog(`${character.name} 出現在 (${action.x},${action.y})。`);return unit;}
  function captureOwnerForTeam(team){return coreCaptureController.ownerForTeam(team);}function coreForOwner(owner){return coreCaptureController.coreForOwner(owner);}function enemyOwner(owner){return coreCaptureController.enemyOwner(owner);}function coreAt(x,y){return coreCaptureController.coreAt(x,y);}function capturePointForUnit(unit){return coreCaptureController.capturePointForUnit(unit);}function canUnitCapture(unit){return coreCaptureController.canUnitCapture(unit);}function damageCore(owner,damage,source){return coreCaptureController.damageCore(owner,damage,source);}function executeCapture(unit){return coreCaptureController.executeCapture(unit);}function coreCombatTarget(core,attackerTeam){return coreCaptureController.coreCombatTarget(core,attackerTeam);}function combatTargetEntities(unit){return coreCaptureController.combatTargetEntities(unit);}function applyEnvironmentHazardToUnit(...args){return environmentController.applyEnvironmentHazardToUnit(...args);}function applyEnvironmentHazards(...args){return environmentController.applyEnvironmentHazards(...args);}function resolveEnvironmentEvents(...args){return environmentController.resolveEnvironmentEvents(...args);}function enterTile(...args){return environmentController.enterTile(...args);}
  function stageEvent(event){if(!stageState)return;StageEngine.run(stageState,event,{units,log:text=>pushLog(text),spawn:spawnFromScript,onObjectiveChanged:(active,action)=>{const target=String(action.target||"").toUpperCase();const label=action.objectives?"勝敗條件":target==="VICTORY"?"勝利條件":target==="DEFEAT"?"失敗條件":"勝敗條件";pushLog(`${label}已更新。`,"SYSTEM");}});}
  function shortName(name){return name.replace(/（.*?）/g,"").slice(0,4);}
  // Stable per-battle identity: a unit retains its ordinal even if it moves,
  // finishes its turn, is defeated or leaves the current enchantment range.
  const enchantIdentityById=new Map(),enchantIdentityCounters=new Map();
  const ENCHANT_DIGITS=["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫","⑬","⑭","⑮","⑯","⑰","⑱","⑲","⑳"];
  function registerEnchantIdentity(unit){
    if(!unit||enchantIdentityById.has(unit.id))return;
    const type=String(unit.character?.name||unit.characterId||"友軍");
    const next=(enchantIdentityCounters.get(type)||0)+1;
    enchantIdentityCounters.set(type,next);enchantIdentityById.set(unit.id,{type,ordinal:next});
  }
  function enchantIdentity(unit){
    // Allocate by roster order, never by distance or an availability-filtered list.
    for(const entry of units||[])if(entry.team===TEAM.PLAYER)registerEnchantIdentity(entry);
    const identity=enchantIdentityById.get(unit.id);
    const ordinal=identity?.ordinal||1;
    return{ordinal,mark:ENCHANT_DIGITS[ordinal-1]||`#${ordinal}`,
      name:identity?.type||unit.character?.name||"友軍"};
  }
  function onUnitCreated(unit){if(unit)EffectEngine.syncConditionalPassives([unit],environmentState);return unit;}
  function living(team){return UnitRuntimeEngine.living(units,team);}function turnActors(team){return UnitRuntimeEngine.turnActors(units,team);}function resetActions(team){const result=UnitRuntimeEngine.resetActions(units,team);EffectEngine.syncConditionalPassives(units,environmentState,{rearmTeam:team});return result;}function allFinished(team){return UnitRuntimeEngine.allFinished(units,team);}function resourceFor(unit,skill){return UnitRuntimeEngine.resourceFor(unit,skill);}function canUseSkill(unit,skill){return UnitRuntimeEngine.canUseSkill(unit,skill);}function consumeSkill(unit,skill){
    const result=UnitRuntimeEngine.consumeSkill(unit,skill);
    if(result){commitHallucinationSkillExpense(unit,result);window.CardTacticsDiagnostics?.gameAction?.("SKILL_COMMIT",{
      unitId:unit?.id,unit:unit?.character?.name,team:unit?.team,skillId:skill?.id,skill:skill?.name,
      reason:`MP ${result.cost||0}; remaining ${result.remaining??"?"}; extra ${Object.keys(result.resources||{}).join(",")||"none"}`
    });}
    return result;
  }function resourceLabel(unit,skill){return UnitRuntimeEngine.resourceLabel(unit,skill);}function targetType(skill){return UnitRuntimeEngine.targetType(skill);}
  function clearEngagement(){pendingEngagement=null;supportSelection=new Map();}
  function clearEnemyReaction(){pendingEnemyAttack=null;pendingReactionType=null;selectedGuardian=null;selectedGuardInterception=null;}
  function clearSelection(){releaseEnchantmentMarkers();commandPanelCollapsed=false;selected=null;selectedSkill=null;selectedSkillVariant=null;clearEngagement();mode="idle";}
  function resolveWeatherEvents(...args){return environmentController.resolveWeatherEvents(...args);}
  function beginPlayerTurn(){endHallucinationTurn(TEAM.ENEMY);if(checkMatchEnd()){render();return;}round++;phase=PHASE.PLAYER;resetActions(TEAM.PLAYER);clearSelection();clearEnemyReaction();pushLog(`Round ${round}｜我方回合開始。`,"SYSTEM");
    // Weather and real water contact settle before unit DOTs tick: a newly
    // delivered rainfall pulse can cool BURN before it inflicts its next tick.
    if(environmentState){applyEnvironmentHazards({reason:"回合開始仍處於燃燒區"});if(checkMatchEnd()){render();return;}}
    if(window.EffectEngine)units.filter(u=>u.alive).forEach(u=>EffectEngine.tick(u,{units}));
    stageEvent({type:"ROUND_START",round,team:"PLAYER"});
    if(environmentState){EnvironmentEngine.tick(environmentState);resolveWeatherEvents();if(checkMatchEnd()){render();return;}}
    beginHallucinationTurn(TEAM.PLAYER);cardPhaseController.begin();}
  function createBattleContext(){return{geminiDecide,geminiMulligan,geminiEnabled:()=>!!geminiSession?.enabled,TEAM,PHASE,state:()=>({map,units,stage,round,phase,matchResult,enemyCardState,environmentState}),map:()=>map,onUnitCreated,living,turnActors,resetActions,canUseSkill,targetType,combatTargets:combatTargetEntities,scheduleTurnSimulation,hallucinationActiveFor,coreForOwner,canUnitCapture,executeCapture,enterTile,checkMatchEnd,beginPlayerTurn,pushLog,render,maybeAutoEndPlayerTurn,clearSelection,clearEnemyReaction,skillList:unit=>SkillDatabase.list(window.EffectEngine?EffectEngine.skillIds(unit):unit.character.skills),bloodShadowLanding:(u,t)=>actionController.bloodShadowLanding(u,t),performBloodShadow:(u,t,s)=>actionController.prepareAttack(u,t,s),performBloodBurst:(u,s)=>actionController.executeEffectSkill(u,u,s),setPhase:value=>{phase=value;},setEnemyView:value=>{enemyView=hallucinationActiveFor(TEAM.ENEMY)?{active:true,kind:value?.kind||"ACTION",message:"敵方行動中…",cardId:null,unitId:null}:value;},emitState:()=>window.dispatchEvent(new CustomEvent("cardtactics:state")),pendingEnemyAttack:()=>pendingEnemyAttack,setPendingEnemyAttack:attack=>{if(attack&&attack!==pendingEnemyAttack){engagementFocusSerial++;EffectEngine.interruptChannel(attack.defender,"ENGAGEMENT");}pendingEnemyAttack=attack;pendingReactionType=null;},resolveDirectTargetAttack:(...args)=>actionController.resolveDirectTargetAttack(...args),actionState:()=>({map,units,stage,selected,mode,selectedSkill,selectedSkillVariant,environmentState}),setMode:value=>{mode=value;},setSelectedSkill:value=>{selectedSkill=value;},setSelectedSkillVariant:value=>{selectedSkillVariant=value;},setCommandPanelCollapsed:value=>{commandPanelCollapsed=value;},getPendingEngagement:()=>pendingEngagement,setPendingEngagement:value=>{if(value&&value!==pendingEngagement)engagementFocusSerial++;pendingEngagement=value;},getSupportSelection:()=>supportSelection,setSupportSelection:value=>{supportSelection=value;},getPendingCopySkill:()=>pendingCopySkill,setPendingCopySkill:value=>{pendingCopySkill=value;},unitAt,coreAt,traverseUnitPath,consumeSkill,effectiveSkill,damageCore,handleDefeated,damageUnitFlat,canUseSkill,targetType,logBattleAction,logPostEffect,logEnvironmentEvent,applyEnvironmentHazardToUnit,resolveEnvironmentEvents:(...args)=>environmentController.resolveEnvironmentEvents(...args),enterTile,clearEngagement,allFinished,lineTiles,aoeTiles,canTraverseMoveLine,createEnemyCardUnit:(card,tile)=>{const unit=UnitRuntimeEngine.createFromCard({id:`ec${unitSerial++}`,team:TEAM.ENEMY,card,x:tile.x,y:tile.y,map});if(!unit)return null;unit.cardId=card.id;unit.deployedRound=round;unit.moved=true;unit.acted=true;unit.waited=true;return unit;}};}
  function runEnemyPhase(){beginHallucinationTurn(TEAM.ENEMY);enemyController?.runPhase();}
  function maybeAutoEndPlayerTurn(){if(phase!==PHASE.PLAYER||matchResult||!allFinished(TEAM.PLAYER))return false;pushLog("我方所有存活角色皆已完成行動，自動結束回合。","SYSTEM");clearSelection();endPlayerTurn({automatic:true});return true;}
  function endPlayerTurn({automatic=false}={}){if(phase!==PHASE.PLAYER||matchResult)return false;pushLog(`Round ${round}｜我方回合結束。`);const endTurnDraws=CardPhaseEngine.resolveTurnEndEffects(cardState,{units,team:TEAM.PLAYER});endTurnDraws.forEach(result=>{const sourceUnit=units.find(unit=>unit.id===result.unitId);const sourceLabel=sourceUnit?.character?.name?`${sourceUnit.character.name}【${result.sourceName}】`:`【${result.sourceName}】`;if(result.drawn.length){const drawnNames=result.drawn.map(cardId=>CardDatabase.get(cardId)?.name||cardId);pushLog(`${sourceLabel}發動｜額外抽牌：${drawnNames.join("、")}｜目前手牌 ${cardState.zones.hand.length} 張。`,"SYSTEM");}else pushLog(`${sourceLabel}發動｜牌庫已無可抽取卡牌。`,"SYSTEM");});endHallucinationTurn(TEAM.PLAYER);if(checkMatchEnd()){render();return true;}runEnemyPhase();return true;}
  function finishUnit(unit,reason,{waited=false}={}){unit.moved=true;unit.acted=true;unit.waited=waited;selectedSkill=null;clearEngagement();mode="inspect";pushLog(`${unit.character.name} ${reason}`);maybeAutoEndPlayerTurn();}
  function logBattleAction(entry){const {actor,target,skill,result,resolved,spd}=entry;const resource=resourceFor(actor,skill);const resourceText=resource.type==="USES"?`｜剩餘 ${resource.remaining}/${resource.max}`:"";const roleText=entry.role==="SUPPORT"?"支援｜":entry.role==="COUNTER"?"反擊｜":"";const hpAfter=Math.max(0,Number(entry.hpAfter||0));const hpBefore=hpAfter+Math.max(0,Number(result.damage||0));const hitLabel=result.hit?(result.graze?"GRAZE":"HIT"):"MISS";const critLabel=result.crit?"｜CRIT":"";pushLog(`${roleText}${actor.character.name}｜${skill.name} → ${target.character.name}｜${hitLabel}${critLabel}｜${result.damage||0} 傷害${Number(result.magicHpDamage||0)>0?`（物理 ${result.physicalHpDamage||0}＋魔法 ${result.magicHpDamage}）`:""}｜HP ${hpBefore} → ${hpAfter}`,"BATTLE");const normalRoll=Number.isFinite(result.hitRoll)?result.hitRoll:null;const evadeRoll=Number.isFinite(result.evadeRoll)?result.evadeRoll:null;const hitRollText=evadeRoll!==null?`迴避骰 ${evadeRoll.toFixed(1)}｜原命中 ${result.originalHitChance}%｜全中門檻 ${result.activeHitChance}%`:normalRoll!==null?`命中骰 ${normalRoll.toFixed(1)} / ${result.hc}% → ${result.hit?"HIT":"MISS"}`:`命中判定 ${result.guaranteedHit?"必中":result.hit?"強制命中":"強制未命中"}`;const critRollText=Number.isFinite(result.critRoll)?`｜暴擊骰 ${result.critRoll.toFixed(1)} / ${result.cc}% → ${result.crit?"CRIT":"NO CRIT"}`:(result.hit?`｜暴擊率 ${result.cc}%${result.crit?" → CRIT":""}`:"");const terrainText=`${resolved.terrain.eva?`｜地形EVA +${resolved.terrain.eva}`:""}${resolved.terrain.acc?`｜高地ACC +${resolved.terrain.acc}`:""}`;pushLog(`[${skill.name}] ${actor.character.name} → ${target.character.name}｜${hitRollText}${critRollText}｜ACC修正 ${result.accuracy>=0?"+":""}${result.accuracy}｜EVA修正 ${result.evasion>=0?"+":""}${result.evasion}${terrainText}｜SPD ${spd}${resourceText}`,"DETAIL");if(resolved.defense?.method){const d=resolved.defense;pushLog(`防禦判定｜${d.method.name}${Number.isFinite(d.roll)?`｜骰 ${d.roll.toFixed(1)} / ${d.chance}%`:""}${d.bypassed?"｜被突破":d.triggered?`｜${d.success===false?"失敗":"成功"}`:"｜未觸發"}`,"DETAIL");}environmentController?.resolveWaterSkillHit?.(entry);actionController?.resolveEnchantmentImpact?.(entry);}
  function executeEnemyAttack(reaction=null,interception=null){if(!pendingEnemyAttack)return;const {attacker,defender,skill}=pendingEnemyAttack;const guardian=interception?.type==="GUARD_ALLY"&&interception.guardian?.alive?interception.guardian:null;if(guardian)pushLog(`${guardian.character.name} 援護 ${defender.character.name}，承接 ${attacker.character.name} 的攻擊。`,"BATTLE");BattleResolution.resolve({map,units,initiator:attacker,target:defender,skill,actions:[],reaction,interception},{canUseSkill,consumeSkill,onDefeated:handleDefeated,onAction:logBattleAction,onPostEffect:logPostEffect});attacker.moved=true;attacker.acted=true;attacker.waited=true;clearEnemyReaction();mode="idle";if(checkMatchEnd()){render();return;}render();enemyController?.continuePhase();}
  function guardCandidates(){if(!pendingEnemyAttack)return[];const {defender}=pendingEnemyAttack;return BattleResolution.guardCandidates({map,units,target:defender});}
  function chooseGuardian(guardian){selectedGuardian=guardian;selectedGuardInterception=null;pendingReactionType=null;mode="enemy-guard-reaction";render();}
  function chooseEnemyReaction(type){if(!pendingEnemyAttack)return;pendingReactionType=type;if(type==="EVADE"){executeEnemyAttack(BattleResolution.createReaction("EVADE"));return;}mode=type==="COUNTER"?"enemy-counter-select":"enemy-defense-select";render();}
  function resolvedSkill(skill,variant){return variant?{...skill,...variant,id:skill.id,name:variant.name||skill.name,baseSkillId:skill.id,variantId:variant.id,variants:undefined}:skill;}
  // Weapon enchantment changes the valid contact surfaces, not the attack's
  // underlying damage skill. The same aim mode owns both enemy and terrain hits.
  function attackWithEnchantmentTargets(unit,skill){
    if(!skill||skill.target!=="ENEMY"||skill.utilityAction||!skill.weapon)return skill;
    return globalThis.EffectEngine?.weaponEnchantment?.(unit,skill.weapon)
      ?{...skill,terrainTargeting:true}:skill;
  }
  function skillVariants(skill){return Array.isArray(skill?.variants)?skill.variants:[];}
  function directVerticalActions(unit){if(!unit?.alive||unit.acted||!globalThis.VerticalMobilityEngine)return[];const tile=TacticalEngine.tile(map,unit.x,unit.y);if(!tile)return[];const current=VerticalMobilityEngine.describe(unit,tile)?.mode||unit.verticalState?.mode||null;const ids=window.EffectEngine?EffectEngine.skillIds(unit):unit.character.skills,out=[];for(const parent of SkillDatabase.list(ids||[])){for(const variant of skillVariants(parent)){const skill=resolvedSkill(parent,variant),action=skill?.utilityAction;if(skill.target!=="SELF"||action?.type!=="SET_VERTICAL_MODE"||!canUseSkill(unit,skill))continue;const preview=VerticalMobilityEngine.describe(unit,tile,{mode:action.mode,...(action.options||{})});if(!preview||preview.mode===current)continue;out.push({parent,variant,skill,mode:preview.mode});}}return out;}
  function executeSelfUtilityVariant(unit,parent,variant){const skill=resolvedSkill(parent,variant);if(skill.target!=="SELF"||!skill.utilityAction)return false;selectedSkillVariant=variant;selectedSkill=skill;commitPendingMove(unit);prepareAttack(unit,unit,skill);return true;}
  function effectiveSkill(attacker,skill){let out=globalThis.UnitRuntimeEngine?.applyResourceScaling?.(attacker,skill)||skill;const passives=SkillDatabase.passiveList(attacker?.character?.passives);const tile=TacticalEngine.tile(map,attacker.x,attacker.y);const weapon=attacker?.character?.weapons?.[skill?.weapon];const ambush=passives.find(p=>p.id==="AMBUSH");if(ambush&&tile?.terrain===ambush.terrain&&weapon?.weaponKind===ambush.weaponKind){out={...out,power:Number(out.power||0)*Number(ambush.powerMultiplier||1),speed:Number(out.speed||0)+Number(ambush.speedBonus||0),modifiers:{...(out.modifiers||{})}};out.ambushActive=true;}return out;}
  function lineTiles(attacker,end){const dx=Math.sign(end.x-attacker.x),dy=Math.sign(end.y-attacker.y);if(dx&&dy)return[];const out=[];let x=attacker.x+dx,y=attacker.y+dy;while(x!==end.x||y!==end.y){out.push(map.tiles.find(t=>t.x===x&&t.y===y));x+=dx;y+=dy;}out.push(map.tiles.find(t=>t.x===end.x&&t.y===end.y));return out.filter(Boolean);}
  function canTraverseMoveLine(attacker,end){
    const path=lineTiles(attacker,end);
    if(!path.length)return false;
    let previous=TacticalEngine.tile(map,attacker.x,attacker.y);
    for(const tile of path){
      if(!tile||!TacticalEngine.canOccupyTerrain(attacker,tile)||TacticalEngine.isBlockedByObject(map,tile.x,tile.y,attacker))return false;
      if(!TacticalEngine.canTraverseElevation(previous,tile,attacker))return false;
      previous=tile;
    }
    // Units along the route are targets, not movement/landing positions.
    return true;
  }
  function aoeTiles(center,radius){const r=Number(radius||0);return map.tiles.filter(tile=>Math.abs(tile.x-center.x)+Math.abs(tile.y-center.y)<=r);}
  function logEnvironmentEvent(...args){return environmentController.logEnvironmentEvent(...args);}
  function selectNextAvailableUnit(){
    if(phase!==PHASE.PLAYER||matchResult||pendingEngagement||pendingEnemyAttack)return false;
    const actors=(units||[]).filter(unit=>unit.alive&&unit.team===TEAM.PLAYER&&unit.participatesInTurn!==false&&!unit.acted&&!unit.waited);
    if(!actors.length)return false;
    const current=actors.findIndex(unit=>unit.id===selected?.id);
    const next=actors[(current+1)%actors.length];
    if(selected&&selected!==next)commitPendingMove(selected);
    // Reuse the original tile-selection authority. Clear targeting first so
    // changing actors can never accidentally confirm a spell or attack.
    clearSelection();
    return clickBattleTile(next.x,next.y);
  }
  function clickBattleTile(x,y){const tile=TacticalEngine.tile(map,Number(x),Number(y));if(!tile)return false;const unit=unitAt(tile.x,tile.y),reachable=selected&&phase===PHASE.PLAYER&&!selected.acted&&!selected.moved&&mode==="command"?TacticalEngine.reachable(map,units,selected):new Map(),targets=selected&&phase===PHASE.PLAYER&&!selected.acted&&mode==="attack"&&selectedSkill&&targetType(selectedSkill)==="SINGLE"?targetableEntities(selected,selectedSkill):[];handleTileClick(tile,unit,coreAt(tile.x,tile.y),reachable,targets);return true;}
  function render(){renderRevision++;renderTurnStatus();renderPanel();window.dispatchEvent(new CustomEvent("cardtactics:battle-render",{detail:{revision:renderRevision}}));}
  function handleTileClick(tile,unit,core,reachable,targets){inspectedTile=tile;window.dispatchEvent(new CustomEvent("cardtactics:inspection"));if(matchResult){render();return;}if(phase===PHASE.CARD){if(pendingCard&&CardDatabase.isSpell(pendingCard)){cardPhaseController.resolveAt(pendingCard,tile);return;}if(pendingCard&&CardDatabase.isCharacter(pendingCard)&&!unit)cardPhaseController.deployAt(tile);return;}if(phase!==PHASE.PLAYER)return;
    if(mode==="enchant-weapon-select"){
      const pending=actionController?.enchantmentSelection?.();
      if(pending&&unit&&pending.candidates.some(entry=>entry.target.id===unit.id)){
        focusEnchantmentRecipient(unit.id);return;
      }
      // Prevent selecting a different actor, movement or attacks while this
      // read-only enchantment choice is open.
      return;
    }
    if(mode==="support-select")return;if(selected&&!selected.acted&&mode==="map-target"&&selectedSkill){if(mapTargetTiles(selected,selectedSkill).includes(tile))executeMapSkill(selected,tile,selectedSkill);return;}if(selected&&!selected.acted&&mode==="attack"){const target=unit&&targets.includes(unit)?unit:(core?targets.find(candidate=>candidate.kind==="CORE"&&candidate.core===core):null);if(!target&&environmentTargetTiles(selected,selectedSkill).includes(tile)){executeEnvironmentTargetSkill(selected,tile,selectedSkill);return;}if(target){if(!approachTargetForAttack(selected,target,selectedSkill)){pushLog(`${selectedSkill.name} 無可到達的合法攻擊位置。`,"SYSTEM");render();return;}if(target.kind==="CORE")resolveDirectTargetAttack(selected,target,selectedSkill);else previewPlayerAttack(selected,target,selectedSkill);return;}
      // A weapon's enchanted hit selects either a legal enemy (above) or a
      // legal terrain collision (here) inside the SAME attack aim mode.
      // No separate "single target / conduction" or map attack menu exists.
      if(selectedSkill?.terrainTargeting===true&&mapTargetTiles(selected,selectedSkill).includes(tile)){
        executeMapSkill(selected,tile,selectedSkill);return;
      }
    }if(unit&&unit.team===TEAM.PLAYER&&unit.participatesInTurn!==false){const activeFollowup=actionController?.enchantmentFollowup?.();if(activeFollowup&&selected&&activeFollowup.unitId===selected.id){render();return;}if(selected&&selected!==unit)commitPendingMove(selected);commandPanelCollapsed=false;selected=unit;selectedSkill=null;clearEngagement();mode=unit.acted?"inspect":"command";render();return;}if(selected&&!selected.acted&&mode==="command"&&!selected.moved&&!unit&&reachable.has(tile.x+","+tile.y)){commandPanelCollapsed=true;const path=TacticalEngine.pathTo(map,units,selected,tile.x,tile.y);beginPendingMove(selected);const moveResult=traverseUnitPath(selected,path,{kind:"UNIT"});selected.moved=true;if(!moveResult.completed)commitPendingMove(selected);pushLog(`${selected.character.name} ${moveResult.completed?"移動完成，可在其他行動前取消移動":"移動途中受到環境影響而中斷"}。`);render();return;}if(selected&&!selected.acted&&mode==="command"&&!unit)commandPanelCollapsed=true;render();}
  function renderTurnStatus(){if(matchResult){turnStatus.textContent=matchResult==="VICTORY"?`戰鬥結束｜VICTORY｜Round ${round}`:`戰鬥結束｜DEFEAT｜Round ${round}`;return;}const phaseName=phase===PHASE.CARD?"卡牌階段":phase===PHASE.PLAYER?"我方戰棋階段":"敵方回合";const actors=turnActors(TEAM.PLAYER),ready=actors.filter(u=>!u.acted).length;turnStatus.textContent=`Round ${round}｜${phaseName}｜我方可行動 ${ready}/${actors.length}`;}
  // The skill selector owns one reusable read-only inspector, rather than a tooltip per button.
  // Use the same hold threshold as BattleInputController's battlefield inspector.
  const SKILL_HOLD_MS=420,SKILL_HOLD_SLOP=12;
  const inspectableSkillButtons=new WeakMap();
  const skillInspector=document.createElement("aside");
  skillInspector.className="battle-skill-inspector";
  skillInspector.setAttribute("role","tooltip");
  skillInspector.hidden=true;
  skillInspector.style.cssText="position:fixed;z-index:230;pointer-events:none;box-sizing:border-box;width:min(340px,calc(100vw - 24px));max-height:min(62vh,460px);overflow:hidden;padding:12px 14px;border:1px solid #b89b66;border-radius:12px;background:#0a1420f5;color:#edf1f4;box-shadow:0 12px 32px #000c;white-space:normal;line-height:1.55;";
  document.body.appendChild(skillInspector);
  let skillHold=null,skillHoldConsumedClick=null;
  function dismissSkillInspection(){
    if(skillHold?.timer!==null&&skillHold?.timer!==undefined)clearTimeout(skillHold.timer);
    skillHold=null;skillInspector.hidden=true;skillInspector.replaceChildren();
  }
  function showSkillInspection(button,skill,point){
    const detail=SkillDatabase.inspect(skill);if(!detail)return;
    const title=document.createElement("strong");title.textContent=detail.title;
    title.style.cssText="display:block;color:#f3dba5;font-size:15px;margin-bottom:7px;";
    const body=document.createElement("div");body.textContent=detail.description;
    body.style.cssText="font-size:13px;color:#e2e8ef;white-space:pre-wrap;";
    const stats=document.createElement("small");stats.textContent=detail.mechanics.join(" ｜ ");
    stats.style.cssText="display:block;margin-top:9px;color:#a9bdcf;font-size:11px;";
    skillInspector.replaceChildren(title,body,stats);skillInspector.hidden=false;
    const rect=button.getBoundingClientRect();
    const x=Number(point?.x??rect.left+rect.width/2),y=Number(point?.y??rect.top);
    const width=skillInspector.getBoundingClientRect().width;
    const available=Math.max(40,y-22);
    skillInspector.style.maxHeight=`${available}px`;
    skillInspector.style.overflowY="auto";
    const height=skillInspector.getBoundingClientRect().height;
    skillInspector.style.left=`${Math.min(Math.max(8,x-width/2),Math.max(8,window.innerWidth-width-8))}px`;
    skillInspector.style.top=`${Math.max(4,y-height-14)}px`;
  }
  skillBar.addEventListener("pointerdown",event=>{
    if(event.button!==0&&event.pointerType!=="touch")return;
    const button=event.target.closest?.("button");
    const skill=button&&skillBar.contains(button)?inspectableSkillButtons.get(button):null;
    dismissSkillInspection();skillHoldConsumedClick=null;
    if(!skill)return;
    const record={button,skill,pointerId:event.pointerId,x:event.clientX,y:event.clientY,timer:null};
    skillHold=record;
    record.timer=setTimeout(()=>{
      if(skillHold!==record||!button.isConnected)return;
      record.timer=null;skillHoldConsumedClick=button;showSkillInspection(button,skill,record);
    },SKILL_HOLD_MS);
  });
  window.addEventListener("pointermove",event=>{
    const h=skillHold;if(!h||h.pointerId!==event.pointerId)return;
    if(Math.hypot(event.clientX-h.x,event.clientY-h.y)>SKILL_HOLD_SLOP)dismissSkillInspection();
  });
  function finishSkillHold(event){if(skillHold&&skillHold.pointerId===event.pointerId)dismissSkillInspection();}
  window.addEventListener("pointerup",finishSkillHold);
  window.addEventListener("pointercancel",finishSkillHold);
  skillBar.addEventListener("click",event=>{
    const button=event.target.closest?.("button");
    if(button&&button===skillHoldConsumedClick){
      event.preventDefault();event.stopImmediatePropagation();skillHoldConsumedClick=null;
    }
  },true);
  skillBar.addEventListener("contextmenu",event=>{
    const button=event.target.closest?.("button");
    if(button&&inspectableSkillButtons.has(button))event.preventDefault();
  });
  skillBar.addEventListener("selectstart",event=>{
    const button=event.target.closest?.("button");
    if(button&&inspectableSkillButtons.has(button))event.preventDefault();
  });
  // The enchantment menu uses the authoritative roster for selection, and
  // the existing Babylon draw clock only for projecting small HTML markers.
  // No gameplay effects, separate renderer or independent animation loop.
  let focusedEnchantRecipientId=null,enchantMarkerObserver=null,enchantMarkerScene=null;
  const enchantMarkerRoot=document.createElement("div");
  enchantMarkerRoot.className="enchantment-recipient-markers";
  enchantMarkerRoot.style.cssText="position:fixed;inset:0;z-index:119;pointer-events:none;overflow:hidden;";
  document.body.appendChild(enchantMarkerRoot);
  const enchantMarkerButtons=new Map();
  let enchantMenuCandidates=[];
  function enchantRecipientGroups(pending){
    const groups=new Map();
    for(const entry of pending?.candidates||[]){
      if(!groups.has(entry.target.id))groups.set(entry.target.id,{target:entry.target,weapons:[]});
      groups.get(entry.target.id).weapons.push(entry.weapon);
    }
    return [...groups.values()];
  }
  function focusEnchantmentRecipient(id){
    const pending=actionController?.enchantmentSelection?.();
    if(!pending||!pending.candidates.some(entry=>entry.target.id===id))return false;
    const changed=String(focusedEnchantRecipientId)!==String(id);
    focusedEnchantRecipientId=id;
    const focus=String(id);
    for(const [key,button]of enchantMarkerButtons){
      const active=key===focus;
      button.style.opacity=active?"1":".55";
      button.style.borderColor=active?"#fff0a0":"#6f9bb8";
      button.style.boxShadow=active?"0 0 0 3px #ffd565aa,0 0 20px #ffe785":"0 2px 10px #000e";
      button.setAttribute("aria-pressed",String(active));
    }
    for(const row of skillBar.querySelectorAll("[data-enchant-recipient]")){
      row.style.borderColor=row.dataset.enchantRecipient===focus?"#ffe197":"#42566a";
      row.style.background=row.dataset.enchantRecipient===focus?"#304157":"#132130";
    }
    if(changed){
      const header=[...skillBar.querySelectorAll("button[data-enchant-recipient]")]
        .find(row=>row.dataset.enchantRecipient===focus);
      header?.scrollIntoView?.({block:"nearest",inline:"nearest"});
    }
    return true;
  }
  function updateEnchantmentMarkerPositions(){
    if(mode!=="enchant-weapon-select"||!enchantMenuCandidates.length)return;
    const renderer=globalThis.CardTacticsRenderer;
    if(!renderer?.scene||!renderer?.camera?.camera||!renderer.engine)return;
    const camera=renderer.camera.camera,engine=renderer.engine;
    const viewport=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());
    const transform=renderer.scene.getTransformMatrix(),rect=renderer.canvas.getBoundingClientRect();
    const sx=rect.width/Math.max(1,engine.getRenderWidth()),sy=rect.height/Math.max(1,engine.getRenderHeight());
    for(const group of enchantMenuCandidates){
      const button=enchantMarkerButtons.get(String(group.target.id));if(!button)continue;
      const unit=group.target;
      if(!unit?.alive){button.hidden=true;continue;}
      const tile=TacticalEngine.tile(map,unit.x,unit.y),base=Number(unit.renderZ??unit.z??tile?.elevation??0);
      const world=new BABYLON.Vector3(Number(unit.x)*TILE_SIZE,base*ELEVATION_HEIGHT+UNIT_VISUAL_HEIGHT+.35,Number(unit.y)*TILE_SIZE);
      const point=BABYLON.Vector3.Project(world,BABYLON.Matrix.Identity(),transform,viewport);
      if(point.z<0||point.z>1){button.hidden=true;continue;}
      const x=rect.left+point.x*sx,y=rect.top+point.y*sy;
      button.hidden=x<rect.left-14||x>rect.right+14||y<rect.top-14||y>rect.bottom+14;
      if(!button.hidden){button.style.left=`${x}px`;button.style.top=`${y}px`;}
    }
  }
  function releaseEnchantmentMarkers(){
    if(enchantMarkerObserver&&enchantMarkerScene)
      enchantMarkerScene.onAfterRenderObservable.remove(enchantMarkerObserver);
    enchantMarkerObserver=null;enchantMarkerScene=null;
    enchantMarkerButtons.clear();enchantMarkerRoot.replaceChildren();enchantMenuCandidates=[];
    focusedEnchantRecipientId=null;
  }
  function syncEnchantmentMarkers(pending){
    if(!pending){releaseEnchantmentMarkers();return;}
    const groups=enchantRecipientGroups(pending);
    enchantMenuCandidates=groups;
    const desired=new Set(groups.map(group=>String(group.target.id)));
    for(const [key,button]of enchantMarkerButtons){if(!desired.has(key)){button.remove();enchantMarkerButtons.delete(key);}}
    for(const group of groups){
      const key=String(group.target.id);
      if(enchantMarkerButtons.has(key))continue;
      const identity=enchantIdentity(group.target),self=group.target.id===pending.attacker.id;
      const marker=document.createElement("button");marker.type="button";
      marker.className="enchant-recipient-marker";
      marker.textContent=self?"自己":identity.mark;
      marker.title=`${self?"自己":`${identity.name} ${identity.mark}`}｜點選查看附魔武器`;
      marker.setAttribute("aria-label",marker.title);
      marker.style.cssText="position:fixed;transform:translate(-50%,-100%);min-width:30px;height:30px;z-index:120;border:2px solid #6f9bb8;border-radius:50%;color:#fff3ca;background:#10283ce8;font:bold 14px system-ui;pointer-events:auto;touch-action:manipulation;padding:2px 5px;white-space:nowrap;";
      marker.addEventListener("pointerdown",event=>event.stopPropagation());
      marker.addEventListener("click",event=>{event.stopPropagation();focusEnchantmentRecipient(group.target.id);});
      enchantMarkerButtons.set(key,marker);enchantMarkerRoot.appendChild(marker);
    }
    const renderer=globalThis.CardTacticsRenderer;
    if(renderer?.scene&&enchantMarkerScene!==renderer.scene){
      if(enchantMarkerObserver&&enchantMarkerScene)enchantMarkerScene.onAfterRenderObservable.remove(enchantMarkerObserver);
      enchantMarkerScene=renderer.scene;
      enchantMarkerObserver=enchantMarkerScene.onAfterRenderObservable.add(updateEnchantmentMarkerPositions);
    }
    if(!desired.has(String(focusedEnchantRecipientId)))focusedEnchantRecipientId=String(pending.attacker.id);
    focusEnchantmentRecipient(focusedEnchantRecipientId);
    updateEnchantmentMarkerPositions();
  }
  function addActionButton(text,onClick,disabled=false,skill=null){
    const button=document.createElement("button");button.textContent=text;button.className="action-button";
    if(skill){
      inspectableSkillButtons.set(button,selected?UnitRuntimeEngine.skillForUnit(selected,skill):skill);
      button.style.webkitTouchCallout="none";button.style.webkitUserSelect="none";button.style.userSelect="none";
      // Native disabled buttons cannot receive long-press events; keep them inspectable but not executable.
      if(disabled){button.setAttribute("aria-disabled","true");button.style.opacity=".55";}
      button.onclick=()=>{if(!disabled)onClick();};
    }else{button.disabled=disabled;button.onclick=onClick;}
    skillBar.appendChild(button);return button;
  }
  function addCommandPanelClose(){const button=document.createElement("button");button.type="button";button.className="battle-command-close";button.textContent="×";button.setAttribute("aria-label","關閉作戰選單");button.onclick=()=>{commandPanelCollapsed=true;render();};skillBar.appendChild(button);}
  function renderCollapsedCommandButton(){skillBar.classList.add("command-panel-collapsed");}
  // Read-only attack forecast. The official TacticalEngine/BattleEngine remain
  // the sole owners of terrain, facing, hit, crit and damage formulas. Forced
  // outcomes are calculated on shallow unit copies, without RNG or mutation
  // of live facing/HP, and without dispatching engagement animations.
  function engagementForecast(attacker,defender,skill){
    if(!attacker?.alive||!defender?.alive||!attacker.character||!defender.character||!skill)return null;
    const effective=effectiveSkill(attacker,skill);
    const estimate=(options)=>{const a={...attacker},d={...defender};TacticalEngine.faceToward(a,d);return TacticalEngine.resolve(map,a,d,effective,options).result;};
    const normal=estimate({forceHit:true,disableCrit:true});
    const critical=estimate({forceHit:true,forceCrit:true});
    const hp=Math.max(0,Number(defender.hp||0)),maxHp=Math.max(1,Number(defender.character.combat?.hp||hp||1));
    const pct=(n)=>Math.max(0,Math.min(100,Math.round(n)));
    const guaranteed=normal.guaranteedHit===true;
    const hit=guaranteed?100:pct(normal.hc),crit=pct(normal.cc);
    const type=normal.type;
    const extraNormal=BattleResolution.previewEnchantmentBonus(attacker,defender,effective)+BattleResolution.previewInherentBonus(attacker,defender,effective);
    const extraCrit=BattleResolution.previewEnchantmentBonus(attacker,defender,effective,{critical:true})+BattleResolution.previewInherentBonus(attacker,defender,effective,{critical:true});
    const baseDamage=Math.max(0,Number(normal.damage||0)+extraNormal);
    const critDamage=Math.max(0,Number(critical.damage||0)+extraCrit);
    const methodOptions=BattleResolution.defenseMethods(defender).map(method=>{
      const rule=method.vs?.[type];
      if(!rule)return{id:method.id,label:method.name,valid:false};
      const blocked=method.method==='GUARD'&&effective?.weapon&&attacker.character.weapons?.[effective.weapon]?.affixes?.includes('PHYSICAL_DEFENSE_IGNORE')&&method.artifact!==true;
      if(blocked)return{id:method.id,label:method.name,valid:false,bypassed:true};
      const successRate=Number.isFinite(Number(rule.chance))?pct(Number(rule.chance)):100;
      const reduction=method.method==='PARRY'?0:Number.isFinite(Number(rule.damageMultiplier))?Number(rule.damageMultiplier):1;
      const guardMultiplier=method.method==='GUARD'?Number(defender.character.modifiers?.guardMultiplier??1):1;
      const damageIfBlocked=Math.max(0,Math.round(baseDamage*reduction*guardMultiplier));
      return{id:method.id,label:method.name,valid:true,successRate,
        damageIfBlocked,damageIfFailed:baseDamage,
        hpAfterBlocked:Math.max(0,hp-damageIfBlocked)};
    });
    // ACTIVE_EVADE_PENALTY (=20) and graze are defined by BattleResolution.
    // Both outcomes must stay separate: full hits, half-damage grazes and misses.
    const evadeFull=pct(Math.max(0,normal.hc-20));
    const evadeGraze=pct(Math.max(0,normal.hc)-evadeFull);
    const evadeMiss=pct(100-evadeFull-evadeGraze);
    return{attackerId:attacker.id,defenderId:defender.id,hp,maxHp,hit,crit,
      normalDamage:baseDamage,criticalDamage:critDamage,
      hpAfterNormal:Math.max(0,hp-baseDamage),hpAfterCritical:Math.max(0,hp-critDamage),
      attackType:type,guaranteed,evade:{full:evadeFull,graze:evadeGraze,miss:evadeMiss,
        grazeDamage:Math.round(Number(normal.damage||0)*.5)+BattleResolution.previewEnchantmentBonus(attacker,defender,effective,{grazeMultiplier:.5})+BattleResolution.previewInherentBonus(attacker,defender,effective,{grazeMultiplier:.5})},defenseMethods:methodOptions,
      note:'僅預測主攻命中與 HP；護盾、異常狀態、後續連鎖及支援行動依正式結算。'};
  }
  // Ordinary single-target attacks enter the existing confirmed engagement
  // transaction even without an eligible support ally. Skill execution is
  // unchanged: no mana, actions, damage or die rolls are consumed by preview.
  function previewPlayerAttack(attacker,defender,skill){
    if(skill?.utilityAction||skill?.effects||skill?.relationEffects||skill?.bloodAction||skill?.approach||targetType(skill)!=='SINGLE'){
      prepareAttack(attacker,defender,skill);return;
    }
    if(!canUseSkill(attacker,skill)){prepareAttack(attacker,defender,skill);return;}
    const candidates=BattleResolution.supportCandidates({units,initiator:attacker,target:defender,canUseSkill})
      .map(candidate=>({...candidate,skills:candidate.skills.filter(supportSkill=>TacticalEngine.canTarget(map,candidate.ally,defender,supportSkill,environmentState))}))
      .filter(candidate=>candidate.skills.length);
    pendingEngagement={attacker,defender,skill:effectiveSkill(attacker,skill),candidates};
    engagementFocusSerial++;
    supportSelection=new Map();mode='support-select';render();
  }
  function engagementOdds(attacker,defender,skill){if(!attacker?.character||!defender?.character||!skill)return null;const resolved=effectiveSkill(attacker,skill);const hit=Math.max(0,Math.min(100,Math.round(BattleEngine.hitChance(attacker.character,defender.character,resolved))));return{hit,evade:100-hit};}
  function engagementUnitPresentation(unit,attacker,defender,odds){const max=Math.max(1,Number(unit?.hallucination?unit.perceivedMaxHp??unit?.character?.combat?.hp??1:unit?.character?.combat?.hp||unit?.hp||1)),hp=Math.max(0,Number(unit?.hallucination?unit.perceivedHp??max:unit?.hp||0));return{id:unit.id,x:unit.x,y:unit.y,name:unit.character.name,shortName:shortName(unit.character.name),team:unit.team,hp,maxHp:max,hpPct:Math.max(0,Math.min(100,hp/max*100)),oddsLabel:!odds?"":unit===attacker?`命中率 ${odds.hit}%`:unit===defender?`迴避率 ${odds.evade}%`:""};}
  function engagementPresentation(){const attack=pendingEngagement||pendingEnemyAttack;if(!attack)return null;const {attacker,defender,skill}=attack,odds=engagementOdds(attacker,defender,skill),forecast=engagementForecast(attacker,defender,skill);const player=attacker.team===TEAM.PLAYER?attacker:defender.team===TEAM.PLAYER?defender:null;const enemy=player===attacker?defender:attacker;const model={mode,focusId:engagementFocusSerial,skillName:skill?.name||"交戰",
    attackerName:attacker?.character?.name||"敵方",defenderName:defender?.character?.name||"我方",
    attackType:skill?.attackType||null,element:skill?.element||null,forecast,
    attackerId:attacker?.id,defenderId:defender?.id,
    player:engagementUnitPresentation(player,attacker,defender,odds),
    enemy:engagementUnitPresentation(enemy,attacker,defender,odds),groups:[],actions:[]};const action=(id,label,disabled=false,payload=null)=>model.actions.push({id,label,disabled,payload});if(mode==="support-select"&&pendingEngagement){for(const {ally,skills} of pendingEngagement.candidates){model.groups.push({id:ally.id,title:`${ally.character.name}${ally.acted?"｜已完成主動行動":""}`,actions:[{id:"SUPPORT_NONE",label:"不支援",payload:{allyId:ally.id}},...skills.map(s=>({id:"SUPPORT_SKILL",label:`${supportSelection.get(ally.id)===s?"✓ ":""}${s.name}｜${resourceLabel(ally,s)}`,payload:{allyId:ally.id,skillId:s.id}}))]});}action("CONFIRM_ENGAGEMENT","開始交戰");action("BACK_SUPPORT","返回");return model;}if(!pendingEnemyAttack)return model;const prep=BattleResolution.prepareSingleTargetReaction({defender,attacker,canUseSkill});prep.counterSkills=prep.counterSkills.filter(s=>TacticalEngine.canTarget(map,defender,attacker,s,environmentState));if(mode==="enemy-counter-select"){prep.counterSkills.forEach(s=>action("COUNTER_SKILL",`${s.name}｜射程 ${s.range.min}-${s.range.max}｜${resourceLabel(defender,s)}`,false,{skillId:s.id}));action("BACK_REACTION","返回");}else if(mode==="enemy-defense-select"){prep.defenseMethods.forEach(m=>action("DEFENSE_METHOD",`${m.name}｜${m.sourceName||m.method}`,false,{methodId:m.id}));action("BACK_REACTION","返回");}else if(mode==="enemy-guard-select"){guardCandidates().forEach(({guardian,profiles})=>action("GUARDIAN",`${guardian.character.name}｜${profiles.map(p=>p.name).join("／")}`,false,{guardianId:guardian.id}));action("BACK_GUARD","返回");}else if(mode==="enemy-guard-reaction"){const guardian=selectedGuardian;if(!guardian?.alive)return{...model,invalidGuardian:true};const guardianMethods=BattleResolution.guardProfiles(guardian);const counterSkills=BattleResolution.counterSkills({defender,attacker,canUseSkill}).filter(s=>TacticalEngine.canTarget(map,defender,attacker,s,environmentState));if(!selectedGuardInterception){guardianMethods.forEach(m=>action("GUARD_METHOD",`${m.name}｜${m.sourceName||m.method}`,false,{methodId:m.id}));action("BACK_GUARD_METHOD","返回");}else{action("GUARD_ACCEPT","援護承受｜原目標不反擊");counterSkills.forEach(s=>action("GUARD_COUNTER",`原目標反擊｜${s.name}｜${resourceLabel(defender,s)}`,false,{skillId:s.id}));action("BACK_GUARD_INTERCEPTION","返回防禦方式");}}else{const guards=guardCandidates();action("REACTION_COUNTER","反擊",prep.counterSkills.length===0);action("REACTION_DEFENSE","防禦",prep.defenseMethods.length===0);action("REACTION_EVADE","迴避");action("REACTION_GUARD","援護防禦",guards.length===0);}return model;}
  function handleEngagementUIAction(id,payload={}){if(id==="SUPPORT_NONE"){supportSelection.delete(payload.allyId);render();return;}if(id==="SUPPORT_SKILL"){const entry=pendingEngagement?.candidates?.find(c=>c.ally.id===payload.allyId);const skill=entry?.skills?.find(s=>s.id===payload.skillId);if(skill)supportSelection.set(payload.allyId,skill);render();return;}if(id==="CONFIRM_ENGAGEMENT"){confirmEngagement();return;}if(id==="BACK_SUPPORT"){clearEngagement();mode="attack";render();return;}if(id==="REACTION_COUNTER"){chooseEnemyReaction("COUNTER");return;}if(id==="REACTION_DEFENSE"){chooseEnemyReaction("DEFENSE");return;}if(id==="REACTION_EVADE"){chooseEnemyReaction("EVADE");return;}if(id==="REACTION_GUARD"){mode="enemy-guard-select";render();return;}if(id==="BACK_REACTION"){pendingReactionType=null;mode="enemy-reaction";render();return;}if(id==="COUNTER_SKILL"){const skill=BattleResolution.counterSkills({defender:pendingEnemyAttack?.defender,attacker:pendingEnemyAttack?.attacker,canUseSkill}).find(s=>s.id===payload.skillId);if(skill)executeEnemyAttack(BattleResolution.createReaction("COUNTER",{skill}));return;}if(id==="DEFENSE_METHOD"){executeEnemyAttack(BattleResolution.createReaction("DEFENSE",{methodId:payload.methodId}));return;}if(id==="GUARDIAN"){const guardian=units.find(u=>u.id===payload.guardianId&&u.alive);if(guardian)chooseGuardian(guardian);return;}if(id==="BACK_GUARD"){selectedGuardian=null;selectedGuardInterception=null;mode="enemy-reaction";render();return;}if(id==="GUARD_METHOD"){if(selectedGuardian){selectedGuardInterception=BattleResolution.createGuardInterception(selectedGuardian,payload.methodId);render();}return;}if(id==="BACK_GUARD_METHOD"){selectedGuardian=null;selectedGuardInterception=null;mode="enemy-guard-select";render();return;}if(id==="GUARD_ACCEPT"){executeEnemyAttack(null,selectedGuardInterception);return;}if(id==="GUARD_COUNTER"){const {attacker,defender}=pendingEnemyAttack||{};const skill=BattleResolution.counterSkills({defender,attacker,canUseSkill}).find(s=>s.id===payload.skillId);if(skill)executeEnemyAttack(BattleResolution.createReaction("COUNTER",{skill}),selectedGuardInterception);return;}if(id==="BACK_GUARD_INTERCEPTION"){selectedGuardInterception=null;render();}}

  function itemEntries(unit){return globalThis.ItemRuntimeEngine?.list?.(unit)||[];}
  function groundItemEntries(unit){return globalThis.ItemInventoryEngine?.groundAt?.(unit.x,unit.y)||[];}
  function adjacentAllies(unit){return (units||[]).filter(other=>other?.alive&&other.id!==unit.id&&other.team===unit.team&&Math.abs(other.x-unit.x)+Math.abs(other.y-unit.y)<=1);}
  function useBattleItem(unit,payloadId){const result=ItemRuntimeEngine.use(unit,payloadId);if(!result?.ok){pushLog(`${unit.character.name}｜目前無法使用這個道具。`,"SYSTEM");render();return;}pushLog(`${unit.character.name} 使用「${result.item.name}」。`,"BATTLE");if(result.consumeAction){commitPendingMove(unit);finishUnit(unit,`使用「${result.item.name}」，行動結束。`);}else mode="item-menu";render();}
  function pickupBattleItem(unit,groundId){const item=ItemInventoryEngine.groundAt(unit.x,unit.y).find(entry=>entry.id===groundId),result=ItemRuntimeEngine.pickup(unit,groundId);pushLog(result?.ok?`${unit.character.name} 拾取「${ItemDatabase.get(item?.itemId)?.name||item?.itemId}」。`:`${unit.character.name} 無法拾取道具。`,result?.ok?"SYSTEM":"DETAIL");render();}
  function dropBattleItem(unit,payloadId){const entry=itemEntries(unit).find(x=>x.payload.id===payloadId),result=ItemRuntimeEngine.drop(unit,payloadId);pushLog(result?.ok?`${unit.character.name} 放下「${entry?.item?.name||"道具"}」。`:`${unit.character.name} 無法放下道具。`,result?.ok?"SYSTEM":"DETAIL");render();}
  function transferBattleItem(unit,payloadId,targetId){const entry=itemEntries(unit).find(x=>x.payload.id===payloadId),target=units.find(x=>x.id===targetId&&x.alive),result=ItemRuntimeEngine.transfer(unit,target,payloadId);pushLog(result?.ok?`${unit.character.name} 將「${entry?.item?.name||"道具"}」交給 ${target?.character?.name||"友軍"}。`:`${unit.character.name} 無法轉交道具。`,result?.ok?"SYSTEM":"DETAIL");render();}

  function renderPanel(){
    if(mode!=="enchant-weapon-select"&&enchantMenuCandidates.length)releaseEnchantmentMarkers();
    dismissSkillInspection();skillBar.innerHTML="";skillBar.classList.remove("enemy-reaction-panel","command-panel-collapsed","engagement-overlay");
    if(matchResult||phase===PHASE.CARD)return;
    if(phase===PHASE.ENEMY){if(pendingEnemyAttack&&targetType(pendingEnemyAttack.skill)==="SINGLE"){commandPanelCollapsed=false;skillBar.classList.add("enemy-reaction-panel");const model=engagementPresentation();if(model?.invalidGuardian){selectedGuardian=null;selectedGuardInterception=null;mode="enemy-reaction";render();return;}window.TacticalUIController?.renderEngagement?.();}return;}
    if(phase!==PHASE.PLAYER||!selected)return;
    if(mode==="support-select"&&pendingEngagement){window.TacticalUIController?.renderEngagement?.();return;}
    if(selected.acted)return;
    if(mode==="command"){
      if(commandPanelCollapsed){renderCollapsedCommandButton();return;}addCommandPanelClose();if(selected.moved&&actionController.pendingMove()?.unitId===selected.id)addActionButton("取消移動",cancelPendingMove);
      if(stage?.ruleset==="CORE_CAPTURE"&&canUnitCapture(selected)){const point=capturePointForUnit(selected);addActionButton(`佔領｜${point.name}`,()=>executeCapture(selected));}
      directVerticalActions(selected).forEach(({parent,variant})=>addActionButton(variant.name||variant.id,()=>executeSelfUtilityVariant(selected,parent,variant),false,resolvedSkill(parent,variant)));
      if(selected.canAttack!==false)addActionButton("攻擊",()=>{selectedSkill=null;mode="attack-menu";render();});
      addActionButton("狀態",()=>window.TacticalUIController?.openStatus?.(selected.id));
      addActionButton("道具",()=>{mode="item-menu";render();});
      addActionButton("對話",()=>{pushLog(`${selected.character.name}｜目前沒有可對話目標。`);render();});
      addActionButton("魔法／特殊技能",()=>{selectedSkill=null;mode="special-menu";render();});
      addActionButton("待機",()=>{commitPendingMove(selected);finishUnit(selected,"待機，行動結束。",{waited:true});render();});return;
    }
    if(mode==="item-menu"){
      addCommandPanelClose();const entries=itemEntries(selected),ground=groundItemEntries(selected);if(!entries.length&&!ground.length)addActionButton("沒有可用道具",()=>{},true);
      for(const {payload,item} of entries)addActionButton(`使用｜${item.name}`,()=>useBattleItem(selected,payload.id),!ItemRuntimeEngine.canUse(selected,payload.id));
      for(const groundItem of ground){const item=ItemDatabase.get(groundItem.itemId);addActionButton(`拾取｜${item?.name||groundItem.itemId}`,()=>pickupBattleItem(selected,groundItem.id),!ItemRuntimeEngine.interactionAvailable(selected));}
      if(entries.length)addActionButton("放下／轉交",()=>{mode="item-manage";render();},!ItemRuntimeEngine.interactionAvailable(selected));
      addActionButton("返回",()=>{mode="command";render();});return;
    }
    if(mode==="item-manage"){
      addCommandPanelClose();const allies=adjacentAllies(selected);for(const {payload,item} of itemEntries(selected)){addActionButton(`放下｜${item.name}`,()=>dropBattleItem(selected,payload.id),!ItemRuntimeEngine.interactionAvailable(selected));for(const ally of allies)addActionButton(`交給 ${shortName(ally.character.name)}｜${item.name}`,()=>transferBattleItem(selected,payload.id,ally.id),!ItemRuntimeEngine.interactionAvailable(selected));}addActionButton("返回",()=>{mode="item-menu";render();});return;
    }
    if(mode==="enchant-weapon-select"){
      const pending=actionController.enchantmentSelection();
      if(!pending||pending.attacker.id!==selected.id)return;
      addActionButton("選擇友軍與武器（尚未扣 MP）",()=>{},true);
      syncEnchantmentMarkers(pending);
      for(const {target,weapons} of enchantRecipientGroups(pending)){
        const self=target.id===pending.attacker.id,identity=enchantIdentity(target);
        const label=self?"自己":`${identity.name} ${identity.mark}`;
        const header=addActionButton(label,()=>focusEnchantmentRecipient(target.id));
        header.dataset.enchantRecipient=String(target.id);
        header.style.cssText+=";text-align:left;border:1px solid #42566a;background:#132130;font-weight:bold;";
        const portrait=globalThis.VisualDatabase?.characterHudPortrait?.(target.character?.id||target.characterId);
        if(portrait){
          const img=document.createElement("img");img.src=new URL(portrait,document.baseURI).href;
          img.alt="";img.loading="lazy";
          img.style.cssText="width:26px;height:26px;object-fit:cover;object-position:50% 17%;border-radius:5px;float:left;margin-right:7px;";
          header.prepend(img);
        }
        for(const weapon of weapons){
          const btn=addActionButton(`　${({BOW:"🏹",POLEARM:"🔱",TRIDENT:"🔱",HAMMER:"🔨",KNIFE:"🗡",RAPIER:"🗡",GREATSWORD:"⚔",SWORD:"⚔"}[weapon.kind]||"⚔")} ${weapon.name}｜確認附魔`,()=>
            actionController.commitCandidateEnchantment(target.id,weapon.slot),false,pending.skill);
          btn.dataset.enchantRecipient=String(target.id);
          btn.addEventListener("pointerenter",()=>focusEnchantmentRecipient(target.id));
        }
      }
      focusEnchantmentRecipient(focusedEnchantRecipientId);
      addActionButton("取消附魔（未消耗 MP）",()=>actionController.cancelEnchantmentSelection());return;
    }
    if(mode==="enchant-followup"){
      const followup=actionController.enchantmentFollowup();
      if(!followup||followup.unitId!==selected.id)return;
      const skills=SkillDatabase.list(window.EffectEngine?EffectEngine.skillIds(selected):selected.character.skills)
        .filter(skill=>skill.weapon===followup.weaponSlot&&skill.target==="ENEMY"&&!skill.utilityAction&&(skill.targetType||"SINGLE")==="SINGLE");
      skills.forEach(skill=>{
        addActionButton(`攻擊｜${skill.name}`,()=>{
          if(!canUseSkill(selected,skill))return;
          selectedSkill=attackWithEnchantmentTargets(selected,skill);
          selectedSkillVariant=null;mode="attack";render();
        },!canUseSkill(selected,skill),skill);
      });
      addActionButton("取消攻擊並待機（保留附魔）",()=>actionController.cancelEnchantmentFollowup());return;
    }
    const memoryIds=new Set(EffectEngine.bloodMemorySkills(selected).map(skill=>skill.id));
    const allSkills=SkillDatabase.list(window.EffectEngine?EffectEngine.skillIds(selected):selected.character.skills);
    const isSpecial=skill=>skill.category!=="ATTACK";
    const shownSkills=mode==="blood-memory-menu"?allSkills.filter(skill=>memoryIds.has(skill.id)):
      mode==="special-menu"?allSkills.filter(skill=>isSpecial(skill)&&!memoryIds.has(skill.id)):
      mode==="attack-menu"?allSkills.filter(skill=>!isSpecial(skill)&&!memoryIds.has(skill.id)):[];
    if(mode==="variant-menu"&&selectedSkill){if(commandPanelCollapsed){renderCollapsedCommandButton();return;}addCommandPanelClose();skillVariants(selectedSkill).forEach(variant=>{addActionButton(variant.name||variant.id,()=>{const parent=selectedSkill;if(executeSelfUtilityVariant(selected,parent,variant))return;selectedSkillVariant=variant;selectedSkill=attackWithEnchantmentTargets(selected,resolvedSkill(parent,variant));if(selectedSkill?.utilityAction?.type==="ENCHANT_WEAPON"){actionController.beginEnchantment(selected,selectedSkill);return;}mode=targetType(selectedSkill)==="SINGLE"?"attack":"map-target";render();},false,resolvedSkill(selectedSkill,variant));});addActionButton("返回",()=>{const special=selectedSkill?.category!=="ATTACK";selectedSkill=null;selectedSkillVariant=null;mode=special?"special-menu":"attack-menu";render();});return;}
    if(mode==="copy-skill-select"&&pendingCopySkill){
      pendingCopySkill.options.forEach(skill=>addActionButton(`${skill.name}｜血能 ${UnitRuntimeEngine.bloodMemoryCost(skill)}`,()=>{
        EffectEngine.rememberBloodSkill(pendingCopySkill.attacker,skill.id,pendingCopySkill.target);
        pushLog(`${pendingCopySkill.attacker.character.name} 記下「${skill.name}」的血液記憶。`,"BATTLE");
        const actor=pendingCopySkill.attacker;pendingCopySkill=null;finishActiveSkill(actor);
      },false,skill));
      addActionButton("略過本次血液記憶",()=>{const actor=pendingCopySkill.attacker;pendingCopySkill=null;finishActiveSkill(actor);});return;
    }
    if(mode==="attack-menu"||mode==="special-menu"||mode==="blood-memory-menu"){if(commandPanelCollapsed){renderCollapsedCommandButton();return;}addCommandPanelClose();if(mode==="special-menu"&&selected._bloodAwakened&&EffectEngine.bloodMemorySkills(selected).length)
      addActionButton(`血液記憶（${EffectEngine.bloodMemorySkills(selected).length}）`,()=>{mode="blood-memory-menu";render();});
    shownSkills.forEach(skill=>{const range=TacticalEngine.range(skill),usable=canUseSkill(selected,skill);addActionButton(`${skill.name}｜射程 ${range.min}-${range.max}｜${resourceLabel(selected,skill)}`,()=>{selectedSkill=attackWithEnchantmentTargets(selected,skill);selectedSkillVariant=null;if(!skillVariants(skill).length&&skill.target==="SELF"&&targetType(skill)==="SINGLE"&&Number(range.max||0)===0){prepareAttack(selected,selected,skill);return;}if(skill.utilityAction?.type==="ENCHANT_WEAPON"&&!skillVariants(skill).length){actionController.beginEnchantment(selected,skill);return;}mode=skillVariants(skill).length?"variant-menu":(targetType(skill)==="SINGLE"?"attack":"map-target");render();},!usable,skill);});addActionButton("返回",()=>{selectedSkill=null;mode=mode==="blood-memory-menu"?"special-menu":"command";render();});return;}
    if((mode==="map-target"||mode==="attack")&&selectedSkill){
      if(actionController.enchantmentFollowup()?.unitId===selected.id){
        addActionButton("返回攻擊選擇",backFromTargeting);
        addActionButton("取消攻擊並待機（保留附魔）",()=>actionController.cancelEnchantmentFollowup());
      }else addActionButton("取消施放",backFromTargeting);
      return;
    }
  }

  resetMap.onclick=()=>{if(geminiSession?.enabled)geminiPreparationScreen().then(()=>resetBattle());else resetBattle();};
  battleContext=createBattleContext();if(!window.TacticalActionController?.create)throw new Error("TacticalActionController is not loaded.");const actionController=window.TacticalActionController.create(battleContext);
  const {attackPlanForTarget,targetableEntities,targetRangeTiles,environmentTargetTiles,executeEnvironmentTargetSkill,approachTargetForAttack,resolveDirectTargetAttack,mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,backFromTargeting,finishActiveSkill,executeEffectSkill,approachForSkill,prepareAttack,confirmEngagement,executeEngagement}=actionController;
  if(!window.BattlePresentationController?.create)throw new Error("BattlePresentationController is not loaded.");presentationController=window.BattlePresentationController.create({TEAM,PHASE,state:presentationState,targetType,targetableEntities,targetRangeTiles,mapTargetTiles,environmentTargetTiles,unitAt:presentationUnitAt,coreAt:presentationCoreAt,effectiveSkill});
  if(!window.BattleObjectiveController?.create)throw new Error("BattleObjectiveController is not loaded.");objectiveController=window.BattleObjectiveController.create({state:()=>({stage,stageState,round,units,cores,cardState,enemyCardState,matchResult}),setMatchResult:value=>{matchResult=value;phase=PHASE.ENDED;},onMatchEnd:value=>{clearSelection();clearEnemyReaction();pushLog(`Round ${round}｜${value}｜關卡目標已${value==="VICTORY"?"達成":"失敗"}。`,"SYSTEM");}});
  if(!window.EncounterRewardEngine?.create)throw new Error("EncounterRewardEngine is not loaded.");encounterRewards=window.EncounterRewardEngine.create({playerCardState:()=>cardState,pushLog});
  if(!window.DeathLifecycleEngine?.create)throw new Error("DeathLifecycleEngine is not loaded.");deathLifecycle=window.DeathLifecycleEngine.create({stageEvent,cardStateFor:unit=>unit.team===TEAM.PLAYER?cardState:unit.team===TEAM.ENEMY?enemyCardState:null,pushLog,onDefeated:unit=>{if(unit.team===TEAM.ENEMY)encounterRewards.onDefeated(unit);},onFinalized:()=>checkMatchEnd()});
  if(!window.BattleCoreCaptureController?.create)throw new Error("BattleCoreCaptureController is not loaded.");coreCaptureController=window.BattleCoreCaptureController.create({TEAM,state:()=>({stage,units,cores}),pushLog,checkMatchEnd,commitPendingMove:unit=>commitPendingMove(unit),stageEvent,onCaptureComplete:()=>{mode="inspect";if(!maybeAutoEndPlayerTurn()){window.dispatchEvent(new CustomEvent("cardtactics:state"));render();}}});
  if(!window.BattleEnvironmentController?.create)throw new Error("BattleEnvironmentController is not loaded.");environmentController=window.BattleEnvironmentController.create({TEAM,state:()=>({map,units,environmentState}),living,pushLog,handleDefeated,stageEvent,damageUnitFlat});
  if(!window.TacticalEnemyController?.create)throw new Error("TacticalEnemyController is not loaded.");enemyController=window.TacticalEnemyController.create(battleContext);
  if(!window.CardPhaseController?.create)throw new Error("CardPhaseController is not loaded.");cardPhaseController=window.CardPhaseController.create({TEAM,PHASE,state:()=>({map,units,stage,round,phase,matchResult,cardState,pendingCard,environmentState}),setPhase:value=>{phase=value;},getPendingCard:()=>pendingCard,setPendingCard:value=>{pendingCard=value;},clearSelection,pushLog,render,emitState:()=>window.dispatchEvent(new CustomEvent("cardtactics:state")),onUnitCreated,resetActions,maybeAutoEndPlayerTurn,unitAt,createUnit:(id,team,characterId,x,y)=>createUnit(id,team,characterId,x,y),nextUnitId:()=>`pc${unitSerial++}`,aoeTiles,applyForcedMovement,damageUnitFlat,applyEnvironmentHazardToUnit,resolveEnvironmentEvents,logEnvironmentEvent,checkMatchEnd,handleDefeated});

  function debugEmit(){render();window.dispatchEvent(new CustomEvent("cardtactics:state"));return true;}
  function debugSetWeather(weather,duration=5,{applyPulse=true}={}){
    if(!environmentState||!map||!EnvironmentEngine.WEATHER?.[weather])return false;
    const turns=Math.max(0,Math.min(99,Math.floor(Number(duration)||0)));
    // The battle test console still uses applyPulse=true; the hydrology lab may
    // opt into card-equivalent applyPulse=false (the first rain arrives on tick).
    const events=EnvironmentEngine.setWeather(environmentState,weather,map,{duration:turns,applyPulse:applyPulse!==false})||[];
    events.forEach(logEnvironmentEvent);
    resolveEnvironmentEvents(events,{reason:"Battle Test Console 氣候切換"});
    pushLog(`TEST｜氣候切換為 ${weather}｜${turns} 回合｜${applyPulse===false?"卡牌式：下次環境回合才降雨":"即時環境脈衝"}。`,"SYSTEM");
    return debugEmit();
  }
  function debugAdvanceEnvironmentTurns(count=1){
    if(!map||!environmentState||matchResult||hallucinationSession?.active)return false;
    const steps=Math.max(1,Math.min(10,Math.floor(Number(count)||1)));
    // Exactly the same environment path used by beginPlayerTurn(). Do not
    // fabricate Q/D, skip weatherPulse(), or run the enemy tactical phase.
    for(let i=0;i<steps;i++){
      applyEnvironmentHazards({reason:"TEST LAB 環境回合"});
      EnvironmentEngine.tick(environmentState);
      resolveWeatherEvents();
      debugEnvironmentSteps++;
      pushLog(`TEST LAB｜環境回合 +1｜累計 ${debugEnvironmentSteps}｜天氣 ${environmentState.weather||"CLEAR"}。`,"SYSTEM");
      if(matchResult)break;
    }
    return debugEmit();
  }
  function debugSetTimeOfDay(value){
    if(!environmentState||!globalThis.EnvironmentEngine?.setTimeOfDay)return false;
    EnvironmentEngine.setTimeOfDay(environmentState,value);
    EffectEngine.syncConditionalPassives(units,environmentState);
    pushLog(`TEST｜日夜切換為 ${environmentState.timeOfDay}。`,"SYSTEM");
    return debugEmit();
  }
  function debugSetMoonlight(moonlight){
    if(!environmentState||!globalThis.EnvironmentEngine?.setMoonlight)return false;
    if(!EnvironmentEngine.setMoonlight(environmentState,moonlight))return false;
    pushLog(`TEST｜月光改為 ${environmentState.moonlight}。`,"SYSTEM");
    return debugEmit();
  }
  function debugSetWind(direction="CALM",strength=0){if(!environmentState||!globalThis.EnvironmentEngine?.setWind)return false;const vector=EnvironmentEngine.windVector?.(direction)||{x:0,y:0};const requested=String(direction||"CALM").toUpperCase(),value=requested==="CALM"?{x:0,y:0,strength:0}:{...vector,strength:Math.max(0,Math.min(Number(EnvironmentEngine.WIND_SCALE?.MAX||8),Number(strength||0)))};const wind=EnvironmentEngine.setWind(environmentState,value);if(!wind)return false;pushLog(`TEST｜風況切換為 ${EnvironmentEngine.windLabel?.(wind)||requested}。`,"SYSTEM");return debugEmit();}
  function debugApplyEnvironmentForce(x,y,force){x=Number(x);y=Number(y);force=String(force||"").toUpperCase();const tile=TacticalEngine.tile(map,x,y);if(!tile||!EnvironmentEngine.FORCE?.[force])return false;const events=EnvironmentEngine.apply({map,state:environmentState,x,y,forces:[force]})||[];events.forEach(logEnvironmentEvent);resolveEnvironmentEvents(events,{reason:`Battle Test Console ${force}`});pushLog(`TEST｜(${x},${y}) 套用環境力 ${force}。`,"SYSTEM");return debugEmit();}
  function debugClearTileEffects(x,y){x=Number(x);y=Number(y);const tile=TacticalEngine.tile(map,x,y);if(!tile||!environmentState)return false;environmentState.effects?.delete?.(`${x},${y}`);pushLog(`TEST｜清除 (${x},${y}) 的暫時環境效果。`,"SYSTEM");return debugEmit();}
  function debugGiveCard(cardId,owner="PLAYER"){const card=CardDatabase.get(cardId);if(!card)return false;const target=String(owner).toUpperCase()==="ENEMY"?enemyCardState:cardState;if(!target?.zones?.hand)return false;target.zones.hand.push(card.id);const required=Math.max(0,Number(card.cost||0));target.maxCrystals=Math.max(Number(target.maxCrystals||0),required,10);target.crystalCapacity=Math.max(Number(target.crystalCapacity||0),required,10);target.crystals=Math.max(Number(target.crystals||0),required,10);pushLog(`TEST｜${String(owner).toUpperCase()==="ENEMY"?"敵方":"我方"}手牌加入「${card.name}」。`,"SYSTEM");return debugEmit();}
  function debugSpawnCharacterCard(cardId,owner="ENEMY",x=0,y=0){const card=CardDatabase.get(cardId);if(!CardDatabase.isCharacter(card))return false;x=Number(x);y=Number(y);const tile=TacticalEngine.tile(map,x,y);if(!tile||unitAt(x,y))return false;const requested=String(owner).toUpperCase(),team=requested==="PLAYER"?TEAM.PLAYER:requested==="NEUTRAL"?TEAM.NEUTRAL:TEAM.ENEMY;const prefix=team===TEAM.PLAYER?"tp":team===TEAM.NEUTRAL?"tn":"te";let id;do{id=`${prefix}${unitSerial++}`;}while(units.some(unit=>unit.id===id));const unit=UnitRuntimeEngine.createFromCard({id,team,card,x,y,map});if(!unit)return false;unit.cardId=card.id;unit.deployedRound=round;unit.moved=false;unit.acted=false;unit.waited=false;units.push(unit);onUnitCreated(unit);applyEnvironmentHazardToUnit(unit,{reason:"Battle Test Console 生成",waterTrigger:"ENTER"});pushLog(`TEST｜${team===TEAM.PLAYER?"我方":team===TEAM.NEUTRAL?"中立":"敵方"}生成「${card.name}」於 (${x},${y})。`,"SYSTEM");return debugEmit();}
  function debugMoveUnit(unitId,x,y){const unit=units.find(candidate=>candidate.id===unitId&&candidate.alive);x=Number(x);y=Number(y);const tile=TacticalEngine.tile(map,x,y),occupant=unitAt(x,y);if(!unit||!tile||(occupant&&occupant.id!==unit.id))return false;unit.x=x;unit.y=y;if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(unit,tile);else unit.z=Number(TacticalEngine.elevation(tile)||0);pushLog(`TEST｜${unit.character.name} 移動至 (${x},${y})。`,"SYSTEM");return debugEmit();}
  function debugState(){return{moonlight:environmentState?.moonlight||"PARTIAL",timeOfDay:environmentState?.timeOfDay||"DAY",weather:environmentState?.weather||"CLEAR",weatherTurnsRemaining:environmentState?.weatherTurnsRemaining??null,climate:globalThis.EnvironmentEngine?.climateSnapshot?.(environmentState)??null,environmentSteps:debugEnvironmentSteps,round,wind:globalThis.EnvironmentEngine?.climateSnapshot?.(environmentState)?.wind||null,map:{width:map?.width||0,height:map?.height||0},units:(units||[]).filter(unit=>unit.alive).map(unit=>({id:unit.id,name:unit.character?.name||unit.id,team:unit.team,x:unit.x,y:unit.y,z:unit.z,stealthed:!!globalThis.EffectEngine?.isStealthed?.(unit),items:globalThis.ItemRuntimeEngine?.list?.(unit).map(entry=>entry.item.id)||[]}))};}
  window.CardTacticsRuntime={getCardState:()=>cardState,getEnchantmentSelection:()=>{
    const pending=actionController?.enchantmentSelection?.();
    return pending?{casterId:pending.attacker.id,focusedRecipientId:focusedEnchantRecipientId,
      candidates:enchantRecipientGroups(pending).map(({target,weapons})=>({unitId:target.id,...enchantIdentity(target),
        weaponSlots:weapons.map(weapon=>weapon.slot),waited:!!target.waited}))}:null;
  },getEnemyCardState:()=>enemyCardState,getEnemyPresentation:()=>({...enemyView}),getBattleMap:()=>presentationWorld().map,getBattleSnapshot:()=>presentationController.battleSnapshot(),clickBattleTile,getStage:()=>presentationWorld().stage,getCores:()=>presentationWorld().cores.map(core=>({...core})),getPhase:()=>phase,getPendingCard:()=>pendingCard,getBattleLog:(type=null)=>({active:logState.active,entries:BattleLog.list(logState,type||logState.active).map(entry=>({...entry}))}),getEngagementPresentation:engagementPresentation,handleEngagementUIAction,setBattleLogTab:type=>{BattleLog.setActive(logState,type);window.dispatchEvent(new CustomEvent("cardtactics:log"));},getActionMenuAnchor:()=>phase===PHASE.PLAYER&&selected&&!commandPanelCollapsed&&mode!=="support-select"?{x:selected.x,y:selected.y}:null,getInspectedUnitPresentation:()=>{const s=presentationWorld(),unit=inspectedTile?s.units.find(candidate=>candidate.alive&&candidate.x===inspectedTile.x&&candidate.y===inspectedTile.y):selected;return presentationController.unitPresentation(unit||selected);},getInspectedTilePresentation:()=>{const w=presentationWorld(),tile=inspectedTile?TacticalEngine.tile(w.map,inspectedTile.x,inspectedTile.y):null;return tile?TileInspectionPresentation.create({map:w.map,environmentState:w.environmentState,tile}):null;},playCard:cardId=>cardPhaseController.select(cardId),canPlayCard:cardId=>cardPhaseController.canResolve(CardDatabase.get(cardId)),hasPlayableCard:()=>cardPhaseController.hasPlayableCard(),maybeAutoEndCardPhase:()=>cardPhaseController.maybeAutoEnd(),endCardPhase:()=>cardPhaseController.end(),cancelCard:()=>cardPhaseController.cancel(),endPlayerTurn,selectNextAvailableUnit,refresh:render,resetBattle,prepareGeminiMatch:geminiPreparationScreen,clearGeminiMatch:()=>{geminiSession=null;
    if(window.CardTacticsBattleSetup)delete window.CardTacticsBattleSetup.enemyDeck;},isHallucinated:()=>!!hallucinationSession?.active,debug:Object.freeze({state:debugState,setWeather:debugSetWeather,setTimeOfDay:debugSetTimeOfDay,setMoonlight:debugSetMoonlight,advanceEnvironmentTurns:debugAdvanceEnvironmentTurns,setWind:debugSetWind,applyEnvironmentForce:debugApplyEnvironmentForce,clearTileEffects:debugClearTileEffects,giveCard:debugGiveCard,spawnCharacterCard:debugSpawnCharacterCard,moveUnit:debugMoveUnit,hallucination:()=>hallucinationSession?{active:true,team:hallucinationSession.team,pending:[...pendingHallucinations.keys()]}:{active:false,pending:[...pendingHallucinations.keys()]}})};
  resetBattle();
})();
