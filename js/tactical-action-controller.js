(()=>{
  "use strict";

  function create(ctx){
    let pendingMove=null,pendingTransport=null;

    function state(){return ctx.actionState();}

    function weightRank(value){
      const key=String(value||"LIGHT").toUpperCase();
      return Number(globalThis.DisplacementEngine?.WEIGHT?.[key]??0);
    }
    function canLiftTarget(carrier,target){
      if(!carrier?.alive||!target?.alive||!target?.character)return false;
      const capacity=String(carrier.character?.transport?.capacityClass||"LIGHT").toUpperCase();
      return weightRank(globalThis.DisplacementEngine?.weightClass?.(target)||"LIGHT")<weightRank(capacity);
    }
    function runtimeCardStates(attacker){
      const runtime=globalThis.CardTacticsRuntime;if(!runtime)return{own:null,other:null};
      if(attacker?.team===ctx.TEAM?.PLAYER)return{own:runtime.getCardState?.(),other:runtime.getEnemyCardState?.()};
      if(attacker?.team===ctx.TEAM?.ENEMY)return{own:runtime.getEnemyCardState?.(),other:runtime.getCardState?.()};
      return{own:null,other:null};
    }
    function finishFreeUtility(attacker){
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setCommandPanelCollapsed?.(false);ctx.setMode("command");ctx.render();ctx.emitState?.();return true;
    }
    function restorePendingTransport({silent=false}={}){
      if(!pendingTransport)return false;
      const {carrier,passenger,origin,carrierVertical}=pendingTransport;
      if(passenger){passenger.x=origin.x;passenger.y=origin.y;passenger.z=origin.z;passenger.verticalState=origin.verticalState;delete passenger.carriedByUnitId;delete passenger.transportHidden;}
      if(carrier){delete carrier.carryingUnitId;const tile=TacticalEngine.tile(state().map,carrier.x,carrier.y);if(tile&&carrierVertical?.mode&&globalThis.VerticalMobilityEngine?.setMode)VerticalMobilityEngine.setMode(carrier,tile,carrierVertical.mode,{altitude:carrierVertical.altitude,depth:carrierVertical.depth});}
      if(!silent)ctx.pushLog(`${passenger?.character?.name||"友軍"} 的空運取消，返回原位置。`,"SYSTEM");
      pendingTransport=null;return true;
    }
    function transportReleasePlan(attacker,destination){
      const {map,units}=state(),pending=pendingTransport;if(!pending||pending.carrier?.id!==attacker?.id||!destination)return null;
      const passenger=pending.passenger;if(!passenger?.alive||ctx.unitAt(destination.x,destination.y)||TERRAINS[destination.terrain]?.passable===false||TacticalEngine.isBlockedByObject(map,destination.x,destination.y,passenger)||!TacticalEngine.canOccupyTerrain(passenger,destination))return null;
      const dirs=[[1,0],[-1,0],[0,1],[0,-1]],plans=[],originalFacing=attacker.facing;
      for(const[dx,dy]of dirs){
        const anchor=TacticalEngine.tile(map,destination.x+dx,destination.y+dy);if(!anchor||!TacticalEngine.canOccupyTerrain(attacker,anchor)||TacticalEngine.isBlockedByObject(map,anchor.x,anchor.y,attacker))continue;
        const occupant=ctx.unitAt(anchor.x,anchor.y);if(occupant&&occupant.id!==attacker.id)continue;
        let path=[];if(anchor.x!==attacker.x||anchor.y!==attacker.y){path=TacticalEngine.pathTo(map,units,attacker,anchor.x,anchor.y);attacker.facing=originalFacing;if(!path.length)continue;}
        const anchorZ=globalThis.VerticalMobilityEngine?.surfaceZ?.(anchor)??Number(anchor.elevation||0),destinationZ=globalThis.VerticalMobilityEngine?.surfaceZ?.(destination)??Number(destination.elevation||0);
        plans.push({anchor,path,heightGap:Math.abs(Number(anchorZ)-Number(destinationZ))});
      }
      attacker.facing=originalFacing;plans.sort((a,b)=>a.heightGap-b.heightGap||a.path.length-b.path.length||a.anchor.y-b.anchor.y||a.anchor.x-b.anchor.x);return plans[0]||null;
    }

    function attackOrigins(unit){
      const {map,units}=state();
      const origins=[{x:unit.x,y:unit.y,cost:0}];
      if(!unit.moved){
        TacticalEngine.reachable(map,units,unit).forEach((cost,key)=>{
          const[x,y]=key.split(",").map(Number);origins.push({x,y,cost});
        });
      }
      origins.sort((a,b)=>a.cost-b.cost||a.y-b.y||a.x-b.x);
      return origins;
    }

    function canTargetFromOrigin(map,environmentState,unit,target,skill,origin){
      return TacticalEngine.canTarget(map,{...unit,x:origin.x,y:origin.y},target,skill,environmentState);
    }

    function attackPlanForTarget(unit,target,skill){
      const {map,units,environmentState}=state();
      if(!unit?.alive||unit.acted||!target?.alive||!skill)return null;
      if(skill.utilityAction?.type==="CARRY_ALLY")return TacticalEngine.canTarget(map,unit,target,skill,environmentState)?{x:unit.x,y:unit.y,cost:0,path:[]}:null;
      if(skill.approach)return TacticalEngine.canTarget(map,unit,target,skill,environmentState)?{x:unit.x,y:unit.y,cost:0,path:[]}:null;

      const legal=attackOrigins(unit).filter(origin=>canTargetFromOrigin(map,environmentState,unit,target,skill,origin));
      if(!legal.length)return null;
      const originalFacing=unit.facing;
      for(const origin of legal){
        if(origin.x===unit.x&&origin.y===unit.y)return{...origin,path:[]};
        const path=TacticalEngine.pathTo(map,units,unit,origin.x,origin.y);
        unit.facing=originalFacing;
        if(path.length)return{...origin,path};
      }
      return null;
    }

    function targetableEntities(unit,skill){
      const {map,environmentState}=state();
      const fixedOrigin=skill?.utilityAction?.type==="CARRY_ALLY"||skill?.approach;
      const origins=fixedOrigin?[{x:unit.x,y:unit.y,cost:0}]:attackOrigins(unit);
      return ctx.combatTargets(unit).filter(target=>{
        if(skill?.utilityAction&&target?.kind==="CORE")return false;
        if(skill?.utilityAction?.type==="CARRY_ALLY"&&(target?.id===unit?.id||!canLiftTarget(unit,target)))return false;
        if(skill?.utilityAction?.type==="LIFT_DROP"&&!canLiftTarget(unit,target))return false;
        return origins.some(origin=>canTargetFromOrigin(map,environmentState,unit,target,skill,origin));
      });
    }

    function targetRangeTiles(unit,skill){
      const {map,environmentState}=state();
      if(!unit?.alive||unit.acted||!skill)return[];
      if(ctx.targetType(skill)!=="SINGLE")return mapTargetTiles(unit,skill);
      if(skill.target==="SELF"){
        const own=TacticalEngine.tile(map,unit.x,unit.y);
        return own?[own]:[];
      }
      const origins=skill.approach?[{x:unit.x,y:unit.y,cost:0}]:attackOrigins(unit);
      const range=TacticalEngine.range(skill)||{min:0,max:0};
      const min=Math.max(0,Number(range.min||0)),max=Math.max(min,Number(range.max||0));
      const tileByKey=new Map(map.tiles.map(tile=>[`${tile.x},${tile.y}`,tile])),seen=new Set(),out=[];
      for(const origin of origins){
        const probe={...unit,x:origin.x,y:origin.y};
        for(let dx=-max;dx<=max;dx++)for(let dy=-max;dy<=max;dy++){
          const distance=Math.abs(dx)+Math.abs(dy);if(distance<min||distance>max)continue;
          const tile=tileByKey.get(`${origin.x+dx},${origin.y+dy}`);if(!tile)continue;
          const key=`${tile.x},${tile.y}`;if(seen.has(key))continue;
          if(!TacticalEngine.hasLineOfSight(map,probe,tile,skill,environmentState))continue;
          seen.add(key);out.push(tile);
        }
      }
      return out;
    }

    function beginPendingMove(unit){pendingMove={unitId:unit.id,x:unit.x,y:unit.y,z:unit.z,facing:unit.facing};}
    function commitPendingMove(unit){if(pendingMove?.unitId===unit?.id)pendingMove=null;}

    function approachTargetForAttack(unit,target,skill){
      const plan=attackPlanForTarget(unit,target,skill);
      if(!plan)return false;
      if(!plan.path.length)return true;
      if(!pendingMove||pendingMove.unitId!==unit.id)beginPendingMove(unit);
      const result=ctx.traverseUnitPath(unit,plan.path,{kind:"UNIT"});
      unit.moved=true;
      if(!result.completed){commitPendingMove(unit);return false;}
      ctx.pushLog(`${unit.character.name} 自動移動至可使用「${skill.name}」的位置。`,"DETAIL");
      const s=state();return TacticalEngine.canTarget(s.map,unit,target,skill,s.environmentState);
    }

    function resolveDirectTargetAttack(unit,target,skill){
      const {map,environmentState}=state();
      if(!unit?.alive||unit.acted||!target?.alive||!TacticalEngine.canTarget(map,unit,target,skill,environmentState))return false;
      if(target.kind!=="CORE")return false;
      globalThis.EffectEngine?.breakStealth?.(unit,"ACTION");
      ctx.consumeSkill(unit,skill);skill=ctx.effectiveSkill(unit,skill);
      globalThis.UnitAnimationEngine?.emitAction?.(unit,target,skill,{targetKind:"CORE"});
      const stat=skill.attackType==="MAGIC"?Number(unit.character.combat.matk||unit.character.combat.atk||0):Number(unit.character.combat.atk||0);
      const raw=Math.max(1,Math.round(stat*Number(skill.power||1)-Number(target.core.defense||30)));
      ctx.damageCore(target.core.owner,raw,`${unit.character.name}【${skill.name}】`);
      commitPendingMove(unit);
      unit.moved=true;unit.acted=true;unit.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();return true;
    }

    function mapTargetTiles(attacker,skill){
      const {map,units,environmentState}=state();
      const range=TacticalEngine.range(skill);
      if(skill?.utilityAction?.type==="RELEASE_CARRIED")return map.tiles.filter(tile=>!!transportReleasePlan(attacker,tile));
      return map.tiles.filter(tile=>{
        const d=Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);
        if(d<range.min||d>range.max)return false;
        if(skill.shape==="LINE"){
          if(attacker.x!==tile.x&&attacker.y!==tile.y)return false;
          if(skill.moveToTarget&&(ctx.unitAt(tile.x,tile.y)||!ctx.canTraverseMoveLine(attacker,tile)))return false;
        }
        if(skill.shape==="W_STEP"){
          if(ctx.unitAt(tile.x,tile.y)||TERRAINS[tile.terrain]?.passable===false)return false;
        }
        if(skill.trapPlacement&&(ctx.unitAt(tile.x,tile.y)||TERRAINS[tile.terrain]?.passable===false))return false;
        if(skill.requiresVision!==false&&!TacticalEngine.canSee(map,attacker,tile,environmentState))return false;
        if(skill.environmentRequirement==="CONDUCTIVE"&&!EnvironmentEngine.isConductive(map,environmentState,tile.x,tile.y))return false;
        return true;
      });
    }

    function executeUtilitySkill(attacker,target,skill){
      const {map,units}=state(),action=skill?.utilityAction;if(!action||!ctx.canUseSkill(attacker,skill))return false;
      if(action.type==="SET_VERTICAL_MODE"){
        const tile=TacticalEngine.tile(map,attacker.x,attacker.y),result=globalThis.VerticalMobilityEngine?.setMode?.(attacker,tile,action.mode,action.options||{});
        if(!result?.ok){ctx.pushLog(`${skill.name} 無法切換目前的垂直移動狀態。`,"SYSTEM");ctx.render();return false;}
        ctx.consumeSkill(attacker,skill);ctx.pushLog(`${attacker.character.name}｜${skill.name} → ${result.state.mode}。`,"SYSTEM");
        return action.consumeTurn===true?finishActiveSkill(attacker):finishFreeUtility(attacker);
      }
      if(action.type==="ENTER_STEALTH"){
        ctx.consumeSkill(attacker,skill);globalThis.EffectEngine?.applyStealth?.(attacker,{detectionRange:1,source:attacker});
        const adjacent=(units||[]).some(u=>u?.alive&&u.team!==attacker.team&&Math.abs(u.x-attacker.x)+Math.abs(u.y-attacker.y)<=1);
        if(adjacent){globalThis.EffectEngine?.breakStealth?.(attacker,"PROXIMITY");ctx.pushLog(`${attacker.character.name} 嘗試再次潛行，但敵人就在身旁，潛行立即解除。`,"BATTLE");}
        else ctx.pushLog(`${attacker.character.name} 犧牲本回合行動，再次進入潛行。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="STEAL_CARD"){
        if(!target?.character||target.team===attacker.team)return false;
        const {own,other}=runtimeCardStates(attacker),hand=other?.zones?.hand;
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");ctx.consumeSkill(attacker,skill);
        if(!own?.zones?.hand||!Array.isArray(hand)||!hand.length){ctx.pushLog(`${attacker.character.name} 使用偷竊，但對方手牌已空。`,"BATTLE");return finishActiveSkill(attacker);}
        const index=Math.floor(Math.random()*hand.length),cardId=hand.splice(index,1)[0];own.zones.hand.push(cardId);
        ctx.pushLog(`${attacker.character.name} 偷走對方一張手牌「${CardDatabase.get(cardId)?.name||cardId}」｜僅限本場戰鬥。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="LIFT_DROP"){
        if(!target?.character||target.team===attacker.team||!canLiftTarget(attacker,target)){ctx.pushLog(`${skill.name} 只能抓起比搬運能力更輕的敵人。`,"SYSTEM");ctx.render();return false;}
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");ctx.consumeSkill(attacker,skill);globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        const tile=TacticalEngine.tile(map,target.x,target.y),landingState=globalThis.VerticalMobilityEngine?.describe?.(target,tile),landingZ=Number(landingState?.physicalZ??target.z??TacticalEngine.elevation(tile)),drop=Math.max(Number(action.minDrop||0),Number(globalThis.FallEngine?.FALL_THRESHOLD||2)+1),fromZ=landingZ+drop;
        target.z=fromZ;const landing=FallEngine.resolveLanding({map,target,fromZ,applyDamage:(unit,damage)=>ctx.damageUnitFlat(unit,damage,skill.name)});
        ctx.pushLog(`${attacker.character.name} 抓起 ${target.character.name} 升至 Z${fromZ} 後放開｜墜落 ${landing.drop}｜傷害 ${landing.damage}。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="CARRY_ALLY"){
        if(!target?.character||target.id===attacker.id||target.team!==attacker.team||!canLiftTarget(attacker,target)){ctx.pushLog(`${skill.name} 只能搬運比搬運能力更輕的友軍。`,"SYSTEM");ctx.render();return false;}
        if(pendingTransport)return false;
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");ctx.consumeSkill(attacker,skill);
        pendingTransport={carrier:attacker,passenger:target,origin:{x:target.x,y:target.y,z:target.z,verticalState:target.verticalState?JSON.parse(JSON.stringify(target.verticalState)):null},carrierVertical:attacker.verticalState?JSON.parse(JSON.stringify(attacker.verticalState)):null};
        attacker.carryingUnitId=target.id;target.carriedByUnitId=attacker.id;target.transportHidden=true;target.x=-9999;target.y=-9999;target.z=attacker.z;
        const carrierTile=TacticalEngine.tile(map,attacker.x,attacker.y);if(attacker.verticalState?.mode==="FLYING"&&carrierTile)VerticalMobilityEngine.setMode(attacker,carrierTile,"FLYING",{altitude:1});
        const releaseSkill=SkillDatabase.get(action.releaseSkillId);ctx.setSelectedSkill(releaseSkill);ctx.setSelectedSkillVariant(null);ctx.setMode("map-target");ctx.pushLog(`${attacker.character.name} 抓起 ${target.character.name}｜請選擇放下位置。`,"SYSTEM");ctx.render();return true;
      }
      return false;
    }

    function executeMapUtility(attacker,center,skill){
      const action=skill?.utilityAction;if(action?.type!=="RELEASE_CARRIED"||!pendingTransport||pendingTransport.carrier?.id!==attacker?.id)return false;
      const {map}=state(),plan=transportReleasePlan(attacker,center);if(!plan){ctx.pushLog(`${skill.name}：沒有合法的空運放置路徑。`,"SYSTEM");ctx.render();return false;}
      if(plan.path.length){const moved=ctx.traverseUnitPath(attacker,plan.path,{kind:"UNIT"});if(!moved.completed){restorePendingTransport({silent:true});ctx.pushLog(`${attacker.character.name} 的空運途中受到環境影響而中斷。`,"SYSTEM");return finishActiveSkill(attacker);}}
      attacker.moved=true;const pending=pendingTransport,passenger=pending.passenger,destination=TacticalEngine.tile(map,center.x,center.y),fromZ=Number(globalThis.VerticalMobilityEngine?.describe?.(attacker,TacticalEngine.tile(map,attacker.x,attacker.y))?.physicalZ??attacker.z??0);
      ctx.consumeSkill(attacker,skill);passenger.x=destination.x;passenger.y=destination.y;passenger.z=fromZ;delete passenger.carriedByUnitId;delete passenger.transportHidden;delete attacker.carryingUnitId;
      const landing=FallEngine.resolveLanding({map,target:passenger,fromZ,applyDamage:(unit,damage)=>ctx.damageUnitFlat(unit,damage,skill.name)});
      if(passenger.alive)ctx.enterTile(passenger);
      const previous=pending.carrierVertical;if(previous?.mode&&globalThis.VerticalMobilityEngine?.setMode){const carrierTile=TacticalEngine.tile(map,attacker.x,attacker.y);VerticalMobilityEngine.setMode(attacker,carrierTile,previous.mode,{altitude:previous.altitude,depth:previous.depth});}
      pendingTransport=null;ctx.pushLog(`${attacker.character.name} 將 ${passenger.character.name} 放到 (${destination.x},${destination.y})｜Z${fromZ}→H${landing.toZ}｜墜落傷害 ${landing.damage}。`,landing.damage>0?"BATTLE":"SYSTEM");
      return finishActiveSkill(attacker);
    }

    function relationAllows(skill,attacker,occupant){
      if(!occupant?.alive)return false;
      if(skill.target==="SELF")return occupant.id===attacker.id;
      if(skill.target==="ALLY")return occupant.team===attacker.team;
      if(skill.target==="ENEMY")return occupant.team!==attacker.team;
      return true;
    }
    function applyPassiveSkillTriggers(attacker,target,skill){
      if(!globalThis.EffectEngine||!attacker?.character||!target?.alive)return[];
      const tags=new Set(skill?.tags||[]),rel=EffectEngine.relation(attacker,target),results=[];
      if(!tags.size)return results;
      for(const passive of SkillDatabase.passiveList(attacker.character.passives||[])){
        for(const trigger of passive?.skillTriggers||[]){
          const whenTags=trigger.whenTags||[];
          if(whenTags.length&&!whenTags.some(tag=>tags.has(tag)))continue;
          if(Array.isArray(trigger.relations)&&!trigger.relations.includes(rel))continue;
          if(!trigger.effect)continue;
          const result=EffectEngine.apply({source:attacker,target,effect:trigger.effect});results.push({passive,trigger,result});
          if(result?.applied)ctx.pushLog(`${passive.name} → ${target.character.name}｜獲得「${trigger.effect.name||trigger.effect.id||trigger.effect.type}」。`,"BATTLE");
        }
      }
      return results;
    }
    function applyMapEffects(attacker,affected,skill){
      if(!globalThis.EffectEngine||(!Array.isArray(skill.effects)&&!Array.isArray(skill.relationEffects)))return;
      for(const tile of affected){
        const occupant=ctx.unitAt(tile.x,tile.y);if(!occupant||!relationAllows(skill,attacker,occupant))continue;
        const effects=Array.isArray(skill.relationEffects)?skill.relationEffects.filter(effect=>!effect.relation||effect.relation===EffectEngine.relation(attacker,occupant)):(skill.effects||[]);
        for(const effect of effects){
          const result=EffectEngine.apply({source:attacker,target:occupant,effect});
          if(!result?.applied){
            if(result?.reason==="NEGATIVE_EFFECT_GUARD")ctx.pushLog(`${occupant.character.name} 的恩寵抵消了「${effect.name||effect.id||effect.type}」。`,"BATTLE");
            continue;
          }
          if(effect.type==="HEAL")ctx.pushLog(`${skill.name} → ${occupant.character.name}｜回復 ${result.amount||0} HP｜HP ${occupant.hp}。`,"BATTLE");
          else if(effect.type==="HEAL_OVER_TIME")ctx.pushLog(`${skill.name} → ${occupant.character.name}｜獲得持續治癒 ${effect.duration||0} 回合。`,"BATTLE");
          else if(effect.type==="SHIELD")ctx.pushLog(`${skill.name} → ${occupant.character.name}｜護盾 ${result.amount||0}。`,"BATTLE");
          else if(effect.type==="MAGIC_DAMAGE"||effect.type==="DAMAGE")ctx.pushLog(`${skill.name} → ${occupant.character.name}｜${result.amount||0} 傷害｜HP ${occupant.hp}。`,"BATTLE");
        }
        applyPassiveSkillTriggers(attacker,occupant,skill);
      }
    }

    function executeMapSkill(attacker,center,skill){
      const {map,environmentState}=state();
      if(skill?.utilityAction)return executeMapUtility(attacker,center,skill);
      if(!ctx.canUseSkill(attacker,skill))return false;
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      ctx.consumeSkill(attacker,skill);
      skill=ctx.effectiveSkill(attacker,skill);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"MAP"});
      if(skill.trapPlacement&&environmentState&&globalThis.EnvironmentEngine?.createTrap){
        const trap=EnvironmentEngine.createTrap(environmentState,center.x,center.y,{...skill.trapPlacement,sourceTeam:attacker.team,sourceUnitId:attacker.id});
        ctx.pushLog(`${attacker.character.name} 在 (${center.x},${center.y}) 設置「${trap?.name||skill.name}」。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      const affected=skill.shape==="LINE"?ctx.lineTiles(attacker,center):ctx.aoeTiles(center,skill.radius||0);
      if(skill.shape==="LINE"){
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);
          if(!occupant||occupant.team===attacker.team)return;
          const distance=Math.abs(attacker.x-occupant.x)+Math.abs(attacker.y-occupant.y);
          const result=BattleEngine.calculate(attacker.character,occupant.character,skill,{distance});
          if(!result.hit){ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");return;}
          const shield=globalThis.EffectEngine?.resolveIncomingDamage?EffectEngine.resolveIncomingDamage(occupant,result.damage):{damage:result.damage,absorbed:0};
          occupant.hp=Math.max(0,occupant.hp-shield.damage);
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} ${shield.damage} 傷害${shield.absorbed?`｜護盾吸收 ${shield.absorbed}`:""}｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
          else if(Number(shield.damage||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(occupant,{sourceId:attacker.id,skillId:skill.id,damage:Number(shield.damage||0)});
        });
      }
      if(skill.aoeDamage){
        affected.forEach(tile=>{const occupant=ctx.unitAt(tile.x,tile.y);if(occupant)ctx.damageUnitFlat(occupant,skill.aoeDamage,skill.name);});
      }
      applyMapEffects(attacker,affected,skill);
      const environmentEvents=[];
      affected.forEach(tile=>{
        const events=environmentState&&skill.environmentForces
          ?EnvironmentEngine.apply({map,state:environmentState,x:tile.x,y:tile.y,forces:skill.environmentForces})
          :[];
        environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);
      });
      if(skill.hydrologyFlood&&window.HydrologyEngine?.floodArea){
        const floodEvents=HydrologyEngine.floodArea(map,affected,{surfaceRise:Number(skill.hydrologyFlood.surfaceRise||1),source:skill.id});
        environmentEvents.push(...floodEvents);floodEvents.forEach(ctx.logEnvironmentEvent);
        const resolved=floodEvents.find(event=>event.type==="FLOOD_AREA_RESOLVED"),wetCount=resolved?.tiles?.filter(tile=>Number(tile.waterDepth||0)>0).length||0;
        ctx.pushLog(`${skill.name}｜注入 Water Volume ${Number(resolved?.injectedVolume||0).toFixed(2)}｜${wetCount} 格形成／加深水域。`,"SYSTEM");
      }
      ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${skill.name} 引發環境連鎖`});
      affected.forEach(tile=>{
        if(!EnvironmentEngine.effectAt(environmentState,tile.x,tile.y).some(effect=>effect.type===EnvironmentEngine.EFFECT.BURNING))return;
        const occupant=ctx.unitAt(tile.x,tile.y);
        if(occupant)ctx.applyEnvironmentHazardToUnit(occupant,{reason:"遭燃燒地形波及"});
      });
      ctx.pushLog(`${attacker.character.name} 使用 ${skill.name}｜中心 (${center.x},${center.y})。`,"BATTLE");
      if(skill.moveToTarget&&!ctx.unitAt(center.x,center.y)){
        if(skill.shape==="W_STEP"){
          attacker.x=center.x;attacker.y=center.y;attacker.z=Number(TacticalEngine.elevation(TacticalEngine.tile(map,center.x,center.y))||0);ctx.enterTile(attacker);
          ctx.pushLog(`${attacker.character.name} 隨 ${skill.name} 進行空間移動至 (${center.x},${center.y})。`,"BATTLE");
        }else{
          const moveResult=ctx.traverseUnitPath(attacker,ctx.lineTiles(attacker,center),{kind:"UNIT"});
          ctx.pushLog(`${attacker.character.name} 隨 ${skill.name} ${moveResult.completed?`移動至 (${attacker.x},${attacker.y})`:"移動途中受到環境影響而中斷"}。`,"BATTLE");
        }
      }
      if(ctx.checkMatchEnd()){ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.render();return true;}
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
      return true;
    }

    function cancelPendingMove(){
      const {selected}=state();
      if(!selected||pendingMove?.unitId!==selected.id||selected.acted)return false;
      selected.x=pendingMove.x;selected.y=pendingMove.y;selected.z=pendingMove.z;if(pendingMove.facing)selected.facing=pendingMove.facing;
      selected.moved=false;pendingMove=null;ctx.setCommandPanelCollapsed(false);ctx.setMode("command");
      ctx.pushLog(`${selected.character.name} 取消移動，返回原位置。`,"SYSTEM");ctx.render();ctx.emitState();return true;
    }

    function backFromTargeting(){
      const {selectedSkill}=state();
      if(!selectedSkill)return false;
      if(pendingTransport&&selectedSkill?.utilityAction?.type==="RELEASE_CARRIED"){
        restorePendingTransport();ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("special-menu");ctx.render();return true;
      }
      const previousSkill=selectedSkill;
      if(previousSkill?.baseSkillId){
        ctx.setSelectedSkill(SkillDatabase.get(previousSkill.baseSkillId));
        ctx.setSelectedSkillVariant(null);ctx.setMode("variant-menu");
      }else{
        ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);
        ctx.setMode(previousSkill.category!=="ATTACK"?"special-menu":"attack-menu");
      }
      ctx.render();return true;
    }

    function finishActiveSkill(attacker){
      commitPendingMove(attacker);
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return true;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();return true;
    }

    function logAppliedEffect(skill,target,effect,result){
      if(!result?.applied){if(result?.reason==="NEGATIVE_EFFECT_GUARD")ctx.pushLog(`${target.character.name} 的恩寵抵消了「${effect.name||effect.id||effect.type}」。`,"BATTLE");return;}
      if(effect.type==="HEAL")ctx.pushLog(`${skill.name} → ${target.character.name}｜回復 ${result.amount||0} HP｜HP ${target.hp}。`,"BATTLE");
      else if(effect.type==="RESTORE_MANA")ctx.pushLog(`${skill.name} → ${target.character.name}｜回復 ${result.amount||0} MP。`,"BATTLE");
      else if(effect.type==="SHIELD")ctx.pushLog(`${skill.name} → ${target.character.name}｜護盾 ${result.amount||0}。`,"BATTLE");
      else if(effect.type==="HEAL_OVER_TIME")ctx.pushLog(`${skill.name} → ${target.character.name}｜獲得持續治癒 ${effect.duration||0} 回合。`,"BATTLE");
    }

    function executeEffectSkill(attacker,target,skill){
      if(!window.EffectEngine||!ctx.canUseSkill(attacker,skill))return false;
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      ctx.consumeSkill(attacker,skill);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
      const results=[];
      if(Array.isArray(skill.relationEffects)){
        const rel=EffectEngine.relation(attacker,target);
        for(const effect of skill.relationEffects.filter(e=>e.relation===rel)){
          if(effect.type==="MAGIC_DAMAGE"){
            const attackSkill={...skill,power:Number(effect.power||1),attackType:"MAGIC",element:effect.element||"NONE",traitMultipliers:effect.traitMultipliers||{},weapon:effect.weapon||skill.weapon};
            const distance=Math.abs(attacker.x-target.x)+Math.abs(attacker.y-target.y);
            const result=BattleEngine.calculate(attacker.character,target.character,attackSkill,{distance});
            let dealt=0,absorbed=0;
            if(result.hit){const shield=EffectEngine.resolveIncomingDamage(target,result.damage);dealt=shield.damage;absorbed=shield.absorbed;target.hp=Math.max(0,target.hp-dealt);if(target.hp===0)target.alive=false;}
            results.push({type:"MAGIC_DAMAGE",...result,damage:dealt,shieldAbsorbed:absorbed});
            ctx.pushLog(`${attacker.character.name} → ${target.character.name}｜${skill.name} ${result.hit?dealt+" 傷害":"MISS"}${absorbed?`｜護盾吸收 ${absorbed}`:""}｜HP ${target.hp}。`,"BATTLE");
            if(!target.alive)ctx.handleDefeated(target,attacker,skill);
            else if(result.hit&&Number(dealt||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(target,{sourceId:attacker.id,skillId:skill.id,damage:Number(dealt||0)});
          }else{
            const r=EffectEngine.apply({source:attacker,target,effect});results.push(r);logAppliedEffect(skill,target,effect,r);
          }
        }
      }else if(Array.isArray(skill.effects)){
        for(const effect of skill.effects){const r=EffectEngine.apply({source:attacker,target,effect});results.push(r);logAppliedEffect(skill,target,effect,r);}
      }
      applyPassiveSkillTriggers(attacker,target,skill);
      if(skill.bloodAction){
        const b=skill.bloodAction,bonus=b.bonusAgainstEffect,bonusActive=bonus?.id&&EffectEngine.hasEffect(target,bonus.id),drainAmount=Math.round(Number(b.damage||0)*(bonusActive?Number(bonus.multiplier||1):1));
        const drain=EffectEngine.apply({source:attacker,target,effect:{type:"DRAIN",amount:drainAmount,healRatio:b.healRatio}});results.push(drain);
        const passive=b.restoreFromPassive?SkillDatabase.getPassive(b.restoreFromPassive):null,restoration=passive?.bloodRestoration||null,restoreValues=b.restoresGenome||restoration?.values||null,restoreDuration=Number(b.duration||restoration?.duration||0);
        if(restoreValues)EffectEngine.apply({source:attacker,target:attacker,effect:{type:"ATTRIBUTE_OVERRIDE",id:"BLOOD_GENOME_RESTORATION",classification:"POSITIVE",duration:restoreDuration,values:restoreValues}});
        const manaRestore=EffectEngine.apply({source:attacker,target:attacker,effect:{type:"RESTORE_MANA",amount:Math.round(Number(drain.damage||0)*Number(b.manaRatio||0))}});results.push(manaRestore);
        ctx.pushLog(`${attacker.character.name} 吸取 ${target.character.name} 的血${bonusActive?"｜流血目標吸血強化":""}｜${drain.damage||0} 傷害｜自癒 ${drain.healed||0} HP｜回復 ${manaRestore.amount||0} MP${restoreValues?"｜病患：暫時恢復 5V":""}。`,"BATTLE");
        if(!target.alive)ctx.handleDefeated(target,attacker,skill);
        else if(Number(drain.damage||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(target,{sourceId:attacker.id,skillId:skill.id,damage:Number(drain.damage||0)});
        if(b.copySkill){
          const options=EffectEngine.copyableSkills(target);
          if(options.length){ctx.setPendingCopySkill({attacker,target,options,duration:b.copyDuration});ctx.setMode("copy-skill-select");ctx.render();return true;}
        }
      }
      return finishActiveSkill(attacker);
    }

    function approachForSkill(attacker,defender,skill){
      const {map,units}=state();
      if(!skill?.approach)return true;
      if(attacker.moved)return false;
      const stop=Math.max(1,Number(skill.approach.stopDistance||1));
      const candidates=map.tiles.filter(t=>Math.abs(t.x-defender.x)+Math.abs(t.y-defender.y)===stop&&!ctx.unitAt(t.x,t.y));
      const paths=candidates.map(t=>TacticalEngine.pathTo(map,units,attacker,t.x,t.y)).filter(path=>path.length).sort((a,b)=>a.length-b.length);
      if(!paths.length)return false;
      const result=ctx.traverseUnitPath(attacker,paths[0],{kind:"UNIT"});
      if(!result.completed)return false;
      attacker.moved=true;
      ctx.pushLog(`${attacker.character.name} 以 ${skill.name} 衝至 ${defender.character.name} 身前。`,"BATTLE");
      return true;
    }

    function prepareAttack(attacker,defender,skill){
      const {map,units}=state();
      if(!ctx.canUseSkill(attacker,skill))return;
      if(skill.approach&&!approachForSkill(attacker,defender,skill)){
        ctx.pushLog(`${skill.name} 無合法衝鋒路徑。`,"SYSTEM");ctx.render();return;
      }
      if(skill.utilityAction){executeUtilitySkill(attacker,defender,skill);return;}
      if(skill.effects||skill.relationEffects||skill.bloodAction){executeEffectSkill(attacker,defender,skill);return;}
      skill=ctx.effectiveSkill(attacker,skill);
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      if(ctx.targetType(skill)!=="SINGLE"){executeEngagement(attacker,defender,skill,[]);return;}
      const candidates=BattleResolution.supportCandidates({units,initiator:attacker,target:defender,canUseSkill:ctx.canUseSkill}).map(candidate=>({...candidate,skills:candidate.skills.filter(supportSkill=>TacticalEngine.canTarget(map,candidate.ally,defender,supportSkill,state().environmentState))})).filter(candidate=>candidate.skills.length);
      ctx.setPendingEngagement({attacker,defender,skill,candidates});
      ctx.setSupportSelection(new Map());
      ctx.setMode("support-select");
      ctx.pushLog(`可選支援：${candidates.map(x=>x.ally.character.name).join("、")}`);
      ctx.render();
    }

    function selectedSupportActions(){
      const pendingEngagement=ctx.getPendingEngagement();
      if(!pendingEngagement)return [];
      const supportSelection=ctx.getSupportSelection();
      const actions=[];
      pendingEngagement.candidates.forEach(({ally},index)=>{const skill=supportSelection.get(ally.id);if(skill)actions.push(BattleResolution.createSupportAction(ally,pendingEngagement.defender,skill,index));});
      return actions;
    }

    function confirmEngagement(){
      const pendingEngagement=ctx.getPendingEngagement();
      if(!pendingEngagement)return;
      const {attacker,defender,skill}=pendingEngagement;
      executeEngagement(attacker,defender,skill,selectedSupportActions());
    }

    function executeEngagement(attacker,defender,skill,actions){
      const {map,units}=state();
      const engagement=BattleResolution.resolve(
        {map,units,initiator:attacker,target:defender,skill,actions},
        {canUseSkill:ctx.canUseSkill,consumeSkill:ctx.consumeSkill,onDefeated:ctx.handleDefeated,onAction:ctx.logBattleAction,onPostEffect:ctx.logPostEffect}
      );
      if(!engagement.results.length){ctx.clearEngagement();ctx.setMode("command");ctx.render();return;}
      commitPendingMove(attacker);
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.clearEngagement();ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
    }

    function reset(){pendingMove=null;pendingTransport=null;}

    return Object.freeze({
      reset,pendingMove:()=>pendingMove,
      attackPlanForTarget,targetableEntities,targetRangeTiles,approachTargetForAttack,resolveDirectTargetAttack,
      mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,
      backFromTargeting,finishActiveSkill,executeEffectSkill,approachForSkill,prepareAttack,
      selectedSupportActions,confirmEngagement,executeEngagement
    });
  }

  window.TacticalActionController=Object.freeze({create});
})();
