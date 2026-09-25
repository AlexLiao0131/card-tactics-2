(()=>{
"use strict";
function create(ctx){
 if(!ctx?.state||!ctx?.pushLog||!ctx?.checkMatchEnd)throw new Error("BattleCoreCaptureController requires state/log/checkMatchEnd.");
 const state=()=>ctx.state();
 const ownerForTeam=team=>team===ctx.TEAM.PLAYER||team==="P"?"PLAYER":team===ctx.TEAM.ENEMY||team==="E"?"ENEMY":null;
 const enemyOwner=owner=>owner==="PLAYER"?"ENEMY":owner==="ENEMY"?"PLAYER":null;
 function coreForOwner(owner){return state().cores.find(core=>core.owner===owner)||null}
 function coreAt(x,y){return state().cores.find(core=>core.hp>0&&core.x===x&&core.y===y)||null}
 function capturePointForUnit(unit){return DeploymentEngine.pointAt(state().stage,unit.x,unit.y)}
 function canUnitCapture(unit){const s=state(),point=capturePointForUnit(unit);return !!point&&DeploymentEngine.canCapture({stage:s.stage,units:s.units,unit,point})}

 function damageCore(owner,damage,source){
   const core=coreForOwner(owner);if(!core||core.hp<=0)return 0;
   let remaining=Math.max(0,Math.round(Number(damage||0))),dealt=0;
   const shieldBefore=Math.max(0,Number(core.shield||0));
   if(shieldBefore>0&&remaining>0){
     const absorbed=Math.min(shieldBefore,remaining);core.shield=shieldBefore-absorbed;remaining-=absorbed;dealt+=absorbed;
   }
   let hpDamage=0;
   if(remaining>0){hpDamage=Math.min(core.hp,remaining);core.hp=Math.max(0,core.hp-hpDamage);dealt+=hpDamage;}
   const shieldText=Number(core.maxShield||0)>0?`｜SHIELD ${core.shield}/${core.maxShield}`:"";
   ctx.pushLog(`${source} → ${core.name}｜${dealt} 傷害${shieldBefore>0?`（護盾吸收 ${Math.min(shieldBefore,Math.max(0,Math.round(Number(damage||0))))}）`:""}｜CORE HP ${core.hp}/${core.maxHp}${shieldText}。`,"BATTLE");
   ctx.checkMatchEnd();return dealt;
 }

 function executeCapture(unit){
   const s=state();if(!unit?.alive||unit.acted)return false;ctx.commitPendingMove(unit);
   const point=capturePointForUnit(unit);if(!point||!DeploymentEngine.canCapture({stage:s.stage,units:s.units,unit,point}))return false;
   const owner=ownerForTeam(unit.team);if(!owner)return false;
   const previousOwner=point.owner;if(!DeploymentEngine.capture(s.stage,point.id,owner))return false;
   ctx.pushLog(`${unit.character.name} 佔領「${point.name}」｜${previousOwner} → ${owner}。`,"SYSTEM");
   const damage=Number(s.stage.captureDamage||0),targetOwner=enemyOwner(owner);
   if(damage>0&&targetOwner)damageCore(targetOwner,damage,`${point.name} Core 砲擊`);
   ctx.stageEvent?.({type:"DEPLOYMENT_POINT_CAPTURED",pointId:point.id,owner,previousOwner,unitId:unit.id,characterId:unit.character.id,x:unit.x,y:unit.y});
   unit.moved=true;unit.acted=true;unit.waited=true;ctx.onCaptureComplete?.(unit,point);return true;
 }

 function reconcileHeldPoints(){return false;}

 function coreCombatTarget(core,attackerTeam){
   if(!core||core.hp<=0)return null;
   const attackerOwner=ownerForTeam(attackerTeam),targetTeam=attackerOwner==="PLAYER"?ctx.TEAM.ENEMY:attackerOwner==="ENEMY"?ctx.TEAM.PLAYER:null;
   if(!targetTeam)return null;
   return{kind:"CORE",id:`CORE:${core.owner}`,x:core.x,y:core.y,team:targetTeam,alive:true,core};
 }
 function combatTargetEntities(unit){
   const s=state(),entities=[...s.units],owner=ownerForTeam(unit?.team);
   if(s.stage?.ruleset==="CORE_CAPTURE"&&owner){const target=coreCombatTarget(coreForOwner(enemyOwner(owner)),unit.team);if(target)entities.push(target)}
   return entities;
 }

 return Object.freeze({ownerForTeam,enemyOwner,coreForOwner,coreAt,capturePointForUnit,canUnitCapture,damageCore,executeCapture,reconcileHeldPoints,coreCombatTarget,combatTargetEntities});
}
window.BattleCoreCaptureController=Object.freeze({create});
})();
