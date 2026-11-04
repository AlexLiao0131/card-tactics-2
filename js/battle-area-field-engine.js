/**
 * Canonical persistent battlefield fields (Sanctuary / Smoke).
 * Shared by browser tactical-game and the authoritative Worker. All values
 * originate in SkillDatabase and all effects use the official EffectEngine.
 * This module has no DOM, timers, renderer state or own combat formula.
 */
import {TacticalEngine} from './tactical-engine.js';
import {SkillDatabase} from './skill-database.js';

const key=(x,y)=>`${x},${y}`;
const covers=(field,unit)=>field?.cells instanceof Set
  ? field.cells.has(key(unit.x,unit.y))
  : Array.isArray(field?.cells)&&field.cells.includes(key(unit.x,unit.y));

export function createBattleAreaFieldState(){
  return {sanctuaries:[],smokeFields:[],sanctuarySerial:0,smokeSerial:0};
}
export function isSanctuaryProtected(fields,unit){
  return !!unit?.alive && (fields?.sanctuaries||[]).some(field=>
    field.mode==='HEALING'&&field.team===unit.team&&covers(field,unit));
}
export function createBattleAreaFieldEngine({state,map,units,round,effect,pushLog,handleDefeated}={}){
  if(!state||!Array.isArray(state.sanctuaries)||!Array.isArray(state.smokeFields)||
     ![map,units,round,effect,pushLog,handleDefeated].every(fn=>typeof fn==='function'))
    throw new Error('CANONICAL_AREA_FIELD_CONTEXT_REQUIRED');
  const cells=state;
  const getUnits=()=>units()||[];
  function sanctuaryTiles(center,radius){
    const m=map(),origin=TacticalEngine.tile(m,center.x,center.y);
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
        pushLog(`聖域・庇護 → ${unit.character.name}｜治療 ${healed}、淨化 ${dispelled}。`,'BATTLE');
      }else if(field.mode==='PUNISHMENT'&&unit.team!==field.team){
        const judgement=skill.sanctuary.punishment;
        const outcome=rules.apply({source,target:unit,effect:{type:'MAGIC_DAMAGE',amount:judgement.amount,
          element:judgement.element,traitMultipliers:judgement.traitMultipliers}});
        pushLog(`聖域・懲戒 → ${unit.character.name}｜${outcome.amount||0} 神聖傷害。`,'BATTLE');
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
  function tickSanctuaries(team){
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
  }
  return Object.freeze({state:cells,sanctuaries:cells.sanctuaries,smokeFields:cells.smokeFields,
    sanctuaryTiles,sanctuaryProtects:unit=>isSanctuaryProtected(cells,unit),syncSmokeCover,
    activateSmoke,expireSmoke,activateSanctuary,tickSanctuaries,reset});
}
