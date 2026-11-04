import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {createBattleAreaFieldEngine,createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';

// Compare against the *exact* main version of the original field flood fill.
// This baseline is executable original code, not a hand-written duplicate.
const path=new URL('../../ROLLBACK_MAIN/js/tactical-game.js',import.meta.url);
const content=fs.readFileSync(path,'utf8');
const gitBlob=crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
assert.equal(gitBlob,'606ecc8dc1c6bd59dc4970ce417f2ef3bf9db885','canonical parity baseline must match the GitHub main SHA');
const begin=content.indexOf('  function sanctuaryTiles(center,radius){');
const end=content.indexOf('  // Battle smoke is a stationary terrain field',begin);
assert.ok(begin>0&&end>begin);
const originalSource=content.slice(begin,end);
const original=new Function('TacticalEngine','map','sanctuaryKey',
  `${originalSource}; return sanctuaryTiles;`);
const decks=[Array(20).fill('imperial_swordsman_card'),Array(20).fill('imperial_swordsman_card')];
for(const size of ['SMALL','MEDIUM','LARGE','XLARGE'])test(`new shared sanctuary geometry equals canonical browser field on ${size}`,()=>{
  const {battlefield}=initializeCanonicalWorld({seed:5000,mapSize:size,decks});
  const m=battlefield.map;
  const baseline=original(TacticalEngine,m,(x,y)=>`${x},${y}`);
  const engine=createBattleAreaFieldEngine({state:createBattleAreaFieldState(),map:()=>m,
    units:()=>[],round:()=>1,effect:()=>({}),pushLog:()=>{},handleDefeated:()=>{}});
  const locations=m.tiles.filter((_,i)=>i%Math.max(1,Math.floor(m.tiles.length/70))===0);
  for(const tile of locations)for(const radius of [0,1,2,3,5]){
    const want=baseline(tile,radius).map(t=>`${t.x},${t.y}`);
    const got=engine.sanctuaryTiles(tile,radius).map(t=>`${t.x},${t.y}`);
    assert.deepEqual(got,want,`center ${tile.x},${tile.y} radius ${radius}`);
  }
});
