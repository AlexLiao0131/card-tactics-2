import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand} from '../src/pvp-headless-tactical.mjs';
import {CardDatabase} from '../../js/card-database.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';

const ones=Array(20).fill('imperial_archer_card');
const twos=Array(20).fill('imperial_swordsman_card');
function make(){
 let g=createOpeningGame({decks:[ones,twos],serverSeed:5501});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 return g;
}
function addWeather(g,id){g.cards[0].zones.hand.push(id);g.cards[0].crystals=10;}
const play=(g,id)=>resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:id},0);

test('official card-phase controller spends crystals and applies Weather card to canonical environment',()=>{
 const g=make();addWeather(g,'fog_card');
 const before=g.cards[0].crystals;
 const card=CardDatabase.get('fog_card');
 assert.equal(card.effect.type,'WEATHER');
 const result=play(g,card.id);
 assert.equal(result.accepted,true);
 assert.equal(result.crystalsBefore-result.crystalsAfter,card.cost);
 assert.equal(g.cards[0].zones.hand.includes(card.id),false);
 assert.equal(g.cards[0].zones.discard.includes(card.id),true);
 assert.equal(EnvironmentEngine.climateSnapshot(g.environmentState).legacyWeather,'FOG');
 assert.equal(g.activeSeat,0);assert.equal(g.phase,'PLAYER_CARD_PHASE');
 assert.doesNotThrow(()=>structuredClone(g));
});
test('weather spell remains deterministic for same authoritative session and card command',()=>{
 const g=make();addWeather(g,'rain_card');
 const duplicate=structuredClone(g);
 play(g,'rain_card');play(duplicate,'rain_card');
 assert.deepEqual(g.environmentState,duplicate.environmentState);
 assert.deepEqual(g.battlefield.map,duplicate.battlefield.map);
 assert.deepEqual(g.cards[0],duplicate.cards[0]);
 assert.deepEqual(g.events,duplicate.events);
});
test('weather cards reject client-supplied weather/duration, insufficient crystals and unavailable card',()=>{
 const g=make();addWeather(g,'snow_card');
 const before=structuredClone(g);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:'snow_card',durationTurns:9999},0),{code:'INVALID_INSTANT_CARD_COMMAND'});
 assert.throws(()=>play(g,'starfall_card'),{code:'FULL_CARD_ORCHESTRATION_REQUIRED'});
 assert.throws(()=>play(g,'fog_card'),{code:'CARD_NOT_PLAYABLE'});
 assert.deepEqual(g,before);
 g.cards[0].crystals=0;
 assert.throws(()=>play(g,'snow_card'),{code:'CARD_NOT_PLAYABLE'});
});
test('opponent cannot cast weather on player card phase and no spell casts in tactical phase',()=>{
 const g=make();addWeather(g,'fog_card');
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:'fog_card'},1),{code:'NOT_YOUR_TURN'});
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 assert.throws(()=>play(g,'fog_card'),{code:'NOT_CARD_PHASE'});
});

test('steal-hand card selects opposing hand occurrence with per-room random, never global Math.random',()=>{
 const original=make();
 const state=original.cards[0];
 state.zones.hand.push('steal_hand_card');state.crystals=10;
 original.cards[1].zones.hand=['livia_card','imperial_swordsman_card','imperial_archer_card'];
 const mirror=structuredClone(original);
 const realRandom=Math.random;
 try {
   Math.random=()=>{throw Error('FORBIDDEN_GLOBAL_RANDOM_IN_AUTHORITY')};
   const result=play(original,'steal_hand_card');
   const second=play(mirror,'steal_hand_card');
   assert.equal(result.accepted,true);
   assert.deepEqual(original.cards,mirror.cards);
   assert.equal(original.randomState,mirror.randomState);
   assert.equal(original.cards[1].zones.hand.length,2);
   assert.equal(original.cards[0].zones.discard.includes('steal_hand_card'),true);
   assert.equal(original.cards[0].crystals,5);
   assert.equal(original.cards[0].zones.hand.length,6); // spent one, stole one
   assert.equal(second.accepted,true);
 } finally {Math.random=realRandom}
});
test('steal-hand card fails without an opposing hand and cannot be forged to choose specific card',()=>{
 const g=make();g.cards[0].zones.hand.push('steal_hand_card');g.cards[0].crystals=10;
 g.cards[1].zones.hand=[];
 const before=structuredClone(g);
 assert.throws(()=>play(g,'steal_hand_card'),{code:'OFFICIAL_INSTANT_CARD_REJECTED'});
 assert.deepEqual(g,before);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:'steal_hand_card',opponentIndex:0},0),{code:'INVALID_INSTANT_CARD_COMMAND'});
});

test('both seats cast every existing untargeted WEATHER card through original controller',()=>{
 const all=['thunderstorm_card','typhoon_card','fog_card','snow_card','blizzard_card','scorching_sun_card','rain_card'];
 for(const id of all){
   const g=make();g.cards[0].zones.hand.push(id);g.cards[0].crystals=10;
   const result=play(g,id);
   assert.equal(result.accepted,true,id);
   assert.ok(g.cards[0].zones.discard.includes(id),id);
   assert.equal(g.cards[0].crystals,10-CardDatabase.get(id).cost,id);
   assert.doesNotThrow(()=>structuredClone(g),id);
 }
 const g=make();
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(g,{type:'END_TACTICAL_PHASE'},0);
 g.cards[1].zones.hand.push('fog_card');g.cards[1].crystals=10;
 const r=resolveCanonicalPlayerCommand(g,{type:'PLAY_INSTANT_CARD',cardId:'fog_card'},1);
 assert.equal(r.accepted,true);
 assert.equal(g.cards[1].crystals,7);
 assert.equal(g.phase,'ENEMY_CARD_PHASE');
 assert.equal(g.activeSeat,1);
});
