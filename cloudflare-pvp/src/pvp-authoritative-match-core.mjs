/**
 * Single authority interface for PvP opening-hand -> tactical gameplay.
 * This is orchestration ONLY: all gameplay rules remain in js/ engines.
 * The tactical branch must not be released until the full skill / UI contract
 * has been completed and tested. Production Worker gates tactical commands.
 */
import { openingGameCore } from './pvp-match-core.mjs';
import { experimentalTacticalCore } from './pvp-headless-tactical.mjs';
import { projectOfficialBattlefield } from './pvp-battlefield.mjs';
import { CardDatabase } from '../../js/card-database.js';
import { ItemInventoryEngine } from '../../js/item-inventory-engine.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import {canonicalWorldForViewer} from './pvp-perception-controller.mjs';

const isOpening = state => state?.phase === 'OPENING_HAND';
const isBattle = state => !!state?.battlefield?.map && Array.isArray(state?.units) &&
  Array.isArray(state?.cards) && state.cards.length === 2;

export const pvpAuthoritativeMatchCore=Object.freeze({
  activeSeat(state) {
    if (isOpening(state)) return openingGameCore.activeSeat(state);
    if (!isBattle(state)) throw new PvpCommandError('CANONICAL_WORLD_REQUIRED');
    return experimentalTacticalCore.activeSeat(state);
  },
  reduce(state,action,{seat,revision}) {
    if (isOpening(state)) return openingGameCore.reduce(state,action,{seat,revision});
    if (!isBattle(state)) throw new PvpCommandError('CANONICAL_WORLD_REQUIRED');
    const result=ItemInventoryEngine.withBattleGroundState(state.battleGroundItems||[],()=>
      experimentalTacticalCore.reduce(state,action,{seat,revision}));
    if(result.result?.accepted===true)result.result.state.battleGroundItems=result.groundItems;
    return result.result;
  },
  project(state,seat) {
    if (isOpening(state)) return openingGameCore.project(state,seat);
    if (!isBattle(state)) throw new PvpCommandError('CANONICAL_WORLD_REQUIRED');
    const view=experimentalTacticalCore.project(state,seat);
    const hand=state.cards[seat].zones.hand;
    const itemConsumptions={};
    const team=seat===0?'P':'E';
    for(const unit of state.units||[]){
      // The original itemConsumptions field is a per-unit audit total.
      // Subtract already-attributed uses before assigning legacy uses to the
      // current team's seat, or a stolen potion would be double-charged.
      if(unit.team===team)for(const [id,count] of Object.entries(unit.itemConsumptions||{})){
        const attributed=['P','E'].reduce((sum,owner)=>
          sum+Number(unit.itemConsumptionsByTeam?.[owner]?.[id]||0),0);
        itemConsumptions[id]=(itemConsumptions[id]||0)+Math.max(0,count-attributed);
      }
      // The preparer's seat pays for a prepared item regardless of which
      // unit ended up using it after theft, transfer or ground pickup.
      for(const [id,count] of Object.entries(unit.itemConsumptionsByTeam?.[team]||{}))
        itemConsumptions[id]=(itemConsumptions[id]||0)+count;
    }
    return {
      ...view,stageId:state.stageId,seat,
      own:{...view.own,itemConsumptions,matchGold:state.matchRewards?.goldByTeam?.[team]||0,
        hand:hand.map(id=>({
        id,name:CardDatabase.get(id)?.name||id,
        cost:CardDatabase.get(id)?.cost??null,
        type:CardDatabase.get(id)?.type||'UNKNOWN'
      })),deckCount:state.cards[seat].zones.deck.length,
      discardCount:state.cards[seat].zones.discard.length,
      graveyardCount:state.cards[seat].zones.graveyard.length},
      opponent:{...view.opponent,deckCount:state.cards[1-seat].zones.deck.length},
      // This is a seat-neutral public battlefield; enemy units are projected
      // separately according to the official visibility engine.
      battlefield:projectOfficialBattlefield(canonicalWorldForViewer(state,seat).battlefield)
    };
  }
});
