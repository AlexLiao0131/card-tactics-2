(()=>{
"use strict";
function create(ctx){
  const {TEAM,PHASE}=ctx;const state=()=>ctx.state();
  function waterRecheckUnits(units,reason){(units||[]).filter(unit=>unit?.alive).forEach(unit=>ctx.applyEnvironmentHazardToUnit(unit,{reason,waterTrigger:"CHANGE",includeElectric:false,includeBoiling:false,includeFire:false}));}
  const TARGETED_SPELL_EFFECTS=new Set(["AREA_FIRE","AREA_PUSH","AREA_HEAL","AREA_DAMAGE","AREA_RELATION","AREA_BUFF","DISPEL","HYDROLOGY_FLOOD"]);
  function weatherName(weather){return weather==="THUNDERSTORM"?"雷雨":weather==="HEAVY_RAIN"?"豪大雨":weather==="FOG"?"迷霧":weather==="SNOW"?"降雪":weather==="BLIZZARD"?"暴風雪":weather;}
  function hasDeploymentTile(s){
    return DeploymentEngine.area(s.stage,"PLAYER").some(tile=>
      DeploymentEngine.canDeploy({stage:s.stage,map:s.map,units:s.units,owner:"PLAYER",x:tile.x,y:tile.y})
    );
  }
  function canResolve(card){
    const s=state();
    if(s.phase!==PHASE.CARD||!CardPhaseEngine.canPlay(s.cardState,card))return false;
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
    if(s.phase!==PHASE.CARD||ctx.getPendingCard())return false;
    if(s.cardState?.mulliganAvailable&&!s.cardState?.mulliganDone)return false;
    if(hasPlayableCard())return false;
    ctx.pushLog(`Round ${s.round}｜目前已無可使用卡牌，自動結束卡牌階段。`,"SYSTEM");
    return end({automatic:true});
  }
  function begin({initial=false}={}){
    const s=state(),cardState=s.cardState;
    if(cardState.zones.deck.length===0&&cardState.zones.hand.length===0){cardState.crystals=Math.min(cardState.maxCrystals||10,cardState.startingCrystals||4);ctx.setPendingCard(null);CardPhaseEngine.end(cardState);ctx.setPhase(PHASE.PLAYER);ctx.clearSelection();ctx.pushLog(`Round ${s.round}｜牌庫已抽完，跳過卡牌階段，直接進入戰棋階段。`,"SYSTEM");ctx.render();ctx.emitState();return;}
    ctx.setPhase(PHASE.CARD);ctx.clearSelection();const drawn=CardPhaseEngine.begin(cardState,{handSize:Number(s.stage.cardRules?.handSize||5)});ctx.pushLog(`Round ${s.round}｜卡牌階段開始｜💎 ${cardState.crystals}。`,"SYSTEM");
    if(cardState.lastExpiredTurnCards?.length)ctx.pushLog(`TURN 卡到期｜${cardState.lastExpiredTurnCards.length} 張離開本回合卡區。`,"DETAIL");if(drawn.length)ctx.pushLog(`抽牌 ${drawn.length} 張。`,"SYSTEM");ctx.setPendingCard(null);
    if(!maybeAutoEnd()){ctx.render();ctx.emitState();}
  }
  function end({automatic=false}={}){const s=state();if(s.phase!==PHASE.CARD)return false;ctx.setPendingCard(null);CardPhaseEngine.end(s.cardState);ctx.resetActions?.(TEAM.PLAYER);ctx.setPhase(PHASE.PLAYER);ctx.clearSelection();ctx.pushLog(`Round ${s.round}｜${automatic?"自動進入":"進入"}戰棋階段。`,"SYSTEM");ctx.render();ctx.emitState();return true;}
  function select(cardId){
    const s=state();if(s.phase!==PHASE.CARD)return false;const card=CardDatabase.get(cardId);if(!canResolve(card))return false;
    if(CardDatabase.isCharacter(card)){ctx.setPendingCard(card);ctx.pushLog(`選擇 ${card.name}，請在亮起的我方部署區手動選擇出生格。`,"SYSTEM");ctx.render();return true;}
    if(!CardDatabase.isSpell(card))return false;
    if(card.effect?.type==="WEATHER"){
      if(!CardPhaseEngine.commit(s.cardState,card))return false;const weather=card.effect.weather==="RAIN"?"HEAVY_RAIN":card.effect.weather,duration=Math.max(1,Number(card.effect.durationTurns||EnvironmentEngine.WEATHER_TURNS?.[weather]||1)),events=s.environmentState?EnvironmentEngine.setWeather(s.environmentState,weather,s.map,{duration,applyPulse:true}):[];ctx.pushLog(`施放卡牌魔法「${card.name}」｜消耗 ${card.cost} 水晶。`,"SYSTEM");events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:"天候造成水位／地表狀態變化"});ctx.pushLog(`天候變更：${weatherName(weather)}｜持續 ${duration} 回合。`,"SYSTEM");ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;
    }
    if(["AREA_FIRE","AREA_PUSH","AREA_HEAL","AREA_DAMAGE","AREA_RELATION","AREA_BUFF","DISPEL","HYDROLOGY_FLOOD"].includes(card.effect?.type)){ctx.setPendingCard(card);ctx.pushLog(`選擇卡牌魔法「${card.name}」｜請點選戰場上的施放中心。`,"SYSTEM");ctx.render();return true;}
    return false;
  }
  function resolveAt(card,center){
    const s=state();if(!card||s.phase!==PHASE.CARD||ctx.getPendingCard()!==card)return false;const effect=card.effect||{},affected=ctx.aoeTiles(center,Number(effect.radius||0));if(!CardPhaseEngine.commit(s.cardState,card))return false;ctx.pushLog(`施放卡牌魔法「${card.name}」｜中心 (${center.x},${center.y})｜消耗 ${card.cost} 水晶。`,"SYSTEM");
    if(effect.type==="AREA_FIRE"){
      const environmentEvents=[];affected.forEach(tile=>{const events=EnvironmentEngine.apply({map:s.map,state:s.environmentState,x:tile.x,y:tile.y,forces:effect.forces||["FIRE"]})||[];environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);});ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${card.name} 引發環境連鎖`});affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(u)ctx.applyEnvironmentHazardToUnit(u,{reason:"遭野火波及",waterTrigger:"CHECK",includeElectric:false,includeBoiling:false,includeFire:true});});
    }else if(effect.type==="AREA_PUSH"){
      const events=affected.map(tile=>EnvironmentEngine.createTornado(s.environmentState,tile.x,tile.y,{duration:2,pushDistance:Number(effect.distance||2),lift:Number(effect.lift||3),damage:Number(effect.damage||20),fireDamage:Number(effect.fireTornadoDamage||45),resistAxes:effect.resistAxes||{horizontal:false,vertical:true}}));events.forEach(ctx.logEnvironmentEvent);if(events.some(e=>e.type==="FIRE_TORNADO_CREATED"))ctx.pushLog("🔥🌪 火焰與龍捲風結合，形成火龍捲！","SYSTEM");affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u)return;const active=EnvironmentEngine.effectAt(s.environmentState,tile.x,tile.y),wind=active.find(e=>e.type===EnvironmentEngine.EFFECT.FIRE_TORNADO)||active.find(e=>e.type===EnvironmentEngine.EFFECT.TORNADO);if(u.alive)ctx.applyForcedMovement(center,u,Number(wind?.pushDistance||effect.distance||2),{name:wind?.type===EnvironmentEngine.EFFECT.FIRE_TORNADO?"火龍捲":"龍捲風",lift:Number(wind?.lift||effect.lift||0),damage:Number(wind?.damage||effect.damage||0),damageType:wind?.damageType||"PHYSICAL",resistAxes:wind?.resistAxes||effect.resistAxes});});
    }else if(effect.type==="AREA_HEAL"){
      affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive||u.team!==TEAM.PLAYER)return;const before=u.hp;u.hp=Math.min(u.character.combat.hp,u.hp+Number(effect.heal||0));ctx.pushLog(`${card.name} → ${u.character.name}｜回復 ${u.hp-before} HP｜HP ${u.hp}。`,"BATTLE");});
    }else if(effect.type==="AREA_DAMAGE"){
      const environmentEvents=[];affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(u&&Number(effect.damage||0)>0)ctx.damageUnitFlat(u,effect.damage||0,card.name);const events=EnvironmentEngine.apply({map:s.map,state:s.environmentState,x:tile.x,y:tile.y,forces:effect.forces||[]})||[];environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);});ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${card.name} 引發環境連鎖`});
    }else if(effect.type==="AREA_RELATION"){
      const source={id:"CARD_SOURCE",team:TEAM.PLAYER};affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive)return;for(const e of effect.effects||[]){if(e.relation!==EffectEngine.relation(source,u))continue;const r=EffectEngine.apply({source,target:u,effect:e});if(e.type==="HEAL")ctx.pushLog(`${card.name} → ${u.character.name}｜回復 ${r.amount||0} HP｜HP ${u.hp}。`,"BATTLE");else if(e.type==="MAGIC_DAMAGE"){ctx.pushLog(`${card.name} → ${u.character.name}｜${r.amount||0} 神聖傷害｜HP ${u.hp}。`,"BATTLE");if(!u.alive)ctx.handleDefeated(u,null,card);}}});
    }else if(effect.type==="AREA_BUFF"){
      const source={id:"CARD_SOURCE",team:TEAM.PLAYER};affected.forEach(tile=>{const u=ctx.unitAt(tile.x,tile.y);if(!u?.alive||!EffectEngine.targetMatches(source,u,effect.targetFilter||{}))return;EffectEngine.apply({source,target:u,effect:{type:"BUFF",duration:effect.duration,...(effect.buff||{})}});ctx.pushLog(`${card.name} → ${u.character.name}｜獲得陣地強化。`,"BATTLE");});
    }else if(effect.type==="DISPEL"){
      const u=ctx.unitAt(center.x,center.y);if(u?.alive&&u.team===TEAM.PLAYER){const r=EffectEngine.apply({source:{id:"CARD_SOURCE",team:TEAM.PLAYER},target:u,effect:{type:"DISPEL",classification:effect.classification||"NEGATIVE"}});ctx.pushLog(`${card.name} → ${u.character.name}｜移除 ${r.removed||0} 個負面效果。`,"BATTLE");}
    }else if(effect.type==="HYDROLOGY_FLOOD"){
      if(!window.HydrologyEngine?.floodArea)ctx.pushLog(`${card.name} 失敗：HydrologyEngine.floodArea 尚未載入。`,"SYSTEM");else{const events=HydrologyEngine.floodArea(s.map,affected,{surfaceRise:Number(effect.surfaceRise||1),source:card.id}),resolved=events.find(event=>event.type==="FLOOD_AREA_RESOLVED"),wetCount=resolved?.tiles?.filter(tile=>Number(tile.waterDepth||0)>0).length||0;ctx.pushLog(`${card.name}｜注入 Water Volume ${Number(resolved?.injectedVolume||0).toFixed(2)}｜目標水面 H${resolved?.targetSurface??"?"}｜${wetCount} 格形成／加深水域。`,"SYSTEM");events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:`${card.name} 造成水位重新分配`});}
    }
    ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;
  }
  function deployAt(tile){const s=state(),card=ctx.getPendingCard();if(!card||s.phase!==PHASE.CARD)return false;if(!DeploymentEngine.canDeploy({stage:s.stage,map:s.map,units:s.units,owner:"PLAYER",x:tile.x,y:tile.y}))return false;const unit=ctx.createUnit(ctx.nextUnitId(),TEAM.PLAYER,card.characterId,tile.x,tile.y);unit.cardId=card.id;unit.deployedRound=s.round;if(!CardPhaseEngine.commit(s.cardState,card))return false;s.units.push(unit);ctx.pushLog(`${card.name} 部署至 (${tile.x},${tile.y})｜消耗 ${card.cost} 水晶。`,"SYSTEM");ctx.applyEnvironmentHazardToUnit(unit,{reason:"部署進入環境",waterTrigger:"ENTER"});ctx.setPendingCard(null);ctx.checkMatchEnd();if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;}
  function cancel(){if(!ctx.getPendingCard())return false;ctx.setPendingCard(null);if(!maybeAutoEnd()){ctx.render();ctx.emitState();}return true;}
  return{begin,end,select,resolveAt,deployAt,cancel,canResolve,hasPlayableCard,maybeAutoEnd};
}
window.CardPhaseController={create};
})();
