/**
 * Native post-engagement environmental callback used by both normal attacks
 * and blood-shadow attacks. The actual knockback/pull/fall damage is already
 * calculated by the ORIGINAL PostEngagementEngine. This callback only sends
 * the resulting collision and landing events through BattleEnvironmentController.
 * No new rules, values, random rolls, or PvP-only combat state live here.
 */
export function applyCanonicalPostEngagementEffect(entry,environment,callbacks){
  const {source,target,effect,result}=entry||{};
  if(!result?.applied)return false;
  if(!source?.character||!target?.character||
     typeof environment?.resolveCollisionRuntime!=='function'||
     typeof environment?.enterTile!=='function'||
     typeof callbacks?.pushLog!=='function')
    throw new TypeError('CANONICAL_POST_ENGAGEMENT_HOOK_REQUIRED');
  const moved=result.steps?.length||0;
  if(moved>0)globalThis.EffectEngine?.interruptChannel?.(target,'FORCED_MOVE');
  const visit=(movement,mover)=>{
    for(const collision of movement?.collisions||[]){
      environment.resolveCollisionRuntime(collision,{mover,source});
      if(collision.chain&&collision.surface?.unit)
        visit(collision.chain,collision.surface.unit);
    }
  };
  visit(result,target);
  callbacks.pushLog(`${source.character.name} → ${target.character.name}：${effect?.type==='PULL'?'拉近':'擊退'} ${moved} 格。`,'BATTLE');
  if(result.falls?.length){
    const drops=result.falls.map(f=>`Z${f.from}→H${f.to}`).join('、');
    callbacks.pushLog(`${target.character.name} 墜落 ${drops}｜墜落傷害 ${result.fallDamage}｜HP ${target.hp}。`,'BATTLE');
  }else callbacks.pushLog(`${target.character.name} 強制位移完成｜無墜落傷害。`,'DETAIL');
  // Mirrors tactical-game.logPostEffect: the landing can itself trigger fire,
  // traps, drowning, current, stage events or defeat, exactly once.
  if(target.alive)environment.enterTile(target);
  return true;
}
