/**
 * Shared canonical START-OF-PLAYER-ROUND sequence for native/Gemini and PvP.
 * No state, damage formulas, numerical parameters, or browser UI live here.
 * The official engines supplied by each mode remain the sole owners of
 * environment, statuses, stage events, perception and card resources.
 */
export function beginPlayerRoundSequence(steps){
  const required=['endEnemyPerception','checkMatchEnd','advanceRound','expireSmoke',
    'resetActions','clearInput','logRoundStart','environmentAvailable',
    'applyEnvironmentHazards','tickEffects','tickSanctuaries','stageRoundStart',
    'tickEnvironment','resolveWeatherEvents','beginPlayerPerception','beginCardPhase'];
  for(const key of required)if(typeof steps?.[key]!=='function')
    throw Error(`CANONICAL_ROUND_STEP_REQUIRED:${key}`);
  const ended=()=>steps.checkMatchEnd()===true;
  steps.endEnemyPerception();
  if(ended())return false;
  steps.advanceRound();
  steps.expireSmoke();
  steps.resetActions();
  steps.clearInput();
  steps.logRoundStart();
  // The existing game's water/fire contact happens BEFORE duration/DOT ticks.
  if(steps.environmentAvailable()){
    steps.applyEnvironmentHazards();
    if(ended())return false;
  }
  steps.tickEffects();
  if(ended())return false;
  steps.tickSanctuaries();
  if(ended())return false;
  steps.stageRoundStart();
  if(steps.environmentAvailable()){
    steps.tickEnvironment();
    steps.resolveWeatherEvents();
    if(ended())return false;
  }
  steps.beginPlayerPerception();
  steps.beginCardPhase();
  return true;
}

/**
 * Complete fatal status ticks through the SAME death lifecycle used by attacks.
 * EffectEngine owns HP and DOT; round sequencing owns the transition from
 * zero HP to one death notification. Never grant a second DOT damage instance.
 * Used by both browser BattleTest/normal/Gemini and authoritative PvP.
 */
export function tickRoundStatusEffects({units,effectEngine,onDefeated,pushLog}){
  if(typeof effectEngine?.tick!=='function')return [];
  const roster=units||[],deaths=[];
  for(const unit of roster.filter(unit=>unit?.alive)){
    const pending=(unit.effects||[]).filter(e=>e.type==='DAMAGE_OVER_TIME');
    const events=effectEngine.tick(unit,{units:roster})||[];
    for(const event of events){if(event.type!=='DAMAGE_OVER_TIME')continue;
      const status=pending.find(e=>e.id===event.effectId);
      pushLog?.(`${unit.character?.name||unit.id}｜${status?.name||event.effectId||'持續傷害'}｜DOT ${Number(event.amount||0)} HP${status?.remaining!=null?`｜剩 ${Math.max(0,status.remaining)} 回合`:''}`,'BATTLE',{units:[unit]});
    }
    if(unit.alive||Number(unit.hp)>0)continue;
    // The effect may expire inside tick(), so retain the original source ID.
    const lethal=[...events].reverse().find(e=>e.type==='DAMAGE_OVER_TIME'&&Number(e.amount)>0);
    const cause=pending.find(e=>e.id===lethal?.effectId)||null;
    const source=cause?.sourceUnitId?roster.find(u=>u.id===cause.sourceUnitId)||null:null;
    if(typeof onDefeated==='function')onDefeated(unit,source,cause||{type:'DAMAGE_OVER_TIME',id:lethal?.effectId||null});
    deaths.push(unit.id);
  }
  return deaths;
}
