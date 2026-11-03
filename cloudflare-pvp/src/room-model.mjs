/* Card Tactics 2.0 — pure lobby state rules (no browser, sockets or Cloudflare API). */
export const PROTOCOL = 'ct2-lobby-v1';
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
export const ROOM_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeCode(input) {
  const result = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(result) ? result : null;
}
export function normalizeName(input) {
  return String(input ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 24);
}
export function createRoom({ code, name, tokenHash, now }) {
  if (!normalizeCode(code) || !normalizeName(name) || !tokenHash) throw Error('INVALID_CREATE');
  return {
    version: 1, code, createdAt: now, expiresAt: now + ROOM_LIFETIME_MS,
    phase: 'LOBBY',
    seats: [
      { name: normalizeName(name), tokenHash, ready: false, deckSubmitted: false },
      null,
    ],
  };
}
export function joinRoom(room, { name, tokenHash }) {
  if (!room || room.phase !== 'LOBBY') throw Error('NOT_JOINABLE');
  if (room.seats[1]) throw Error('ROOM_FULL');
  if (!normalizeName(name) || !tokenHash) throw Error('INVALID_JOIN');
  room.seats[1] = { name: normalizeName(name), tokenHash, ready: false, deckSubmitted: false };
  room.seats[0].ready = false;
  room.version++;
  return 1;
}
export function seatForToken(room, tokenHash) {
  return room?.seats?.findIndex(s => !!s && s.tokenHash === tokenHash) ?? -1;
}
export function setReady(room, seat, ready) {
  if (!room || room.phase !== 'LOBBY' || ![0, 1].includes(seat) || !room.seats[seat]) throw Error('BAD_SEAT');
  if (typeof ready !== 'boolean') throw Error('BAD_READY');
  // A player cannot declare readiness before the same canonical deck validator
  // has accepted and privately persisted their 20-card deck.
  if (ready && room.seats[seat].deckSubmitted !== true) throw Error('DECK_REQUIRED');
  if (room.seats[seat].ready !== ready) {
    room.seats[seat].ready = ready;
    room.version++;
  }
  return room;
}
/** Only records a public boolean. Never place private card IDs in roomView. */
export function markDeckSubmitted(room, seat) {
  if (!room || room.phase !== 'LOBBY' || ![0, 1].includes(seat) || !room.seats[seat]) throw Error('BAD_SEAT');
  room.seats[seat].deckSubmitted = true;
  // A changed deck invalidates prior ready choices, so neither player can
  // silently switch decks after both have declared ready.
  for (const participant of room.seats) if (participant) participant.ready = false;
  room.version++;
  return room;
}
export function roomView(room, connections = []) {
  return {
    protocol: PROTOCOL, code: room.code, version: room.version, phase: room.phase,
    bothReady: room.seats.every(s => s?.ready === true && s?.deckSubmitted === true),
    // Strictly public lobby-only data; NEVER send secret hashes, decks or enemy hands.
    seats: room.seats.map((seat, i) => seat && ({
      seat: i, name: seat.name, ready: seat.ready,
      deckSubmitted: seat.deckSubmitted === true,
      online: connections.includes(i)
    })),
  };
}
