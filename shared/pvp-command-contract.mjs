/**
 * Card Tactics 2.0 - platform-neutral PvP command envelope.
 * Transport data only. Gameplay legality and outcomes belong exclusively to
 * the canonical server GameCore, not the client or this envelope validator.
 */
export const PVP_COMMAND_PROTOCOL = 'ct2-command-v1';
const RESERVED_RESULT_KEYS = new Set([
  'state', 'snapshot', 'result', 'results', 'events',
  'random', 'rng', 'damage', 'hitRoll', 'critRoll', 'seat', 'actorSeat'
]);

export class PvpCommandError extends Error {
  constructor(code) { super(code); this.name = 'PvpCommandError'; this.code = code; }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertClientInput(value, depth = 0) {
  if (depth > 20) throw new PvpCommandError('COMMAND_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertClientInput(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw new PvpCommandError('BAD_COMMAND_VALUE');
  for (const [key, item] of Object.entries(value)) {
    if (RESERVED_RESULT_KEYS.has(key)) throw new PvpCommandError('CLIENT_RESULT_FORBIDDEN');
    assertClientInput(item, depth + 1);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateCommandEnvelope(envelope) {
  if (!isPlainObject(envelope)) throw new PvpCommandError('BAD_ENVELOPE');
  if (Object.keys(envelope).sort().join('|') !== 'action|baseRevision|commandId|protocol') {
    throw new PvpCommandError('BAD_ENVELOPE_FIELDS');
  }
  if (envelope.protocol !== PVP_COMMAND_PROTOCOL) throw new PvpCommandError('PROTOCOL_MISMATCH');
  if (typeof envelope.commandId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(envelope.commandId)) {
    throw new PvpCommandError('BAD_COMMAND_ID');
  }
  if (!Number.isSafeInteger(envelope.baseRevision) || envelope.baseRevision < 0) {
    throw new PvpCommandError('BAD_REVISION');
  }
  const action = envelope.action;
  if (!isPlainObject(action) || typeof action.type !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(action.type)) {
    throw new PvpCommandError('BAD_ACTION_TYPE');
  }
  assertClientInput(action);
  // Prevent clients from supplying an outcome, authoritative state or random dice.
  return Object.freeze({
    protocol: envelope.protocol,
    commandId: envelope.commandId,
    baseRevision: envelope.baseRevision,
    action: structuredClone(action),
    fingerprint: stableStringify({baseRevision:envelope.baseRevision, action})
  });
}
