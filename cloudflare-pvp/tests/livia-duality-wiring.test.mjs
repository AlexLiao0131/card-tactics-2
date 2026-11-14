import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
test('offline/PvP authoritative tile-entry callback consumes wells and spatial anomaly exactly once',()=>{
 const a=src('js/tactical-game.js'),p=src('cloudflare-pvp/src/pvp-headless-tactical.mjs');
 assert.match(a,/function stageEvent\(event\)[\s\S]*?LiviaDualityEngine\?\.handleEntry/);
 assert.match(p,/const stageEvent=event=>[\s\S]*?LiviaDualityEngine\.handleEntry/);
 assert.match(a,/function traverseUnitPath\([\s\S]*?duality\?\.beginMove/);
 assert.match(p,/LiviaDualityEngine\.beginMove\(unit\)/);
 assert.match(p,/SPACE_DISTORTION/);
});
test('both game modes use official skill mutation at actual commit, never on aim/cancel',()=>{
 const a=src('js/unit-runtime-engine.js'),p=src('cloudflare-pvp/src/pvp-headless-engagement.mjs'),t=src('js/tactical-game.js');
 assert.match(a,/function consumeSkill\([\s\S]*?LiviaDualityEngine\.afterCommittedSkill/);
 assert.match(a,/function skillForUnit\([\s\S]*?LiviaDualityEngine\.transformedSkill/);
 assert.match(p,/SkillDatabase\.list\(ids\)\.map\(s=>globalThis\.UnitRuntimeEngine\?\.skillForUnit/);
 assert.match(t,/const allSkills=SkillDatabase\.list\([\s\S]*?\.map\(s=>UnitRuntimeEngine\.skillForUnit/);
});
test('purified ultimate is one official cast, official target-by-target resolution, then resource reset',()=>{
 const a=src('js/tactical-action-controller.js');
 assert.match(a,/function executeLiviaPurifiedSlash\(/);
 assert.match(a,/const spent=ctx\.consumeSkill\(attacker,skill\)/);
 assert.match(a,/BattleResolution\.resolve\(\{map,units,environmentState,initiator:attacker/);
 assert.match(a,/duality\.createDistortion/);
 assert.match(a,/duality\.resetBlueAfterUltimate/);
});
test('berserk executes via official battle engines, includes player defense offline and autonomous PvP defense',()=>{
 const a=src('js/tactical-game.js'),p=src('cloudflare-pvp/src/pvp-headless-tactical.mjs');
 assert.match(a,/pendingBerserkResume=processNext/);
 assert.match(a,/BattleResolution\.resolve/);
 assert.match(p,/chooseAutonomousBattleReaction/);
 assert.match(p,/engine\.battleResolution\.resolve/);
 assert.match(p,/onRoundStart:round=>LiviaDualityEngine\.onRoundStart/);
 assert.doesNotMatch(p,/LiviaDualityEngine\.completeBerserk\(u\)/);
 const turns=src('cloudflare-pvp/src/pvp-headless-turns.mjs');
 assert.match(turns,/u\._liviaBerserkEndRound/);
});
test('opponent cannot access hidden mana-well pins from filtered public snapshot',()=>{
 const a=src('js/battle-presentation-controller.js');
 assert.match(a,/manaWell:\(s\.map\.manaWells\|\|\[\]\)\.some\(w=>w\.x===tile\.x&&w\.y===tile\.y&&w\.team===viewerTeam\)/);
 assert.match(a,/spatialDistortion:/);
});
test('magic cloak is an official damage-layer rule with explicit unresistable exception',()=>{
 const a=src('js/effect-engine.js'),b=src('js/battle-resolution.js');
 assert.match(a,/function applyDamage\(target,amount,\{[^\n]*unresistable=false/);
 assert.match(a,/LiviaDualityEngine\?\.resistMagic/);
 assert.match(b,/\.inherentMagic\?\.unresistable===true/);
});
test('Babylon blade is VFX-only and routed by its authored skill ID',()=>{
 const d=src('js/vfx-database.js'),m=src('js/vfx-manager.js'),v=src('js/livia-duality-vfx.js');
 assert.match(d,/livia-duality.*livia_purified_nether/);
 assert.match(m,/LiviaDualityVfx/);
 assert.match(v,/class LiviaDualityVfx/);
 assert.doesNotMatch(v,/applyDamage|\.consumeSkill\(/);
});
