export const DeckEngine=(()=>{
  const ACTIVE_KEY="cardtactics.activeDeck.v1",SAVED_KEY="cardtactics.savedDecks.v1";
  const BATTLE_DECK_SIZE=20;
  function create(cardIds=[]){return{deck:[...cardIds],hand:[],graveyard:[],discard:[]};}
  function shuffle(state,rng=Math.random){for(let i=state.deck.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[state.deck[i],state.deck[j]]=[state.deck[j],state.deck[i]];}return state;}
  function draw(state,count=1){const drawn=[];while(count-->0&&state.deck.length){const id=state.deck.shift();state.hand.push(id);drawn.push(id);}return drawn;}
  function removeFromHand(state,cardId){const i=state.hand.indexOf(cardId);if(i<0)return false;state.hand.splice(i,1);return true;}
  function toDiscard(state,cardId){state.discard.push(cardId);}function toGraveyard(state,cardId){state.graveyard.push(cardId);}
  function reviveToHand(state,cardId){const i=state.graveyard.indexOf(cardId);if(i<0)return false;state.graveyard.splice(i,1);state.hand.push(cardId);return true;}
  // Normalize historical/local-storage decks without silently fabricating cards.
  // The same validator governs editing, saving, preparation, and battle entry.
  function normalize(ids=[]){const out=[];for(const id of ids){const card=CardDatabase.get(id);if(!card||!CardDatabase.canPersist(card))continue;if(card.unitType==="HERO"&&out.includes(id))continue;out.push(id);}return out;}
  function validate(ids=[]){const deck=normalize(ids),errors=[];
    if(!Array.isArray(ids)||deck.length!==ids.length)errors.push("牌組包含無效卡牌或重複的 HERO。");
    if(deck.length!==BATTLE_DECK_SIZE)errors.push(`一場必須配置 ${BATTLE_DECK_SIZE} 張牌，目前 ${deck.length} 張。`);
    return{valid:!errors.length,deck,errors,required:BATTLE_DECK_SIZE};
  }
  function canAdd(ids=[],id){return ids.length<BATTLE_DECK_SIZE&&normalize([...ids,id]).length===ids.length+1;}
  function autoBuild(groupId,{size=BATTLE_DECK_SIZE}={}){
    const cards=PackDatabase.cards(groupId).filter(CardDatabase.canPersist),heroes=cards.filter(c=>c.unitType==="HERO"),units=cards.filter(c=>c.type==="CHARACTER"&&c.unitType!=="HERO"),spells=cards.filter(c=>c.type==="SPELL"),out=[];
    const target=Math.min(BATTLE_DECK_SIZE,Math.max(0,Number(size)||0));
    heroes.slice(0,2).forEach(c=>out.push(c.id));
    let i=0;while(out.length<Math.min(target,10)&&units.length)out.push(units[i++%units.length].id);
    i=0;while(out.length<target&&spells.length)out.push(spells[i++%spells.length].id);
    i=0;while(out.length<target&&units.length)out.push(units[i++%units.length].id);
    // Group-specific packs can be small. Fill from the same official collection,
    // not from phantom copies of battle-generated or uncollectible cards.
    const available=Object.values(globalThis.CARDS||{}).filter(CardDatabase.canPersist);
    const pool=available.length?available:[...new Set(PackDatabase.list().flatMap(p=>PackDatabase.cards(p.id)))].filter(CardDatabase.canPersist);
    i=0;while(out.length<target&&pool.length&&i<target*pool.length){const card=pool[i++%pool.length];if(card.unitType==="HERO"&&out.includes(card.id))continue;out.push(card.id);}
    return normalize(out);
  }
  function setActive(ids){const result=validate(ids);if(!result.valid)throw new Error(result.errors.join(" "));localStorage.setItem(ACTIVE_KEY,JSON.stringify(result.deck));return result.deck;}
  function getActive(){try{return normalize(JSON.parse(localStorage.getItem(ACTIVE_KEY)||"[]"));}catch{return[];}}
  function saved(){try{return JSON.parse(localStorage.getItem(SAVED_KEY)||"{}")||{};}catch{return{};}}
  function save(name,ids){const result=validate(ids);if(!result.valid)throw new Error(result.errors.join(" "));const all=saved();all[name]=result.deck;localStorage.setItem(SAVED_KEY,JSON.stringify(all));return all[name];}
  function load(name){return normalize(saved()[name]||[]);}
  return{BATTLE_DECK_SIZE,create,shuffle,draw,removeFromHand,toDiscard,toGraveyard,reviveToHand,normalize,validate,canAdd,autoBuild,setActive,getActive,saved,save,load};
})();
globalThis.DeckEngine=DeckEngine;
