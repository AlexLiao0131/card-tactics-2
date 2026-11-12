/**
 * Canonical presentation-only recipe registry. Skill IDs appear here once;
 * dedicated geometry implementations own SHAPES, not hero identities.
 * No gameplay calculations, damage, MP or target validation live here.
 * A new skill can reuse a role without changing BabylonRenderer.
 */
const defs={
  'shield-guard':{roles:{SWAP:['colin_ally_swap'],GUARD:['colin_full_shield_defense'],BASH:['colin_shield_bash']},events:[],status:{GUARD:'FULL_SHIELD_DEFENSE',STUN:'STUN'},legacy:'shieldGuardVfx'},
  'swordsmanship':{
    roles:{CUT:['leon_slash'],PIERCE:['leon_thrust'],STRIKE:['leon_strike'],FLASH:['lion_flash']},
    events:['UNIT_FLOAT_TEXT'],legacy:'swordsmanshipVfx'},
  'holy-blade':{
    roles:{VERDICT:['templar_verdict']},events:['TEMPLAR_VERDICT_IMPACT'],
    legacy:'verdictVfx'},
  'holy-volley':{
    roles:{RAIN:['angel_holy_arrow_rain']},events:[],
    legacy:'holyArrowRainVfx',specializedProjectile:true},
  'projectile':{roles:{},events:[],legacy:'arrowProjectileVfx',genericProjectile:true},
  'fire-impact':{roles:{},events:['FIRE_BOW_EXPLOSION'],legacy:'fireBowExplosionVfx'},
  'dimensional':{
    roles:{BOLT:['velsa_arcane_bolt'],CORRUPTION:['velsa_cognitive_corruption'],
      FOLD:['velsa_space_fold'],COLLAPSE:['velsa_dimension_collapse'],
      BREAKDOWN:['velsa_existence_breakdown']},events:['VELSA_BACKLASH'],
    status:{RESOURCE_CHARACTER:'velsa'},legacy:'velsaDimensionalVfx'},
  'arcane':{
    roles:{ANALYZE:['cassandra_magic_bolt'],MANA_BURN:['cassandra_fire_burst'],
      DISPEL:['cassandra_frost'],DISSOLVE:['cassandra_dissolve']},events:[],
    status:{ANALYSIS:'CASSANDRA_ANALYSIS'},legacy:'cassandraArcaneVfx'},
  'shadow-elemental':{
    roles:{STEP:['shadow_step'],SLASH:['nether_slash'],ENCHANT:['elemental_enchant'],
      ELEMENT_CONTACT:['bow_shot','black_slash']},events:[],
    status:{WEAPON_ENCHANT:'WEAPON_ENCHANT'},legacy:'liviaCombatVfx'},
  'nature-growth':{
    roles:{ARC:['ophi_eagle_arc_shot'],BASIC:['ophi_elven_shot'],
      FAN:['ophi_multishot'],TRIPLE:['ophi_triple_shot'],BACK:['ophi_backstep_shot'],
      WRATH:['ophi_forest_wrath'],SONG:['ophi_healing_song'],ENTANGLE:['ophi_forest_entangle']},
      events:['OPHI_FOREST_SOUL_COLLECT'],
    status:{SONG:'OPHI_HEALING_SONG',ENTANGLE:'FOREST_ENTANGLED'},legacy:'ophiNatureVfx'},
  // Shared effect behaviors, not per-character JS files. Existing canonical
  // tsunami, whirlpool and smoke meshes remain with Water/EnvironmentRenderer.
  'holy-ritual':{
    roles:{JUDGEMENT:['saint_judgement'],HEAL:['saint_hero_heal','templar_healing'],
      PURIFY:['saint_hero_dispel'],BLESS:['saint_hero_blessing'],
      SANCTUARY:['saint_sanctuary'],SLASH:['templar_holy_slash'],
      CHARGE:['templar_charge'],SHIELD:['templar_holy_shield']},events:[],
    status:{OVERHEAL:'SAINT_OVERHEAL_SHIELD',BLESSING:'ROYAL_BLESSING',
      GRACE:'GRACE',HP_LINK:'TEMPLAR_HP_LINK',HOLY_SHIELD:'HOLY_SHIELD'},
    legacy:'holyRitualVfx'},
  'aquatic-magic':{
    roles:{THRUST:['nereia_trident_thrust'],THROW:['nereia_trident_throw'],
      BULLET:['nereia_water_bullet'],WHIRLPOOL:['nereia_whirlpool'],
      TSUNAMI:['nereia_tsunami'],DRAG:['nereia_deep_drag']},events:[],
    status:{WATER_SHIELD:'NEREIA_TSUNAMI_WATER_SHIELD'},legacy:'aquaticMagicVfx'},
  'blade-stealth':{
    roles:{DOUBLE:['cat_dual_slash'],BACKSTAB:['cat_backstab'],
      POISON_KNIFE:['cat_poison_knife'],SMOKE:['cat_smoke_bomb'],
      STEAL:['cat_pickpocket'],HIDE:['cat_hide']},events:[],
    status:{POISON:'POISON',STEALTH:'STEALTH'},legacy:'bladeStealthVfx'},
  'blood-ritual':{
    roles:{RAZOR:['seraphina_rending_claw'],SHADOW:['seraphina_blood_drain'],
      BURST:['seraphina_blood_burst'],REGEN:['seraphina_regeneration']},events:[],
    status:{BLEED:'BLEEDING',AWAKENED_CHARACTER:'seraphina'},legacy:'seraphinaBloodVfx'}
};
const freeze=v=>{
  if(v&&typeof v==='object'&&!Object.isFrozen(v)){
    for(const nested of Object.values(v))freeze(nested);
    Object.freeze(v);
  }
  return v;
};
freeze(defs);
const roleIndex=new Map();
const routes=new Map();
for(const [module,definition] of Object.entries(defs)){
  const bySkill=new Map();
  for(const [role,ids] of Object.entries(definition.roles))for(const skillId of ids){
    if(bySkill.has(skillId))throw Error(`VFX_DUPLICATE_ROLE:${module}:${skillId}`);
    bySkill.set(skillId,role);
    const set=routes.get(skillId)||new Set();set.add(module);routes.set(skillId,set);
  }
  roleIndex.set(module,bySkill);
}
export const VfxDatabase=Object.freeze({
  definitions:defs,
  modules:()=>Object.keys(defs),
  roleFor:(module,skillId)=>roleIndex.get(module)?.get(skillId)||null,
  skillIds:module=>[...(roleIndex.get(module)?.keys()||[])],
  skillId:(module,role)=>defs[module]?.roles?.[role]?.[0]||null,
  statusId:(module,key)=>defs[module]?.status?.[key]||null,
  eventType:(module,index=0)=>defs[module]?.events?.[index]||null,
  specializedProjectileIds:()=>Object.entries(defs).flatMap(([,d])=>d.specializedProjectile?
    Object.values(d.roles).flat():[]),
  // One event can intentionally serve BOTH a generic arrow and the nature wind trail.
  routeSkill:skillId=>[...(routes.get(skillId)||[])],
  hasEvent:(module,type)=>defs[module]?.events?.includes(type)===true,
  legacyDiagnostics:()=>Object.fromEntries(Object.entries(defs).map(([k,d])=>[k,d.legacy])),
});
