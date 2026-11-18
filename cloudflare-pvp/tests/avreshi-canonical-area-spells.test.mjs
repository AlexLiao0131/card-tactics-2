import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AreaSpellMechanics} from '../../js/area-spell-mechanics.js';
import {CardDatabase} from '../../js/card-database.js';
import {SkillDatabase} from '../../js/skill-database.js';

const tornado=CardDatabase.get('tornado_card').effect;
const meteor=CardDatabase.get('starfall_card').effect;
const druidTornado=SkillDatabase.get('avreshi_tornado');
const druidMeteor=SkillDatabase.get('avreshi_starfall');
const center={x:5,y:5};
const cells=(radius)=>{
  const out=[];
  for(let x=center.x-radius;x<=center.x+radius;x++)for(let y=center.y-radius;y<=center.y+radius;y++)
    if(Math.abs(x-center.x)+Math.abs(y-center.y)<=radius)out.push({x,y});
  return out;
};
function setup(units=[]){
  const effects=new Map(),created=[],moves=[],forcings=[],eventBatches=[],logs=[];
  globalThis.EnvironmentEngine={
    EFFECT:{TORNADO:'TORNADO',FIRE_TORNADO:'FIRE_TORNADO'},
    createTornado(state,x,y,options){
      created.push({x,y,options});
      const type=(x===center.x&&y===center.y&&state.fire)?'FIRE_TORNADO':'TORNADO';
      effects.set(`${x},${y}`,[{type,element:type==='FIRE_TORNADO'?'FIRE':'AIR',
        pushDistance:options.pushDistance,lift:options.lift,
        damage:type==='FIRE_TORNADO'?options.fireDamage:options.damage,
        damageType:type==='FIRE_TORNADO'?'FIRE':'PHYSICAL',resistAxes:options.resistAxes}]);
      return{type:type==='FIRE_TORNADO'?'FIRE_TORNADO_CREATED':'TORNADO_CREATED',x,y};
    },
    effectAt(state,x,y){return effects.get(`${x},${y}`)||[]},
    apply({x,y,forces}){forcings.push({x,y,forces});return[{type:'ENVIRONMENT_APPLIED',x,y}];}
  };
  const ctx={map:{tiles:cells(4)},environmentState:{effects},center,created,moves,forcings,eventBatches,logs,
    unitAt:(x,y)=>units.find(unit=>unit.x===x&&unit.y===y&&unit.alive!==false)||null,
    aoeTiles:(_center,radius)=>cells(radius),
    logEnvironmentEvent:e=>logs.push(e),pushLog:(...parts)=>logs.push(parts),
    resolveEnvironmentEvents:(events,meta)=>eventBatches.push({events,meta}),
    applyForcedMovement:(origin,unit,distance,rule)=>moves.push({origin,unit,distance,rule})};
  return ctx;
}
const source=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Official card spell remains radius 1 tornado and radius 2 starfall',()=>{
  assert.equal(tornado.type,'AREA_PUSH');assert.equal(tornado.radius,1);
  assert.equal(meteor.type,'AREA_DAMAGE');assert.equal(meteor.radius,2);
  assert.equal(druidTornado.radius,tornado.radius);
  assert.equal(druidMeteor.radius,1);
  assert.equal(cells(1).length,5);assert.equal(cells(2).length,13);
});

test('Druid tornado creates same five connected cells and identical parameters as card',()=>{
  const ctx=setup();
  const out=AreaSpellMechanics.resolveAreaPush({...ctx,affected:cells(tornado.radius),effect:tornado,name:'龍捲風'});
  assert.equal(out.affectedTiles,5);assert.equal(ctx.created.length,5);
  assert.deepEqual(ctx.created.map(p=>`${p.x},${p.y}`).sort(),cells(1).map(p=>`${p.x},${p.y}`).sort());
  for(const {options} of ctx.created){
    assert.equal(options.duration,2);assert.equal(options.pushDistance,tornado.distance);
    assert.equal(options.lift,tornado.lift);assert.equal(options.damage,tornado.damage);
    assert.equal(options.fireDamage,tornado.fireTornadoDamage);
    assert.deepEqual(options.resistAxes,tornado.resistAxes);
  }
  assert.equal(ctx.eventBatches.length,1);
});

test('Tornado instantly damages and throws all five occupied cells through canonical displacement',()=>{
  const units=cells(1).map((p,id)=>({...p,id,alive:true})),ctx=setup(units);
  const out=AreaSpellMechanics.resolveAreaPush({...ctx,affected:cells(1),effect:tornado,name:'龍捲風'});
  assert.equal(out.contacts,5);assert.equal(ctx.moves.length,5);
  for(const m of ctx.moves){assert.deepEqual(m.origin,center);
    assert.equal(m.distance,tornado.distance);assert.equal(m.rule.damage,tornado.damage);
    assert.equal(m.rule.lift,tornado.lift);assert.deepEqual(m.rule.resistAxes,tornado.resistAxes);}
});

test('Tornado retains card fire-tornado contact damage instead of substituting generic wind damage',()=>{
  const ctx=setup([{...center,id:'enemy',alive:true}]);ctx.environmentState.fire=true;
  AreaSpellMechanics.resolveAreaPush({...ctx,affected:cells(1),effect:tornado,name:'龍捲風'});
  assert.equal(ctx.moves.length,1);assert.equal(ctx.moves[0].rule.damage,tornado.fireTornadoDamage);
  assert.equal(ctx.moves[0].rule.damageType,'FIRE');
});

test('Card and druid share exactly one AREA_PUSH reducer and the original EnvironmentRenderer geometry',()=>{
  const card=source('../../js/card-phase-controller.js');
  const hero=source('../../js/tactical-action-controller.js');
  const render=source('../../js/environment-renderer.js');
  assert.match(card,/AreaSpellMechanics\.resolveAreaPush\(/);
  assert.match(hero,/CardDatabase\.get\('tornado_card'\)/);
  assert.match(hero,/AreaSpellMechanics\.resolveAreaPush\(/);
  assert.doesNotMatch(hero,/createTornado\(environmentState,center\.x,center\.y/);
  assert.match(render,/tornadoGroups\(state\)/);
  assert.match(render,/createTornadoCluster\(group,index/);
  assert.match(render,/const radius=Math\.max\(\.55,span\*\.48\)/);
});

test('Existing environmental round clock is untouched: no extra tornado advancement',()=>{
  const hero=source('../../js/tactical-action-controller.js');
  const helper=source('../../js/area-spell-mechanics.js');
  assert.doesNotMatch(hero,/advanceTornadoes\(/);
  assert.doesNotMatch(helper,/advanceTornadoes\(/);
});

test('Druid starfall uses five inner cells versus original card thirteen',()=>{
  assert.equal(druidMeteor.areaDamage.mode,'MAGIC_POWER');
  assert.equal(druidMeteor.radius,1);assert.equal(meteor.radius,2);
  assert.equal(cells(druidMeteor.radius).length,5);
  assert.equal(cells(meteor.radius).length,13);
});

test('Druid starfall gets identical card HEAVY_FIRE, EXPLOSION and IMPACT on reduced inner footprint',()=>{
  const ctx=setup();
  AreaSpellMechanics.applyTerrainImpact({...ctx,affected:cells(druidMeteor.radius),forces:meteor.forces});
  assert.equal(ctx.forcings.length,5);
  assert.ok(ctx.forcings.every(f=>JSON.stringify(f.forces)===JSON.stringify(meteor.forces)));
  assert.deepEqual(meteor.forces,['HEAVY_FIRE','EXPLOSION','IMPACT']);
});

test('Druid starfall preserves card outer wave damage, horizontal throw and vertical lift on eight outer cells',()=>{
  const ctx=setup(cells(2).map((p,i)=>({...p,id:i,alive:true})));
  const out=AreaSpellMechanics.resolveShockwave({...ctx,innerRadius:druidMeteor.radius,
    shockwave:meteor.shockwave,name:'星隕'});
  assert.equal(out.outerRadius,2);assert.equal(out.contacts,8);assert.equal(ctx.moves.length,8);
  for(const m of ctx.moves){
    assert.equal(Math.abs(m.unit.x-center.x)+Math.abs(m.unit.y-center.y),2);
    assert.equal(m.distance,meteor.shockwave.distance);
    assert.equal(m.rule.damage,meteor.shockwave.damage);
    assert.equal(m.rule.lift,meteor.shockwave.lift);
    assert.deepEqual(m.rule.resistAxes,meteor.shockwave.resistAxes);
  }
});

test('Druid starfall core does not double-apply card flat damage',()=>{
  const hero=source('../../js/tactical-action-controller.js');
  assert.match(hero,/if\(skill\.id==='avreshi_starfall'\)/);
  assert.match(hero,/AreaSpellMechanics\.applyTerrainImpact\(/);
  assert.match(hero,/AreaSpellMechanics\.resolveShockwave\(/);
  assert.doesNotMatch(hero,/damageUnitFlat\([^\n]*cardEffect\.damage/);
});

test('Lunar meteor geometry inherits card timing and visibly spans inner radius plus outer wave',()=>{
  const visual=source('../../js/environment-renderer.js');
  assert.match(visual,/fallDuration:presentation\.fallDuration/);
  assert.match(visual,/shockwaveRadius:Math\.max\(0,Number\(druidSkill\.radius\|\|0\)\)\+/);
  assert.match(visual,/card\?\.effect\?\.shockwave\?\.outerRadius/);
});

test('Incomplete area-push world is rejected rather than producing harmless decorative tornado',()=>{
  assert.throws(()=>AreaSpellMechanics.resolveAreaPush({map:{},environmentState:null,
    center,affected:cells(1),effect:tornado}),/CONTEXT_REQUIRED/);
});
