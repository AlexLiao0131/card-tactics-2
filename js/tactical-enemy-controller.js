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
      let generation=0;
      const enemySnapshot=(actor=null)=>{
        const world=ctx.state(),state=world.environmentState||{};
        const allied=world.units.filter(u=>u.alive&&u.team===ctx.TEAM.ENEMY);
        const tracked=world.units.filter(u=>u.alive&&u.team!==ctx.TEAM.ENEMY&&
          allied.some(observer=>TacticalEngine.actorCanTrackTarget(world.map,world.units,observer,u,state,world)));
        const summary=u=>({id:u.id,name:u.character?.name||u.id,x:u.x,y:u.y,hp:u.hp,mana:u.mana,
          maxHp:u.maxHp||u.character?.combat?.hp,effects:(u.effects||[]).map(e=>e.id||e.type).slice(0,6)});
        return{round:world.round,actor_id:actor?.id||null,map:{width:world.map?.width,height:world.map?.height},
          weather:state.weather||"CLEAR",time:state.timeOfDay||"DAY",
          allies:allied.map(summary),visible_opponents:tracked.map(summary),
          objectives:world.stage?.ruleset==="CORE_CAPTURE"?DeploymentEngine.points(world.stage).map(p=>({id:p.id,owner:p.owner,x:p.captureTiles?.[0]?.x,y:p.captureTiles?.[0]?.y})):[],
          crystals:world.enemyCardState?.crystals||0,
          hand:(world.enemyCardState?.zones?.hand||[]).map(id=>{const card=CardDatabase.get(id);return{id,name:card?.name||id,cost:card?.cost||0}}),
          cards_remaining:world.enemyCardState?.zones?.deck?.length||0,
          cores:["PLAYER","ENEMY"].map(owner=>{const core=ctx.coreForOwner(owner);return core?{owner,hp:core.hp,maxHp:core.maxHp}:null}).filter(Boolean)};
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
      const tacticalChoices=(actor,{afterMove=false}={})=>{
        const choices=[];
        if(ctx.canUnitCapture(actor))choices.push({kind:"CAPTURE",label:"佔領當前據點"});
        const burst=ctx.skillList(actor).find(skill=>skill.bloodBurst&&ctx.canUseSkill(actor,skill));
        if(burst)choices.push({kind:"ATTACK",label:`${burst.name}｜範圍攻擊`,attack:{attacker:actor,defender:actor,skill:burst}});
        for(const skill of singleSkills(actor)){
          for(const target of targetsForSkill(actor,skill)){
            if(choices.length>=75)break;
            choices.push({kind:"ATTACK",label:`${skill.name} → ${target.character?.name||target.core?.name||target.id}｜目標 ${target.id} HP ${target.hp??target.core?.hp??"?"}`,
              attack:{attacker:actor,defender:target,skill}});
          }
        }
        if(!afterMove&&!actor.moved){
          const map=ctx.map(),world=ctx.state(),targets=world.units.filter(u=>u.alive&&u.team!==actor.team&&
            TacticalEngine.actorCanTrackTarget(map,world.units,actor,u,world.environmentState||null,world));
          const goals=targets.map(u=>({x:u.x,y:u.y}));
          if(world.stage?.ruleset==="CORE_CAPTURE")DeploymentEngine.points(world.stage).filter(pt=>pt.owner!=="ENEMY")
            .forEach(pt=>(pt.captureTiles||[]).forEach(p=>goals.push(p)));
          const candidates=[...TacticalEngine.reachable(map,world.units,actor)].map(([key,cost])=>{
            const[x,y]=key.split(",").map(Number),tile=TacticalEngine.tile(map,x,y);
            return{x,y,cost,tile,goal:goals.length?Math.min(...goals.map(t=>Math.abs(t.x-x)+Math.abs(t.y-y))):0};
          }).filter(p=>p.tile&&habitatAllows(actor,p.tile)).sort((a,b)=>a.goal-b.goal||a.cost-b.cost||a.y-b.y||a.x-b.x).slice(0,14);
          for(const pos of candidates)
            choices.push({kind:"MOVE",label:`移動至 (${pos.x},${pos.y})｜移動成本 ${pos.cost}｜最近戰略目標 ${pos.goal}`,
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

      const targetsForSkill=(actor,skill)=>targetEntities(actor).filter(target=>
        measured("enemyAI.targetVisibility",()=>TacticalEngine.actorCanTrackTarget(ctx.map(),ctx.state().units,actor,target,ctx.actionState?.().environmentState||null,ctx.state()))&&
        measured("enemyAI.targetRangeLOS",()=>skill.bloodShadow?
          !!ctx.bloodShadowLanding?.(actor,target):TacticalEngine.canTarget(ctx.map(),actor,target,skill,ctx.actionState?.().environmentState||null))
      );

      const chooseAttack=actor=>{
        const burst=ctx.skillList(actor).find(skill=>skill.bloodBurst&&ctx.canUseSkill(actor,skill));
        if(burst)return{attacker:actor,defender:actor,skill:burst};
        for(const skill of singleSkills(actor)){
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

        if(!objectives.length)return[];
        const reachable=measured("enemyAI.reachable",()=>TacticalEngine.reachable(state.map,state.units,actor));
        if(!reachable.size)return[];
        let best=null;
        reachable.forEach((cost,key)=>{
          const[x,y]=key.split(",").map(Number);
          const tile=TacticalEngine.tile(state.map,x,y);
          if(!habitatAllows(actor,tile))return;
          const nearest=Math.min(...objectives.map(point=>Math.abs(x-point.x)+Math.abs(y-point.y)));
          if(!best||nearest<best.nearest||(nearest===best.nearest&&(cost<best.cost||(cost===best.cost&&(y<best.y||(y===best.y&&x<best.x))))))best={x,y,nearest,cost};
        });
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
        if(attack.skill?.bloodBurst||attack.skill?.bloodShadow){
          showStep("ATTACK",`AI｜${attack.attacker.character.name} 使用 ${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            if(attack.skill.bloodBurst)ctx.performBloodBurst?.(attack.attacker,attack.skill);
            else ctx.performBloodShadow?.(attack.attacker,attack.defender,attack.skill);
            afterStep(continuePhase,350);
          },400);return;
        }
        if(attack.defender?.kind==="CORE"){
          showStep("ATTACK",`AI 決策｜${attack.attacker.character.name} → ${attack.defender.core?.name||"CORE"}｜${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            ctx.resolveDirectTargetAttack(attack.attacker,attack.defender,attack.skill);
            afterStep(continuePhase,350);
          },400);
          return;
        }

        // During a hallucinated AI turn, the AI resolves against its mirror world without
        // opening a reaction window on the unaffected player's real presentation.
        if(ctx.hallucinationActiveFor?.(attack.attacker?.team)){resolveAutonomousAttack(attack);return;}

        // Any hostile SINGLE attack against a player-controlled unit uses the same reaction pipeline.
        // AI-vs-neutral and neutral-vs-AI remain autonomous because neither side is player-controlled.
        if(attack.defender.team!==ctx.TEAM.PLAYER){
          resolveAutonomousAttack(attack);
          return;
        }

        showStep("ATTACK",`${actorLabel(attack.attacker)} 決策｜${attack.attacker.character.name} → ${attack.defender.character.name}｜${attack.skill.name}`,{unitId:attack.attacker.id});
        afterStep(()=>{
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

      const continuePhase=()=>{
        const state=ctx.state();
        if(state.phase!==ctx.PHASE.ENEMY||state.matchResult||ctx.pendingEnemyAttack())return;
        const actor=queue.shift();
        if(!actor){finishPhase();return;}
        if(!actor.alive||actor.acted){afterStep(continuePhase,0);return;}
        const marker=generation;
        showStep("THINK",`${actorLabel(actor)} 思考｜${actor.character.name}`,{unitId:actor.id});
        afterStep(async()=>{
          if(marker!==generation||!actor.alive)return;
          if(isNeutral(actor)){
            const attack=measureDecision("enemyAI.chooseAttack",()=>chooseAttack(actor));
            if(attack){requestAttack(attack);return;}
            const path=measureDecision("enemyAI.movePath",()=>movePath(actor));
            animateMove(actor,path,()=>{const follow=chooseAttack(actor);if(follow)requestAttack(follow);
              else{actor.moved=true;actor.acted=true;actor.waited=true;afterStep(continuePhase,300);}});return;
          }
          if(!ctx.geminiEnabled?.()&&state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
            ctx.executeCapture(actor);afterStep(continuePhase,300);return;
          }
          let picked=ctx.geminiEnabled?.()?await geminiPick("ENEMY_TACTICAL",tacticalChoices(actor),actor):null;
          if(marker!==generation||ctx.pendingEnemyAttack()||!actor.alive)return;
          if(picked?.kind==="CAPTURE"&&ctx.canUnitCapture(actor)){ctx.executeCapture(actor);afterStep(continuePhase,300);return;}
          if(picked?.kind==="ATTACK"&&picked.attack){requestAttack(picked.attack);return;}
          const originalAttack=()=>measureDecision("enemyAI.chooseAttack",()=>chooseAttack(actor));
          if(!picked){const attack=originalAttack();if(attack){requestAttack(attack);return;}}
          if(picked?.kind==="WAIT"){
            actor.moved=true;actor.acted=true;actor.waited=true;
            showStep("WAIT",`${actor.character.name} 選擇待機`,{unitId:actor.id});afterStep(continuePhase,300);return;
          }
          const path=picked?.kind==="MOVE"
            ? TacticalEngine.pathTo(ctx.map(),ctx.state().units,actor,picked.destination.x,picked.destination.y)
            :measureDecision("enemyAI.movePath",()=>movePath(actor));
          if(path.length)showStep("MOVE_PLAN",`${actorLabel(actor)} 決策｜${actor.character.name} 移動 ${path.length} 格`,{unitId:actor.id});
          afterStep(()=>animateMove(actor,path,async()=>{
            if(marker!==generation||!actor.alive)return;
            if(state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
              ctx.executeCapture(actor);afterStep(continuePhase,300);return;
            }
            const next=ctx.geminiEnabled?.()?await geminiPick("ENEMY_TACTICAL",tacticalChoices(actor,{afterMove:true}),actor):null;
            if(marker!==generation||!actor.alive)return;
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
        const cardActions=()=>{
          // Zero-cost baseline compatibility: do not scan dozens of possible
          // deployments when the original computer AI is selected.
          if(!ctx.geminiEnabled?.()){
            const cardId=cards.zones.hand.find(id=>{const card=CardDatabase.get(id);
              return CardDatabase.isCharacter(card)&&CardPhaseEngine.canPlay(cards,card);});
            const tile=cardId?measured("enemyAI.deploymentTiles",()=>deploymentTiles()[0]):null;
            return cardId&&tile?
              [{kind:"DEPLOY",card:CardDatabase.get(cardId),tile,label:`部署 ${cardId}`},{kind:"END",label:"結束卡牌階段"}]:
              [{kind:"END",label:"結束卡牌階段"}];
          }
          const out=[],tiles=measured("enemyAI.deploymentTiles",()=>deploymentTiles());
          for(const id of [...new Set(cards.zones.hand)]){
            const card=CardDatabase.get(id);if(!CardPhaseEngine.canPlay(cards,card))continue;
            if(CardDatabase.isCharacter(card))for(const tile of tiles.slice(0,12)){
              if(out.length>=98)break;
              out.push({kind:"DEPLOY",card,tile,label:`${card.name}｜${card.cost} 水晶｜部署 (${tile.x},${tile.y})`});
            }
            // Weather spells use the same EnvironmentEngine.setWeather as player cards.
            if(CardDatabase.isSpell(card)&&card.effect?.type==="WEATHER")out.push({kind:"WEATHER",card,label:`施放 ${card.name}｜${card.cost} 水晶｜改變天氣`});
          }
          // The proxy accepts at most 100 options including END.
          return [...out.slice(0,99),{kind:"END",label:"保留水晶並結束卡牌階段"}];
        };
        const decide=async()=>{
          if(marker!==generation)return;
          const choices=cardActions();
          const picked=await geminiPick("ENEMY_CARD",choices);
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
            if(!state.environmentState||!EnvironmentEngine.WEATHER?.[requested]){afterStep(decide,0);return;}
            const duration=Math.max(1,Number(card.effect.durationTurns||EnvironmentEngine.WEATHER_TURNS?.[requested]||1));
            if(!CardPhaseEngine.commit(cards,card)){afterStep(decide,0);return;}
            const events=EnvironmentEngine.setWeather(state.environmentState,requested,state.map,{duration,applyPulse:false,source:"CARD"})||[];
            events.forEach(ctx.logEnvironmentEvent);ctx.resolveEnvironmentEvents?.(events,{reason:`敵方卡牌：${card.name}`});
            showStep("SPELL",`敵方施放 ${card.name}｜消耗 ${card.cost} 水晶`,{cardId:card.id});
            afterStep(decide,550);return;
          }
          const tile=action.tile;
          if(!DeploymentEngine.canDeploy({stage:state.stage,map:state.map,units:state.units,owner:"ENEMY",x:tile.x,y:tile.y})){
            afterStep(decide,0);return;
          }
          const unit=ctx.createEnemyCardUnit(card,tile);
          if(!unit||!CardPhaseEngine.commit(cards,card)){afterStep(decide,0);return;}
          state.units.push(unit);ctx.onUnitCreated?.(unit);
          ctx.pushLog(`敵方使用「${card.name}」部署至 (${tile.x},${tile.y})｜本回合待命｜消耗 ${card.cost} 水晶。`,"SYSTEM");
          ctx.applyEnvironmentHazardToUnit(unit,{reason:"部署進入環境",waterTrigger:"ENTER"});
          showStep("DEPLOY",`${card.name} 部署 → (${tile.x},${tile.y})｜本回合待命`,{cardId:card.id,unitId:unit.id});
          afterStep(decide,550);
        };
        const initial=async()=>{
          if(cards.mulliganAvailable&&!cards.mulliganDone){
            const indices=await ctx.geminiMulligan?.(cards);
            if(marker!==generation)return;
            if(Array.isArray(indices))CardPhaseEngine.mulligan(cards,indices);
            else CardPhaseEngine.keepOpeningHand(cards);
          }
          afterStep(decide,drawn.length?600:300);
        };
        afterStep(initial,150);
      };

      const runPhase=()=>{
        const state=ctx.state();
        ctx.setPhase(ctx.PHASE.ENEMY);ctx.clearSelection();ctx.clearEnemyReaction();ctx.pushLog(`Round ${state.round}｜敵方回合開始。`);
        runCardPhase(()=>{
          if(ctx.checkMatchEnd()){ctx.render();return;}
          ctx.resetActions(ctx.TEAM.ENEMY);
          ctx.resetActions(NEUTRAL);
          const enemyActors=(ctx.turnActors?.(ctx.TEAM.ENEMY)||ctx.living(ctx.TEAM.ENEMY));
          enemyActors.filter(unit=>unit.deployedRound===state.round).forEach(unit=>{unit.moved=true;unit.acted=true;unit.waited=true;});
          const enemies=enemyActors.filter(unit=>unit.deployedRound!==state.round);
          const neutrals=(ctx.turnActors?.(NEUTRAL)||ctx.living(NEUTRAL));
          queue=[...enemies,...neutrals];
          showStep("TACTICAL",neutrals.length?"敵方進入戰棋階段｜野怪將於敵軍後自主行動":"敵方進入戰棋階段");
          afterStep(continuePhase,350);
        });
      };

      const reset=()=>{generation++;queue=[];if(stepTimer){clearTimeout(stepTimer);stepTimer=null;}};
      return{runPhase,continuePhase,reset};
    }
  };
})();
