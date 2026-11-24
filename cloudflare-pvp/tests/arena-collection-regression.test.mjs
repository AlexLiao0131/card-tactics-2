import test from 'node:test';
import assert from 'node:assert/strict';
import {CARDS, CardDatabase} from '../../js/card-database.js';
import {CARD_GROUPS, PACK_PRODUCTS, PackDatabase} from '../../js/pack-database.js';

// The browser card browser and all battle modes share CardDatabase and PackDatabase.
// A character present only in CARDS is invisible until it belongs to CARD_GROUPS.
test('Arena collection category is discoverable by the existing preparation tabs',()=>{
  const group=PackDatabase.get('ARENA');
  assert.ok(group);
  assert.equal(group.name,'鬥技場');
  assert.ok(PackDatabase.list().some(entry=>entry.id==='ARENA'));
  assert.deepEqual(group.cards,['magda_card']);
});

test('Arena category displays the canonical Magda HERO card and permits deck inclusion',()=>{
  const [card]=PackDatabase.cards('ARENA');
  assert.ok(card);
  assert.strictEqual(card,CardDatabase.get('magda_card'));
  assert.strictEqual(card,CARDS.magda_card);
  assert.equal(card.characterId,'magda');
  assert.equal(card.faction,'ARENA');
  assert.equal(card.type,'CHARACTER');
  assert.equal(card.unitType,'HERO');
  assert.equal(card.loadoutId,'magda_default');
  assert.equal(CardDatabase.canPersist(card),true);
  assert.equal(CardDatabase.availability(card),CardDatabase.AVAILABILITY.COLLECTION);
});

test('Existing preparation categories remain intact and Arena has one resolvable card',()=>{
  const existing=['DANCER_SUPPLEMENT','ALCHEMY_SUPPLEMENT','LIVIA_SUPPLEMENT','IMPERIAL','MAGIC','ELF_EMPIRE','MOON_FOREST',
    'OPHI_SUPPLEMENT','CHURCH','SAINT_SUPPLEMENT','SERAPHINA_SUPPLEMENT',
    'SEA_WORLD_SUPPLEMENT','BEAST_SUPPLEMENT','ANGEL_SUPPLEMENT','DEMON_SUPPLEMENT','WARLOCK_SUPPLEMENT','OTHER'];
  for(const id of existing)assert.strictEqual(PackDatabase.get(id),CARD_GROUPS[id]);
  // New official categories may be added; preserve existing IDs, not a historical total.
  const ids=PackDatabase.list().map(group=>group.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(PackDatabase.cards('ARENA').map(card=>card.id),['magda_card']);
});

test('Adding Arena to collection does not create a fake shop product or change existing product pools',()=>{
  assert.equal(PackDatabase.product('ARENA'),null);
  assert.equal(Object.hasOwn(PACK_PRODUCTS,'ARENA'),false);
  assert.equal(PackDatabase.cards('IMPERIAL')[0].id,'leon_card');
});
