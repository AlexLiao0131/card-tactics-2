/* Cloudflare Workers + SQLite Durable Objects: authenticated lobby, private
 * decks and server-authoritative pre-battle opening hands. All tactical actions
 * remain rejected until the exact canonical tactical engine runs server-side.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  PROTOCOL, normalizeCode, normalizeName, createRoom,
  joinRoom, seatForToken, setReady, markDeckSubmitted, roomView
} from './room-model.mjs';
import { validateOfficialDeck } from './canonical-deck-rules.mjs';
import { createOpeningGame, openingGameCore } from './pvp-match-core.mjs';
import { createAuthoritySession, commitAuthorityCommand, projectAuthoritySession }
  from './battle-authority.mjs';
import { BATTLE_STORAGE_KEY } from './battle-store.mjs';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HEX_SIZE = 32;
const MAX_BODY_BYTES = 2048;
const TICKET_MS = 45_000;
const textEncoder = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
});
const failure = (code, status = 400, headers = {}) => json({ ok: false, error: code }, status, headers);
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(HEX_SIZE)), b => b.toString(16).padStart(2, '0')).join('');
}
function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
async function sha256(raw) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(raw));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function bodyJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw Error('BODY_TOO_LARGE');
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) throw Error('BODY_TOO_LARGE');
  try { return JSON.parse(body); } catch { throw Error('BAD_JSON'); }
}
function bearer(request) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '');
  return match?.[1] || null;
}
function originHeaders(origin, allowed) {
  return origin && origin === allowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  } : { 'Vary': 'Origin' };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = env.APP_ORIGIN || 'https://alexliao0131.github.io';
    const headers = originHeaders(origin, allowed);
    const reject = (code, status=400) => failure(code, status, headers);
    // No CORS wildcard and no cross-site room operation from unknown browser origins.
    if (origin && origin !== allowed) return reject('ORIGIN_FORBIDDEN', 403);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'GET' && path === '/health') return json({ok: true, protocol: PROTOCOL}, 200, headers);
    if (!path.startsWith('/v1/rooms')) return reject('NOT_FOUND', 404);
    try {
      if (request.method === 'POST' && path === '/v1/rooms') {
        const input = await bodyJson(request);
        const name = normalizeName(input.name);
        if (!name) return reject('NAME_REQUIRED');
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = roomCode(), secret = token(), tokenHash = await sha256(secret);
          const stub = env.ROOMS.get(env.ROOMS.idFromName(`ct2:${code}`));
          const response = await stub.fetch('https://room.internal/create', {
            method: 'POST', body: JSON.stringify({code, name, tokenHash})
          });
          if (response.status === 409) continue;
          if (!response.ok) return reject('CREATE_FAILED', 503);
          return json({ok:true, code, token:secret, seat:0, protocol:PROTOCOL}, 201, headers);
        }
        return reject('ROOM_CODE_EXHAUSTED',503);
      }
      const match = /^\/v1\/rooms\/([A-HJ-NP-Z2-9]{8})\/(join|session|ticket|socket|deck|opening)$/.exec(path);
      if (!match) return reject('BAD_ROOM_PATH',404);
      const [, code, operation] = match;
      if (!normalizeCode(code)) return reject('BAD_ROOM_CODE');
      const stub = env.ROOMS.get(env.ROOMS.idFromName(`ct2:${code}`));
      if (operation === 'socket') {
        if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reject('WEBSOCKET_REQUIRED',426);
        const ticket = url.searchParams.get('ticket');
        if (!ticket || !/^[a-f0-9]{64}$/.test(ticket)) return reject('BAD_TICKET',401);
        return stub.fetch(`https://room.internal/socket?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } });
      }
      if (request.method !== 'POST') return reject('METHOD_NOT_ALLOWED',405);
      if (operation === 'join') {
        const input = await bodyJson(request);
        const name = normalizeName(input.name);
        if (!name) return reject('NAME_REQUIRED');
        const secret = token();
        const response = await stub.fetch('https://room.internal/join', {
          method:'POST', body:JSON.stringify({name,tokenHash:await sha256(secret)})
        });
        const result = await response.json();
        if (!response.ok) return json(result, response.status, headers);
        return json({ok:true,code,seat:1,token:secret,protocol:PROTOCOL},200,headers);
      }
      const secret = bearer(request);
      if (!secret) return reject('AUTH_REQUIRED',401);
      const tokenHash = await sha256(secret);
      if (operation === 'session') {
        const response = await stub.fetch('https://room.internal/session',{
          method:'POST',body:JSON.stringify({tokenHash})
        });
        return json(await response.json(),response.status,headers);
      }
      if (operation === 'ticket') {
        const oneTime = token();
        const response = await stub.fetch('https://room.internal/ticket', {
          method:'POST', body:JSON.stringify({tokenHash,ticketHash:await sha256(oneTime)})
        });
        if (!response.ok) return json(await response.json(),response.status,headers);
        return json({ok:true,ticket:oneTime,expiresInMs:TICKET_MS},200,headers);
      }
      if (operation === 'opening') {
        const response = await stub.fetch('https://room.internal/opening', {
          method:'POST',body:JSON.stringify({tokenHash})
        });
        return json(await response.json(),response.status,headers);
      }
      if (operation === 'deck') {
        const input = await bodyJson(request);
        const result = validateOfficialDeck(input?.cards);
        if (!result.valid) return reject(result.error, 400);
        const response = await stub.fetch('https://room.internal/deck', {
          method:'POST',body:JSON.stringify({tokenHash,cards:result.cards})
        });
        return json(await response.json(), response.status, headers);
      }
      return reject('NOT_FOUND',404);
    } catch (err) {
      if (['BAD_JSON','BODY_TOO_LARGE'].includes(err?.message)) return reject(err.message,400);
      return reject('SERVICE_UNAVAILABLE',503);
    }
  }
};

export class PvpRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    const now = Date.now();
    const current = await this.ctx.storage.get('room');
    if (current && current.expiresAt <= now) {
      await this.ctx.storage.deleteAll();
      return failure('ROOM_EXPIRED',410);
    }
    if (path === '/create' && request.method === 'POST') {
      const { code, name, tokenHash } = await request.json();
      let created = null;
      await this.ctx.storage.transaction(async txn => {
        if (await txn.get('room')) return;
        created = createRoom({ code, name, tokenHash, now });
        await txn.put('room', created);
      });
      if (!created) return failure('ROOM_EXISTS',409);
      await this.ctx.storage.setAlarm(created.expiresAt);
      return json({ok:true});
    }
    if (!current) return failure('ROOM_NOT_FOUND',404);
    if (path === '/join' && request.method === 'POST') {
      const {name, tokenHash} = await request.json();
      let latest;
      try {
        await this.ctx.storage.transaction(async txn => {
          latest = await txn.get('room');
          joinRoom(latest,{name,tokenHash});
          await txn.put('room',latest);
        });
      } catch (err) { return failure(err?.message||'JOIN_FAILED',409); }
      this.broadcast(latest);
      return json({ok:true});
    }
    if (path === '/session' && request.method === 'POST') {
      const {tokenHash} = await request.json();
      const seat = seatForToken(current,tokenHash);
      return seat < 0 ? failure('UNAUTHORIZED',401) : json({ok:true, seat, room:this.snapshot(current)});
    }
    if (path === '/opening' && request.method === 'POST') {
      const { tokenHash }=await request.json();
      const seat=seatForToken(current,tokenHash);
      if (seat<0) return failure('UNAUTHORIZED',401);
      const session=await this.ctx.storage.get(BATTLE_STORAGE_KEY);
      if (!session) return failure('OPENING_NOT_STARTED',409);
      return json({ok:true,match:projectAuthoritySession(session,seat,openingGameCore)});
    }
    if (path === '/deck' && request.method === 'POST') {
      const {tokenHash,cards} = await request.json();
      const seat = seatForToken(current,tokenHash);
      if (seat < 0) return failure('UNAUTHORIZED',401);
      // Validate at the Durable Object boundary too, rather than trusting
      // the outer Worker to have performed validation correctly.
      const valid = validateOfficialDeck(cards);
      if (!valid.valid) return failure(valid.error,400);
      let latest, changed=false;
      try {
        await this.ctx.storage.transaction(async txn => {
          latest = await txn.get('room');
          if (!latest || latest.phase !== 'LOBBY' || latest.expiresAt <= Date.now()) throw Error('ROOM_NOT_JOINABLE');
          if (seatForToken(latest,tokenHash) !== seat) throw Error('UNAUTHORIZED');
          const previous = await txn.get(`deck:${seat}`);
          if (Array.isArray(previous) && previous.length === valid.cards.length &&
              previous.every((id,i)=>id===valid.cards[i])) return;
          await txn.put(`deck:${seat}`,valid.cards);
          markDeckSubmitted(latest,seat);
          await txn.put('room',latest);
          changed=true;
        });
      } catch (err) { return failure(err?.message||'DECK_SUBMIT_FAILED',409); }
      if (changed) this.broadcast(latest);
      return json({ok:true,seat,deckSubmitted:true,version:latest.version});
    }
    if (path === '/ticket' && request.method === 'POST') {
      const {tokenHash,ticketHash} = await request.json();
      const seat = seatForToken(current,tokenHash);
      if (seat < 0 || !/^[a-f0-9]{64}$/.test(ticketHash||'')) return failure('UNAUTHORIZED',401);
      await this.ctx.storage.put(`ticket:${seat}`, { ticketHash, expires:now+TICKET_MS });
      return json({ok:true});
    }
    if (path === '/socket' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const ticket = url.searchParams.get('ticket');
      const hash = await sha256(ticket||'');
      let seat = -1;
      for (let i=0;i<2;i++) {
        const t = await this.ctx.storage.get(`ticket:${i}`);
        if (t?.expires > now && t.ticketHash===hash) { seat=i;break; }
      }
      if (seat < 0) return failure('TICKET_INVALID_OR_EXPIRED',401);
      await this.ctx.storage.delete(`ticket:${seat}`);
      for (const prior of this.ctx.getWebSockets()) {
        if (prior.deserializeAttachment()?.seat === seat) prior.close(4001,'RECONNECTED');
      }
      const pair=new WebSocketPair();
      const [client,server]=Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({seat, protocol:PROTOCOL});
      server.send(JSON.stringify({type:'WELCOME',seat,room:this.snapshot(current)}));
      const opening=await this.ctx.storage.get(BATTLE_STORAGE_KEY);
      if (opening) this.sendMatchState(server,opening,seat);
      this.broadcast(current);
      return new Response(null,{status:101,webSocket:client});
    }
    return failure('NOT_FOUND',404);
  }
  snapshot(room) {
    const online = this.ctx.getWebSockets().map(ws=>ws.deserializeAttachment()?.seat).filter(s=>s===0||s===1);
    return roomView(room,online);
  }
  broadcast(room) {
    const data=JSON.stringify({type:'ROOM_STATE',room:this.snapshot(room)});
    for (const socket of this.ctx.getWebSockets()) if (socket.readyState===WebSocket.OPEN) socket.send(data);
  }
  sendMatchState(ws, session, seat) {
    if (ws.readyState!==WebSocket.OPEN || (seat!==0 && seat!==1)) return;
    ws.send(JSON.stringify({type:'MATCH_STATE',
      match:projectAuthoritySession(session,seat,openingGameCore)}));
  }
  broadcastMatchState(session) {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendMatchState(ws,session,ws.deserializeAttachment()?.seat);
    }
  }
  async webSocketMessage(ws, input) {
    if (typeof input !== 'string' || input.length > MAX_BODY_BYTES) {
      ws.send(JSON.stringify({type:'ERROR',error:'BAD_MESSAGE'}));return;
    }
    let action;
    try { action=JSON.parse(input); } catch { ws.send(JSON.stringify({type:'ERROR',error:'BAD_JSON'}));return; }
    if (action.type==='PING') {
      ws.send(JSON.stringify({type:'PONG'}));return;
    }
    const seat=ws.deserializeAttachment()?.seat;
    if (seat!==0 && seat!==1) {
      ws.send(JSON.stringify({type:'ERROR',error:'UNAUTHORIZED'}));return;
    }
    if (action.type==='MATCH_COMMAND') {
      let result,latest;
      try {
        await this.ctx.storage.transaction(async txn => {
          latest=await txn.get('room');
          if (!latest || latest.expiresAt <= Date.now()) throw new PvpCommandError('ROOM_EXPIRED');
          if (!['OPENING_HAND','WAITING_FOR_TACTICAL_ENGINE'].includes(latest.phase)) throw new PvpCommandError('TACTICAL_GAME_CORE_NOT_READY');
          const session=await txn.get(BATTLE_STORAGE_KEY);
          if (!session) throw new PvpCommandError('OPENING_NOT_STARTED');
          result=commitAuthorityCommand({session,seat,envelope:action.envelope,core:openingGameCore});
          if (!result.duplicate) {
            await txn.put(BATTLE_STORAGE_KEY,result.nextSession);
            const phase=result.nextSession.state.phase;
            if (phase!==latest.phase) {latest.phase=phase;latest.version++;await txn.put('room',latest);}
          }
        });
      } catch(err) {
        ws.send(JSON.stringify({type:'ERROR',error:err instanceof PvpCommandError?err.code:'MATCH_COMMAND_FAILED'}));return;
      }
      ws.send(JSON.stringify({type:'MATCH_ACK',...result.ack,duplicate:result.duplicate}));
      if (!result.duplicate) {
        this.broadcastMatchState(result.nextSession);
        if (latest.phase==='WAITING_FOR_TACTICAL_ENGINE') this.broadcast(latest);
      }
      return;
    }
    if (action.type!=='SET_READY') {
      ws.send(JSON.stringify({type:'ERROR',error:'TACTICAL_GAME_CORE_NOT_READY'}));return;
    }
    let latest,opening=null;
    try {
      await this.ctx.storage.transaction(async txn => {
        latest=await txn.get('room');
        if (!latest || latest.expiresAt <= Date.now()) throw Error('ROOM_EXPIRED');
        setReady(latest,seat,action.ready);
        if (latest.seats.every(participant=>participant?.ready===true && participant?.deckSubmitted===true)) {
          const decks=[await txn.get('deck:0'),await txn.get('deck:1')];
          if (!decks.every(Array.isArray)) throw Error('TWO_VALID_DECKS_REQUIRED');
          if (await txn.get(BATTLE_STORAGE_KEY)) throw Error('BATTLE_ALREADY_INITIALIZED');
          const seed=crypto.getRandomValues(new Uint32Array(1))[0];
          opening=createAuthoritySession({
            initialState:createOpeningGame({decks,serverSeed:seed}), core:openingGameCore
          });
          await txn.put(BATTLE_STORAGE_KEY,opening);
          latest.phase='OPENING_HAND';latest.version++;
        }
        await txn.put('room',latest);
      });
    } catch(err) {
      if (err.message==='ROOM_EXPIRED') { ws.close(4002,'ROOM_EXPIRED');return; }
      ws.send(JSON.stringify({type:'ERROR',error:err?.message||'READY_FAILED'}));return;
    }
    this.broadcast(latest);
    if (opening) this.broadcastMatchState(opening);
  }
  async webSocketClose(ws, code, reason) {
    try { ws.close(code,reason); } catch {}
    const room=await this.ctx.storage.get('room');
    if (room) this.broadcast(room);
  }
  async webSocketError(ws) {
    try { ws.close(1011,'SOCKET_ERROR'); } catch {}
    const room=await this.ctx.storage.get('room');
    if (room) this.broadcast(room);
  }
  async alarm() {
    const room=await this.ctx.storage.get('room');
    if (room?.expiresAt>Date.now()) return this.ctx.storage.setAlarm(room.expiresAt);
    for (const socket of this.ctx.getWebSockets()) socket.close(4002,'ROOM_EXPIRED');
    await this.ctx.storage.deleteAll();
  }
}
