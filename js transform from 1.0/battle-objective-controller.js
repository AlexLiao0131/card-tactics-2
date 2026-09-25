(()=>{
"use strict";
function create(ctx){
 if(!ctx?.state||!ctx?.setMatchResult)throw new Error("BattleObjectiveController requires state/setMatchResult.");
 function hasPendingReinforcement(team){
   const s=ctx.state();
   return !!window.StageEngine?.hasPendingSpawn?.(s.stageState,team);
 }
 function activeObjectives(){
   const s=ctx.state();
   return window.StageEngine?.objectives?.(s.stageState,s.stage)||{victory:s.stage?.victory??null,defeat:s.stage?.defeat??null};
 }
 function objectiveContext(){
   const s=ctx.state(),areas={};
   for(const point of DeploymentEngine.points(s.stage))areas[point.id]=point.area||point.captureTiles||[];
   for(const[id,area]of Object.entries(s.stage.objectiveAreas||{}))areas[id]=area;
   return{round:s.round,units:s.units,cores:s.cores,cardState:s.cardState,enemyCardState:s.enemyCardState,areas,deploymentPoints:DeploymentEngine.points(s.stage),isCharacterCard:id=>CardDatabase.isCharacter(CardDatabase.get(id)),hasPendingReinforcement};
 }
 function checkMatchEnd(){
   const s=ctx.state();
   if(s.matchResult)return true;
   const result=ObjectiveEngine.evaluateMatch(activeObjectives(),objectiveContext());
   if(!result.ended)return false;
   ctx.setMatchResult(result.result);ctx.onMatchEnd?.(result.result);return true;
 }
 return Object.freeze({hasPendingReinforcement,activeObjectives,objectiveContext,checkMatchEnd});
}
window.BattleObjectiveController=Object.freeze({create});
})();
