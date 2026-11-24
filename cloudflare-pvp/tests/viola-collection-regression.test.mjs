import test from 'node:test';
import assert from 'node:assert/strict';
import {CardDatabase} from '../../js/card-database.js';
import {PackDatabase} from '../../js/pack-database.js';
import {PackEngine} from '../../js/pack-engine.js';
import {DeckEngine} from '../../js/deck-engine.js';
import {ItemInventoryEngine} from '../../js/item-inventory-engine.js';
import '../../js/item-database.js';
import {ShellUI} from '../../js/shell-ui.js';
import {validateOfficialDeck} from '../src/canonical-deck-rules.mjs';

test('Viola is discoverable under its own preparation category and retains its official identity',()=>{
  const card=CardDatabase.get('viola_card');
  assert.equal(card.pack,'WARLOCK_SUPPLEMENT');
  assert.equal(PackDatabase.get(card.pack).name,'黑暗精靈');
  assert.ok(PackDatabase.list().some(group=>group.id===card.pack));
  assert.deepEqual(PackDatabase.cards(card.pack),[card]);
  assert.deepEqual(PackDatabase.cards('DEMON_SUPPLEMENT').map(c=>c.id),['velsa_card']);
  assert.deepEqual(PackEngine.open('WARLOCK_FIXED').cards,['viola_card']);
  assert.equal(CardDatabase.canPersist(card),true);
});
test('Viola deck, preparation entries and PvP validation share the same canonical card',()=>{
  const deck=DeckEngine.autoBuild('WARLOCK_SUPPLEMENT');
  assert.equal(deck.length,20);
  assert.equal(deck.filter(id=>id==='viola_card').length,1);
  assert.equal(DeckEngine.validate(deck).valid,true);
  assert.equal(validateOfficialDeck(deck).valid,true);
  assert.equal(DeckEngine.canAdd([],'viola_card'),true);
  assert.equal(DeckEngine.canAdd(['viola_card'],'viola_card'),false);
  assert.equal(DeckEngine.canAdd([],'felguard_card'),false);
  assert.equal(PackDatabase.list().flatMap(group=>group.cards).includes('felguard_card'),false);
  assert.equal(deck.includes('felguard_card'),false);
  const entry=ItemInventoryEngine.deckEntries(deck).find(e=>e.cardId==='viola_card');
  assert.equal(entry.key,'viola_card#1');
  assert.equal(entry.card,CardDatabase.get('viola_card'));
});
test('Actual ShellUI tab, card list and preparation renderer include Viola',()=>{
  const oldDocument=globalThis.document;
  const nodes=new Map();
  globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',querySelectorAll:()=>[]});return nodes.get(id);},querySelectorAll:()=>[]};
  try{
    const shell=new ShellUI(null,null);
    shell.activeGroup='WARLOCK_SUPPLEMENT';
    shell.renderTabs();shell.renderGroup();
    assert.match(nodes.get('packTabs').innerHTML,/data-group="WARLOCK_SUPPLEMENT">黑暗精靈/);
    assert.match(nodes.get('packCards').innerHTML,/data-card="viola_card"/);
    assert.match(nodes.get('packCards').innerHTML,/薇奧菈・月蝕/);
    shell.deck=DeckEngine.autoBuild(shell.activeGroup);
    shell.renderPreparation();
    assert.match(nodes.get('prepCharacters').innerHTML,/data-prep-character="viola_card#1"/);
    assert.match(nodes.get('prepCharacters').innerHTML,/薇奧菈・月蝕/);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});
