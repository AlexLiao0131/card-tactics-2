import {EquipmentDatabase, WEAPON_DEFENSE_BASELINES} from './equipment-database.js';

// Battle-authoritative, read-only weapon material confrontation rules.
// Only explicitly tagged contact materials participate: missing materialId is UNKNOWN,
// never silently treated as ordinary metal. All percentages derive from the existing
// SWORD defense baseline and the star-iron weapon's already published override.
export const WEAPON_MATERIALS=Object.freeze({
  COMMON_METAL:Object.freeze({id:'COMMON_METAL',name:'一般金屬'}),
  STAR_IRON:Object.freeze({id:'STAR_IRON',name:'星鐵'})
});

const PHYSICAL_MELEE_TYPES=new Set(['SLASH','PIERCE','STRIKE']);
const CONTACT_DEFENSE_METHODS=new Set(['PARRY','DEFLECT']);
const clampChance=value=>Math.min(100,Math.max(0,Number(value)));
const distance=(a,b)=>Math.abs(Number(a.x)-Number(b.x))+Math.abs(Number(a.y)-Number(b.y));

export const WeaponMaterialEngine=Object.freeze({
  // Caller retains responsibility for validating the defense method and target.
  defenseMatchup({attacker,defender,skill,method,attackType}={}){
    const incomingType=attackType==='INHERIT'?
      attacker?.character?.weapons?.[skill?.weapon]?.attackType:attackType;
    const rule=method?.vs?.[incomingType];
    const basicChance=rule?.chance;
    if(!rule||!Number.isFinite(Number(basicChance)))
      return{chance:basicChance??null,pressure:0,materialAdvantage:false};
    const weapon=attacker?.character?.weapons?.[skill?.weapon];
    if(weapon?.materialId!=='STAR_IRON'||skill?.pureHoly||skill?.attackClass==='RANGED'||
       !PHYSICAL_MELEE_TYPES.has(incomingType)||!CONTACT_DEFENSE_METHODS.has(method.method)||
       method?.artifact===true||distance(attacker,defender)!==1)
      return{chance:clampChance(basicChance),pressure:0,materialAdvantage:false};
    const defenderItem=EquipmentDatabase.equippedItems(defender?.character)
      .find(item=>item.id===method.sourceId && item.kind==='WEAPON');
    if(defenderItem?.materialId!=='COMMON_METAL')
      return{chance:clampChance(basicChance),pressure:0,materialAdvantage:false};
    const materialWeaponProfile=EquipmentDatabase.defenseProfiles({weapons:{source:weapon}})
      .find(profile=>profile.sourceId===weapon.id && profile.method==='PARRY');
    const ownChance=materialWeaponProfile?.vs?.[incomingType]?.chance;
    const commonChance=WEAPON_DEFENSE_BASELINES.SWORD.vs?.[incomingType]?.chance;
    // Existing star-iron defensive improvement is the magnitude of its ability
    // to destabilize an ordinary metal weapon on physical contact. No new
    // coefficient or armor penetration is invented here.
    const pressure=Number.isFinite(ownChance)&&Number.isFinite(commonChance)
      ?Math.max(0,Number(ownChance)-Number(commonChance)):0;
    return{chance:clampChance(Number(basicChance)-pressure),pressure,
      materialAdvantage:pressure>0};
  }
});
