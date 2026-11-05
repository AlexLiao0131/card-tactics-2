/**
 * Environment-targeting half of a direct water-contact projectile.
 * A unit hit uses the same BattleResolution as every ordinary attack;
 * the alternate empty burning tile is executed by the exact original
 * TacticalActionController.environmentTargetTiles/executeEnvironmentTargetSkill.
 * No parallel extinguish, travel, flood, or resource rules.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import '../../js/tactical-action-controller.js';

const fail=code=>{throw new PvpCommandError(code)};
const TEAM=['P','E'],PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const validId=v=>typeof v==='string'&&v.length>0;
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
export function isCanonicalEnvironmentContactSkill(skill){
  return !!skill&&skill.target==='ENEMY'&&
    (!skill.targetType||skill.targetType==='SINGLE')&&
    ['ATTACK','MAGIC'].includes(skill.category)&&!!skill.weapon&&!!skill.attackType&&
    Number(skill.power)>0&&skill.environmentTarget==='BURNING'&&
    skill.waterContact==='RAIN_EVENT'&&
    !skill.utilityAction&&!skill.approach&&!skill.moveToTarget&&!skill.shape&&
    !skill.effects&&!skill.relationEffects&&!skill.statusEffects?.length&&
    !skill.postEffects?.length&&!skill.afterUseEffects?.length&&
    !skill.bloodBurst&&!skill.bloodShadow&&!skill.channel&&!skill.verdictCross&&
    !skill.terrainTargeting&&!skill.hydrologyFlood&&!skill.areaDamage&&
    !skill.aoeDamage&&!skill.trapPlacement&&!skill.environmentForces&&
    !skill.sanctuary&&!skill.smokeField&&!skill.variants?.length;
}
export function canonicalEnvironmentContactOptions(actor,engine){
  if(!actor?.alive||actor.acted||actor.waited)return[];
  return SkillDatabase.list(engine.effect.skillIds(actor))
    .filter(isCanonicalEnvironmentContactSkill)
    .filter(skill=>engine.unitRuntime.canUseSkill(actor,skill));
}
function officialContactController(game,engine,hooks,checkMatchEnd,actor){
  const environment=createCanonicalEnvironmentController(game,hooks);
  return globalThis.TacticalActionController.create({
    TEAM:{PLAYER:TEAM[0],ENEMY:TEAM[1]},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState,selected:actor}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    coreAt:(x,y)=>game.battlefield.cores?.find(c=>c.hp>0&&c.x===x&&c.y===y)||null,
    traverseUnitPath:(unit,path,opts)=>{
      const before={x:unit.x,y:unit.y};
      const result=environment.traverseUnitPath(unit,path,opts);
      if(unit.x!==before.x||unit.y!==before.y)engine.effect.interruptChannel(unit,'MOVE');
      return result;
    },
    logEnvironmentEvent:environment.logEnvironmentEvent,
    resolveEnvironmentEvents:environment.resolveEnvironmentEvents,
    pushLog:hooks.pushLog,setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setMode:()=>{},render:()=>{},emitState:()=>{}
  });
}
export function castCanonicalEnvironmentContact(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','x','y'])||
    action.type!=='CAST_ENVIRONMENT_CONTACT'||!validId(action.unitId)||!validId(action.skillId)||
    !Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
    fail('INVALID_ENVIRONMENT_CONTACT_COMMAND');
  if(game.pendingAttack)fail('ATTACK_ALREADY_PENDING');
  const actor=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===TEAM[seat]);
  if(!actor||actor.acted||actor.waited)fail('ACTOR_NOT_AVAILABLE');
  const skill=canonicalEnvironmentContactOptions(actor,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  const tile=TacticalEngine.tile(game.battlefield.map,action.x,action.y);
  if(!tile)fail('INVALID_ENVIRONMENT_TARGET');
  const controller=officialContactController(game,engine,hooks,checkMatchEnd,actor);
  if(!controller.environmentTargetTiles(actor,skill).includes(tile))
    fail('ILLEGAL_ENVIRONMENT_CONTACT');
  const manaBefore=actor.mana;
  if(controller.executeEnvironmentTargetSkill(actor,tile,skill)!==true)
    fail('OFFICIAL_ENVIRONMENT_CONTACT_REJECTED');
  return {accepted:true,state:game,unitId:actor.id,skillId:skill.id,
    x:tile.x,y:tile.y,manaBefore,manaAfter:actor.mana};
}
