import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Regression guard: PvP must render in the ONE original Card Tactics game.
// This file adds no game logic, UI, skill values, or simulated battlefield.
const source=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('one original Babylon canvas and one native battle screen across all modes',()=>{
  const html=source('index.html');
  assert.deepEqual([...html.matchAll(/<canvas\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]),['battleCanvas']);
  const ids=['battleScreen','skillBar','cardPhasePanel','deckScreen','preparationScreen',
    'pvpRoomScreen','battleCanvas','turnStatus','playerCoreHp','enemyCoreHp'];
  for(const id of ids)assert.equal([...html.matchAll(new RegExp(`\\bid="${id}"`,'g'))].length,1,`${id} must be exactly one native element`);
  assert.doesNotMatch(html,/id="(?:pvpTacticalPanel|pvp3dCanvas|battlefieldCanvas|alternateBattleCanvas)"/);
  assert.doesNotMatch(html,/<iframe\b/i);
});

test('PvP lobby and controller reuse original renderer and skill menu, never create a separate battlefield',()=>{
  const main=source('js/main.js');
  const lobby=source('js/pvp-lobby.js');
  const tactical=source('js/pvp-tactical-ui.js');
  assert.match(main,/new PvpLobbyController\(\{shell,createSharedRenderer:sharedBattleRenderer,cardUI,battleUI,unitControlUI\}\)/);
  assert.match(main,/renderer=new BabylonRenderer\(canvas,snapshot,/);
  assert.match(lobby,/root:\$\('skillBar'\),canvas:\$\('battleCanvas'\),seat/);
  assert.match(tactical,/new BattleCommandMenuUI\(root\)/);
  assert.match(tactical,/root\.id!=='skillBar'/);
  assert.doesNotMatch(tactical,/document\.createElement\(\s*['"]canvas['"]\s*\)|new BABYLON\.Engine\(/);
  assert.doesNotMatch(lobby,/document\.createElement\(\s*['"]canvas['"]\s*\)|new BABYLON\.Engine\(/);
});

test('original offline and Gemini battle entry remain in ShellUI, with no invented PvP end-turn dialog',()=>{
  const shell=source('js/shell-ui.js');
  const pvp=source('js/pvp-tactical-ui.js');
  assert.match(shell,/this\.runtime\.prepareGeminiMatch\(\)/);
  assert.match(shell,/this\.runtime\.resetBattle\(\)/);
  assert.match(shell,/this\.pvp\?\.suspendForLocalBattle\(\)/);
  assert.match(shell,/this\.pvp\?\.isBattleActive\(\)\?this\.pvp\.backToLobby\(\)/);
  assert.doesNotMatch(pvp,/\b(?:window\.)?confirm\s*\(/);
});

test('legacy multiplayer address only redirects to the original app, not a new PVP site',()=>{
  const legacy=source('multiplayer.html');
  assert.match(legacy,/new URL\('\.\/index\.html',location\.href\)/);
  assert.match(legacy,/location\.replace\(to\.href\)/);
  assert.doesNotMatch(legacy,/<canvas|<iframe|new BABYLON|pvp-lobby\.js|battlefieldCanvas/i);
});
