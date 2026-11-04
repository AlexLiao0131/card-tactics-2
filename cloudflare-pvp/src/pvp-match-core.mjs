/**
 * PvP server-side opening hand adapter.
 *
 * This module does not implement or copy Card Tactics gameplay rules. All deck
 * validation, shuffle, draw and mulligan rules come from the original js/.
 * Current server scope: private opening hands, then the original MapGenerator
 * creates and persists ONE server-side battlefield for both players.
 * Deployment, attacks, climate and turn resolution remain DISABLED until
 * their exact canonical tactical engines can run on the Worker. Never call it a duel.
 */
import { CardDatabase } from '../../js/card-database.js';
import { createDeckEngine } from '../../js/deck-engine.js';
import { createCardPhaseEngine } from '../../js/card-phase-engine.js';
import { StageDatabase } from '../../js/stage-database.js';
import { validateOfficialDeck } from './canonical-deck-rules.mjs';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import { PVP_STAGE_ID,projectOfficialBattlefield } from './pvp-battlefield.mjs';
import { initializeCanonicalWorld } from './pvp-canonical-setup.mjs';
export { PVP_STAGE_ID };

export const OPENING_GAME_SCHEMA = 'ct2-pvp-opening-v1';


// RNG is stored in durable state, never provided by either player. It is only
// used as the RNG callback to the existing DeckEngine.shuffle() implementation.
function seededRandom(state) {
  return () => {
    state.randomState = (Math.imul(state.randomState, 1664525) + 1013904223) >>> 0;
    return state.randomState / 4294967296;
  };
}
function rules(state) {
  const baseDeck = createDeckEngine({ cardDatabase: CardDatabase });
  const rng = seededRandom(state);
  const deckEngine = { ...baseDeck, shuffle: zones => baseDeck.shuffle(zones, rng) };
  return { deckEngine, cardPhase: createCardPhaseEngine({ deckEngine, cardDatabase: CardDatabase }) };
}
function requireOpening(state) {
  if (!state || state.schema !== OPENING_GAME_SCHEMA || !Array.isArray(state.cards) ||
      state.cards.length !== 2 || !Array.isArray(state.pendingSeats)) {
    throw new PvpCommandError('BAD_MATCH_STATE');
  }
}
export function createOpeningGame({ decks, serverSeed }) {
  if (!Array.isArray(decks) || decks.length !== 2) throw new PvpCommandError('TWO_VALID_DECKS_REQUIRED');
  const validated=decks.map(deck=>validateOfficialDeck(deck));
  if (!validated.every(item=>item.valid)) throw new PvpCommandError('TWO_VALID_DECKS_REQUIRED');
  if (!Number.isInteger(serverSeed) || serverSeed < 0 || serverSeed > 0xffffffff) {
    throw new PvpCommandError('SERVER_SEED_REQUIRED');
  }
  const stage=StageDatabase.get(PVP_STAGE_ID);
  if (!stage || stage.ruleset!=='CORE_CAPTURE' || !stage.cardRules || !stage.enemyCardRules) {
    throw new PvpCommandError('OFFICIAL_STAGE_UNAVAILABLE');
  }
  const state={schema:OPENING_GAME_SCHEMA,stageId:PVP_STAGE_ID,
    // Seed is private until full authoritative battle replay is implemented.
    randomState:serverSeed>>>0,serverMapSeed:serverSeed>>>0,phase:'OPENING_HAND',pendingSeats:[0,1],
    cards:[]};
  const {deckEngine,cardPhase}=rules(state);
  for (const seat of [0,1]) {
    const parameters=seat===0?stage.cardRules:stage.enemyCardRules;
    const cardState=cardPhase.create({deck:validated[seat].cards,
      startingCrystals:parameters.startingCrystals,
      maxCrystals:parameters.maxCrystals,
      crystalGrowth:parameters.crystalGrowth,
      handSize:parameters.handSize});
    deckEngine.shuffle(cardState.zones);
    deckEngine.draw(cardState.zones,cardState.handSize);
    // The original mulligan rule checks active. Opening setup temporarily
    // marks each state active; no turn starts and no crystals are spent.
    cardState.active=true;
    state.cards.push(cardState);
  }
  return state;
}
export const openingGameCore = Object.freeze({
  activeSeat(state) {
    requireOpening(state);
    return state.phase === 'OPENING_HAND' ? (state.pendingSeats[0] ?? null) : null;
  },
  reduce(state, action, {seat}) {
    requireOpening(state);
    if (state.phase!=='OPENING_HAND' || state.pendingSeats[0]!==seat) {
      throw new PvpCommandError('NOT_YOUR_TURN');
    }
    const cardState=state.cards[seat];
    const {cardPhase}=rules(state);
    if (action?.type==='KEEP_OPENING_HAND') {
      if (Object.keys(action).length!==1 || !cardPhase.keepOpeningHand(cardState)) {
        throw new PvpCommandError('INVALID_OPENING_DECISION');
      }
    } else if (action?.type==='MULLIGAN') {
      const indices=action.indices;
      if (Object.keys(action).sort().join('|')!=='indices|type' ||
          !Array.isArray(indices) || indices.length > cardState.zones.hand.length ||
          new Set(indices).size !== indices.length ||
          !indices.every(i=>Number.isSafeInteger(i) && i>=0 && i<cardState.zones.hand.length &&
            CardDatabase.get(cardState.zones.hand[i])?.mulliganEligible!==false)) {
        throw new PvpCommandError('INVALID_MULLIGAN');
      }
      cardPhase.mulligan(cardState,indices);
    } else {
      // No fake PLAY_CARD, MOVE, ATTACK, CAST or END_TURN rule here.
      throw new PvpCommandError('TACTICAL_GAME_CORE_NOT_READY');
    }
    cardPhase.end(cardState);
    state.pendingSeats.shift();
    if (!state.pendingSeats.length) {
      // Create the one real procedural map only AFTER both opening decisions.
      // The seed was created by the server at room start; no client-provided
      // map, terrain, Core HP, capture point or synthetic game result is accepted.
      // Old in-flight opening games predate serverMapSeed; their RNG state was
      // still chosen by the server. New games always use the immutable seed.
      const mapSeed=Number.isSafeInteger(state.serverMapSeed)
        ? state.serverMapSeed : state.randomState;
      // Construct the exact single-player battle initial conditions: MapGenerator,
      // Hydrology, Climate, environmental objects and StageEngine. The existing
      // opening hands and mulligan decisions remain authoritative and are never
      // reshuffled by this initialization.
      const decks=state.cards.map(cardState=>[
        ...cardState.zones.hand,...cardState.zones.deck,
        ...cardState.zones.discard,...cardState.zones.graveyard
      ]);
      const world=initializeCanonicalWorld({seed:mapSeed,
        mapSize:StageDatabase.get(PVP_STAGE_ID).battlefield.defaultSize,decks});
      state.battlefield=world.battlefield;
      state.environmentState=world.environmentState;
      state.stageState=world.stageState;
      state.units=world.units;
      state.nextUnitSerial=0;
      state.round=1;
      state.phase='BATTLEFIELD_READY';
    }
    return {accepted:true,state};
  },
  project(state,seat) {
    requireOpening(state);
    if (seat!==0 && seat!==1) throw new PvpCommandError('BAD_SEAT');
    const own=state.cards[seat],opponent=state.cards[1-seat];
    return {stageId:state.stageId,phase:state.phase,
      activeSeat:state.phase==='OPENING_HAND'?state.pendingSeats[0]:null,
      seat, myOpeningDone:own.mulliganDone===true,
      own:{hand:own.zones.hand.map(id=>({id,name:CardDatabase.get(id)?.name||id,
        cost:CardDatabase.get(id)?.cost??null,type:CardDatabase.get(id)?.type||'UNKNOWN'})),
        deckCount:own.zones.deck.length,discardCount:own.zones.discard.length,
        graveyardCount:own.zones.graveyard.length,openingDecisionAvailable:own.mulliganAvailable===true},
      opponent:{handCount:opponent.zones.hand.length,deckCount:opponent.zones.deck.length,
        openingDone:opponent.mulliganDone===true},
      battlefield:state.phase==='BATTLEFIELD_READY'
        ? projectOfficialBattlefield(state.battlefield) : null};
  }
});
