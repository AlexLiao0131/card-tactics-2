(()=>{
  "use strict";

  // Enemy + autonomous neutral encounter orchestration. Battle state remains owned by tactical-game.js.
  window.TacticalEnemyController={
    create(ctx){
      let queue=[];
      let stepTimer=null;
      const NEUTRAL=window.EncounterEngine?.TEAM_NEUTRAL||"N";

      const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
      // Official diagnostics only: no extra actor/terrain scans, second state,
      // AI decisions or timer-driven work. Values are measured synchronously
      // around the original function invocation and returned unchanged.
      let decisionTotals=null;
      const measured=(name,run)=>{
        const diag=globalThis.CardTacticsDiagnostics;
        if(diag?.isEnabled?.()!==true)return run();
        const at=performance.now();
        try{return run();}finally{
          const ms=performance.now()-at;
          // Many visibility/LOS calls may occur inside one actor decision.
          // Aggregate in memory, then publish ONCE per operation per actor,
          // rather than burdening the game with recordPerf for each target.
          if(decisionTotals)decisionTotals[name]=(decisionTotals[name]||0)+ms;
          else diag.recordPerf?.(name,ms);
        }
      };
      const measureDecision=(name,run)=>{
        const diag=globalThis.CardTacticsDiagnostics;
        if(diag?.isEnabled?.()!==true)return run();
        const previous=decisionTotals;
        decisionTotals=Object.create(null);
        try{return measured(name,run);}finally{
          const result=decisionTotals;
          decisionTotals=previous;
          for(const [metric,ms]of Object.entries(result))diag.recordPerf?.(metric,ms);
        }
      };
      const afterStep=(fn,ms=550)=>{
        if(stepTimer)clearTimeout(stepTimer);
        stepTimer=setTimeout(()=>{stepTimer=null;fn?.();},ms);
      };
      const showStep=(kind,message,extra={})=>{
        ctx.setEnemyView({active:true,kind,message,...extra});
        measured("enemyAI.showStepRender",()=>ctx.render());
        measured("enemyAI.showStepStateEvent",()=>ctx.emitState());
      };
      const isNeutral=unit=>unit?.team===NEUTRAL;
      let generation=0,teamPlan=null,geminiTacticalUsed=false;
      const assignments=new Map(),usedFree=new Map();
      const perceivedHP=u=>Number(u?.hallucination?u.perceivedHp??u.hp:u?.hp)||0;
      const maxHP=u=>Math.max(1,Number(u?.character?.combat?.hp||u?.maxHp||u?.hp||1));
      const visibleEnemies=actor=>{const w=ctx.state();return w.units.filter(u=>u.alive&&u.team!==actor.team&&
        TacticalEngine.actorCanTrackTarget(w.map,w.units,actor,u,w.environmentState||null,w));};
      const role=u=>String(u?.character?.archetype||"");
      const closest=(u,points)=>points.length?Math.min(...points.map(p=>distance(u,p))):Infinity;
      // Core is the victory goal. Capture and holding are finite assignments,
      // never equal-priority attractors for every member of the army.
      function assignObjectives(enemies){
        assignments.clear();const w=ctx.state();if(w.stage?.ruleset!=="CORE_CAPTURE")return;
        const core=ctx.coreForOwner("PLAYER"),own=ctx.coreForOwner("ENEMY");
        const points=DeploymentEngine.points(w.stage).filter(p=>p.capturable!==false&&p.captureTiles?.length);
        const known=w.units.filter(u=>u.alive&&u.team!==ctx.TEAM.ENEMY&&enemies.some(a=>TacticalEngine.actorCanTrackTarget(w.map,w.units,a,u,w.environmentState,w)));
        const free=new Set(enemies),take=(point,kind,preferDefense=false)=>{
          if(free.size<=1&&core?.hp>0)return;
          const list=[...free].sort((a,b)=>(preferDefense?Number(!role(a).includes("DEFENDER"))-Number(!role(b).includes("DEFENDER")):0)||closest(a,point.captureTiles)-closest(b,point.captureTiles)||String(a.id).localeCompare(String(b.id)));
          if(list[0]){assignments.set(list[0].id,{kind,goals:point.captureTiles,pointId:point.id});free.delete(list[0]);}
        };
        if(own&&known.some(u=>distance(u,own)<=Number(u.character?.combat?.move||0)+1))take({id:"OWN_CORE",captureTiles:[own]},"HOLD",true);
        for(const point of points.filter(p=>p.owner==="ENEMY")){
          if(known.some(u=>closest(u,point.captureTiles)<=Number(u.character?.combat?.move||0)))take(point,"HOLD",true);
        }
        for(const point of points.filter(p=>p.owner!=="ENEMY").sort((a,b)=>closest(core||{x:0,y:0},a.captureTiles)-closest(core||{x:0,y:0},b.captureTiles)))take(point,"CAPTURE");
        // A lone surviving actor may still capture a point on its route, but
        // an occupied central point never traps all remaining attackers.
        for(const u of free){
          const order=teamPlan?.orders?.find(o=>o.unit_id===u.id);
          const requested=points.find(p=>p.id===order?.objective_id&&p.owner!=="ENEMY");
          // Respect a model's capture assignment only if this does not leave
          // the Core without an assault group or duplicate a claimed objective.
          if(requested&&free.size>1&&![...assignments.values()].some(a=>a.pointId===requested.id)&&[...free].some(v=>v!==u&&!assignments.has(v.id)))
            assignments.set(u.id,{kind:"CAPTURE",goals:requested.captureTiles,pointId:requested.id});
          else if(core?.hp>0)assignments.set(u.id,{kind:"ASSAULT",goals:[core]});
        }
        globalThis.CardTacticsDiagnostics?.push?.("ENEMY_STRATEGY",{round:w.round,assignments:[...assignments].map(([unitId,a])=>({unitId,kind:a.kind,pointId:a.pointId||null}))});
      }
      function mission(actor){const a=assignments.get(actor.id),w=ctx.state();
        if(a?.kind==="CAPTURE"&&DeploymentEngine.points(w.stage).find(p=>p.id===a.pointId)?.owner==="ENEMY"){
          const core=ctx.coreForOwner("PLAYER");return core?.hp>0?{kind:"ASSAULT",goals:[core]}:null;
        }return a||null;}
      const activeSkills=actor=>ctx.skillList(actor).flatMap(s=>s.variants?.length&&globalThis.SkillDatabase?.resolveVariant?
        s.variants.map(v=>globalThis.SkillDatabase.resolveVariant(s,v.id)).filter(Boolean):[s]).filter(s=>ctx.canUseSkill(actor,s));
      function healthValue(actor,target,skill){
        const hp=maxHP(target),missing=Math.max(0,hp-perceivedHP(target)),effects=target.effects||[];
        const relation=target.id===actor.id?"SELF":target.team===actor.team?"ALLY":"ENEMY";
        const rules=[...(skill.effects||[]),...(skill.relationEffects||[]).filter(e=>e.relation===relation)];
        let value=0;
        for(const e of rules){const exists=effects.some(v=>v.id===e.id&&e.id);switch(e.type){
          case "HEAL":case "HEAL_OVER_TIME":if(!exists||e.type==="HEAL")value+=Math.min(missing,Number(e.amount||0)*Math.max(1,e.type==="HEAL_OVER_TIME"?Number(e.duration||1):1))/hp;break;
          case "RESTORE_MANA":value+=Math.max(0,Number(target.maxMana||0)-Number(target.mana||0))/Math.max(1,Number(target.maxMana||0));break;
          case "DISPEL":value+=effects.filter(v=>v.classification==="NEGATIVE").length;break;
          case "DISPEL_POSITIVE":value+=effects.filter(v=>v.classification==="POSITIVE").length;break;
          case "MAGIC_DAMAGE":value+=relation==="ENEMY"?Number(e.power||1)*Number(actor.character?.combat?.matk||0)/hp:0;break;
          default:if(!exists&&((relation==="ENEMY"&&e.classification==="NEGATIVE")||(relation!=="ENEMY"&&e.classification!=="NEGATIVE")))value+=1/2;break;
        }}return value;
      }
      function damageValue(actor,target,skill){
        if(target.kind==="CORE"){
          const damage=ctx.aiCoreForecast?.(actor,target,skill)||0,health=Math.max(1,Number(target.core.hp||0));
          return 3+Math.min(health,damage)/health; // explicit strategic priority, official damage projection
        }
        const f=ctx.aiForecast?.(actor,target,skill);
        if(!f)return Number(skill.power??1)/Math.max(1,perceivedHP(target));
        const hp=Math.max(1,perceivedHP(target)),hit=f.hit/100,crit=f.crit/100;
        const normal=Math.min(hp,f.normalDamage),critical=Math.min(hp,f.criticalDamage);
        const expected=hit*((1-crit)*normal+crit*critical);
        const kill=hit*((f.normalDamage>=hp?1-crit:0)+(f.criticalDamage>=hp?crit:0));
        // Risk of a legal counter: estimate only the strongest currently legal
        // counter; do not simulate or spend any combat resources.
        let counterRisk=0;
        if(kill<1&&globalThis.BattleResolution?.counterSkills){
          const counters=globalThis.BattleResolution.counterSkills({defender:target,attacker:actor,attackSkill:skill,canUseSkill:ctx.canUseSkill});
          for(const counter of counters){
            if(!TacticalEngine.canTarget(ctx.map(),target,actor,counter,ctx.state().environmentState))continue;
            const back=ctx.aiForecast?.(target,actor,counter);if(back)counterRisk=Math.max(counterRisk,(back.hit/100)*Math.min(actor.hp,back.normalDamage)/maxHP(actor));
          }
        }
        const status=(skill.statusEffects||[]).filter(e=>!(target.effects||[]).some(a=>a.id===e.id)).reduce((n,e)=>n+Number(e.chance??100)/100,0);
        const heal=skill.damageRecovery?.healRatio?Math.min(Math.max(0,maxHP(actor)-actor.hp),expected*skill.damageRecovery.healRatio)/maxHP(actor):0;
        const mana=Number(globalThis.UnitRuntimeEngine?.skillManaCost?.(actor,skill)??skill.manaCost??0)/Math.max(1,Number(actor.maxMana||actor.mana||1));
        return Math.max(.0001,expected/maxHP(target)+kill+heal+status/4-counterRisk*(1-kill)/2-mana/8);
      }
      function supportChoices(actor,skills,foes){
        if(!ctx.aiExecuteSkill)return[];
        const w=ctx.state(),map=w.map,out=[],allies=w.units.filter(u=>u.alive&&u.team===actor.team),own=TacticalEngine.tile(map,actor.x,actor.y);
        const add=(skill,target,score,extra={})=>{if(score>0)out.push({attacker:actor,defender:target,target,skill,score,autonomous:true,...extra});};
        for(const skill of skills){
          const utility=skill.utilityAction?.type;
          if(skill.bloodBurst||skill.bloodShadow)continue;
          if(utility==="ENCHANT_WEAPON"){
            for(const c of ctx.aiEnchantmentTargets?.(actor,skill)||[]){
              if(c.target===actor||c.target.acted||globalThis.EffectEngine?.weaponEnchantment?.(c.target,c.weapon.slot))continue;
              if(foes.some(f=>distance(f,c.target)<=Number(c.target.character?.combat?.move||0)+Math.max(1,...ctx.skillList(c.target).filter(s=>s.weapon===c.weapon.slot).map(s=>Number(s.range?.max||0)))))add(skill,c.target,.65,{weaponSlot:c.weapon.slot});
            }continue;
          }
          if(skill.target==="TILE"||skill.target==="SELF"&&(TacticalEngine.isFixedAreaSkill?.(skill)||skill.areaDamage||skill.aoeDamage)){
            if(utility){
              // Actual movement utility only when it advances the assigned goal;
              // executeMapSkill revalidates the landing and consumes the skill.
              if(ctx.aiIsMapTransitSkill?.(skill)&&mission(actor)?.goals?.length){
                const goals=mission(actor).goals,before=closest(actor,goals);
                const legal=ctx.mapSkillTiles?.(actor,skill)||[],best=legal.sort((a,b)=>closest(a,goals)-closest(b,goals))[0];
                if(best&&closest(best,goals)<before)add(skill,actor,(before-closest(best,goals))/Math.max(1,Number(actor.character?.combat?.move||1)),{center:best});
              }continue;
            }
            if(skill.danceAura||skill.channel||skill.deathDance){
              const preview=ctx.aiPreviewArea?.(actor,skill),cells=preview?.tiles||[],inArea=u=>cells.some(t=>TacticalEngine.occupiesCell?.(u,t.x,t.y)??(u.x===t.x&&u.y===t.y));
              let value=0;
              if(skill.deathDance)value=(preview?.targets||[]).length;
              else if(skill.danceAura?.kind==="PURIFY")value=allies.filter(inArea).reduce((n,u)=>n+(u.effects||[]).filter(e=>e.classification==="NEGATIVE").length,0);
              else if(skill.danceAura?.kind==="INSPIRE")value=allies.filter(u=>inArea(u)&&u!==actor&&!u.acted&&!(u.effects||[]).some(e=>e.id===skill.danceAura.effect?.id)).length/2;
              else if(skill.channel&&!actor.effects?.some(e=>e.id===skill.channel.id))value=allies.filter(inArea).reduce((n,u)=>n+Math.max(0,1-Number(u.hp||0)/maxHP(u)),0);
              add(skill,actor,value);continue;
            }
            if(skill.sanctuary){
              const tiles=ctx.aiPreviewArea?.(actor,skill)?.tiles||[];
              const inside=u=>tiles.some(t=>t.x===u.x&&t.y===u.y);
              const faith=actor.resources?.faith;
              add(skill,actor,faith?.value===0?foes.filter(inside).length:allies.filter(inside).reduce((n,u)=>n+Math.max(0,1-u.hp/maxHP(u)),0),{center:own});continue;
            }
            if(!(skill.areaDamage||skill.aoeDamage||skill.persistentArea||skill.fanShot||skill.jumpShockwave||skill.purifiedSlash||skill.rangerVolley||skill.whirlpool||skill.tsunamiWave||Number(skill.power)>0&&!skill.smokeField))continue;
            const legal=skill.target==="SELF"?[own].filter(Boolean):ctx.mapSkillTiles?.(actor,skill)||[];
            let best=null;
            for(const center of legal){const tiles=ctx.aiAreaTiles?.(actor,skill,center,legal)||[];
              const inside=u=>tiles.some(t=>TacticalEngine.occupiesCell?.(u,t.x,t.y)??(u.x===t.x&&u.y===t.y));
              const enemies=foes.filter(u=>inside(u)&&(!skill.areaDamage?.requiredEffectTag||u.effects?.some(e=>e.tags?.includes(skill.areaDamage.requiredEffectTag))));
              const friendly=allies.filter(u=>u!==actor&&inside(u));
              const value=enemies.length-((skill.areaDamage?.relation==="ENEMY"||skill.persistentArea?.relation==="ENEMY"||skill.whirlpool?.onlyEnemies||skill.tsunamiWave)?0:friendly.length); // conservative: do not cast into allies just to score more hits
              if(value>0&&(!best||value>best.score))best={attacker:actor,defender:actor,target:actor,skill,center,score:value,autonomous:true};
            }if(best)out.push(best);continue;
          }
          if(utility){
            // Free actions are bounded by one use per actor/round and only
            // chosen for a meaningful stance change. Never enter transport UI.
            if(utility==="SHAPESHIFT"&&skill.target==="SELF"){
              const current=globalThis.UnitRuntimeEngine?.currentForm?.(actor),form=skill.utilityAction.form;
              const tile=own,wet=globalThis.HydrologyEngine?.waterDepth?.(tile)>0;
              if(!usedFree.get(actor.id)?.size&&current!==form&&((wet&&form==="SEAL")||(!wet&&current==="SEAL"&&form==="HUMAN")))add(skill,actor,1,{free:true});
            }else if(utility==="SET_VERTICAL_MODE"&&skill.target==="SELF"&&skill.utilityAction.mode==="SWIMMING"&&actor.verticalState?.mode==="DIVING"&&foes.length&&!usedFree.get(actor.id)?.size)add(skill,actor,1,{free:true});
            else if(utility==="ENTER_STEALTH"&&foes.length&&!globalThis.EffectEngine?.isStealthed?.(actor))add(skill,actor,.3);
            continue;
          }
          if(!(skill.effects||skill.relationEffects))continue;
          const targets=skill.target==="SELF"?[actor]:skill.target==="ALLY"?allies:skill.target==="ENEMY"?foes:[...allies,...foes];
          for(const target of targets){
            if(!TacticalEngine.canTarget(map,actor,target,skill,w.environmentState))continue;
            const value=healthValue(actor,target,skill);
            const buffId=skill.dispelChoice==="POSITIVE"?globalThis.EffectEngine?.positiveBuffChoices?.(target)?.[0]?.id:null;
            if(skill.dispelChoice==="POSITIVE"&&!buffId)continue;
            add(skill,target,value,{buffId});
          }
        }return out;
      }
      function rankedAttacks(actor){
        const skills=activeSkills(actor),foes=visibleEnemies(actor),out=supportChoices(actor,skills,foes);
        for(const skill of skills){
          if(skill.bloodBurst){if(foes.length)out.push({attacker:actor,defender:actor,skill,score:foes.filter(u=>(u.effects||[]).some(e=>e.tags?.includes("BLEED"))).length||.5});continue;}
          if(skill.utilityAction||skill.effects||skill.relationEffects||skill.target!=="ENEMY"||ctx.targetType(skill)!=="SINGLE")continue;
          for(const target of targetsForSkill(actor,skill)){
            if(skill.approach&&(target.kind==="CORE"||!ctx.aiApproachPlan?.(actor,target,skill)))continue;
            out.push({attacker:actor,defender:target,skill,score:damageValue(actor,target,skill)});
          }
        }
        return out.filter(a=>a.score>0).sort((a,b)=>b.score-a.score||Number(a.skill.manaCost||0)-Number(b.skill.manaCost||0)||String(a.skill.id).localeCompare(String(b.skill.id)));
      }

      const enemySnapshot=(actor=null)=>{
        const world=ctx.state(),state=world.environmentState||{};
        const allied=world.units.filter(u=>u.alive&&u.team===ctx.TEAM.ENEMY);
        const tracked=world.units.filter(u=>u.alive&&u.team!==ctx.TEAM.ENEMY&&
          allied.some(observer=>TacticalEngine.actorCanTrackTarget(world.map,world.units,observer,u,state,world)));
        const summary=u=>({id:u.id,name:u.character?.name||u.id,x:u.x,y:u.y,hp:u.hp,mana:u.mana,
          maxHp:u.maxHp||u.character?.combat?.hp,role:u.character?.archetype||null,
          moved:!!u.moved,acted:!!u.acted,just_deployed:u.deployedRound===world.round,
          resources:globalThis.UnitRuntimeEngine?.resourceSnapshot?.(u)||{},effects:(u.effects||[]).map(e=>e.id||e.type).slice(0,6)});
        return{round:world.round,actor_id:actor?.id||null,map:{width:world.map?.width,height:world.map?.height},
          team_plan:teamPlan,
          actor_skills:actor?ctx.skillList(actor).map(skill=>({id:skill.id,name:skill.name,
            power:skill.power,mana_cost:skill.manaCost||0,range:skill.range||null,
            target:skill.target,category:skill.category,resource_costs:skill.resourceCosts||{}})):[],
          weather:state.weather||"CLEAR",time:state.timeOfDay||"DAY",
          allies:allied.map(summary),visible_opponents:tracked.map(summary),
          objectives:world.stage?.ruleset==="CORE_CAPTURE"?DeploymentEngine.points(world.stage).map(p=>({id:p.id,owner:p.owner,x:p.captureTiles?.[0]?.x,y:p.captureTiles?.[0]?.y})):[],
          crystals:world.enemyCardState?.crystals||0,
          hand:(world.enemyCardState?.zones?.hand||[]).map(id=>{const card=CardDatabase.get(id);return{id,name:card?.name||id,cost:card?.cost||0}}),
          cards_remaining:world.enemyCardState?.zones?.deck?.length||0,
          cores:["PLAYER","ENEMY"].map(owner=>{const core=ctx.coreForOwner(owner);return core?{owner,x:core.x,y:core.y,hp:core.hp,maxHp:core.maxHp}:null}).filter(Boolean)};
      };
      const geminiPick=async(phase,actions,actor=null)=>{
        if(!ctx.geminiEnabled?.()||!actions.length)return null;
        const marker=generation,world=ctx.state().map;
        const selected=await ctx.geminiDecide({phase,legalActions:actions.map((a,i)=>({id:`g${i}`,kind:a.kind,label:a.label})),
          snapshot:enemySnapshot(actor),roundNumber:ctx.state().round});
        if(marker!==generation||ctx.state().map!==world)return null;
        const index=/^g\d+$/.test(selected||"")?Number(selected.slice(1)):-1;
        return Number.isInteger(index)?actions[index]||null:null;
      };
      // Engine-certified options: do not prune movement to the first 14
      // nearest tiles. The model needs flanks, high ground and defense options.
      const tacticalChoices=(actor,{afterMove=false}={})=>{
        const choices=[];
        if(ctx.canUnitCapture(actor))choices.push({kind:"CAPTURE",label:"佔領當前據點"});
        if(ctx.aiExecuteSkill){for(const attack of rankedAttacks(actor).slice(0,98))choices.push({kind:"ATTACK",label:`${attack.skill.name}｜${attack.defender?.id||"SELF"}｜${attack.center?`${attack.center.x},${attack.center.y}`:""}｜效益 ${attack.score.toFixed(2)}`,attack});}
        else {
        const burst=ctx.skillList(actor).find(skill=>skill.bloodBurst&&ctx.canUseSkill(actor,skill));
        if(burst)choices.push({kind:"ATTACK",label:`${burst.name}｜範圍攻擊｜消耗 ${burst.manaCost||0} MP`,
          attack:{attacker:actor,defender:actor,skill:burst}});
        for(const attack of mapAreaAttacks(actor))choices.push({kind:"ATTACK",label:`${attack.skill.name}｜(${attack.center.x},${attack.center.y})｜${attack.score} 名可見敵軍`,attack});
        const allSkills=singleSkills(actor);
        // Interleave skills: one verbose skill must not monopolize the action list.
        const attacks=allSkills.map(skill=>targetsForSkill(actor,skill).map(target=>({
          kind:"ATTACK",label:`${skill.name}｜威力倍率 ${skill.power??"依引擎"}｜MP ${skill.manaCost||0}｜${target.character?.name||target.core?.name||target.id}｜目標 ${target.id} HP ${target.hp??target.core?.hp??"?"}`,
          attack:{attacker:actor,defender:target,skill}
        })));
        for(let i=0;attacks.some(a=>a.length>i)&&choices.length<99;i++)
          for(const attacksForSkill of attacks){if(attacksForSkill[i]&&choices.length<99)choices.push(attacksForSkill[i]);}
        }
        if(!afterMove&&!actor.moved&&choices.length<99){
          const map=ctx.map(),world=ctx.state(),targets=world.units.filter(u=>u.alive&&u.team!==actor.team&&
            TacticalEngine.actorCanTrackTarget(map,world.units,actor,u,world.environmentState||null,world));
          const goals=targets.map(u=>({x:u.x,y:u.y}));
          if(world.stage?.ruleset==="CORE_CAPTURE")DeploymentEngine.points(world.stage)
            .filter(pt=>pt.owner!=="ENEMY").forEach(pt=>(pt.captureTiles||[]).forEach(p=>goals.push(p)));
          const assigned=teamPlan?.orders?.find(o=>o.unit_id===actor.id)?.objective_id;
          const plannedPoint=DeploymentEngine.points(world.stage).find(pt=>pt.id===assigned);
          const personalGoals=mission(actor)?.goals||(plannedPoint?.captureTiles?.length?plannedPoint.captureTiles:goals);
          const candidates=[...TacticalEngine.reachable(map,world.units,actor)].map(([key,cost])=>{
            const[x,y]=key.split(",").map(Number),tile=TacticalEngine.tile(map,x,y);
            return{x,y,cost,tile,goal:personalGoals.length?Math.min(...personalGoals.map(t=>Math.abs(t.x-x)+Math.abs(t.y-y))):null,
              enemyDistance:targets.length?Math.min(...targets.map(t=>Math.abs(t.x-x)+Math.abs(t.y-y))):null};
          }).filter(p=>p.tile&&habitatAllows(actor,p.tile)).sort((a,b)=>
            (a.goal??Infinity)-(b.goal??Infinity)||a.cost-b.cost||a.y-b.y||a.x-b.x);
          // Keep both objective routes and diverse tactical positions, without
          // inventing movement paths or combat outcomes. The renderer never decides.
          const slots=99-choices.length;
          const picked=[];
          if(candidates.length<=slots)picked.push(...candidates);
          else{
            // Round-robin across all distance bands, so close routes cannot
            // completely hide flanks, retreats or high-ground positions.
            const bands=new Map();
            for(const c of candidates){const k=c.goal??"unknown";
              if(!bands.has(k))bands.set(k,[]);bands.get(k).push(c);}
            const groups=[...bands.values()];
            while(picked.length<slots&&groups.some(g=>g.length))
              for(const group of groups){if(group.length&&picked.length<slots)picked.push(group.shift());}
          }
          for(const pos of picked)choices.push({kind:"MOVE",
            label:`移動 (${pos.x},${pos.y})｜成本 ${pos.cost}｜地形 ${pos.tile.terrain}｜高度 ${pos.tile.elevation??0}｜距目標 ${pos.goal??"?"}｜距已知敵軍 ${pos.enemyDistance??"?"}`,
            destination:{x:pos.x,y:pos.y}});
        }
        choices.push({kind:"WAIT",label:"結束這名單位本回合行動"});
        return choices;
      };

      const actorLabel=unit=>isNeutral(unit)?"野怪":"AI";

      const singleSkills=actor=>ctx.skillList(actor).filter(skill=>
        !skill.utilityAction&&skill.target==="ENEMY"&&ctx.targetType(skill)==="SINGLE"&&ctx.canUseSkill(actor,skill)
      );

      const targetEntities=actor=>{
        const state=ctx.state();
        if(isNeutral(actor))return state.units.filter(target=>target.alive&&target.id!==actor.id&&target.team!==actor.team);
        return ctx.combatTargets(actor).filter(target=>target.alive&&target.team!==actor.team);
      };

      const curseEffects=skill=>(skill.effects||[]).filter(e=>e.tags?.includes("CURSE"));
      const targetsForSkill=(actor,skill)=>targetEntities(actor).filter(target=>
        (!curseEffects(skill).length||(target.kind!=="CORE"&&curseEffects(skill).some(e=>!(target.effects||[]).some(a=>a.id===e.id))))&&
        measured("enemyAI.targetVisibility",()=>TacticalEngine.actorCanTrackTarget(ctx.map(),ctx.state().units,actor,target,ctx.actionState?.().environmentState||null,ctx.state()))&&
        measured("enemyAI.targetRangeLOS",()=>skill.bloodShadow?
          !!ctx.bloodShadowLanding?.(actor,target):TacticalEngine.canTarget(ctx.map(),actor,target,skill,ctx.actionState?.().environmentState||null))
      );

      const mapAreaAttacks=actor=>{
        const world=ctx.state(),map=ctx.map();
        const foes=world.units.filter(u=>u.alive&&u.team!==actor.team&&TacticalEngine.actorCanTrackTarget(map,world.units,actor,u,world.environmentState||null,world));
        const candidates=[];
        for(const skill of ctx.skillList(actor)){
          if(!(skill.persistentArea||skill.areaDamage?.requiredEffectTag||skill.areaDamage?.footprint==="FRONT_3")||!ctx.canUseSkill(actor,skill))continue;
          const eligible=foes.filter(u=>!skill.areaDamage?.requiredEffectTag||(u.effects||[]).some(e=>e.tags?.includes(skill.areaDamage.requiredEffectTag)));
          let best=null;
          for(const center of ctx.mapSkillTiles?.(actor,skill)||[]){
            const tiles=skill.areaDamage?.footprint==="FRONT_3"?TacticalEngine.frontThreeTiles(map,actor,center):TacticalEngine.aoeTiles(map,center,skill.radius||0);
            const score=eligible.filter(u=>tiles.some(t=>TacticalEngine.occupiesCell(u,t.x,t.y))).length;
            if(score>0&&(!best||score>best.score))best={attacker:actor,defender:actor,skill,center,score};
          }
          if(best)candidates.push(best);
        }
        return candidates.sort((a,b)=>b.score-a.score);
      };
      const chooseAttack=actor=>{
        if(!isNeutral(actor)&&ctx.aiExecuteSkill)return rankedAttacks(actor)[0]||null;
        const burst=ctx.skillList(actor).find(skill=>skill.bloodBurst&&ctx.canUseSkill(actor,skill));
        if(burst)return{attacker:actor,defender:actor,skill:burst};
        const area=mapAreaAttacks(actor)[0];
        if(area)return area;
        const singles=singleSkills(actor);
        const priority=skill=>{
          const recovery=skill.damageRecovery,resource=recovery&&actor.resources?.[recovery.resource];
          if(resource&&resource.value<resource.max)return 4;
          if(curseEffects(skill).length&&singles.some(s=>s.damageRecovery&&actor.resources?.[s.damageRecovery.resource]?.value>=actor.resources?.[s.damageRecovery.resource]?.max))return 3;
          if(Object.keys(skill.resourceCosts||{}).length)return 2;
          return 0;
        };
        for(const skill of singles.sort((a,b)=>priority(b)-priority(a))){
          const targets=targetsForSkill(actor,skill);
          if(targets.length){
            targets.sort((a,b)=>{
              const ah=a.kind==="CORE"?Number(a.core?.hp??Infinity):Number(a.hallucination?a.perceivedHp??a.hp??Infinity:a.hp??Infinity);
              const bh=b.kind==="CORE"?Number(b.core?.hp??Infinity):Number(b.hallucination?b.perceivedHp??b.hp??Infinity:b.hp??Infinity);
              return ah-bh||distance(actor,a)-distance(actor,b)||String(a.id).localeCompare(String(b.id));
            });
            return{attacker:actor,defender:targets[0],skill};
          }
        }
        return null;
      };

      const habitatAllows=(actor,tile)=>!isNeutral(actor)||!window.EncounterEngine?.habitatAllows||EncounterEngine.habitatAllows(actor,tile);

      const movePath=actor=>{
        if(actor.moved||!actor.alive)return[];
        const state=ctx.state();
        const objectives=state.units
          .filter(unit=>unit.alive&&unit.id!==actor.id&&unit.team!==actor.team&&
            measured("enemyAI.goalVisibility",()=>TacticalEngine.actorCanTrackTarget(state.map,state.units,actor,unit,state.environmentState||null,state)))
          .map(unit=>({x:unit.x,y:unit.y}));

        if(!isNeutral(actor)&&state.stage?.ruleset==="CORE_CAPTURE"){
          DeploymentEngine.points(state.stage).filter(point=>point.capturable!==false&&point.owner!=="ENEMY").forEach(point=>(point.captureTiles||[]).forEach(tile=>objectives.push(tile)));
          const core=ctx.coreForOwner("PLAYER");
          if(core?.hp>0)objectives.push({x:core.x,y:core.y});
        }

        const assigned=mission(actor);
        if(assigned?.goals?.length){objectives.length=0;objectives.push(...assigned.goals);}
        if(!objectives.length)return[];
        const reachable=measured("enemyAI.reachable",()=>TacticalEngine.reachable(state.map,state.units,actor));
        if(!reachable.size)return[];
        let best=null;
        const before=closest(actor,objectives);
        reachable.forEach((cost,key)=>{
          const[x,y]=key.split(",").map(Number);
          const tile=TacticalEngine.tile(state.map,x,y);
          if(!habitatAllows(actor,tile))return;
          const nearest=Math.min(...objectives.map(point=>Math.abs(x-point.x)+Math.abs(y-point.y)));
          if(!best||nearest<best.nearest||(nearest===best.nearest&&(cost<best.cost||(cost===best.cost&&(y<best.y||(y===best.y&&x<best.x))))))best={x,y,nearest,cost};
        });
        if(assigned?.kind==="HOLD"&&before<=1&&(!best||best.nearest>=before))return[];
        if(assigned&&assigned.kind!=="HOLD"&&best&&best.nearest>=before){
          // Local greedy path got stuck on an obstacle. Search a full route
          // once, then return only a current-turn legal destination.
          const detour=TacticalEngine.strategicDestination?.(state.map,state.units,actor,objectives,reachable,{goalRadius:assigned.kind==="ASSAULT"?1:0});
          if(detour)best={...detour,nearest:closest(detour,objectives),cost:reachable.get(`${detour.x},${detour.y}`)};
          else if(assigned.kind==="ASSAULT")return[];
        }
        return best?measured("enemyAI.pathTo",()=>TacticalEngine.pathTo(state.map,state.units,actor,best.x,best.y))||[]:[];
      };

      const animateMove=(actor,path,done)=>{
        const steps=[...(path||[])];
        const next=()=>{
          if(!steps.length||!actor.alive){actor.moved=true;done?.();return;}
          const tile=steps.shift();
          if(!habitatAllows(actor,tile)){actor.moved=true;done?.();return;}
          const result=measured("enemyAI.traverseUnitStep",()=>ctx.traverseUnitPath(actor,[tile],{kind:"UNIT"}));
          ctx.pushLog(`${actor.character.name} 移動至 (${actor.x},${actor.y})。`,"DETAIL");
          showStep("MOVE",`${actor.character.name} 移動 → (${actor.x},${actor.y})`,{unitId:actor.id});
          if(!result?.completed||!actor.alive){actor.moved=true;done?.();return;}
          afterStep(next,260);
        };
        next();
      };

      const resolveAutonomousAttack=attack=>{
        const {attacker,defender,skill}=attack;
        if(!attacker?.alive||!defender?.alive)return false;
        showStep("ATTACK",`${actorLabel(attacker)} 決策｜${attacker.character.name} → ${defender.character.name}｜${skill.name}`,{unitId:attacker.id});
        afterStep(()=>{
          if(!attacker.alive||!defender.alive){afterStep(continuePhase,0);return;}
          BattleResolution.resolve(
            {map:ctx.map(),units:ctx.state().units,initiator:attacker,target:defender,skill,actions:[]},
            {
              canUseSkill:ctx.canUseSkill,
              consumeSkill:ctx.consumeSkill,
              onDefeated:ctx.handleDefeated,
              onAction:ctx.logBattleAction,
              onPostEffect:ctx.logPostEffect
            }
          );
          attacker.moved=true;attacker.acted=true;attacker.waited=true;
          ctx.render();ctx.emitState();
          afterStep(continuePhase,350);
        },400);
        return true;
      };

      const requestAttack=attack=>{
        if(!attack?.attacker?.alive){afterStep(continuePhase,0);return;}
        if(attack.skill?.approach&&!attack.autonomous){
          const skill=ctx.aiCommitApproach?.(attack.attacker,attack.defender,attack.skill);
          if(!skill||!attack.attacker.alive){attack.attacker.moved=true;attack.attacker.acted=true;attack.attacker.waited=true;afterStep(continuePhase,0);return;}
          attack={...attack,skill};
        }
        if(attack.autonomous){
          const actor=attack.attacker,marker=generation;
          showStep("ATTACK",`AI｜${actor.character.name} 使用 ${attack.skill.name}`,{unitId:actor.id});
          afterStep(()=>{
            if(skipDefeatedActor(actor,marker))return;
            const ok=ctx.aiExecuteSkill(attack);
            if(ok&&attack.free&&!actor.acted&&actor.alive){
              const used=usedFree.get(actor.id)||new Set();used.add(attack.skill.id);usedFree.set(actor.id,used);queue.unshift(actor);
            }else if(!actor.acted){actor.moved=true;actor.acted=true;actor.waited=true;}
            ctx.render();ctx.emitState();afterStep(continuePhase,350);
          },400);return;
        }
        if(attack.center||curseEffects(attack.skill).length){
          showStep("ATTACK",`AI｜${attack.attacker.character.name} 使用 ${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            const actor=attack.attacker;
            if(actor.alive){const ok=attack.center?ctx.performMapSkill?.(actor,attack.center,attack.skill):attack.defender?.alive&&ctx.performEffectSkill?.(actor,attack.defender,attack.skill);
              if(!ok){actor.acted=true;actor.waited=true;}}
            ctx.render();ctx.emitState();afterStep(continuePhase,350);
          },400);return;
        }
        if(attack.skill?.bloodBurst||attack.skill?.bloodShadow){
          showStep("ATTACK",`AI｜${attack.attacker.character.name} 使用 ${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            if(!attack.attacker.alive||!attack.defender?.alive){afterStep(continuePhase,0);return;}
            if(attack.skill.bloodBurst)ctx.performBloodBurst?.(attack.attacker,attack.skill);
            else ctx.performBloodShadow?.(attack.attacker,attack.defender,attack.skill);
            afterStep(continuePhase,350);
          },400);return;
        }
        if(attack.defender?.kind==="CORE"){
          showStep("ATTACK",`AI 決策｜${attack.attacker.character.name} → ${attack.defender.core?.name||"CORE"}｜${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            if(!attack.attacker.alive){afterStep(continuePhase,0);return;}
            ctx.resolveDirectTargetAttack(attack.attacker,attack.defender,attack.skill);
            afterStep(continuePhase,350);
          },400);
          return;
        }

        // During a hallucinated AI turn, the AI resolves against its mirror world without
        // opening a reaction window on the unaffected player's real presentation.
        if(ctx.hallucinationActiveFor?.(attack.attacker?.team)){
          if(!resolveAutonomousAttack(attack))afterStep(continuePhase,0);
          return;
        }

        // Any hostile SINGLE attack against a player-controlled unit uses the same reaction pipeline.
        // AI-vs-neutral and neutral-vs-AI remain autonomous because neither side is player-controlled.
        if(attack.defender.team!==ctx.TEAM.PLAYER){
          if(!resolveAutonomousAttack(attack))afterStep(continuePhase,0);
          return;
        }

        showStep("ATTACK",`${actorLabel(attack.attacker)} 決策｜${attack.attacker.character.name} → ${attack.defender.character.name}｜${attack.skill.name}`,{unitId:attack.attacker.id});
        afterStep(()=>{
          if(!attack.attacker.alive||!attack.defender.alive){afterStep(continuePhase,0);return;}
          ctx.setPendingEnemyAttack(attack);ctx.setMode("enemy-reaction");
          ctx.pushLog(`${attack.attacker.character.name} 對 ${attack.defender.character.name} 發動 ${attack.skill.name}。`);
          ctx.render();ctx.emitState();
        },450);
      };

      const finishPhase=()=>{
        const state=ctx.state();
        if(ctx.checkMatchEnd()){ctx.render();return;}
        ctx.pushLog(`Round ${state.round}｜敵方／野怪行動結束。`);
        ctx.beginPlayerTurn();
      };

      // A defeated actor forfeits only its own action. A reset generation, unlike
      // death, invalidates the entire old action chain and must never resume it.
      const skipDefeatedActor=(actor,marker)=>{
        if(marker!==generation)return true;
        if(actor.alive)return false;
        afterStep(continuePhase,0);
        return true;
      };
      const continuePhase=()=>{
        const state=ctx.state();
        if(state.phase!==ctx.PHASE.ENEMY||state.matchResult||ctx.pendingEnemyAttack())return;
        const actor=queue.shift();
        if(!actor){finishPhase();return;}
        if(!actor.alive||actor.acted){afterStep(continuePhase,0);return;}
        const marker=generation;
        showStep("THINK",`${actorLabel(actor)} 思考｜${actor.character.name}`,{unitId:actor.id});
        afterStep(async()=>{
          if(skipDefeatedActor(actor,marker))return;
          if(isNeutral(actor)){
            const attack=measureDecision("enemyAI.chooseAttack",()=>chooseAttack(actor));
            if(attack){requestAttack(attack);return;}
            const path=measureDecision("enemyAI.movePath",()=>movePath(actor));
            animateMove(actor,path,()=>{
              if(skipDefeatedActor(actor,marker))return;
              const follow=chooseAttack(actor);if(follow)requestAttack(follow);
              else{actor.moved=true;actor.acted=true;actor.waited=true;afterStep(continuePhase,300);}});return;
          }
          if((!ctx.geminiEnabled?.()||ctx.aiExecuteSkill)&&state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
            ctx.executeCapture(actor);afterStep(continuePhase,300);return;
          }
          let picked=ctx.geminiEnabled?.()&&!ctx.aiExecuteSkill?await geminiPick("ENEMY_TACTICAL",tacticalChoices(actor),actor):null;
          let ranked=null;
          if(ctx.aiExecuteSkill&&teamPlan&&ctx.geminiEnabled?.()&&!geminiTacticalUsed){
            ranked=measureDecision("enemyAI.chooseAttack",()=>rankedAttacks(actor));
            const tactical=ranked.filter(a=>a.score>=1&&!a.free);
            if(tactical.length>1){geminiTacticalUsed=true;
              picked=await geminiPick("ENEMY_TACTICAL",tactical.slice(0,4).map(attack=>({kind:"ATTACK",attack,label:`${attack.skill.name}｜${attack.defender?.character?.name||attack.defender?.id}｜${attack.center?`${attack.center.x},${attack.center.y}`:""}｜效益 ${attack.score.toFixed(2)}`})),actor);
            }
          }
          if(marker!==generation||ctx.pendingEnemyAttack())return;
          if(skipDefeatedActor(actor,marker))return;
          if(picked?.kind==="CAPTURE"&&ctx.canUnitCapture(actor)){ctx.executeCapture(actor);afterStep(continuePhase,300);return;}
          if(picked?.kind==="ATTACK"&&picked.attack){requestAttack(picked.attack);return;}
          const originalAttack=()=>measureDecision("enemyAI.chooseAttack",()=>chooseAttack(actor));
          let plannedPath=null;
          if(!picked){const attack=ranked?ranked[0]:originalAttack(),order=mission(actor);
            // A nonlethal exchange must not hold an assault unit in the middle
            // forever. Move before attacking whenever the Core route advances.
            if(order?.kind==="ASSAULT"&&!actor.moved&&attack?.defender?.kind!=="CORE"&&(!attack||(!attack.free&&attack.score<1&&attack.defender?.team!==actor.team))){
              plannedPath=measureDecision("enemyAI.movePath",()=>movePath(actor));
            }
            if(attack&&(!plannedPath?.length||attack.free)){requestAttack(attack);return;}
          }
          if(picked?.kind==="WAIT"){
            actor.moved=true;actor.acted=true;actor.waited=true;
            showStep("WAIT",`${actor.character.name} 選擇待機`,{unitId:actor.id});afterStep(continuePhase,300);return;
          }
          const path=picked?.kind==="MOVE"
            ? TacticalEngine.pathTo(ctx.map(),ctx.state().units,actor,picked.destination.x,picked.destination.y)
            :(plannedPath??measureDecision("enemyAI.movePath",()=>movePath(actor)));
          if(path.length)showStep("MOVE_PLAN",`${actorLabel(actor)} 決策｜${actor.character.name} 移動 ${path.length} 格`,{unitId:actor.id});
          afterStep(()=>animateMove(actor,path,async()=>{
            if(skipDefeatedActor(actor,marker))return;
            if(state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
              ctx.executeCapture(actor);afterStep(continuePhase,300);return;
            }
            const next=ctx.geminiEnabled?.()&&!ctx.aiExecuteSkill?await geminiPick("ENEMY_TACTICAL",tacticalChoices(actor,{afterMove:true}),actor):null;
            if(skipDefeatedActor(actor,marker))return;
            const attack=next?.kind==="ATTACK"?next.attack:next?.kind==="WAIT"?null:originalAttack();
            if(attack){requestAttack(attack);return;}
            actor.moved=true;actor.acted=true;actor.waited=true;
            showStep("WAIT",`${actor.character.name} 待機`,{unitId:actor.id});afterStep(continuePhase,300);
          }),path.length?350:0);
        },400);
      };

      const deploymentTiles=()=>{
        const state=ctx.state(),tiles=[];
        DeploymentEngine.points(state.stage).forEach(point=>{
          if(point.owner!=="ENEMY")return;
          (point.area||[]).forEach(pos=>{
            if(DeploymentEngine.canDeploy({stage:state.stage,map:state.map,units:state.units,owner:"ENEMY",x:pos.x,y:pos.y}))tiles.push(pos);
          });
        });
        return tiles;
      };

      const runCardPhase=done=>{
        const state=ctx.state(),cards=state.enemyCardState,marker=generation;
        if(!cards){done?.();return;}
        const handSize=Number(state.stage.enemyCardRules?.handSize||state.stage.cardRules?.handSize||5);
        const drawn=CardPhaseEngine.begin(cards,{handSize});
        ctx.pushLog(`Round ${state.round}｜敵方卡牌階段開始｜💎 ${cards.crystals}。`,"SYSTEM");
        if(drawn.length)ctx.pushLog(`敵方抽牌 ${drawn.length} 張。`,"SYSTEM");
        showStep("DRAW",drawn.length?`敵方抽牌 ${drawn.length} 張｜💎 ${cards.crystals}/${cards.crystalCapacity}`:`敵方檢視手牌｜💎 ${cards.crystals}/${cards.crystalCapacity}`);
        const rejected=new Set();
        const cardActions=()=>{
          if(!ctx.geminiEnabled?.()||ctx.aiExecuteSkill){
            const tiles=measured("enemyAI.deploymentTiles",()=>deploymentTiles());
            const core=ctx.coreForOwner("PLAYER"),w=ctx.state();
            const roster=w.units.filter(u=>u.alive&&u.team===ctx.TEAM.ENEMY);
            const playable=[...new Set(cards.zones.hand)].map(id=>CardDatabase.get(id)).filter(card=>CardPhaseEngine.canPlay(cards,card));
            const roles=new Map();for(const u of roster)roles.set(role(u),(roles.get(role(u))||0)+1);
            const picks=[];
            for(const card of playable.filter(CardDatabase.isCharacter)){
              const profile=globalThis.DeckEngine?.opponentCardProfile?.(card)||{},roleCount=roles.get(profile.role)||0;
              let best=null;
              const character=globalThis.LoadoutDatabase?.resolveCharacter?.(card.characterId,card.loadoutId||null);
              for(const tile of tiles){
                if(rejected.has(`${card.id}:${tile.x},${tile.y}`))continue;
                const ground=TacticalEngine.tile(w.map,tile.x,tile.y),d=core?distance(tile,core):0;
                if(character&&TacticalEngine.canOccupyTerrain&&!TacticalEngine.canOccupyTerrain({character},ground))continue;
                const adjacent=roster.filter(u=>distance(tile,u)<=1).length;
                if(!best||d<best.d||(d===best.d&&adjacent<best.adjacent))best={tile,d,adjacent};
              }
              if(best)picks.push({kind:"DEPLOY",card,tile:best.tile,label:`部署 ${card.name}`,roleCount,hero:card.unitType==="HERO",d:best.d});
            }
            picks.sort((a,b)=>a.roleCount-b.roleCount||Number(b.hero)-Number(a.hero)||b.card.cost-a.card.cost||a.d-b.d);
            // Weather is optional, not a compulsory crystal sink. Use rain only
            // when our water-magic roster outnumbers known opposing water users.
            const waterUser=u=>ctx.skillList(u).some(s=>s.waterMagic===true);
            const known=w.units.filter(u=>u.alive&&u.team!==ctx.TEAM.ENEMY&&roster.some(a=>TacticalEngine.actorCanTrackTarget(w.map,w.units,a,u,w.environmentState,w)));
            const rain=playable.find(c=>c.effect?.type==="WEATHER"&&c.effect.weather==="HEAVY_RAIN");
            if(rain&&!rejected.has(rain.id)&&w.environmentState&&w.environmentState.weather!=="HEAVY_RAIN"&&roster.filter(waterUser).length>known.filter(waterUser).length)
              picks.push({kind:"WEATHER",card:rain,label:`施放 ${rain.name}`});
            return [...picks,{kind:"END",label:"保留水晶並結束卡牌階段"}];
          }
          const out=[],tiles=measured("enemyAI.deploymentTiles",()=>deploymentTiles());
          const playable=[...new Set(cards.zones.hand)].map(id=>CardDatabase.get(id))
            .filter(card=>CardPhaseEngine.canPlay(cards,card));
          const assignments=teamPlan?.orders||[];
          const plannedObjectives=DeploymentEngine.points(state.stage).filter(pt=>
            assignments.some(o=>o.objective_id===pt.id)).flatMap(pt=>pt.captureTiles||[]);
          const sortedTiles=plannedObjectives.length?[...tiles].sort((a,b)=>{
            const near=t=>Math.min(...plannedObjectives.map(p=>Math.abs(p.x-t.x)+Math.abs(p.y-t.y)));
            return near(a)-near(b);
          }):tiles;
          // Every playable card gets considered before any card receives a
          // second deployment position. This prevents the first cheap unit
          // monopolizing the bounded 100-action model request.
          const candidateGroups=playable.map(card=>{
            if(CardDatabase.isCharacter(card))return sortedTiles.map(tile=>({kind:"DEPLOY",card,tile,
              label:`${card.name}｜${card.unitType}｜${card.cost} 水晶｜部署 (${tile.x},${tile.y})` }));
            if(CardDatabase.isSpell(card)&&card.effect?.type==="WEATHER"&&
              state.environmentState&&EnvironmentEngine.WEATHER?.[card.effect.weather==="RAIN"?"HEAVY_RAIN":card.effect.weather])
              return[{kind:"WEATHER",card,label:`施放 ${card.name}｜${card.cost} 水晶｜改變天氣`}];
            return[];
          });
          for(let index=0;candidateGroups.some(group=>group.length>index)&&out.length<99;index++)
            for(const group of candidateGroups){if(group[index]&&out.length<99)out.push(group[index]);}
          return [...out,{kind:"END",label:"保留水晶並結束卡牌階段"}];
        };
        const decide=async()=>{
          if(marker!==generation)return;
          const choices=cardActions();
          const picked=ctx.aiExecuteSkill?null:await geminiPick("ENEMY_CARD",choices);
          if(marker!==generation)return;
          const fallback=choices.find(a=>a.kind==="DEPLOY")||choices.find(a=>a.kind==="WEATHER")||choices[choices.length-1];
          const action=picked||fallback;
          if(action.kind==="END"){
            CardPhaseEngine.end(cards);showStep("CARD_END","敵方結束卡牌階段");afterStep(done,350);return;
          }
          const card=action.card;
          if(!CardPhaseEngine.canPlay(cards,card)){afterStep(decide,0);return;}
          if(action.kind==="WEATHER"){
            const requested=card.effect.weather==="RAIN"?"HEAVY_RAIN":card.effect.weather;
            if(!state.environmentState||!EnvironmentEngine.WEATHER?.[requested]){rejected.add(card.id);afterStep(decide,0);return;}
            const duration=Math.max(1,Number(card.effect.durationTurns||EnvironmentEngine.WEATHER_TURNS?.[requested]||1));
            if(!CardPhaseEngine.commit(cards,card)){rejected.add(card.id);afterStep(decide,0);return;}
            const events=EnvironmentEngine.setWeather(state.environmentState,requested,state.map,{duration,applyPulse:false,source:"CARD"})||[];
            events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:`敵方卡牌：${card.name}`});
            showStep("SPELL",`敵方施放 ${card.name}｜消耗 ${card.cost} 水晶`,{cardId:card.id});
            afterStep(decide,550);return;
          }
          const tile=action.tile;
          if(!DeploymentEngine.canDeploy({stage:state.stage,map:state.map,units:state.units,owner:"ENEMY",x:tile.x,y:tile.y})){
            rejected.add(`${card.id}:${tile.x},${tile.y}`);afterStep(decide,0);return;
          }
          const unit=ctx.createEnemyCardUnit(card,tile);
          if(!unit||!CardPhaseEngine.commit(cards,card,unit)){rejected.add(`${card.id}:${tile.x},${tile.y}`);afterStep(decide,0);return;}
          state.units.push(unit);ctx.onUnitCreated?.(unit);
          ctx.pushLog(`敵方使用「${card.name}」部署至 (${tile.x},${tile.y})｜本回合待命｜消耗 ${card.cost} 水晶。`,"SYSTEM");
          ctx.applyEnvironmentHazardToUnit(unit,{reason:"部署進入環境",waterTrigger:"ENTER"});
          showStep("DEPLOY",`${card.name} 部署 → (${tile.x},${tile.y})｜本回合待命`,{cardId:card.id,unitId:unit.id});
          afterStep(decide,550);
        };
        const initial=async()=>{
          if(cards.mulliganAvailable&&!cards.mulliganDone){
            let indices=ctx.geminiEnabled?.()&&!ctx.aiExecuteSkill?await ctx.geminiMulligan?.(cards):null;
            if(ctx.aiExecuteSkill&&!cards.zones.hand.some(id=>{const c=CardDatabase.get(id);return CardDatabase.isCharacter(c)&&CardPhaseEngine.canPlay(cards,c);})){
              indices=cards.zones.hand.map((id,index)=>({id,index})).filter(p=>CardDatabase.get(p.id)?.mulliganEligible!==false).slice(0,Math.max(0,cards.zones.hand.length-1)).map(p=>p.index);
            }
            if(marker!==generation)return;
            if(Array.isArray(indices))CardPhaseEngine.mulligan(cards,indices);
            else CardPhaseEngine.keepOpeningHand(cards);
          }
          afterStep(decide,drawn.length?600:300);
        };
        afterStep(initial,150);
      };

      const runPhase=()=>{
        const state=ctx.state(),marker=generation;
        ctx.setPhase(ctx.PHASE.ENEMY);ctx.clearSelection();ctx.clearEnemyReaction();ctx.pushLog(`Round ${state.round}｜敵方回合開始。`);
        const proceed=()=>runCardPhase(()=>{
          if(marker!==generation)return;
          if(ctx.checkMatchEnd()){ctx.render();return;}
          ctx.resetActions(ctx.TEAM.ENEMY);
          ctx.resetActions(NEUTRAL);
          const enemyActors=(ctx.turnActors?.(ctx.TEAM.ENEMY)||ctx.living(ctx.TEAM.ENEMY));
          enemyActors.filter(unit=>unit.deployedRound===state.round).forEach(unit=>{unit.moved=true;unit.acted=true;unit.waited=true;});
          const enemies=enemyActors.filter(unit=>unit.deployedRound!==state.round);
          usedFree.clear();assignObjectives(enemies);
          const sequence=teamPlan?.sequence||[];
          if(sequence.length)enemies.sort((a,b)=>{
            const ai=sequence.indexOf(a.id),bi=sequence.indexOf(b.id);
            return(ai<0?Infinity:ai)-(bi<0?Infinity:bi);
          });
          const neutrals=(ctx.turnActors?.(NEUTRAL)||ctx.living(NEUTRAL));
          queue=[...enemies,...neutrals];
          showStep("TACTICAL",neutrals.length?"敵方進入戰棋階段｜野怪將於敵軍後自主行動":"敵方進入戰棋階段");
          afterStep(continuePhase,350);
        });
        teamPlan=null;geminiTacticalUsed=false;
        if(ctx.geminiEnabled?.()&&ctx.geminiPlan){
          showStep("THINK","Gemini 正在規劃整隊部署與戰術");
          Promise.resolve(ctx.geminiPlan(enemySnapshot())).then(plan=>{
            if(marker!==generation||ctx.state().map!==state.map||ctx.state().phase!==ctx.PHASE.ENEMY)return;
            teamPlan=plan;proceed();
          }).catch(error=>{
            if(marker!==generation)return;
            ctx.pushLog(`Gemini 整隊規劃失敗：${String(error?.message||error).slice(0,120)}，回到合法行動流程。`,"SYSTEM");
            proceed();
          });
        }else proceed();
      };

      const reset=()=>{generation++;teamPlan=null;assignments.clear();usedFree.clear();queue=[];if(stepTimer){clearTimeout(stepTimer);stepTimer=null;}};
      return{runPhase,continuePhase,reset};
    }
  };
})();
