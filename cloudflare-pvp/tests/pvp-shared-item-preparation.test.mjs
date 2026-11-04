import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/pvp-canonical-setup.mjs';
import {ItemInventoryEngine} from '../../js/item-inventory-engine.js';

const deck=Array(20).fill('imperial_swordsman_card');
function prepared(items=[],position=0){
 return {stash:Object.fromEntries(items.map(id=>[id,items.filter(v=>v===id).length])),
   loadouts:{imperial_swordsman_card:ItemInventoryEngine.deckEntries(deck).map((entry,i)=>
     ({key:entry.key,items:i===position?[...items]:[]}))}};
}
test('official battle inventory validates actual deck occurrence, exact slots and submitted stash counts',()=>{
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,prepared(['torch','hp_potion_small'])).valid,true);
 const tooMany=prepared(['torch','hp_potion_small','angel_feather','canoe']);
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,tooMany).reason,'INVALID_ITEM_SLOTS');
 const more=prepared(['hp_potion_small','hp_potion_small']);more.stash.hp_potion_small=1;
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,more).reason,'ITEM_COUNT_EXCEEDS_STASH');
 const foreign=prepared(['torch']);foreign.loadouts.unknown=[{key:'unknown#1',items:[]}];
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,foreign).reason,'FOREIGN_ITEM_CARD');
 assert.equal(globalThis.ItemDatabase.get('__proto__'),null);
 assert.equal(globalThis.ItemDatabase.get('constructor'),null);
 const inherited=prepared(['torch']);inherited.stash.__proto__=1;
 inherited.loadouts.imperial_swordsman_card[0].items=['__proto__'];
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,inherited).reason,'INVALID_ITEM_ID');
 const invalid=prepared(['torch']);invalid.loadouts.imperial_swordsman_card[0].key='different-card#1';
 assert.equal(ItemInventoryEngine.validateMatchPreparation(deck,invalid).reason,'INVALID_ITEM_SLOTS');
 const noItems=ItemInventoryEngine.validateMatchPreparation(deck,null);
 assert.equal(noItems.valid,true);
 assert.equal(noItems.preparation.loadouts.imperial_swordsman_card.length,20);
});

test('official inventory local consumption receipts are idempotent across reconnect',()=>{
 const previous=globalThis.localStorage;
 const db=new Map();globalThis.localStorage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v),removeItem:k=>db.delete(k)};
 try{
   ItemInventoryEngine.resetProfile();
   ItemInventoryEngine.grant('hp_potion_small',3);
   ItemInventoryEngine.grant('torch',1);
   assert.equal(ItemInventoryEngine.reconcileMatchConsumption('PRIVATE_TEST_ROOM',0,{hp_potion_small:1}),true);
   assert.equal(ItemInventoryEngine.stashCount('hp_potion_small'),2);
   assert.equal(ItemInventoryEngine.reconcileMatchConsumption('PRIVATE_TEST_ROOM',0,{hp_potion_small:1}),true);
   assert.equal(ItemInventoryEngine.stashCount('hp_potion_small'),2,'replayed state cannot charge twice');
   assert.equal(ItemInventoryEngine.reconcileMatchConsumption('PRIVATE_TEST_ROOM',0,{hp_potion_small:2}),true);
   assert.equal(ItemInventoryEngine.stashCount('hp_potion_small'),1);
   assert.equal(ItemInventoryEngine.reconcileMatchConsumption('PRIVATE_TEST_ROOM',1,{hp_potion_small:1}),true);
   assert.equal(ItemInventoryEngine.stashCount('hp_potion_small'),0);
   assert.equal(ItemInventoryEngine.stashCount('torch'),1);
   assert.equal(ItemInventoryEngine.reconcileMatchConsumption('PRIVATE_TEST_ROOM',0,{hp_potion_small:1}),false);
 }finally{globalThis.localStorage=previous;}
});

test('same original battle item runtime handles authoritative drop, pickup and ally transfer with room-persisted ground',async()=>{
 const {createOpeningGame,openingGameCore}=await import('../src/pvp-match-core.mjs');
 const {pvpAuthoritativeMatchCore}=await import('../src/pvp-authoritative-match-core.mjs');
 const first=prepared(['torch','hp_potion_small']);
 let state=createOpeningGame({decks:[deck,deck],serverSeed:2457,preparedInventories:[first,null]});
 state=openingGameCore.reduce(state,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 state=openingGameCore.reduce(state,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'BEGIN_BATTLE'},{seat:0}).state;
 const base=state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y},{seat:0}).state;
 const soldier=state.units[0];const torch=soldier.inventory.find(p=>p.itemId==='torch');
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'END_CARD_PHASE'},{seat:0}).state;
 assert.equal(state.battleGroundItems.length,0);
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'DROP_BATTLE_ITEM',unitId:soldier.id,payloadId:torch.id},{seat:0}).state;
 assert.equal(state.units[0].inventory.length,1);
 assert.equal(state.battleGroundItems.length,1);
 assert.equal(state.battleGroundItems[0].id,torch.id);
 const persisted=structuredClone(state);
 assert.throws(()=>pvpAuthoritativeMatchCore.reduce(state,{type:'PICKUP_BATTLE_ITEM',unitId:soldier.id,groundId:torch.id},{seat:1}),
   {code:'NOT_YOUR_TURN'});
 assert.equal(state.battleGroundItems.length,1);
 // A following own-turn item interaction resets the same original runtime counter.
 state.units[0].itemInteractionUsed=0;
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'PICKUP_BATTLE_ITEM',unitId:soldier.id,groundId:torch.id},{seat:0}).state;
 assert.equal(state.battleGroundItems.length,0);
 assert.deepEqual(state.units[0].inventory.map(p=>p.itemId).sort(),['hp_potion_small','torch']);
 const recipients=state.battlefield.map.tiles.filter(tile=>tile.x>=0&&tile.y>=0&&
   Math.abs(tile.x-base.x)+Math.abs(tile.y-base.y)===1&&tile.terrain!=='WALL');
 assert.ok(recipients.length);
 const ally=structuredClone(state.units[0]);ally.id='fixture_ally';ally.x=recipients[0].x;ally.y=recipients[0].y;
 ally.inventory=[];ally.itemInteractionUsed=0;
 state.units.push(ally);
 state.units[0].itemInteractionUsed=0;
 state=pvpAuthoritativeMatchCore.reduce(state,{type:'TRANSFER_BATTLE_ITEM',unitId:soldier.id,payloadId:torch.id,targetUnitId:ally.id},{seat:0}).state;
 assert.deepEqual(state.units.find(u=>u.id===ally.id).inventory.map(p=>p.itemId),['torch']);
 assert.deepEqual(state.units[0].inventory.map(p=>p.itemId),['hp_potion_small']);
 assert.equal(state.battleGroundItems.length,0);
 assert.doesNotThrow(()=>structuredClone(state));
 assert.deepEqual(persisted.battleGroundItems.map(x=>x.id),[torch.id]);
});
