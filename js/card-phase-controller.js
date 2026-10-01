(()=>{
"use strict";
function create(ctx){
  const {TEAM,PHASE}=ctx;const state=()=>ctx.state();
  let resolvingPresentation=false,presentationGeneration=0;
  function waterRecheckUnits(units,reason){(units||[]).filter(unit=>unit?.alive).forEach(unit=>ctx.applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"CHANGE",includeElectric:false,includeBoiling:false,includeFire:false}));}
  const TARGETED_SPELL_EFFECTS=new Set(["AREA_FIRE","AREA_PUSH","AREA_HEAL","AREA_DAMAGE","AREA_RELATION","AREA_BUFF","DISPEL","HYDROLOGY_FLOOD"]);
  function weatherName(weather){return weather==="SCORCHING_SUN"?"烈日":weather==="THUNDERSTORM"?"雷雨":weather==="HEAVY_RAIN"?"豪大雨":weather==="FOG"?"迷霧":weather==="SNOW"?"降雪":weather==="BLIZZARD"?"暴風雪":weather==="RAIN"?"雨":weather;}
  function climateSummary(environmentState){
    const c=EnvironmentEngine.climateSnapshot?.(environmentState);if(!c)return weatherName(environmentState?.weather||"CLEAR");const parts=[];
    if(c.precipitation?.type==="RAIN")parts.push("雨");else if(c.precipitation?.type==="HEAVY_RAIN")parts.push("豪大雨");else if(c.precipitation?.type==="SNOW")parts.push(EnvironmentEngine.isBlizzard?.(environmentState)?"暴風雪":"降雪");
    if(Number(c.fog?.intensity||0)>0)parts.push("迷霧");if(Number(c.thunder?.intensity||0)>0)parts.push("雷暴");return parts.length?parts.join("＋"):"晴朗";
  }
  function hasDeploymentTile(s){
    return DeploymentEngine.area(s.stage,"PLAYER").some(tile=>
      DeploymentEngine.canDeploy({stage:s.stage,map:s.map,units:s.units,owner:"PLAYER",x:tile.x,y:tile.y})
    );
  }
  function canResolve(card){
    const s=state();
    if(resolvingPresentation||s.phase!==PHASE.CARD||!CardPhaseEngine.canPlay(s.cardState,card))return false;
    if(CardDatabase.isCharacter(card))return hasDeploymentTile(s);
    if(!CardDatabase.isSpell(card))return false;
    if(card.effect?.type==="WEATHER")return true;
    return TARGETED_SPELL_EFFECTS.has(card.effect?.type)&&Array.isArray(s.map?.tiles)&&s.map.tiles.length>0;
  }
  function hasPlayableCard(){
    const s=state();
    return (s.cardState?.zones?.hand||[]).some(cardId=>canResolve(CardDatabase.get(cardId)));
  }
  function maybeAutoEnd(){
    const s=state();
    if(resolvingPresentation||s.phase!==PHASE.CARD||ctx.getPendingCard())return false;
    if(s.cardState?.mulliganAvailable&&!s.cardState?.mulliganDone)return false;
    if(hasPlayableCard())return false;
    ctx.pushLog(`Round ${s.round}｜目前已無可使用卡牌，自動結束卡牌階段。`,"SYSTEM");
    return end({automatic:true});
  }
  function begin({initial=false}={}){
    resolvingPresentation=false;presentationGeneration++;
    const s=state(),cardState=s.cardState;
    if(cardState.zones.deck.length===0&&cardState.zones.hand.length===0){cardState.crystals=Math.min(cardState.maxCrystals||10,cardState.startingCrystals||4);ctx.setPendingCard(null);CardPhaseEngine.end(cardState);ctx.setPhase(PHASE.PLAYER);ctx.clearSelection();ctx.pushLog(`Round ${s.round}｜牌庫已抽完，跳過卡牌階段，直接進入戰棋階段。`,"SYSTEM");ctx.render();ctx.emitState();return;}
    ctx.setPhase(PHASE.CARD);ctx.clearSelection();const drawn=CardPhaseEngine.begin(cardState,{handSize:Number(s.stage.cardRules?.handSize||5)});ctx.pushLog(`Round ${s.round}｜卡牌階段開始｜💎 ${cardState.crystals}。`,"SYSTEM");
    if(cardState.lastExpiredTurnCards?.length)ctx.pushLog(`TURN 卡到期｜${cardState.lastExpiredTurnCards.length} 張離開本回合卡區。`,"DETAIL");if(drawn.length)ctx.pushLog(`抽牌 ${drawn.length} 張。`,"SYSTEM");ctx.setPendingCard(null);
    if(!maybeAutoEnd()){ctx.render();ctx.emitState();}
  }
  function end({automatic=false}={}){const s=state();if(resolvingPresentation||s.phase!==PHASE.CARD)return false;ctx.setPendingCard(null);CardPhaseEngine.end(s.cardState);ctx.setPhase(PHASE.PLAYER);ctx.clearSelection();ctx.pushLog(`Round ${s.round}｜${automatic?"自動進入":"進入"}戰棋階段。`,"SYSTEM");if(ctx.maybeAutoEndPlayerTurn?.())return true;ctx.render();ctx.emitState();return true;}
  function select(cardId){
    const s=state();if(resolvingPresentation||s.phase!==PHASE.CARD)return false;const card=CardDatabase.get(cardId);if(!canResolve(card))return false;
    if(CardDatabase.isCharacter(card)){ctx.setPendingCard(card);ctx.pushLog(`選擇 ${card.name}，請在亮起的我方部署區手動選擇出生格。`,"SYSTEM");ctx.render();return true;}
    if(!CardDatabase.isSpell(card))return false;
    if(card.effect?.type==="WEATHER"){
      if(!CardPhaseEngine.commit(s.cardState,card))return false;const weather=card.effect.weather==="RAIN"?"HEAVY_RAIN":card.effect.weather,duration=Math.max(1,Number(card.effect.durationTurns||EnvironmentEngine.WEATHER_TURNS?.[weather]||1)),events=s.environmentState?EnvironmentEngine.setWeather(s.environmentState,weather,s.map,{duration,applyPulse:false}):[];ctx.pushLog(`施放卡牌魔法「${card.name}」｜消耗 ${card.cost} 水晶。`,"SYSTEM");events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:"氣候造成水位／地表狀態變化"});ctx.pushLog(`氣候調整：${weatherName(weather)}｜${duration} 回合｜目前 ${climateSummary(s.environmentState)}。`,"SYSTEM");ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;
    }
    if(["AREA_FIRE","AREA_PUSH","AREA_HEAL","AREA_DAMAGE","AREA_RELATION","AREA_BUFF","DISPEL","HYDROLOGY_FLOOD"].includes(card.effect?.type)){ctx.setPendingCard(card);ctx.pushLog(`選擇卡牌魔法「${card.name}」｜請點選戰場上的施放中心。`,"SYSTEM");ctx.render();return true;}
    return false;
  }
  function nextPresentationFrame(){
    return new Promise(resolve=>{
      if(globalThis.requestAnimationFrame)requestAnimationFrame(()=>setTimeout(resolve,0));
      else setTimeout(resolve,0);
    });
  }

  async function resolveAreaDamage(card,center,effect,affected,s,generation){
    const environmentEvents=[];
    let sliceStarted=performance.now();
    for(const tile of affected){
      if(state().map!==s.map||generation!==presentationGeneration)return false;
      const u=ctx.unitAt(tile.x,tile.y);
      if(u&&Number(effect.damage||0)>0)ctx.damageUnitFlat(u,effect.damage||0,card.name);
      const events=EnvironmentEngine.apply({map:s.map,state:s.environmentState,x:tile.x,y:tile.y,forces:effect.forces||[]})||[];
      environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);
      // Preserve the exact tile/force order and gameplay lock, but allow the
      // already-running impact animation to render between expensive tiles.
      if(performance.now()-sliceStarted>=8){await nextPresentationFrame();sliceStarted=performance.now();}
    }
    if(state().map!==s.map||generation!==presentationGeneration)return false;

    const shockwave=effect.shockwave||null;
    const innerRadius=Math.max(0,Number(effect.radius||0));
    const shockwaveRadius=innerRadius+Math.max(0,Number(shockwave?.outerRadius||0));
    if(shockwave&&shockwaveRadius>innerRadius){
      const targets=[],seen=new Set();
      for(const tile of ctx.aoeTiles(center,shockwaveRadius)){
        const range=Math.abs(Number(tile.x)-Number(center.x))+Math.abs(Number(tile.y)-Number(center.y));
        if(range<=innerRadius)continue;
        const unit=ctx.unitAt(tile.x,tile.y);
        if(!unit?.alive||seen.has(unit.id))continue;
        seen.add(unit.id);targets.push(unit);
      }
      if(targets.length)ctx.pushLog(`${card.name} 的衝擊波掃過外圈｜${targets.length} 個目標。`,"BATTLE");
      for(const unit of targets){
        if(!unit.alive)continue;
        const result=ctx.applyForcedMovement(center,unit,Math.max(0,Number(shockwave.distance||0)),{name:`${card.name}衝擊波`,lift:Math.max(0,Number(shockwave.lift||0)),damage:Math.max(0,Number(shockwave.damage||0)),damageType:shockwave.damageType||"PHYSICAL",resistAxes:shockwave.resistAxes||null});
      }
    }

    ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${card.name} 引發環境連鎖`});
  }

  function finishResolvedCard(){
    ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}
  }

  function resolveAt(card,center){
    const s=state();if(resolvingPresentation||!card||s.phase!==PHASE.CARD||ctx.getPendingCard()!==card)return false;const effect=card.effect||{},affected=ctx.aoeTiles(center,Number(effect.radius||0));if(!CardPhaseEngine.commit(s.cardState,card))return false;ctx.pushLog(`施放卡牌魔法「${card.name}」｜中心 (${center.x},${center.y})｜消耗 ${card.cost} 水晶。`,"SYSTEM");
    const presentation=effect.presentation||null;
    if(effect.type==="AREA_DAMAGE"){
      const generation=++presentationGeneration;
      resolvingPresentation=true;ctx.setPendingCard(null);
      const meteor=String(presentation?.type||"").toUpperCase()==="METEOR_STRIKE";
      const fallDuration=meteor?Math.max(200,Number(presentation.fallDuration||650)):0,impactDuration=Math.max(250,Number(presentation?.impactDuration||700));
      const startedAt=globalThis.performance?.now?.()??Date.now();
      if(meteor)globalThis.UnitAnimationEngine?.emitPresentation?.("METEOR_STRIKE",{x:Number(center.x),y:Number(center.y),innerRadius:Math.max(0,Number(effect.radius||0)),shockwaveRadius:Math.max(0,Number(effect.radius||0))+Math.max(0,Number(effect.shockwave?.outerRadius||0)),fallDuration,impactDuration,startedAt});
      ctx.render();ctx.emitState();
      const mapRef=s.map,elapsed=Math.max(0,(globalThis.performance?.now?.()??Date.now())-startedAt),remaining=Math.max(0,fallDuration-elapsed);
      setTimeout(async()=>{
        try{
          // Give the impact deadline's frame a chance to paint before resolving
          // hydrology and terrain forces. Renderer never decides game results.
          if(meteor)await nextPresentationFrame();
          if(state().map===mapRef&&generation===presentationGeneration)await resolveAreaDamage(card,center,effect,affected,s,generation);
        }finally{
          if(generation===presentationGeneration){
            resolvingPresentation=false;
            if(state().map===mapRef)finishResolvedCard();
          }
        }
      },remaining);
      return true;
    }
    if(effect.type==="AREA_FIRE"){
      const environmentEvents=[];affected.forEach(tile=>{const events=EnvironmentEngine.apply({map:s.map,state:s.environmentState,x:tile.x,y:tile.y,forces:effect.forces||["FIRE"]})||[];environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);});ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${card.name} 引發環境連鎖`});affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(u)ctx.applyEnvironmentHazardToUnit(u,{reason:"遭野火波及",waterTrigger:"CHECK",includeElectric:false,includeBoiling:false,includeFire:true});});
    }else if(effect.type==="AREA_PUSH"){
      const events=affected.map(tile=>EnvironmentEngine.createTornado(s.environmentState,tile.x,tile.y,{duration:2,pushDistance:Number(effect.distance||2),lift:Number(effect.lift||3),damage:Number(effect.damage||20),fireDamage:Number(effect.fireTornadoDamage||45),resistAxes:effect.resistAxes||{horizontal:false,vertical:true}}));events.forEach(ctx.logEnvironmentEvent);if(events.some(e=>e.type==="FIRE_TORNADO_CREATED"))ctx.pushLog("🔥🌪 火焰與龍捲風結合，形成火龍捲！","SYSTEM");affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u)return;const active=EnvironmentEngine.effectAt(s.environmentState,tile.x,tile.y),wind=active.find(e=>e.type===EnvironmentEngine.EFFECT.FIRE_TORNADO)||active.find(e=>e.type===EnvironmentEngine.EFFECT.TORNADO);if(u.alive)ctx.applyForcedMovement(center,u,Number(wind?.pushDistance||effect.distance||2),{name:wind?.type===EnvironmentEngine.EFFECT.FIRE_TORNADO?"火龍捲":"龍捲風",lift:Number(wind?.lift||effect.lift||0),damage:Number(wind?.damage||effect.damage||0),damageType:wind?.damageType||"PHYSICAL",resistAxes:wind?.resistAxes||effect.resistAxes});});
    }else if(effect.type==="AREA_HEAL"){
      affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive||u.team!==TEAM.PLAYER)return;const before=u.hp;u.hp=Math.min(u.character.combat.hp,u.hp+Number(effect.heal||0));ctx.pushLog(`${card.name} → ${u.character.name}｜回復 ${u.hp-before} HP｜HP ${u.hp}。`,"BATTLE");});

    }else if(effect.type==="AREA_RELATION"){
      const source={id:"CARD_SOURCE",team:TEAM.PLAYER};affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive)return;for(const e of effect.effects||[]){if(e.relation!==EffectEngine.relation(source,u))continue;const r=EffectEngine.apply({source,target:u,effect:e});if(e.type==="HEAL")ctx.pushLog(`${card.name} → ${u.character.name}｜回復 ${r.amount||0} HP｜HP ${u.hp}。`,"BATTLE");else if(e.type==="MAGIC_DAMAGE"){ctx.pushLog(`${card.name} → ${u.character.name}｜${r.amount||0} 神聖傷害｜HP ${u.hp}。`,"BATTLE");if(!u.alive)ctx.handleDefeated(u,null,card);}}});
    }else if(effect.type==="AREA_BUFF"){
      const source={id:"CARD_SOURCE",team:TEAM.PLAYER};affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive||!EffectEngine.targetMatches(source,u,effect.targetFilter||{}))return;EffectEngine.apply({source,target:u,effect:{type:"BUFF",duration:effect.duration,...(effect.buff||{})}});ctx.pushLog(`${card.name} → ${u.character.name}｜獲得陣地強化。`,"BATTLE");});
    }else if(effect.type==="DISPEL"){
      const u=ctx.unitAt(center.x,center.y);if(u?.alive&&u.team===TEAM.PLAYER){const r=EffectEngine.apply({source:{id:"CARD_SOURCE",team:TEAM.PLAYER},target:u,effect:{type:"DISPEL",classification:effect.classification||"NEGATIVE"}});ctx.pushLog(`${card.name} → ${u.character.name}｜移除 ${r.removed||0} 個負面效果。`,"BATTLE");}
    }else if(effect.type==="HYDROLOGY_FLOOD"){
      if(!window.HydrologyEngine?.floodArea)ctx.pushLog(`${card.name} 失敗：HydrologyEngine.floodArea 尚未載入。`,"SYSTEM");else{const events=HydrologyEngine.floodArea(s.map,affected,{surfaceRise:Number(effect.surfaceRise||1),source:card.id}),resolved=events.find(event=>event.type==="FLOOD_AREA_RESOLVED"),wetCount=resolved?.tiles?.filter(tile=>Number(tile.waterDepth||0)>0).length||0;ctx.pushLog(`${card.name}｜注入 Water Volume ${Number(resolved?.injectedVolume||0).toFixed(2)}｜目標水面 H${resolved?.targetSurface??"?"}｜${wetCount} 格形成／加深水域。`,"SYSTEM");events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:`${card.name} 造成水位重新分配`});}
    }
    finishResolvedCard();return true;
  }
  function deployAt(tile){
    const s=state(),card=ctx.getPendingCard();if(resolvingPresentation||!card||s.phase!==PHASE.CARD)return false;
    if(!DeploymentEngine.canDeploy({stage:s.stage,map:s.map,units:s.units,owner:"PLAYER",x:tile.x,y:tile.y}))return false;
    const unit=UnitRuntimeEngine.createFromCard({id:ctx.nextUnitId(),team:TEAM.PLAYER,card,x:tile.x,y:tile.y,map:s.map});if(!unit)return false;
    unit.cardId=card.id;unit.deployedRound=s.round;unit.moved=true;unit.acted=true;unit.waited=true;
    if(!CardPhaseEngine.commit(s.cardState,card))return false;
    const itemIds=globalThis.ItemInventoryEngine?.claimBattleLoadout?.(card.id)||[];
    globalThis.ItemRuntimeEngine?.initializeUnitInventory?.(unit,itemIds,{owned:true,source:"PREPARATION"});
    s.units.push(unit);UnitRuntimeEngine.reconcileCompanions(s.units);
    ctx.pushLog(`${card.name} 部署至 (${tile.x},${tile.y})｜本回合待命｜消耗 ${card.cost} 水晶${itemIds.length?`｜攜帶道具 ${itemIds.length} 件`:""}。`,"SYSTEM");
    ctx.applyEnvironmentHazardToUnit(unit,{reason:"部署進入環境",waterTrigger:"ENTER"});globalThis.EncounterRewardEngine?.resolveDominion?.(unit,s.units,{playerCardState:()=>s.cardState,pushLog:ctx.pushLog});ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;
  }
  function cancel(){if(resolvingPresentation||!ctx.getPendingCard())return false;ctx.setPendingCard(null);if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;}
  return{begin,end,select,resolveAt,deployAt,cancel,canResolve,hasPlayableCard,maybeAutoEnd};
}
window.CardPhaseController={create};
})();
