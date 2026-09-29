export const REWARD_RULES=Object.freeze({
  defaultKillGold:10,
  killGoldByRole:Object.freeze({UNIT:10,HERO:25,COMPANION:0,MONSTER:15,BOSS:60})
});

export const RewardDatabase=(()=>{
  function roleFor(unit){
    if(unit?.character?.rewardProfile)return String(unit.character.rewardProfile).toUpperCase();
    if(unit?.character?.boss===true||unit?.unitRole==="BOSS")return"BOSS";
    if(unit?.monsterId)return"MONSTER";
    const card=globalThis.CardDatabase?.get?.(unit?.cardId);
    if(card?.unitType==="HERO")return"HERO";
    if(unit?.unitRole==="COMPANION")return"COMPANION";
    return"UNIT";
  }
  function killGold(unit){
    const explicit=Number(unit?.character?.rewards?.gold);
    if(Number.isFinite(explicit))return Math.max(0,Math.round(explicit));
    const role=roleFor(unit),value=Number(REWARD_RULES.killGoldByRole[role]);
    return Math.max(0,Math.round(Number.isFinite(value)?value:REWARD_RULES.defaultKillGold));
  }
  return Object.freeze({roleFor,killGold});
})();

globalThis.REWARD_RULES=REWARD_RULES;
globalThis.RewardDatabase=RewardDatabase;
