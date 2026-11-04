import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {projectCanonicalRendererSnapshot} from '../src/pvp-headless-presentation.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand} from '../src/pvp-headless-tactical.mjs';

const deck=Array(20).fill('imperial_swordsman_card');
function gameAtMap(seed=4451){
 let game=createOpeningGame({decks:[deck,deck],serverSeed:seed});
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:0}).state;
 game=openingGameCore.reduce(game,{type:'KEEP_OPENING_HAND'},{seat:1}).state;
 return game;
}
test('official BattlePresentationController creates BabylonRenderer snapshots without browser objects',()=>{
 assert.equal(typeof globalThis.window,'undefined');
 const game=gameAtMap();
 const s=projectCanonicalRendererSnapshot(game,0,34);
 assert.equal(s.revision,34);
 assert.equal(s.map.tiles.length,game.battlefield.map.tiles.length);
 assert.equal(s.cores.length,2);
 assert.equal(s.presentation.deploymentPoints.length,5);
 assert.equal(s.map.width,game.battlefield.map.width);
 assert.equal(s.presentation.enemyHandCount,5);
 assert.ok(s.map.tiles.every(t=>Number.isFinite(t.elevation)));
 assert.ok(s.presentation.environment.weather);
 assert.doesNotThrow(()=>structuredClone(s));
 assert.equal('zones' in s,false);
 assert.equal('randomState' in s,false);
 assert.equal('serverMapSeed' in s,false);
});
test('seat-specific official renderer snapshot shares authoritative map but not opponent private deck',()=>{
 const game=gameAtMap();
 const a=projectCanonicalRendererSnapshot(game,0,1),b=projectCanonicalRendererSnapshot(game,1,1);
 assert.deepEqual(a.map.tiles.map(t=>[t.x,t.y,t.terrain,t.elevation]),
   b.map.tiles.map(t=>[t.x,t.y,t.terrain,t.elevation]));
 assert.equal(JSON.stringify(a).includes('imperial_swordsman_card'),false);
 assert.equal(JSON.stringify(b).includes('imperial_swordsman_card'),false);
 assert.equal(a.presentation.enemyHandCount,5);
 assert.equal(b.presentation.enemyHandCount,5);
});
test('official viewer-specific presentation hides distant stealthed enemies from Babylon unit meshes',()=>{
 const game=gameAtMap();beginCanonicalPlayerCardPhase(game);
 const player=game.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',...player},0);
 resolveCanonicalPlayerCommand(game,{type:'END_CARD_PHASE'},0);
 resolveCanonicalPlayerCommand(game,{type:'END_TACTICAL_PHASE'},0);
 const enemy=game.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
 resolveCanonicalPlayerCommand(game,{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',...enemy},1);
 const left=game.units[0],right=game.units[1];
 withCanonicalEngines(game,engine=>engine.effect.applyStealth(left,{detectionRange:1,source:left}));
 const own=projectCanonicalRendererSnapshot(game,0);
 const hostile=projectCanonicalRendererSnapshot(game,1);
 assert.ok(own.units.some(u=>u.id===left.id));
 assert.ok(hostile.units.some(u=>u.id===right.id));
 assert.equal(hostile.units.some(u=>u.id===left.id),false);
});
