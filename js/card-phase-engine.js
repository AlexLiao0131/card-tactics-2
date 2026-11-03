// Official card-phase rules remain in js/, but can now be instantiated with
// explicit dependencies in Cloudflare without relying on browser globals.
export function createCardPhaseEngine({deckEngine=null,cardDatabase=null,loadoutDatabase=null,skillDatabase=null}={}) {
  const deckRules=()=>deckEngine ?? globalThis.DeckEngine;
  const cards=()=>cardDatabase ?? globalThis.CardDatabase;
  const loadouts=()=>loadoutDatabase ?? globalThis.LoadoutDatabase;
  const skills=()=>skillDatabase ?? globalThis.SkillDatabase;

  const DEFAULT_STARTING_CRYSTALS=4,DEFAULT_MAX_CRYSTALS=10,DEFAULT_CRYSTAL_GROWTH=1,DEFAULT_HAND_SIZE=5;
  function create({deck=[],startingCrystals=DEFAULT_STARTING_CRYSTALS,maxCrystals=DEFAULT_MAX_CRYSTALS,crystalGrowth=DEFAULT_CRYSTAL_GROWTH,handSize=DEFAULT_HAND_SIZE}={}){return{zones:deckRules().create(deck),crystals:0,crystalCapacity:0,startingCrystals,maxCrystals,crystalGrowth,turnsStarted:0,handSize,active:false,played:[],generatedCardsGranted:[],lastGeneratedCards:[],mulliganAvailable:true,mulliganDone:false};}
  function expireTurnCards(state){const expired=[];for(const zoneName of ["hand","deck","discard"]){const zone=state?.zones?.[zoneName];if(!Array.isArray(zone))continue;for(let i=zone.length-1;i>=0;i--){const card=cards().get(zone[i]);if(card&&cards().lifetime(card)===cards().LIFETIME.TURN){expired.push(zone[i]);zone.splice(i,1);}}}return expired;}
  function handSizeCount(state){return(state?.zones?.hand||[]).reduce((count,id)=>count+(cards().get(id)?.handSizeExempt===true?0:1),0);}
  function grantGeneratedCards(state,cardIds=[]){
    if(!state?.zones?.hand)return[];
    state.generatedCardsGranted??=[];
    const granted=[];
    for(const cardId of [...new Set(cardIds||[])]){
      const card=cards().get(cardId);if(!card||state.generatedCardsGranted.includes(card.id))continue;
      state.zones.hand.push(card.id);state.generatedCardsGranted.push(card.id);granted.push(card);
    }
    state.lastGeneratedCards=granted.map(card=>card.id);
    return granted;
  }
  function begin(state,{handSize=state.handSize||DEFAULT_HAND_SIZE}={}){const expired=expireTurnCards(state);state.lastExpiredTurnCards=expired;state.active=true;state.crystalCapacity=Math.min(Number(state.maxCrystals||DEFAULT_MAX_CRYSTALS),Number(state.startingCrystals||DEFAULT_STARTING_CRYSTALS)+Math.max(0,Number(state.turnsStarted||0))*Number(state.crystalGrowth||DEFAULT_CRYSTAL_GROWTH));state.turnsStarted=Number(state.turnsStarted||0)+1;state.crystals=state.crystalCapacity;state.played=[];state.lastGeneratedCards=[];const missing=Math.max(0,Number(handSize||0)-handSizeCount(state));return deckRules().draw(state.zones,missing);}
  // A hand position is one physical draw occurrence. Card IDs describe card
  // definitions and may legally repeat; never deduplicate mulligan by card ID.
  // This same canonical hand-array position is used by the card UI and engine.
  function mulligan(state,handIndices=[]){
    if(!state?.active||!state.mulliganAvailable||state.mulliganDone)return[];
    const hand=state.zones.hand;
    const selected=[...new Set(handIndices)]
      .filter(index=>Number.isInteger(index)&&index>=0&&index<hand.length&&cards().get(hand[index])?.mulliganEligible!==false)
      .sort((a,b)=>a-b);
    const held=selected.map(index=>hand[index]);
    // Remove from right to left, preserving the indices of remaining copies.
    for(let i=selected.length-1;i>=0;i--)hand.splice(selected[i],1);
    const drawn=deckRules().draw(state.zones,held.length);
    state.zones.deck.push(...held);
    deckRules().shuffle(state.zones);
    state.mulliganAvailable=false;state.mulliganDone=true;
    return drawn;
  }
  function keepOpeningHand(state){if(!state?.mulliganAvailable||state.mulliganDone)return false;state.mulliganAvailable=false;state.mulliganDone=true;return true;}
  function canPlay(state,card){return !!state.active&&!!card&&typeof card.cost==="number"&&Number.isFinite(card.cost)&&card.cost>=0&&state.zones.hand.includes(card.id)&&state.crystals>=card.cost;}
  function commit(state,card){if(!canPlay(state,card))return false;if(!deckRules().removeFromHand(state.zones,card.id))return false;state.crystals-=Number(card.cost||0);state.played.push(card.id);state.lastGeneratedCards=[];if(cards().isCharacter(card))grantGeneratedCards(state,loadouts().generatedCardsForCard(card));if(cards().isSpell(card))deckRules().toDiscard(state.zones,card.id);return true;}
  function characterDefeated(state,cardId){if(cardId)deckRules().toGraveyard(state.zones,cardId);}
  function resolveTurnEndEffects(state,{units=[],team="P"}={}){const results=[];for(const unit of units){if(!unit?.alive||unit.team!==team)continue;for(const passive of skills().passiveList(unit.character?.passives)){const effect=passive.turnEndEffect;if(effect?.type!=="DRAW")continue;const drawn=deckRules().draw(state.zones,Math.max(0,Number(effect.count||0)));results.push({sourceId:passive.id,sourceName:passive.name,unitId:unit.id,drawn});}}return results;}
  function end(state){state.active=false;}
  return{DEFAULT_STARTING_CRYSTALS,DEFAULT_MAX_CRYSTALS,DEFAULT_CRYSTAL_GROWTH,DEFAULT_HAND_SIZE,create,begin,mulligan,keepOpeningHand,canPlay,commit,characterDefeated,resolveTurnEndEffects,expireTurnCards,handSizeCount,grantGeneratedCards,end};
}

export const CardPhaseEngine=createCardPhaseEngine();
globalThis.CardPhaseEngine=CardPhaseEngine;
