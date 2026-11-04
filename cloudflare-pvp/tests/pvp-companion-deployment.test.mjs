import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';
import {deployCanonicalCard} from '../src/pvp-headless-deployment.mjs';
import {CardDatabase} from '../../js/card-database.js';
import {CardPhaseEngine} from '../../js/card-phase-engine.js';
import {createDeckEngine} from '../../js/deck-engine.js';
import {CompanionDatabase} from '../../js/companion-database.js';
import {createUnitRuntimeEngine} from '../../js/unit-runtime-engine.js';

const deck=Array(20).fill('ophi_card');
const game=(seat=0)=>{
  const card=CardPhaseEngine.create({deck,startingCrystals:6});
  CardPhaseEngine.begin(card);
  const inactive=CardPhaseEngine.create({deck});
  return {battlefield:createOfficialBattlefield({serverSeed:9881,mapSize:'SMALL'}),
    cards:seat===0?[card,inactive]:[inactive,card],units:[],nextUnitSerial:0,
    activeSeat:seat,round:1,phase:seat===0?'PLAYER_CARD_PHASE':'ENEMY_CARD_PHASE'};
};
const deploy=(game,seat,cardId,spot)=>deployCanonicalCard(game,
  {type:'DEPLOY_CARD',cardId,x:spot.x,y:spot.y},seat);

test('canonical Ophi deployment grants one non-collectible eagle card, ready to deploy at zero cost',()=>{
  const g=game();
  const spaces=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
  assert.ok(spaces.length>=2);
  assert.equal(CardDatabase.get('ophi_eagle_card').cost,0);
  const before=structuredClone(g.cards[0]);
  deploy(g,0,'ophi_card',spaces[0]);
  assert.equal(g.cards[0].zones.hand.includes('ophi_eagle_card'),true);
  assert.equal(g.cards[0].generatedCardsGranted.filter(id=>id==='ophi_eagle_card').length,1);
  assert.equal(g.cards[0].crystals,before.crystals-CardDatabase.get('ophi_card').cost);
  const result=deploy(g,0,'ophi_eagle_card',spaces[1]);
  assert.equal(result.accepted,true);
  assert.equal(g.cards[0].crystals,0);
  const eagle=g.units.find(u=>u.character.id==='ophi_eagle');
  const ophi=g.units.find(u=>u.character.id==='ophi');
  assert.ok(eagle);assert.ok(ophi);
  assert.equal(eagle.team,ophi.team);
  const runtime=createUnitRuntimeEngine();
  runtime.reconcileCompanions(g.units);
  assert.equal(eagle.ownerUnitId,ophi.id);
  assert.equal(eagle.unitRole,'COMPANION');
  assert.equal(eagle.canAttack,false);
  assert.equal(eagle.canCapture,false);
  assert.equal(CompanionDatabase.providesTargeting(ophi,'ophi_eagle_arc_shot'),true);
  assert.doesNotThrow(()=>structuredClone(g));
});

test('official companion binding despawns eagle after owner defeat and prevents shared vision',()=>{
  const g=game();
  const spaces=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
  deploy(g,0,'ophi_card',spaces[0]);
  deploy(g,0,'ophi_eagle_card',spaces[1]);
  const runtime=createUnitRuntimeEngine();
  runtime.reconcileCompanions(g.units);
  const ophi=g.units.find(u=>u.character.id==='ophi');
  const eagle=g.units.find(u=>u.character.id==='ophi_eagle');
  ophi.hp=0;ophi.alive=false;
  runtime.reconcileCompanions(g.units);
  assert.equal(eagle.alive,false);
  assert.equal(eagle.despawnReason,'OWNER_EXIT');
  assert.equal(CompanionDatabase.providesTargeting(ophi,'ophi_eagle_arc_shot'),false);
});
