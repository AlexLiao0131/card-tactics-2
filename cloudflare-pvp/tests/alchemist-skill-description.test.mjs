import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';

test('the shared skill description shows one ordinary material cost',()=>{
 const s={id:'temporary-alchemy-test',name:'爆炸',category:'MAGIC',alchemyCast:{mode:'BASIC'},
   materialCost:{kind:'MINERAL',quality:'NORMAL',affinity:'NONE',amount:1},range:{min:2,max:4},target:'TILE'};
 const d=SkillDatabase.inspect(s);
 assert.ok(d.mechanics.includes('消耗 普通礦質 ×1'));
});
test('quality includes the inherent element and does not list a second material',()=>{
 const s={id:'temporary-alchemy-test',name:'火焰爆炸',category:'MAGIC',alchemyCast:{mode:'BASIC'},
   materialCost:{kind:'MINERAL',quality:'HIGH',affinity:'FIRE',amount:1},target:'TILE'};
 const d=SkillDatabase.inspect(s);
 assert.ok(d.mechanics.includes('消耗 高品質・FIRE礦質 ×1'));
 assert.ok(!d.mechanics.includes('＋'));
});
test('terrain transmutation describes only the 3/3 rune',()=>{
 const s={id:'temporary-terrain-test',name:'萬象煉成',category:'MAGIC',alchemyCast:{mode:'TERRAIN'},target:'TILE'};
 const d=SkillDatabase.inspect(s);
 assert.ok(d.mechanics.includes('消耗 煉成紋路 3/3'));
});
