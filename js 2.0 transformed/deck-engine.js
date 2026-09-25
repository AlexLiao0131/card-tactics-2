export const DeckEngine=(()=>{
  const ACTIVE_KEY="cardtactics.activeDeck.v1",SAVED_KEY="cardtactics.savedDecks.v1";
  function create(cardIds=[]){return{deck:[...cardIds],hand:[],graveyard:[],discard:[]};}
  function shuffle(state,rng=Math.random){for(let i=state.deck.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[state.deck[i],state.deck[j]]=[state.deck[j],state.deck[i]];}return state;}
  function draw(state,count=1){const drawn=[];while(count-->0&&state.deck.length){const id=state.deck.shift();state.hand.push(id);drawn.push(id);}return drawn;}
  function removeFromHand(state,cardId){const i=state.hand.indexOf(cardId);if(i<0)return false;state.hand.splice(i,1);return true;}
  function toDiscard(state,cardId){state.discard.push(cardId);}function toGraveyard(state,cardId){state.graveyard.push(cardId);}
  function reviveToHand(state,cardId){const i=state.graveyard.indexOf(cardId);if(i<0)return false;state.graveyard.splice(i,1);state.hand.push(cardId);return true;}
  function normalize(ids=[]){const out=[];for(const id of ids){const card=CardDatabase.get(id);if(!card||!CardDatabase.canPersist(card))continue;if(card.unitType==="HERO"&&out.includes(id))continue;out.push(id);}return out;}
  function autoBuild(groupId,{size=15}={}){const cards=PackDatabase.cards(groupId).filter(CardDatabase.canPersist),heroes=cards.filter(c=>c.unitType==="HERO"),units=cards.filter(c=>c.type==="CHARACTER"&&c.unitType!=="HERO"),spells=cards.filter(c=>c.type==="SPELL"),out=[];heroes.slice(0,2).forEach(c=>out.push(c.id));let i=0;while(out.length<Math.min(size,10)&&units.length)out.push(units[i++%units.length].id);i=0;while(out.length<size&&spells.length)out.push(spells[i++%spells.length].id);i=0;while(out.length<size&&units.length)out.push(units[i++%units.length].id);return normalize(out);}
  function setActive(ids){const deck=normalize(ids);localStorage.setItem(ACTIVE_KEY,JSON.stringify(deck));return deck;}
  function getActive(){try{return normalize(JSON.parse(localStorage.getItem(ACTIVE_KEY)||"[]"));}catch{return[];}}
  function saved(){try{return JSON.parse(localStorage.getItem(SAVED_KEY)||"{}")||{};}catch{return{};}}
  function save(name,ids){const all=saved();all[name]=normalize(ids);localStorage.setItem(SAVED_KEY,JSON.stringify(all));return all[name];}
  function load(name){return normalize(saved()[name]||[]);}
  return{create,shuffle,draw,removeFromHand,toDiscard,toGraveyard,reviveToHand,normalize,autoBuild,setActive,getActive,saved,save,load};
})();
globalThis.DeckEngine=DeckEngine;
