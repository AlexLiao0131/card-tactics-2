/**
 * Pure presentation of the server's ORIGINAL TacticalActionController aiming.
 * Does not issue or authorize any command, move units, charge resources or
 * reveal a target whose identity the official perception engine conceals.
 */
import {TacticalEngine} from '../../js/tactical-engine.js';
import {BattleCoreCaptureController} from '../../js/battle-core-capture-controller.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {canonicalDirectAttackSkillOptions} from './pvp-headless-engagement.mjs';
import {canonicalTargetPlan} from './pvp-headless-target-plan.mjs';
import {canonicalDirectEffectSkillOptions} from './pvp-headless-effect-skills.mjs';
import {canonicalImmediateMapSkillOptions} from './pvp-headless-map-skills.mjs';
import {canonicalEnvironmentContactOptions} from './pvp-headless-environment-contact.mjs';
import '../../js/tactical-action-controller.js';

const TEAM=['P','E'];
const coordinates=tiles=>(tiles||[]).map(tile=>({x:tile.x,y:tile.y}));
export function projectCanonicalAimOptions(game,seat,unit,engine,{coreAttackSkillIds=[]}={}){
  if(!game?.battlefield?.map||!unit?.alive||unit.acted||unit.waited||
      unit.team!==TEAM[seat]||game.phase!==['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'][seat]||
      game.activeSeat!==seat)return[];
  const map=game.battlefield.map,units=game.units,environmentState=game.environmentState;
  const unitAt=(x,y)=>units.find(other=>other.alive&&other.occupiesTile!==false&&other.x===x&&other.y===y)||null;
  const coreAt=(x,y)=>game.battlefield.cores.find(core=>core.hp>0&&core.x===x&&core.y===y)||null;
  const visible=units.filter(other=>other.alive&&
    (other.team===unit.team||TacticalEngine.teamCanIdentifyUnit({map,units,environmentState},unit.team,other,environmentState)));
  // Use official CoreCombatTarget rather than a browser-owned fake unit.
  // The read-only methods never invoke the log/victory callbacks.
  const coreHost=BattleCoreCaptureController.create({TEAM:{PLAYER:'P',ENEMY:'E'},
    state:()=>({cores:game.battlefield.cores}),pushLog:()=>{},checkMatchEnd:()=>false});
  const enemyCore=coreHost.coreForOwner(seat===0?'ENEMY':'PLAYER');
  const coreTarget=coreHost.coreCombatTarget(enemyCore,unit.team);
  const coreSkills=new Set(coreAttackSkillIds);
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:unit.team,ENEMY:TEAM[1-seat]},
    actionState:()=>({map,units,environmentState}),
    combatTargets:()=>units.filter(other=>other.alive),
    targetType:skill=>engine.unitRuntime.targetType(skill),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    unitAt,coreAt,
    canTraverseMoveLine:(u,tile)=>TacticalEngine.canTraverseMoveLine(map,u,tile),
    lineTiles:(u,tile)=>TacticalEngine.lineTiles(map,u,tile)
  });
  const options=[];
  const push=(type,skill,tiles,{targetUnits=false,tileAction=false,planned=false,includeCore=false}={})=>{
    if(!skill||!engine.unitRuntime.canUseSkill(unit,skill))return;
    const ranged=coordinates(tiles),inside=new Set(ranged.map(t=>`${t.x},${t.y}`));
    const legal=tileAction?ranged:targetUnits?visible.filter(other=>
      (planned?!!canonicalTargetPlan(game,unit,other,skill,engine,{planner:controller}):
        TacticalEngine.canTarget(map,unit,other,skill,environmentState))&&
      inside.has(`${other.x},${other.y}`)).map(other=>({x:other.x,y:other.y})):[];
    if(includeCore&&coreTarget&&inside.has(`${coreTarget.x},${coreTarget.y}`)&&
        canonicalTargetPlan(game,unit,coreTarget,skill,engine,{extraTargets:[coreTarget]}))
      legal.push({x:coreTarget.x,y:coreTarget.y});
    options.push({type,skillId:skill.id,tiles:ranged,actionableTiles:legal});
  };
  // Same candidate origins as solo; the Worker performs the actual planned
  // movement before creating any defender reaction. A future origin is never
  // blindly considered legal unless the original planner can reach it.
  const currentOrigin={...unit,moved:true};
  for(const skill of canonicalDirectAttackSkillOptions(unit))
    push('DECLARE_ATTACK',skill,controller.targetRangeTiles(unit,skill),
      {targetUnits:true,planned:true,includeCore:coreSkills.has(skill.id)});
  for(const skill of canonicalDirectEffectSkillOptions(unit,engine)){
    if(skill.target==='SELF')continue;
    push('CAST_EFFECT_SKILL',skill,controller.targetRangeTiles(unit,skill),{targetUnits:true,planned:true});
  }
  for(const skill of canonicalImmediateMapSkillOptions(unit,engine))
    push('CAST_MAP_SKILL',skill,controller.mapTargetTiles(unit,skill),{tileAction:true});
  for(const skill of canonicalEnvironmentContactOptions(unit,engine))
    push('CAST_ENVIRONMENT_CONTACT',skill,controller.environmentTargetTiles(unit,skill),{tileAction:true});
  for(const skill of canonicalDirectAttackSkillOptions(unit)){
    if(!engine.effect.weaponEnchantment(unit,skill.weapon))continue;
    push('ATTACK_ENCHANTED_TERRAIN',skill,
      controller.enchantedTerrainTargetTiles(unit,skill),{tileAction:true});
  }
  return options;
}
