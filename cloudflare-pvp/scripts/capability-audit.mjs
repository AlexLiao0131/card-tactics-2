/** Inspect existing gameplay data against the *canonical* execution contracts.
 * This report is informational: unknown mechanics stay disabled instead of
 * silently falling through to incomplete PvP resolution. No IDs or stat values
 * are duplicated in this script.
 * Usage: node cloudflare-pvp/scripts/capability-audit.mjs
 */
import {CARDS} from '../../js/card-database.js';
import {SKILLS} from '../../js/skill-database.js';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';
import {isCanonicalDirectEffectSkill} from '../src/pvp-headless-effect-skills.mjs';

const result={
  status:'EXPERIMENTAL_CAPABILITY_CLASSIFICATION_NOT_GAMEPLAY_CERTIFICATION',
  spells:{instant:[],targeted:[],requiresOrchestration:[]},
  skills:{directAttack:[],directEffect:[],requiresOrchestration:[]}
};
for(const card of Object.values(CARDS)){
  if(card.type!=='SPELL')continue;
  const kind=globalThis.CardPhaseController.commandKind(card);
  const item={id:card.id,effectType:card.effect?.type||null};
  if(kind==='INSTANT')result.spells.instant.push(item);
  else if(kind==='TARGETED')result.spells.targeted.push(item);
  else result.spells.requiresOrchestration.push(item);
}
for(const skill of Object.values(SKILLS)){
  const item={id:skill.id,category:skill.category||null};
  if(isCanonicalDirectAttackSkill(skill))result.skills.directAttack.push(item);
  else if(isCanonicalDirectEffectSkill(skill))result.skills.directEffect.push(item);
  else result.skills.requiresOrchestration.push(item);
}
result.counts={spells:Object.fromEntries(Object.entries(result.spells).map(([k,v])=>[k,v.length])),
  skills:Object.fromEntries(Object.entries(result.skills).map(([k,v])=>[k,v.length]))};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
