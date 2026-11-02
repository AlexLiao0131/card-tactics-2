import test from 'node:test';
import assert from 'node:assert/strict';
import {PROTOCOL,normalizeCode,normalizeName,createRoom,joinRoom,seatForToken,setReady,roomView,ROOM_LIFETIME_MS} from '../src/room-model.mjs';

test('room code and name validation',()=>{
  assert.equal(normalizeCode('abcd-efgh'),'ABCDEFGH');
  assert.equal(normalizeCode('ABCD JKL2'),'ABCDJKL2');
  assert.equal(normalizeCode('ABCDOJK2'),null);
  assert.equal(normalizeName('  A   B  '),'A B');
  assert.equal(normalizeName(''), '');
});
test('two seats, readiness and secret never exposed',()=>{
  const room=createRoom({code:'ABCDEFGH',name:'甲',tokenHash:'host-hash',now:10});
  assert.equal(room.expiresAt,10+ROOM_LIFETIME_MS);
  assert.equal(seatForToken(room,'host-hash'),0);
  assert.equal(seatForToken(room,'bad'),-1);
  assert.equal(joinRoom(room,{name:'乙',tokenHash:'guest-hash'}),1);
  assert.throws(()=>joinRoom(room,{name:'三',tokenHash:'third'}),/ROOM_FULL/);
  setReady(room,0,true);setReady(room,1,true);
  const view=roomView(room,[0,1]);
  assert.equal(view.protocol,PROTOCOL);
  assert.equal(view.bothReady,true);
  assert.deepEqual(view.seats.map(s=>s.online),[true,true]);
  assert.equal(JSON.stringify(view).includes('hash'),false);
  assert.equal(roomView(room,[1]).seats[0].online,false);
  setReady(room,0,false);
  assert.equal(roomView(room,[]).bothReady,false);
  assert.throws(()=>setReady(room,1,'true'),/BAD_READY/);
});
