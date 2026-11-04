/**
 * Canonical one-commit map-target skill bridge.
 * Only a single synchronous map action may enter this path, including
 * spatial transit whose complete landing is committed in the same command.
 * Skill geometry, movement, entry hazards, environmental reactions, costs and
 * completion are ALL owned by the original TacticalActionController.executeMapSkill().
 * The filter is a capability contract, never a per-character/skill ID list.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {createCanonicalAreaFields} from './pvp-field-controller.mjs';

const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');

/**
 * Eligibility is taken from the existing SkillDatabase capability, not a list
 * of character or skill IDs. Transport that needs a later choice (carry/drop)
 * deliberately stays outside this one-commit contract.
 *
 * Zero-impact W_STEP and single-exit wormholes already share the original
 * executeMapSkill path. Other moveToTarget types may damage units, enter a
 * channel, or traverse environment mid-way; they are not safe to opt in here.
 */
export function isCanonicalSpatialTransitSkill(skill){
  if(!skill||!['MAGIC','SPECIAL'].includes(skill.category)||
     skill.target!=='TILE'||skill.targetType!=='AOE'||Number(skill.radius||0)!==0||
     !skill.range||!Number.isSafeInteger(skill.range.min)||
     !Number.isSafeInteger(skill.range.max)||skill.range.min<0||
     skill.range.max<skill.range.min||
     Number(skill.power||0)!==0||skill.weapon||skill.attackType||
     skill.effects||skill.relationEffects||skill.postEffects||
     skill.afterUseEffects||skill.statusEffects||skill.variants?.length||skill.channel||
     skill.sanctuary||skill.smokeField||skill.bloodShadow||skill.bloodBurst||
     skill.approach||skill.terrainTargeting||skill.trapPlacement||
     skill.environmentTarget||skill.waterContact||skill.environmentForces||
     skill.hydrologyFlood||skill.areaDamage||skill.aoeDamage||skill.stance)
    return false;
  if(skill.shape==='W_STEP')
    return skill.moveToTarget===true&&skill.ignorePath===true&&!skill.utilityAction;
  if(skill.shape||skill.moveToTarget||!skill.utilityAction)return false;
  const u=skill.utilityAction;
  if(u.type==='TELEPORT_TO_TILE')return Object.keys(u).length===1;
  if(u.type==='WORMHOLE_TRANSIT')return (
    u.entry==='CASTER_TILE'&&u.exit==='TARGET_TILE'&&
    u.ignoreIntermediate===true&&u.requireLegalDestination===true&&
    u.persists===false&&
    Object.keys(u).sort().join('|')===
      'entry|exit|ignoreIntermediate|persists|requireLegalDestination|type');
  return false;
}

/** All other synchronous map AOEs use exactly the same original controller. */
export function isCanonicalImmediateMapSkill(skill){
  if(isCanonicalSpatialTransitSkill(skill))return true;
  if(!skill||!['MAGIC','SPECIAL'].includes(skill.category)||
     skill.target!=='TILE'||skill.targetType!=='AOE'||
     !Number.isFinite(Number(skill.radius))||Number(skill.radius)<0||
     skill.shape||skill.moveToTarget||skill.utilityAction||
     skill.sanctuary||skill.smokeField||skill.channel||skill.bloodShadow||
     skill.bloodBurst||skill.trapPlacement||skill.terrainTargeting||
     skill.environmentTarget||skill.waterContact||skill.approach||
     skill.variants?.length||skill.statusEffects?.length||
     skill.postEffects?.length||skill.afterUseEffects?.length||
     skill.relationEffects?.length||skill.effects?.length)return false;
  // executeMapSkill explicitly owns these synchronous effects. An unknown
  // AOE payload must not be 'successful' while silently doing nothing.
  if(skill.areaDamage&&skill.areaDamage.mode!=='MAGIC_POWER')return false;
  if(skill.environmentForces&&!Array.isArray(skill.environmentForces))return false;
  if(Array.isArray(skill.environmentForces)&&
     !skill.environmentForces.every(f=>Object.values(EnvironmentEngine.FORCE).includes(f)))
    return false;
  const damages=skill.areaDamage?.mode==='MAGIC_POWER'&&
    Number.isFinite(Number(skill.power))&&Number(skill.power)>0;
  const floods=Number.isFinite(Number(skill.hydrologyFlood?.surfaceRise))&&
    Number(skill.hydrologyFlood.surfaceRise)>0;
  const forces=Array.isArray(skill.environmentForces)&&skill.environmentForces.length>0;
  const flat=Number.isFinite(Number(skill.aoeDamage))&&Number(skill.aoeDamage)>0;
  if(skill.attackType&&!damages)return false;
  return !!(damages||floods||forces||flat);
}
export function canonicalImmediateMapSkillOptions(unit,engine){
  if(!unit?.alive||unit.acted||unit.waited)return[];
  return SkillDatabase.list(engine.effect.skillIds(unit)).filter(isCanonicalImmediateMapSkill);
}

export function castCanonicalMapSkill(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','x','y'])||action.type!=='CAST_MAP_SKILL'||
     ![action.unitId,action.skillId].every(v=>typeof v==='string'&&v.length>0)||
     !Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
    fail('INVALID_MAP_SKILL_COMMAND');
  const caster=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  if(!caster||caster.acted||caster.waited)fail('MAP_SKILL_ACTOR_UNAVAILABLE');
  const skill=canonicalImmediateMapSkillOptions(caster,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  if(!engine.unitRuntime.canUseSkill(caster,skill))fail('SKILL_RESOURCES_UNAVAILABLE');
  const environment=createCanonicalEnvironmentController(game,hooks);
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:TEAM[seat],ENEMY:TEAM[1-seat]},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    pushLog:hooks.pushLog,handleDefeated:hooks.handleDefeated,
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    coreAt:(x,y)=>game.battlefield.cores.find(c=>c.hp>0&&c.x===x&&c.y===y)||null,
    aoeTiles:(center,radius)=>TacticalEngine.aoeTiles(game.battlefield.map,center,radius),
    logEnvironmentEvent:environment.logEnvironmentEvent,
    resolveEnvironmentEvents:environment.resolveEnvironmentEvents,
    applyEnvironmentHazardToUnit:environment.applyEnvironmentHazardToUnit,
    // The canonical transit enters a real tile; the official environment
    // pipeline owns stage events, traps, currents and hazards at that tile.
    enterTile:environment.enterTile,
    traverseUnitPath:environment.traverseUnitPath,
    damageUnitFlat:hooks.damageUnitFlat,
    random:engine.random
  });
  const target=TacticalEngine.tile(game.battlefield.map,action.x,action.y);
  if(!target||!controller.mapTargetTiles(caster,skill).some(t=>t.x===target.x&&t.y===target.y))
    fail('ILLEGAL_MAP_SKILL_TARGET');
  const manaBefore=caster.mana;
  if(controller.executeMapSkill(caster,target,skill)!==true)
    fail('OFFICIAL_MAP_SKILL_REJECTED');
  // Immediate terrain effects may move units. Keep the existing smoke-field
  // effect layer consistent with those positions before creating snapshots.
  const areaFields=createCanonicalAreaFields(game,engine,hooks);
  game.units.filter(u=>u.alive).forEach(u=>areaFields.syncSmokeCover(u));
  return {accepted:true,state:game,unitId:caster.id,skillId:skill.id,
    x:target.x,y:target.y,manaBefore,manaAfter:caster.mana};
}
