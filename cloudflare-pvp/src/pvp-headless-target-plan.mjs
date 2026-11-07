/**
 * Read-only adapter to the SAME TacticalActionController.attackPlanForTarget
 * used in offline combat. No PvP movement or attack-range calculation.
 */
import '../../js/tactical-action-controller.js';
const TEAM=['P','E'];
/** Original TacticalActionController decides every reachable attack origin and
 * the path to the FIRST legal one. The PvP room does not duplicate range,
 * traversal cost, fog or elevation algorithms. This is a read-only plan. */
export function createCanonicalTargetPlanner(game,actor,engine,{extraTargets=[]}={}){
  const map=game.battlefield.map,units=game.units,environmentState=game.environmentState;
  const targets=[...units.filter(u=>u.alive),...extraTargets.filter(t=>t?.alive)];
  return globalThis.TacticalActionController.create({
    TEAM:{PLAYER:actor.team,ENEMY:TEAM.find(t=>t!==actor.team)},
    actionState:()=>({map,units,environmentState}),
    combatTargets:()=>targets,
    targetType:skill=>engine.unitRuntime.targetType(skill),
    canUseSkill:(u,skill)=>engine.unitRuntime.canUseSkill(u,skill)
  });
}
export function canonicalTargetPlan(game,actor,target,skill,engine,{planner=null,extraTargets=[]}={}){
  if(!actor?.alive||actor.acted||actor.waited||!target?.alive||!skill||
      !engine.unitRuntime.canUseSkill(actor,skill))return null;
  const ctrl=planner||createCanonicalTargetPlanner(game,actor,engine,{extraTargets});
  // Includes the original team-vision / target-type guard. Merely walking
  // closer must not reveal or permit an otherwise undiscovered enemy.
  if(!ctrl.targetableEntities(actor,skill).some(entity=>entity.id===target.id))return null;
  return ctrl.attackPlanForTarget(actor,target,skill);
}
