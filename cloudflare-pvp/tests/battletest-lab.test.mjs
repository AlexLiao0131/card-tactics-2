import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MapDatabase} from '../../js/map-database.js';
import {LAB_WIDTH,LAB_HEIGHT,LAB_MAP_ID,LAB_STAGE_ID,regionAt,makeBattleTestMap,makeBattleTestStage,registerBattleTestArena} from '../../js/battletest-arena.js';

test('arena covers every one of 280 cells with a single rectangular region',()=>{
  const map=makeBattleTestMap();
  assert.equal(map.width,LAB_WIDTH);assert.equal(map.height,LAB_HEIGHT);
  assert.equal(map.tiles,undefined);assert.equal(map.terrain.length,LAB_WIDTH*LAB_HEIGHT);
  const xy=new Set(map.terrain.map(t=>`${t.x},${t.y}`));assert.equal(xy.size,LAB_WIDTH*LAB_HEIGHT);
  for(const cell of map.terrain){const r=regionAt(cell.x,cell.y);assert.ok(r);assert.equal(cell.terrain,r.terrain);}
  assert.equal(regionAt(-1,0),null);assert.equal(regionAt(0,LAB_HEIGHT),null);
});
test('official water tiles have genuine hydrology depth and a consistent top surface',()=>{
  const map=makeBattleTestMap();
  const water=map.terrain.filter(t=>t.terrain==='WATER');
  assert.equal(water.length,50);
  for(const tile of water){assert.ok(tile.waterDepth>0);assert.equal(tile.elevation+tile.waterDepth,0);}
  const shallow=map.terrain.filter(t=>t.x>=5&&t.x<=9&&t.y>=4&&t.y<=8);
  const deep=map.terrain.filter(t=>t.x>=10&&t.x<=14&&t.y>=4&&t.y<=8);
  assert.ok(shallow.every(t=>t.waterDepth===.45));assert.ok(deep.every(t=>t.waterDepth===2.2));
});
test('fixture inserts one new map and stage without mutating production data',()=>{
  const maps={existing:{id:'existing'}},stages={existing:{id:'existing'}};
  const before=JSON.stringify({maps,stages});const reg=registerBattleTestArena(maps,stages);
  assert.deepEqual(reg,{mapId:LAB_MAP_ID,stageId:LAB_STAGE_ID});
  assert.equal(maps.existing.id,'existing');assert.equal(stages.existing.id,'existing');
  assert.equal(stages[LAB_STAGE_ID].mapId,LAB_MAP_ID);
  assert.deepEqual(stages[LAB_STAGE_ID].playerSpawns,[]);
  assert.deepEqual(stages[LAB_STAGE_ID].enemySpawns,[]);
  assert.equal(stages[LAB_STAGE_ID].scriptId,null);
  assert.throws(()=>registerBattleTestArena(maps,stages),/COLLISION/);
});
test('lab page loads the official main and dedicated test UI, not another renderer',()=>{
  const html=readFileSync(new URL('../../battletestindex.html',import.meta.url),'utf8');
  const lab=readFileSync(new URL('../../js/battletest-lab.js',import.meta.url),'utf8');
  assert.match(html,/src="\.\/js\/main\.js"/);assert.match(html,/src="\.\/js\/battletest-lab\.js/);
  assert.deepEqual([...html.matchAll(/<canvas\b[^>]*id="([^"]+)"/g)].map(x=>x[1]),['battleCanvas']);
  assert.match(lab,/game\.debug\.spawnCharacterCard\(/);
  assert.match(lab,/game\.debug\.moveUnit\(/);
  assert.match(lab,/game\.debug\.setWeather\(/);
  assert.match(lab,/game\.debug\.advanceEnvironmentTurns\(/);
  assert.doesNotMatch(lab,/new BABYLON\.Engine|new BabylonRenderer|BattleEngine\.calculate/);
});

test('original MapDatabase.createMap consumes the new rectangular fixture unchanged',()=>{
  const stages={};
  registerBattleTestArena(globalThis.MAPS,stages);
  const map=MapDatabase.createMap(LAB_MAP_ID);
  assert.equal(map.tiles.length,LAB_WIDTH*LAB_HEIGHT);
  assert.equal(map.objects.length,0,'no authored props or cores');
  assert.equal(map.tiles.find(t=>t.x===7&&t.y===6).waterDepth,.45);
  assert.equal(map.tiles.find(t=>t.x===12&&t.y===6).waterDepth,2.2);
  assert.equal(map.tiles.find(t=>t.x===17&&t.y===1).terrain,'WALL');
  assert.equal(stages[LAB_STAGE_ID].battleDeck.length,0);
});
