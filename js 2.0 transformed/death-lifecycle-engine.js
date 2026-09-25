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

      ctx.stageEvent({type:"UNIT_DEFEATED",unitId:unit.id,characterId:unit.character.id,team:unit.team});

      const cards=ctx.cardStateFor(unit);
      if(unit.cardId&&cards){
        CardPhaseEngine.characterDefeated(cards,unit.cardId);
        ctx.pushLog(`${unit.character.name} 戰敗，角色卡進入墓地。`,"SYSTEM");
      }

      if(window.EncounterRewardEngine?.resolveDefeat){
        EncounterRewardEngine.resolveDefeat(unit,source,cause,{pushLog:ctx.pushLog});
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
