export const DeathLifecycleEngine=(()=>{
  function create(ctx){
    if(!ctx?.stageEvent||!ctx?.cardStateFor||!ctx?.pushLog)throw new Error("DeathLifecycleEngine requires stage/card/log callbacks.");
    const finalized=new Set();

    function finalize(unit,source=null,cause=null){
      if(!unit||Number(unit.hp)>0)return false;
      unit.hp=0;
      unit.alive=false;
      if(finalized.has(unit.id))return false;
      finalized.add(unit.id);

      globalThis.UnitAnimationEngine?.emitDeath?.(unit,{
        sourceId:source?.id||null,
        causeType:cause?.type||cause?.id||null,
        causeName:cause?.name||null
      });

      ctx.stageEvent({type:"UNIT_DEFEATED",unitId:unit.id,characterId:unit.character.id,team:unit.team});

      const cards=ctx.cardStateFor(unit);
      if(unit.cardId&&cards){
        CardPhaseEngine.characterDefeated(cards,unit.cardId);
        ctx.pushLog(`${unit.character.name} 戰敗，角色卡進入墓地。`,"SYSTEM");
      }

      if(window.EncounterRewardEngine?.resolveDefeat){
        EncounterRewardEngine.resolveDefeat(unit,source,cause,{pushLog:ctx.pushLog});
      }

      if(window.RewardEngine?.resolveDefeat){
        const reward=RewardEngine.resolveDefeat(unit,source,cause);
        if(reward?.ok)ctx.pushLog(`擊破獎勵｜${unit.character.name}｜Gold +${reward.amount}｜目前 ${reward.total} G。`,"SYSTEM");
      }

      const companions=globalThis.UnitRuntimeEngine?.despawnCompanionsForOwner?.(unit)||[];
      for(const companion of companions){
        ctx.pushLog(`${companion.character?.name||"伴隨單位"} 因 ${unit.character.name} 離場而撤出戰場。`,"SYSTEM");
      }

      ctx.onDefeated?.(unit,source,cause);
      ctx.onFinalized?.(unit,source,cause);
      return true;
    }

    function reset(){finalized.clear()}
    return Object.freeze({finalize,reset});
  }
  return Object.freeze({create});
})();
globalThis.DeathLifecycleEngine=DeathLifecycleEngine;
