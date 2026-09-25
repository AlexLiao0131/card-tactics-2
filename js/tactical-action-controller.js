(()=>{
  "use strict";

  function create(ctx){
    let pendingMove=null;

    function state(){return ctx.actionState();}

    function attackPlanForTarget(unit,target,skill){
      const {map,units,environmentState}=state();
      if(!unit?.alive||unit.acted||!target?.alive||!skill)return null;
      if(skill.approach)return TacticalEngine.canTarget(map,unit,target,skill,environmentState)?{x:unit.x,y:unit.y,cost:0,path:[]}:null;
      const positions=[{x:unit.x,y:unit.y,cost:0,path:[]}];
      if(!unit.moved){
        const reachable=TacticalEngine.reachable(map,units,unit);
        reachable.forEach((cost,key)=>{
          const [x,y]=key.split(",").map(Number);
          const facing=unit.facing,path=TacticalEngine.pathTo(map,units,unit,x,y);
          unit.facing=facing;
          if(path.length)positions.push({x,y,cost,path});
        });
      }
      const legal=positions.filter(pos=>{
        const probe={...unit,x:pos.x,y:pos.y};
        return TacticalEngine.canTarget(map,probe,target,skill,environmentState);
      });
      legal.sort((a,b)=>a.cost-b.cost||a.y-b.y||a.x-b.x);
      return legal[0]||null;
    }

    function targetableEntities(unit,skill){
      return ctx.combatTargets(unit).filter(target=>attackPlanForTarget(unit,target,skill));
    }

    function beginPendingMove(unit){
      pendingMove={unitId:unit.id,x:unit.x,y:unit.y,z:unit.z,facing:unit.facing};
    }

    function commitPendingMove(unit){
      if(pendingMove?.unitId===unit?.id)pendingMove=null;
    }

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
      ctx.consumeSkill(unit,skill);skill=ctx.effectiveSkill(unit,skill);
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
        if(skill.requiresVision!==false&&!TacticalEngine.canSee(map,attacker,tile,environmentState))return false;
        if(skill.environmentRequirement==="CONDUCTIVE"&&!EnvironmentEngine.isConductive(map,environmentState,tile.x,tile.y))return false;
        return true;
      });
    }

    function executeMapSkill(attacker,center,skill){
      const {map,environmentState}=state();
      if(!ctx.canUseSkill(attacker,skill))return false;
      ctx.consumeSkill(attacker,skill);
      skill=ctx.effectiveSkill(attacker,skill);
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      const affected=skill.shape==="LINE"?ctx.lineTiles(attacker,center):ctx.aoeTiles(center,skill.radius||0);
      if(skill.shape==="LINE"){
        affected.forEach(tile=>{
          const occupant=ctx.unitAt(tile.x,tile.y);
          if(!occupant||occupant.team===attacker.team)return;
          const result=BattleEngine.calculate(attacker.character,occupant.character,skill);
          if(!result.hit){ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} MISS。`,"BATTLE");return;}
          occupant.hp=Math.max(0,occupant.hp-result.damage);
          ctx.pushLog(`${attacker.character.name} → ${occupant.character.name}｜${skill.name} ${result.damage} 傷害｜HP ${occupant.hp}。`,"BATTLE");
          if(occupant.hp<=0&&occupant.alive){occupant.alive=false;ctx.handleDefeated(occupant,attacker,skill);}
        });
      }
      if(skill.aoeDamage){
        affected.forEach(tile=>{const occupant=ctx.unitAt(tile.x,tile.y);if(occupant)ctx.damageUnitFlat(occupant,skill.aoeDamage,skill.name);});
      }
      const environmentEvents=[];
      affected.forEach(tile=>{
        const events=environmentState&&skill.environmentForces
          ?EnvironmentEngine.apply({map,state:environmentState,x:tile.x,y:tile.y,forces:skill.environmentForces})
          :[];
        environmentEvents.push(...events);events.forEach(ctx.logEnvironmentEvent);
      });
      ctx.resolveEnvironmentEvents?.(environmentEvents,{reason:`${skill.name} 引發水體雷電傳導`});
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

    function executeEffectSkill(attacker,target,skill){
      if(!window.EffectEngine||!ctx.canUseSkill(attacker,skill))return false;
      ctx.consumeSkill(attacker,skill);
      const results=[];
      if(Array.isArray(skill.relationEffects)){
        const rel=EffectEngine.relation(attacker,target);
        for(const effect of skill.relationEffects.filter(e=>e.relation===rel)){
          if(effect.type==="MAGIC_DAMAGE"){
            const attackSkill={...skill,power:Number(effect.power||1),attackType:"MAGIC",element:effect.element||"NONE",traitMultipliers:effect.traitMultipliers||{},weapon:effect.weapon||skill.weapon};
            const result=BattleEngine.calculate(attacker.character,target.character,attackSkill);
            if(result.hit){target.hp=Math.max(0,target.hp-result.damage);if(target.hp===0)target.alive=false;}
            results.push({type:"MAGIC_DAMAGE",...result});
            ctx.pushLog(`${attacker.character.name} → ${target.character.name}｜${skill.name} ${result.hit?result.damage+" 傷害":"MISS"}｜HP ${target.hp}。`,"BATTLE");
            if(!target.alive)ctx.handleDefeated(target,attacker,skill);
          }else{
            const r=EffectEngine.apply({source:attacker,target,effect});results.push(r);
            if(effect.type==="HEAL")ctx.pushLog(`${skill.name} → ${target.character.name}｜回復 ${r.amount||0} HP｜HP ${target.hp}。`,"BATTLE");
          }
        }
      }else if(Array.isArray(skill.effects)){
        for(const effect of skill.effects){
          const r=EffectEngine.apply({source:attacker,target,effect});results.push(r);
          if(effect.type==="HEAL")ctx.pushLog(`${skill.name} → ${target.character.name}｜回復 ${r.amount||0} HP｜HP ${target.hp}。`,"BATTLE");
        }
      }
      if(skill.bloodAction){
        const b=skill.bloodAction;
        const drain=EffectEngine.apply({source:attacker,target,effect:{type:"DRAIN",amount:b.damage,healRatio:b.healRatio}});results.push(drain);
        EffectEngine.apply({source:attacker,target:attacker,effect:{type:"ATTRIBUTE_OVERRIDE",id:"BLOOD_GENOME_RESTORATION",classification:"POSITIVE",duration:b.duration,values:b.restoresGenome}});
        const manaRestore=EffectEngine.apply({source:attacker,target:attacker,effect:{type:"RESTORE_MANA",amount:Math.round(Number(drain.damage||0)*Number(b.manaRatio||0))}});results.push(manaRestore);
        ctx.pushLog(`${attacker.character.name} 吸取 ${target.character.name} 的血｜${drain.damage||0} 傷害｜自癒 ${drain.healed||0} HP｜回復 ${manaRestore.amount||0} MP｜暫時恢復 5V。`,"BATTLE");
        if(!target.alive)ctx.handleDefeated(target,attacker,skill);
        if(b.copySkill){
          const options=EffectEngine.copyableSkills(target);
          if(options.length){
            ctx.setPendingCopySkill({attacker,target,options,duration:b.copyDuration});
            ctx.setMode("copy-skill-select");ctx.render();return true;
          }
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
      if(skill.effects||skill.relationEffects||skill.bloodAction){executeEffectSkill(attacker,defender,skill);return;}
      skill=ctx.effectiveSkill(attacker,skill);
      if(skill.ambushActive)ctx.pushLog(`${attacker.character.name}｜伏擊發動：弓擊威力與速度提升。`,"BATTLE");
      if(ctx.targetType(skill)!=="SINGLE"){executeEngagement(attacker,defender,skill,[]);return;}
      const candidates=BattleResolution.supportCandidates({
        units,initiator:attacker,target:defender,canUseSkill:ctx.canUseSkill
      }).map(candidate=>({
        ...candidate,
        skills:candidate.skills.filter(supportSkill=>TacticalEngine.canTarget(map,candidate.ally,defender,supportSkill,state().environmentState))
      })).filter(candidate=>candidate.skills.length);
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
      pendingEngagement.candidates.forEach(({ally},index)=>{
        const skill=supportSelection.get(ally.id);
        if(skill)actions.push(BattleResolution.createSupportAction(ally,pendingEngagement.defender,skill,index));
      });
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
        {
          canUseSkill:ctx.canUseSkill,
          consumeSkill:ctx.consumeSkill,
          onDefeated:ctx.handleDefeated,
          onAction:ctx.logBattleAction,
          onPostEffect:ctx.logPostEffect
        }
      );
      if(!engagement.results.length){
        ctx.clearEngagement();ctx.setMode("command");ctx.render();return;
      }
      commitPendingMove(attacker);
      attacker.moved=true;attacker.acted=true;attacker.waited=true;
      ctx.setSelectedSkill(null);ctx.clearEngagement();ctx.setMode("inspect");
      if(ctx.checkMatchEnd()){ctx.render();return;}
      if(!ctx.maybeAutoEndPlayerTurn?.())ctx.render();
    }

    function reset(){pendingMove=null;}

    return Object.freeze({
      reset,pendingMove:()=>pendingMove,
      attackPlanForTarget,targetableEntities,approachTargetForAttack,resolveDirectTargetAttack,
      mapTargetTiles,executeMapSkill,beginPendingMove,commitPendingMove,cancelPendingMove,
      backFromTargeting,finishActiveSkill,executeEffectSkill,approachForSkill,prepareAttack,
      selectedSupportActions,confirmEngagement,executeEngagement
    });
  }

  window.TacticalActionController=Object.freeze({create});
})();
