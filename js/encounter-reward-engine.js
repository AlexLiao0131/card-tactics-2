export const EncounterRewardEngine=(()=>{
  function roll(reward,rng=Math.random){const chance=Math.max(0,Math.min(1,Number(reward?.chance??1)));return chance>=1||rng()<chance;}
  function resolveCardStateForSource(source,playerCardState,enemyCardState){if(source?.team==="E")return enemyCardState?.()||window.CardTacticsRuntime?.getEnemyCardState?.()||null;if(source?.team==="P")return playerCardState?.()||window.CardTacticsRuntime?.getCardState?.()||null;return null;}
  function grantCardToState(state,cardId,count=1,pushLog){const card=CardDatabase.get(cardId);if(!state?.zones?.hand||!card||!CardDatabase.isBattleOnly(card))return 0;const n=Math.max(0,Math.floor(Number(count||0)));for(let i=0;i<n;i++)state.zones.hand.push(card.id);if(n)pushLog?.(`遭遇獎勵｜獲得「${card.name}」×${n}（僅限本場戰鬥）。`,"SYSTEM");return n;}
  function resolveDefeat(unit,source,cause,{playerCardState,enemyCardState,pushLog,rng=Math.random}={}){if(!unit||unit._encounterRewardResolved)return[];const monster=MonsterDatabase.forCharacter(unit?.character?.id);if(!monster)return[];unit._encounterRewardResolved=true;const state=resolveCardStateForSource(source,playerCardState,enemyCardState);if(!state){pushLog?.(`${unit.character.name} 已被擊敗，但擊殺來源不是 PLAYER／ENEMY，遭遇卡不會錯發給任何一方。`,"DETAIL");return[];}const granted=[];for(const reward of monster.encounterRewards){if(reward.type!=="BATTLE_CARD"||!roll(reward,rng))continue;const count=Math.max(1,Math.floor(Number(reward.count||1))),amount=grantCardToState(state,reward.cardId,count,pushLog);if(amount)granted.push({type:reward.type,cardId:reward.cardId,count:amount,monsterId:monster.id,sourceTeam:source?.team||null});}return granted;}

  function dominionRules(source){
    const passives=globalThis.SkillDatabase?.passiveList?.(source?.character?.passives)||[];
    return passives.map(passive=>({passive,rule:passive?.encounterDominion})).filter(entry=>entry.rule);
  }
  function matchesDominion(rule,target,monster){
    const fromTeams=Array.isArray(rule?.fromTeams)&&rule.fromTeams.length?rule.fromTeams:["N"];
    if(!fromTeams.includes(target?.team))return false;
    const ids=Array.isArray(rule?.monsterIds)?rule.monsterIds:[];
    const families=Array.isArray(rule?.families)?rule.families:[];
    if(ids.length&&!ids.includes(monster?.id))return false;
    if(families.length&&!families.includes(monster?.family))return false;
    return ids.length>0||families.length>0;
  }
  function resolveDominion(source,units,{playerCardState,enemyCardState,pushLog,rng=Math.random}={}){
    if(!source?.alive)return[];
    const state=resolveCardStateForSource(source,playerCardState,enemyCardState),results=[];
    for(const {passive,rule} of dominionRules(source)){
      for(const target of units||[]){
        if(!target?.alive||target.id===source.id||target._encounterDominionResolvedBy)continue;
        const monster=MonsterDatabase.get(target.monsterId)||MonsterDatabase.forCharacter(target?.character?.id);
        if(!monster||!matchesDominion(rule,target,monster))continue;
        const previousTeam=target.team;
        target.team=source.team;
        target.faction=source.character?.faction||source.faction||target.faction;
        target.controlledBy=source.id;
        target.encounterAI="CONTROLLED";
        target._encounterDominionResolvedBy=source.id;
        const granted=[];
        if(rule.grantEncounterRewards!==false&&state){
          for(const reward of monster.encounterRewards||[]){
            if(reward.type!=="BATTLE_CARD"||!roll(reward,rng))continue;
            const count=Math.max(1,Math.floor(Number(reward.count||1))),amount=grantCardToState(state,reward.cardId,count,pushLog);
            if(amount)granted.push({type:reward.type,cardId:reward.cardId,count:amount});
          }
          target._encounterRewardResolved=true;
        }
        pushLog?.(`${source.character.name}｜${passive.name}發動：${target.character.name} 由 ${previousTeam} 轉為我方控制${granted.length?"，並直接取得遭遇獎勵":""}。`,"SYSTEM");
        results.push({sourceId:source.id,unitId:target.id,monsterId:monster.id,passiveId:passive.id,previousTeam,newTeam:target.team,granted});
      }
    }
    return results;
  }

  function create({playerCardState,enemyCardState,pushLog,rng=Math.random}={}){if(typeof playerCardState!=="function")throw new Error("EncounterRewardEngine requires playerCardState callback.");const grantCard=(cardId,count=1)=>grantCardToState(playerCardState(),cardId,count,pushLog),onDefeated=(unit,source=null,cause=null)=>resolveDefeat(unit,source,cause,{playerCardState,enemyCardState,pushLog,rng}),resolveDominionFor=(source,units)=>resolveDominion(source,units,{playerCardState,enemyCardState,pushLog,rng});return Object.freeze({grantCard,onDefeated,resolveDominion:resolveDominionFor});}
  return Object.freeze({create,resolveDefeat,resolveDominion,grantCardToState});
})();
globalThis.EncounterRewardEngine=EncounterRewardEngine;
