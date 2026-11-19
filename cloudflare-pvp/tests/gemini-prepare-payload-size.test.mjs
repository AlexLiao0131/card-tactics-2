import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TextEncoder} from 'node:util';
const code=readFileSync(new URL('../../js/tactical-game.js',import.meta.url),'utf8');
const start=code.indexOf('  function compactGeminiDeckEnvelope(envelope,byteLimit){');
const requestStart=code.indexOf('  async function geminiRequest(endpoint,payload){',start);
const end=code.indexOf('  function recordGeminiResult(',requestStart);
assert.ok(start>=0&&requestStart>start&&end>requestStart);
const helperSource=code.slice(start,requestStart),requestSource=code.slice(requestStart,end);
const fit=Function('TextEncoder',`${helperSource}; return compactGeminiDeckEnvelope;`)(TextEncoder);
const size=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const buildCards=(count=36,skillCount=2,passiveCount=1)=>Array.from({length:count},(_,i)=>({
  id:`hero_card_${i}`,name:`英雄${i}守備者`,kind:i%4===0?'UNIT':'HERO',cost:i%6+1,
  faction:i%2?'KINGDOM':'NEUTRAL',role:'TACTICAL_SUPPORT',
  stats:{hp:260+i,atk:48,matk:56,def:38,mdef:31,move:4},
  skills:Array.from({length:skillCount},(_,j)=>({
    id:`hero_${i}_skill_${j}`,name:`技能${j}｜範圍戰術`,category:'ACTIVE',target:'ENEMY',power:1.25,
    mp:15,range:[1,4],
    mechanic:'施放後可對敵軍造成傷害，並且依照武器屬性進行連鎖判定與戰場環境互動。'.repeat(2).slice(0,100),
    tags:['AOE','CAN_COUNTER','WATER','FOREST','CRITICAL']
  })),
  passives:Array.from({length:passiveCount},(_,j)=>({id:`hero_${i}_passive_${j}`,name:`被動${j}`,
    description:'站在森林時增加物理防禦與自然抗性，且受到反擊可以追加機率防禦。'.repeat(3).slice(0,130),
    rules:JSON.stringify({defenseProfiles:[{type:'PHYSICAL',ratio:1.2}],movementRules:['FOREST','MUD'],terrainTraits:{FOREST:{def:1.2}},encounterDominion:{domain:'FIELD'}}).repeat(2).slice(0,260)})),
  equipment:{armor:'armor_leather',weapons:['dagger','bow']},companions:['wolf']
}));
const envelope=(cards)=>({phase:'ENEMY_DECK',cards,battle_id:'match_test',revision:1,
  stage:'versus_core_battle',rules:{deck_size:20,starting_crystals:4,max_crystals:10,crystal_growth:1,hand_size:5},
  objective:'CORE_CAPTURE: 3 neutral capture points and opposing Core'});

test('oversized preparation decks are packed under 46 KiB without removing playable data',()=>{
  const cards=buildCards(),payload=envelope(cards);
  assert.ok(size(payload)>48*1024,`fixture size ${size(payload)} unexpectedly small`);
  const compacted=fit(payload,46*1024);
  assert.ok(compacted.body,`unable to fit ${compacted.bytes} bytes`);
  assert.ok(compacted.bytes<=46*1024);
  assert.ok(compacted.tier>0);
  const result=JSON.parse(compacted.body);
  assert.equal(result.cards.length,cards.length);
  assert.deepEqual(result.cards.map(c=>c.id),cards.map(c=>c.id));
  for(let i=0;i<cards.length;i++){
    const before=cards[i],after=result.cards[i];
    for(const key of ['cost','kind','name','faction','role','stats','equipment','companions'])
      assert.deepEqual(after[key],before[key],`${key} changed in card ${i}`);
    assert.deepEqual(after.skills.map(s=>s.id),before.skills.map(s=>s.id));
    assert.deepEqual(after.passives.map(p=>p.id),before.passives.map(p=>p.id));
    assert.deepEqual(after.skills.map(s=>[s.power,s.mp,s.range,s.category,s.target]),
      before.skills.map(s=>[s.power,s.mp,s.range,s.category,s.target]));
  }
  assert.equal(result.battle_id,payload.battle_id);
  assert.equal(result.revision,payload.revision);
});
test('a request already under budget stays byte-for-byte unchanged',()=>{
  const request=envelope(buildCards(2)),out=fit(request,40*1024);
  assert.equal(out.tier,0);
  assert.equal(out.body,JSON.stringify(request));
});
test('the smaller fallback budget also keeps the complete legal pool and skill IDs',()=>{
  const cards=buildCards(36),out=fit(envelope(cards),28*1024);
  assert.ok(out.body,'28KiB fallback could not fit representative pool');
  assert.ok(out.bytes<=28*1024);
  assert.deepEqual(JSON.parse(out.body).cards.map(c=>c.skills.map(s=>s.id)),cards.map(c=>c.skills.map(s=>s.id)));
});
test('too many cards do not silently disappear when even the minimum descriptor cannot fit',()=>{
  const cards=buildCards(400),out=fit(envelope(cards),20*1024);
  assert.equal(out.body,null);
  assert.equal(out.tier,-1);
});
test('HTTP 413 retries smaller payload transparently with identical revision and card eligibility',async()=>{
  const sent=[];
  const fakeFetch=async (url,init)=>{
    const data=JSON.parse(init.body);sent.push({url,body:data,bytes:new TextEncoder().encode(init.body).length});
    if(sent.length===1)return{status:413,ok:false};
    return{status:200,ok:true,json:async()=>({battle_id:data.battle_id,revision:data.revision,deck:Array(20).fill(data.cards[0].id)})};
  };
  const session={token:'unit-test-token',battleId:'match_test',enabled:true};
  const diagnostics=[];
  const makeRequest=Function('TextEncoder','AbortController','setTimeout','clearTimeout','fetch','globalThis','session',
    `const GEMINI_WORKER='https://fixture.workers.dev'; const geminiTimeoutFor=()=>5000;\n`+
    `let geminiSession=session,geminiSerial=0;\n`+helperSource+requestSource+'return geminiRequest;');
  const call=makeRequest(TextEncoder,AbortController,setTimeout,clearTimeout,fakeFetch,
    {CardTacticsDiagnostics:{push:(type,data)=>diagnostics.push({type,data})}},session);
  const reply=await call('/v1/prepare',envelope(buildCards(36)));
  assert.ok(reply?.deck?.length===20);
  assert.equal(sent.length,2);
  assert.ok(sent[0].bytes<=46*1024);
  assert.ok(sent[1].bytes<=40*1024);
  assert.ok(sent[1].bytes<sent[0].bytes);
  assert.equal(sent[0].body.revision,sent[1].body.revision);
  assert.equal(sent[0].body.battle_id,sent[1].body.battle_id);
  assert.deepEqual(sent[0].body.cards.map(c=>c.id),sent[1].body.cards.map(c=>c.id));
  assert.ok(diagnostics.some(x=>x.type==='GEMINI_PREPARE_PAYLOAD'&&x.data.retry===1));
});


test('repeated HTTP 413 reports a precise Worker size error without exposing credentials',async()=>{
  const sent=[];
  const session={token:'private-token',battleId:'match_test',enabled:true};
  const fakeFetch=async(url,init)=>{sent.push(init);return{status:413,ok:false};};
  const makeRequest=Function('TextEncoder','AbortController','setTimeout','clearTimeout','fetch','globalThis','session',
    `const GEMINI_WORKER='https://fixture.workers.dev';const geminiTimeoutFor=()=>5000;let geminiSession=session,geminiSerial=0;`+
      helperSource+requestSource+'return geminiRequest;');
  const call=makeRequest(TextEncoder,AbortController,setTimeout,clearTimeout,fakeFetch,{},session);
  const result=await call('/v1/prepare',envelope(buildCards(36)));
  assert.equal(result,null);
  assert.equal(sent.length,3);
  assert.equal(session.lastError,'GEMINI_WORKER_PAYLOAD_LIMIT');
  assert.ok(sent.every(req=>!req.body.includes(session.token)));
});
