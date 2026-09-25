(()=>{
  "use strict";

  // Enemy + autonomous neutral encounter orchestration. Battle state remains owned by tactical-game.js.
  window.TacticalEnemyController={
    create(ctx){
      let queue=[];
      let stepTimer=null;
      const NEUTRAL=window.EncounterEngine?.TEAM_NEUTRAL||"N";

      const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
      const afterStep=(fn,ms=550)=>{
        if(stepTimer)clearTimeout(stepTimer);
        stepTimer=setTimeout(()=>{stepTimer=null;fn?.();},ms);
      };
      const showStep=(kind,message,extra={})=>{
        ctx.setEnemyView({active:true,kind,message,...extra});
        ctx.render();ctx.emitState();
      };
      const isNeutral=unit=>unit?.team===NEUTRAL;
      const actorLabel=unit=>isNeutral(unit)?"野怪":"AI";

      const singleSkills=actor=>ctx.skillList(actor).filter(skill=>
        skill.target==="ENEMY"&&ctx.targetType(skill)==="SINGLE"&&ctx.canUseSkill(actor,skill)
      );

      const targetEntities=actor=>{
        const state=ctx.state();
        if(isNeutral(actor))return state.units.filter(target=>target.alive&&target.id!==actor.id&&target.team!==actor.team);
        return ctx.combatTargets(actor).filter(target=>target.alive&&target.team!==actor.team);
      };

      const targetsForSkill=(actor,skill)=>targetEntities(actor).filter(target=>
        TacticalEngine.canTarget(ctx.map(),actor,target,skill,ctx.actionState?.().environmentState||null)
      );

      const chooseAttack=actor=>{
        for(const skill of singleSkills(actor)){
          const targets=targetsForSkill(actor,skill);
          if(targets.length){
            targets.sort((a,b)=>{
              const ah=a.kind==="CORE"?Number(a.core?.hp??Infinity):Number(a.hp??Infinity);
              const bh=b.kind==="CORE"?Number(b.core?.hp??Infinity):Number(b.hp??Infinity);
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
          .filter(unit=>unit.alive&&unit.id!==actor.id&&unit.team!==actor.team&&TacticalEngine.canSee(state.map,actor,unit,state.environmentState||null))
          .map(unit=>({x:unit.x,y:unit.y}));

        if(!isNeutral(actor)&&state.stage?.ruleset==="CORE_CAPTURE"){
          DeploymentEngine.points(state.stage).filter(point=>point.capturable!==false&&point.owner!=="ENEMY").forEach(point=>(point.captureTiles||[]).forEach(tile=>objectives.push(tile)));
          const core=ctx.coreForOwner("PLAYER");
          if(core?.hp>0)objectives.push({x:core.x,y:core.y});
        }

        if(!objectives.length)return[];
        const reachable=TacticalEngine.reachable(state.map,state.units,actor);
        if(!reachable.size)return[];
        let best=null;
        reachable.forEach((cost,key)=>{
          const[x,y]=key.split(",").map(Number);
          const tile=TacticalEngine.tile(state.map,x,y);
          if(!habitatAllows(actor,tile))return;
          const nearest=Math.min(...objectives.map(point=>Math.abs(x-point.x)+Math.abs(y-point.y)));
          if(!best||nearest<best.nearest||(nearest===best.nearest&&(cost<best.cost||(cost===best.cost&&(y<best.y||(y===best.y&&x<best.x))))))best={x,y,nearest,cost};
        });
        return best?TacticalEngine.pathTo(state.map,state.units,actor,best.x,best.y)||[]:[];
      };

      const animateMove=(actor,path,done)=>{
        const steps=[...(path||[])];
        const next=()=>{
          if(!steps.length||!actor.alive){actor.moved=true;done?.();return;}
          const tile=steps.shift();
          if(!habitatAllows(actor,tile)){actor.moved=true;done?.();return;}
          const result=ctx.traverseUnitPath(actor,[tile],{kind:"UNIT"});
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
        if(attack.defender?.kind==="CORE"){
          showStep("ATTACK",`AI 決策｜${attack.attacker.character.name} → ${attack.defender.core?.name||"CORE"}｜${attack.skill.name}`,{unitId:attack.attacker.id});
          afterStep(()=>{
            ctx.resolveDirectTargetAttack(attack.attacker,attack.defender,attack.skill);
            afterStep(continuePhase,350);
          },400);
          return;
        }

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

        showStep("THINK",`${actorLabel(actor)} 思考｜${actor.character.name}`,{unitId:actor.id});
        afterStep(()=>{
          if(!isNeutral(actor)&&state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
            ctx.executeCapture(actor);afterStep(continuePhase,300);return;
          }
          let attack=chooseAttack(actor);
          if(attack){requestAttack(attack);return;}

          const path=movePath(actor);
          if(path.length)showStep("MOVE_PLAN",`${actorLabel(actor)} 決策｜${actor.character.name} 移動 ${path.length} 格`,{unitId:actor.id});
          afterStep(()=>animateMove(actor,path,()=>{
            if(!isNeutral(actor)&&state.stage?.ruleset==="CORE_CAPTURE"&&ctx.canUnitCapture(actor)){
              ctx.executeCapture(actor);afterStep(continuePhase,300);return;
            }
            attack=chooseAttack(actor);
            if(attack){requestAttack(attack);return;}
            actor.moved=true;actor.acted=true;actor.waited=true;
            showStep("WAIT",`${actor.character.name} 待機`,{unitId:actor.id});
            afterStep(continuePhase,300);
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
        const state=ctx.state(),cards=state.enemyCardState;
        if(!cards){done?.();return;}
        const handSize=Number(state.stage.enemyCardRules?.handSize||state.stage.cardRules?.handSize||5);
        const drawn=CardPhaseEngine.begin(cards,{handSize});
        ctx.pushLog(`Round ${state.round}｜敵方卡牌階段開始｜💎 ${cards.crystals}。`,"SYSTEM");
        if(drawn.length)ctx.pushLog(`敵方抽牌 ${drawn.length} 張。`,"SYSTEM");
        showStep("DRAW",drawn.length?`敵方抽牌 ${drawn.length} 張｜💎 ${cards.crystals}/${cards.crystalCapacity}`:`敵方檢視手牌｜💎 ${cards.crystals}/${cards.crystalCapacity}`);
        const decide=()=>{
          const cardId=cards.zones.hand.find(id=>{
            const card=CardDatabase.get(id);
            return CardDatabase.isCharacter(card)&&CardPhaseEngine.canPlay(cards,card);
          });
          const tile=deploymentTiles()[0];
          if(!cardId||!tile){CardPhaseEngine.end(cards);showStep("CARD_END","敵方結束卡牌階段");afterStep(done,350);return;}
          const card=CardDatabase.get(cardId);
          showStep("CARD_SELECT",`敵方選擇「${card.name}」｜消耗 ${card.cost} 水晶`,{cardId:card.id});
          afterStep(()=>{
            const unit=ctx.createEnemyCardUnit(card,tile);
            if(!CardPhaseEngine.commit(cards,card)){CardPhaseEngine.end(cards);done?.();return;}
            state.units.push(unit);
            ctx.pushLog(`敵方使用「${card.name}」部署至 (${tile.x},${tile.y})｜本回合待命｜消耗 ${card.cost} 水晶。`,"SYSTEM");
            ctx.applyEnvironmentHazardToUnit(unit,{reason:"部署進入環境",waterTrigger:"ENTER"});
            showStep("DEPLOY",`${card.name} 部署 → (${tile.x},${tile.y})｜本回合待命`,{cardId:card.id,unitId:unit.id});
            afterStep(decide,550);
          },600);
        };
        afterStep(decide,drawn.length?600:300);
      };

      const runPhase=()=>{
        const state=ctx.state();
        ctx.setPhase(ctx.PHASE.ENEMY);ctx.clearSelection();ctx.clearEnemyReaction();ctx.pushLog(`Round ${state.round}｜敵方回合開始。`);
        runCardPhase(()=>{
          if(ctx.checkMatchEnd()){ctx.render();return;}
          ctx.resetActions(ctx.TEAM.ENEMY);
          ctx.resetActions(NEUTRAL);
          ctx.living(ctx.TEAM.ENEMY).filter(unit=>unit.deployedRound===state.round).forEach(unit=>{unit.moved=true;unit.acted=true;unit.waited=true;});
          const enemies=ctx.living(ctx.TEAM.ENEMY).filter(unit=>unit.deployedRound!==state.round);
          const neutrals=ctx.living(NEUTRAL);
          queue=[...enemies,...neutrals];
          showStep("TACTICAL",neutrals.length?"敵方進入戰棋階段｜野怪將於敵軍後自主行動":"敵方進入戰棋階段");
          afterStep(continuePhase,350);
        });
      };

      const reset=()=>{queue=[];if(stepTimer){clearTimeout(stepTimer);stepTimer=null;}};
      return{runPhase,continuePhase,reset};
    }
  };
})();
