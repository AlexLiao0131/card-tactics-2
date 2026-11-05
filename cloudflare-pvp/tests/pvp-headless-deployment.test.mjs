import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialBattlefield } from '../src/pvp-battlefield.mjs';
import { deployCanonicalCard,projectDeployedUnits,projectLegalDeploymentTiles } from '../src/pvp-headless-deployment.mjs';
import { CardDatabase } from '../../js/card-database.js';
import { createCardPhaseEngine } from '../../js/card-phase-engine.js';
import { createDeckEngine } from '../../js/deck-engine.js';
const cardPhase=createCardPhaseEngine({cardDatabase:CardDatabase,deckEngine:createDeckEngine({cardDatabase:CardDatabase})});
const createGame=(seat=0)=>{
  const deck=Array.from({length:20},()=>seat===0?'imperial_archer_card':'imperial_swordsman_card');
  const state=cardPhase.create({deck});
  cardPhase.begin(state);
  return {battlefield:createOfficialBattlefield({serverSeed:1234,mapSize:'SMALL'}),
    cards:seat===0?[state,cardPhase.create({deck})]:[cardPhase.create({deck}),state],
    units:[],nextUnitSerial:0,round:1,activeSeat:seat,
    phase:seat===0?'PLAYER_CARD_PHASE':'ENEMY_CARD_PHASE'};
};
const command=(tile,cardId='imperial_archer_card')=>({type:'DEPLOY_CARD',cardId,x:tile.x,y:tile.y});
test('Canonical CardPhaseEngine and DeploymentEngine are both called for valid deployment',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  assert.ok(CardDatabase.isCharacter(CardDatabase.get('imperial_archer_card')));
  const result=deployCanonicalCard(g,command(pt),0);
  assert.equal(result.accepted,true);assert.equal(g.units.length,1);
  assert.equal(g.units[0].team,'P');assert.equal(g.cards[0].zones.hand.length,4);
  assert.equal(g.cards[0].crystals,1);
  assert.equal(g.units[0].character.id,'imperial_archer');
  assert.equal(g.units[0].moved,true);assert.equal(g.units[0].acted,true);assert.equal(g.units[0].waited,true);
  assert.equal('_runtimeMap' in g.units[0],false);
  assert.doesNotThrow(()=>structuredClone(g));
});
test('Opponent may never command deployment during wrong seat phase',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  assert.throws(()=>deployCanonicalCard(g,command(pt),1),{code:'NOT_YOUR_TURN'});
  assert.equal(g.units.length,0);assert.equal(g.cards[0].crystals,4);
});
test('Cannot deploy in another team base',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  assert.throws(()=>deployCanonicalCard(g,command(pt),0),{code:'ILLEGAL_DEPLOY_TILE'});
  assert.equal(g.units.length,0);assert.equal(g.cards[0].crystals,4);
});
test('Cannot deploy on same occupied tile twice',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  deployCanonicalCard(g,command(pt),0);
  g.cards[0].crystals=4; // Exercise occupancy independent of cost.
  assert.throws(()=>deployCanonicalCard(g,command(pt),0),{code:'ILLEGAL_DEPLOY_TILE'});
  assert.equal(g.units.length,1);assert.equal(g.cards[0].zones.hand.length,4);
});
test('Opponent deploys into ENEMY base with official owner mapping',()=>{
  const g=createGame(1);const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
  deployCanonicalCard(g,command(pt,'imperial_swordsman_card'),1);
  assert.equal(g.units[0].team,'E');assert.equal(g.units[0].character.id,'imperial_swordsman');
  assert.equal(g.cards[1].crystals,4-CardDatabase.get('imperial_swordsman_card').cost);
});
test('Invalid commands do not spend card or crystals',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  for(const invalid of [
    {type:'DEPLOY_CARD',cardId:'no_card',...pt},
    {type:'DEPLOY_CARD',cardId:'imperial_archer_card',x:pt.x},
    {type:'DEPLOY_CARD',cardId:'imperial_archer_card',x:'1',y:pt.y},
    {...command(pt),extra:1},
    {type:'MOVE',cardId:'imperial_archer_card',...pt},
  ]) assert.throws(()=>deployCanonicalCard(g,invalid,0));
  assert.equal(g.cards[0].zones.hand.length,5);assert.equal(g.cards[0].crystals,4);
});
test('Canonical cost excludes spending cards not in hand and exceeding available crystals',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  assert.throws(()=>deployCanonicalCard(g,command(pt,'livia_card'),0),{code:'CARD_NOT_PLAYABLE'});
  deployCanonicalCard(g,command(pt),0);
  const second={x:pt.x,y:pt.y};
  assert.throws(()=>deployCanonicalCard(g,command(second),0),{code:'CARD_NOT_PLAYABLE'});
});
test('Public unit projection does not expose private runtime card zones',()=>{
  const g=createGame();const pt=g.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
  deployCanonicalCard(g,command(pt),0);
  const projected=projectDeployedUnits(g.units,1);
  assert.equal(projected.length,1);assert.equal(projected[0].x,pt.x);
  assert.equal(projected[0].hp,CardDatabase.get('imperial_archer_card')?g.units[0].hp:null);
  assert.equal('character' in projected[0],false);
  assert.equal('zones' in projected[0],false);
});


test('server projected deployment cells are exactly official canDeploy result for either seat',()=>{
 for(const seat of [0,1]){
   const g=createGame(seat),owner=seat===0?'PLAYER':'ENEMY';
   const stage={deploymentPoints:g.battlefield.deploymentPoints};
   const allowed=projectLegalDeploymentTiles(g,seat);
   assert.ok(allowed.length>0);
   assert.ok(allowed.every(t=>stage.deploymentPoints.some(p=>p.owner===owner&&
     p.area.some(a=>a.x===t.x&&a.y===t.y))));
   const opponent=g.battlefield.deploymentPoints.find(p=>p.owner!==owner).area[0];
   assert.equal(allowed.some(t=>t.x===opponent.x&&t.y===opponent.y),false);
   const placed=allowed[0];
   deployCanonicalCard(g,command(placed,seat===0?'imperial_archer_card':'imperial_swordsman_card'),seat);
   assert.equal(projectLegalDeploymentTiles(g,seat).some(t=>t.x===placed.x&&t.y===placed.y),false,
     'already occupied cell disappears from next authoritative projection');
   assert.throws(()=>deployCanonicalCard(g,command(placed,seat===0?'imperial_archer_card':'imperial_swordsman_card'),seat));
 }
});

test('unpassable terrain in a home area is not projected as a legal tile',()=>{
 const g=createGame(0);const initial=projectLegalDeploymentTiles(g,0)[0];
 const tile=g.battlefield.map.tiles.find(t=>t.x===initial.x&&t.y===initial.y);
 tile.terrain='WALL';
 assert.equal(projectLegalDeploymentTiles(g,0).some(t=>t.x===initial.x&&t.y===initial.y),false);
 assert.throws(()=>deployCanonicalCard(g,command(initial),0),{code:'ILLEGAL_DEPLOY_TILE'});
});

test('all four official PvP map sizes produce seat-separated authoritative legal deployment highlights',()=>{
  for(const mapSize of ['SMALL','MEDIUM','LARGE','XLARGE']){
    const battlefield=createOfficialBattlefield({serverSeed:1234,mapSize});
    const game={battlefield,units:[]};
    const a=projectLegalDeploymentTiles(game,0),b=projectLegalDeploymentTiles(game,1);
    assert.ok(a.length>0&&b.length>0,mapSize);
    const enemy=new Set(b.map(tile=>`${tile.x},${tile.y}`));
    assert.ok(a.every(tile=>!enemy.has(`${tile.x},${tile.y}`)),`${mapSize} seats cannot share home cells`);
  }
});
