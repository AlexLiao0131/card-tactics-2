/**
 * Optional read-only transport boundary for full 3D PvP.
 * Never expose server state, opponent hand, random seeds, or authority receipts.
 * Snapshot is derived ONLY from official BattlePresentationController.
 * Worker transmits this only when explicitly opted into internal tactical tests.
 * Do not enable the transport publicly until full PvP is verified.
 */
import {projectCanonicalRendererSnapshot} from './pvp-headless-presentation.mjs';
import {BATTLE_AUTHORITY_SCHEMA} from './battle-authority.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
export function rendererEnvelopeForSeat({session,seat,matchId}={}){
  if(!session||session.schema!==BATTLE_AUTHORITY_SCHEMA||
     !Number.isSafeInteger(session.revision)||session.revision<0||
     ![0,1].includes(seat)||typeof matchId!=='string'||!matchId)
    throw new PvpCommandError('INVALID_RENDER_SESSION');
  // The official presentation engine may normalize facing/mana while reading.
  // A seat projection must NEVER mutate the durable authority's draft state.
  const snapshot=projectCanonicalRendererSnapshot(structuredClone(session.state),seat,session.revision);
  return {type:'PVP_RENDER_SNAPSHOT',seat,matchId,
    revision:session.revision,snapshot};
}
