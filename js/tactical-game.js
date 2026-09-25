(()=>{
  const ICON={PLAIN:"",MUD:"≋",FOREST:"🌲",HIGH_GROUND:"▲",WATER:"≈",WALL:"■"};
  const TEAM={PLAYER:"P",ENEMY:"E",NEUTRAL:"N"};
  const PHASE={CARD:"CARD_PHASE",PLAYER:"PLAYER_TURN",ENEMY:"ENEMY_TURN",ENDED:"MATCH_ENDED"};

  let map,units,selected,mode,selectedSkill,selectedSkillVariant,logs,round,phase,matchResult,stage,stageState,environmentState,inspectedTile,cores=[];
  let logState=BattleLog.create(),cardState=null,enemyCardState=null,pendingCard=null,unitSerial=0;
  let enemyView={active:false,kind:null,message:"",cardId:null,unitId:null};
  let pendingEngagement=null;
  let supportSelection=new Map();
  let pendingCopySkill=null;
  let battleContext=null,enemyController=null,cardPhaseController=null,presentationController=null,objectiveController=null,environmentController=null,coreCaptureController=null,deathLifecycle=null,encounterRewards=null;
  let renderRevision=0;

  // Engagement Step 4: enemy SINGLE attacks pause here until the player chooses a reaction.
  let pendingEnemyAttack=null;
  let pendingReactionType=null;
  let selectedGuardian=null;
  let selectedGuardInterception=null;
  let commandPanelCollapsed=false;

  function pushLog(text,type="SYSTEM"){
    logs.push(String(text));
    if(logs.length>240)logs.splice(0,logs.length-240);
    BattleLog.add(logState,type,String(text));
    window.dispatchEvent(new CustomEvent("cardtactics:log"));
  }

  function logPostEffect(entry){
    const {source,target,effect,result}=entry;if(!result)return;
    if(!result.applied){pushLog(`${target.character.name}｜${effect.type} 未生效${result.reason?`（${result.reason}）`:""}。`,"DETAIL");return;}
    const moved=result.steps?.length||0,visitCollisions=(r,mover=target)=>{for(const collision of r?.collisions||[]){environmentController.resolveCollisionRuntime(collision,{mover,source});if(collision.chain&&collision.surface?.unit)visitCollisions(collision.chain,collision.surface.unit);}};
    visitCollisions(result);pushLog(`${source.character.name} → ${target.character.name}：${effect.type==="PULL"?"拉近":"擊退"} ${moved} 格。`,"BATTLE");
    if(result.falls?.length){const drops=result.falls.map(f=>`Z${f.from}→H${f.to}`).join("、");pushLog(`${target.character.name} 墜落 ${drops}｜墜落傷害 ${result.fallDamage}｜HP ${target.hp}。`,"BATTLE");}
    else pushLog(`${target.character.name} 強制位移完成｜無墜落傷害。`,"DETAIL");
    if(result.applied&&target.alive)enterTile(target);
  }

  function handleDefeated(unit,source,skillOrEffect){return deathLifecycle.finalize(unit,source,skillOrEffect);}



  function resolveCollisionRuntime(...args){return environmentController.resolveCollisionRuntime(...args);}

  function applyForcedMovement(...args){return environmentController.applyForcedMovement(...args);}

  function traverseUnitPath(...args){return environmentController.traverseUnitPath(...args);}

  function damageUnitFlat(unit,damage,sourceName){
    if(!unit?.alive)return;
    unit.hp=Math.max(0,unit.hp-Math.max(0,Number(damage||0)));
    pushLog(`${sourceName} → ${unit.character.name}｜${damage} 傷害｜HP ${unit.hp}。`,"BATTLE");
    if(unit.hp<=0&&unit.alive){unit.alive=false;handleDefeated(unit,null,{type:"CARD_SPELL",name:sourceName});}
  }

  function createMap(){
    return MapDatabase.createMap(stage.mapId);
  }

  function createUnit(id,team,characterId,x,y){
    return UnitRuntimeEngine.create({id,team,characterId,x,y,map});
  }

  function resetBattle(){
    enemyController?.reset?.();
    actionController?.reset?.();
    const requestedStageId=window.CardTacticsBattleSetup?.stageId||"prototype_battle";
    const setup=BattleSetupEngine.create({stageId:requestedStageId,battleSetup:window.CardTacticsBattleSetup,TEAM});
    ({stage,map,stageState,cores,environmentState,units,cardState,enemyCardState,unitSerial}=setup);
    logState=BattleLog.create();
    deathLifecycle?.reset?.();

    selected=null;
    inspectedTile=null;
    selectedSkill=null;
    selectedSkillVariant=null;
    pendingEngagement=null;
    supportSelection=new Map();
    pendingEnemyAttack=null;
    pendingReactionType=null;
    selectedGuardian=null;
    selectedGuardInterception=null;
    mode="idle";
    logs=[];
    round=1;
    phase=PHASE.CARD;
    matchResult=null;
    stageEvent({type:"ROUND_START",round,team:"PLAYER"});
    cardPhaseController.begin({initial:true});
  }

  function unitAt(x,y){
    return units.find(u=>u.alive&&u.x===x&&u.y===y);
  }

  function spawnFromScript(action){
    const requested=String(action.team||"ENEMY").toUpperCase();
    const team=requested==="PLAYER"?TEAM.PLAYER:requested==="NEUTRAL"?TEAM.NEUTRAL:TEAM.ENEMY;
    if(unitAt(action.x,action.y)) return null;
    const character=CHARACTERS[action.characterId];
    if(!character) return null;
    const prefix=team===TEAM.PLAYER?"p":team===TEAM.NEUTRAL?"n":"e";
    let n=0,id;
    do{id=`${prefix}s${n++}`;}while(units.some(u=>u.id===id));
    const unit=createUnit(id,team,action.characterId,action.x,action.y);
    units.push(unit);
    pushLog(`${character.name} 出現在 (${action.x},${action.y})。`);
    return unit;
  }

  function captureOwnerForTeam(team){return coreCaptureController.ownerForTeam(team);}
  function coreForOwner(owner){return coreCaptureController.coreForOwner(owner);}
  function enemyOwner(owner){return coreCaptureController.enemyOwner(owner);}
  function coreAt(x,y){return coreCaptureController.coreAt(x,y);}
  function capturePointForUnit(unit){return coreCaptureController.capturePointForUnit(unit);}
  function canUnitCapture(unit){return coreCaptureController.canUnitCapture(unit);}
  function damageCore(owner,damage,source){return coreCaptureController.damageCore(owner,damage,source);}
  function executeCapture(unit){return coreCaptureController.executeCapture(unit);}
  function coreCombatTarget(core,attackerTeam){return coreCaptureController.coreCombatTarget(core,attackerTeam);}
  function combatTargetEntities(unit){return coreCaptureController.combatTargetEntities(unit);}
  function applyEnvironmentHazardToUnit(...args){return environmentController.applyEnvironmentHazardToUnit(...args);}

  function applyEnvironmentHazards(...args){return environmentController.applyEnvironmentHazards(...args);}

  function resolveEnvironmentEvents(...args){return environmentController.resolveEnvironmentEvents(...args);}

  function enterTile(...args){return environmentController.enterTile(...args);}

  function stageEvent(event){
    if(!stageState)return;
    StageEngine.run(stageState,event,{
      units,
      log:text=>pushLog(text),
      spawn:spawnFromScript,
      onObjectiveChanged:(active,action)=>{
        const target=String(action.target||"").toUpperCase();
        const label=action.objectives?"勝敗條件":target==="VICTORY"?"勝利條件":target==="DEFEAT"?"失敗條件":"勝敗條件";
        pushLog(`${label}已更新。`,"SYSTEM");
      }
    });
  }

  function shortName(name){
    return name.replace(/（.*?）/g,"").slice(0,4);
  }

  function living(team){return UnitRuntimeEngine.living(units,team);}
  function resetActions(team){return UnitRuntimeEngine.resetActions(units,team);}
  function allFinished(team){return UnitRuntimeEngine.allFinished(units,team);}
  function resourceFor(unit,skill){return UnitRuntimeEngine.resourceFor(unit,skill);}
  function canUseSkill(unit,skill){return UnitRuntimeEngine.canUseSkill(unit,skill);}
  function consumeSkill(unit,skill){return UnitRuntimeEngine.consumeSkill(unit,skill);}
  function resourceLabel(unit,skill){return UnitRuntimeEngine.resourceLabel(unit,skill);}
  function targetType(skill){return UnitRuntimeEngine.targetType(skill);}

  function clearEngagement(){
    pendingEngagement=null;
    supportSelection=new Map();
  }

  function clearEnemyReaction(){
    pendingEnemyAttack=null;
    pendingReactionType=null;
    selectedGuardian=null;
    selectedGuardInterception=null;
  }

  function clearSelection(){
    commandPanelCollapsed=false;
    selected=null;
    selectedSkill=null;
    selectedSkillVariant=null;
    clearEngagement();
    mode="idle";
  }




  function resolveWeatherEvents(...args){return environmentController.resolveWeatherEvents(...args);}

  function beginPlayerTurn(){
    round++;
    phase=PHASE.PLAYER;
    resetActions(TEAM.PLAYER);
    clearSelection();
    clearEnemyReaction();
    pushLog(`Round ${round}｜我方回合開始。`,"SYSTEM");
    if(window.EffectEngine)units.filter(u=>u.alive).forEach(u=>EffectEngine.tick(u));
    stageEvent({type:"ROUND_START",round,team:"PLAYER"});
    if(environmentState){
      applyEnvironmentHazards({reason:"回合開始仍處於燃燒區"});
      if(objectiveController.checkMatchEnd()){render();return;}
      EnvironmentEngine.tick(environmentState);
      resolveWeatherEvents();
      if(objectiveController.checkMatchEnd()){render();return;}
    }
    cardPhaseController.begin();
  }

  function createBattleContext(){
    return {
      TEAM,PHASE,
      state:()=>({map,units,stage,round,phase,matchResult,enemyCardState,environmentState}),
      map:()=>map,
      living,resetActions,canUseSkill,targetType,combatTargets:combatTargetEntities,coreForOwner,
      canUnitCapture,executeCapture,enterTile,checkMatchEnd:()=>objectiveController.checkMatchEnd(),beginPlayerTurn,pushLog,render,
      clearSelection,clearEnemyReaction,
      skillList:unit=>SkillDatabase.list(window.EffectEngine?EffectEngine.skillIds(unit):unit.character.skills),
      setPhase:value=>{phase=value;},
      setEnemyView:value=>{enemyView=value;},
      emitState:()=>window.dispatchEvent(new CustomEvent("cardtactics:state")),
      pendingEnemyAttack:()=>pendingEnemyAttack,
      setPendingEnemyAttack:attack=>{pendingEnemyAttack=attack;pendingReactionType=null;},
      resolveDirectTargetAttack:(...args)=>actionController.resolveDirectTargetAttack(...args),
      actionState:()=>({map,units,stage,selected,mode,selectedSkill,selectedSkillVariant,environmentState}),
      setMode:value=>{mode=value;},
      setSelectedSkill:value=>{selectedSkill=value;},
      setSelectedSkillVariant:value=>{selectedSkillVariant=value;},
      setCommandPanelCollapsed:value=>{commandPanelCollapsed=value;},
      getPendingEngagement:()=>pendingEngagement,
      setPendingEngagement:value=>{pendingEngagement=value;},
      getSupportSelection:()=>supportSelection,
      setSupportSelection:value=>{supportSelection=value;},
      getPendingCopySkill:()=>pendingCopySkill,
      setPendingCopySkill:value=>{pendingCopySkill=value;},
      unitAt,traverseUnitPath,consumeSkill,effectiveSkill,damageCore,handleDefeated,damageUnitFlat,
      canUseSkill,targetType,logBattleAction,logPostEffect,
      logEnvironmentEvent,applyEnvironmentHazardToUnit,resolveEnvironmentEvents:(...args)=>environmentController.resolveEnvironmentEvents(...args),enterTile,clearEngagement,allFinished,
      lineTiles,aoeTiles,canTraverseMoveLine,
      createEnemyCardUnit:(card,tile)=>{
        const unit=createUnit(`ec${unitSerial++}`,TEAM.ENEMY,card.characterId,tile.x,tile.y);
        unit.cardId=card.id;unit.deployedRound=round;unit.moved=true;unit.acted=true;unit.waited=true;
        return unit;
      }
    };
  }

  function runEnemyPhase(){
    enemyController?.runPhase();
  }

  function endPlayerTurn(){
    if(phase!==PHASE.PLAYER||matchResult) return;
    pushLog(`Round ${round}｜我方回合結束。`);
    const endTurnDraws=CardPhaseEngine.resolveTurnEndEffects(cardState,{units,team:TEAM.PLAYER});
    endTurnDraws.forEach(result=>{
      const sourceUnit=units.find(unit=>unit.id===result.unitId);
      const sourceLabel=sourceUnit?.character?.name?`${sourceUnit.character.name}【${result.sourceName}】`:`【${result.sourceName}】`;
      if(result.drawn.length){
        const drawnNames=result.drawn.map(cardId=>CardDatabase.get(cardId)?.name||cardId);
        pushLog(`${sourceLabel}發動｜額外抽牌：${drawnNames.join("、")}｜目前手牌 ${cardState.zones.hand.length} 張。`,"SYSTEM");
      }else{
        pushLog(`${sourceLabel}發動｜牌庫已無可抽取卡牌。`,"SYSTEM");
      }
    });
    runEnemyPhase();
  }

  function finishUnit(unit,reason,{waited=false}={}){
    unit.moved=true;
    unit.acted=true;
    unit.waited=waited;
    selectedSkill=null;
    clearEngagement();
    mode="inspect";
    pushLog(`${unit.character.name} ${reason}`);
    if(allFinished(TEAM.PLAYER)){
      pushLog("我方所有存活角色皆已完成行動，可結束回合。");
    }
  }

  function logBattleAction(entry){
    const {actor,target,skill,result,resolved,spd}=entry;
    const resource=resourceFor(actor,skill);
    const resourceText=resource.type==="USES"?`｜剩餘 ${resource.remaining}/${resource.max}`:"";
    const roleText=entry.role==="SUPPORT"?"支援｜":entry.role==="COUNTER"?"反擊｜":"";
    const hpAfter=Math.max(0,Number(entry.hpAfter||0));
    const hpBefore=hpAfter+Math.max(0,Number(result.damage||0));
    const hitLabel=result.hit?(result.graze?"GRAZE":"HIT"):"MISS";
    const critLabel=result.crit?"｜CRIT":"";
    pushLog(
      `${roleText}${actor.character.name}｜${skill.name} → ${target.character.name}｜${hitLabel}${critLabel}`+
      `｜${result.damage||0} 傷害｜HP ${hpBefore} → ${hpAfter}`,
      "BATTLE"
    );

    const normalRoll=Number.isFinite(result.hitRoll)?result.hitRoll:null;
    const evadeRoll=Number.isFinite(result.evadeRoll)?result.evadeRoll:null;
    const hitRollText=evadeRoll!==null
      ?`迴避骰 ${evadeRoll.toFixed(1)}｜原命中 ${result.originalHitChance}%｜全中門檻 ${result.activeHitChance}%`
      :normalRoll!==null
        ?`命中骰 ${normalRoll.toFixed(1)} / ${result.hc}% → ${result.hit?"HIT":"MISS"}`
        :`命中判定 ${result.guaranteedHit?"必中":result.hit?"強制命中":"強制未命中"}`;
    const critRollText=Number.isFinite(result.critRoll)
      ?`｜暴擊骰 ${result.critRoll.toFixed(1)} / ${result.cc}% → ${result.crit?"CRIT":"NO CRIT"}`
      :(result.hit?`｜暴擊率 ${result.cc}%${result.crit?" → CRIT":""}`:"");
    const terrainText=
      `${resolved.terrain.eva?`｜地形EVA +${resolved.terrain.eva}`:""}`+
      `${resolved.terrain.acc?`｜高地ACC +${resolved.terrain.acc}`:""}`;

    pushLog(
      `[${skill.name}] ${actor.character.name} → ${target.character.name}｜${hitRollText}${critRollText}`+
      `｜ACC修正 ${result.accuracy>=0?"+":""}${result.accuracy}｜EVA修正 ${result.evasion>=0?"+":""}${result.evasion}`+
      `${terrainText}｜SPD ${spd}${resourceText}`,
      "DETAIL"
    );

    if(resolved.defense?.method){
      const d=resolved.defense;
      pushLog(
        `防禦判定｜${d.method.name}`+
        `${Number.isFinite(d.roll)?`｜骰 ${d.roll.toFixed(1)} / ${d.chance}%`:""}`+
        `${d.bypassed?"｜被突破":d.triggered?`｜${d.success===false?"失敗":"成功"}`:"｜未觸發"}`,
        "DETAIL"
      );
    }
  }

  function executeEnemyAttack(reaction=null,interception=null){
    if(!pendingEnemyAttack) return;
    const {attacker,defender,skill}=pendingEnemyAttack;
    const guardian=interception?.type==="GUARD_ALLY"?interception.guardian:null;

    if(guardian){
      pushLog(`${guardian.character.name} 援護 ${defender.character.name}，承接 ${attacker.character.name} 的攻擊。`,"BATTLE");
    }

    BattleResolution.resolve(
      {map,units,initiator:attacker,target:defender,skill,actions:[],reaction,interception},
      {
        canUseSkill,
        consumeSkill,
        onDefeated:handleDefeated,
        onAction:logBattleAction,
        onPostEffect:logPostEffect
      }
    );

    attacker.moved=true;
    attacker.acted=true;
    attacker.waited=true;

    clearEnemyReaction();
    mode="idle";

    if(objectiveController.checkMatchEnd()){
      render();
      return;
    }

    render();
    enemyController?.continuePhase();
  }

  function guardCandidates(){
    if(!pendingEnemyAttack) return [];
    const {defender}=pendingEnemyAttack;
    return BattleResolution.guardCandidates({map,units,target:defender});
  }

  function chooseGuardian(guardian){
    selectedGuardian=guardian;
    selectedGuardInterception=null;
    pendingReactionType=null;
    mode="enemy-guard-reaction";
    render();
  }

  function chooseEnemyReaction(type){
    if(!pendingEnemyAttack) return;
    pendingReactionType=type;

    if(type==="EVADE"){
      executeEnemyAttack(BattleResolution.createReaction("EVADE"));
      return;
    }

    mode=type==="COUNTER"?"enemy-counter-select":"enemy-defense-select";
    render();
  }

  function resolvedSkill(skill,variant){
    return variant?{...skill,...variant,id:skill.id,name:variant.name||skill.name,baseSkillId:skill.id,variantId:variant.id,variants:undefined}:skill;
  }
  function skillVariants(skill){return Array.isArray(skill?.variants)?skill.variants:[];}
  function effectiveSkill(attacker,skill){
    let out=skill;
    const passives=SkillDatabase.passiveList(attacker?.character?.passives);
    const tile=TacticalEngine.tile(map,attacker.x,attacker.y);
    const weapon=attacker?.character?.weapons?.[skill?.weapon];
    const ambush=passives.find(p=>p.id==="AMBUSH");
    if(ambush&&tile?.terrain===ambush.terrain&&weapon?.weaponKind===ambush.weaponKind){
      out={...out,power:Number(out.power||0)*Number(ambush.powerMultiplier||1),speed:Number(out.speed||0)+Number(ambush.speedBonus||0),modifiers:{...(out.modifiers||{})}};
      out.ambushActive=true;
    }
    return out;
  }
  function lineTiles(attacker,end){
    const dx=Math.sign(end.x-attacker.x),dy=Math.sign(end.y-attacker.y);
    if(dx&&dy)return [];
    const out=[];
    let x=attacker.x+dx,y=attacker.y+dy;
    while(x!==end.x||y!==end.y){out.push(map.tiles.find(t=>t.x===x&&t.y===y));x+=dx;y+=dy;}
    out.push(map.tiles.find(t=>t.x===end.x&&t.y===end.y));
    return out.filter(Boolean);
  }
  function canTraverseMoveLine(attacker,end){
    const path=lineTiles(attacker,end);
    if(!path.length)return false;
    let previous=TacticalEngine.tile(map,attacker.x,attacker.y);
    for(const tile of path){
      if(!tile||TERRAINS[tile.terrain]?.passable===false)return false;
      if(typeof TacticalEngine.canTraverseElevation==="function"&&!TacticalEngine.canTraverseElevation(previous,tile))return false;
      previous=tile;
    }
    return true;
  }
  function aoeTiles(center,radius){
    const r=Number(radius||0);
    return map.tiles.filter(tile=>Math.abs(tile.x-center.x)+Math.abs(tile.y-center.y)<=r);
  }
  function logEnvironmentEvent(...args){return environmentController.logEnvironmentEvent(...args);}

  function clickBattleTile(x,y){
    const tile=TacticalEngine.tile(map,Number(x),Number(y));
    if(!tile)return false;
    const reachable=
      selected&&phase===PHASE.PLAYER&&!selected.acted&&!selected.moved&&(mode==="command"||mode==="move")
        ?TacticalEngine.reachable(map,units,selected)
        :new Map();
    const targets=
      selected&&phase===PHASE.PLAYER&&!selected.acted&&mode==="attack"&&selectedSkill&&targetType(selectedSkill)==="SINGLE"
        ?targetableEntities(selected,selectedSkill)
        :[];
    handleTileClick(tile,unitAt(tile.x,tile.y),coreAt(tile.x,tile.y),reachable,targets);
    return true;
  }

  function render(){
    renderRevision++;
    renderTurnStatus();
    renderPanel();
    window.dispatchEvent(new CustomEvent("cardtactics:battle-render",{detail:{revision:renderRevision}}));
  }



  function handleTileClick(tile,unit,core,reachable,targets){
    inspectedTile=tile;
    window.dispatchEvent(new CustomEvent("cardtactics:inspection"));
    if(matchResult){render();return;}
    if(phase===PHASE.CARD){
      if(pendingCard&&CardDatabase.isSpell(pendingCard)){cardPhaseController.resolveAt(pendingCard,tile);return;}
      if(pendingCard&&CardDatabase.isCharacter(pendingCard)&&!unit)cardPhaseController.deployAt(tile);
      return;
    }
    if(phase!==PHASE.PLAYER) return;
    if(mode==="support-select") return;
    if(selected&&!selected.acted&&mode==="map-target"&&selectedSkill){
      if(mapTargetTiles(selected,selectedSkill).includes(tile))executeMapSkill(selected,tile,selectedSkill);
      return;
    }

    if(selected&&!selected.acted&&mode==="attack"){
      const target=unit&&targets.includes(unit)?unit:(core?targets.find(candidate=>candidate.kind==="CORE"&&candidate.core===core):null);
      if(target){
        if(!approachTargetForAttack(selected,target,selectedSkill)){pushLog(`${selectedSkill.name} 無可到達的合法攻擊位置。`,"SYSTEM");render();return;}
        if(target.kind==="CORE")resolveDirectTargetAttack(selected,target,selectedSkill);else prepareAttack(selected,target,selectedSkill);
        return;
      }
    }

    if(unit&&unit.team===TEAM.PLAYER){
      if(selected&&selected!==unit)commitPendingMove(selected);
      commandPanelCollapsed=false;
      selected=unit;
      selectedSkill=null;
      clearEngagement();
      mode=unit.acted?"inspect":"command";
      render();
      return;
    }

    if(selected&&!selected.acted&&(mode==="command"||mode==="move")&&!selected.moved&&!unit&&reachable.has(tile.x+","+tile.y)){
      commandPanelCollapsed=true;
      const path=TacticalEngine.pathTo(map,units,selected,tile.x,tile.y);
      beginPendingMove(selected);
      const moveResult=traverseUnitPath(selected,path,{kind:"UNIT"});
      selected.moved=true;
      if(!moveResult.completed)commitPendingMove(selected);
      mode="command";
      commandPanelCollapsed=false;
      pushLog(`${selected.character.name} ${moveResult.completed?"移動完成，可在其他行動前取消移動":"移動途中受到環境影響而中斷"}。`);
      render();
      return;
    }

    if(selected&&!selected.acted&&(mode==="command"||mode==="move")&&!unit)commandPanelCollapsed=true;
    render();
  }

  function renderTurnStatus(){
    if(matchResult){
      turnStatus.textContent=matchResult==="VICTORY"
        ?`戰鬥結束｜VICTORY｜Round ${round}`
        :`戰鬥結束｜DEFEAT｜Round ${round}`;
      return;
    }

    const phaseName=phase===PHASE.CARD?"卡牌階段":phase===PHASE.PLAYER?"我方戰棋階段":"敵方回合";
    const ready=living(TEAM.PLAYER).filter(u=>!u.acted).length;
    turnStatus.textContent=`Round ${round}｜${phaseName}｜我方可行動 ${ready}/${living(TEAM.PLAYER).length}`;
  }

  function addActionButton(text,onClick,disabled=false){
    const button=document.createElement("button");
    button.textContent=text;
    button.className="action-button";
    button.disabled=disabled;
    button.onclick=onClick;
    skillBar.appendChild(button);
  }

  function addCommandPanelClose(){
    const button=document.createElement("button");
    button.type="button";
    button.className="battle-command-close";
    button.textContent="×";
    button.setAttribute("aria-label","關閉作戰選單");
    button.onclick=()=>{
      commandPanelCollapsed=true;
      render();
    };
    skillBar.appendChild(button);
  }

  function renderCollapsedCommandButton(){skillBar.classList.add("command-panel-collapsed");}

  function engagementOdds(attacker,defender,skill){
    if(!attacker?.character||!defender?.character||!skill)return null;
    const resolved=effectiveSkill(attacker,skill);
    const hit=Math.max(0,Math.min(100,Math.round(BattleEngine.hitChance(attacker.character,defender.character,resolved))));
    return {hit,evade:100-hit};
  }

  function engagementUnitPresentation(unit,attacker,defender,odds){
    const max=Math.max(1,Number(unit?.character?.combat?.hp||unit?.hp||1));
    const hp=Math.max(0,Number(unit?.hp||0));
    return {
      id:unit.id,name:unit.character.name,shortName:shortName(unit.character.name),
      team:unit.team,hp,maxHp:max,hpPct:Math.max(0,Math.min(100,hp/max*100)),
      oddsLabel:!odds?"":unit===attacker?`命中率 ${odds.hit}%`:unit===defender?`迴避率 ${odds.evade}%`:""
    };
  }

  function engagementPresentation(){
    const attack=pendingEngagement||pendingEnemyAttack;
    if(!attack)return null;
    const {attacker,defender,skill}=attack,odds=engagementOdds(attacker,defender,skill);
    const player=attacker.team===TEAM.PLAYER?attacker:defender.team===TEAM.PLAYER?defender:null;
    const enemy=player===attacker?defender:attacker;
    const model={
      mode,skillName:skill?.name||"交戰",
      player:engagementUnitPresentation(player,attacker,defender,odds),
      enemy:engagementUnitPresentation(enemy,attacker,defender,odds),
      groups:[],actions:[]
    };
    const action=(id,label,disabled=false,payload=null)=>model.actions.push({id,label,disabled,payload});

    if(mode==="support-select"&&pendingEngagement){
      for(const {ally,skills} of pendingEngagement.candidates){
        model.groups.push({
          id:ally.id,title:`${ally.character.name}${ally.acted?"｜已完成主動行動":""}`,
          actions:[
            {id:"SUPPORT_NONE",label:"不支援",payload:{allyId:ally.id}},
            ...skills.map(s=>({id:"SUPPORT_SKILL",label:`${supportSelection.get(ally.id)===s?"✓ ":""}${s.name}｜${resourceLabel(ally,s)}`,payload:{allyId:ally.id,skillId:s.id}}))
          ]
        });
      }
      action("CONFIRM_ENGAGEMENT","開始交戰");
      action("BACK_SUPPORT","返回");
      return model;
    }

    if(!pendingEnemyAttack)return model;
    const prep=BattleResolution.prepareSingleTargetReaction({defender,attacker,canUseSkill});
    prep.counterSkills=prep.counterSkills.filter(s=>TacticalEngine.canTarget(map,defender,attacker,s,environmentState));

    if(mode==="enemy-counter-select"){
      prep.counterSkills.forEach(s=>action("COUNTER_SKILL",`${s.name}｜射程 ${s.range.min}-${s.range.max}｜${resourceLabel(defender,s)}`,false,{skillId:s.id}));
      action("BACK_REACTION","返回");
    }else if(mode==="enemy-defense-select"){
      prep.defenseMethods.forEach(m=>action("DEFENSE_METHOD",`${m.name}｜${m.sourceName||m.method}`,false,{methodId:m.id}));
      action("BACK_REACTION","返回");
    }else if(mode==="enemy-guard-select"){
      guardCandidates().forEach(({guardian,profiles})=>action("GUARDIAN",`${guardian.character.name}｜${profiles.map(p=>p.name).join("／")}`,false,{guardianId:guardian.id}));
      action("BACK_GUARD","返回");
    }else if(mode==="enemy-guard-reaction"){
      const guardian=selectedGuardian;
      if(!guardian?.alive)return {...model,invalidGuardian:true};
      const guardianMethods=BattleResolution.guardProfiles(guardian);
      const counterSkills=BattleResolution.counterSkills({defender,attacker,canUseSkill}).filter(s=>TacticalEngine.canTarget(map,defender,attacker,s,environmentState));
      if(!selectedGuardInterception){
        guardianMethods.forEach(m=>action("GUARD_METHOD",`${m.name}｜${m.sourceName||m.method}`,false,{methodId:m.id}));
        action("BACK_GUARD_METHOD","返回");
      }else{
        action("GUARD_ACCEPT","援護承受｜原目標不反擊");
        counterSkills.forEach(s=>action("GUARD_COUNTER",`原目標反擊｜${s.name}｜${resourceLabel(defender,s)}`,false,{skillId:s.id}));
        action("BACK_GUARD_INTERCEPTION","返回防禦方式");
      }
    }else{
      const guards=guardCandidates();
      action("REACTION_COUNTER","反擊",prep.counterSkills.length===0);
      action("REACTION_DEFENSE","防禦",prep.defenseMethods.length===0);
      action("REACTION_EVADE","迴避");
      action("REACTION_GUARD","援護防禦",guards.length===0);
    }
    return model;
  }

  function handleEngagementUIAction(id,payload={}){
    if(id==="SUPPORT_NONE"){
      supportSelection.delete(payload.allyId);render();return;
    }
    if(id==="SUPPORT_SKILL"){
      const entry=pendingEngagement?.candidates?.find(c=>c.ally.id===payload.allyId);
      const skill=entry?.skills?.find(s=>s.id===payload.skillId);
      if(skill)supportSelection.set(payload.allyId,skill);
      render();return;
    }
    if(id==="CONFIRM_ENGAGEMENT"){confirmEngagement();return;}
    if(id==="BACK_SUPPORT"){clearEngagement();mode="attack";render();return;}
    if(id==="REACTION_COUNTER"){chooseEnemyReaction("COUNTER");return;}
    if(id==="REACTION_DEFENSE"){chooseEnemyReaction("DEFENSE");return;}
    if(id==="REACTION_EVADE"){chooseEnemyReaction("EVADE");return;}
    if(id==="REACTION_GUARD"){mode="enemy-guard-select";render();return;}
    if(id==="BACK_REACTION"){pendingReactionType=null;mode="enemy-reaction";render();return;}
    if(id==="COUNTER_SKILL"){
      const skill=BattleResolution.counterSkills({defender:pendingEnemyAttack?.defender,attacker:pendingEnemyAttack?.attacker,canUseSkill}).find(s=>s.id===payload.skillId);
      if(skill)executeEnemyAttack(BattleResolution.createReaction("COUNTER",{skill}));
      return;
    }
    if(id==="DEFENSE_METHOD"){executeEnemyAttack(BattleResolution.createReaction("DEFENSE",{methodId:payload.methodId}));return;}
    if(id==="GUARDIAN"){
      const guardian=units.find(u=>u.id===payload.guardianId&&u.alive);
      if(guardian)chooseGuardian(guardian);
      return;
    }
    if(id==="BACK_GUARD"){selectedGuardian=null;selectedGuardInterception=null;mode="enemy-reaction";render();return;}
    if(id==="GUARD_METHOD"){
      if(selectedGuardian){selectedGuardInterception=BattleResolution.createGuardInterception(selectedGuardian,payload.methodId);render();}
      return;
    }
    if(id==="BACK_GUARD_METHOD"){selectedGuardian=null;selectedGuardInterception=null;mode="enemy-guard-select";render();return;}
    if(id==="GUARD_ACCEPT"){executeEnemyAttack(null,selectedGuardInterception);return;}
    if(id==="GUARD_COUNTER"){
      const {attacker,defender}=pendingEnemyAttack||{};
      const skill=BattleResolution.counterSkills({defender,attacker,canUseSkill}).find(s=>s.id===payload.skillId);
      if(skill)executeEnemyAttack(BattleResolution.createReaction("COUNTER",{skill}),selectedGuardInterception);
      return;
    }
    if(id==="BACK_GUARD_INTERCEPTION"){selectedGuardInterception=null;render();}
  }

  function renderPanel(){
    skillBar.innerHTML="";
    skillBar.classList.remove("enemy-reaction-panel","command-panel-collapsed","engagement-overlay");

    if(matchResult){
      return;
    }

    if(phase===PHASE.CARD){
      return;
    }

    if(phase===PHASE.ENEMY){
      if(pendingEnemyAttack&&targetType(pendingEnemyAttack.skill)==="SINGLE"){
        commandPanelCollapsed=false;
        skillBar.classList.add("enemy-reaction-panel");
        const model=engagementPresentation();
        if(model?.invalidGuardian){
          selectedGuardian=null;selectedGuardInterception=null;mode="enemy-reaction";render();return;
        }
        window.TacticalUIController?.renderEngagement?.();
      }else{
      }
      return;
    }

    if(phase!==PHASE.PLAYER){
      return;
    }

    if(!selected){
      return;
    }

    const tile=TacticalEngine.tile(map,selected.x,selected.y);
    const actionState=selected.acted
      ?(selected.waited?"已待機":"已完成主動行動 / 可支援")
      :(selected.moved?"已移動 / 可攻擊":"可移動 / 可行動");

    if(mode==="support-select"&&pendingEngagement){
      window.TacticalUIController?.renderEngagement?.();
      return;
    }

    if(selected.acted) return;

    if(mode==="command"){
      if(commandPanelCollapsed){
        renderCollapsedCommandButton();
        return;
      }
      addCommandPanelClose();
      if(!selected.moved){
        addActionButton("移動",()=>{
          mode="move";
          commandPanelCollapsed=false;
          render();
        });
      }else if(actionController.pendingMove()?.unitId===selected.id){
        addActionButton("取消移動",cancelPendingMove);
      }

      if(stage?.ruleset==="CORE_CAPTURE"&&canUnitCapture(selected)){
        const point=capturePointForUnit(selected);
        addActionButton(`佔領｜${point.name}`,()=>executeCapture(selected));
      }
      addActionButton("攻擊",()=>{
        selectedSkill=null;
        mode="attack-menu";
        render();
      });

      addActionButton("道具",()=>{
        pushLog(`${selected.character.name}｜道具系統尚未接入。`);
        render();
      });

      addActionButton("對話",()=>{
        pushLog(`${selected.character.name}｜目前沒有可對話目標。`);
        render();
      });

      addActionButton("魔法／特殊技能",()=>{
        selectedSkill=null;
        mode="special-menu";
        render();
      });

      addActionButton("待機",()=>{
        commitPendingMove(selected);
        finishUnit(selected,"待機，行動結束。",{waited:true});
        render();
      });
      return;
    }


    if(mode==="move"){
      addActionButton("取消移動選擇",()=>{
        mode="command";
        commandPanelCollapsed=false;
        render();
      });
      return;
    }

    const allSkills=SkillDatabase.list(window.EffectEngine?EffectEngine.skillIds(selected):selected.character.skills);
    const isSpecial=skill=>skill.category!=="ATTACK";
    const shownSkills=
      mode==="special-menu"
        ?allSkills.filter(isSpecial)
        :mode==="attack-menu"
          ?allSkills.filter(skill=>!isSpecial(skill))
          :[];

    if(mode==="variant-menu"&&selectedSkill){
      if(commandPanelCollapsed){renderCollapsedCommandButton();return;}
      addCommandPanelClose();
      skillVariants(selectedSkill).forEach(variant=>{
        addActionButton(variant.name||variant.id,()=>{
          selectedSkillVariant=variant;
          selectedSkill=resolvedSkill(selectedSkill,variant);
          mode=targetType(selectedSkill)==="SINGLE"?"attack":"map-target";
          render();
        });
      });
      addActionButton("返回",()=>{const special=selectedSkill?.category!=="ATTACK";selectedSkill=null;selectedSkillVariant=null;mode=special?"special-menu":"attack-menu";render();});
      return;
    }

    if(mode==="copy-skill-select"&&pendingCopySkill){
      addCommandPanelClose();
      pendingCopySkill.options.forEach(skill=>addActionButton(skill.name,()=>{
        EffectEngine.grantSkill(pendingCopySkill.attacker,skill.id,{source:pendingCopySkill.target,duration:pendingCopySkill.duration,replaceGroup:"BLOOD_COPY"});
        pushLog(`${pendingCopySkill.attacker.character.name} 從血液中複製了「${skill.name}」。`,"BATTLE");
        const actor=pendingCopySkill.attacker;pendingCopySkill=null;finishActiveSkill(actor);
      }));
      return;
    }

    if(mode==="attack-menu"||mode==="special-menu"){
      if(commandPanelCollapsed){renderCollapsedCommandButton();return;}
      addCommandPanelClose();
      const menuName=mode==="special-menu"?"魔法／特殊技能":"攻擊";
      if(!shownSkills.length){
      }

      shownSkills.forEach(skill=>{
        const button=document.createElement("button");
        const range=TacticalEngine.range(skill);
        const usable=canUseSkill(selected,skill);
        button.textContent=`${skill.name}｜射程 ${range.min}-${range.max}｜${resourceLabel(selected,skill)}`;
        button.disabled=!usable;
        button.onclick=()=>{
          if(!usable)return;
          selectedSkill=skill;
          selectedSkillVariant=null;
          mode=skillVariants(skill).length?"variant-menu":(targetType(skill)==="SINGLE"?"attack":"map-target");
          render();
        };
        skillBar.appendChild(button);
      });

      addActionButton("返回",()=>{
        selectedSkill=null;
        mode="command";
        render();
      });
      return;
    }

    if(mode==="map-target"&&selectedSkill){
      const range=TacticalEngine.range(selectedSkill);
      return;
    }

    if(mode==="attack"&&selectedSkill){
      const range=TacticalEngine.range(selectedSkill);

    }
  }

  resetMap.onclick=resetBattle;

  battleContext=createBattleContext();
  if(!window.TacticalActionController?.create)throw new Error("TacticalActionController is not loaded.");
  const actionController=window.TacticalActionController.create(battleContext);
  const {
    attackPlanForTarget,targetableEntities,approachTargetForAttack,resolveDirectTargetAttack,
    mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,
    backFromTargeting,finishActiveSkill,executeEffectSkill,approachForSkill,prepareAttack,
    confirmEngagement,executeEngagement
  }=actionController;
  if(!window.BattlePresentationController?.create)throw new Error("BattlePresentationController is not loaded.");
  presentationController=window.BattlePresentationController.create({
    TEAM,PHASE,
    state:()=>({map,units,stage,round,phase,mode,selected,selectedSkill,environmentState,inspectedTile,cores,pendingCard,enemyCardState,renderRevision}),
    targetType,targetableEntities,mapTargetTiles,unitAt,coreAt,effectiveSkill
  });
  if(!window.BattleObjectiveController?.create)throw new Error("BattleObjectiveController is not loaded.");
  objectiveController=window.BattleObjectiveController.create({
    state:()=>({stage,stageState,round,units,cores,cardState,enemyCardState,matchResult}),
    setMatchResult:value=>{matchResult=value;phase=PHASE.ENDED;},
    onMatchEnd:value=>{clearSelection();clearEnemyReaction();pushLog(`Round ${round}｜${value}｜關卡目標已${value==="VICTORY"?"達成":"失敗"}。`,"SYSTEM");}
  });
  if(!window.EncounterRewardEngine?.create)throw new Error("EncounterRewardEngine is not loaded.");
  encounterRewards=window.EncounterRewardEngine.create({playerCardState:()=>cardState,pushLog});
  if(!window.DeathLifecycleEngine?.create)throw new Error("DeathLifecycleEngine is not loaded.");
  deathLifecycle=window.DeathLifecycleEngine.create({
    stageEvent,cardStateFor:unit=>unit.team===TEAM.PLAYER?cardState:unit.team===TEAM.ENEMY?enemyCardState:null,pushLog,
    onDefeated:unit=>{if(unit.team===TEAM.ENEMY)encounterRewards.onDefeated(unit);},
    onFinalized:()=>objectiveController?.checkMatchEnd?.()
  });
  if(!window.BattleCoreCaptureController?.create)throw new Error("BattleCoreCaptureController is not loaded.");
  coreCaptureController=window.BattleCoreCaptureController.create({
    TEAM,state:()=>({stage,units,cores}),pushLog,
    checkMatchEnd:()=>objectiveController.checkMatchEnd(),
    commitPendingMove:unit=>commitPendingMove(unit),stageEvent,
    onCaptureComplete:()=>{mode="inspect";window.dispatchEvent(new CustomEvent("cardtactics:state"));render();}
  });
  if(!window.BattleEnvironmentController?.create)throw new Error("BattleEnvironmentController is not loaded.");
  environmentController=window.BattleEnvironmentController.create({
    TEAM,state:()=>({map,units,environmentState}),living,pushLog,handleDefeated,stageEvent,damageUnitFlat
  });
  if(!window.TacticalEnemyController?.create)throw new Error("TacticalEnemyController is not loaded.");
  enemyController=window.TacticalEnemyController.create(battleContext);
  if(!window.CardPhaseController?.create)throw new Error("CardPhaseController is not loaded.");
  cardPhaseController=window.CardPhaseController.create({
    TEAM,PHASE,
    state:()=>({map,units,stage,round,phase,matchResult,cardState,pendingCard,environmentState}),
    setPhase:value=>{phase=value;},
    getPendingCard:()=>pendingCard,
    setPendingCard:value=>{pendingCard=value;},
    clearSelection,pushLog,render,emitState:()=>window.dispatchEvent(new CustomEvent("cardtactics:state")),
    unitAt,createUnit:(id,team,characterId,x,y)=>createUnit(id,team,characterId,x,y),
    nextUnitId:()=>`pc${unitSerial++}`,
    aoeTiles,applyForcedMovement,damageUnitFlat,applyEnvironmentHazardToUnit,resolveEnvironmentEvents,
    logEnvironmentEvent,checkMatchEnd:()=>objectiveController.checkMatchEnd(),handleDefeated
  });

  window.CardTacticsRuntime={
    getCardState:()=>cardState,
    getEnemyCardState:()=>enemyCardState,
    getEnemyPresentation:()=>({...enemyView}),
    getBattleMap:()=>map,
    getBattleSnapshot:()=>presentationController.battleSnapshot(),
    clickBattleTile,
    getStage:()=>stage,
    getCores:()=>cores.map(core=>({...core})),
    getPhase:()=>phase,
    getPendingCard:()=>pendingCard,
    getBattleLog:()=>({active:logState.active,entries:BattleLog.list(logState).map(entry=>({...entry}))}),
    getEngagementPresentation:engagementPresentation,
    handleEngagementUIAction,
    setBattleLogTab:type=>{BattleLog.setActive(logState,type);window.dispatchEvent(new CustomEvent("cardtactics:log"));},
    getActionMenuAnchor:()=>phase===PHASE.PLAYER&&selected&&!commandPanelCollapsed&&mode!=="support-select"
      ?{x:selected.x,y:selected.y}:null,
    getInspectedUnitPresentation:()=>{
      const unit=inspectedTile?unitAt(inspectedTile.x,inspectedTile.y):selected;
      return presentationController.unitPresentation(unit||selected);
    },
    getInspectedTilePresentation:()=>inspectedTile?TileInspectionPresentation.create({map,environmentState,tile:inspectedTile}):null,
    playCard:cardId=>cardPhaseController.select(cardId),
    endCardPhase:()=>cardPhaseController.end(),
    cancelCard:()=>cardPhaseController.cancel(),
    endPlayerTurn,
    refresh:render,
    resetBattle
  };

  resetBattle();
})();