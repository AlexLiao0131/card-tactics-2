export const COMPANIONS={
  ophi_eagle:{
    id:"ophi_eagle",
    name:"奧菲的老鷹",
    ownerCharacterId:"ophi",
    characterId:"ophi_eagle",
    deploymentCardId:"ophi_eagle_card",
    kind:"SCOUT",
    movement:"FLYING",
    occupiesCardSlot:false,
    occupiesTile:true,
    participatesInTurn:true,
    readyOnDeploy:true,
    canAttack:false,
    canCapture:false,
    countsForObjectives:false,
    sharedVision:true,
    targetingMode:"SCOUT_SHARED_VISION",
    requiresOwnerCompanionRule:"sharedVision",
    providesTargetingFor:[]
  }
};

export const CompanionDatabase=(()=>{
  function get(id){return COMPANIONS[id]||null}
  function list(ids=[]){return(ids||[]).map(get).filter(Boolean)}
  function forOwner(characterId){return Object.values(COMPANIONS).filter(c=>c.ownerCharacterId===characterId)}
  function deploymentCardsForOwner(characterId){return forOwner(characterId).map(c=>c.deploymentCardId).filter(Boolean)}
  function ownerHasCompanionRule(owner,rule){
    if(!rule)return true;
    const character=owner?.character||owner;
    return SkillDatabase.passiveList(character?.passives||[]).some(passive=>passive?.companionRules?.[rule]===true);
  }
  function companionForUnit(unit){
    const id=unit?.companionId||unit?.character?.companionId;
    if(id&&COMPANIONS[id])return COMPANIONS[id];
    const characterId=unit?.character?.id;
    return Object.values(COMPANIONS).find(c=>c.characterId===characterId)||null;
  }
  function bindUnit(unit,units=[]){
    if(!unit?.alive)return null;
    const companion=companionForUnit(unit);if(!companion)return null;
    const owner=(units||[]).find(candidate=>
      candidate?.alive&&candidate.team===unit.team&&candidate.character?.id===companion.ownerCharacterId
    )||null;
    unit.unitRole="COMPANION";
    unit.companionId=companion.id;
    unit.participatesInTurn=companion.participatesInTurn!==false;
    unit.occupiesTile=companion.occupiesTile!==false;
    unit.countsForObjectives=companion.countsForObjectives===true;
    unit.canCapture=companion.canCapture===true;
    unit.canAttack=companion.canAttack===true;
    const tile=unit?._runtimeMap?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y)||null;
    if(tile&&globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(unit,tile);
    if(!owner){unit.ownerUnitId=null;return null;}
    owner.companionRuntime??={};
    const firstBinding=owner.companionRuntime[companion.id]!==unit;
    owner.companionRuntime[companion.id]=unit;
    unit.ownerUnitId=owner.id;
    if(firstBinding&&companion.readyOnDeploy===true){unit.moved=false;unit.acted=false;unit.waited=false;}
    return owner;
  }
  function reconcileUnits(units=[]){
    const roster=units||[];
    for(const owner of roster){
      if(!owner?.companionRuntime)continue;
      for(const[id,unit]of Object.entries(owner.companionRuntime)){
        if(!unit?.alive||!roster.includes(unit))delete owner.companionRuntime[id];
      }
    }
    const bound=[];
    for(const unit of roster){const owner=bindUnit(unit,roster);if(owner)bound.push({owner,unit});}
    return bound;
  }
  function targetingUnit(owner,skillId,companionId=null){
    const character=owner?.character||owner;if(!character)return null;
    for(const companion of list(character.companionIds||[])){
      if(companionId&&companion.id!==companionId)continue;
      if(companion.sharedVision!==true||!(companion.providesTargetingFor||[]).includes(skillId))continue;
      if(!ownerHasCompanionRule(owner,companion.requiresOwnerCompanionRule))continue;
      const runtime=owner?.companionRuntime?.[companion.id];
      if(runtime?.alive)return runtime;
    }
    return null;
  }
  function providesTargeting(owner,skillId,companionId=null){return !!targetingUnit(owner,skillId,companionId)}
  return Object.freeze({get,list,forOwner,deploymentCardsForOwner,ownerHasCompanionRule,companionForUnit,bindUnit,reconcileUnits,targetingUnit,providesTargeting});
})();

globalThis.COMPANIONS=COMPANIONS;
globalThis.CompanionDatabase=CompanionDatabase;
