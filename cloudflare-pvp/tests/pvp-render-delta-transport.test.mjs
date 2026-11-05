import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderUpdate,applyRenderUpdate} from '../../js/pvp-render-delta.js';
import {readFileSync} from 'node:fs';

const frame=(seat=0,revision=1,size=20)=>({
  type:'PVP_RENDER_SNAPSHOT',matchId:'ABCDEFGH',seat,revision,
  snapshot:{revision,phase:'PLAYER_TACTICAL_PHASE',round:2,mode:'command',
    map:{id:'map',width:size,height:size,
      objects:[{id:'tree',x:0,y:3,destroyed:false}],
      tiles:Array.from({length:size*size},(_,index)=>({
        x:index%size,y:Math.floor(index/size),terrain:'PLAIN',elevation:0,
        waterDepth:0,soilMoisture:0,river:false,
        effectDetails:[],effects:[],fogged:false,
        atmosphericVisible:seat===0,reachability:false}))},
    units:[{id:'unit1',team:seat===0?'PLAYER':'ENEMY',x:2,y:2,hp:100,mp:20}],
    cores:[{id:'coreA',hp:600},{id:'coreB',hp:600}],
    presentation:{enemyHandCount:5,enemyDeckCount:15,
      environment:{weather:'CLEAR',lightSources:[]},deploymentPoints:[]}}
});

const nextFrame=(previous)=>{const updated=structuredClone(previous);updated.revision++;
  updated.snapshot.revision=updated.revision;return updated;};

test('one movement revision sends small delta, full reconstruction matches official presentation exactly',()=>{
 const initial=frame(0,4),updated=nextFrame(initial);
 updated.snapshot.units[0].x=3;updated.snapshot.map.tiles[33].waterDepth=0.25;
 const delta=createRenderUpdate(initial,updated);
 assert.equal(delta.type,'PVP_RENDER_DELTA');
 assert.equal(delta.baseRevision,4);
 assert.equal(delta.delta.tiles.length,1);
 assert.equal(delta.delta.tiles[0][0],33);
 assert.deepEqual(applyRenderUpdate(initial,delta),updated);
 assert.ok(JSON.stringify(delta).length<JSON.stringify(updated).length*0.15);
});

test('unchanged terrain and map objects are not sent for unit-only operation',()=>{
 const initial=frame(),updated=nextFrame(initial);updated.snapshot.units[0].hp=91;
 const packet=createRenderUpdate(initial,updated);
 assert.equal(packet.type,'PVP_RENDER_DELTA');
 assert.equal(packet.delta.tiles,undefined);
 assert.equal(packet.delta.mapMeta,undefined);
 assert.equal(packet.delta.presentation,undefined);
 assert.deepEqual(applyRenderUpdate(initial,packet),updated);
});

test('destroyed object and atmosphere/light changes are preserved independently',()=>{
 const initial=frame(),updated=nextFrame(initial);
 updated.snapshot.map.objects[0].destroyed=true;
 updated.snapshot.presentation.environment.weather='THUNDERSTORM';
 updated.snapshot.presentation.environment.lightSources.push({x:5,y:5,color:'orange'});
 const packet=createRenderUpdate(initial,updated);
 assert.equal(packet.type,'PVP_RENDER_DELTA');
 assert.ok(packet.delta.mapMeta);
 assert.ok(packet.delta.presentation);
 assert.deepEqual(applyRenderUpdate(initial,packet),updated);
});

test('different seat presentation never mixes baselines or hidden intelligence',()=>{
 const alice=frame(0,7),bob=frame(1,7),bobNext=nextFrame(bob);
 bobNext.snapshot.units=[];bobNext.snapshot.presentation.enemyHandCount=6;
 const packet=createRenderUpdate(bob,bobNext);
 assert.throws(()=>applyRenderUpdate(alice,packet),/BASELINE_MISMATCH/);
 assert.deepEqual(applyRenderUpdate(bob,packet),bobNext);
 assert.deepEqual(alice,frame(0,7));
});

test('lost revision or stale room rejects deltas and requires a fresh full baseline',()=>{
 const base=frame(0,3),rev4=nextFrame(base),rev5=nextFrame(rev4);
 rev4.snapshot.units[0].hp=92;rev5.snapshot.units[0].hp=84;
 const delta=createRenderUpdate(rev4,rev5);
 assert.throws(()=>applyRenderUpdate(base,delta),/BASELINE_MISMATCH/);
 const other=structuredClone(rev5);other.matchId='ZZZZZZZZ';
 assert.throws(()=>applyRenderUpdate(other,delta),/BASELINE_MISMATCH/);
 assert.deepEqual(applyRenderUpdate(base,rev5),rev5);
});

test('geometry change, missing baseline, or expensive patch falls back to full',()=>{
 const base=frame(0,2,5),changed=nextFrame(base);
 changed.snapshot.map.tiles=changed.snapshot.map.tiles.slice(1);
 assert.equal(createRenderUpdate(base,changed).type,'PVP_RENDER_SNAPSHOT');
 assert.equal(createRenderUpdate(null,changed).type,'PVP_RENDER_SNAPSHOT');
 const other=nextFrame(base);for(const tile of other.snapshot.map.tiles)tile.waterDepth=1;
 assert.equal(createRenderUpdate(base,other).type,'PVP_RENDER_SNAPSHOT');
});

test('invalid or forged tile patch cannot corrupt cached renderer state',()=>{
 const base=frame(),next=nextFrame(base);next.snapshot.map.tiles[3].waterDepth=2;
 const delta=createRenderUpdate(base,next);
 const forged=structuredClone(delta);forged.delta.tiles[0][1].x=99;
 assert.throws(()=>applyRenderUpdate(base,forged),/TILES_INVALID/);
 const poisoned=structuredClone(delta);poisoned.delta.tiles.push([3,{...next.snapshot.map.tiles[3]}]);
 assert.throws(()=>applyRenderUpdate(base,poisoned),/TILES_INVALID/);
 assert.equal(base.snapshot.map.tiles[3].waterDepth,0);
});

test('client reconstructed render data and server baseline are not modified in place',()=>{
 const initial=frame(),updated=nextFrame(initial);updated.snapshot.units[0].hp=33;
 const packet=createRenderUpdate(initial,updated);
 const output=applyRenderUpdate(initial,packet);
 output.snapshot.units[0].hp=1;
 assert.equal(initial.snapshot.units[0].hp,100);
 assert.equal(updated.snapshot.units[0].hp,33);
 assert.equal(packet.delta.units[0].hp,33);
});

test('Worker and native client share codec; initial/reconnect recovery never permits local damage guesses',()=>{
 const worker=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8');
 const lobby=readFileSync(new URL('../../js/pvp-lobby.js',import.meta.url),'utf8');
 assert.match(worker,/createRenderUpdate\(previous,full\)/);
 assert.match(worker,/renderBaselines=new WeakMap/);
 assert.match(worker,/REQUEST_RENDER_SNAPSHOT/);
 assert.match(worker,/this\.renderBaselines\.delete\(ws\)/);
 assert.match(lobby,/applyRenderUpdate\(this\.renderBaseline,packet\)/);
 assert.match(lobby,/REQUEST_RENDER_SNAPSHOT/);
 assert.match(lobby,/this\.renderBaseline=null/);
 assert.doesNotMatch(lobby,/applyDamage|calculateDamage|random\(/);
});
