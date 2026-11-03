/**
 * PvP deck intake uses the EXACT existing browser card database and deck rules.
 * Wrangler bundles these files from the repository root during deployment;
 * there is no second copy in cloudflare-pvp or shared/.
 *
 * Do not import browser UI or the tactical-game runtime into Workers.
 */
import { CARDS, CardDatabase } from '../../js/card-database.js';
import { DeckEngine } from '../../js/deck-engine.js';

export function validateOfficialDeck(rawCards) {
  // Network input safety only: do not permit inherited object keys such as
  // '__proto__' to be treated as real cards by a plain-object database lookup.
  if (!Array.isArray(rawCards) || rawCards.length !== DeckEngine.BATTLE_DECK_SIZE ||
      !rawCards.every(id => typeof id === 'string' &&
        id.length > 0 && id.length <= 100 && Object.hasOwn(CARDS, id) &&
        CardDatabase.canPersist(CardDatabase.get(id)))) {
    return {valid:false, error:'INVALID_DECK'};
  }
  const result = DeckEngine.validate(rawCards);
  if (!result.valid) return {valid:false, error:'INVALID_DECK'};
  return {valid:true, cards:result.deck};
}
