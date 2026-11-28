/**
 * Canonical persistent battlefield fields (Sanctuary / Smoke).
 * Shared by browser tactical-game and the authoritative Worker. All values
 * originate in SkillDatabase and all effects use the official EffectEngine.
 * This module has no DOM, timers, renderer state or own combat formula.
 */
import {TacticalEngine} from './tactical-engine.js';
import {SkillDatabase} from './skill-database.js';
import {BattleEngine} from './battle-engine.js';

const key=(x,y)=>`${x},${y}`;
const covers=(field,unit)=>field?.cells instanceof Set
  ? field.cells.has(key(unit.x,unit.y))
  : Array.isArray(field?.cells)&&field.cells.includes(key(unit.x,unit.y));

// Projection of authoritative active fields, not a second effect lifecycle.
export function activeFieldTiles({map,units=[],fieldState={},environmentState=null,round=0,viewerTeam,canSeeCell=()=>false,canSeeUnit=()=>false}={}){
  const index=new Map();
  const add=(cells,team,record)=>{for(const cell of cells||[]){
    const k=typeof cell==='string'?cell:key(cell.x,cell.y);
    if(team!==viewerTeam&&!canSeeCell(k))continue;
    const list=index.get(k)||[];list.push(record);index.set(k,list);
  }};
  for(const f of fieldState.persistentAreas||[]){
    if(!(f.ticksRemaining>0))continue;
    const skill=SkillDatabase.get(f.skillId);if(!skill?.persistentArea)continue;
    add(f.cells,f.team,{name:skill.name,kind:'damage',remaining:f.ticksRemaining,clock:'PULSES'});
  }
  for(const f of fieldState.sanctuaries||[]){
    // The sanctuary ward survives its last pulse until its true expiry.
    if(f.mode!=='HEALING'&&!(f.ticksRemaining>0))continue;
    const kind=f.mode==='HEALING'?(f.ticksRemaining>0?'heal':'buff'):'damage';
    add(f.cells,f.team,{name:f.mode==='HEALING'?'聖域・庇護':'聖域・懲戒',kind,remaining:Math.max(0,f.ticksRemaining),clock:'PULSES',ward:f.mode==='HEALING'});
  }
  for(const f of fieldState.smokeFields||[]){
    if(round>=f.expiresRound)continue;
    add(f.cells,f.team,{name:'煙霧彈',kind:'control',remaining:f.expiresRound-round,clock:'ROUNDS'});
  }
  for(const unit of units){
    if(!unit.alive||(unit.team!==viewerTeam&&!canSeeUnit(unit)))continue;
    for(const e of unit.effects||[]){
      if(!['HEALING_CHANNEL','SONG_CHANNEL'].includes(e.type)||!(e.remaining>0))continue;
      add(TacticalEngine.aoeTiles(map,unit,e.radius),unit.team,{name:e.name||e.id,kind:e.type==='HEALING_CHANNEL'?'heal':'buff',remaining:e.remaining,clock:'ROUNDS'});
    }
  }
  for(const f of map?.spatialDistortions||[]){if(Number(f.expireRound)>round)add(f.cells,f.team,{name:'空間扭曲',kind:'control',remaining:f.expireRound-round,clock:'ROUNDS'});}
  const hazardNames={BURNING:'燃燒',FIRE_TORNADO:'火龍捲',TORNADO:'龍捲風',WHIRLPOOL:'漩渦',BOILING:'沸騰',ELECTRIFIED:'帶電'};
  for(const tile of map?.tiles||[]){
    const cell=key(tile.x,tile.y);
    for(const effect of globalThis.EnvironmentEngine?.effectAt?.(environmentState,tile.x,tile.y)||[]){
      if(!hazardNames[effect.type]||!(effect.duration>0))continue;
      if(effect.sourceTeam!==viewerTeam&&!canSeeCell(cell))continue;
      add([cell],effect.sourceTeam||null,{name:hazardNames[effect.type],kind:effect.type==='WHIRLPOOL'?'control':'damage',remaining:effect.duration,clock:'ROUNDS'});
    }
  }
  return index;
}
// The browser boot imports this module via TacticalGame; the Worker imports it
// via its field controller. The existing presentation IIFE consumes the export.
globalThis.BattleAreaFieldProjection=activeFieldTiles;
export function createBattleAreaFieldState(){
  return {sanctuaries:[],smokeFields:[],sanctuarySerial:0,smokeSerial:0,persistentAreas:[],persistentSerial:0};
}
export function isSanctuaryProtected(fields,unit){
  return !!unit?.alive && (fields?.sanctuaries||[]).some(field=>
    field.mode==='HEALING'&&field.team===unit.team&&covers(field,unit));
}
export function createBattleAreaFieldEngine({state,map,units,round,effect,pushLog,handleDefeated,environmentState=null,resolveEnvironmentEvents=null,random=Math.random}={}){
  if(!state||!Array.isArray(state.sanctuaries)||!Array.isArray(state.smokeFields)||
     ![map,units,round,effect,pushLog,handleDefeated].every(fn=>typeof fn==='function'))
    throw new Error('CANONICAL_AREA_FIELD_CONTEXT_REQUIRED');
  const cells=state;
  cells.persistentAreas??=[];cells.persistentSerial??=0;
  const getUnits=()=>units()||[];
  function sanctuaryTiles(center,radius){return sanctuaryFootprint(map(),center,radius);}
  function syncSmokeCover(unit){
    if(!unit?.alive)return false;
    const rules=effect();
    const covered=cells.smokeFields.some(field=>field.team===unit.team&&covers(field,unit));
    const existing=rules.state(unit).some(e=>e.id==='SMOKE_COVER'&&e.type==='STEALTH');
    if(!covered&&existing){
      unit.effects=rules.state(unit).filter(e=>e.id!=='SMOKE_COVER');
      rules.syncModifiers(unit);return true;
    }
    if(covered&&!existing){
      rules.applyStealth(unit,{id:'SMOKE_COVER',source:unit});
      rules.resolveProximityReveal(unit,getUnits());return true;
    }
    return false;
  }
  function activateSmoke(caster,skill){
    const center={x:caster.x,y:caster.y},tiles=sanctuaryTiles(center,skill.radius);
    if(!tiles.length)return null;
    const field={id:`cat-smoke-${++cells.smokeSerial}`,team:caster.team,casterId:caster.id,
      center,cells:tiles.map(t=>key(t.x,t.y)),expiresRound:round()+skill.smokeField.duration};
    cells.smokeFields.push(field);
    getUnits().forEach(syncSmokeCover);
    pushLog(`${caster.character.name} 投出煙霧彈｜範圍 ${tiles.length} 格｜維持 ${skill.smokeField.duration} 回合。`,'BATTLE');
    return field;
  }
  function expireSmoke(){
    const active=cells.smokeFields.filter(field=>round()<field.expiresRound);
    if(active.length!==cells.smokeFields.length){
      cells.smokeFields.splice(0,cells.smokeFields.length,...active);
      getUnits().forEach(syncSmokeCover);
    }
  }
  function pulseSanctuary(field){
    const skill=SkillDatabase.get(field.skillId),source=getUnits().find(u=>u.id===field.casterId)||null;
    if(!skill?.sanctuary)throw new Error('CANONICAL_SANCTUARY_SKILL_MISSING');
    const rules=effect();
    for(const unit of getUnits()){
      if(!unit.alive||!covers(field,unit))continue;
      if(field.mode==='HEALING'&&unit.team===field.team){
        const healed=rules.saintHealing({source,target:unit,amount:skill.sanctuary.healing.amount}).amount;
        const dispelled=rules.apply({source,target:unit,effect:{type:'DISPEL',classification:'POSITIVE'}}).removed||0;
        pushLog(`聖域・庇護 → ${unit.character.name}｜治療 ${healed}、淨化 ${dispelled}。`,'BATTLE',{units:[source,unit]});
      }else if(field.mode==='PUNISHMENT'&&unit.team!==field.team){
        const judgement=skill.sanctuary.punishment;
        const outcome=rules.apply({source,target:unit,effect:{type:'MAGIC_DAMAGE',amount:judgement.amount,
          element:judgement.element,traitMultipliers:judgement.traitMultipliers}});
        pushLog(`聖域・懲戒 → ${unit.character.name}｜${outcome.amount||0} 神聖傷害。`,'BATTLE',{units:[source,unit]});
        if(unit.hp<=0){unit.alive=false;handleDefeated(unit,source,skill);}
      }
    }
  }
  function activateSanctuary(caster,center,skill,mode){
    const tiles=sanctuaryTiles(center,skill.radius);
    if(!tiles.length)return null;
    const field={id:`saint-sanctuary-${++cells.sanctuarySerial}`,casterId:caster.id,team:caster.team,
      skillId:skill.id,mode,center:{x:center.x,y:center.y},cells:tiles.map(t=>key(t.x,t.y)),
      nextRound:round()+1,ticksRemaining:skill.sanctuary.duration-1,expiresRound:round()+skill.sanctuary.duration};
    cells.sanctuaries.push(field);pulseSanctuary(field);
    pushLog(`${caster.character.name} 放出${mode==='HEALING'?'庇護':'懲戒'}聖域｜中心 (${center.x},${center.y})｜範圍 ${tiles.length} 格｜剩下 ${field.ticksRemaining} 次。`,'BATTLE');
    return field;
  }
  function pulsePersistentArea(field){
    const skill=SkillDatabase.get(field.skillId),rule=skill?.persistentArea;
    if(!rule)throw new Error('CANONICAL_PERSISTENT_AREA_SKILL_MISSING');
    const source=getUnits().find(u=>u.id===field.casterId)||null;
    const actor={id:field.casterId,team:field.team,character:field.character,x:field.origin.x,y:field.origin.y};
    globalThis.UnitAnimationEngine?.emitAction?.(source||actor,field.center,skill,{targetKind:"MAP",fieldCells:field.cells.map(cell=>{const [x,y]=cell.split(",").map(Number);return{x,y};})});
    for(const target of getUnits()){
      if(!target.alive||target.team===field.team||!covers(field,target))continue;
      if(globalThis.AngelWingBarrierEngine?.blocksIncoming?.(map(),actor,target,skill))continue;
      const result=BattleEngine.calculate(actor.character,target.character,skill,{distance:Math.abs(actor.x-target.x)+Math.abs(actor.y-target.y),random,forceHit:true});
      if(!result.hit)continue;
      const hit=effect().applyDamage(target,result.damage,{source,damageType:"MAGIC"});
      if(hit.hpLoss>0)globalThis.UnitAnimationEngine?.emitResolvedHit?.(target,{damage:hit.hpLoss,critical:result.crit,components:{magic:hit.hpLoss},element:skill.element,skillId:skill.id});
      pushLog(`${skill.name} → ${target.character.name}｜${hit.hpLoss} 傷害。`,"BATTLE");
      if(target.hp<=0)handleDefeated(target,source,skill);
    }
    const env=environmentState?.();
    if(env&&rule.environmentForces?.length){
      const events=[];
      for(const cell of field.cells){const [x,y]=cell.split(',').map(Number);events.push(...(globalThis.EnvironmentEngine.apply({map:map(),state:env,x,y,forces:rule.environmentForces})||[]));}
      resolveEnvironmentEvents?.(events,{reason:skill.name});
    }
  }
  function activatePersistentArea(caster,center,skill){
    const rule=skill.persistentArea,tiles=TacticalEngine.aoeTiles(map(),center,skill.radius);
    if(!rule||!tiles.length)return null;
    const field={id:`persistent-area-${++cells.persistentSerial}`,casterId:caster.id,team:caster.team,skillId:skill.id,
      origin:{x:caster.x,y:caster.y},character:JSON.parse(JSON.stringify(caster.character)),center:{x:center.x,y:center.y},cells:tiles.map(t=>key(t.x,t.y)),
      nextRound:round()+1,ticksRemaining:rule.duration-1};
    cells.persistentAreas.push(field);pulsePersistentArea(field);return field;
  }
  function tickSanctuaries(team){
    for(const field of cells.persistentAreas){
      if(field.team===team&&field.ticksRemaining>0&&round()>=field.nextRound){pulsePersistentArea(field);field.ticksRemaining--;field.nextRound=round()+1;}
    }
    cells.persistentAreas=cells.persistentAreas.filter(f=>f.ticksRemaining>0);

    const active=[];
    for(const field of cells.sanctuaries){
      if(field.team===team&&round()>=field.expiresRound)continue;
      if(field.team===team&&field.ticksRemaining>0&&round()>=field.nextRound){
        pulseSanctuary(field);field.ticksRemaining--;field.nextRound=round()+1;
      }
      active.push(field);
    }
    cells.sanctuaries.splice(0,cells.sanctuaries.length,...active);
  }
  function reset(){
    cells.sanctuaries.length=0;cells.smokeFields.length=0;
    cells.sanctuarySerial=0;cells.smokeSerial=0;
    cells.persistentAreas.length=0;cells.persistentSerial=0;
  }
  return Object.freeze({state:cells,sanctuaries:cells.sanctuaries,smokeFields:cells.smokeFields,
    sanctuaryTiles,sanctuaryProtects:unit=>isSanctuaryProtected(cells,unit),syncSmokeCover,
    activateSmoke,expireSmoke,activateSanctuary,activatePersistentArea,tickSanctuaries,reset});
}

export function sanctuaryFootprint(m,center,radius){
    const origin=TacticalEngine.tile(m,center.x,center.y);
    if(!origin||origin.terrain==='WALL')return[];
    const limit=Math.max(0,Number(radius||0)),seen=new Set([key(origin.x,origin.y)]),queue=[origin],result=[];
    for(let i=0;i<queue.length;i++){
      const current=queue[i],distance=Math.abs(current.x-origin.x)+Math.abs(current.y-origin.y);
      if(distance>limit)continue;
      result.push(current);
      if(distance===limit)continue;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const next=TacticalEngine.tile(m,current.x+dx,current.y+dy);
        if(!next||next.terrain==='WALL')continue;
        const k=key(next.x,next.y);
        if(seen.has(k)||Math.abs(next.x-origin.x)+Math.abs(next.y-origin.y)>limit)continue;
        // A cliff of more than one terrain level blocks the field.
        if(Math.abs(TacticalEngine.elevation(current)-TacticalEngine.elevation(next))>1)continue;
        seen.add(k);queue.push(next);
      }
    }
    return result;
  }
