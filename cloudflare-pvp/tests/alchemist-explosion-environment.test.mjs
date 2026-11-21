import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SKILLS,SkillDatabase} from '../../js/skill-database.js';

const source=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
const fireArrow=SKILLS.elemental_enchant.enchantment?.onBowImpact?.FIRE;

function cast(variant='NORMAL'){
  const tiles=Array.from({length:49},(_,n)=>({x:n%7,y:Math.floor(n/7),terrain:'PLAIN',elevation:0,waterDepth:0}));
  const map={tiles,objects:[]},at=(x,y)=>tiles.find(t=>t.x===x&&t.y===y);
  const caster={id:'alc',team:'P',alive:true,acted:false,waited:false,moved:false,x:1,y:3,character:{id:'alchemist',name:'梅莉安',alchemyHarvest:true,combat:{matk:50},weapons:{}}};
  const environmentState={effects:new Map()},units=[caster],calls=[],resolved=[],spent=[];
  const g={globalThis:null,
    AngelWingBarrierEngine:{TYPE:'HOLY_WING_BARRIER'},
    TacticalEngine:{range:s=>s.range,tile:(m,x,y)=>at(x,y),faceToward:()=>{},canSee:()=>true,teamCanSee:()=>true,
      aoeTiles:(_m,c,r)=>tiles.filter(t=>Math.abs(t.x-c.x)+Math.abs(t.y-c.y)<=r)},
    HydrologyEngine:{isWater:tile=>Number(tile?.waterDepth||0)>0},
    EnvironmentEngine:{EFFECT:{BURNING:'BURNING'},effectAt:()=>[],isConductive:()=>false,
      apply:({x,y,forces})=>{calls.push({x,y,forces:[...forces]});return[{type:'EXPLOSION_ENVIRONMENT_CALLED',x,y,forces:[...forces]}]}},
    UnitRuntimeEngine:{rollSanityMisfire:()=>false,beginBloodTransaction:()=>{},endBloodTransaction:()=>{},attackEnhancement:()=>1},
    EffectEngine:{breakStealth:()=>{},interruptChannel:()=>{}},
    UnitAnimationEngine:{emitAction:()=>{}},
    CardTacticsDiagnostics:{gameAction:()=>{}}
  };g.globalThis=g;
  vm.runInNewContext(source,g,{filename:'tactical-action-controller.js'});
  const ctx={actionState:()=>({map,units,environmentState,selected:caster,round:1}),TEAM:{PLAYER:'P',ENEMY:'E'},
    targetType:()=> 'AOE',unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
    aoeTiles:(c,r)=>g.TacticalEngine.aoeTiles(map,c,r),canUseSkill:()=>true,
    consumeSkill:(u,s)=>{spent.push(s);return{resources:{}}},effectiveSkill:(u,s)=>s,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
    pushLog:()=>{},logEnvironmentEvent:()=>{},resolveEnvironmentEvents:(events)=>resolved.push(events),
    checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>{},emitState:()=>{},
    applyEnvironmentHazardToUnit:()=>0
  };
  const controller=g.TacticalActionController.create(ctx);
  const skill=SkillDatabase.resolveVariant('alchemy_explosion',variant);
  const success=controller.executeMapSkill(caster,at(3,3),skill);
  return{success,calls,resolved,spent,caster,skill};
}
test('all 9 canonical explosion recipes reuse EXPLOSION environment force, and FIRE combines its inherited ignition',()=>{
  const base=SKILLS.alchemy_explosion;
  assert.deepEqual(base.environmentForces,['EXPLOSION']);
  assert.equal(base.radius,1);
  for(const variant of base.variants){
    const selected=SkillDatabase.resolveVariant(base,variant.id);
    assert.ok(selected.environmentForces.includes('EXPLOSION'),variant.id);
    assert.equal(selected.environmentForces.includes('FIRE'),variant.id==='HIGH_FIRE',variant.id);
  }
  assert.deepEqual(fireArrow?.environmentForces,['FIRE','EXPLOSION']);
});
for(const variant of ['NORMAL','HIGH_FIRE','HIGH_ICE','HIGH_WATER','HIGH_STONE']){
  test(`${variant}: committed alchemy blast invokes official environment force on all five AOEs once`,()=>{
    const h=cast(variant);
    assert.equal(h.success,true);
    assert.equal(h.spent.length,1);
    assert.equal(h.caster.acted,true);
    assert.equal(h.calls.length,5);
    assert.equal(new Set(h.calls.map(x=>`${x.x},${x.y}`)).size,5);
    for(const c of h.calls){
      assert.ok(c.forces.includes('EXPLOSION'),variant);
      assert.equal(c.forces.includes('FIRE'),variant==='HIGH_FIRE');
    }
    assert.equal(h.resolved.flat().length,5);
  });
}
