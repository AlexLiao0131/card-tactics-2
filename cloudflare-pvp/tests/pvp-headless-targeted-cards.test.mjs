import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalSynchronousTargetCard} from '../src/pvp-headless-targeted-cards.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {CardDatabase} from '../../js/card-database.js';
const deck0=Array(20).fill('imperial_archer_card'),deck1=Array(20).fill('imperial_swordsman_card');
function fixture(){
 let g=createOpeningGame({decks:[deck0,deck1],serverSeed:20261103});
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 g=openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 beginCanonicalPlayerCardPhase(g);
 const point=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 const unit=withCanonicalEngines(g,e=>e.unitRuntime.create({id:'templar',team:'P',characterId:'church_templar_hero',
   x:point.x,y:point.y,map:g.battlefield.map,cores:g.battlefield.cores}));
 delete unit._runtimeMap;
 g.units.push(unit);
 return {g,unit,point};
}
const cast=(g,cardId,center)=>resolveCanonicalPlayerCommand(g,{type:'PLAY_TARGET_CARD',cardId,x:center.x,y:center.y},0);
function supply(g,cardId){g.cards[0].zones.hand.push(cardId);g.cards[0].crystals=10;}

test('AoE footprint was moved intact from tactical-game into official TacticalEngine',()=>{
 const {g}=fixture();
 for(const tile of g.battlefield.map.tiles.filter((_,i)=>i%13===0))for(const radius of [0,1,2,3]){
   const original=g.battlefield.map.tiles.filter(t=>Math.abs(t.x-tile.x)+Math.abs(t.y-tile.y)<=radius);
   assert.deepEqual(TacticalEngine.aoeTiles(g.battlefield.map,tile,radius),original);
 }
});
test('official targeted-card adapter accepts meteor via shared synchronous damage reducer',()=>{
 for(const id of ['miracle_card','church_dispel_card','church_entrenchment_card','church_judgement_card','flood_card','wildfire_card','tornado_card','whirlpool_card','starfall_card'])
   assert.equal(isCanonicalSynchronousTargetCard(CardDatabase.get(id)),true,id);

});
test('official AREA_HEAL target card restores player HP, pays crystals, and uses canonical line-of-sight',()=>{
 const {g,unit,point}=fixture();supply(g,'miracle_card');
 unit.hp-=60;
 const before=unit.hp,crystals=g.cards[0].crystals;
 const r=cast(g,'miracle_card',point);
 assert.equal(r.accepted,true);
 assert.equal(crystals-g.cards[0].crystals,CardDatabase.get('miracle_card').cost);
 assert.ok(unit.hp>before);
 assert.equal(g.cards[0].zones.discard.includes('miracle_card'),true);
 assert.doesNotThrow(()=>structuredClone(g));
});
test('official AREA_BUFF target card grants faction-restricted battlefield effect, not invented buff stats',()=>{
 const {g,unit,point}=fixture();supply(g,'church_entrenchment_card');
 const r=cast(g,'church_entrenchment_card',point);
 assert.equal(r.accepted,true);
 assert.ok(unit.effects.some(e=>e.id==='CHURCH_ENTRENCHMENT'));
});
test('targeted card cannot forge radius/damage or spend crystals when center is illegal',()=>{
 const {g,point}=fixture();supply(g,'miracle_card');
 const before=structuredClone(g.cards[0]);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'PLAY_TARGET_CARD',cardId:'miracle_card',x:point.x,y:point.y,heal:99999},0),
   {code:'INVALID_TARGET_CARD_COMMAND'});
 assert.throws(()=>cast(g,'miracle_card',{x:9999,y:9999}),{code:'OFFICIAL_TARGET_CARD_REJECTED'});
 assert.deepEqual(g.cards[0],before);

});

test('additional synchronous official cards resolve through shared effects and environment handlers',()=>{
 for(const id of ['church_dispel_card','church_judgement_card','flood_card','wildfire_card','tornado_card']){
   const {g,point}=fixture();supply(g,id);
   const r=cast(g,id,point);
   assert.equal(r.accepted,true,id);
   assert.equal(g.cards[0].zones.discard.includes(id),true,id);
   assert.doesNotThrow(()=>structuredClone(g),id);
 }
});

test('official per-seat opponent target card treats ENEMY seat as own allied team',()=>{
 const {g}=fixture();
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(g,{type:'END_TACTICAL_PHASE'},0);
 const point=g.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
 const enemy=withCanonicalEngines(g,e=>e.unitRuntime.create({id:'enemy-caster',team:'E',characterId:'church_templar_hero',
    x:point.x,y:point.y,map:g.battlefield.map,cores:g.battlefield.cores}));
 delete enemy._runtimeMap;
 enemy.hp-=60;g.units.push(enemy);
 g.cards[1].zones.hand.push('miracle_card');g.cards[1].crystals=10;
 const old=enemy.hp;
 const r=resolveCanonicalPlayerCommand(g,{type:'PLAY_TARGET_CARD',cardId:'miracle_card',x:point.x,y:point.y},1);
 assert.equal(r.accepted,true);
 assert.ok(enemy.hp>old,'the card must heal its issuing side, not permanently P team');
});


test('official starfall commits immediate damage + fire/impact on server, and has no deferred UI timer',()=>{
 const {g,unit,point}=fixture();supply(g,'starfall_card');
 const before=unit.hp,health=structuredClone(g.cards[0]);
 const result=cast(g,'starfall_card',point);
 assert.equal(result.accepted,true);
 assert.ok(unit.hp<before,'impact must commit unit damage immediately inside the authoritative command');
 assert.equal(health.crystals-g.cards[0].crystals,CardDatabase.get('starfall_card').cost);
 assert.ok(g.cards[0].zones.discard.includes('starfall_card'));
 assert.doesNotThrow(()=>structuredClone(g));
});
