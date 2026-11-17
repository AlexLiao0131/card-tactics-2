import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const combatSource=source('../../js/combat-contact-rules.js');
const resolutionSource=source('../../js/battle-resolution.js');
const localSource=source('../../js/tactical-game.js');
const pvpForecastSource=source('../../js/battle-engagement-forecast.js');
const pvpServerSource=existsSync(new URL('../src/pvp-headless-engagement.mjs',import.meta.url))?source('../src/pvp-headless-engagement.mjs'):null;
const pvpClientSource=existsSync(new URL('../../js/pvp-tactical-ui.js',import.meta.url))?source('../../js/pvp-tactical-ui.js'):null;
const actor={character:{weapons:{staff:{attackType:'MAGIC'},bow:{attackType:'SHOT'}}}};
const magic={attackType:'MAGIC',power:1,weapon:'staff'};
const physical={attackType:'SHOT',power:1,weapon:'bow'};
const sandbox={};
const CombatContactRules=new Function('globalThis',combatSource.replace('export const CombatContactRules=','const CombatContactRules=')+'\nreturn CombatContactRules;')(sandbox);

test('magic remains MAGIC and can use the same active evade as physical attacks',()=>{
  assert.equal(CombatContactRules.isPureMagic(actor,magic),true);
  assert.equal(CombatContactRules.canActiveEvade(actor,magic),true);
  assert.equal(CombatContactRules.canActiveEvade(actor,physical),true);
  assert.equal(CombatContactRules.canActiveEvade(actor,{attackType:'INHERIT',weapon:'staff',power:1}),true);
});

test('shared BattleResolution offers active EVADE instead of excluding MAGIC',()=>{
  assert.match(resolutionSource,/choices:\["COUNTER","DEFENSE",\.\.\.\(CombatContactRules\.canActiveEvade\(attacker,attackSkill\)\?/);
  assert.match(resolutionSource,/\(c\.reaction\?\.type==="EVADE"\|\|evasiveCounter\)&&CombatContactRules\.canActiveEvade/);
});

test('canonical combat no longer forces a hit only because attack is MAGIC',()=>{
  assert.match(resolutionSource,/forceHit:opt\.forceMiss\?false:opt\.forceHit===true/);
  assert.doesNotMatch(resolutionSource,/\|\|CombatContactRules\.isPureMagic\(a,skill\)/);
  assert.match(resolutionSource,/a\.skill\?\.bloodShadow.*forceHit:true/);
});

test('single player / Gemini forecast restores ordinary hit chance for magic',()=>{
  assert.match(localSource,/const guaranteed=normal\.guaranteedHit===true;/);
  assert.match(localSource,/const evadeFull=pct\(Math\.max\(0,normal\.hc-20\)\);/);
  assert.match(localSource,/const actual=hit;/);
  assert.doesNotMatch(localSource,/isPureMagic\?\.\(attacker,resolved\)\?100:hit/);
});

test('PVP forecast also uses official hit and evade chance rather than MAGIC=100%',()=>{
  assert.match(pvpForecastSource,/const guaranteed=normal\.guaranteedHit===true;/);
  assert.match(pvpForecastSource,/const evadeFull=pct\(Math\.max\(0,normal\.hc-20\)\);/);
  assert.match(pvpForecastSource,/const evadeGraze=pct\(/);
  assert.match(pvpForecastSource,/const evadeMiss=pct\(/);
});

test('PVP server derives permitted EVADE from shared canonical resolution',{skip:!pvpServerSource},()=>{
  assert.match(pvpServerSource,/resolution\.prepareSingleTargetReaction\(\{defender,attacker,attackSkill,/);
  assert.match(pvpServerSource,/prep\.choices\.includes\('EVADE'\)\?\['EVADE'\]/);
  assert.match(pvpServerSource,/if\(!opt\.choices\.includes\('EVADE'\)\)fail\('ILLEGAL_EVADE_REACTION'\)/);
});

test('PVP client displays the server-authorized EVADE and submits REACT_ATTACK',{skip:!pvpClientSource},()=>{
  assert.match(pvpClientSource,/add\('REACTION_EVADE','迴避',!choices\.includes\('EVADE'\)\)/);
  assert.match(pvpClientSource,/if\(id==='REACTION_EVADE'\)command\.reaction='EVADE'/);
  assert.match(pvpClientSource,/const command=\{type:'REACT_ATTACK'\}/);
});
