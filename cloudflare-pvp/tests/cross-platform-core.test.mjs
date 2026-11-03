/** Canonical js/ rule parity & Worker-without-DOM verification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CARDS,CardDatabase} from '../../js/card-database.js';
import {createDeckEngine,DeckEngine} from '../../js/deck-engine.js';
import {createCardPhaseEngine,CardPhaseEngine} from '../../js/card-phase-engine.js';

const deckA=['livia_card',...Array(19).fill('imperial_swordsman_card')];
const deckB=['ophi_card',...Array(19).fill('imperial_archer_card')];
const pack={cards:()=>[CardDatabase.get('livia_card'),CardDatabase.get('imperial_swordsman_card'),CardDatabase.get('rain_card')],list:()=>[{id:'TEST'}]};
const loadouts={generatedCardsForCard(card){return card.id==='ophi_card'?['ophi_eagle_card']:[];}};
const skills={passiveList(ids){return (ids||[]).includes('DRAW_TWO')?[{id:'DRAW_TWO',name:'抽牌',turnEndEffect:{type:'DRAW',count:2}}]:[];}};

function storage() {const entries=new Map();return{getItem:k=>entries.has(k)?entries.get(k):null,setItem:(k,v)=>entries.set(k,String(v)),removeItem:k=>entries.delete(k),entries};}
function rules(storageAdapter=null){const deck=createDeckEngine({cardDatabase:CardDatabase,packDatabase:pack,cards:CARDS,storage:storageAdapter});return {deck,phase:createCardPhaseEngine({deckEngine:deck,cardDatabase:CardDatabase,loadoutDatabase:loadouts,skillDatabase:skills})};}

test('Direct import of original js/ rules works without window/document/localStorage',()=>{
  assert.equal(typeof window,'undefined');
  assert.equal(typeof document,'undefined');
  const {deck,phase}=rules();
  assert.equal(deck.BATTLE_DECK_SIZE,20);
  assert.deepEqual(deck.validate(deckA),{valid:true,deck:deckA,errors:[],required:20});
  assert.equal(phase.DEFAULT_STARTING_CRYSTALS,4);
  assert.throws(()=>deck.setActive(deckA),/DECK_STORAGE_UNAVAILABLE/);
  assert.deepEqual(deck.getActive(),[]);
  assert.deepEqual(deck.saved(),{});
});

test('Retain original deck validation, duplicate HERO and battle-only restrictions',()=>{
  const {deck}=rules();
  assert.equal(deck.validate(deckB).valid,true);
  assert.equal(deck.validate([...deckA.slice(0,19),'livia_card']).valid,false);
  assert.equal(deck.validate([...deckA.slice(0,19),'ophi_eagle_card']).valid,false);
  assert.equal(deck.validate([...deckA.slice(0,19),'flood_card']).valid,false);
  assert.equal(deck.validate(deckA.slice(1)).valid,false);
  assert.equal(deck.canAdd(deckA.slice(0,10),'livia_card'),false);
  assert.equal(deck.canAdd(deckA.slice(0,10),'rain_card'),true);
});

test('Deck zones, draw, discard, graveyard and revive preserve original structure',()=>{
  const {deck}=rules();
  const zones=deck.create(['rain_card','fog_card']);
  assert.deepEqual(Object.keys(zones),['deck','hand','graveyard','discard']);
  assert.deepEqual(deck.draw(zones,1),['rain_card']);
  assert.equal(deck.removeFromHand(zones,'rain_card'),true);
  deck.toDiscard(zones,'rain_card');
  deck.toGraveyard(zones,'fog_card');
  assert.equal(deck.reviveToHand(zones,'fog_card'),true);
  assert.deepEqual(zones,{deck:['fog_card'],hand:['fog_card'],graveyard:[],discard:['rain_card']});
});

test('Persistence adapter retains existing localStorage key schema and isolates matches',()=>{
  const first=storage(),second=storage(),a=rules(first).deck,b=rules(second).deck;
  assert.deepEqual(a.setActive(deckA),deckA);
  assert.deepEqual(a.save('A',deckA),deckA);
  assert.deepEqual(a.getActive(),deckA);
  assert.deepEqual(a.load('A'),deckA);
  assert.equal(first.getItem('cardtactics.activeDeck.v1'),JSON.stringify(deckA));
  assert.deepEqual(JSON.parse(first.getItem('cardtactics.savedDecks.v1')).A,deckA);
  assert.deepEqual(b.getActive(),[]);
  b.setActive(deckB);
  assert.deepEqual(a.getActive(),deckA);
  assert.deepEqual(b.getActive(),deckB);
});

test('Seeded shuffle remains identical and is injection-safe across independent engines',()=>{
  const a=rules().deck,b=rules().deck;
  const x=a.create(deckA),y=b.create(deckA);
  a.shuffle(x,()=>.3);b.shuffle(y,()=>.3);
  assert.deepEqual(x,y);
});

test('Card phase initial draw, crystals and turn progression keep unchanged mechanics',()=>{
  const {phase}=rules();
  const state=phase.create({deck:deckA,startingCrystals:4,maxCrystals:10,crystalGrowth:1,handSize:5});
  const initial=phase.begin(state);
  assert.equal(initial.length,5);
  assert.equal(state.zones.hand.length,5);
  assert.equal(state.crystals,4);
  assert.equal(state.crystalCapacity,4);
  phase.end(state);
  phase.begin(state);
  assert.equal(state.crystalCapacity,5);
  assert.equal(state.turnsStarted,2);
});

test('Duplicate occurrences in mulligan use hand indices, not card IDs',()=>{
  const {phase}=rules();
  const state=phase.create({deck:deckA});
  phase.begin(state);
  state.zones.hand.splice(0,state.zones.hand.length,'imperial_swordsman_card','imperial_swordsman_card');
  const picked=phase.mulligan(state,[1,1,100,-1]);
  assert.equal(picked.length,1);
  assert.equal(state.mulliganDone,true);
  assert.equal(phase.mulligan(state,[0]).length,0);
});

test('Play a spell: same crystal deduction and discard behavior',()=>{
  const {phase}=rules();
  const state=phase.create({deck:['rain_card','fog_card']});
  phase.begin(state);
  assert.equal(phase.canPlay(state,CardDatabase.get('rain_card')),true);
  assert.equal(phase.commit(state,CardDatabase.get('rain_card')),true);
  assert.equal(state.crystals,0);
  assert.equal(state.zones.discard.at(-1),'rain_card');
  assert.equal(phase.commit(state,CardDatabase.get('rain_card')),false);
});

test('Hero card triggers existing generated card mechanism exactly once',()=>{
  const {phase}=rules();
  const state=phase.create({deck:['ophi_card']});
  phase.begin(state);
  state.crystals=10;
  assert.equal(phase.commit(state,CardDatabase.get('ophi_card')),true);
  assert.deepEqual(state.generatedCardsGranted,['ophi_eagle_card']);
  assert.equal(state.zones.hand.includes('ophi_eagle_card'),true);
  assert.deepEqual(phase.grantGeneratedCards(state,['ophi_eagle_card']),[]);
});

test('Temporary cards, defeat/graveyard, turn-end passive draw unchanged',()=>{
  const {phase}=rules();
  const s=phase.create({deck:['imperial_swordsman_card','fog_card','rain_card']});
  phase.begin(s);s.zones.hand.push('ophi_eagle_card');
  assert.equal(phase.expireTurnCards(s).includes('ophi_eagle_card'),false); // Existing card is BATTLE-lifetime, not TURN.
  phase.characterDefeated(s,'livia_card');
  assert.equal(s.zones.graveyard.includes('livia_card'),true);
  s.zones.deck=['fog_card','rain_card'];
  const results=phase.resolveTurnEndEffects(s,{units:[{alive:true,team:'P',id:'u0',character:{passives:['DRAW_TWO']}},{alive:true,team:'E',id:'u1',character:{passives:['DRAW_TWO']}}]});
  assert.deepEqual(results,[{sourceId:'DRAW_TWO',sourceName:'抽牌',unitId:'u0',drawn:['fog_card','rain_card']}]);
});

test('Original singleton API names retained for existing browser consumers',()=>{
  for(const k of ['validate','normalize','setActive','getActive','save','load','autoBuild','shuffle','draw']) assert.equal(typeof DeckEngine[k],'function');
  for(const k of ['create','begin','end','mulligan','commit','canPlay','expireTurnCards','resolveTurnEndEffects']) assert.equal(typeof CardPhaseEngine[k],'function');
  assert.equal(DeckEngine,globalThis.DeckEngine);
  assert.equal(CardPhaseEngine,globalThis.CardPhaseEngine);
});

test('Auto-build still takes the original 20-card collection path',()=>{
  const {deck}=rules();
  const ids=deck.autoBuild('TEST');
  assert.equal(ids.length,20);
  assert.equal(deck.validate(ids).valid,true);
  assert.equal(ids.filter(x=>x==='livia_card').length,1);
});

test('Explicit server dependencies do not rely on the old global registrations',()=>{
  const keys=['CardDatabase','PackDatabase','LoadoutDatabase','SkillDatabase','CARDS','DeckEngine','CardPhaseEngine'];
  const previous=keys.map(k=>[k,globalThis[k]]);
  try {
    for(const key of keys)delete globalThis[key];
    const {deck,phase}=rules();
    assert.equal(deck.validate(deckA).valid,true);
    const state=phase.create({deck:['rain_card','fog_card']});
    phase.begin(state);
    assert.equal(phase.commit(state,CardDatabase.get('rain_card')),true);
    assert.deepEqual(deck.autoBuild('TEST').length,20);
  } finally {for(const [key,value] of previous)globalThis[key]=value;}
});
