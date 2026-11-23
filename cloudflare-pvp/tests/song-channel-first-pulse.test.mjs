import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEffectEngine} from '../../js/effect-engine.js';
import {SkillDatabase,SKILLS} from '../../js/skill-database.js';

// Real EffectEngine, real formal skill definitions, only external runtime
// services stubbed. Identical EffectEngine is used by local/Gemini/PvP.
globalThis.SkillDatabase=SkillDatabase;
globalThis.UnitRuntimeEngine={
  syncMana:()=>{},
  changeResource:(unit,key,amount)=>{
    const current=unit.resources?.[key]?.value??0;
    if(unit.resources?.[key])unit.resources[key].value=current+amount;
    return amount;
  },
  restoreMana:(unit,amount)=>{unit.mana=(unit.mana||0)+amount;return amount;}
};

function makeUnit(id,team,x,y,{passives=[],mdef=11}={}){
  return {id,team,x,y,alive:true,mana:0,effects:[],resources:{humidity:{value:10}},
    character:{name:id,passives,attributes:{},combat:{hp:180,atk:20,mdef,move:4},modifiers:{}}};
}
function beginSong(id,units){
  const singer=units[0],rule=SKILLS[id].channel,engine=createEffectEngine();
  const result=engine.apply({source:singer,target:singer,effect:rule});
  assert.equal(result.applied,true);
  return {engine,singer,rule};
}

test('海洋之歌施放當下正式賦予友軍/歌者 Buff、敵軍 Debuff，範圍外不套用',()=>{
  const singer=makeUnit('singer','P',3,3);
  const ally=makeUnit('ally','P',4,3);
  const far=makeUnit('far','P',6,3);
  const enemy=makeUnit('enemy','E',3,5);
  const units=[singer,ally,far,enemy],{engine,rule}=beginSong('nereia_ocean_song',units);
  assert.equal(ally.effects.length,0,'尚未施放第一波前不應產生假的 HUD 狀態');
  const pulse=engine.pulseSongOnCast(singer,rule,{units});
  assert.deepEqual(pulse.affected,['singer','ally','enemy']);
  assert.equal(ally.effects.find(e=>e.id==='OCEAN_SONG_BLESSING')?.name,'潮汐庇護');
  assert.equal(singer.effects.some(e=>e.id==='OCEAN_SONG_BLESSING'),true);
  assert.equal(enemy.effects.some(e=>e.id==='OCEAN_SONG_DISORIENT'),true);
  assert.equal(far.effects.length,0);
  assert.equal(ally.character.combat.mdef,21,'正式戰鬥屬性必須同步生效');
  assert.equal(singer.resources.humidity.value,15);
  assert.equal(singer.effects.find(e=>e.id==='NEREIA_OCEAN_SONG')?.remaining,2);
});

test('聖歌當下提供淨化、防護、下一擊神聖強化，薩菲雅律動在 HUD 正式 Buff 表',()=>{
  const singer=makeUnit('angel','P',1,1);
  const dancer=makeUnit('safiya','P',1,2,{passives:['RHYTHM']});
  const units=[singer,dancer],{engine,rule}=beginSong('angel_hymn',units);
  engine.apply({source:singer,target:dancer,effect:{type:'BUFF',id:'STATUS_TEST',name:'負面',classification:'NEGATIVE',duration:3}});
  assert.equal(dancer.effects.some(e=>e.id==='STATUS_TEST'),true);
  const pulse=engine.pulseSongOnCast(singer,rule,{units});
  assert.deepEqual(pulse.affected,['angel','safiya']);
  const ids=dancer.effects.map(e=>e.id);
  assert.equal(ids.includes('STATUS_TEST'),false);
  for(const id of ['ANGEL_HYMN_BLESSING','ANGEL_HYMN_NEXT_ATTACK','RHYTHM_HOLY'])assert.ok(ids.includes(id),id);
  assert.equal(dancer.effects.find(e=>e.id==='RHYTHM_HOLY').nextDanceInherentMagic.power,.18);
  assert.equal(dancer.effects.find(e=>e.id==='ANGEL_HYMN_NEXT_ATTACK').nextAttackInherentMagic.power,.12);
});

test('海洋之歌對薩菲雅立刻提供律動迴避 Buff，非單純圖示',()=>{
  const singer=makeUnit('nereia','P',0,0);
  const dancer=makeUnit('safiya','P',1,0,{passives:['RHYTHM']});
  const {engine,rule}=beginSong('nereia_ocean_song',[singer,dancer]);
  engine.pulseSongOnCast(singer,rule,{units:[singer,dancer]});
  assert.equal(dancer.effects.find(e=>e.id==='RHYTHM_OCEAN')?.classification,'POSITIVE');
  assert.equal(dancer.character.modifiers.evasion,8);
});

test('三回合歌曲一共三次正式脈衝（施放+兩次開回合），不額外加第四次',()=>{
  const singer=makeUnit('nereia','P',0,0),ally=makeUnit('ally','P',1,0);
  const units=[singer,ally],{engine,rule}=beginSong('nereia_ocean_song',units);
  let count=0;
  if(engine.pulseSongOnCast(singer,rule,{units}))count++;
  for(let i=0;i<3;i++){
    const events=engine.tick(singer,{units});
    count+=events.filter(e=>e.type==='SONG_CHANNEL').length;
    engine.tick(ally,{units});
    assert.equal(ally.effects.filter(e=>e.id==='OCEAN_SONG_BLESSING').length, i===2?0:1,
      'Buff 只在歌曲當前有效脈衝之後保留，不可殘留或堆疊');
  }
  assert.equal(count,3);
  assert.equal(singer.resources.humidity.value,25,'來源資源恢復也只能結算三次');
  assert.equal(singer.effects.some(e=>e.type==='SONG_CHANNEL'),false);
});

test('移動或交戰中斷歌唱，後續不再發放 Buff',()=>{
  const singer=makeUnit('angel','P',0,0),ally=makeUnit('ally','P',1,0);
  const units=[singer,ally],{engine,rule}=beginSong('angel_hymn',units);
  engine.pulseSongOnCast(singer,rule,{units});
  assert.equal(engine.interruptChannel(singer,'MOVE').length,1);
  assert.equal(engine.tick(singer,{units}).filter(e=>e.type==='SONG_CHANNEL').length,0);
});

test('奧菲治癒歌聲維持既有持續治療，不被誤改為立即 Buff',()=>{
  const singer=makeUnit('ophi','P',0,0),ally=makeUnit('ally','P',1,0);
  const units=[singer,ally],{engine,rule}=beginSong('ophi_healing_song',units);
  assert.equal(engine.pulseSongOnCast(singer,rule,{units}),null);
  assert.equal(singer.effects.find(e=>e.id==='OPHI_HEALING_SONG')?.remaining,3);
});

test('本地與 PvP 共用官方施法入口，沒有另一套歌曲規則',()=>{
  const action=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8');
  assert.match(action,/const firstPulse=rule\.type==="SONG_CHANNEL"[\s\S]{0,170}EffectEngine\.pulseSongOnCast\(attacker,rule,\{units:state\(\)\.units\}\)/);
  assert.match(action,/function executeChannelSkill\(attacker,skill\)/);
});
