import { browserDeckStorage } from './deck-browser-storage.js';

// Keep the original js/ rule owner. Server instances inject explicit dependencies;
// the browser singleton keeps the established DeckEngine API and storage keys.
export function createDeckEngine({cardDatabase=null,packDatabase=null,cards=null,storage=null}={}) {
  const cardDB=()=>cardDatabase ?? globalThis.CardDatabase;
  const packDB=()=>packDatabase ?? globalThis.PackDatabase;
  const cardDefinitions=()=>cards ?? globalThis.CARDS;

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
  function normalize(ids=[]){const db=cardDB(),out=[];for(const id of ids){const card=db.get(id);if(!card||!db.canPersist(card))continue;if(card.unitType==="HERO"&&out.includes(id))continue;out.push(id);}return out;}
  function validate(ids=[]){const deck=normalize(ids),errors=[];
    if(!Array.isArray(ids)||deck.length!==ids.length)errors.push("牌組包含無效卡牌或重複的 HERO。");
    if(deck.length!==BATTLE_DECK_SIZE)errors.push(`一場必須配置 ${BATTLE_DECK_SIZE} 張牌，目前 ${deck.length} 張。`);
    return{valid:!errors.length,deck,errors,required:BATTLE_DECK_SIZE};
  }
  function canAdd(ids=[],id){return ids.length<BATTLE_DECK_SIZE&&normalize([...ids,id]).length===ids.length+1;}
  function autoBuild(groupId,{size=BATTLE_DECK_SIZE}={}){
    const CardDatabase=cardDB(),PackDatabase=packDB();
    const cards=PackDatabase.cards(groupId).filter(CardDatabase.canPersist),heroes=cards.filter(c=>c.unitType==="HERO"),units=cards.filter(c=>c.type==="CHARACTER"&&c.unitType!=="HERO"),spells=cards.filter(c=>c.type==="SPELL"),out=[];
    const target=Math.min(BATTLE_DECK_SIZE,Math.max(0,Number(size)||0));
    heroes.slice(0,2).forEach(c=>out.push(c.id));
    let i=0;while(out.length<Math.min(target,10)&&units.length)out.push(units[i++%units.length].id);
    i=0;while(out.length<target&&spells.length)out.push(spells[i++%spells.length].id);
    i=0;while(out.length<target&&units.length)out.push(units[i++%units.length].id);
    // Group-specific packs can be small. Fill from the same official collection,
    // not from phantom copies of battle-generated or uncollectible cards.
    const available=Object.values(cardDefinitions()||{}).filter(CardDatabase.canPersist);
    const pool=available.length?available:[...new Set(PackDatabase.list().flatMap(p=>PackDatabase.cards(p.id)))].filter(CardDatabase.canPersist);
    i=0;while(out.length<target&&pool.length&&i<target*pool.length){const card=pool[i++%pool.length];if(card.unitType==="HERO"&&out.includes(card.id))continue;out.push(card.id);}
    return normalize(out);
  }
  function opponentCardPool(){
    const db=cardDB();
    return Object.values(cardDefinitions()||{}).filter(card=>db.canPersist(card)&&
      (db.isCharacter(card)||(db.isSpell(card)&&card.effect?.type==="WEATHER")));
  }
  function opponentCardProfile(card,{detailed=false}={}){
    const db=cardDB(),character=db.isCharacter(card)?globalThis.LoadoutDatabase?.resolveCharacter?.(card.characterId,card.loadoutId||null):null;
    const combat=character?.combat||{};
    const skills=(character?.skillIds||character?.skills||[]).map(id=>globalThis.SkillDatabase?.get?.(id)).filter(Boolean);
    const effects=s=>[...(s.effects||[]),...(s.relationEffects||[])].map(e=>e.type).filter(Boolean);
    const tags=s=>[...new Set([...effects(s),s.utilityAction?.type,s.areaDamage||s.aoeDamage||s.persistentArea?"AREA":null,s.danceAura?"DANCE":null,s.channel?"CHANNEL":null,s.enchantment?"ENCHANT_WEAPON":null,s.approach?"APPROACH":null,s.waterMagic?"WATER_MAGIC":null,s.bloodBurst?"BLOOD_BURST":null,s.bloodShadow?"BLOOD_SHADOW":null,s.deathDance?"DEATH_DANCE":null,...(s.affixes||[])].filter(Boolean))];
    const variants=skills.flatMap(s=>[s,...(s.variants||[]).map(v=>globalThis.SkillDatabase.resolveVariant(s,v.id)).filter(Boolean)]);
    const capabilities=[...new Set(variants.flatMap(tags))].sort();
    const entry={id:card.id,name:card.name,cost:Number(card.cost||0),kind:card.unitType==="HERO"?"HERO":db.isCharacter(card)?"UNIT":"SPELL",faction:card.faction||"NEUTRAL"};
    if(character){
      entry.role=character.archetype||"UNIT";
      entry.stats=Object.fromEntries(["hp","atk","matk","def","mdef","move"].filter(k=>Number.isFinite(Number(combat[k]))).map(k=>[k,Number(combat[k])]));
      entry.capabilities=capabilities;
      entry.skills=skills.map(s=>({id:s.id,...(detailed?{name:s.name}:{}),category:s.category,target:s.target,power:s.power,mp:s.manaCost||0,range:s.range?[s.range.min,s.range.max]:null,tags:tags(s)}));
      entry.passives=(character.passives||[]).map(id=>({id}));
      entry.equipment={armor:character.armorId||null,weapons:Object.values(character.weaponIds||{})};
      if(character.companionIds?.length)entry.companions=[...character.companionIds];
    }else entry.effect={type:card.effect?.type,weather:card.effect?.weather,duration:card.effect?.durationTurns};
    return entry;
  }
  // Policy, not game stats: balance role coverage and the opening crystal budget.
  // Repeatable non-heroes use the same validator as player decks; never fabricate cards.
  function buildOpponentDeck({random=Math.random,startingCrystals=4}={}){
    const profiles=opponentCardPool().filter(card=>cardDB().isCharacter(card)).map(card=>opponentCardProfile(card));
    if(!profiles.length)throw Error("AI_CARD_POOL_EMPTY");
    const role=p=>p.capabilities?.some(t=>t==="HEAL"||t==="HEAL_OVER_TIME")?"SUPPORT":p.role||"UNIT";
    const buckets=new Map(),ids=new Map(),deck=[];
    // At least half the deck must be affordable at battle start when possible.
    // Thereafter prefer unique heroes and diverse roles, not one faction.
    while(deck.length<BATTLE_DECK_SIZE){
      let candidates=profiles.filter(p=>canAdd(deck,p.id));
      if(deck.length<Math.ceil(BATTLE_DECK_SIZE/2)){
        const affordable=candidates.filter(p=>p.cost<=startingCrystals);
        if(affordable.length)candidates=affordable;
      }
      if(!candidates.length)throw Error("AI_CARD_POOL_CANNOT_FILL_DECK");
      const order=candidates.map(p=>({p,roleCount:buckets.get(role(p))||0,used:ids.get(p.id)||0,tie:random()}));
      order.sort((a,b)=>a.roleCount-b.roleCount||a.used-b.used||Number(b.p.kind==="HERO")-Number(a.p.kind==="HERO")||a.tie-b.tie||a.p.id.localeCompare(b.p.id));
      const chosen=order[0].p;deck.push(chosen.id);ids.set(chosen.id,(ids.get(chosen.id)||0)+1);buckets.set(role(chosen),(buckets.get(role(chosen))||0)+1);
    }
    const rain=opponentCardPool().find(c=>c.effect?.type==="WEATHER"&&c.effect.weather==="HEAVY_RAIN");
    if(rain&&deck.some(id=>profiles.find(p=>p.id===id)?.capabilities?.includes("WATER_MAGIC"))){
      const duplicate=deck.findLastIndex((id,i)=>i>=Math.ceil(BATTLE_DECK_SIZE/2)&&deck.indexOf(id)!==i);
      if(duplicate>=0)deck[duplicate]=rain.id;
    }
    const result=validate(deck);if(!result.valid)throw Error(result.errors.join(" "));return result.deck;
  }
  function requireStorage(){if(!storage)throw Error('DECK_STORAGE_UNAVAILABLE');return storage;}
  function setActive(ids){const result=validate(ids);if(!result.valid)throw new Error(result.errors.join(" "));requireStorage().setItem(ACTIVE_KEY,JSON.stringify(result.deck));return result.deck;}
  function getActive(){try{return normalize(JSON.parse(requireStorage().getItem(ACTIVE_KEY)||"[]"));}catch{return[];}}
  function saved(){try{return JSON.parse(requireStorage().getItem(SAVED_KEY)||"{}")||{};}catch{return{};}}
  function save(name,ids){const result=validate(ids);if(!result.valid)throw new Error(result.errors.join(" "));const all=saved();all[name]=result.deck;requireStorage().setItem(SAVED_KEY,JSON.stringify(all));return all[name];}
  function load(name){return normalize(saved()[name]||[]);}
  return{BATTLE_DECK_SIZE,create,shuffle,draw,removeFromHand,toDiscard,toGraveyard,reviveToHand,normalize,validate,canAdd,autoBuild,opponentCardPool,opponentCardProfile,buildOpponentDeck,setActive,getActive,saved,save,load};
}

export const DeckEngine=createDeckEngine({storage:browserDeckStorage()});
globalThis.DeckEngine=DeckEngine;
