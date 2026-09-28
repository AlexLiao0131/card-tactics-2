export const StatFormulaEngine=(()=>{
  const DERIVED_KEYS=Object.freeze(["hp","atk","matk","def","mdef"]);
  const BASE_FORMULA=Object.freeze({
    hp:Object.freeze({base:50,attribute:"vit",perPoint:8}),
    atk:Object.freeze({base:34,attribute:"str",perPoint:3}),
    matk:Object.freeze({base:10,attribute:"int",perPoint:4}),
    def:Object.freeze({base:15,attribute:"vit",perPoint:2}),
    mdef:Object.freeze({base:10,attribute:"wil",perPoint:4})
  });
  const clone=v=>JSON.parse(JSON.stringify(v??{}));
  const n=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
  const round=v=>Math.max(0,Math.round(Number(v||0)));

  function formulaStats(attributes={}){
    const out={};
    for(const key of DERIVED_KEYS){
      const rule=BASE_FORMULA[key];
      out[key]=round(rule.base+n(attributes?.[rule.attribute])*rule.perPoint);
    }
    return out;
  }

  function equippedItems(character={}){
    return [
      ...Object.values(character.weapons||{}),
      character.armor,
      ...(character.equipment||[]),
      character.guard
    ].filter(Boolean);
  }

  function addMods(target,mods={}){
    for(const key of [...DERIVED_KEYS,"move"]){
      if(mods?.[key]!=null)target[key]=n(target[key])+n(mods[key]);
    }
    return target;
  }

  function fixedCombatModifiers(character={}){
    const out={hp:0,atk:0,matk:0,def:0,mdef:0,move:0};
    addMods(out,character.statModifiers||character.combatModifiers||{});
    for(const item of equippedItems(character))addMods(out,item.combatModifiers||item.statModifiers||{});
    return out;
  }

  function nativeFormulaCombat(character={},attributes=character.attributes||{}){
    const out={...formulaStats(attributes),move:n(character?.combat?.move,4)};
    return addMods(out,fixedCombatModifiers(character));
  }

  function createProfile(character={}){
    const attributes=clone(character.attributes||{}),combat=clone(character.combat||{});
    const mode=String(character.statModel||"MIGRATED").toUpperCase()==="FORMULA"?"FORMULA":"MIGRATED";
    const native=nativeFormulaCombat(character,attributes);
    const legacyOffset={hp:0,atk:0,matk:0,def:0,mdef:0,move:0};
    if(mode==="MIGRATED"){
      for(const key of DERIVED_KEYS){
        if(combat[key]!=null)legacyOffset[key]=n(combat[key])-n(native[key]);
      }
      if(combat.move!=null)legacyOffset.move=n(combat.move)-n(native.move);
    }
    return Object.freeze({
      mode,
      baseAttributes:Object.freeze(clone(attributes)),
      sourceCombat:Object.freeze(clone(combat)),
      legacyOffset:Object.freeze({...legacyOffset})
    });
  }

  function derive(character={},attributes=character.attributes||{},profile=character.statProfile||createProfile(character)){
    const out=nativeFormulaCombat(character,attributes);
    if(profile?.mode==="MIGRATED")addMods(out,profile.legacyOffset||{});
    out.move=Math.max(0,n(out.move,4));
    for(const key of DERIVED_KEYS)out[key]=Math.max(1,round(out[key]));
    return out;
  }

  function initializeCharacter(character={}){
    if(!character.statProfile)character.statProfile=createProfile(character);
    character.combat=derive(character,character.attributes||{},character.statProfile);
    return character;
  }

  function recomputeCharacter(character={}){
    if(!character.statProfile)initializeCharacter(character);
    else character.combat=derive(character,character.attributes||{},character.statProfile);
    return character.combat;
  }

  function explain(character={}){
    const profile=character.statProfile||createProfile(character);
    return Object.freeze({
      mode:profile.mode,
      attributes:clone(character.attributes||{}),
      formula:formulaStats(character.attributes||{}),
      fixedModifiers:fixedCombatModifiers(character),
      legacyOffset:clone(profile.legacyOffset||{}),
      combat:derive(character,character.attributes||{},profile)
    });
  }

  return Object.freeze({DERIVED_KEYS,BASE_FORMULA,formulaStats,fixedCombatModifiers,createProfile,derive,initializeCharacter,recomputeCharacter,explain});
})();
globalThis.StatFormulaEngine=StatFormulaEngine;
