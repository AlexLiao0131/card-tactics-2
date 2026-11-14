import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LiviaDualityEngine as L} from '../../js/livia-duality-engine.js';

const grid=()=>({tiles:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:'PLAIN',elevation:0}))});

test('a distortion cast in round 5 remains through two COMPLETE later rounds',()=>{
  const map=grid();
  const count=L.createDistortion(map,'P',[{x:2,y:2}],5);
  assert.equal(count,1);
  assert.equal(map.spatialDistortions[0].fromRound,5);
  assert.equal(map.spatialDistortions[0].expireRound,8);
  for(const round of [5,6,7]){
    L.onRoundStart({map,units:[],round,random:()=>.99});
    assert.equal(map.spatialDistortions.length,1,`round ${round} retains the field`);
  }
  L.onRoundStart({map,units:[],round:8,random:()=>.99});
  assert.equal(map.spatialDistortions.length,0,'expires at start of round 8');
});

test('the spatial distortion round boundary is exclusive and shared by contact tests',()=>{
  const map=grid();
  L.createDistortion(map,'P',[{x:2,y:2}],5);
  const enemy=()=>({id:'enemy',alive:true,team:'E',character:{id:'enemy'},x:2,y:2});
  const friend=()=>({id:'friend',alive:true,team:'P',character:{id:'friend'},x:2,y:2});
  globalThis.TacticalEngine={
    tile:(world,x,y)=>world.tiles.find(t=>t.x===x&&t.y===y)||null,
    canOccupyTerrain:()=>true,isBlockedByObject:()=>false,canTraverseElevation:()=>true
  };
  // At round N+2 the field still redirects a legally landing enemy.
  const e=enemy();
  assert.equal(L.onEnterTile(map,[],e,7,{random:()=>0}).distorted,true);
  assert.notDeepEqual([e.x,e.y],[2,2]);
  assert.equal(L.onEnterTile(map,[],friend(),7,{random:()=>0}).distorted,false);
  assert.equal(map.spatialDistortions[0].expireRound>7,true);
  // At round N+3 the same entry no longer has a field to trigger.
  assert.equal(L.onEnterTile(map,[],enemy(),8,{random:()=>0}).distorted,false);
});

test("the HUD's live width fills purple from the RIGHT over solid blue",()=>{
  const css=fs.readFileSync(new URL('../../css/unit-hud.css',import.meta.url),'utf8');
  const track=css.match(/\[data-resource="duality"\] \.unit-hud-track \{([^}]+)\}/)?.[1]||'';
  const fill=css.match(/\[data-resource="duality"\] \.unit-hud-fill \{([^}]+)\}/)?.[1]||'';
  assert.match(track,/background:#2459df/);
  assert.doesNotMatch(track,/linear-gradient/);
  assert.match(fill,/background:#8429c8/);
  assert.match(fill,/right:0/);
  assert.match(fill,/left:auto/);
  const purpleWidthFor=value=>Math.max(0,Math.min(100,value));
  for(const [value,blue,purple] of [[0,100,0],[50,50,50],[100,0,100]]){
    assert.equal(purpleWidthFor(value),purple);
    assert.equal(100-purpleWidthFor(value),blue);
  }
});
