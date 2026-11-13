/**
 * Canonical one-commit map-target skill bridge.
 * Only a single synchronous map action may enter this path, including
 * spatial transit whose complete landing is committed in the same command.
 * Skill geometry, movement, entry hazards, environmental reactions, costs and
 * completion are ALL owned by the original TacticalActionController.executeMapSkill().
 * The filter is a capability contract, never a per-character/skill ID list.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {AngelWingBarrierEngine} from '../../js/angel-wing-barrier-engine.js';
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
  if(u.type==='RANGER_FORMATION_MARCH')return Object.keys(u).length===1;
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
/** Original immediate LINE strike, authored by SkillDatabase. Uses the
 * SAME TacticalActionController.executeMapSkill / TacticalEngine geometry as
 * the browser; no new PVP damage, traversal, or enchantment formulas. */
export function isCanonicalLineTransitSkill(skill){
  return !!skill&&skill.category==='ATTACK'&&skill.target==='TILE'&&
    skill.targetType==='AOE'&&skill.shape==='LINE'&&
    skill.moveToTarget===true&&skill.range&&
    Number.isSafeInteger(skill.range.min)&&Number.isSafeInteger(skill.range.max)&&
    skill.range.min>=1&&skill.range.max>=skill.range.min&&
    Number.isFinite(skill.power)&&skill.power>0&&
    typeof skill.weapon==='string'&&skill.weapon.length>0&&
    typeof skill.attackType==='string'&&skill.attackType.length>0&&
    !skill.utilityAction&&!skill.approach&&!skill.effects&&!skill.relationEffects&&
    !skill.statusEffects?.length&&!skill.postEffects?.length&&
    !skill.afterUseEffects?.length&&!skill.variants?.length&&!skill.channel&&
    !skill.sanctuary&&!skill.smokeField&&!skill.bloodShadow&&!skill.bloodBurst&&
    !skill.trapPlacement&&!skill.terrainTargeting&&!skill.environmentTarget&&
    !skill.waterContact&&!skill.environmentForces&&!skill.hydrologyFlood&&
    !skill.areaDamage&&!skill.aoeDamage&&!skill.stance&&!skill.verdictCross&&
    !skill.affixes?.length;
}
/** Formation fire is an authoritative map AOE, not a collection of
 * client-initiated SUPPORT attacks. TacticalActionController owns every roll,
 * bow contribution, enchantment charge, damage and environment event. */
export function isCanonicalRangerVolleySkill(skill){
  return skill?.rangerVolley===true&&skill?.category==='SPECIAL'&&
    skill.target==='TILE'&&skill.targetType==='AOE'&&
    skill.attackType==='SHOT'&&typeof skill.weapon==='string'&&!!skill.weapon&&
    Number(skill.power)>0&&Number.isSafeInteger(skill.radius)&&skill.radius>0&&
    Number.isSafeInteger(skill.range?.min)&&Number.isSafeInteger(skill.range?.max)&&
    skill.range.min>=1&&skill.range.max>=skill.range.min&&
    !skill.utilityAction&&!skill.effects&&!skill.relationEffects&&
    !skill.sanctuary&&!skill.smokeField&&!skill.terrainTargeting&&!skill.areaDamage;
}
export function isCanonicalImmediateMapSkill(skill){
  if(skill?.dispelConstruct===AngelWingBarrierEngine.TYPE)
    return skill.category==='MAGIC'&&skill.target==='ENEMY'&&
      skill.dispelChoice==='POSITIVE'&&Number(skill.power||0)===0&&
      Array.isArray(skill.effects)&&skill.effects.length===1&&
      skill.effects[0].type==='DISPEL_POSITIVE'&&!skill.weapon&&!skill.attackType;
  if(AngelWingBarrierEngine.isCanonicalSkill(skill))return true;
  if(skill?.purifiedSlash&&skill?.id==="nether_slash"&&skill?.target==="TILE"&&
     skill?.targetType==="AOE"&&skill?.shape==="FAN")return true;
  if(isCanonicalSpatialTransitSkill(skill)||isCanonicalLineTransitSkill(skill)||
     isCanonicalRangerVolleySkill(skill))return true;
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
  const whirlpool=skill.whirlpool?.onlyEnemies===true&&
    Number.isSafeInteger(skill.whirlpool?.duration)&&skill.whirlpool.duration>0&&
    Number(skill.radius)>0&&Number(skill.power||0)===0;
  // These owned effects run exclusively via the original map controller.
  if(skill.whirlpool&&!whirlpool)return false;
  if(skill.tsunamiWave&&!(floods&&Number.isSafeInteger(skill.tsunamiWave.width)&&
      skill.tsunamiWave.width>0))return false;
  if(skill.attackType&&!damages)return false;
  return !!(damages||floods||forces||flat||whirlpool);
}
export function canonicalImmediateMapSkillOptions(unit,engine){
  if(!unit?.alive||unit.acted||unit.waited)return[];
  return SkillDatabase.list(engine.effect.skillIds(unit)).map(s=>engine.unitRuntime.skillForUnit(unit,s)).filter(isCanonicalImmediateMapSkill);
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
  if(AngelWingBarrierEngine.isCanonicalSkill(skill)){
    const target=TacticalEngine.tile(game.battlefield.map,action.x,action.y);
    if(!target||!AngelWingBarrierEngine.legalTiles(game.battlefield.map,game.units,caster,
        {cores:game.battlefield.cores}).some(tile=>tile.x===target.x&&tile.y===target.y))
      fail('ILLEGAL_WING_BARRIER_TARGET');
    const manaBefore=caster.mana,fromAir=caster.verticalState?.mode==='FLYING';
    const result=AngelWingBarrierEngine.cast({map:game.battlefield.map,units:game.units,
      actor:caster,landing:target,skill,cores:game.battlefield.cores,
      traverse:environment.traverseUnitPath,
      consumeSkill:(unit,used)=>engine.unitRuntime.consumeSkill(unit,used)});
    if(result.interrupted)return{accepted:true,state:game,unitId:caster.id,
      skillId:skill.id,movement:result.movement,castInterrupted:true};
    if(!result.ok)fail('OFFICIAL_WING_BARRIER_REJECTED');
    caster.moved=true;caster.acted=true;caster.waited=true;
    globalThis.UnitAnimationEngine?.emitAction?.(caster,target,skill,{targetKind:'MAP'});
    hooks.pushLog(`${caster.character.name} ${fromAir?'降落並':''}展開四格聖翼壁障。`,'BATTLE');
    return{accepted:true,state:game,unitId:caster.id,skillId:skill.id,
      x:target.x,y:target.y,manaBefore,manaAfter:caster.mana};
  }
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:TEAM[seat],ENEMY:TEAM[1-seat]},
    actionState:()=>({map:game.battlefield.map,units:game.units,round:game.round,
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
    lineTiles:(u,end)=>TacticalEngine.lineTiles(game.battlefield.map,u,end),
    canTraverseMoveLine:(u,end)=>TacticalEngine.canTraverseMoveLine(game.battlefield.map,u,end),
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
