/**
 * The original tactical-game.js engagementForecast presentation model,
 * using TacticalEngine/BattleResolution exact official formulas.
 * No RNG, HP, action flags or combat authority is changed by a preview.
 */
import {TacticalEngine} from './tactical-engine.js';
import {BattleResolution} from './battle-resolution.js';
import {SkillDatabase} from './skill-database.js';
import {WeaponMaterialEngine} from './weapon-material-engine.js';
import {CombatContactRules} from './combat-contact-rules.js';

export function officialEngagementForecast({map,attacker,defender,skill,
  unitRuntime=globalThis.UnitRuntimeEngine,
  resolution=globalThis.BattleResolution}={}){
  if(!map||!attacker?.alive||!defender?.alive||
    !attacker.character||!defender.character||!skill)return null;
  // Identical effectiveSkill passive logic as the local engagement preview.
  let effective=unitRuntime?.applyResourceScaling?.(attacker,skill)||skill;
  const passives=SkillDatabase.passiveList(attacker.character?.passives);
  const tile=TacticalEngine.tile(map,attacker.x,attacker.y);
  const weapon=attacker.character.weapons?.[skill.weapon];
  const ambush=passives.find(p=>p.id==='AMBUSH');
  if(ambush&&tile?.terrain===ambush.terrain&&weapon?.weaponKind===ambush.weaponKind){
    effective={...effective,power:Number(effective.power||0)*Number(ambush.powerMultiplier||1),
      speed:Number(effective.speed||0)+Number(ambush.speedBonus||0),
      modifiers:{...(effective.modifiers||{})},ambushActive:true};
  }
  const estimate=options=>{
    const a={...attacker},d={...defender};
    TacticalEngine.faceToward(a,d);
    return TacticalEngine.resolve(map,a,d,effective,options).result;
  };
  const normal=estimate({forceHit:true,disableCrit:true});
  const critical=estimate({forceHit:true,forceCrit:true});
  const hp=Math.max(0,Number(defender.hp||0));
  const maxHp=Math.max(1,Number(defender.character.combat?.hp||hp||1));
  const pct=n=>Math.max(0,Math.min(100,Math.round(n)));
  const guaranteed=normal.guaranteedHit===true||CombatContactRules.isPureMagic(attacker,effective);
  const hit=guaranteed?100:pct(normal.hc),crit=pct(normal.cc);
  const type=normal.type;
  const extraNormal=resolution.previewEnchantmentBonus(attacker,defender,effective)+
    resolution.previewInherentBonus(attacker,defender,effective);
  const extraCrit=resolution.previewEnchantmentBonus(attacker,defender,effective,{critical:true})+
    resolution.previewInherentBonus(attacker,defender,effective,{critical:true});
  const baseDamage=Math.max(0,Number(normal.damage||0)+extraNormal);
  const physicalCriticalDamage=Math.max(0,Number(critical.damage||0)+extraNormal);
  const magicCriticalDamage=Math.max(0,Number(normal.damage||0)+extraCrit);
  const critDamage=Math.max(0,Number(critical.damage||0)+extraCrit);
  const methodOptions=resolution.defenseMethods(defender).map(method=>{
    const rule=method.vs?.[type];
    if(!rule)return{id:method.id,label:method.name,valid:false};
    const blocked=method.method==='GUARD'&&effective?.weapon&&
      attacker.character.weapons?.[effective.weapon]?.affixes?.includes('PHYSICAL_DEFENSE_IGNORE')&&
      method.artifact!==true;
    if(blocked)return{id:method.id,label:method.name,valid:false,bypassed:true};
    const material=WeaponMaterialEngine.defenseMatchup({attacker,defender,skill:effective,method,attackType:type});
    const successRate=material.chance===null?100:pct(material.chance);
    const reduction=method.method==='PARRY'?0:
      Number.isFinite(Number(rule.damageMultiplier))?Number(rule.damageMultiplier):1;
    const guardMultiplier=method.method==='GUARD'?
      Number(defender.character.modifiers?.guardMultiplier??1):1;
    const holyInherent=attacker.character.weapons?.[effective.weapon]?.inherentMagic?.unblockable===true;
    const unblockedExtra=holyInherent?resolution.previewInherentBonus(attacker,defender,effective):0;
    const reducedBase=baseDamage-unblockedExtra;
    // Material-based STRIKE deflection redirects physical force only; it does
    // not reduce the independent enchantment or inherent magic component.
    const damageIfBlocked=method.physicalOnly===true?
      Math.max(0,Math.round(Number(normal.damage||0)*(effective?.pureHoly?1:reduction))+extraNormal):
      Math.max(0,Math.round(reducedBase*(effective?.pureHoly?1:reduction*guardMultiplier)+unblockedExtra));
    return{id:method.id,label:method.name,valid:true,successRate,damageIfBlocked,
      materialPressure:material.pressure,materialAdvantage:material.materialAdvantage,
      damageIfFailed:baseDamage,hpAfterBlocked:Math.max(0,hp-damageIfBlocked)};
  });
  const evadeFull=guaranteed?100:pct(Math.max(0,normal.hc-20));
  const evadeGraze=guaranteed?0:pct(Math.max(0,normal.hc)-evadeFull);
  const evadeMiss=guaranteed?0:pct(100-evadeFull-evadeGraze);
  return{attackerId:attacker.id,defenderId:defender.id,hp,maxHp,hit,crit,
    normalDamage:baseDamage,physicalCriticalDamage,magicCriticalDamage,
    criticalDamage:critDamage,hpAfterNormal:Math.max(0,hp-baseDamage),
    hpAfterCritical:Math.max(0,hp-critDamage),attackType:type,guaranteed,
    evade:{full:evadeFull,graze:evadeGraze,miss:evadeMiss,
      grazeDamage:Math.round(Number(normal.damage||0)*.5)+
        resolution.previewEnchantmentBonus(attacker,defender,effective,{grazeMultiplier:.5})+
        resolution.previewInherentBonus(attacker,defender,effective,{grazeMultiplier:.5})},
    defenseMethods:methodOptions,
    note:'主攻一次命中；物理／附魔各自爆擊。正常／物理爆擊／附魔爆擊／雙爆預測由正式公式計算；護盾、後續連鎖依實際結算。'};
}
