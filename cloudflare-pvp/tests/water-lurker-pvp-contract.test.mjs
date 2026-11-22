import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const tac=load('../src/pvp-headless-tactical.mjs');
const turns=load('../src/pvp-headless-turns.mjs');
const neutral=load('../../js/neutral-actor-engine.js');
const monster=load('../../js/monster-database.js');
const presentation=load('../../js/battle-presentation-controller.js');
test('PVP 使用既有 EncounterEngine 水域生態生成，不用客戶端偽造四格怪物',()=>{
  assert.match(tac,/EncounterEngine\.spawnInitial\(ecology/);
  assert.match(tac,/MonsterDatabase\.forCharacter\(action\.characterId\)/);
  assert.match(tac,/TacticalEngine\.occupiedCells\(created\)/);
  assert.match(tac,/created\.footprint=\{\.\.\.monster\.footprint\}/);
});
test('PVP 中立回合依現有動作與正式 BattleResolution 執行並標記每回合僅一次',()=>{
  assert.match(tac,/NeutralActorEngine\.availableActors\(game\.units,game\.round\)/);
  assert.match(tac,/NeutralActorEngine\.markActed\(neutral,game\.round\)/);
  assert.match(tac,/engine\.battleResolution\.resolve\(/);
  assert.match(neutral,/neutralActionRound!==round/);
  assert.match(turns,/MonsterDatabase\.get\(u\.monsterId\)&&u\.neutralActionRound===game\.round/);
});
test('PVP 只允許註冊中立怪，未知中立來源仍拒絕跨回合',()=>{
  assert.match(tac,/if\(team==='N'&&!monster\)fail\('CANONICAL_NEUTRAL_ACTOR_TURN_REQUIRED'\)/);
  assert.match(turns,/fail\('UNSUPPORTED_CROSS_ROUND_MECHANIC'\)/);
  assert.match(monster,/globalThis\.HydrologyEngine/);
  assert.doesNotMatch(monster,/window\.HydrologyEngine/);
});
test('單機投影提供 footprint，所有可點選格與顯示共用正式 unit ID',()=>{
  assert.match(presentation,/footprint:globalThis\.TacticalEngine\?\.footprintOf/);
  assert.match(presentation,/globalThis\.TacticalEngine\?\.occupiesCell/);
});
