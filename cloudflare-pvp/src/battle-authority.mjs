/**
 * Card Tactics 2.0 - authoritative battle command host.
 *
 * No new game rules are defined here. A canonical, deterministic, server-safe
 * GameCore is mandatory. Until tactical-game.js is extracted, the production
 * Worker MUST NOT wire this to a client-side simulation or enable battle.
 *
 * Core contract:
 *   activeSeat(state) -> 0 | 1 | null
 *   reduce(stateCopy, action, {seat, revision}) -> {accepted:true,state}
 *   project(state,seat) -> seat-filtered view (no opposing hidden cards/FoW)
 * Core.reduce must perform ALL legality, card, movement, RNG, effects and turn
 * rules; this host solely guarantees ordered, authenticated commands.
 */
import {PVP_COMMAND_PROTOCOL, PvpCommandError, validateCommandEnvelope}
  from '../../shared/pvp-command-contract.mjs';

export const BATTLE_AUTHORITY_SCHEMA = 'ct2-authority-session-v1';
const RECEIPT_HISTORY_LIMIT = 128; // Network retry capacity, not game balance.

function ensureCore(core) {
  if (!core || typeof core.activeSeat !== 'function' ||
      typeof core.reduce !== 'function' || typeof core.project !== 'function') {
    throw new PvpCommandError('CANONICAL_GAME_CORE_REQUIRED');
  }
}
function ensureSeat(seat) {
  if (seat !== 0 && seat !== 1) throw new PvpCommandError('BAD_SEAT');
}
function ensureSession(session) {
  if (!session || session.schema !== BATTLE_AUTHORITY_SCHEMA ||
      !Number.isSafeInteger(session.revision) || session.revision < 0 ||
      !Array.isArray(session.receipts)) throw new PvpCommandError('BAD_AUTHORITY_SESSION');
}

export function createAuthoritySession({initialState, core}) {
  ensureCore(core);
  if (initialState === undefined || initialState === null) {
    throw new PvpCommandError('INITIAL_STATE_REQUIRED');
  }
  const state=structuredClone(initialState);
  for (const seat of [0,1]) core.project(structuredClone(state),seat); // Projections must exist before a match opens.
  return {schema:BATTLE_AUTHORITY_SCHEMA,revision:0,state,receipts:[]};
}

export function projectAuthoritySession(session, seat, core) {
  ensureSession(session); ensureSeat(seat); ensureCore(core);
  const view=core.project(structuredClone(session.state),seat);
  if (view === undefined) throw new PvpCommandError('SEAT_PROJECTION_UNAVAILABLE');
  return {protocol:PVP_COMMAND_PROTOCOL, revision:session.revision, view:structuredClone(view)};
}

/**
 * A transactional Durable Object caller persists `nextSession` ONLY after
 * this function succeeds. A failed/stale/malicious command never mutates the
 * current persisted session. Duplicate command IDs return a receipt, not a
 * second gameplay execution.
 */
export function commitAuthorityCommand({session, seat, envelope, core}) {
  ensureSession(session); ensureSeat(seat); ensureCore(core);
  const incoming=validateCommandEnvelope(envelope);
  const receipt=session.receipts.find(item=>item.seat===seat && item.commandId===incoming.commandId);
  if (receipt) {
    if (receipt.fingerprint !== incoming.fingerprint) throw new PvpCommandError('COMMAND_ID_COLLISION');
    return {nextSession:session, duplicate:true, ack:{commandId:incoming.commandId,
      acceptedRevision:receipt.acceptedRevision, currentRevision:session.revision}};
  }
  if (incoming.baseRevision !== session.revision) throw new PvpCommandError('STALE_REVISION');
  if (core.activeSeat(session.state) !== seat) throw new PvpCommandError('NOT_YOUR_TURN');

  // This is a draft: game core cannot change the durable authoritative state
  // if it throws or rejects an illegal action.
  const draft=structuredClone(session.state);
  const outcome=core.reduce(draft, incoming.action, {seat, revision:session.revision});
  if (!outcome || outcome.accepted !== true || outcome.state === undefined) {
    throw new PvpCommandError('ILLEGAL_GAME_ACTION');
  }
  const revision=session.revision+1;
  const nextSession={...session,revision,state:structuredClone(outcome.state),
    receipts:[...session.receipts,{seat,commandId:incoming.commandId,
      fingerprint:incoming.fingerprint,acceptedRevision:revision}].slice(-RECEIPT_HISTORY_LIMIT)};
  return {nextSession,duplicate:false,ack:{commandId:incoming.commandId,
    acceptedRevision:revision,currentRevision:revision}};
}
