import {attackWeaponFor} from './equipment-database.js';
/** Single authoritative attack-contact / defender-reaction eligibility policy. */
export const CombatContactRules=Object.freeze({
  attackType(actor,skill){
    const weapon=attackWeaponFor(actor,skill);
    return skill?.attackType==='INHERIT'?weapon?.attackType:skill?.attackType;
  },
  isPureMagic(actor,skill){return this.attackType(actor,skill)==='MAGIC' && Number(skill?.power||0)>0;},
  canActiveEvade(actor,skill){return true;},
  canGanfanDefend(attacker,defender,incoming){
    if(defender?.character?.id!=='livia'||!defender.alive||!attacker?.alive||!incoming)return false;
    const type=this.attackType(attacker,incoming);
    const d=Math.abs(attacker.x-defender.x)+Math.abs(attacker.y-defender.y);
    if(d!==1||incoming.pureHoly===true||!['SLASH','PIERCE','STRIKE'].includes(type))return false;
    if(incoming.attackClass==='RANGED'||incoming.trajectory==='ARC')return false;
    const weapon=attackWeaponFor(attacker,incoming);
    return !weapon||!['BOW','STAFF'].includes(weapon.weaponKind);
  }
});
globalThis.CombatContactRules=CombatContactRules;
