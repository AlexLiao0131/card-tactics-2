export const UnitRuntimeEngine=(()=>{
  const MANA_BASE=40,MANA_INT_FACTOR=2,MANA_WIL_FACTOR=2;
  const liveUnits=new Map();
  function maxManaFromAttributes(attributes={}){
    return Math.max(0,Math.round(MANA_BASE+Number(attributes.int||0)*MANA_INT_FACTOR+Number(attributes.wil||0)*MANA_WIL_FACTOR));
  }
  function maxMana(unit){return unit?.character?.resourceRules?.mana===false?0:maxManaFromAttributes(unit?.character?.attributes||{})}
  function syncMana(unit,{initialize=false}={}){
    if(!unit)return{mana:0,maxMana:0};
    const nextMax=maxMana(unit);
    if(initialize||!Number.isFinite(Number(unit.mana)))unit.mana=nextMax;
    else unit.mana=Math.min(Math.max(0,Number(unit.mana||0)),nextMax);
    unit.maxMana=nextMax;
    return{mana:unit.mana,maxMana:unit.maxMana};
  }
  function restoreMana(unit,amount){
    syncMana(unit);
    const before=unit.mana;
    unit.mana=Math.min(unit.maxMana,before+Math.max(0,Math.round(Number(amount||0))));
    return unit.mana-before;
  }
  function manaCost(skill){return Math.max(0,Math.round(Number(skill?.manaCost||0)))}
  function createSkillResources(){return{}}
  function createFromResolvedCharacter({id,team,character,x,y,map}){
    if(!character)return null;
    const runtimeCharacter=JSON.parse(JSON.stringify(character));
    const unit={id,team,character:runtimeCharacter,x,y,z:Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0),
      hp:runtimeCharacter.combat.hp,alive:true,moved:false,acted:false,waited:false,
      unitRole:runtimeCharacter.unitRole||"UNIT",
      participatesInTurn:runtimeCharacter.participatesInTurn!==false,
      occupiesTile:runtimeCharacter.occupiesTile!==false,
      canAttack:runtimeCharacter.canAttack!==false,
      canCapture:runtimeCharacter.canCapture!==false,
      countsForObjectives:runtimeCharacter.countsForObjectives!==false,
      companionId:runtimeCharacter.companionId||null,
      ownerCharacterId:runtimeCharacter.ownerCharacterId||null,
      skillResources:createSkillResources(),effects:[],grantedSkills:[],_runtimeMap:map};
    for(const passive of SkillDatabase.passiveList(runtimeCharacter?.passives||[])){
      for(const effect of passive.openingEffects||[])unit.effects.push(JSON.parse(JSON.stringify(effect)));
    }
    globalThis.VerticalMobilityEngine?.initialize?.(unit,map);
    syncMana(unit,{initialize:true});
    TacticalEngine.ensureFacing(unit);
    liveUnits.set(unit.id,unit);
    return unit;
  }
  function resolveCharacter(characterId,loadoutId=null){
    return LoadoutDatabase.resolveCharacter(characterId,loadoutId);
  }
  function create({id,team,characterId,loadoutId=null,x,y,map}){
    const character=resolveCharacter(characterId,loadoutId);
    if(!character)return null;
    return createFromResolvedCharacter({id,team,character,x,y,map});
  }
  function createFromCard({id,team,card,x,y,map}){
    if(!CardDatabase.isCharacter(card))return null;
    return create({id,team,characterId:card.characterId,loadoutId:card.loadoutId,x,y,map});
  }
  function reconcileCompanions(units){
    if(!globalThis.CompanionDatabase?.reconcileUnits)return[];
    return CompanionDatabase.reconcileUnits(units||[]);
  }
  function living(units,team){reconcileCompanions(units);return (units||[]).filter(u=>u.alive&&u.team===team)}
  function turnActors(units,team){return living(units,team).filter(u=>u.participatesInTurn!==false)}
  function resetActions(units,team){reconcileCompanions(units);turnActors(units,team).forEach(u=>{u.moved=false;u.acted=false;u.waited=false;syncMana(u);})}
  function allFinished(units,team){reconcileCompanions(units);const actors=turnActors(units,team);return actors.length>0&&actors.every(u=>u.acted)}
  function resourceFor(unit,skill){return{type:"MANA",cost:manaCost(skill),remaining:Math.max(0,Number(unit?.mana||0))}}
  function canUseSkill(unit,skill){
    if(skill?.approach&&unit?.moved)return false;
    const req=skill?.requirements||{};
    if(req.carrying===true&&!unit?.carryingUnitId)return false;
    if(req.notCarrying===true&&!!unit?.carryingUnitId)return false;
    if(req.notMoved===true&&!!unit?.moved)return false;
    if(req.water===true){const tile=globalThis.CardTacticsRuntime?.getBattleMap?.()?.tiles?.find(t=>t.x===unit?.x&&t.y===unit?.y);if(!tile||Number(globalThis.HydrologyEngine?.waterDepth?.(tile)||0)<=0)return false;}
    syncMana(unit);return unit.mana>=manaCost(skill);
  }
  function consumeSkill(unit,skill){if(!canUseSkill(unit,skill))return null;const cost=manaCost(skill);unit.mana=Math.max(0,unit.mana-cost);return{type:"MANA",cost,remaining:unit.mana}}
  function resourceLabel(unit,skill){syncMana(unit);const cost=manaCost(skill);return cost>0?`MP ${cost}`:"無消耗"}
  function targetType(skill){return skill?.targetType||"SINGLE"}
  function getLiveUnit(id){return liveUnits.get(id)||null}
  function rotateFacing(id,steps=1){const unit=getLiveUnit(id);if(!unit?.alive)return null;return TacticalEngine.rotateFacing(unit,steps)}
  function setFacing(id,facing){const unit=getLiveUnit(id);if(!unit?.alive)return null;return TacticalEngine.setFacing(unit,facing)}
  return Object.freeze({MANA_BASE,MANA_INT_FACTOR,MANA_WIL_FACTOR,maxManaFromAttributes,maxMana,syncMana,restoreMana,manaCost,createSkillResources,resolveCharacter,create,createFromCard,reconcileCompanions,living,turnActors,resetActions,allFinished,resourceFor,canUseSkill,consumeSkill,resourceLabel,targetType,getLiveUnit,rotateFacing,setFacing});
})();
globalThis.UnitRuntimeEngine=UnitRuntimeEngine;
