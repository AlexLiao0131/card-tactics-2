(()=>{
"use strict";
const T={ENEMY_WIPED:"ENEMY_WIPED",PLAYER_WIPED:"PLAYER_WIPED",DEFEAT_TARGET:"DEFEAT_TARGET",PROTECT_TARGET:"PROTECT_TARGET",REACH_AREA:"REACH_AREA",SURVIVE_ROUNDS:"SURVIVE_ROUNDS",DESTROY_CORE:"DESTROY_CORE",CAPTURE_POINTS:"CAPTURE_POINTS"};
const aliases={DEFEAT_ALL_ENEMIES:{type:T.ENEMY_WIPED},DEFEAT_ALL_PLAYERS:{type:T.PLAYER_WIPED},DESTROY_ENEMY_CORE:{type:T.DESTROY_CORE,owner:"ENEMY"},PLAYER_CORE_DESTROYED:{type:T.DESTROY_CORE,owner:"PLAYER"}};
function norm(n){if(!n)return null;if(typeof n==="string")n={type:n};return aliases[n.type]?{...aliases[n.type],...n,type:aliases[n.type].type}:n}
const team=t=>t==="PLAYER"?"P":"E";
const living=(c,t)=>(c.units||[]).filter(u=>u.alive&&u.team===team(t));
function reserve(c,t){const s=t==="PLAYER"?c.cardState:c.enemyCardState;return !!s?.zones&&[...(s.zones.hand||[]),...(s.zones.deck||[])].some(id=>c.isCharacterCard?.(id))}
function wiped(c,t){return living(c,t).length===0&&!reserve(c,t)&&!c.hasPendingReinforcement?.(t)}
function targets(n,c){return(c.units||[]).filter(u=>(!n.team||u.team===team(n.team))&&(!n.unitId||u.id===n.unitId)&&(!n.characterId||u.character?.id===n.characterId))}
function evaluate(raw,c){
 const n=norm(raw);if(!n)return false;
 if(n.mode==="ALL"||n.mode==="ANY"||Array.isArray(n.conditions)){const a=(n.conditions||[]).map(x=>evaluate(x,c));return n.mode==="ANY"?a.some(Boolean):a.length>0&&a.every(Boolean)}
 switch(n.type){
  case T.ENEMY_WIPED:return wiped(c,"ENEMY");
  case T.PLAYER_WIPED:return wiped(c,"PLAYER");
  case T.DEFEAT_TARGET:{const a=targets(n,c);return a.length>0&&a.every(u=>!u.alive)}
  case T.PROTECT_TARGET:return targets(n,c).some(u=>u.alive);
  case T.REACH_AREA:{const area=n.area||c.areas?.[n.areaId]||[];return targets(n,c).some(u=>u.alive&&area.some(p=>+p.x===u.x&&+p.y===u.y))}
  case T.SURVIVE_ROUNDS:return +(c.round||0)>=+(n.rounds||n.round||0);
  case T.DESTROY_CORE:{const core=(c.cores||[]).find(x=>x.owner===n.owner);return !!core&&core.hp<=0}
  case T.CAPTURE_POINTS:{const pts=(c.deploymentPoints||[]).filter(p=>!n.pointIds||n.pointIds.includes(p.id)),need=+(n.count||pts.length);return pts.filter(p=>p.owner===n.owner).length>=need}
  default:return false;
 }
}
function evaluateMatch(stage,c){if(evaluate(stage?.defeat,c))return{ended:true,result:"DEFEAT"};if(evaluate(stage?.victory,c))return{ended:true,result:"VICTORY"};return{ended:false,result:null}}
window.ObjectiveEngine={TYPES:T,evaluate,evaluateMatch};
})();