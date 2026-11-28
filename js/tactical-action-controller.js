import {attackWeaponFor} from './equipment-database.js';
import {AreaSpellMechanics} from "./area-spell-mechanics.js";
(()=>{
  "use strict";

  // Shared by the original local controller and the authenticated PvP command host.
  // This is the same movement-undo rule, not a second network movement engine.
  function restorePendingMove(unit,origin,{units=null,map=null}={}){
    if(!unit||!origin||origin.unitId!==unit.id||unit.acted||!unit.moved)return false;
    globalThis.BattleEnvironmentController?.rollbackAlchemyHarvest?.(unit,map);
    unit.x=origin.x;unit.y=origin.y;unit.z=origin.z;
    if(origin.facing)unit.facing=origin.facing;
    unit.moved=false;
    // Rewind the entire shield-borne party, not only the carrier's grid tile.
    if(unit.shieldPassengerId&&Array.isArray(units)){
      const rider=units.find(u=>u.id===unit.shieldPassengerId);
      if(rider&&rider.shieldRidingOn===unit.id){
        globalThis.ColinShieldMobilityEngine?.syncPassenger?.(units,unit);
        if(origin.passengerId===rider.id){
          rider.moved=!!origin.passengerMoved;
          rider.shieldRideMoved=!!origin.passengerRideMoved;
        }
      }
    }
    if(globalThis.ColinShieldMobilityEngine?.hasShield?.(unit)&&map)
      unit.shieldMobilityMode=ColinShieldMobilityEngine.modeAt(unit,
        globalThis.TacticalEngine?.tile?.(map,unit.x,unit.y));
    return true;
  }

  function create(ctx){
    let pendingMove=null,pendingTransport=null,pendingEnchantment=null,enchantmentFollowup=null;
    const MAP_TRANSIT_ACTIONS=new Set(["TELEPORT_TO_TILE","WORMHOLE_TRANSIT"]);

    function state(){return ctx.actionState();}
    // Authoritative active-action gate. UI target previews are never a substitute
    // for checking the live actor again at the actual combat commit entry.
    function canCommitActiveAction(unit){return !!unit?.alive&&unit.acted!==true&&unit.waited!==true;}

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
      globalThis.CardTacticsDiagnostics?.gameAction?.("SKILL_FAILURE",{
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
      commitPendingMove(attacker);
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

    function bloodShadowLanding(unit,target){
      const {map,units,environmentState}=state();
      if(!unit?.alive||!target?.alive||unit.team===target.team)return null;
      if(!TacticalEngine.teamCanSee(map,units,unit.team,target,environmentState))return null;
      const back={N:{x:0,y:1},S:{x:0,y:-1},E:{x:-1,y:0},W:{x:1,y:0}}[TacticalEngine.ensureFacing(target)];
      if(!back)return null;
      const tile=TacticalEngine.tile(map,target.x+back.x,target.y+back.y);
      if(!tile||!TacticalEngine.canOccupyTerrain(unit,tile)||TacticalEngine.isBlockedByObject(map,tile.x,tile.y,unit))return null;
      if(units.some(other=>other.id!==unit.id&&other.alive&&other.occupiesTile!==false&&other.x===tile.x&&other.y===tile.y))return null;
      const dist=Math.abs(unit.x-tile.x)+Math.abs(unit.y-tile.y);
      if(dist>Number(unit.character.combat?.move||0))return null;
      return tile;
    }
    function attackPlanForTarget(unit,target,skill){
      const {map,units,environmentState}=state();
      if(!unit?.alive||unit.acted||!target?.alive||!skill)return null;
      if(skill.bloodShadow)return bloodShadowLanding(unit,target)?{x:unit.x,y:unit.y,cost:0,path:[]}:null;
      if(["CARRY_ALLY","CARRY_ENEMY"].includes(skill.utilityAction?.type))return pickupPlan(unit,target,skill);
      if(skill.approach)return TacticalEngine.canTarget(map,unit,target,skill,environmentState)&&
        planApproachForSkill(unit,target,skill)?{x:unit.x,y:unit.y,cost:0,path:[]}:null;

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
        if(skill?.utilityAction?.type==="STEAL_LOOT"&&!globalThis.RewardEngine?.stealable?.(unit,target))return false;
        if(skill?.utilityAction?.type==="SWAP_ALLIES")return TacticalEngine.canSwapAllies(map,state().units,unit,target);
        if(["CARRY_ALLY","CARRY_ENEMY"].includes(skill?.utilityAction?.type))return !!pickupPlan(unit,target,skill,origins);
        
        if(skill?.bloodShadow)return !!bloodShadowLanding(unit,target);
        if(skill?.approach&&!planApproachForSkill(unit,target,skill))return false;
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
      const observer={...unit,x:origin.x,y:origin.y};
      return TacticalEngine.canObserveFireSource(map,observer,tile,environmentState);
    }
    function environmentTargetTiles(unit,skill){
      if(!unit?.alive||unit.acted)return[];
      if(skill?.environmentTarget==='TREE'){
        const {map,units,environmentState}=state(),range=TacticalEngine.range(skill);
        return map.tiles.filter(tile=>{
          const tree=(globalThis.EnvironmentObjectEngine?.activeObjectsAt?.(map,tile.x,tile.y)||[])
            .some(o=>['TREE','DEAD_TREE'].includes(String(o.type||'').toUpperCase()));
          if(!tree||ctx.unitAt(tile.x,tile.y))return false;
          const distance=Math.abs(tile.x-unit.x)+Math.abs(tile.y-unit.y);
          if(distance<range.min||distance>range.max)return false;
          return TacticalEngine.teamCanSee(map,units,unit.team,tile,environmentState)&&
            TacticalEngine.hasLineOfSight(map,unit,tile,skill,environmentState);
        });
      }
      if(skill?.environmentTarget!=="BURNING"||skill?.waterContact!=="RAIN_EVENT")return[];
      const {map,units,environmentState}=state();
      const origins=skill.approach?[{x:unit.x,y:unit.y,cost:0}]:attackOrigins(unit);
      const r=TacticalEngine.range(skill);
      return map.tiles.filter(tile=>{
        if(ctx.coreAt(tile.x,tile.y)||!EnvironmentEngine.isBurning(environmentState,tile.x,tile.y))return false;
        if(!units.some(observer=>observer.alive&&observer.team===unit.team&&canObserveFireSource(observer,tile,environmentState)))return false;
        return origins.some(origin=>{
          const d=Math.abs(origin.x-tile.x)+Math.abs(origin.y-tile.y);
          return d>=r.min&&d<=r.max&&canObserveFireSource(unit,tile,environmentState,origin)&&
            TacticalEngine.hasLineOfSight(map,{...unit,x:origin.x,y:origin.y},tile,{...skill,ignoreVision:true},environmentState);
        });
      });
    }
    function executeEnvironmentTargetSkill(unit,tile,skill){
      const {map,environmentState}=state();
      if(!ctx.canUseSkill(unit,skill)||!environmentTargetTiles(unit,skill).includes(tile))
        return skillFailure(unit,skill,"ENVIRONMENT_TARGET_INVALID",tile);
      if(skill.environmentTarget==='TREE'){
        const objects=globalThis.EnvironmentObjectEngine?.activeObjectsAt?.(map,tile.x,tile.y)||[];
        const tree=objects.find(o=>['TREE','DEAD_TREE'].includes(String(o.type||'').toUpperCase()));
        if(!tree)return skillFailure(unit,skill,'TREE_MISSING',tile);
        const cast=ctx.effectiveSkill(unit,skill);
        if(!ctx.consumeSkill(unit,cast))return skillFailure(unit,skill,'RESOURCE_OR_REQUIREMENT',tile);
        globalThis.EffectEngine?.breakStealth?.(unit,'ACTION');
        const events=[];
        const log=globalThis.EnvironmentObjectEngine.fellTree(map,tree,{events,reason:'MAGDA_GREAT_SWORD'});
        if(log){
          map.plantObservationRevision=Number(map.plantObservationRevision||0)+1;
          UnitRuntimeEngine.syncForestSouls(map,state().units,state().round);
          globalThis.UnitAnimationEngine?.emitAction?.(unit,tile,cast,{targetKind:'MAP'});
          events.forEach(ctx.logEnvironmentEvent);
          ctx.pushLog(`${unit.character.name} 以 ${skill.name} 砍倒 (${tile.x},${tile.y}) 的樹木。`,'BATTLE');
        }
        return finishActiveSkill(unit);
      }
      const r=TacticalEngine.range(skill),originalFacing=unit.facing;
      let origin=null,path=[];
      for(const candidate of attackOrigins(unit)){
        const d=Math.abs(candidate.x-tile.x)+Math.abs(candidate.y-tile.y);
        if(d<r.min||d>r.max)continue;
        if(!canObserveFireSource(unit,tile,environmentState,candidate)||
          !TacticalEngine.hasLineOfSight(map,{...unit,x:candidate.x,y:candidate.y},tile,{...skill,ignoreVision:true},environmentState))continue;
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
      const distance=Math.abs(unit.x-tile.x)+Math.abs(unit.y-tile.y);
      if(!unit.alive||distance<r.min||distance>r.max||ctx.coreAt(tile.x,tile.y)||
        !canObserveFireSource(unit,tile,environmentState)||
        !TacticalEngine.hasLineOfSight(map,unit,tile,{...skill,ignoreVision:true},environmentState))return skillFailure(unit,skill,"ENVIRONMENT_TARGET_CHANGED",tile);
      const cast=ctx.effectiveSkill(unit,skill);
      if(!ctx.consumeSkill(unit,cast))return skillFailure(unit,skill,"RESOURCE_OR_REQUIREMENT",tile);
      globalThis.EffectEngine?.breakStealth?.(unit,"ACTION");
      EffectEngine.interruptChannel(unit,"ACTION");
      TacticalEngine.faceToward(unit,tile);
      globalThis.UnitAnimationEngine?.emitAction?.(unit,tile,cast,{targetKind:"MAP"});
      const events=EnvironmentEngine.waterImpact(map,environmentState,tile.x,tile.y,{source:cast.id});
      events.forEach(ctx.logEnvironmentEvent);
      ctx.resolveEnvironmentEvents?.(events,{reason:`${cast.name} 水流接觸`});
      ctx.pushLog(`${unit.character.name} 使用 ${cast.name} 澆向燃燒格 (${tile.x},${tile.y})。`,"BATTLE");
      return finishActiveSkill(unit);
    }

    function beginPendingMove(unit){
      if(unit?.character?.alchemyHarvest===true&&unit._alchemyHarvestUndo==null)unit._alchemyHarvestUndo=[];
      const rider=state().units.find(u=>u.id===unit.shieldPassengerId);
      pendingMove={unitId:unit.id,x:unit.x,y:unit.y,z:unit.z,facing:unit.facing,
        passengerId:rider?.id||null,passengerMoved:!!rider?.moved,
        passengerRideMoved:!!rider?.shieldRideMoved};
    }
    function commitPendingMove(unit){
      if(pendingMove?.unitId===unit?.id){
        globalThis.BattleEnvironmentController?.commitAlchemyHarvest?.(unit);
        pendingMove=null;
      }
    }

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

    function coreAttackDamage(unit,target,skill,enchantment=null){
      const stat=String(skill.offenseStat||"").toUpperCase()==="ATK"?Number(unit.character.combat.atk||0):skill.attackType==="MAGIC"?Number(unit.character.combat.matk||unit.character.combat.atk||0):Number(unit.character.combat.atk||0);
      const raw=Math.max(1,Math.round(stat*Number(skill.power||1)-(skill.pureHoly?0:Number(target.core.defense||30))));
      // Core uses its existing single defense field (it has no armor element,
      // MDEF, parry or shield). Do not route it through a fake unit battle.
      const bonus=enchantment?Math.max(1,Math.round(enchantment.matkSnapshot*enchantment.bonusPower-Number(target.core.defense||30))):0;
      const inherent=skill.skipInherentMagic?null:attackWeaponFor(unit,skill)?.inherentMagic;
      const inherentBonus=inherent?Math.max(1,Math.round(Number(unit.character.combat.matk||0)*Number(inherent.powerFromSkill?skill.power:inherent.power||0)-(inherent.unresistable?0:Number(target.core.defense||30)))):0;
      return raw+bonus+inherentBonus;
    }
    function previewCoreAttack(unit,target,skill){
      if(!target?.core||!unit?.alive)return 0;
      const effective=ctx.effectiveSkill(unit,skill);
      return coreAttackDamage(unit,target,effective,globalThis.EffectEngine?.weaponEnchantment?.(unit,effective.weapon)||null);
    }
    function resolveDirectTargetAttack(unit,target,skill){
      const {map,environmentState}=state();
      if(!unit?.alive||unit.acted||!target?.alive||!TacticalEngine.canTarget(map,unit,target,skill,environmentState))return skillFailure(unit,skill,"TARGET_OR_TURN_INVALID",target);
      if(target.kind!=="CORE")return skillFailure(unit,skill,"TARGET_NOT_CORE",target);
      globalThis.EffectEngine?.breakStealth?.(unit,"ACTION");
      EffectEngine.interruptChannel(unit,"CORE_ATTACK");
      skill=ctx.effectiveSkill(unit,skill);
      UnitRuntimeEngine.beginBloodTransaction(unit);
      if(!ctx.consumeSkill(unit,skill)){UnitRuntimeEngine.endBloodTransaction(unit);return false;}
      const bloodMult=UnitRuntimeEngine.attackEnhancement(unit,skill);
      TacticalEngine.faceToward(unit,target);
      globalThis.UnitAnimationEngine?.emitAction?.(unit,target,skill,{targetKind:"CORE",projectileKind:attackWeaponFor(unit,skill)?.weaponKind||null});
      const enchantment=globalThis.EffectEngine?.consumeWeaponEnchantment?.(unit,skill.weapon)||null;
      const damage=coreAttackDamage(unit,target,skill,enchantment);
      const coreHpBefore=Math.max(0,Number(target.core?.hp||0));
      ctx.damageCore(target.core.owner,Math.round(damage*bloodMult),`${unit.character.name}【${skill.name}】`);
      const coreDamage=Math.max(0,coreHpBefore-Number(target.core?.hp||0));
      if(coreDamage>0&&Number(skill.holyPowerOnHit||0)>0)UnitRuntimeEngine.changeHolyPower(unit,skill.holyPowerOnHit);
      // Core damage uses the canonical Core reducer, not BattleResolution's
      // unit-target hit loop. Credit the same approved HIT-triggered Astral
      // generator once when the spell actually damages the opposing Core.
      if(coreDamage>0&&skill.astralGainTrigger==='HIT'){
        const credited=UnitRuntimeEngine.gainAstralPower(unit,skill,environmentState);
        if(credited>0){
          globalThis.UnitAnimationEngine?.emitPresentation?.('RESOURCE_GAINED',{
            unitId:unit.id,resource:'astralPower',amount:credited,x:unit.x,y:unit.y});
          const stored=UnitRuntimeEngine.resourceSnapshot(unit).astralPower;
          ctx.pushLog(`${unit.character.name}｜${skill.name} 命中據點，星能 +${credited}｜${stored?.value??0}/${stored?.max??'?'}`, 'BATTLE');
        }
      }
      if(UnitRuntimeEngine.bloodUser(unit))UnitRuntimeEngine.changeBlood(unit,coreDamage);
      UnitRuntimeEngine.endBloodTransaction(unit);
      if(enchantment)resolveEnchantmentImpact({actor:unit,skill,enchantment,target,result:{hit:true}});
      commitPendingMove(unit);
      unit.moved=true;unit.acted=true;unit.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();return true;
    }

    // LINE + moveToTarget is an instantaneous pass-through strike, not a
    // step-by-step move. Target selection and execution share one landing plan.
    // The strike remains inside its attack range; at most one additional cell
    // behind the last struck occupant may be used as the unoccupied landing.
    function lineTransitPlan(attacker,aim,skill,occupantAt=ctx.unitAt){
      const {map}=state(),range=TacticalEngine.range(skill);
      const dx=Math.sign(aim.x-attacker.x),dy=Math.sign(aim.y-attacker.y);
      if((dx!==0&&dy!==0)||(!dx&&!dy))return null;
      const distance=Math.abs(aim.x-attacker.x)+Math.abs(aim.y-attacker.y);
      if(distance<range.min||distance>range.max)return null;
      const lastStep=occupantAt(aim.x,aim.y)?range.max+1:distance;
      for(let step=distance;step<=lastStep;step++){
        const landing=TacticalEngine.tile(map,attacker.x+dx*step,attacker.y+dy*step);
        if(!landing||!ctx.canTraverseMoveLine(attacker,landing))return null;
        if(occupantAt(landing.x,landing.y))continue;
        return{landing,affected:ctx.lineTiles(attacker,landing).slice(0,range.max)};
      }
      return null;
    }

    // A weapon-enchanted attack can deliberately target the terrain without
    // fabricating a missed unit projectile's collision point.
    function enchantedTerrainTargetTiles(attacker,skill){
      const enchant=globalThis.EffectEngine?.weaponEnchantment?.(attacker,skill?.weapon);
      if(!attacker?.alive||attacker.acted||!enchant||!skill?.weapon||skill.utilityAction||skill.target!=="ENEMY")return[];
      const {map,units,environmentState}=state(),range=TacticalEngine.range(skill);
      if(!map||!range)return[];
      return map.tiles.filter(tile=>{
        const distance=Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);
        if(distance<range.min||distance>range.max)return false;
        if(!TacticalEngine.teamCanSee(map,units,attacker.team,tile,environmentState)||
           !TacticalEngine.hasLineOfSight(map,attacker,tile,skill,environmentState))return false;
        return enchant.element!=="THUNDER"||EnvironmentEngine.isConductive(map,environmentState,tile.x,tile.y);
      });
    }
    function executeEnchantedTerrainAttack(attacker,center,skill){
      if(!skill?.terrainTargeting||!ctx.canUseSkill(attacker,skill)||
         !enchantedTerrainTargetTiles(attacker,skill).includes(center))
        return skillFailure(attacker,skill,"ENCHANT_TERRAIN_TARGET_INVALID",center);
      const enchant=globalThis.EffectEngine?.weaponEnchantment?.(attacker,skill.weapon);
      if(!enchant)return skillFailure(attacker,skill,"ENCHANT_NOT_ACTIVE",center);
      const attack=ctx.effectiveSkill(attacker,skill);
      if(!ctx.consumeSkill(attacker,attack))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      EffectEngine.interruptChannel(attacker,"TERRAIN_ATTACK");
      TacticalEngine.faceToward(attacker,center);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,attack,{targetKind:"MAP",projectileKind:attackWeaponFor(attacker,attack)?.weaponKind||null});
      const consumed=EffectEngine.consumeWeaponEnchantment(attacker,skill.weapon);
      resolveEnchantmentImpact({actor:attacker,skill:attack,enchantment:consumed,
        target:center,terrainImpact:true,result:{hit:true}});
      ctx.pushLog(`${attacker.character.name} 使用 ${skill.name}，以附魔武器擊向地格 (${center.x},${center.y})。`,"BATTLE");
      return finishActiveSkill(attacker);
    }
    function rangerCommandRadius(commander){
      return Math.max(0,...SkillDatabase.passiveList(commander?.character?.passives||[])
        .map(p=>Number(p.commandRadius||0)).filter(Number.isFinite));
    }
    function rangerDistance(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}
    function rangerFormationMembers(commander){
      const {units}=state(),radius=rangerCommandRadius(commander);
      if(!commander?.alive||radius<1)return[];
      return units.filter(u=>u.alive&&u.team===commander.team&&u.participatesInTurn!==false&&
        !u.moved&&!u.acted&&!u.waited&&rangerDistance(u,commander)<=radius);
    }
    function rangerMarchTraits(commander){
      // Only natural ground mobility is shared. Flight, diving and arbitrary
      // physical traits cannot be transferred by a forest-march command.
      return TacticalEngine.terrainTraits(commander).filter(t=>
        t==="FOREST_WALK"||t==="MOUNTAIN_WALK");
    }
    function rangerMarchProxy(member,commander){
      const move=Math.max(Number(member.character.combat.move||0),
        Number(commander.character.combat.move||0));
      const traits=[...new Set([...(member.character.terrainTraits||[]),...rangerMarchTraits(commander)])];
      return {...member,character:{...member.character,
        combat:{...member.character.combat,move},terrainTraits:traits}};
    }
    function rangerFormationReach(commander){
      const {map,units}=state(),members=rangerFormationMembers(commander);
      if(!members.some(u=>u.id===commander.id))return null;
      const moving=new Set(members.map(u=>u.id)),blockers=units.filter(u=>!moving.has(u.id));
      const reach=new Map();
      for(const member of members)
        reach.set(member.id,TacticalEngine.reachable(map,blockers,rangerMarchProxy(member,commander)));
      return {members,blockers,reach};
    }
    function rangerFormationLegalTiles(commander,skill){
      const {map,units,environmentState}=state(),formation=rangerFormationReach(commander);
      if(!formation)return[];
      const own=formation.reach.get(commander.id),min=Number(skill.range?.min||0),
        max=Number(skill.range?.max||0);
      const result=[];
      for(const [key] of own){
        const [x,y]=key.split(',').map(Number),destination=TacticalEngine.tile(map,x,y);
        if(!destination)continue;
        const delta={x:x-commander.x,y:y-commander.y};
        const distance=Math.abs(delta.x)+Math.abs(delta.y);
        if(distance<min||distance>max)continue;
        let valid=true;
        for(const member of formation.members){
          const tx=member.x+delta.x,ty=member.y+delta.y;
          if(!formation.reach.get(member.id).has(`${tx},${ty}`)){valid=false;break;}
        }
        if(valid)result.push(destination);
      }
      return result;
    }
    function rangerFormationPlan(commander,center,skill){
      const {map,units}=state(),formation=rangerFormationReach(commander);
      if(!formation||!TacticalEngine.tile(map,center.x,center.y))return null;
      const delta={x:center.x-commander.x,y:center.y-commander.y},
        distance=Math.abs(delta.x)+Math.abs(delta.y);
      if(distance<Number(skill.range?.min||0)||distance>Number(skill.range?.max||0))return null;
      const plans=[];
      for(const member of formation.members){
        const x=member.x+delta.x,y=member.y+delta.y;
        if(!formation.reach.get(member.id).has(`${x},${y}`))return null;
        const path=TacticalEngine.pathTo(map,formation.blockers,rangerMarchProxy(member,commander),x,y);
        if(!path.length)return null;
        plans.push({member,path});
      }
      // Forward-most units travel first so their original tiles are vacated
      // when the next squad member enters them; all animations are published
      // to the renderer from the same committed state revision.
      plans.sort((a,b)=>((b.member.x*delta.x+b.member.y*delta.y)-
        (a.member.x*delta.x+a.member.y*delta.y)));
      return {plans,delta};
    }
    function executeRangerMarch(commander,center,skill){
      if(!ctx.canUseSkill(commander,skill)||commander.moved||commander.acted)return false;
      const planned=rangerFormationPlan(commander,center,skill);
      if(!planned){ctx.pushLog(`${skill.name}：有人無法合法跟上，整支部隊未移動。`,"SYSTEM");ctx.render();return false;}
      if(!ctx.consumeSkill(commander,skill))return skillFailure(commander,skill,"RESOURCE_OR_REQUIREMENT",center);
      EffectEngine.breakStealth(commander,"ACTION");EffectEngine.interruptChannel(commander,"ACTION");
      globalThis.UnitAnimationEngine?.emitAction?.(commander,center,skill,{targetKind:"MAP"});
      const temporaryId=`RANGER_FORMATION_MOVE:${commander.id}`,traits=rangerMarchTraits(commander);
      for(const {member} of planned.plans){
        const delta=Math.max(0,Number(commander.character.combat.move||0)-Number(member.character.combat.move||0));
        EffectEngine.addEffect(member,{type:"BUFF",id:temporaryId,name:"急行軍・移動適性",classification:"POSITIVE",
          terrainTraits:traits,modifiers:{move:delta}},commander);
      }
      try{
        for(const {member,path} of planned.plans){
          if(!member.alive)continue;
          const travel=ctx.traverseUnitPath(member,path,{kind:"UNIT"});
          member.moved=true;
          if(!travel?.completed)ctx.pushLog(`${member.character.name} 急行軍途中受到環境事件中斷。`,"BATTLE");
        }
      }finally{
        for(const {member} of planned.plans)EffectEngine.removeEffectById(member,temporaryId);
      }
      // This consumes the whole squad's MOVE, not its ATTACK. Reina remains
      // selectable for a subsequent normal attack; a second march is illegal.
      commander.moved=true;commander.acted=false;commander.waited=false;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("command");
      ctx.pushLog(`${commander.character.name} 發動急行軍，${planned.plans.length} 名隊員移動並保留未使用的攻擊。`,"BATTLE");
      ctx.render();return true;
    }
    function rangerBowParticipants(commander){
      const {units}=state(),radius=rangerCommandRadius(commander);
      return (units||[]).filter(u=>u.alive&&u.team===commander.team&&u.participatesInTurn!==false&&
        !u.acted&&!u.waited&&rangerDistance(u,commander)<=radius)
        .map(u=>({unit:u,bow:Object.entries(u.character?.weapons||[]).find(([,weapon])=>
          String(weapon?.weaponKind||"").toUpperCase()==="BOW")}))
        .filter(entry=>!!entry.bow).map(entry=>({unit:entry.unit,slot:entry.bow[0],weapon:entry.bow[1]}));
    }
    function executeRangerVolley(commander,center,skill){
      const {map,units,environmentState}=state();
      if(!ctx.canUseSkill(commander,skill)||!mapTargetTiles(commander,skill)
        .some(tile=>tile.x===center.x&&tile.y===center.y))return false;
      const archers=rangerBowParticipants(commander);
      if(!archers.some(item=>item.unit.id===commander.id))return false;
      if(!ctx.consumeSkill(commander,skill))return skillFailure(commander,skill,"RESOURCE_OR_REQUIREMENT",center);
      EffectEngine.breakStealth(commander,"ACTION");EffectEngine.interruptChannel(commander,"ACTION");
      TacticalEngine.faceToward(commander,center);
      globalThis.UnitAnimationEngine?.emitAction?.(commander,center,skill,{
        targetKind:"MAP",projectileKind:attackWeaponFor(commander,skill)?.weaponKind||null,
        projectileSources:archers.map(item=>item.unit.id)});
      // All participants spend exactly one arrow attack and one enchantment.
      const contributors=archers.map(({unit,slot,weapon})=>({unit,slot,weapon,
        enchant:EffectEngine.consumeWeaponEnchantment(unit,slot)}));
      const count=contributors.length;
      // Every archer adds its own effective ATK. Square-root normalization
      // keeps one AOE from scaling linearly to the entire squad's damage.
      const pooledAtk=contributors.reduce((sum,{unit})=>sum+Number(unit.character.combat.atk||0),0)/Math.sqrt(count);
      const virtual={...commander,character:{...commander.character,
        combat:{...commander.character.combat,atk:pooledAtk}}};
      const impacted=ctx.aoeTiles(center,Number(skill.radius||0));
      const hits=[],thunderImpacts=[];
      for(const tile of impacted){
        const target=ctx.unitAt(tile.x,tile.y);
        if(!target?.alive||target.team===commander.team)continue;
        if(globalThis.AngelWingBarrierEngine?.blocksIncoming?.(map,commander,target,skill))continue;
        const resolved=TacticalEngine.resolve(map,virtual,target,skill,{random:ctx.random,disableCrit:true});
        const physicalRoll=resolved.result;
        if(!physicalRoll.hit){ctx.pushLog(`${commander.character.name} → ${target.character.name}｜集團齊射 MISS。`,"BATTLE");continue;}
        const enchantments=new Map();
        for(const {unit,slot,enchant} of contributors){
          const shot={...skill,weapon:slot,attackType:"SHOT"};
          const innate=BattleResolution.previewInherentComponent(unit,target,shot,{critical:false});
          if(innate.amount>0){
            enchantments.set(innate.element,(enchantments.get(innate.element)||0)+innate.amount);
          }
          if(enchant){
            const bonus=BattleResolution.enchantmentMagicDamage(unit,target,enchant,false,shot);
            if(bonus>0)enchantments.set(enchant.element,(enchantments.get(enchant.element)||0)+bonus);
          }
        }
        const physical=EffectEngine.applyDamage(target,Number(physicalRoll.damage||0),
          {source:commander,damageType:"PHYSICAL"});
        const physicalLoss=Number(physical.hpLoss||0);
        if(physicalLoss)globalThis.UnitAnimationEngine?.emitResolvedHit?.(target,{
          damage:physicalLoss,components:{physical:physicalLoss,magic:0},
          componentElements:{physical:"NONE"},skillId:skill.id});
        let magicalLoss=0;
        for(const [element,amount] of enchantments){
          const magic=EffectEngine.applyDamage(target,amount,{source:commander,damageType:"MAGIC"});
          const loss=Number(magic.hpLoss||0);magicalLoss+=loss;
          if(loss>0)globalThis.UnitAnimationEngine?.emitResolvedHit?.(target,{
            damage:loss,components:{physical:0,magic:loss},
            componentElements:{magic:element},skillId:skill.id});
        }
        hits.push(target);
        const thunder=contributors.find(row=>row.enchant?.element==="THUNDER");
        if(thunder)thunderImpacts.push({actor:thunder.unit,
          skill:{weapon:thunder.slot,attackType:"SHOT"},enchantment:thunder.enchant,
          target,result:{hit:true}});
        ctx.pushLog(`${commander.character.name}｜集團齊射 → ${target.character.name}｜物理 ${physicalLoss}＋魔法 ${magicalLoss}｜HP ${target.hp}。`,"BATTLE");
        // A zero-HP volley target must enter the shared death lifecycle even
        // if a damage hook already marked it nonliving. Finalization itself is
        // idempotent; only it emits DEATH and removes the battlefield unit.
        if(target.hp<=0){target.alive=false;ctx.handleDefeated?.(target,commander,skill);}
      }
      const fire=contributors.find(row=>row.enchant?.element==="FIRE"&&row.enchant?.bowImpact);
      const impacts=[...thunderImpacts];
      if(fire){
        // A legal AREA volley physically strikes its selected tile even when
        // every unit evades. The one enchanted arrow still hits the ground.
        // This is one impact per FIRE-enchanted volley, never one per enemy.
        impacts.push({actor:fire.unit,skill:{id:skill.id,weapon:fire.slot,attackType:"SHOT"},
          enchantment:{...fire.enchant,bowImpact:{...fire.enchant.bowImpact,radius:skill.radius}},
          target:center,result:{hit:true},terrainImpact:true,volley:true});
      }
      if(impacts.length)resolveEnchantmentImpacts(impacts);
      // Every assisting bow user commits an attack. The commander must finish
      // through the SAME official active-skill transaction as every other
      // map/single-target skill (clears pending move, selection and action).
      for(const {unit} of contributors){
        if(unit.id===commander.id)continue;
        unit.moved=true;unit.acted=true;unit.waited=true;
      }
      ctx.pushLog(`${commander.character.name}｜集團齊射 ${contributors.length} 名弓手、範圍 ${impacted.length} 格、命中 ${hits.length} 名目標。`,"BATTLE");
      return finishActiveSkill(commander);
    }
    // The official TILE/AOE leap supports either an empty landing or a visible
    // enemy as an aim point. Clicking an enemy picks ONE nearby empty landing;
    // the enemy remains in the quake footprint. Browser, Gemini and PVP all
    // use this same read-only plan; it never moves or spends resources.
    function jumpShockwaveLanding(attacker,target,skill,occupantAt=ctx.unitAt){
      if(!skill?.jumpShockwave||!target?.alive||target.occupiesTile===false||
         target.team===attacker.team)return null;
      const {map,units,environmentState}=state(),range=TacticalEngine.range(skill);
      const known=tile=>skill.ignoreFogOfWar===true||skill.requiresVision===false||
        TacticalEngine.teamCanSee(map,units,attacker.team,tile,environmentState);
      const distance=tile=>Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);
      if(!known(target)||distance(target)<range.min||distance(target)>range.max)return null;
      const candidates=[[0,-1],[-1,0],[1,0],[0,1]].map(([dx,dy])=>
        TacticalEngine.tile(map,target.x+dx,target.y+dy)).filter(tile=>
          tile&&known(tile)&&distance(tile)>=range.min&&distance(tile)<=range.max&&
          TERRAINS[tile.terrain]?.passable!==false&&
          TacticalEngine.canOccupyTerrain(attacker,tile)&&
          !TacticalEngine.isBlockedByObject(map,tile.x,tile.y,attacker)&&
          !occupantAt(tile.x,tile.y)&&!ctx.coreAt?.(tile.x,tile.y));
      // Deterministic nearest-side selection; no new AI or landing resource.
      candidates.sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x);
      return candidates[0]||null;
    }

    // Shared terrain transmutation is a normal canonical map-targeted skill.
    // The exact legality plan is reused for preview and commit; never debit
    // a full rune for an impossible transform, and never mutate visual-only tiles.
    function alchemyTerrainPlan(attacker,center,skill){
      const {map,units}=state(),type=String(skill?.alchemyTerrain||'');
      const tile=map?.tiles?.find(t=>t.x===center?.x&&t.y===center?.y);
      if(!tile||attacker?.character?.alchemyHarvest!==true||!type)return null;
      const occupied=t=>(units||[]).some(u=>u?.alive&&u.occupiesTile!==false&&u.x===t.x&&u.y===t.y);
      const structure=t=>(map.objects||[]).some(o=>!o.destroyed&&o.x===t.x&&o.y===t.y&&
        (o.blocksMovement||o.type==='CORE'||o.type==='SPRING'));
      const reserved=t=>t.captureZone||t.core||t.hydrologySource||t.hydrologyDrain||t.hydrologyAuthoredSource||t.river||t.ford;
      const dry=t=>Number(t?.waterDepth||0)<=0;
      const stable=t=>t&&!reserved(t)&&dry(t)&&!occupied(t)&&!structure(t);
      const wet=Number(tile.waterDepth||0)>0;
      if(type==='FLOOD'||type==='FREEZE')return wet?{type,tiles:[tile]}:null;
      if(type==='WATER_TO_LAND'){
        if(!wet||reserved(tile)||occupied(tile)||structure(tile))return null;
        const neighbors=map.tiles.filter(t=>Math.abs(t.x-tile.x)+Math.abs(t.y-tile.y)===1&&
          !t.hydrologySource&&!t.hydrologyDrain&&t.terrain!=='WALL');
        return neighbors.length?{type,tiles:[tile],receivers:neighbors}:null;
      }
      if(type==='MUD')return stable(tile)&&['PLAIN','SAND','HIGH_GROUND'].includes(tile.terrain)?{type,tiles:[tile]}:null;
      if(type==='SHATTER'){
        const object=(globalThis.EnvironmentObjectEngine?.activeObjectsAt?.(map,tile.x,tile.y)||[])
          .find(o=>o.type==='BOULDER'&&o.destructible===true);
        return object&&!occupied(tile)?{type,tiles:[tile],object}:null;
      }
      if(type==='WALL')return stable(tile)&&tile.terrain!=='WALL'?{type,tiles:[tile]}:null;
      if(type==='CLIFF'){
        // A cliff rises from actual terrain, INCLUDING the bottom of a water
        // column. Never use the unrelated dry-only WALL/MUD predicate.
        // The authored river channel may be reshaped, but genuine sources,
        // drains, Core/capture sites and occupied cells stay protected.
        const horizontal=Math.abs(attacker.x-tile.x)>=Math.abs(attacker.y-tile.y);
        const row=[-1,0,1].map(i=>map.tiles.find(t=>t.x===tile.x+(horizontal?i:0)&&t.y===tile.y+(horizontal?0:i)));
        const cliffProtected=t=>!t||t.terrain==='WALL'||occupied(t)||structure(t)||
          t.captureZone||t.core||t.hydrologySource||t.hydrologyDrain||t.hydrologyAuthoredSource;
        if(!row.every(t=>!cliffProtected(t)))return null;
        const footprint=new Set(row.map(t=>`${t.x},${t.y}`));
        const wetVolume=row.reduce((sum,t)=>sum+Math.max(0,Number(t.waterDepth||0)-
          Number(globalThis.HydrologyEngine?.frozenDepth?.(t)||0)),0);
        // Liquid displaced by the uplift must have real adjoining cells to
        // receive it. Source/drain protection also applies to receivers.
        const receivers=map.tiles.filter(t=>!footprint.has(`${t.x},${t.y}`)&&
          row.some(u=>Math.abs(t.x-u.x)+Math.abs(t.y-u.y)===1)&&
          !cliffProtected(t)).sort((a,b)=>a.y-b.y||a.x-b.x);
        if(wetVolume>0&&!receivers.length)return null;
        return{type,tiles:row,receivers};
      }
      return null;
    }
    function executeAlchemyTerrain(attacker,center,skill){
      const plan=alchemyTerrainPlan(attacker,center,skill),{map,environmentState}=state();
      if(!plan||!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y))
        return skillFailure(attacker,skill,'ALCHEMY_TERRAIN_INVALID',center);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,'RESOURCE_OR_REQUIREMENT',center);
      // All target checks above happen BEFORE consuming the entire rune.
      if(!ctx.consumeSkill(attacker,skill))return false;
      const events=[],source=skill.id+':'+plan.type;
      const emitted=(type,t,more={})=>events.push({type,x:t.x,y:t.y,source,...more});
      if(plan.type==='FLOOD'){
        events.push(...HydrologyEngine.floodArea(map,plan.tiles,{surfaceRise:1,source}));
      }else if(plan.type==='FREEZE'){
        const t=plan.tiles[0],before=Math.max(0,Number(t.iceThickness||0));
        t.iceThickness=Math.min(Number(t.waterDepth||0),Math.max(before,.75));
        globalThis.ClimateEngine?.syncTileVisuals?.(environmentState,t);
        emitted('ICE_FORMED',t,{before,iceThickness:t.iceThickness});
      }else if(plan.type==='MUD'){
        const t=plan.tiles[0],before=t.terrain;HydrologyEngine.setGroundMaterial(t,'SOIL',events,source);t.terrain='MUD';
        emitted('TERRAIN_CHANGED',t,{from:before,to:'MUD'});
      }else if(plan.type==='SHATTER'){
        globalThis.EnvironmentObjectEngine?.destroy?.(map,plan.object,{events,reason:source});
      }else if(plan.type==='WALL'){
        const t=plan.tiles[0],before=t.terrain;t.terrain='WALL';
        emitted('TERRAIN_CHANGED',t,{from:before,to:'WALL'});
      }else if(plan.type==='CLIFF'){
        // Record the actual water column BEFORE editing any tile. Raise the
        // bed enough to emerge above that existing surface, rather than only
        // painting HIGH_GROUND under a visually unchanged water sheet.
        const beforeDepths=plan.tiles.map(t=>Math.max(0,Number(t.waterDepth||0)));
        let displaced=0;
        for(const t of plan.tiles){
          const frozen=Math.max(0,Number(HydrologyEngine.frozenDepth?.(t)||0));
          const liquid=Math.max(0,Number(t.waterDepth||0)-frozen);
          if(liquid<=0)continue;
          displaced+=liquid;
          HydrologyEngine.setWaterDepth(t,frozen,events,source);
        }
        if(displaced>0){
          const each=displaced/plan.receivers.length;
          for(const receiver of plan.receivers)HydrologyEngine.addWater(receiver,each,events);
        }
        for(let i=0;i<plan.tiles.length;i++){
          const t=plan.tiles[i],depth=beforeDepths[i];
          // Keep the existing +2 land-cliff height; deeper water requires
          // more rock mass to emerge, derived from its REAL pre-cast depth.
          const deltaElevation=Math.max(2,Math.ceil(depth)+1);
          events.push(...HydrologyEngine.deformTerrain(map,t.x,t.y,{deltaElevation,source}));
          const previous=t.terrain;HydrologyEngine.setGroundMaterial(t,'ROCK',events,source);
          if(HydrologyEngine.waterDepth(t)>0){t.terrain='WATER';t.dryTerrain='HIGH_GROUND';}
          else{t.terrain='HIGH_GROUND';t.dryTerrain='HIGH_GROUND';}
          // An alchemically raised cliff is genuine terrain, but is NOT a
          // naturally deposited mineral vein. Never farm it for free materials.
          t.alchemyTransmuted=t.alchemyTransmuted===true||previous!=='HIGH_GROUND';
          if(previous!=='HIGH_GROUND')emitted('TERRAIN_CHANGED',t,{from:previous,to:t.terrain});
        }
      }else if(plan.type==='WATER_TO_LAND'){
        const t=plan.tiles[0],volume=Math.max(0,Number(t.waterDepth||0));
        // Conservation: move existing water into real neighboring cells before
        // lifting the source bed. This is NOT free water creation.
        const byNeighbor=volume/plan.receivers.length;
        HydrologyEngine.setWaterDepth(t,0,events,source);
        for(const n of plan.receivers)HydrologyEngine.addWater(n,byNeighbor,events);
        events.push(...HydrologyEngine.deformTerrain(map,t.x,t.y,{deltaElevation:Math.ceil(volume)+1,source}));
        const previous=t.terrain;HydrologyEngine.setGroundMaterial(t,'SOIL',events,source);t.terrain='PLAIN';t.dryTerrain='PLAIN';
        emitted('TERRAIN_CHANGED',t,{from:previous,to:'PLAIN',displacedWater:volume});
      }
      map.terrainRevision=Number(map.terrainRevision||0)+1;
      events.forEach(ctx.logEnvironmentEvent);
      ctx.resolveEnvironmentEvents?.(events,{reason:skill.name});
      globalThis.EffectEngine?.breakStealth?.(attacker,'ACTION');
      globalThis.EffectEngine?.interruptChannel?.(attacker,'ACTION');
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:'MAP',
        alchemyTerrain:plan.type,
        alchemyFootprint:plan.tiles.map(tile=>({x:tile.x,y:tile.y}))});
      ctx.pushLog(`${attacker.character.name} 施放 ${skill.name}｜${plan.type}｜地形狀態已更新。`,'BATTLE');
      return finishActiveSkill(attacker);
    }

    function mapTargetTiles(attacker,skill){
      if(skill?.terrainTargeting)return enchantedTerrainTargetTiles(attacker,skill);
      if(skill?.alchemyCast?.mode==='TERRAIN'){
        const common={...skill,alchemyCast:null};
        return mapTargetTiles(attacker,common).filter(t=>alchemyTerrainPlan(attacker,t,skill));
      }
      if(skill?.utilityAction?.type==="RANGER_FORMATION_MARCH")return rangerFormationLegalTiles(attacker,skill);
      const {map,units,environmentState}=state();
      if(skill?.dispelConstruct===AngelWingBarrierEngine.TYPE){
        const range=TacticalEngine.range(skill);
        return map.tiles.filter(tile=>{
          const distance=Math.abs(attacker.x-tile.x)+Math.abs(attacker.y-tile.y);
          return distance>=range.min&&distance<=range.max&&
            AngelWingBarrierEngine.segments(map).some(w=>w.x===tile.x&&w.y===tile.y&&w.ownerTeam!==attacker.team)&&
            TacticalEngine.teamCanSee(map,units,attacker.team,tile,environmentState)&&
            TacticalEngine.canSee(map,attacker,tile,environmentState);
        });
      }
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
          const occupant=ctx.unitAt(tile.x,tile.y);
          // Occupied enemy cells are *aims*, never landings. The actual landing
          // is determined by the shared jumpShockwaveLanding plan.
          if(occupant){
            if(!skill.jumpShockwave||!jumpShockwaveLanding(attacker,occupant,skill))return false;
          }else{
            if(TERRAINS[tile.terrain]?.passable===false)return false;
            if(skill.jumpShockwave&&(!TacticalEngine.canOccupyTerrain(attacker,tile)||
                TacticalEngine.isBlockedByObject(map,tile.x,tile.y,attacker)))return false;
          }
        }
        if(skill.trapPlacement&&(ctx.unitAt(tile.x,tile.y)||TERRAINS[tile.terrain]?.passable===false))return false;
        // An airborne leap can cross enemy bodies, walls and opaque intervening
        // terrain. The landing must STILL be observed by the team (known()).
        // Do not turn this into ignoreFogOfWar or a ground-traversal move.
        if(skill.requiresVision!==false&&!skill.jumpShockwave&&
           !TacticalEngine.canSee(map,attacker,tile,environmentState))return false;
        if(skill.whirlpool&&!HydrologyEngine.isWater(tile))return false;
        if(skill.tsunamiWave&&!EnvironmentEngine.planTsunami(map,attacker,tile,{width:skill.tsunamiWave.width,surfaceRise:skill.hydrologyFlood?.surfaceRise}).cells.length)return false;
        if(skill.environmentRequirement==="CONDUCTIVE"&&!EnvironmentEngine.isConductive(map,environmentState,tile.x,tile.y))return false;
        return true;
      });
    }

    function enchantableWeaponSlots(unit,skill){
      return Object.entries(unit?.character?.weapons||{}).filter(([,weapon])=>
        EquipmentDatabase.canEnchantWeapon(weapon,skill?.enchantment))
        .map(([slot,weapon])=>({slot,name:weapon.name||slot,kind:weapon.weaponKind}));
    }
    // Eligibility depends on the caster's rules, not the recipient's action
    // state. A living ally who has MOVED, ACTED or WAITED remains enchantable.
    function enchantmentCandidates(attacker,skill){
      const {map,units,environmentState}=state();
      if(!attacker?.alive||attacker.acted||!map||!skill)return[];
      const allies=units.filter(unit=>unit?.alive&&unit.team===attacker.team&&
        TacticalEngine.canTarget(map,attacker,unit,skill,environmentState));
      allies.sort((a,b)=>Number(b.id===attacker.id)-Number(a.id===attacker.id)||
        Math.abs(a.x-attacker.x)+Math.abs(a.y-attacker.y)-
        Math.abs(b.x-attacker.x)-Math.abs(b.y-attacker.y)||String(a.id).localeCompare(String(b.id)));
      return allies.flatMap(target=>enchantableWeaponSlots(target,skill).map(weapon=>({target,weapon})));
    }
    function beginEnchantment(attacker,skill){
      if(!attacker?.alive||attacker.acted||skill?.utilityAction?.type!=="ENCHANT_WEAPON"||
         !ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT");
      const candidates=enchantmentCandidates(attacker,skill);
      if(!candidates.length)return skillFailure(attacker,skill,"ENCHANT_NO_ELIGIBLE_WEAPON");
      pendingEnchantment={attacker,skill,candidates,target:null,slots:[]};
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);
      ctx.setMode("enchant-weapon-select");ctx.render();return true;
    }
    function commitCandidateEnchantment(targetId,weaponSlot){
      const pending=pendingEnchantment;
      return pending?executeEnchantmentChoice(pending.attacker,pending.skill,targetId,weaponSlot):false;
    }
    // Canonical one-transaction enchantment commit. The interactive browser
    // menu and headless server both use this entry; only selection UI differs.
    // The caster's self-followup remains a separate, non-free tactical choice.
    function executeEnchantmentChoice(attacker,skill,targetId,weaponSlot){
      if(!attacker?.alive||attacker.acted||skill?.utilityAction?.type!=="ENCHANT_WEAPON"||
         !ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT");
      const choice=enchantmentCandidates(attacker,skill).find(entry=>
        String(entry.target.id)===String(targetId)&&entry.weapon.slot===weaponSlot);
      if(!choice)return skillFailure(attacker,skill,"ENCHANT_TARGET_INVALID");
      pendingEnchantment={attacker,skill,candidates:[],target:choice.target,slots:[choice.weapon]};
      return commitEnchantment(weaponSlot);
    }
    function commitEnchantment(weaponSlot){
      const p=pendingEnchantment;
      if(!p||!p.attacker?.alive||!p.target?.alive||p.attacker.acted||!p.slots.some(w=>w.slot===weaponSlot))return false;
      const {attacker,target,skill}=p,s=state();
      if(!TacticalEngine.canTarget(s.map,attacker,target,skill,s.environmentState)||!ctx.canUseSkill(attacker,skill))return false;
      const matkSnapshot=Number(attacker.character.combat.matk);
      const spent=ctx.consumeSkill(attacker,skill);
      if(!spent)return false;
      const effect={type:"WEAPON_ENCHANT",id:`WEAPON_ENCHANT:${weaponSlot}`,name:`${skill.element==="THUNDER"?"雷":"火"}元素附魔`,classification:"POSITIVE",weaponSlot,element:skill.element,
        matkSnapshot,bonusPower:Number(skill.enchantment.power),
        bowImpact:skill.enchantment?.onBowImpact?.[skill.element]||null,sourceSkillId:skill.id};
      const applied=EffectEngine.apply({source:attacker,target,effect});
      if(!applied?.applied)throw new Error("Weapon enchantment state could not be applied after skill resource commit.");
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT",enchantmentElement:effect.element,enchantmentSlot:weaponSlot});
      ctx.pushLog(`${attacker.character.name}｜${skill.name} → ${target.character.name}【${p.slots.find(w=>w.slot===weaponSlot).name}】 ${effect.element}｜下次攻擊生效。`,"BATTLE");
      pendingEnchantment=null;
      if(attacker.id!==target.id)return finishActiveSkill(attacker);
      // This is the remaining attack portion of the caster's own action.
      // It is neither a second turn nor a free extra attack.
      enchantmentFollowup={unitId:attacker.id,weaponSlot};
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("enchant-followup");ctx.render();return true;
    }
    function cancelEnchantmentSelection(){
      if(!pendingEnchantment)return false;
      pendingEnchantment=null;ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("special-menu");ctx.render();return true;
    }
    function cancelEnchantmentFollowup(){
      const followup=enchantmentFollowup,unit=state().selected;
      if(!followup||unit?.id!==followup.unitId)return false;
      enchantmentFollowup=null;return finishActiveSkill(unit);
    }
    function resolveEnchantmentImpacts(entries){
      const {map,environmentState}=state();
      if(!environmentState||!entries?.length)return 0;
      const contact=globalThis.EnvironmentContactEngine,profile=contact?.PROFILE;
      const events=[],firePositions=new Set();
      // The resolution actor's real target (including interception) owns its
      // direct hit. It is excluded only from this weapon's electric pulse.
      const directTargets=new Set(entries.filter(e=>e?.result?.hit&&e?.target?.id)
        .map(e=>String(e.target.id)));
      const explosions=[];
      for(const entry of entries){
        const enchant=entry?.enchantment,target=entry?.target;
        if(!enchant||!entry.result?.hit||!target||target.hallucination===true)continue;
        const origin=TacticalEngine.tile(map,target.x,target.y);
        if(!origin)continue;
        const weapon=attackWeaponFor(entry.actor,entry.skill);
        // Original FIRE_ARROW_AOE data: impact-radius, flat splash and
        // FIRE+EXPLOSION forces are owned by SkillDatabase, not guessed here.
        const explosion=enchant.element==="FIRE"&&weapon?.weaponKind==="BOW"?enchant.bowImpact:null;
        if(explosion){
          // A confirmed hit is an actual collision with the airborne or ground
          // target. The resulting blast is not another weapon attack, so it
          // cannot roll a second hit or consume a second enchantment.
          const area=ctx.aoeTiles(origin,Number(explosion.radius));
          explosions.push({center:origin,area,rule:explosion,source:entry.actor,
            skillId:entry.skill?.id||enchant.sourceSkillId||null,volley:entry.volley===true});
          continue;
        }
        const force=enchant.element==="FIRE"?"FIRE":enchant.element==="THUNDER"?"THUNDER":null;
        if(!force)continue;
        if(entry.terrainImpact===true){
          events.push(...EnvironmentEngine.apply({map,state:environmentState,x:origin.x,y:origin.y,forces:[force]}));
          if(force==="FIRE")firePositions.add(`${origin.x},${origin.y}`);
          continue;
        }
        // The ground or water must actually intersect the weapon impact.
        if(!contact?.contacts||!profile)continue;
        // The contact body remains valid even after lethal direct damage.
        const body={...target,alive:true};
        const surface=contact.contacts(body,origin,profile.SURFACE);
        const water=contact.contacts(body,origin,profile.WATER_VOLUME);
        const tornado=EnvironmentEngine.effectAt(environmentState,target.x,target.y)
          .some(e=>e.type===EnvironmentEngine.EFFECT.TORNADO&&e.element==="WATER");
        const column=tornado&&contact.contacts(body,origin,profile.AIR_COLUMN);
        if(!surface&&!water&&!column)continue;
        events.push(...EnvironmentEngine.apply({map,state:environmentState,x:target.x,y:target.y,forces:[force]}));
        if(force==="FIRE")firePositions.add(`${target.x},${target.y}`);
      }
      // Apply the old fire-arrow AREA forces over its actual blast area,
      // not merely at the arrow's center cell. Every affected unit, friend or
      // foe, receives the original flat splash damage, once per blast.
      for(const explosion of explosions){
        for(const tile of explosion.area){
          events.push(...EnvironmentEngine.apply({map,state:environmentState,x:tile.x,y:tile.y,
            forces:explosion.rule.environmentForces}));
          firePositions.add(`${tile.x},${tile.y}`);
        }
      }
      for(const explosion of explosions){
        for(const tile of explosion.area){
          const unit=ctx.unitAt(tile.x,tile.y);
          if(unit)ctx.damageUnitFlat(unit,explosion.rule.aoeDamage,"火附魔箭・爆裂");
        }
        // One canonical impact event drives both the combat log and Babylon
        // presentation. Neither the renderer nor PvP recalculates damage.
        const description=explosion.volley?"集團齊射・火附魔爆裂":"火附魔箭・爆裂";
        ctx.pushLog(`${explosion.source?.character?.name||"附魔弓手"}｜${description} (${explosion.center.x},${explosion.center.y})｜半徑 ${Number(explosion.rule.radius)} 格、波及 ${explosion.area.length} 格。`,"BATTLE");
        globalThis.UnitAnimationEngine?.emitPresentation?.("FIRE_BOW_EXPLOSION",{
          x:explosion.center.x,y:explosion.center.y,radius:Number(explosion.rule.radius),
          affectedTileCount:explosion.area.length,sourceId:explosion.source?.id||null,
          skillId:explosion.skillId,volley:explosion.volley});
      }
      // One pulse registry for all electric propagation cells of a single
      // attack. It must not leak into subsequent independent lightning events.
      const pulseIds=[...directTargets];
      for(const event of events.filter(e=>e.type==="ELECTRIC_CONDUCTION")){
        for(const tile of event.tiles||[]){
          for(const effect of EnvironmentEngine.effectAt(environmentState,tile.x,tile.y)){
            if(effect.type===EnvironmentEngine.EFFECT.ELECTRIFIED)effect.damagedUnitIds=pulseIds;
          }
        }
      }
      if(events.length){
        events.forEach(ctx.logEnvironmentEvent);
        ctx.resolveEnvironmentEvents?.(events,{reason:"附魔武器環境連鎖"});
      }
      for(const key of firePositions){
        const [x,y]=key.split(',').map(Number);
        if(!EnvironmentEngine.effectAt(environmentState,x,y).some(effect=>effect.type===EnvironmentEngine.EFFECT.BURNING))continue;
        for(const unit of state().units.filter(u=>u?.alive&&u.x===x&&u.y===y))
          ctx.applyEnvironmentHazardToUnit(unit,{reason:"附魔引燃地形",includeElectric:false,includeBoiling:false,includeFire:true});
      }
      return events.length+explosions.length;
    }
    function resolveEnchantmentImpact(entry){return resolveEnchantmentImpacts([entry]);}
    function executeUtilitySkill(attacker,target,skill){
      const {map,units}=state(),action=skill?.utilityAction;if(!action)return skillFailure(attacker,skill,"NO_UTILITY_ACTION",target);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
      if(action.type==="ENCHANT_WEAPON")return beginEnchantment(attacker,skill);
      if(action.type==="SHAPESHIFT"){
        const runtime=globalThis.UnitRuntimeEngine;
        if(!runtime?.canShiftForm?.(attacker,action.form))
          return skillFailure(attacker,skill,"INVALID_FORM_SWITCH",target);
        if(!ctx.consumeSkill(attacker,skill))
          return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        // Commit once: form changes never restore attack/movement or remove DOT.
        if(!runtime.shiftForm(attacker,action.form))
          throw new Error("FORM_VALIDATED_BUT_COMMIT_FAILED");
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,attacker,skill,{targetKind:"SELF"});
        ctx.pushLog(`${attacker.character.name} 變身為「${runtime.formSpec(attacker)?.name||action.form}」。`,"BATTLE");
        return finishFreeUtility(attacker);
      }
      if(action.type==="SHARE_VISION"){
        if(!target?.alive||target.team!==attacker.team||target.id===attacker.id||
           !TacticalEngine.canTarget(map,attacker,target,skill,state().environmentState))
          return skillFailure(attacker,skill,"INVALID_VISION_ALLY",target);
        if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        attacker.sharedVisionAllyId=target.id;
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        ctx.pushLog(`${attacker.character.name} 與 ${target.character.name} 建立高空視野共享。`,"BATTLE");
        return finishFreeUtility(attacker);
      }
      if(action.type==="DELIVER_CARGO"){
        if(!target?.alive||target.team!==attacker.team||target.id===attacker.id||
           Math.abs(target.x-attacker.x)+Math.abs(target.y-attacker.y)>1)
          return skillFailure(attacker,skill,"INVALID_CARGO_TARGET",target);
        const available=globalThis.ItemRuntimeEngine?.list?.(attacker)||[];
        if(!available.length)return skillFailure(attacker,skill,"CARGO_EMPTY",target);
        const transfer=globalThis.ItemRuntimeEngine?.transfer?.(attacker,target,available[0].payload?.id);
        if(!transfer?.ok)return skillFailure(attacker,skill,transfer?.reason||"ITEM_TRANSFER_FAILED",target);
        if(!ctx.consumeSkill(attacker,skill))throw Error("CARGO_COMMITTED_WITHOUT_SKILL_RESOURCE");
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        ctx.pushLog(`${attacker.character.name} 將道具交給 ${target.character.name}。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="SEAL_SUBMERGE_PRESS"){
        const tile=TacticalEngine.tile(map,target?.x,target?.y);
        const body=Number(globalThis.VerticalMobilityEngine?.bodyHeight?.(target)||2);
        const water=Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0);
        if(!target?.alive||target.team===attacker.team||!tile||water<body||
           Math.abs(target.x-attacker.x)+Math.abs(target.y-attacker.y)>2||
           !TacticalEngine.canTarget(map,attacker,target,skill,state().environmentState)||
           globalThis.WaterInteractionEngine?.activeWaterRules?.(target)?.preventSinking||
           target.character?.terrainTraits?.includes("AQUATIC")||
           !globalThis.WaterInteractionEngine?.forceSubmerge)
          return skillFailure(attacker,skill,"SUBMERGE_REQUIRES_DEEP_WATER",target);
        // This is contact-based weight suppression, not a magic drowning hit.
        // No instant HP damage, independent of enemy armor.
        if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        const pressed=globalThis.WaterInteractionEngine.forceSubmerge(target,tile,{turns:1,impactDamage:0});
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        ctx.pushLog(pressed.applied?`${attacker.character.name} 壓住 ${target.character.name}，溺水將依環境回合結算。`:`${skill.name}：${pressed.reason||"水域壓制失敗"}`,"BATTLE");
        return finishActiveSkill(attacker);
      }

      if(action.type==="SWAP_ALLIES"){
        if(action.consumeTurn!==true||
           !TacticalEngine.canTarget(map,attacker,target,skill,state().environmentState)||
           !TacticalEngine.canSwapAllies(map,units,attacker,target))
          return skillFailure(attacker,skill,"ALLY_SWAP_ILLEGAL",target);
        // Commit BOTH positions only after complete two-way validation. These
        // are real game-state coordinates; renderer observes events afterwards.
        if(!ctx.consumeSkill(attacker,skill))
          return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        const beforeA={x:attacker.x,y:attacker.y,z:attacker.z};
        const beforeB={x:target.x,y:target.y,z:target.z};
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
        globalThis.EffectEngine?.interruptChannel?.(attacker,"ACTION");
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        commitPendingMove(attacker);
        attacker.x=beforeB.x;attacker.y=beforeB.y;
        target.x=beforeA.x;target.y=beforeA.y;
        const tileA=TacticalEngine.tile(map,attacker.x,attacker.y);
        const tileB=TacticalEngine.tile(map,target.x,target.y);
        if(globalThis.VerticalMobilityEngine?.syncUnit){
          VerticalMobilityEngine.syncUnit(attacker,tileA);
          VerticalMobilityEngine.syncUnit(target,tileB);
        }else{
          attacker.z=Number(tileA.elevation||0);
          target.z=Number(tileB.elevation||0);
        }
        globalThis.UnitAnimationEngine?.emitMove?.(attacker,{from:beforeA,kind:"SWAP"});
        globalThis.UnitAnimationEngine?.emitMove?.(target,{from:beforeB,kind:"SWAP"});
        // Each unit enters its actual new cell once, through the existing
        // environmental entry/capture callback used by normal movement.
        ctx.enterTile?.(attacker);
        ctx.enterTile?.(target);
        ctx.pushLog(`${attacker.character.name} 與 ${target.character.name} 交換位置。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="SET_VERTICAL_MODE"){
        if(action.mode==="DIVING"&&attacker.carryingUnitId)return skillFailure(attacker,skill,"CANNOT_DIVE_WITH_PASSENGER",target);
        if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        const tile=TacticalEngine.tile(map,attacker.x,attacker.y),result=globalThis.VerticalMobilityEngine?.setMode?.(attacker,tile,action.mode,action.options||{});
        if(!result?.ok){ctx.pushLog(`${skill.name} 無法切換目前的垂直移動狀態。`,"SYSTEM");ctx.render();return false;}
        ctx.consumeSkill(attacker,skill);ctx.pushLog(`${attacker.character.name}｜${skill.name} → ${result.state.mode}。`,"SYSTEM");
        return action.consumeTurn===true?finishActiveSkill(attacker):finishFreeUtility(attacker);
      }
      if(action.type==="SUBMERGE_ENEMY"){
        if(!target?.alive||target.team===attacker.team||
           String(attacker.verticalState?.mode||"")!=="DIVING"||
           Math.abs(attacker.x-target.x)+Math.abs(attacker.y-target.y)!==1||
           !TacticalEngine.canTarget(map,attacker,target,skill,state().environmentState))
          return skillFailure(attacker,skill,"DRAG_REQUIRES_ADJACENT_TARGET",target);
        const waterRules=globalThis.WaterInteractionEngine?.activeWaterRules?.(target)||{};
        if(target.character?.terrainTraits?.includes("AQUATIC")||waterRules.preventSinking)
          return skillFailure(attacker,skill,"TARGET_CANNOT_BE_SUBMERGED",target);
        if(!globalThis.WaterInteractionEngine?.forceSubmerge)
          return skillFailure(attacker,skill,"WATER_RUNTIME_UNAVAILABLE",target);
        const body=Number(globalThis.VerticalMobilityEngine?.bodyHeight?.(target)||2);
        let tile=TacticalEngine.tile(map,target.x,target.y);
        if(Number(HydrologyEngine.waterDepth(tile)||0)<body){
          // Shoreline grab: pull the enemy into an UNOCCUPIED adjacent deep
          // water cell using the existing official displacement/collision rules.
          const possible=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>
            TacticalEngine.tile(map,target.x+dx,target.y+dy)).filter(next=>
            next&&HydrologyEngine.waterDepth(next)>=body&&
            TacticalEngine.canOccupyTerrain(target,next)&&
            !TacticalEngine.isBlockedByObject(map,next.x,next.y,target)&&
            !units.some(u=>u.alive&&u.occupiesTile!==false&&u.id!==target.id&&
              u.x===next.x&&u.y===next.y)).sort((a,b)=>
            Math.abs(a.x-attacker.x)+Math.abs(a.y-attacker.y)-
            (Math.abs(b.x-attacker.x)+Math.abs(b.y-attacker.y))||a.y-b.y||a.x-b.x);
          const landing=possible[0];
          if(!landing||!ctx.applyForcedMovement)return skillFailure(attacker,skill,"NO_DEEP_WATER_LANDING",target);
          const resistance=globalThis.DisplacementEngine?.resistance?.(target);
          if(resistance?.weightClass==="IMMOVABLE")return skillFailure(attacker,skill,"TARGET_IMMOVABLE",target);
          // A collision can still defeat the defender. Commit the full action
          // BEFORE applying the official displacement, never give a free hit.
          if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
          globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
          const force=1+Math.max(0,Number(resistance?.value||0));
          const moved=ctx.applyForcedMovement(landing,target,force,{name:"深潛拖拽",damage:0,type:"PULL",damageType:"WATER",resistAxes:{horizontal:true,vertical:true}});
          if(!moved?.steps?.length||target.x!==landing.x||target.y!==landing.y){
            ctx.pushLog(`${skill.name}：敵人受到地形或碰撞阻擋，無法拉入深水。`,"BATTLE");
            return finishActiveSkill(attacker);
          }
          if(!target.alive)return finishActiveSkill(attacker);
          tile=TacticalEngine.tile(map,target.x,target.y);
        }else{
          if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
          globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        }
        // Submersion changes posture without HP loss at contact; the regular
        // environmental clock owns subsequent drowning damage.
        const result=WaterInteractionEngine.forceSubmerge(target,tile,{turns:1,impactDamage:0});
        if(!result.applied){ctx.pushLog(`${skill.name}：目標未成功沉沒（${result.reason||"UNKNOWN"}）。`,"BATTLE");return finishActiveSkill(attacker);}
        ctx.pushLog(`${attacker.character.name} 將 ${target.character.name} 拉入水下，後續由真實水深與呼吸規則判定。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="ENTER_STEALTH"){
        ctx.consumeSkill(attacker,skill);globalThis.EffectEngine?.applyStealth?.(attacker,{detectionRange:1,source:attacker});
        globalThis.EffectEngine?.resolveProximityReveal?.(attacker,units);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,attacker,skill,{targetKind:"SELF"});
        ctx.pushLog(`${attacker.character.name} 犧牲本回合行動，進入潛行。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="STEAL_LOOT"){
        if(!target?.character||!globalThis.RewardEngine?.stealable?.(attacker,target))
          return skillFailure(attacker,skill,"NO_STEALABLE_LOOT",target);
        const result=RewardEngine.stealLoot(attacker,target);
        if(!result.ok)return skillFailure(attacker,skill,result.reason,target);
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");ctx.consumeSkill(attacker,skill);
        // Presentation only; NEVER send stolen item ID or gold value.
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
        const itemName=result.itemId?ItemDatabase.get(result.itemId)?.name||result.itemId:null;
        const detail=[result.gold?`${result.gold} 金幣`:null,itemName?`道具「${itemName}」`:null].filter(Boolean).join("及");
        ctx.pushLog(`${attacker.character.name} 從 ${target.character.name} 偷得${detail}｜同一目標不可再次偷竊。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(action.type==="SCHEDULE_TURN_SIMULATION"){
        if(!target?.character||target.team===attacker.team)return false;
        const effective=ctx.effectiveSkill(attacker,skill);
        const scheduled=ctx.scheduleTurnSimulation?.({source:attacker,targetTeam:target.team,skill:effective,action});
        if(!scheduled){ctx.pushLog(`${skill.name} 無法建立回合模擬。`,"SYSTEM");ctx.render();return false;}
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
        if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
        TacticalEngine.faceToward(attacker,target);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT"});
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
      if(action.type==="RANGER_FORMATION_MARCH")return executeRangerMarch(attacker,center,skill);
      if(action.type!=="RELEASE_CARRIED"&&!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      if(MAP_TRANSIT_ACTIONS.has(action.type)){
        const destination=TacticalEngine.tile(map,center.x,center.y);
        if(!destination||ctx.unitAt(center.x,center.y)||!TacticalEngine.canOccupyTerrain(attacker,destination)||TacticalEngine.isBlockedByObject(map,center.x,center.y,attacker)){ctx.pushLog(`${skill.name}：終點不是合法站立位置。`,"SYSTEM");ctx.render();return false;}
        globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
        if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,destination,skill,{targetKind:"MAP"});
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
      const appliedTo=new Set();
      for(const tile of affected){
        const occupant=ctx.unitAt(tile.x,tile.y);if(!occupant||appliedTo.has(occupant.id)||!relationAllows(skill,attacker,occupant))continue;
        appliedTo.add(occupant.id);
        const effects=Array.isArray(skill.relationEffects)?skill.relationEffects.filter(effect=>!effect.relation||effect.relation===EffectEngine.relation(attacker,occupant)||effect.relation==="ALLY"&&EffectEngine.relation(attacker,occupant)==="SELF"):(skill.effects||[]);
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


    function executeLiviaPurifiedSlash(attacker,center,skill){
      const {map,units,environmentState}=state();
      const duality=globalThis.UnitTraitEngine;
      if(!duality?.hasResource(attacker)||!skill.purifiedSlash||!duality.status(attacker).blueFull)
        return skillFailure(attacker,skill,"PURIFICATION_NOT_AVAILABLE",center);
      if(!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y))
        return skillFailure(attacker,skill,"PURIFIED_SLASH_ILLEGAL_AIM",center);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      const tiles=TacticalEngine.fanTiles(map,attacker,center,{length:skill.purifiedSlash.length});
      if(!tiles?.length)return skillFailure(attacker,skill,"PURIFIED_SLASH_EMPTY_FOOTPRINT",center);
      // Resolve while complete form is active, and reset only AFTER all victims.
      const spent=ctx.consumeSkill(attacker,skill);
      if(!spent)return false;
      EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
      TacticalEngine.faceToward(attacker,center);
      const targets=tiles.map(tile=>ctx.unitAt(tile.x,tile.y)).filter(u=>u?.alive&&u.team!==attacker.team);
      // One charge for the whole actual cast, never one MP spend per victim.
      // The private hit skill has no distinct VFX role; the official one-shot
      // presentation event below owns the giant beam-blade sweep.
      const hitSkill={...skill,id:"livia_purified_hit",name:skill.name,
        target:"ENEMY",targetType:"SINGLE",shape:null,purifiedSlash:null,
        power:Number(skill.power||0)*Number(skill.purifiedSlash.powerMultiplier||1),
        manaCost:0,hitCount:1};
      let hits=0;
      for(const target of targets){
        if(!target.alive)continue;
        const res=BattleResolution.resolve({map,units,environmentState,initiator:attacker,
          target,skill:hitSkill,actions:[]},{
            canUseSkill:()=>true,consumeSkill:()=>({cost:0,resources:{}}),
            onDefeated:ctx.handleDefeated,onAction:ctx.logBattleAction,
            onPostEffect:ctx.logPostEffect});
        for(const entry of res.results||[]){
          if(entry.actor?.id!==attacker.id)continue;
          if(entry.result?.hit)hits++;
        }
      }
      globalThis.BattlefieldFieldEngine.createDistortion(map,attacker.team,tiles,state().round||1);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,{id:"livia_purified_nether",name:skill.name,
        category:"ATTACK",weapon:skill.weapon},{targetKind:"MAP",fanTargetCells:tiles.map(t=>({x:t.x,y:t.y})),
        purifiedSlash:true});
      duality.resetBlueAfterUltimate(attacker);
      // Do not leak fog-hidden enemy counts in a shared PVP battle log.
      ctx.pushLog(`${attacker.character.name}｜${skill.name}｜光刃掃過地圖，留下空間扭曲區域。`,"BATTLE");
      return finishActiveSkill(attacker);
    }

    function executeMapSkill(attacker,center,skill){
      // Canonical action gate: stale UI button clicks may never cast after commit.
      if(!canCommitActiveAction(attacker))return false;
      const {map,environmentState}=state();
      // A self-centered sweep has no legal remote aim. Reject stale/forged
      // coordinates even when called through the authoritative PvP bridge.
      if(skill?.target==="SELF"&&skill.areaDamage?.mode==="PHYSICAL_SWEEP"&&
          (center?.x!==attacker.x||center?.y!==attacker.y))
        return skillFailure(attacker,skill,"SELF_CENTER_ONLY",center);
      if(skill?.persistentArea){
        if(!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y)||!ctx.canUseSkill(attacker,skill))return false;
        if(!ctx.consumeSkill(attacker,skill))return false;
        EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
        TacticalEngine.faceToward(attacker,center);
        if(!ctx.activatePersistentArea(attacker,center,skill))throw new Error("CANONICAL_PERSISTENT_AREA_INVALID");
        return finishActiveSkill(attacker);
      }
      if(skill?.areaDamage?.requiredEffectTag&&!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y))return false;
      if(skill?.purifiedSlash)return executeLiviaPurifiedSlash(attacker,center,skill);
      if(skill?.alchemyCast?.mode==='TERRAIN')return executeAlchemyTerrain(attacker,center,skill);
      if(skill?.rangerVolley===true)return executeRangerVolley(attacker,center,skill);
      if(skill?.dispelConstruct===AngelWingBarrierEngine.TYPE){
        if(!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y))
          return skillFailure(attacker,skill,"INVALID_CONSTRUCT_TARGET",center);
        if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
        const consumed=ctx.consumeSkill(attacker,skill);
        if(!consumed)return false;
        EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
        const result=AngelWingBarrierEngine.dispel(map,attacker,center.x,center.y);
        if(!result.ok)throw new Error("Validated holy wing wall disappeared during authoritative cast.");
        const recovered=EffectEngine.rewardDispel(attacker);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"MAP"});
        ctx.pushLog(`${attacker.character.name}｜${skill.name}解除聖翼壁障${recovered?`｜回收 ${recovered} MP`:""}。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      if(skill?.terrainTargeting)return executeEnchantedTerrainAttack(attacker,center,skill);
      if(skill?.utilityAction)return executeMapUtility(attacker,center,skill);
      if(skill?.sanctuary){
        const faith=UnitRuntimeEngine.faithValue(attacker),max=attacker.resources?.faith?.max;
        if(!ctx.canUseSkill(attacker,skill)||faith===null||(faith!==0&&faith!==max))return skillFailure(attacker,skill,"FAITH_NOT_AT_EXTREME",center);
        if(!ctx.sanctuaryTiles(center,skill.radius).length)return skillFailure(attacker,skill,"SANCTUARY_BLOCKED",center);
        const mode=faith===max?"HEALING":"PUNISHMENT";
        const spent=ctx.consumeSkill(attacker,skill);
        if(!spent)return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
        EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
        TacticalEngine.faceToward(attacker,center);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"MAP",
          projectileKind:attackWeaponFor(attacker,skill)?.weaponKind||null,
          sanctuaryMode:mode});
        ctx.activateSanctuary(attacker,center,skill,mode);
        if(mode==="HEALING")UnitRuntimeEngine.changeFaith(attacker,max/2-UnitRuntimeEngine.faithValue(attacker));
        return finishActiveSkill(attacker);
      }
      if(skill?.smokeField){
        if(!ctx.canUseSkill(attacker,skill)||!ctx.sanctuaryTiles(center,skill.radius).length)return skillFailure(attacker,skill,"SMOKE_FIELD_INVALID",center);
        if(!ctx.consumeSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
        EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"SELF"});
        ctx.activateSmoke(attacker,skill);
        return finishActiveSkill(attacker);
      }
      // The single canonical cast must validate its actual water/terrain
      // footprint before committing resources.
      if(skill.tsunamiWave&&!mapTargetTiles(attacker,skill).some(t=>t.x===center?.x&&t.y===center?.y))
        return skillFailure(attacker,skill,"TSUNAMI_TARGET_INVALID",center);
      const tsunamiPlan=skill.tsunamiWave?EnvironmentEngine.planTsunami(map,attacker,center,{
        width:skill.tsunamiWave.width,surfaceRise:skill.hydrologyFlood?.surfaceRise}):null;
      if(skill.tsunamiWave&&!tsunamiPlan?.cells.length)return skillFailure(attacker,skill,"TSUNAMI_PATH_BLOCKED",center);
      if(skill.whirlpool&&!HydrologyEngine.isWater(TacticalEngine.tile(map,center.x,center.y)))
        return skillFailure(attacker,skill,"WHIRLPOOL_REQUIRES_WATER",center);
      const transit=skill.shape==="LINE"&&skill.moveToTarget?lineTransitPlan(attacker,center,skill):null;
      if(skill.shape==="LINE"&&skill.moveToTarget&&!transit)return skillFailure(attacker,skill,"NO_LEGAL_LINE_LANDING",center);
      // The host and PVP must validate the same leap landing as the aim UI
      // BEFORE rage is spent, including team vision and occupied/blocked tiles.
      if(skill.jumpShockwave){
        const aimedTile=center;
        if(!mapTargetTiles(attacker,skill).some(t=>t.x===aimedTile.x&&t.y===aimedTile.y))
          return skillFailure(attacker,skill,"NO_LEGAL_LEAP_LANDING",aimedTile);
        const occupant=ctx.unitAt(aimedTile.x,aimedTile.y);
        if(occupant){
          const landing=jumpShockwaveLanding(attacker,occupant,skill);
          if(!landing)return skillFailure(attacker,skill,"NO_LEGAL_LEAP_LANDING",aimedTile);
          // Use the *actual landing* as the center of the quake, not the
          // occupied target tile. The target lies in its radius-one footprint.
          center=landing;
        }
      }
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",center);
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      EffectEngine.interruptChannel(attacker,"ACTION");
      skill=ctx.effectiveSkill(attacker,skill);
      // One official probabilistic roll per AREA magic cast, before its Sanity cost.
      const sanityMisfire=skill.areaDamage?.mode==="MAGIC_POWER"&&
        UnitRuntimeEngine.rollSanityMisfire(attacker,skill,ctx.random);
      UnitRuntimeEngine.beginBloodTransaction(attacker);
      const spent=ctx.consumeSkill(attacker,skill);
      if(!spent){UnitRuntimeEngine.endBloodTransaction(attacker);return false;}
      const bloodMult=UnitRuntimeEngine.attackEnhancement(attacker,skill);
      // One bow enchant per committed fan attack; never one charge per victim.
      const fanEnchantment=skill.fanShot?globalThis.EffectEngine?.consumeWeaponEnchantment?.(attacker,skill.weapon)||null:null;
      TacticalEngine.faceToward(attacker,center);
      if(skill.jumpShockwave){
        const landing=TacticalEngine.tile(map,center.x,center.y),previous={x:attacker.x,y:attacker.y,z:attacker.z};
        // Commit legal leap BEFORE quake damage. One action and one resource spend.
        if(!landing||ctx.unitAt(landing.x,landing.y)||
           !TacticalEngine.canOccupyTerrain(attacker,landing)||
           TacticalEngine.isBlockedByObject(map,landing.x,landing.y,attacker))
          throw new Error('Validated jump shockwave landing lost during commit.');
        attacker.x=landing.x;attacker.y=landing.y;
        if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(attacker,landing);
        else attacker.z=Number(TacticalEngine.elevation(landing)||0);
        // Real airtime is an authored WALK presentation on the existing
        // animation queue. Arc clearance derives from the live 3D body height
        // and BOTH terrain elevations, not a flat fake 0.9-tile bounce.
        const startZ=Number(previous.z??0),endZ=Number(attacker.z??0);
        const bodyHeight=Number(globalThis.VerticalMobilityEngine?.bodyHeight?.(attacker)??2);
        const arcHeight=Math.max(0,bodyHeight)+Math.max(0,Math.max(startZ,endZ)-(startZ+endZ)/2);
        globalThis.UnitAnimationEngine?.emitMove?.(attacker,{from:previous,path:[
          previous,{x:attacker.x,y:attacker.y,z:attacker.z}],kind:'LEAP',arcHeight,duration:750});
        ctx.enterTile(attacker);
        if(!attacker.alive)return finishActiveSkill(attacker);
        ctx.pushLog(`${attacker.character.name} 以 ${skill.name} 躍至 (${attacker.x},${attacker.y})。`,'BATTLE');
      }
      const fanAffected=skill.fanShot?TacticalEngine.fanTiles(map,attacker,center,skill.fanShot):null;
      // Present the validated landing without changing the authored hit center.
      // Browser and headless PVP use the SAME canonical LINE transit plan.
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,center,skill,{targetKind:"MAP",
        projectileKind:attackWeaponFor(attacker,skill)?.weaponKind||null,
        landingX:transit?.landing?.x??null,landingY:transit?.landing?.y??null,
        fanTargetCells:fanAffected?.map(t=>({x:t.x,y:t.y}))||null,
        enchantmentElement:fanEnchantment?.element||null,
        ...(skill.alchemyCast?.mode==='BASIC'?{
          alchemyAffinity:skill.materialCost?.affinity||'NONE',
          alchemyQuality:skill.materialCost?.quality||'NORMAL',
          alchemyVariant:skill.variantId||'NORMAL'}:{})});
      if(skill.tsunamiWave){
        // Stage 1: contact and knockback, before adding water. This keeps
        // wave impact independent of the hydro's steady water depths.
        const pulse={type:"TSUNAMI_WAVE",sourceUnitId:attacker.id,sourceTeam:attacker.team,
          fronts:tsunamiPlan.fronts,cells:tsunamiPlan.cells.map(t=>({x:t.x,y:t.y})),
          dx:tsunamiPlan.dx,dy:tsunamiPlan.dy,shieldHp:Math.max(0,Math.round(Number(attacker.character?.combat?.matk||0))),
          pushDistance:1,waveHeight:.8,durationMs:1600,contactProfile:"WAVE_VOLUME"};
        ctx.resolveEnvironmentEvents?.([pulse],{reason:`${skill.name} 迎面巨浪`});
        // Stage 2: deposit the original authored 1.25 rise as REAL water
        // volume along swept, traversable terrain, not a flat surface cap.
        const floodEvents=[],rise=Math.max(0,Number(skill.hydrologyFlood?.surfaceRise||0)),
          fireKeys=EnvironmentEngine.largeFireKeys(environmentState);
        for(const tile of tsunamiPlan.cells){
          const remaining=EnvironmentEngine.exchangeWaterFire(map,environmentState,tile,rise,floodEvents,{source:skill.id,clusterKeys:fireKeys});
          if(remaining>0)HydrologyEngine.addWater(tile,remaining,floodEvents);
        }
        HydrologyEngine.redistribute(map,{source:skill.id,events:floodEvents});
        EnvironmentEngine.resolveStandingWaterFire(map,environmentState,floodEvents,{source:skill.id});
        floodEvents.forEach(ctx.logEnvironmentEvent);
        ctx.resolveEnvironmentEvents?.(floodEvents,{reason:`${skill.name} 浪後淹水`});
        ctx.pushLog(`${attacker.character.name} 施放海嘯｜浪牆寬度 ${skill.tsunamiWave.width}、沿地形推進 ${tsunamiPlan.cells.length} 格。`,"BATTLE");
        UnitRuntimeEngine.endBloodTransaction(attacker);
        return finishActiveSkill(attacker);
      }
      if(skill.environmentSpell==='TORNADO'){
        if(!environmentState){UnitRuntimeEngine.endBloodTransaction(attacker);return skillFailure(attacker,skill,"ENVIRONMENT_UNAVAILABLE",center);}
        const cardEffect=CardDatabase.get('tornado_card')?.effect;
        // One card-owned AREA_PUSH profile: identical five-cell footprint,
        // cluster geometry, contact damage, air lift and horizontal displacement.
        // The druid already spent MP above; never spend the card's crystals.
        if(cardEffect?.type!=='AREA_PUSH'||Number(skill.radius)!==Number(cardEffect.radius))
          throw Error('CANONICAL_TORNADO_CARD_EFFECT_MISMATCH');
        const affected=ctx.aoeTiles(center,Number(cardEffect.radius));
        const effect=AreaSpellMechanics.resolveAreaPush({map,environmentState,center,
          affected,effect:cardEffect,name:skill.name,unitAt:ctx.unitAt,
          applyForcedMovement:ctx.applyForcedMovement,logEnvironmentEvent:ctx.logEnvironmentEvent,
          resolveEnvironmentEvents:ctx.resolveEnvironmentEvents,pushLog:ctx.pushLog});
        ctx.pushLog(`${attacker.character.name} 施放${skill.name}｜與卡牌相同的 ${effect.affectedTiles} 格龍捲風｜接觸 ${effect.contacts} 名單位。`,"BATTLE");
        UnitRuntimeEngine.endBloodTransaction(attacker);
        return finishActiveSkill(attacker);
      }
      if(skill.whirlpool){
        if(!environmentState||!HydrologyEngine.isWater(TacticalEngine.tile(map,center.x,center.y))){
          UnitRuntimeEngine.endBloodTransaction(attacker);return skillFailure(attacker,skill,"WHIRLPOOL_REQUIRES_WATER",center);
        }
        const events=EnvironmentEngine.createWhirlpool(environmentState,map,center.x,center.y,{
          duration:skill.whirlpool.duration,radius:skill.radius,sourceTeam:attacker.team,
          sourceUnitId:attacker.id,onlyEnemies:skill.whirlpool.onlyEnemies===true,damage:0
        });
        events.forEach(ctx.logEnvironmentEvent);
        ctx.resolveEnvironmentEvents?.(events,{reason:`${skill.name} 形成漩渦`});
        UnitRuntimeEngine.endBloodTransaction(attacker);
        return finishActiveSkill(attacker);
      }
      if(skill.trapPlacement&&environmentState&&globalThis.EnvironmentEngine?.createTrap){
        const trap=EnvironmentEngine.createTrap(environmentState,center.x,center.y,{...skill.trapPlacement,sourceTeam:attacker.team,sourceUnitId:attacker.id});
        ctx.pushLog(`${attacker.character.name} 在 (${center.x},${center.y}) 設置「${trap?.name||skill.name}」。`,"BATTLE");
        UnitRuntimeEngine.endBloodTransaction(attacker);return finishActiveSkill(attacker);
      }
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      // A LINE sword strike is one attack event regardless of how many units
      // are crossed. A committed strike spends exactly one weapon enchant.
      const enchantment=skill.shape==="LINE"?globalThis.EffectEngine?.consumeWeaponEnchantment?.(attacker,skill.weapon)||null:null;
      const enchantImpacts=[];
      const affected=transit?transit.affected:TacticalEngine.areaImpactTiles(map,attacker,center,skill);
      if(skill.shape==="LINE"){
        const hitUnitIds=new Set();
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);
          if(!occupant||occupant.team===attacker.team||hitUnitIds.has(occupant.id))return;
          hitUnitIds.add(occupant.id);
          const distance=Math.abs(attacker.x-occupant.x)+Math.abs(attacker.y-occupant.y);
          const result=BattleEngine.calculate(attacker.character,occupant.character,skill,{distance,random:ctx.random});
          if(!result.hit){ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");return;}
          // LINE follows the same physical / elemental damage ownership as
          // BattleResolution. Different types cannot share one shield pass or
          // a critical roll merely because they originate from one strike.
          const magicalCrit=!!enchantment&&(typeof ctx.random==="function"?ctx.random():Math.random())*100<BattleEngine.critChance(attacker.character,skill);
          const bonus=enchantment?BattleResolution.enchantmentMagicDamage(attacker,occupant,enchantment,magicalCrit,skill):0;
          const base=Math.max(0,Number(result.damage||0));
          result.enchantmentDamage=bonus;
          result.magicCrit=magicalCrit;
          if(enchantment)enchantImpacts.push({enchantment,result,target:occupant});
          const physicalRaw=result.type==="MAGIC"?0:Math.round(base*bloodMult);
          const magicRaw=(result.type==="MAGIC"?Math.round(base*bloodMult):0)+Math.round(bonus*bloodMult);
          result.damage=physicalRaw+magicRaw;
          const hpBefore=Math.max(0,Number(occupant.hp||0));
          const physical=EffectEngine.applyDamage(occupant,occupant.hallucination?hpBefore:physicalRaw,{source:attacker,damageType:"PHYSICAL"});
          const magic=EffectEngine.applyDamage(occupant,occupant.hallucination?0:magicRaw,{source:attacker,damageType:"MAGIC"});
          const hpLoss=Number(physical.hpLoss||0)+Number(magic.hpLoss||0),absorbed=Number(physical.absorbed||0)+Number(magic.absorbed||0);
          if(hpLoss>0)globalThis.UnitAnimationEngine?.emitResolvedHit?.(occupant,{damage:hpLoss,
            components:{physical:physical.hpLoss,magic:magic.hpLoss},
            criticalComponents:{physical:result.type!=="MAGIC"&&result.crit===true,magic:result.type==="MAGIC"&&result.crit===true||magicalCrit},
            element:result.el||skill.element,componentElements:{physical:result.type==="MAGIC"?null:result.el||skill.element,magic:enchantment?.element||(result.type==="MAGIC"?result.el||skill.element:null)},skillId:skill.id});
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} ${hpLoss} 傷害${absorbed?`｜護盾吸收 ${absorbed}`:""}｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
          else if(hpLoss>0)globalThis.UnitAnimationEngine?.emitHit?.(occupant,{sourceId:attacker.id,skillId:skill.id,damage:hpLoss});
        });
        if(enchantImpacts.length)resolveEnchantmentImpacts(enchantImpacts);
      }
      if(['MAGIC_POWER','PHYSICAL_VOLLEY','PHYSICAL_IMPACT','PHYSICAL_SWEEP'].includes(skill.areaDamage?.mode)){
        let friendlyHpLoss=0;
        // One actual outcome for each unit in the canonical footprint. The
        // Babylon arrow count is presentation-only and never implies damage.
        const summary={inArea:0,hit:0,miss:0,blocked:0,damaged:0,hpLoss:0};
        const contactTiles=new Map();
        for(const tile of affected){
          const unit=ctx.unitAt(tile.x,tile.y);if(!unit?.alive)continue;
          const previous=contactTiles.get(unit.id);
          if(!previous||(tile.x===center.x&&tile.y===center.y))contactTiles.set(unit.id,tile);
        }
        [...contactTiles.values()].forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);if(!occupant?.alive)return;
          const relation=String(skill.areaDamage.relation||"ENEMY").toUpperCase();
          // A misfired ENEMY area spell still hits real enemies and may also
          // strike friendlies in its *actual* footprint; never hit the caster.
          if(relation==="ENEMY"&&occupant.id===attacker.id)return;
          if(relation==="ENEMY"&&occupant.team===attacker.team&&!sanityMisfire)return;
          if(relation==="ALLY"&&occupant.team!==attacker.team)return;
          if(skill.areaDamage.requiredEffectTag&&!EffectEngine.state(occupant).some(e=>e.tags?.includes(skill.areaDamage.requiredEffectTag)))return;
          summary.inArea++;
          // Area magic cannot bypass the ally-facing Holy Wing Wall. Friendlies
          // can still shoot/counter outward through it using the same rule.
          if(globalThis.AngelWingBarrierEngine?.blocksIncoming?.(map,attacker,occupant,skill)||
             skill.fanShot&&!TacticalEngine.hasLineOfSight(map,attacker,occupant,
               {...skill,target:"ENEMY",targetType:"SINGLE"},environmentState)){
            summary.blocked++;
            globalThis.UnitAnimationEngine?.emitOutcome?.(occupant,"BLOCK");
            ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} 被障礙阻擋。`,"BATTLE");
            return;
          }
          const atCenter=tile.x===center.x&&tile.y===center.y;
          const mult=atCenter?Math.max(0,Number(skill.areaDamage.centerMultiplier||1)):1;
          const attackSkill={...skill,power:Number(skill.power||0)*mult,target:"ENEMY",targetType:"SINGLE"};
          const distance=Math.abs(attacker.x-occupant.x)+Math.abs(attacker.y-occupant.y);
          // AREA_CONTACT is authored in SkillDatabase: an actual ground-covered
          // enemy cannot 'dodge' the entire raining spell as a single arrow.
          // This does not bypass MDEF, damage reductions, shields or barriers.
          const contact=skill.areaDamage.hitRule==="AREA_CONTACT"||globalThis.CombatContactRules?.isPureMagic?.(attacker,skill)===true;
          const result=BattleEngine.calculate(attacker.character,occupant.character,
            attackSkill,{distance,random:ctx.random,forceHit:contact});
          if(!result.hit){
            summary.miss++;
            globalThis.UnitAnimationEngine?.emitOutcome?.(occupant,"MISS");
            ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");
            return;
          }
          summary.hit++;
          result.damage=Math.round(result.damage*bloodMult);
          const hpBefore=Math.max(0,Number(occupant.hp||0));
          const fanMagicCrit=!!skill.fanShot&&ctx.random()*100<BattleEngine.critChance(attacker.character,skill);
          // Do not turn a physical arrow into MAGIC: use official dual-damage shields.
          const soulBonus=skill.fanShot?BattleResolution.previewInherentBonus(attacker,occupant,skill,{critical:fanMagicCrit}):0;
          const enchantBonus=skill.fanShot&&fanEnchantment?
            BattleResolution.enchantmentMagicDamage(attacker,occupant,fanEnchantment,fanMagicCrit,skill):0;
          const arrowPhysical=skill.fanShot&&result.type!=="MAGIC"?result.damage:0;
          const arrowMagic=skill.fanShot?Math.round((soulBonus+enchantBonus)*bloodMult):0;
          let fanPhysicalHpLoss=0,fanMagicHpLoss=0;
          const shield=skill.fanShot?(()=>{
            const physical=EffectEngine.applyDamage(occupant,occupant.hallucination?hpBefore:arrowPhysical,{source:attacker,damageType:"PHYSICAL"});
            const magic=EffectEngine.applyDamage(occupant,occupant.hallucination?0:arrowMagic,{source:attacker,damageType:"MAGIC"});
            fanPhysicalHpLoss=Number(physical.hpLoss||0);
            fanMagicHpLoss=Number(magic.hpLoss||0);
            result.weaponDamage=arrowPhysical;
            result.inherentMagicDamage=Math.round(soulBonus*bloodMult);
            result.enchantmentDamage=Math.round(enchantBonus*bloodMult);
            result.damage=arrowPhysical+arrowMagic;
            return{absorbed:Number(physical.absorbed||0)+Number(magic.absorbed||0)};
          })():EffectEngine.applyDamage(occupant,occupant.hallucination?hpBefore:result.damage,
            {source:attacker,damageType:result.type==="MAGIC"?"MAGIC":"PHYSICAL"});
          const hpLoss=Math.max(0,hpBefore-occupant.hp);
          summary.hpLoss+=hpLoss;
          if(sanityMisfire&&occupant.team===attacker.team)friendlyHpLoss+=hpLoss;
          if(hpLoss>0){
            summary.damaged++;
            globalThis.UnitAnimationEngine?.emitResolvedHit?.(occupant,{
              damage:hpLoss,critical:result.crit===true||fanMagicCrit,
              components:skill.fanShot?{physical:fanPhysicalHpLoss,magic:fanMagicHpLoss}:
                BattleResolution.splitActualHpLoss(result,hpLoss),
              criticalComponents:skill.fanShot?{physical:result.crit===true,magic:fanMagicCrit}:null,
              componentElements:skill.fanShot?{physical:skill.element,
                magic:soulBonus>0?"NATURE":fanEnchantment?.element||null}:null,
              element:skill.element,skillId:skill.id});
          }else{
            // All the magic can be absorbed by shields, immunity or defenses.
            // This is a BLOCK result, never an invented zero-damage hit.
            summary.blocked++;
            globalThis.UnitAnimationEngine?.emitOutcome?.(occupant,"BLOCK");
          }
          if(hpLoss>0&&occupant.hp>0&&Array.isArray(skill.statusEffects)){
            for(const status of skill.statusEffects){
              const chance=Math.max(0,Math.min(100,Number(status.chance??100)));
              // Offline battles have no injected RNG callback; PvP does.
              // A 100% bleed never needs a random roll.
              if(chance<100&&(typeof ctx.random==="function"?ctx.random():Math.random())*100>=chance)continue;
              const {chance:ignoredChance,...effect}=status;
              const applied=EffectEngine.apply({source:attacker,target:occupant,effect});
              if(applied?.applied)ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} 附加 ${effect.name||effect.id} ${effect.duration||0} 回合。`,"BATTLE");
            }
          }
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name}${atCenter?"・中心":""} ${hpLoss} HP 傷害${shield.absorbed?`｜護盾吸收 ${shield.absorbed}`:""}｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
          else if(hpLoss>0){
            globalThis.UnitAnimationEngine?.emitHit?.(occupant,
              {sourceId:attacker.id,skillId:skill.id,damage:hpLoss});
            if(skill.jumpShockwave&&globalThis.PostEngagementEngine?.forcedMove){
              const rageProfile=globalThis.ResourceEngine?.RESOURCE_PROFILES?.rage;
              const lift=Number(rageProfile?.shockwaveLift||0);
              const distance=Number(rageProfile?.shockwavePushDistance||0);
              // Reuse Starfall shockwave axis rules: horizontal throw is not
              // canceled by armor weight; vertical lift still checks weight.
              // The existing trajectory/collision/landing engines own results.
              const effect={type:'KNOCKBACK',distance,lift,
                resistAxes:{horizontal:false,vertical:true}};
              const move=PostEngagementEngine.forcedMove({map,units:state().units,
                source:attacker,target:occupant,effect});
              ctx.logPostEffect?.({source:attacker,target:occupant,effect,result:move});
              UnitRuntimeEngine.onRageForcedLanding(attacker,occupant,move);
              if(move.defeated)ctx.handleDefeated(occupant,attacker,skill);
            }
          }
        });
        if(sanityMisfire&&friendlyHpLoss>0){
          const manaRestored=UnitRuntimeEngine.sanityBacklashRefund(attacker,{cost:spent?.cost||0},friendlyHpLoss);
          ctx.pushLog(`${attacker.character.name}｜認知失控誤傷友軍 ${friendlyHpLoss} HP；認知反噬回復 ${manaRestored} MP。`,"BATTLE");
          if(manaRestored>0)globalThis.UnitAnimationEngine?.emitPresentation?.("VELSA_BACKLASH",{
            unitId:attacker.id,x:attacker.x,y:attacker.y,
            targetX:center.x,targetY:center.y,manaRestored,friendlyHpLoss,skillId:skill.id});
        }
        ctx.pushLog(`${attacker.character.name}｜${skill.name}：範圍內 ${summary.inArea} 名目標，`+
          `命中 ${summary.hit}、MISS ${summary.miss}、阻擋／吸收 ${summary.blocked}、`+
          `實際 HP 傷害 ${summary.hpLoss}。`,"BATTLE");
      }
      if(skill.aoeDamage){
        const damagedUnitIds=new Set();
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);if(!occupant?.alive||damagedUnitIds.has(occupant.id))return;
          damagedUnitIds.add(occupant.id);
          const dealt=EffectEngine.applyDamage(occupant,Math.round(Number(skill.aoeDamage)*bloodMult),{source:attacker}).hpLoss;
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} ${dealt} 傷害。`,"BATTLE");
          if(occupant.hp<=0){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
        });
      }
      applyMapEffects(attacker,affected,skill);
      // Card Starfall owns terrain forces + the independent outer shockwave.
      // The druid's primary footprint and magic damage stay with SkillDatabase
      // and the existing MAGIC_POWER reducer above (no extra fixed 100 hit).
      if(skill.id==='avreshi_starfall'){
        const cardEffect=CardDatabase.get('starfall_card')?.effect;
        if(cardEffect?.type!=='AREA_DAMAGE'||!cardEffect.shockwave)
          throw Error('CANONICAL_STARFALL_CARD_EFFECT_UNAVAILABLE');
        const meteorEvents=AreaSpellMechanics.applyTerrainImpact({map,environmentState,
          affected,forces:cardEffect.forces||[],logEnvironmentEvent:ctx.logEnvironmentEvent});
        AreaSpellMechanics.resolveShockwave({center,innerRadius:Number(skill.radius),
          shockwave:cardEffect.shockwave,aoeTiles:ctx.aoeTiles,unitAt:ctx.unitAt,
          applyForcedMovement:ctx.applyForcedMovement,name:skill.name,pushLog:ctx.pushLog});
        ctx.resolveEnvironmentEvents?.(meteorEvents,{reason:`${skill.name} 引發環境連鎖`});
      }
      const environmentEvents=[];
      if(skill?.alchemyCast?.mode==='BASIC'&&skill.id==='alchemy_explosion'){
        if(skill.alchemyFreezeWater){
          for(const tile of affected.filter(t=>HydrologyEngine.isWater(t))){
            const before=Math.max(0,Number(tile.iceThickness||0));
            tile.iceThickness=Math.min(Number(tile.waterDepth||0),Math.max(before,.65));
            globalThis.ClimateEngine?.syncTileVisuals?.(environmentState,tile);
            environmentEvents.push({type:'ICE_FORMED',x:tile.x,y:tile.y,iceThickness:tile.iceThickness,source:skill.id});
          }
        }
        if(skill.alchemyConductWater&&EnvironmentEngine.isConductive(map,environmentState,center.x,center.y)){
          const extra=EnvironmentEngine.apply({map,state:environmentState,x:center.x,y:center.y,forces:['THUNDER']});
          environmentEvents.push(...extra);
        }
        if(skill.alchemyWaterPulse){
          const watery=affected.filter(t=>HydrologyEngine.isWater(t));
          if(watery.length)environmentEvents.push(...HydrologyEngine.floodArea(map,watery,{surfaceRise:.25,source:skill.id}));
        }
        if(skill.alchemyKnockback){
          for(const victim of state().units.filter(u=>u.alive&&u.team!==attacker.team&&
            affected.some(t=>TacticalEngine.occupiesCell(u,t.x,t.y)))){
            ctx.applyForcedMovement(center,victim,Number(skill.alchemyKnockback),
              {name:skill.name,damage:0,damageType:'PHYSICAL'});
          }
        }
      }
      affected.forEach(tile=>{
        const events=environmentState&&skill.environmentForces
          ?EnvironmentEngine.apply({map,state:environmentState,x:tile.x,y:tile.y,forces:skill.environmentForces})
          :[];
        environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);
      });
      if(skill.hydrologyFlood&&globalThis.HydrologyEngine?.floodArea){
        const clusterKeys=EnvironmentEngine.largeFireKeys(environmentState);
        const floodEvents=HydrologyEngine.floodArea(map,affected,{surfaceRise:Number(skill.hydrologyFlood.surfaceRise||1),source:skill.id,
          intercept:(tile,volume,events)=>EnvironmentEngine.exchangeWaterFire(map,environmentState,tile,volume,events,{source:skill.id,clusterKeys})});
        EnvironmentEngine.resolveStandingWaterFire(map,environmentState,floodEvents,{source:skill.id});
        environmentEvents.push(...floodEvents);floodEvents.forEach(ctx.logEnvironmentEvent);
        const resolved=floodEvents.find(event=>event.type==="FLOOD_AREA_RESOLVED"),wetCount=resolved?.tiles?.filter(tile=>Number(tile.waterDepth||0)>0).length||0;
        ctx.pushLog(`${skill.name}｜注入 Water Volume ${Number(resolved?.injectedVolume||0).toFixed(2)}｜${wetCount} 格形成／加深水域。`,"SYSTEM");
      }
      ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${skill.name} 引發環境連鎖`});
      const burnedUnitIds=new Set();
      affected.forEach(tile=>{
        if(!EnvironmentEngine.effectAt(environmentState,tile.x,tile.y).some(effect=>effect.type===EnvironmentEngine.EFFECT.BURNING))return;
        const occupant=ctx.unitAt(tile.x,tile.y);
        if(occupant&&!burnedUnitIds.has(occupant.id)){
          burnedUnitIds.add(occupant.id);
          ctx.applyEnvironmentHazardToUnit(occupant,{reason:"遭燃燒地形波及"});
        }
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
      }else if(skill.moveToTarget&&!skill.jumpShockwave&&!ctx.unitAt(center.x,center.y)){
        if(skill.shape==="W_STEP"){
          attacker.x=center.x;attacker.y=center.y;attacker.z=Number(TacticalEngine.elevation(TacticalEngine.tile(map,center.x,center.y))||0);ctx.enterTile(attacker);
          ctx.pushLog(`${attacker.character.name} 隨 ${skill.name} 進行空間移動至 (${center.x},${center.y})。`,"BATTLE");
        }else{
          const moveResult=ctx.traverseUnitPath(attacker,ctx.lineTiles(attacker,center),{kind:"UNIT"});
          ctx.pushLog(`${attacker.character.name} 隨 ${skill.name} ${moveResult.completed?`移動至 (${attacker.x},${attacker.y})`:"移動途中受到環境影響而中斷"}。`,"BATTLE");
        }
      }
      UnitRuntimeEngine.endBloodTransaction(attacker);
      if(ctx.checkMatchEnd()){ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.render();return true;}
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
      return true;
    }

    function cancelPendingMove(){
      const {selected}=state();
      if(!selected||pendingMove?.unitId!==selected.id||selected.acted)return false;
      if(!restorePendingMove(selected,pendingMove,{units:state().units,map:state().map}))return false;
      pendingMove=null;ctx.setCommandPanelCollapsed(false);ctx.setMode("command");
      ctx.pushLog(`${selected.character.name} 取消移動，返回原位置。`,"SYSTEM");ctx.render();ctx.emitState();return true;
    }

    function backFromTargeting(){
      if(enchantmentFollowup){ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("enchant-followup");ctx.render();return true;}
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
      if(enchantmentFollowup?.unitId===attacker.id)enchantmentFollowup=null;
      commitPendingMove(attacker);
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.setSelectedSkillVariant(null);ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return true;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();return true;
    }

    function logAppliedEffect(skill,target,effect,result){
      if(!result?.applied){if(result?.reason==="NEGATIVE_EFFECT_GUARD")ctx.pushLog(`${target.character.name} 的恩寵抵消了「${effect.name||effect.id||effect.type}」。`,"BATTLE");return;}
      if(effect.type==="HEAL")ctx.pushLog(`${skill.name} → ${target.character.name}｜${result.critical?"治療暴擊｜":""}回復 ${result.amount||0} HP${result.shieldGranted?`｜獲得聖護 ${result.shieldGranted}`:""}｜HP ${target.hp}。`,"BATTLE");
      else if(effect.type==="RESTORE_MANA")ctx.pushLog(`${skill.name} → ${target.character.name}｜回復 ${result.amount||0} MP。`,"BATTLE");
      else if(effect.type==="DISPEL_POSITIVE")ctx.pushLog(`${skill.name} → ${target.character.name}｜解除「${result.removedName}」${result.refundedMana?`｜回收 ${result.refundedMana} MP`:""}。`,"BATTLE");
      else if(effect.type==="DISPEL"&&result.restoredResource?.amount>0)
        ctx.pushLog(`${skill.name} → ${target.character.name}｜解除 ${result.removed||0} 項負面異常，恢復 ${result.restoredResource.amount} Sanity。`,"BATTLE");
      else if(effect.type==="SHIELD")ctx.pushLog(`${skill.name} → ${target.character.name}｜護盾 ${result.amount||0}。`,"BATTLE");
      else if(effect.type==="HEAL_OVER_TIME")ctx.pushLog(`${skill.name} → ${target.character.name}｜獲得持續治癒 ${effect.duration||0} 回合。`,"BATTLE");
    }

    function executeEffectSkill(attacker,target,skill,{buffId=null}={}){
      if(!canCommitActiveAction(attacker))return false;
      if(!globalThis.EffectEngine)return skillFailure(attacker,skill,"EFFECT_ENGINE_UNAVAILABLE",target);
      // Alchemy must not burn an ingredient and charge a full rune through a
      // formally useless recover-HP/MP cast. Other buffs may be refreshed.
      if(skill?.alchemyCast?.mode==='BASIC'&&skill.id==='alchemy_mana_stone'&&
        (!Number(target?.maxMana||0)||Number(target.mana||0)>=Number(target.maxMana||0)))
        return skillFailure(attacker,skill,'ALCHEMY_MANA_FULL',target);
      if(skill?.alchemyCast?.mode==='BASIC'&&skill.id==='alchemy_healing_potion'&&
        Number(target?.hp||0)>=Number(target?.character?.combat?.hp||0)&&
        !(skill.effects||[]).some(e=>e.type!=='HEAL'))
        return skillFailure(attacker,skill,'ALCHEMY_HP_FULL',target);
      if(skill?.dispelChoice==="POSITIVE"&&
        !EffectEngine.positiveBuffChoices(target).some(buff=>buff.id===buffId))
        return skillFailure(attacker,skill,"POSITIVE_BUFF_NOT_AVAILABLE",target);
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",target);
      globalThis.EffectEngine?.breakStealth?.(attacker,"ACTION");
      EffectEngine.interruptChannel(attacker,"ACTION");
      skill=ctx.effectiveSkill(attacker,skill);
      const astralHealEligible=skill?.astralGainTrigger==="EFFECTIVE_HEAL"&&
        target?.alive===true&&Number(target.hp||0)<Number(target.character?.combat?.hp||0)&&
        !globalThis.EffectEngine?.state?.(target)?.some(e=>e.id==="AVRESHI_REJUVENATION");
      if(skill.bloodBurst){
        const centers=EffectEngine.bloodBurstCenters(attacker,state().units,skill,{map:state().map,environmentState:state().environmentState});
        if(!centers.length)return skillFailure(attacker,skill,"NO_BLEEDING_ENEMIES",target);
        UnitRuntimeEngine.beginBloodTransaction(attacker);
        if(!ctx.consumeSkill(attacker,skill)){UnitRuntimeEngine.endBloodTransaction(attacker);return false;}
        const mult=UnitRuntimeEngine.attackEnhancement(attacker,skill);
        const {units}=state(),radius=Number(skill.range?.max||0);
        let hits=0,total=0;
        for(const center of centers){
          for(const victim of units){
            if(!victim.alive||victim.team===attacker.team||Math.abs(victim.x-center.x)+Math.abs(victim.y-center.y)>radius)continue;
            // Blood burst detonates an existing bleeding mark. It is not a new
            // weapon hit roll: the enemy was already found by the official
            // bloodBurstCenters query at cast time. Keep the shared damage,
            // critical, defense and shield formulas, but never turn a valid
            // detonation into a MISS because of ordinary attack accuracy.
            const roll=BattleEngine.calculate(attacker.character,victim.character,skill,{distance:Math.abs(attacker.x-victim.x)+Math.abs(attacker.y-victim.y),random:ctx.random,forceHit:true});
            const outcome=EffectEngine.applyDamage(victim,Math.round(roll.damage*mult),{source:attacker,damageType:"MAGIC"});
            total+=outcome.hpLoss;hits++;
            if(outcome.hpLoss)globalThis.UnitAnimationEngine?.emitResolvedHit?.(victim,{damage:outcome.hpLoss,critical:roll.crit===true,components:{physical:0,magic:outcome.hpLoss},criticalComponents:{physical:false,magic:roll.crit===true},element:skill.element,skillId:skill.id});
            if(victim.hp<=0){victim.alive=false;ctx.handleDefeated(victim,attacker,skill);}
          }
        }
        UnitRuntimeEngine.endBloodTransaction(attacker);
        globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"AOE",
          burstCenters:centers.map(center=>({unitId:center.id,x:center.x,y:center.y}))});
        ctx.pushLog(`${attacker.character.name} 血爆・暗屬性魔法｜${centers.length} 個流血爆點｜命中 ${hits} 次｜實際HP傷害 ${total}。`,"BATTLE");
        return finishActiveSkill(attacker);
      }
      UnitRuntimeEngine.beginBloodTransaction(attacker);
      const spent=ctx.consumeSkill(attacker,skill);
      if(!spent){UnitRuntimeEngine.endBloodTransaction(attacker);return false;}
      const bloodMult=UnitRuntimeEngine.attackEnhancement(attacker,skill);
      TacticalEngine.faceToward(attacker,target);
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,target,skill,{targetKind:"UNIT",
        ...(skill.alchemyCast?.mode==='BASIC'?{
          alchemyAffinity:skill.materialCost?.affinity||'NONE',
          alchemyQuality:skill.materialCost?.quality||'NORMAL',
          alchemyVariant:skill.variantId||'NORMAL'}:{})});
      const results=[];let healedCrit=false;
      if(skill.commandAura===true){
        const radius=rangerCommandRadius(attacker);
        for(const member of state().units.filter(unit=>unit.alive&&unit.team===attacker.team&&
          rangerDistance(unit,attacker)<=radius)){
          for(const effect of skill.effects||[]){
            const r=EffectEngine.apply({source:attacker,target:member,effect});
            results.push(r);logAppliedEffect(skill,member,effect,r);
          }
        }
      }else if(Array.isArray(skill.relationEffects)){
        const rel=EffectEngine.relation(attacker,target);
        for(const effect of skill.relationEffects.filter(e=>e.relation===rel)){
          if(effect.type==="MAGIC_DAMAGE"){
            const attackSkill={...skill,power:Number(effect.power||1),attackType:"MAGIC",element:effect.element||"NONE",traitMultipliers:effect.traitMultipliers||{},weapon:effect.weapon||skill.weapon};
            const distance=Math.abs(attacker.x-target.x)+Math.abs(attacker.y-target.y);
            const result=BattleEngine.calculate(attacker.character,target.character,attackSkill,{distance,random:ctx.random});
            const hpBefore=Math.max(0,Number(target.hp||0));let dealt=0,absorbed=0;
            if(result.hit){const shield=EffectEngine.applyDamage(target,target.hallucination===true?hpBefore:Math.round(result.damage*bloodMult),{source:attacker,damageType:"MAGIC"});dealt=shield.damage;absorbed=shield.absorbed;if(target.hp===0)target.alive=false;}
            results.push({type:"MAGIC_DAMAGE",...result,damage:dealt,shieldAbsorbed:absorbed});if(result.hit&&Number(dealt||0)>0)globalThis.UnitAnimationEngine?.emitResolvedHit?.(target,{damage:Math.min(hpBefore,Number(dealt||0)),critical:result.crit===true,components:{physical:0}});
            ctx.pushLog(`${attacker.character.name} → ${target.character.name}｜${skill.name} ${result.hit?dealt+" 傷害":"MISS"}${absorbed?`｜護盾吸收 ${absorbed}`:""}｜HP ${target.hp}。`,"BATTLE");
            if(!target.alive)ctx.handleDefeated(target,attacker,skill);
            else if(result.hit&&Number(dealt||0)>0)globalThis.UnitAnimationEngine?.emitHit?.(target,{sourceId:attacker.id,skillId:skill.id,damage:Number(dealt||0)});
          }else{
            const r=EffectEngine.apply({source:attacker,target,effect});results.push(r);if(r?.critical)healedCrit=true;logAppliedEffect(skill,target,effect,r);
          }
        }
      }else if(Array.isArray(skill.effects)){
        for(const effect of skill.effects){const selected=effect.type==="DISPEL_POSITIVE"?{...effect,buffId}:effect;const r=EffectEngine.apply({source:attacker,target,effect:selected});results.push(r);if(r?.critical)healedCrit=true;logAppliedEffect(skill,target,selected,r);}
      }
      if(skill?.alchemyCast?.mode==='BASIC'&&skill.alchemySplashMana&&skill.id==='alchemy_mana_stone'){
        for(const ally of state().units.filter(u=>u.alive&&u.team===attacker.team&&u.id!==target.id&&
          Math.abs(u.x-target.x)+Math.abs(u.y-target.y)<=1&&Number(u.maxMana||0)>Number(u.mana||0))){
          const result=EffectEngine.apply({source:attacker,target:ally,effect:{type:'RESTORE_MANA',amount:skill.alchemySplashMana}});
          logAppliedEffect(skill,ally,{type:'RESTORE_MANA'},result);
        }
      }
      // Successful fresh HoT application on an injured ally only: future
      // ticks and reapplications of an existing HoT never award Astral Power.
      if(astralHealEligible&&results.some(r=>r?.applied===true))
        UnitRuntimeEngine.gainAstralPower(attacker,skill,state().environmentState);
      applyPassiveSkillTriggers(attacker,target,skill);
      const refunded=UnitRuntimeEngine.criticalManaRefund(attacker,skill,spent,healedCrit);
      if(refunded>0)ctx.pushLog(`${attacker.character.name}｜${skill.name} 治療暴擊，聖痕返還 ${refunded} MP。`,"BATTLE");
      UnitRuntimeEngine.endBloodTransaction(attacker);return finishActiveSkill(attacker);
    }

    // Resolve a legal landing without changing any gameplay state. The charge
    // confirmation/ally-support screen is a preview, never an executed move.
    // This is also shared with the canonical PvP charge commit path below.
    function planApproachForSkill(attacker,defender,skill){
      if(!skill?.approach||!attacker?.alive||!defender?.alive||attacker.acted||attacker.moved)return null;
      const {map,units,environmentState}=state();
      if(!TacticalEngine.canTarget(map,attacker,defender,skill,environmentState))return null;
      const stop=Math.max(1,Number(skill.approach.stopDistance||1));
      const candidates=map.tiles.filter(t=>Math.abs(t.x-defender.x)+Math.abs(t.y-defender.y)===stop&&
        !ctx.unitAt(t.x,t.y));
      const paths=candidates.map(t=>TacticalEngine.pathTo(map,units,{...attacker},t.x,t.y))
        .filter(path=>path.length).sort((a,b)=>a.length-b.length);
      return paths[0]||null;
    }
    function committedApproachSkill(skill){
      return {...skill,range:{min:1,max:1},approach:null,approachCommitted:true};
    }
    function approachForSkill(attacker,defender,skill){
      if(!skill?.approach)return true;
      const path=planApproachForSkill(attacker,defender,skill);
      if(!path)return false;
      const result=ctx.traverseUnitPath(attacker,path,{kind:"UNIT"});
      if(!result.completed)return false;
      attacker.moved=true;
      ctx.pushLog(`${attacker.character.name} 以 ${skill.name} 衝至 ${defender.character.name} 身前。`,"BATTLE");
      return true;
    }

    function danceRadius(attacker){
      const config=globalThis.ResourceEngine?.RESOURCE_PROFILES?.reputation;
      const fame=Number(attacker?.resources?.reputation?.value||0);
      const thresholds=config?.rangeThresholds,radii=config?.rangeRadii;
      if(!Array.isArray(thresholds)||!Array.isArray(radii)||!thresholds.length||
         thresholds.length!==radii.length)throw Error("INVALID_REPUTATION_RANGE_PROFILE");
      let idx=0;for(let i=0;i<thresholds.length;i++)if(fame>=thresholds[i])idx=i;
      return Number(radii[idx]);
    }
    function earnPerformance(attacker,kind){
      if(!attacker?.character?.passives?.includes("STANDING_OVATION"))return 0;
      const amount=Number(globalThis.ResourceEngine?.RESOURCE_PROFILES?.reputation?.[kind]||0);
      return amount>0?UnitRuntimeEngine.changeResource(attacker,"reputation",amount):0;
    }
    function executeDanceAura(attacker,skill){
      if(!canCommitActiveAction(attacker)||!ctx.canUseSkill(attacker,skill))
        return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",attacker);
      const radius=danceRadius(attacker),friends=state().units.filter(u=>u.alive&&u.team===attacker.team&&
        Math.abs(u.x-attacker.x)+Math.abs(u.y-attacker.y)<=radius);
      if(!ctx.consumeSkill(attacker,skill))return false;
      EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
      let effective=0;
      for(const friend of friends){
        if(skill.danceAura.kind==="INSPIRE"){
          const result=EffectEngine.apply({source:attacker,target:friend,effect:skill.danceAura.effect});
          if(result?.applied&&friend.id!==attacker.id)effective++;
        }else if(skill.danceAura.kind==="PURIFY"){
          const result=EffectEngine.apply({source:attacker,target:friend,effect:skill.danceAura.effect});
          if(result?.applied&&Number(result.removed||0)>0){effective++;}
        }
      }
      if(effective)earnPerformance(attacker,"supportGain");
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,attacker,skill,{targetKind:"SELF",danceRadius:radius});
      ctx.pushLog(`${attacker.character.name}｜${skill.name}：聲望半徑 ${radius} 格，影響 ${effective} 名友軍。`,"BATTLE");
      return finishActiveSkill(attacker);
    }
    function executeDanceOfDeath(attacker,skill){
      if(!canCommitActiveAction(attacker)||!ctx.canUseSkill(attacker,skill))
        return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",attacker);
      const {map,units,environmentState}=state(),radius=danceRadius(attacker);
      const candidate=()=>{
        const enemies=units.filter(u=>u?.alive&&u.team!==attacker.team&&u.kind!=="CORE"&&
          Math.abs(u.x-attacker.x)+Math.abs(u.y-attacker.y)<=radius&&
          TacticalEngine.teamCanSee(map,units,attacker.team,u,environmentState));
        const possible=[];
        for(const target of enemies){
          const positions=(map.tiles||[]).filter(tile=>Math.abs(tile.x-target.x)+Math.abs(tile.y-target.y)===1);
          let best=null;
          for(const tile of positions){
            if(tile.x===attacker.x&&tile.y===attacker.y){best={target,path:[]};break;}
            const actorCopy={...attacker},path=TacticalEngine.pathTo(map,units,actorCopy,tile.x,tile.y);
            if(!path.length)continue;
            if(!best||path.length<best.path.length)best={target,path};
          }
          if(best)possible.push(best);
        }
        return possible.sort((a,b)=>Number(a.target.hp)-Number(b.target.hp)||
          a.path.length-b.path.length||String(a.target.id).localeCompare(String(b.target.id)))[0]||null;
      };
      if(!candidate())return skillFailure(attacker,skill,"NO_LEGAL_EXECUTION_TARGET",attacker);
      if(!ctx.consumeSkill(attacker,skill))return false;
      EffectEngine.breakStealth(attacker,"ACTION");EffectEngine.interruptChannel(attacker,"ACTION");
      let kills=0,strikes=0;
      while(attacker.alive){
        const step=candidate();if(!step)break;
        if(step.path.length){const moved=ctx.traverseUnitPath(attacker,step.path,{kind:"UNIT"});
          if(!moved?.completed||!attacker.alive)break;}
        if(Math.abs(attacker.x-step.target.x)+Math.abs(attacker.y-step.target.y)!==1)break;
        const strike={...skill,id:skill.id,target:"ENEMY",targetType:"SINGLE",range:{min:1,max:1},
          ...skill.deathDance.strike,deathDance:null,manaCost:0,
          deathDanceStep:strikes+1};
        const engagement=BattleResolution.resolve({map,units,environmentState,initiator:attacker,
          target:step.target,skill:strike,actions:[],reaction:null},
          {canUseSkill:()=>true,consumeSkill:()=>({cost:0,resources:{}}),
            onDefeated:ctx.handleDefeated,onAction:ctx.logBattleAction,onPostEffect:ctx.logPostEffect,
            onBackstep:(u,t)=>ctx.enterTile(u)});
        const result=engagement.results.find(e=>e.role==="INITIATOR");if(!result)break;
        strikes++;
        if(step.target.alive)break;
        kills++;earnPerformance(attacker,"deathKillGain");
        if(kills>=units.length)break;
      }
      ctx.pushLog(`${attacker.character.name}｜死亡之舞：${strikes} 次劍擊、擊殺 ${kills} 名敵軍。`,"BATTLE");
      return finishActiveSkill(attacker);
    }
    function executeChannelSkill(attacker,skill){
      if(!ctx.canUseSkill(attacker,skill))return skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",attacker);
      const rule=skill.channel;
      const result=EffectEngine.apply({source:attacker,target:attacker,effect:rule});
      if(!result?.applied)return skillFailure(attacker,skill,"CHANNEL_REJECTED",attacker);
      ctx.consumeSkill(attacker,skill);
      // First real SONG_CHANNEL pulse belongs to the cast, not to next
      // round's timer. PvP and local both use this official controller.
      const firstPulse=rule.type==="SONG_CHANNEL"
        ?EffectEngine.pulseSongOnCast(attacker,rule,{units:state().units}):null;
      globalThis.UnitAnimationEngine?.emitAction?.(attacker,attacker,skill,{targetKind:"SELF"});
      ctx.pushLog(`${attacker.character.name} 開始吟唱「${skill.name}」，最多持續 ${rule.duration} 回合；${firstPulse?`已立即作用於 ${firstPulse.affected.length} 名單位；`:""}移動或交戰時中斷。`,"BATTLE");
      return finishActiveSkill(attacker);
    }
    function prepareAttack(attacker,defender,skill,{confirmOrdinaryAttack=false}={}){
      if(!canCommitActiveAction(attacker))return false;
      const {map,units}=state();
      if(!ctx.canUseSkill(attacker,skill)){skillFailure(attacker,skill,"RESOURCE_OR_REQUIREMENT",defender);return;}
      // Self-centered physical sweeps commit on skill selection, just like
      // Blood Burst. A TILE/AOE aiming mode must never be entered here.
      if(skill.target==="SELF"&&skill.areaDamage?.mode==="PHYSICAL_SWEEP"&&
          skill.areaDamage.footprint==="ADJACENT_8")
        return executeMapSkill(attacker,{x:attacker.x,y:attacker.y},skill);
      if(skill.danceAura&&skill.target==="SELF")return executeDanceAura(attacker,skill);
      if(skill.deathDance&&skill.target==="SELF")return executeDanceOfDeath(attacker,skill);
      if((skill.sanctuary||skill.smokeField)&&skill.target==="SELF")return executeMapSkill(attacker,{x:attacker.x,y:attacker.y},skill);
      const approachPath=skill.approach?planApproachForSkill(attacker,defender,skill):null;
      if(skill.approach&&!approachPath){
        skillFailure(attacker,skill,"NO_APPROACH_PATH",defender);ctx.pushLog(`${skill.name} 無合法衝鋒路徑。`,"SYSTEM");ctx.render();return;
      }
      // A rescue charge has no combat/support confirmation and commits on target
      // selection. An assault does NOT: hold this original skill and preview
      // landing until the existing CONFIRM_ENGAGEMENT action is clicked.
      if(skill.approach&&(skill.effects||skill.relationEffects||skill.bloodBurst||skill.utilityAction||skill.channel)){
        if(!approachForSkill(attacker,defender,skill)){
          skillFailure(attacker,skill,"NO_APPROACH_PATH",defender);ctx.render();return;
        }
        skill=committedApproachSkill(skill);
      }
      if(skill.bloodShadow){
        const landing=bloodShadowLanding(attacker,defender);
        if(!landing)return skillFailure(attacker,skill,"NO_LEGAL_REAR_CELL",defender);
        // One authoritative rear-cell transit, before the attack resolution.
        // The destination is always validated by bloodShadowLanding; a unit
        // already standing on that cell may strike without changing position.
        const origin={x:attacker.x,y:attacker.y,z:attacker.z};
        const relocated=origin.x!==landing.x||origin.y!==landing.y;
        if(!pendingMove||pendingMove.unitId!==attacker.id)beginPendingMove(attacker);
        attacker.x=landing.x;attacker.y=landing.y;
        if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(attacker,landing);
        else attacker.z=Number(TacticalEngine.elevation(landing)||0);
        TacticalEngine.faceToward(attacker,defender);
        // Present a true teleport instead of treating the sudden coordinate
        // change as an ordinary walking animation. This is presentation-only.
        if(relocated)globalThis.UnitAnimationEngine?.emitMove?.(attacker,{from:origin,kind:"TELEPORT"});
        globalThis.CardTacticsDiagnostics?.gameAction?.("BLOOD_SHADOW_TRANSIT",{
          unitId:attacker.id,targetId:defender.id,
          from:{x:origin.x,y:origin.y},to:{x:attacker.x,y:attacker.y},
          distance:Math.abs(origin.x-attacker.x)+Math.abs(origin.y-attacker.y),relocated
        });
        ctx.enterTile(attacker);
        if(!attacker.alive)return finishActiveSkill(attacker);
        ctx.pushLog(relocated
          ?`${attacker.character.name} 血影瞬襲至 ${defender.character.name} 背後 (${origin.x},${origin.y}) → (${attacker.x},${attacker.y})。`
          :`${attacker.character.name} 已位於 ${defender.character.name} 背後，原地施展血影瞬襲。`,"BATTLE");
        return executeEngagement(attacker,defender,
          {...ctx.effectiveSkill(attacker,skill),visualOrigin:origin},[]);
      }
      if(skill.utilityAction){executeUtilitySkill(attacker,defender,skill);return;}
      if(skill.channel){executeChannelSkill(attacker,skill);return;}
      if(skill.effects||skill.relationEffects||skill.bloodBurst){executeEffectSkill(attacker,defender,skill);return;}
      skill=ctx.effectiveSkill(attacker,skill);
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      if(ctx.targetType(skill)!=="SINGLE"){executeEngagement(attacker,defender,skill,[]);return;}
      // Support reach is calculated at the projected charge destination. The
      // authoritative actor stays at the original tile until confirmation.
      const previewLanding=skill.approach?approachPath[approachPath.length-1]:null;
      const supportAnchor=previewLanding?{...attacker,x:previewLanding.x,y:previewLanding.y}:attacker;
      const candidates=BattleResolution.supportCandidates({units,initiator:supportAnchor,target:defender,canUseSkill:ctx.canUseSkill}).map(candidate=>({...candidate,skills:candidate.skills.filter(supportSkill=>TacticalEngine.canTarget(map,candidate.ally,defender,supportSkill,state().environmentState))})).filter(candidate=>candidate.skills.length);
      // Player selection confirms every ordinary unit attack (even without
      // support). Other callers keep the existing immediate-no-support path.
      // A skill requiring pre-engagement mutation has already been handled
      // above, before this confirmation branch: no UI-level skill exceptions.
      if(!confirmOrdinaryAttack&&!candidates.length){executeEngagement(attacker,defender,skill,[]);return;}
      ctx.setPendingEngagement({attacker,defender,skill,candidates,
        ...(previewLanding?{approachLanding:{x:previewLanding.x,y:previewLanding.y}}:{})});
      ctx.setSupportSelection(new Map());
      ctx.setMode("support-select");
      if(candidates.length)ctx.pushLog(`可選支援：${candidates.map(x=>x.ally.character.name).join("、")}`);
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
      if(!pendingEngagement)return false;
      const {attacker,defender,skill}=pendingEngagement;
      if(!canCommitActiveAction(attacker))return false;
      executeEngagement(attacker,defender,skill,selectedSupportActions());
    }

    function executeEngagement(attacker,defender,skill,actions,reaction=null){
      if(!canCommitActiveAction(attacker))return false;
      const {map,units}=state();
      // A charge is a single committed action. Never move on the target preview
      // or while the player is still selecting support/confirming the attack.
      if(skill.approach){
        if(!approachForSkill(attacker,defender,skill)){
          skillFailure(attacker,skill,"NO_APPROACH_PATH",defender);
          ctx.clearEngagement();ctx.setMode("attack");ctx.render();return false;
        }
        skill=committedApproachSkill(skill);
      }
      if(skill.danceSequence){
        const arc=TacticalEngine.relativeArc(defender,attacker);
        skill={...skill,danceReturn:arc==="BACK"&&attacker._dancePartnerId===defender.id};
      }
      const engagement=BattleResolution.resolve(
        {map,units,environmentState:state().environmentState,initiator:attacker,target:defender,skill,actions,reaction,
          autonomousReaction:!reaction&&!!(skill.ganfan||skill.danceSequence)&&attacker.team===ctx.TEAM.PLAYER&&defender.team!==ctx.TEAM.PLAYER},
        {canUseSkill:ctx.canUseSkill,consumeSkill:ctx.consumeSkill,onDefeated:ctx.handleDefeated,
          onAction:ctx.logBattleAction,onPostEffect:ctx.logPostEffect,
          onBackstep:(unit,tile)=>ctx.enterTile(unit)}
      );
      if(!engagement.results.length){skillFailure(attacker,skill,"RESOLUTION_EMPTY",defender);ctx.clearEngagement();ctx.setMode("command");ctx.render();return;}
      if(skill.verdictCross)PostEngagementEngine.resolveVerdictCross({
        attacker,defender,skill,engagement,units,
        random:ctx.random,onLog:ctx.pushLog,onDefeated:ctx.handleDefeated
      });
      if(skill.bloodShadow){
        const attack=engagement.results.find(entry=>entry.actor.id===attacker.id&&entry.skill.bloodShadow);
        const drained=Math.max(0,Number(attack?.result?.damage||0));
        if(drained>0){
          const healed=EffectEngine.heal(attacker,drained);
          const mana=UnitRuntimeEngine.restoreMana(attacker,Math.round(drained*.5));
          ctx.pushLog(`${attacker.character.name} 吸血 ${drained}｜回復 ${healed} HP、${mana} MP。`,"BATTLE");
          const options=EffectEngine.copyableSkills(defender,attacker);
          if(options.length){
            if(attacker.team===ctx.TEAM.PLAYER){
              // The blood-shadow teleport and damage are already committed.
              // Only the optional memory choice remains; cancelling a pending
              // ordinary move must not roll back a completed blood drain.
              commitPendingMove(attacker);
              ctx.setPendingCopySkill({attacker,target:defender,options});
              ctx.setMode("copy-skill-select");ctx.render();return true;
            }
            EffectEngine.rememberBloodSkill(attacker,options[0].id,defender);
          }
        }
      }
      commitPendingMove(attacker);
      if(enchantmentFollowup?.unitId===attacker.id)enchantmentFollowup=null;
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.clearEngagement();ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return true;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
      return true;
    }

    // Autonomous choices use the exact same commits, not player menus. No RNG
    // or resource writes are performed during enumeration by the AI controller.
    function executeAutonomousSkill({attacker,target,skill,center,weaponSlot,buffId}={}){
      if(!canCommitActiveAction(attacker)||!ctx.canUseSkill(attacker,skill))return false;
      const {map,units,environmentState}=state();
      if(weaponSlot){
        if(target?.id===attacker.id)return false; // self follow-up requires a separate legal attack choice
        return executeEnchantmentChoice(attacker,skill,target?.id,weaponSlot);
      }
      if(center){
        const self=skill.target==="SELF"&&center.x===attacker.x&&center.y===attacker.y;
        if(!self&&!mapTargetTiles(attacker,skill).some(t=>t.x===center.x&&t.y===center.y))return false;
        return executeMapSkill(attacker,center,skill);
      }
      if(!target?.alive||(!skill.bloodBurst&&!TacticalEngine.canTarget(map,attacker,target,skill,environmentState)))return false;
      if(skill.approach){if(!approachForSkill(attacker,target,skill))return false;skill=committedApproachSkill(skill);if(!attacker.alive)return true;}
      if(skill.danceAura)return executeDanceAura(attacker,skill);
      if(skill.deathDance)return executeDanceOfDeath(attacker,skill);
      if(skill.channel)return executeChannelSkill(attacker,skill);
      if(skill.utilityAction){
        const type=skill.utilityAction.type;
        if(["ENCHANT_WEAPON","CARRY_ALLY","CARRY_ENEMY","SCHEDULE_TURN_SIMULATION"].includes(type))return false;
        return executeUtilitySkill(attacker,target,skill);
      }
      if(skill.effects||skill.relationEffects||skill.bloodBurst)return executeEffectSkill(attacker,target,skill,{buffId});
      return false;
    }

    /** One read-only skill hold projection. It never spends resources, writes
     * state, reveals unseen enemies, or emits animations. All actual legal
     * targets come from the original official targeting helpers above. */
    function previewSkillArea(unit,skill){
      const world=state(),map=world.map,environmentState=world.environmentState;
      if(!unit?.alive||!skill||!map?.tiles)return null;
      const center=TacticalEngine.tile(map,unit.x,unit.y);
      const distance=point=>Math.abs(point.x-unit.x)+Math.abs(point.y-unit.y);
      const rangeTiles=radius=>map.tiles.filter(tile=>distance(tile)<=radius);
      const projectTarget=target=>({id:target.id,x:target.x,y:target.y,
        cells:TacticalEngine.occupiedCells?.(target)||[{x:target.x,y:target.y}]});
      const visibleTarget=target=>target?.team===unit.team||
        skill.ignoreFogOfWar===true||TacticalEngine.teamCanSee(
          map,world.units,unit.team,target,environmentState);
      // Dance and channel radii belong to their official execution rules.
      if(skill.danceAura||skill.deathDance){
        const radius=danceRadius(unit),tiles=rangeTiles(radius);
        const targets=skill.deathDance?world.units.filter(other=>other.alive&&
          other.team!==unit.team&&other.kind!=='CORE'&&distance(other)<=radius&&
          visibleTarget(other)&&map.tiles.some(tile=>{
            if(Math.abs(tile.x-other.x)+Math.abs(tile.y-other.y)!==1)return false;
            if(tile.x===unit.x&&tile.y===unit.y)return true;
            return TacticalEngine.pathTo(map,world.units,{...unit},tile.x,tile.y).length>0;
          })).map(projectTarget):[];
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:skill.deathDance?'ATTACK':'ALLY',radius,tiles,targets};
      }
      if(skill.channel){
        const radius=Math.max(0,Number(skill.channel.radius||0)),tiles=rangeTiles(radius);
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:'ALLY',radius,tiles,targets:[]};
      }
      if(skill.sanctuary||skill.smokeField){
        const tiles=ctx.sanctuaryTiles(center,skill.radius)||[];
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:'ALLY',tiles,targets:[]};
      }
      if(skill.target==='SELF'&&skill.targetType!=='AOE'&&
         !skill.areaDamage&&!skill.aoeDamage){
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:'ALLY',tiles:center?[center]:[],targets:[]};
      }
      if(skill.target==='SELF'&&skill.areaDamage){
        const radius=skill.areaDamage.footprint==='ADJACENT_8'?1:
          Math.max(0,Number(skill.radius||0));
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:'AREA',radius,tiles:TacticalEngine.areaImpactTiles(map,unit,center,skill),targets:[]};
      }
      const single=ctx.targetType(skill)==='SINGLE';
      if(!single){
        const tiles=mapTargetTiles(unit,skill);
        return {mapId:map.id,unitId:unit.id,skillId:skill.id,
          kind:'AIM',tiles,targets:[]};
      }
      const tiles=targetRangeTiles(unit,skill);
      const targets=targetableEntities(unit,skill).filter(visibleTarget).map(projectTarget);
      const additional=environmentTargetTiles(unit,skill);
      return {mapId:map.id,unitId:unit.id,skillId:skill.id,
        kind:skill.target==='ALLY'?'ALLY_TARGET':'AIM',tiles,targets,additional};
    }

    function aimedAreaTiles(unit,skill,center,{legalTiles=null}={}){
      if(!TacticalEngine.isAreaAimSkill(skill)||!center||!(legalTiles||mapTargetTiles(unit,skill)).some(t=>t.x===center.x&&t.y===center.y))return[];
      const world=state(),map=world.map;
      // Preview must not expose an unseen occupant by shifting a landing.
      // Commit still validates against all actual occupants.
      const visibleAt=(x,y)=>{const u=ctx.unitAt(x,y);return u&&(u.team===unit.team||TacticalEngine.teamCanIdentifyUnit(world,unit.team,u))?u:null;};
      if(skill.shape==="LINE"&&skill.moveToTarget)return lineTransitPlan(unit,center,skill,visibleAt)?.affected||[];
      if(skill.jumpShockwave){const occupant=visibleAt(center.x,center.y);if(occupant)center=jumpShockwaveLanding(unit,occupant,skill,visibleAt);if(!center)return[];}
      if(skill.whirlpool)return EnvironmentEngine.whirlpoolFootprint(map,center.x,center.y,skill.radius);
      if(skill.id==='avreshi_starfall'){
        const outer=Number(CardDatabase.get('starfall_card')?.effect?.shockwave?.outerRadius||0);
        return TacticalEngine.aoeTiles(map,center,Number(skill.radius||0)+outer);
      }
      return TacticalEngine.areaImpactTiles(map,unit,center,skill);
    }
    function reset(){pendingMove=null;pendingTransport=null;pendingEnchantment=null;enchantmentFollowup=null;}

    return Object.freeze({
      reset,pendingMove:()=>pendingMove,bloodShadowLanding,
      attackPlanForTarget,targetableEntities,targetRangeTiles,previewSkillArea,aimedAreaTiles,environmentTargetTiles,executeEnvironmentTargetSkill,approachTargetForAttack,resolveDirectTargetAttack,previewCoreAttack,
      mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,
      backFromTargeting,finishActiveSkill,executeEffectSkill,executeUtilitySkill,executeAutonomousSkill,isMapTransitSkill:skill=>MAP_TRANSIT_ACTIONS.has(skill?.utilityAction?.type),planApproachForSkill,approachForSkill,committedApproachSkill,prepareAttack,
      enchantmentSelection:()=>pendingEnchantment,enchantmentFollowup:()=>enchantmentFollowup,
      beginEnchantment,enchantmentCandidates,commitCandidateEnchantment,executeEnchantmentChoice,
      executeChannelSkill,
      commitEnchantment,cancelEnchantmentSelection,cancelEnchantmentFollowup,
      enchantedTerrainTargetTiles,resolveEnchantmentImpact,resolveEnchantmentImpacts,
      selectedSupportActions,confirmEngagement,executeEngagement
    });
  }

  globalThis.TacticalActionController=Object.freeze({create,restorePendingMove});
})();
