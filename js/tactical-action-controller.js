(()=>{
  "use strict";

  function create(ctx){
    let pendingMove=null,pendingTransport=null;
    const MAP_TRANSIT_ACTIONS=new Set(["TELEPORT_TO_TILE","WORMHOLE_TRANSIT"]);

    function state(){return ctx.actionState();}

    // Report only real execution rejections (never range previews / target lists).
    // UnitRuntimeEngine remains the sole resource/turn-rule authority.
    function skillFailure(unit,skill,reason,target=null){
      let detail=reason;
      if(reason==="RESOURCE_OR_REQUIREMENT"){
        const req=skill?.requirements||{};
        if((skill?.approach||req.notMoved)&&unit?.moved)detail="ALREADY_MOVED";
        else if(req.carrying&&!unit?.carryingUnitId)detail="NOT_CARRYING";
        else if(req.notCarrying&&unit?.carryingUnitId)detail="ALREADY_CARRYING";
        else if(req.water){
          const tile=TacticalEngine.tile(state().map,unit?.x,unit?.y);
          if(!(Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)>0))detail="REQUIRES_WATER";
        }
        if(detail===reason){
          const r=ctx.resourceFor?.(unit,skill);
          if(r&&Number(r.remaining)<Number(r.cost))detail=`MANA_SHORTAGE_${r.remaining}_OF_${r.cost}`;
          else if(r){
            const rules=globalThis.UnitRuntimeEngine?.extraResourceRules?.(unit)||{};
            for(const [key,x] of Object.entries(r.resources||{})){
              if(!rules[key]){detail=`RESOURCE_RULE_MISSING_${key}`;break;}
              if(rules[key].allowOverdraft!==true&&x.remaining<x.cost){detail=`RESOURCE_SHORTAGE_${key}_${x.remaining}_OF_${x.cost}`;break;}
            }
          }
        }
      }
      window.CardTacticsDiagnostics?.gameAction?.("SKILL_FAILURE",{
        unitId:unit?.id,unit:unit?.character?.name,team:unit?.team,
        skillId:skill?.id,skill:skill?.name,
        targetId:target?.id||null,target:target?.character?.name||target?.name||null,
        x:target?.x,y:target?.y,reason:detail
      });
      return false;
    }

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
    const CARRY_DIRECTIONS=Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);
    const transportKey=tile=>`${tile.x},${tile.y}`;
    // Plan-only until release is confirmed: cancelling selection never moves a
    // unit, consumes mana, or leaves a passenger hidden on the battlefield.
    function restorePendingTransport({silent=false}={}){
      if(!pendingTransport)return false;
      const {carrier,passenger,origin,carrierVertical,committed}=pendingTransport;
      if(committed){
        if(passenger){passenger.x=origin.x;passenger.y=origin.y;passenger.z=origin.z;passenger.verticalState=origin.verticalState;delete passenger.carriedByUnitId;delete passenger.transportHidden;}
        if(carrier){delete carrier.carryingUnitId;const tile=TacticalEngine.tile(state().map,carrier.x,carrier.y);if(tile&&carrierVertical?.mode&&globalThis.VerticalMobilityEngine?.setMode)VerticalMobilityEngine.setMode(carrier,tile,carrierVertical.mode,{altitude:carrierVertical.altitude,depth:carrierVertical.depth});}
      }
      if(!silent)ctx.pushLog(`已取消空運 ${passenger?.character?.name||"目標"}，位置與技能資源保持不變。`,"SYSTEM");
      pendingTransport=null;return true;
    }
    function canPickupFrom(carrier,passenger,origin,environmentState,kind="ALLY"){
      if(!carrier?.alive||carrier.acted||!passenger?.alive||(kind==="ENEMY"?carrier.team===passenger.team:carrier.team!==passenger.team)||carrier.id===passenger.id||!canLiftTarget(carrier,passenger))return false;
      if(Math.abs(origin.x-passenger.x)+Math.abs(origin.y-passenger.y)!==1)return false;
      // Flight pickup is a controlled descent/ascent beside the passenger,
      // not a ground melee attack. Ground height must not gate this utility.
      const {map}=state();
      return !!TacticalEngine.tile(map,origin.x,origin.y)&&
        TacticalEngine.canSee(map,{...carrier,x:origin.x,y:origin.y},passenger,environmentState);
    }
    function pickupPlan(carrier,passenger,skill,origins=null){
      const {map,units,environmentState}=state();
      if(!carrier?.alive||carrier.acted||!ctx.canUseSkill(carrier,skill)||!canLiftTarget(carrier,passenger))return null;
      const kind=skill.utilityAction?.type==="CARRY_ENEMY"?"ENEMY":"ALLY";
      const candidates=(origins||attackOrigins(carrier)).filter(origin=>canPickupFrom(carrier,passenger,origin,environmentState,kind));
      if(!candidates.length)return null;
      candidates.sort((a,b)=>a.cost-b.cost||a.y-b.y||a.x-b.x);
      const anchor=candidates[0];
      return{anchor,cost:anchor.cost};
    }
    // One authoritative reachability search from the planned pickup anchor.
    // Evaluate landing-adjacent cells in O(reachable * 4), never pathTo() per
    // candidate landing cell and never scan all 704 XLARGE cells to plan paths.
    function transportReleasePlans(attacker,{fresh=false}={}){
      const {map,units}=state(),pending=pendingTransport;
      if(!pending||pending.carrier?.id!==attacker?.id||!pending.passenger?.alive)return new Map();
      if(!fresh&&pending.releasePlans)return pending.releasePlans;
      const passenger=pending.passenger,pickup=pending.pickup.anchor;
      const flyingUnit={...attacker,x:pickup.x,y:pickup.y};
      const withoutPassenger=units.filter(unit=>unit.id!==passenger.id);
      // This is the carrier's *real* movement domain: character movement,
      // effects, weather, terrain, height and occupancy all remain owned by
      // TacticalEngine. The landing tile must itself be in that domain,
      // rather than extending reach by another cell beyond a flight anchor.
      const reachable=TacticalEngine.reachable(map,withoutPassenger,flyingUnit);
      const flightDomain=new Map([[transportKey(pickup),0],...reachable]);
      const anchors=new Map([...flightDomain].map(([key,cost])=>{
        const [x,y]=key.split(",").map(Number);return[key,{x,y,cost}];
      }));
      const best=new Map();
      for(const anchor of anchors.values()){
        const anchorTile=TacticalEngine.tile(map,anchor.x,anchor.y);
        if(!anchorTile||!TacticalEngine.canOccupyTerrain(attacker,anchorTile)||
          TacticalEngine.isBlockedByObject(map,anchor.x,anchor.y,attacker))continue;
        for(const [dx,dy] of CARRY_DIRECTIONS){
          const destination=TacticalEngine.tile(map,anchor.x+dx,anchor.y+dy);
          if(!destination||TERRAINS[destination.terrain]?.passable===false||
            !TacticalEngine.canOccupyTerrain(passenger,destination)||
            TacticalEngine.isBlockedByObject(map,destination.x,destination.y,passenger))continue;
          if(units.some(unit=>unit.alive&&unit.occupiesTile!==false&&
            unit.id!==passenger.id&&unit.x===destination.x&&unit.y===destination.y))continue;
          // A passenger's destination has the same flight domain as the
          // carrier; an extra adjacent drop never extends the movement range.
          const key=transportKey(destination);
          if(!flightDomain.has(key))continue;
          const existing=best.get(key);
          if(!existing||anchor.cost<existing.cost||
            (anchor.cost===existing.cost&&(anchor.y<existing.anchor.y||anchor.y===existing.anchor.y&&anchor.x<existing.anchor.x)))
            best.set(key,{destination,anchor,cost:anchor.cost});
        }
      }
      pending.releasePlans=best;
      return best;
    }
    function transportReleasePlan(attacker,destination){
      const {map,units,environmentState}=state(),pending=pendingTransport;
      if(!pending||!destination)return null;
      // Re-evaluate against the live units/terrain, rather than trusting a UI
      // snapshot whose collision or environmental state could have changed.
      const latest=pickupPlan(attacker,pending.passenger,pending.pickupSkill);
      if(!latest)return null;
      pending.pickup=latest;
      const planned=transportReleasePlans(attacker,{fresh:true}).get(transportKey(destination));
      if(!planned||!TacticalEngine.teamCanSee(map,units,attacker.team,planned.destination,environmentState))return null;
      const pickupPath=planned?((latest.anchor.x===attacker.x&&latest.anchor.y===attacker.y)?[]:
        TacticalEngine.pathTo(map,units,attacker,latest.anchor.x,latest.anchor.y)):[];
      if((latest.anchor.x!==attacker.x||latest.anchor.y!==attacker.y)&&!pickupPath.length)return null;
      const flightUnit={...attacker,x:latest.anchor.x,y:latest.anchor.y};
      const route=planned.anchor.x===flightUnit.x&&planned.anchor.y===flightUnit.y?[]:
        TacticalEngine.pathTo(map,units.filter(unit=>unit.id!==pending.passenger.id),flightUnit,planned.anchor.x,planned.anchor.y);
      if((planned.anchor.x!==flightUnit.x||planned.anchor.y!==flightUnit.y)&&!route.length)return null;
      return{...planned,pickupPath,flightPath:route};
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
      if(["CARRY_ALLY","CARRY_ENEMY"].includes(skill.utilityAction?.type))return pickupPlan(unit,target,skill);
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
      const fixedOrigin=!!skill?.approach;
      const origins=fixedOrigin?[{x:unit.x,y:unit.y,cost:0}]:attackOrigins(unit);
      return ctx.combatTargets(unit).filter(target=>{
        // A future movement origin must not grant clairvoyance about a core or
        // an enemy unit which no current friendly observer has revealed.
        if(target.team!==unit.team&&skill?.ignoreFogOfWar!==true&&
           !TacticalEngine.teamCanSee(map,state().units,unit.team,target,environmentState))return false;
        if(skill?.utilityAction&&target?.kind==="CORE")return false;
        if(["CARRY_ALLY","CARRY_ENEMY"].includes(skill?.utilityAction?.type))return !!pickupPlan(unit,target,skill,origins);
        
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

    // A skill can explicitly opt in to aiming at an environmental state,
    // independently of its normal combat target. Normal ENEMY combat keeps
    // BattleResolution, reaction, hit chance and damage unchanged.
    function canObserveFireSource(unit,tile,environmentState,origin=unit){
      const {map}=state();
      if(!EnvironmentEngine.isBurning(environmentState,tile.x,tile.y))return false;
      const observer={...unit,x:origin.x,y:origin.y};
      // Optical fire-source transmission is distinct from identifying a unit
      // standing behind opaque smoke. The environment owns the burning state.
      return TacticalEngine.canSeeLight(map,observer,{x:tile.x,y:tile.y,radius:0},environmentState)&&
        TacticalEngine.lightTransmission(map,observer,{x:tile.x,y:tile.y,radius:0},environmentState)>0;
    }
    function environmentTargetTiles(unit,skill){
      if(skill?.environmentTarget!=="BURNING"||skill?.waterContact!=="RAIN_EVENT"||!unit?.alive||unit.acted)return[];
      const {map,units,environmentState}=state();
      const origins=skill.approach?[{x:unit.x,y:unit.y,cost:0}]:attackOrigins(unit);
      const r=TacticalEngine.range(skill);
      return map.tiles.filter(tile=>{
        if(ctx.unitAt(tile.x,tile.y)||ctx.coreAt(tile.x,tile.y)||!EnvironmentEngine.isBurning(environmentState,tile.x,tile.y))return false;
        if(!units.some(observer=>observer.alive&&observer.team===unit.team&&canObserveFireSource(observer,tile,environmentState)))return false;
        return origins.some(origin=>{
          const d=Math.abs(origin.x-tile.x)+Math.abs(origin.y-tile.y);
          return d>=r.min&&d<=r.max&&canObserveFireSource(unit,tile,environmentState,origin);
        });
      });
    }
    function executeEnvironmentTargetSkill(unit,tile,skill){
      const {map,environmentState}=state();
      if(!ctx.canUseSkill(unit,skill)||!environmentTargetTiles(unit,skill).includes(tile))
        return skillFailure(unit,skill,"ENVIRONMENT_TARGET_INVALID",tile);
      const r=TacticalEngine.range(skill),originalFacing=unit.facing;
      let origin=null,path=[];
      for(const candidate of attackOrigins(unit)){
        const d=Math.abs(candidate.x-tile.x)+Math.abs(candidate.y-tile.y);
        if(d<r.min||d>r.max)continue;
        if(!canObserveFireSource(unit,tile,environmentState,candidate))continue;
        const route=candidate.x===unit.x&&candidate.y===unit.y?[]:
          TacticalEngine.pathTo(map,state().units,unit,candidate.x,candidate.y);
        unit.facing=originalFacing;
        if(route.length||candidate.x===unit.x&&candidate.y===unit.y){origin=candidate;path=route;break;}
      }
      if(!origin)return skillFailure(unit,skill,"NO_ATTACK_PATH",tile);
      if(path.length){
        if(!pendingMove||pendingMove.unitId!==unit.id)beginPendingMove(unit);
        const moved=ctx.traverseUnitPath(unit,path,{kind:"UNIT"});unit.moved=true;
        if(!moved.completed){commitPendingMove(unit);ctx.render();return false;}
      }
      // Recheck the actual landing position before spending a resource.
      if(!EnvironmentEngine.isBurning(environmentState,tile.x,tile.y)||
        !canObserveFireSource(unit,tile,environmentState))return skillFailure(unit,skill,"ENVIRONMENT_TARGET_CHANGED",tile);
      globalThis.EffectEngine?.breakStealth?.(unit,"ACTION");
      const cast=ctx.effectiveSkill(unit,skill);ctx.consumeSkill(unit,cast);
      const events=EnvironmentEngine.waterImpact(map,environmentState,tile.x,tile.y,{source:cast.id});
      events.forEach(ctx.logEnvironmentEvent);
      ctx.resolveEnvironmentEvents?.(events,{reason:`${cast.name} 水流接觸`});
      ctx.pushLog(`${unit.character.name} 使用 ${cast.name} 澆向燃燒格 (${tile.x},${tile.y})。`,"BATTLE");
      return finishActiveSkill(unit);
    }

    function beginPendingMove(unit){pendingMove={unitId:unit.id,x:unit.x,y:unit.y,z:unit.z,facing:unit.facing};}
    function commitPendingMove(unit){if(pendingMove?.unitId===unit?.id)pendingMove=null;}

    function approachTargetForAttack(unit,target,skill){
      const plan=attackPlanForTarget(unit,target,skill);
      if(!plan)return skillFailure(unit,skill,"NO_ATTACK_PATH",target);
      // Air transport plans its approach and placement as one confirmation.
      if(["CARRY_ALLY","CARRY_ENEMY"].includes(skill?.utilityAction?.type))return true;
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
      if(!unit?.alive||unit.acted||!target?.alive||!TacticalEngine.canTarget(map,unit,target,skill,environmentState))return skillFailure(unit,skill,"TARGET_OR_TURN_INVALID",target);
      if(target.kind!=="CORE")return skillFailure(unit,skill,"TARGET_NOT_CORE",target);
      globalThis.EffectEngine?.breakStealth?.(unit,"ACTION");
      skill=ctx.effectiveSkill(unit,skill);ctx.consumeSkill(unit,skill);
      TacticalEngine.faceToward(unit,target);
      globalThis.UnitAnimationEngine?.emitAction?.(unit,target,skill,{targetKind:"CORE"});
      const stat=skill.attackType==="MAGIC"?Number(unit.character.combat.matk||unit.character.combat.atk||0):Number(unit.character.combat.atk||0);
      const raw=Math.max(1,Math.round(stat*Number(skill.power||1)-Number(target.core.defense||30)));
      ctx.damageCore(target.core.owner,raw,`${unit.character.name}【${skill.name}】`);
      commitPendingMove(unit);
      unit.moved=true;unit.acted=true;unit.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();return true;
    }

    // LINE + moveToTarget is an instantaneous pass-through strike, not a
    // step-by-step move. Target selection and execution share one landing plan.
    // The strike remains inside its attack range; at most one additional cell
    // behind the last struck occupant may be used as the unoccupied landing.
    function lineTransitPlan(attacker,aim,skill){
      const {map}=state(),range=TacticalEngine.range(skill);
      const dx=Math.sign(aim.x-attacker.x),dy=Math.sign(aim.y-attacker.y);
      if((dx!==0&&dy!==0)||(!dx&&!dy))return null;
      const distance=Math.abs(aim.x-attacker.x)+Math.abs(aim.y-attacker.y);
      if(distance<range.min||distance>range.max)return null;
      const lastStep=ctx.unitAt(aim.x,aim.y)?range.max+1:distance;
      for(let step=distance;step<=lastStep;step++){
        const landing=TacticalEngine.tile(map,attacker.x+dx*step,attacker.y+dy*step);
        if(!landing||!ctx.canTraverseMoveLine(attacker,landing))return null;
        if(ctx.unitAt(landing.x,landing.y))continue;
        return{landing,affected:ctx.lineTiles(attacker,landing).slice(0,range.max)};
      }
      return null;
    }

    function mapTargetTiles(attacker,skill){
      const {map,units,environmentState}=state();
      const range=TacticalEngine.range(skill);
      const known=tile=>skill?.ignoreFogOfWar===true||skill?.requiresVision===false||
        TacticalEngine.teamCanSee(map,units,attacker.team,tile,environmentState);
      if(skill?.utilityAction?.type==="RELEASE_CARRIED")return [...transportReleasePlans(attacker).values()]
        .map(entry=>entry.destination).filter(known);
      if(MAP_TRANSIT_ACTIONS.has(skill?.utilityAction?.type))return map.tiles.filter(tile=>{
        if(!known(tile))return false;
        const d=Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);if(d<range.min||d>range.max)return false;
        if(ctx.unitAt(tile.x,tile.y))return false;
        if(!TacticalEngine.canOccupyTerrain(attacker,tile))return false;
        if(TacticalEngine.isBlockedByObject(map,tile.x,tile.y,attacker))return false;
        return skill.requiresVision===false||TacticalEngine.canSee(map,attacker,tile,environmentState);
      });
      return map.tiles.filter(tile=>{
        if(!known(tile))return false;
        const d=Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);
        if(d<range.min||d>range.max)return false;
        if(skill.shape==="LINE"){
          if(attacker.x!==tile.x&&attacker.y!==tile.y)return false;
          if(skill.moveToTarget&&!lineTransitPlan(attacker,tile,skill))return false;
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
      const {map,units}=state(),action=skill?.utilityAction;if(!action)return skillFailure(attacker,skill,"NO_UTILITY_ACTION",target);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
      if(action.type==="SET_VERTICAL_MODE"){
        const tile=TacticalEngine.tile(map,attacker.x,attacker.y),result=globalThis.VerticalMobilityEngine?.setMode?.(attacker,tile,action.mode,action.options||{});
        if(!result?.ok){ctx.pushLog(`${skill.name} 無法切換目前的垂直移動狀態。`,"SYSTEM");ctx.render();return false;}
        ctx.consumeSkill(attacker,skill);ctx.pushLog(`${attacker.character.name}｜${skill.name} → ${result.state.mode}。`,"SYSTEM");
        return action.consumeTurn===true?finishActiveSkill(attacker):finishFreeUtility(attacker);
      }
      if(action.type==="ENTER_STEALTH"){
        ctx.consumeSkill(attacker,skill);globalThis.EffectEngine?.applyStealth?.(attacker,{detectionRange:1,source:attacker});
        globalThis.EffectEngine?.resolveProximityReveal?.(attacker,units);
        ctx.pushLog(`${attacker.character.name} 犧牲本回合行動，再次進入潛行。`,"BATTLE");
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
      if(action.type==="SCHEDULE_TURN_SIMULATION"){
        if(!target?.character||target.team===attacker.team)return false;
        const effective=ctx.effectiveSkill(attacker,skill);
        const scheduled=ctx.scheduleTurnSimulation?.({source:attacker,targetTeam:target.team,skill:effective,action});
        if(!scheduled){ctx.pushLog(`${skill.name} 無法建立回合模擬。`,"SYSTEM");ctx.render();return false;}
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
        ctx.consumeSkill(attacker,skill);
        ctx.pushLog(`${attacker.character.name} 使用 ${skill.name}｜污染將在目標方下一個完整回合生效。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="CARRY_ALLY"||action.type==="CARRY_ENEMY"){
        if(pendingTransport)return false;
        const pickup=pickupPlan(attacker,target,skill);
        if(!pickup){ctx.pushLog(`${skill.name}：目標不在可接近的抓取位置，或重量超過搬運能力。`,"SYSTEM");ctx.render();return false;}
        const releaseSkill=SkillDatabase.get(action.releaseSkillId);
        if(!releaseSkill||releaseSkill.utilityAction?.type!=="RELEASE_CARRIED")return skillFailure(attacker,skill,"RELEASE_SKILL_MISSING",target);
        pendingTransport={carrier:attacker,passenger:target,pickup,pickupSkill:skill,
          origin:{x:target.x,y:target.y,z:target.z,verticalState:target.verticalState?JSON.parse(JSON.stringify(target.verticalState)):null},
          carrierVertical:attacker.verticalState?JSON.parse(JSON.stringify(attacker.verticalState)):null,
          releasePlans:null,committed:false};
        ctx.setSelectedSkill(releaseSkill);ctx.setSelectedSkillVariant(null);ctx.setMode("map-target");
        ctx.pushLog(`${attacker.character.name} 準備${action.type==="CARRY_ENEMY"?"抓起並摔落":"空運"} ${target.character.name}｜選定落點後才正式抓取與移動。`,"SYSTEM");ctx.render();return true;
      }
      return false;
    }

    function executeMapUtility(attacker,center,skill){
      const action=skill?.utilityAction,{map}=state();if(!action)return skillFailure(attacker,skill,"NO_MAP_UTILITY",center);
      if(action.type!=="RELEASE_CARRIED"&&!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      if(MAP_TRANSIT_ACTIONS.has(action.type)){
        const destination=TacticalEngine.tile(map,center.x,center.y);
        if(!destination||ctx.unitAt(center.x,center.y)||!TacticalEngine.canOccupyTerrain(attacker,destination)||TacticalEngine.isBlockedByObject(map,center.x,center.y,attacker)){ctx.pushLog(`${skill.name}：終點不是合法站立位置。`,"SYSTEM");ctx.render();return false;}
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");ctx.consumeSkill(attacker,skill);
        attacker.x=destination.x;attacker.y=destination.y;attacker.z=Number(globalThis.VerticalMobilityEngine?.surfaceZ?.(destination)??TacticalEngine.elevation(destination)??0);
        globalThis.VerticalMobilityEngine?.syncUnit?.(attacker,destination);ctx.enterTile(attacker);
        ctx.pushLog(`${attacker.character.name} 使用 ${skill.name}｜折疊空間至 (${destination.x},${destination.y})，中間地形與障礙不參與碰撞。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type!=="RELEASE_CARRIED"||!pendingTransport||pendingTransport.carrier?.id!==attacker?.id)return false;
      const pending=pendingTransport,passenger=pending.passenger;
      if(!ctx.canUseSkill(attacker,pending.pickupSkill))return skillFailure(attacker,pending.pickupSkill,"RESOURCE_OR_REQUIREMENT",passenger);
      const plan=transportReleasePlan(attacker,center);
      if(!plan){ctx.pushLog(`${skill.name}：落地位置或路線已失效，請重新選擇。`,"SYSTEM");ctx.render();return false;}
      if(plan.pickupPath.length){
        const moved=ctx.traverseUnitPath(attacker,plan.pickupPath,{kind:"UNIT"});attacker.moved=true;
        if(!moved.completed){pendingTransport=null;ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode(attacker.alive?"command":"inspect");ctx.pushLog(`${attacker.character.name} 接近隊友途中被環境阻斷，未消耗空運技能。`,"SYSTEM");ctx.render();return false;}
      }
      // Commit one skill action only after arrival beside a still-valid ally.
      if(!canPickupFrom(attacker,passenger,attacker,state().environmentState,pending.pickupSkill.utilityAction?.type==="CARRY_ENEMY"?"ENEMY":"ALLY")||!ctx.canUseSkill(attacker,pending.pickupSkill)){
        pendingTransport=null;ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("command");ctx.pushLog(`${attacker.character.name} 無法在目前位置抓起友軍。`,"SYSTEM");ctx.render();return false;
      }
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      ctx.consumeSkill(attacker,pending.pickupSkill);pending.committed=true;
      attacker.carryingUnitId=passenger.id;passenger.carriedByUnitId=attacker.id;
      passenger.transportHidden=true;passenger.x=-9999;passenger.y=-9999;passenger.z=attacker.z;
      if(plan.flightPath.length){
        const moved=ctx.traverseUnitPath(attacker,plan.flightPath,{kind:"UNIT"});
        if(!moved.completed){restorePendingTransport({silent:true});ctx.pushLog(`${attacker.character.name} 空運途中受環境影響中斷，友軍返回出發位置。`,"SYSTEM");return finishActiveSkill(attacker);}
      }
      const destination=TacticalEngine.tile(map,center.x,center.y);
      if(!destination||ctx.unitAt(center.x,center.y)||!TacticalEngine.canOccupyTerrain(passenger,destination)||
        TacticalEngine.isBlockedByObject(map,center.x,center.y,passenger)){
        restorePendingTransport({silent:true});ctx.pushLog(`${attacker.character.name} 的空運落點失效，友軍返回出發位置。`,"SYSTEM");return finishActiveSkill(attacker);
      }
      ctx.consumeSkill(attacker,skill);
      passenger.x=destination.x;passenger.y=destination.y;
      delete passenger.carriedByUnitId;delete passenger.transportHidden;delete attacker.carryingUnitId;
      if(skill.utilityAction?.mode==="DROP"){
        // The transport route is shared. Only its final release is hostile:
        // FallEngine is the sole authority for real elevation, equipment and
        // falling damage, including water/ice landing physics.
        const landing=globalThis.VerticalMobilityEngine?.describe?.(passenger,destination);
        const landingZ=Number(landing?.physicalZ??destination.elevation??0);
        const minDrop=Number(pending.pickupSkill.utilityAction?.minDrop??0);
        const fromZ=Math.max(Number(attacker.z||0),landingZ+minDrop,landingZ+FallEngine.FALL_THRESHOLD+1);
        const fall=FallEngine.resolveLanding({map,target:passenger,fromZ,
          applyDamage:(unit,damage)=>ctx.damageUnitFlat(unit,damage,pending.pickupSkill.name)});
        ctx.pushLog(`${attacker.character.name} 將 ${passenger.character.name} 空運摔落至 (${destination.x},${destination.y})｜墜落 ${fall.drop}｜傷害 ${fall.damage}。`,"BATTLE");
      }else{
        if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(passenger,destination);
        else passenger.z=Number(destination.elevation||0);
        ctx.pushLog(`${attacker.character.name} 將 ${passenger.character.name} 安全空運至 (${destination.x},${destination.y})｜無墜落傷害。`,"BATTLE");
      }
      if(passenger.alive)ctx.enterTile(passenger);
      pendingTransport=null;
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
      const transit=skill.shape==="LINE"&&skill.moveToTarget?lineTransitPlan(attacker,center,skill):null;
      if(skill.shape==="LINE"&&skill.moveToTarget&&!transit)return skillFailure(attacker,skill,"NO_LEGAL_LINE_LANDING",center);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      skill=ctx.effectiveSkill(attacker,skill);ctx.consumeSkill(attacker,skill);
      TacticalEngine.faceToward(attacker,center);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"MAP"});
      if(skill.trapPlacement&&environmentState&&globalThis.EnvironmentEngine?.createTrap){
        const trap=EnvironmentEngine.createTrap(environmentState,center.x,center.y,{...skill.trapPlacement,sourceTeam:attacker.team,sourceUnitId:attacker.id});
        ctx.pushLog(`${attacker.character.name} 在 (${center.x},${center.y}) 設置「${trap?.name||skill.name}」。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      const affected=transit?transit.affected:skill.shape==="LINE"?ctx.lineTiles(attacker,center):ctx.aoeTiles(center,skill.radius||0);
      if(skill.shape==="LINE"){
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);
          if(!occupant||occupant.team===attacker.team)return;
          const distance=Math.abs(attacker.x-occupant.x)+Math.abs(attacker.y-occupant.y);
          const result=BattleEngine.calculate(attacker.character,occupant.character,skill,{distance});
          if(!result.hit){ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");return;}
          const hallucinationHit=occupant.hallucination===true&&result.hit,shield=hallucinationHit?{damage:Math.max(1,Number(occupant.hp||1)),absorbed:0}:globalThis.EffectEngine?.resolveIncomingDamage?EffectEngine.resolveIncomingDamage(occupant,result.damage):{damage:result.damage,absorbed:0};
          occupant.hp=Math.max(0,occupant.hp-shield.damage);
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} ${shield.damage} 傷害${shield.absorbed?`｜護盾吸收 ${shield.absorbed}`:""}｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
          else if(Number(shield.damage||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(occupant,{sourceId:attacker.id,skillId:skill.id,damage:Number(shield.damage||0)});
        });
      }
      if(skill.areaDamage?.mode==="MAGIC_POWER"){
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);if(!occupant?.alive)return;
          const relation=String(skill.areaDamage.relation||"ENEMY").toUpperCase();if(relation==="ENEMY"&&occupant.team===attacker.team)return;if(relation==="ALLY"&&occupant.team!==attacker.team)return;
          const atCenter=tile.x===center.x&&tile.y===center.y,mult=atCenter?Math.max(0,Number(skill.areaDamage.centerMultiplier||1)):1;
          const attackSkill={...skill,power:Number(skill.power||0)*mult,target:"ENEMY",targetType:"SINGLE"},distance=Math.abs(attacker.x-occupant.x)+Math.abs(attacker.y-occupant.y);
          const result=BattleEngine.calculate(attacker.character,occupant.character,attackSkill,{distance});if(!result.hit){ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");return;}
          const hallucinationHit=occupant.hallucination===true&&result.hit,shield=hallucinationHit?{damage:Math.max(1,Number(occupant.hp||1)),absorbed:0}:globalThis.EffectEngine?.resolveIncomingDamage?EffectEngine.resolveIncomingDamage(occupant,result.damage):{damage:result.damage,absorbed:0};occupant.hp=Math.max(0,occupant.hp-shield.damage);
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name}${atCenter?"・中心":""} ${shield.damage} 傷害${shield.absorbed?`｜護盾吸收 ${shield.absorbed}`:""}｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}else if(Number(shield.damage||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(occupant,{sourceId:attacker.id,skillId:skill.id,damage:Number(shield.damage||0)});
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
        const clusterKeys=EnvironmentEngine.largeFireKeys(environmentState);
        const floodEvents=HydrologyEngine.floodArea(map,affected,{surfaceRise:Number(skill.hydrologyFlood.surfaceRise||1),source:skill.id,
          intercept:(tile,volume,events)=>EnvironmentEngine.exchangeWaterFire(map,environmentState,tile,volume,events,{source:skill.id,clusterKeys})});
        EnvironmentEngine.resolveStandingWaterFire(map,environmentState,floodEvents,{source:skill.id});
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
      if(transit){
        // Flash across struck units without occupying their tiles even briefly.
        // Only the destination triggers an ENTER_TILE interaction.
        const landing=transit.landing;
        if(!ctx.unitAt(landing.x,landing.y)){
          TacticalEngine.faceToward(attacker,landing);
          attacker.x=landing.x;attacker.y=landing.y;
          if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(attacker,landing);
          else attacker.z=Number(TacticalEngine.elevation(landing)||0);
          ctx.enterTile(attacker);
          ctx.pushLog(`${attacker.character.name} 隨 ${skill.name} 穿越敵陣，瞬閃至 (${attacker.x},${attacker.y})。`,"BATTLE");
        }
      }else if(skill.moveToTarget&&!ctx.unitAt(center.x,center.y)){
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
      if(!window.EffectEngine)return skillFailure(attacker,skill,"EFFECT_ENGINE_UNAVAILABLE",target);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      skill=ctx.effectiveSkill(attacker,skill);ctx.consumeSkill(attacker,skill);
      TacticalEngine.faceToward(attacker,target);
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
            if(result.hit){const shield=target.hallucination===true?{damage:Math.max(1,Number(target.hp||1)),absorbed:0}:EffectEngine.resolveIncomingDamage(target,result.damage);dealt=shield.damage;absorbed=shield.absorbed;target.hp=Math.max(0,target.hp-dealt);if(target.hp===0)target.alive=false;}
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
      if(!ctx.canUseSkill(attacker,skill)){skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",defender);return;}
      if(skill.approach&&!approachForSkill(attacker,defender,skill)){
        skillFailure(attacker,skill,"NO_APPROACH_PATH",defender);ctx.pushLog(`${skill.name} 無合法衝鋒路徑。`,"SYSTEM");ctx.render();return;
      }
      if(skill.utilityAction){executeUtilitySkill(attacker,defender,skill);return;}
      if(skill.effects||skill.relationEffects||skill.bloodAction){executeEffectSkill(attacker,defender,skill);return;}
      skill=ctx.effectiveSkill(attacker,skill);
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      if(ctx.targetType(skill)!=="SINGLE"){executeEngagement(attacker,defender,skill,[]);return;}
      const candidates=BattleResolution.supportCandidates({units,initiator:attacker,target:defender,canUseSkill:ctx.canUseSkill}).map(candidate=>({...candidate,skills:candidate.skills.filter(supportSkill=>TacticalEngine.canTarget(map,candidate.ally,defender,supportSkill,state().environmentState))})).filter(candidate=>candidate.skills.length);
      // When no ally can support, resolve the selected single-target attack
      // immediately. The support-confirmation flow only has work when there
      // are actual support candidates; otherwise it appears to do nothing.
      if(!candidates.length){executeEngagement(attacker,defender,skill,[]);return;}
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
        {canUseSkill:ctx.canUseSkill,consumeSkill:ctx.consumeSkill,onDefeated:ctx.handleDefeated,
          onAction:ctx.logBattleAction,onPostEffect:ctx.logPostEffect}
      );
      if(!engagement.results.length){skillFailure(attacker,skill,"RESOLUTION_EMPTY",defender);ctx.clearEngagement();ctx.setMode("command");ctx.render();return;}
      commitPendingMove(attacker);
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.clearEngagement();ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
    }

    function reset(){pendingMove=null;pendingTransport=null;}

    return Object.freeze({
      reset,pendingMove:()=>pendingMove,
      attackPlanForTarget,targetableEntities,targetRangeTiles,environmentTargetTiles,executeEnvironmentTargetSkill,approachTargetForAttack,resolveDirectTargetAttack,
      mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,
      backFromTargeting,finishActiveSkill,executeEffectSkill,approachForSkill,prepareAttack,
      selectedSupportActions,confirmEngagement,executeEngagement
    });
  }

  window.TacticalActionController=Object.freeze({create});
})();
