import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {createBattleAreaFieldEngine,createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';

// Original canonical source fragment extracted from GitHub blob
// 606ecc8dc1c6bd59dc4970ce417f2ef3bf9db885. Its immutable test-only
// fixture is checked into this repo, not read from an untracked ROLLBACK_MAIN.
const source=new URL('./fixtures/original-sanctuaryTiles-606ecc8d.txt',import.meta.url);
const originalSource=fs.readFileSync(source,'utf8');
assert.equal(crypto.createHash('sha256').update(originalSource).digest('hex'),
  '6ae59443c7b550df921b631132b7ff64cbc9991d175761d0a2eafab60933dbf6',
  'canonical original sanctuary flood-fill fixture must not drift');
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
