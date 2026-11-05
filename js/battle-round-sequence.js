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
