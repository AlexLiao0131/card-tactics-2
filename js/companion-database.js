export const COMPANIONS={
  ophi_eagle:{
    id:"ophi_eagle",
    name:"奧菲的老鷹",
    ownerCharacterId:"ophi",
    kind:"SCOUT",
    movement:"FLYING",
    occupiesCardSlot:false,
    canAttack:false,
    sharedVision:true,
    providesTargetingFor:["ophi_eagle_arc_shot"]
  }
};

export const CompanionDatabase=(()=>{
  function get(id){return COMPANIONS[id]||null}
  function list(ids=[]){return(ids||[]).map(get).filter(Boolean)}
  function forOwner(characterId){return Object.values(COMPANIONS).filter(c=>c.ownerCharacterId===characterId)}
  return Object.freeze({get,list,forOwner});
})();

globalThis.COMPANIONS=COMPANIONS;
globalThis.CompanionDatabase=CompanionDatabase;
