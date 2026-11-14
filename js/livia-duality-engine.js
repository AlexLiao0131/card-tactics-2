/**
 * Livia's ONE signed-polarity resource (0=blue, 50=neutral, 100=corruption).
 * This is an authoritative gameplay rule shared by browser, offline AI and PVP;
 * Babylon and HUD are read-only consumers. Never attach a second polarity meter.
 */
export const LIVIA_DUALITY_RULES=Object.freeze({
  center:50,blueFull:0,purpleFull:100,roundBlueRecovery:10,
  shadowStepCorruption:18,netherSlashCorruption:22,
  fullFormStatBonusRatio:.15,corruptionHitCount:4,
  purifiedSlashRange:4,purifiedSlashPowerMultiplier:2.0,
  distortionDurationRounds:2,distortionDisplaceChance:.35,
  manaWellRecovery:24,manaWellsPerRound:1,maxManaWells:3,
  corruptionRiskIncreasePerRound:.1,berserkDamageMultiplier:1.25,
  cloakProcChance:.3,cloakMagicDamageMultiplier:.5
});
const R=LIVIA_DUALITY_RULES;
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const tileKey=(x,y)=>`${x},${y}`;
const sameTeam=(a,b)=>String(a)===String(b);
const isLivia=u=>u?.character?.id==='livia';
const isHighDimension=s=>s?.id==='shadow_step'||s?.id==='nether_slash';
const live=u=>u?.alive!==false;
const polarity=u=>isLivia(u)?clamp(asNumber(u?.resources?.duality?.value??R.center),0,100):null;
function initialize(u){
  if(!isLivia(u))return null;
  u.resources??={};
  const entry=u.resources.duality;
  if(!entry)u.resources.duality={label:'雙極',value:R.center,max:100};
  else{entry.value=clamp(asNumber(entry.value),0,100);entry.max=100;entry.label='雙極';}
  if(!Number.isInteger(u._liviaRound))u._liviaRound=1;
  if(!Number.isInteger(u._liviaCorruptionRounds))u._liviaCorruptionRounds=0;
  if(!Number.isInteger(u._liviaHoldUntil))u._liviaHoldUntil=0;
  return u.resources.duality;
}
function status(u){const v=polarity(u);return{
  value:v,blueFull:v===R.blueFull,purpleFull:v===R.purpleFull,
  mode:v===R.blueFull?'COMPLETE':v===R.purpleFull?'CORRUPTED':'NORMAL',
  corruptionRounds:Number(u?._liviaCorruptionRounds||0),
  berserk:!!u?._liviaBerserkEndRound
};}
function setPolarity(u,value){const r=initialize(u);if(!r)return 0;
  const prev=r.value;r.value=clamp(Math.round(asNumber(value)),0,100);
  if(prev!==r.value){globalThis.EffectEngine?.syncModifiers?.(u);}
  if(r.value!==R.purpleFull)u._liviaCorruptionRounds=0;
  return r.value-prev;
}
function afterCommittedSkill(u,s){
  if(!isLivia(u)||!s||s.purifiedSlash)return;
  const cur=polarity(u);if(!isHighDimension(s))return;
  const delta=s.id==='shadow_step'?R.shadowStepCorruption:R.netherSlashCorruption;
  if(cur<R.purpleFull)setPolarity(u,cur+delta);
  if(polarity(u)===R.purpleFull){
    // One FULL future natural-recovery opportunity is skipped. Every actual
    // high-dimensional skill commit refreshes the hold. Merely selecting a
    // skill, aiming, canceling, or a failed cast NEVER refreshes it.
    u._liviaHoldUntil=Number(u._liviaRound||1)+1;
  }
}
function transformedSkill(u,skill){
  if(!skill||!isLivia(u)||!isHighDimension(skill))return skill;
  const v=polarity(u);
  if(v===R.blueFull&&skill.id==='nether_slash'){
    return{...skill,name:'奧義・淨界斬',category:'SPECIAL',target:'TILE',targetType:'AOE',
      range:{min:1,max:R.purifiedSlashRange},shape:'FAN',radius:0,
      purifiedSlash:{length:R.purifiedSlashRange,powerMultiplier:R.purifiedSlashPowerMultiplier},
      description:'【完整型態・淨化奧義】水晶共鳴將黑劍延伸為巨大藍白光刃，對前方扇形範圍敵軍作一次高威力空間斬擊；斬過的地格留下施放後兩個完整回合的空間扭曲，敵軍移入時可能偏移落點。施放後雙極回到中央，完整型態增益結束。',
      support:false};
  }
  if(v===R.purpleFull){
    if(skill.id==='nether_slash')return{...skill,name:'奧義・幽影連斬',hitCount:R.corruptionHitCount,
      description:'【高維污染解放】四段獨立判定的空間連續斬擊。持續施放可維持紫色滿值，但每回合失控風險會上升。'};
    if(skill.id==='shadow_step')return{...skill,name:'幽影步・高維解放',
      description:'【高維污染解放】維持空間位移能力；使用後延長紫色滿值期間的恢復停頓，並增加持續污染風險。'};
  }
  return skill;
}
function resetBlueAfterUltimate(u){
  if(!isLivia(u))return false;
  setPolarity(u,R.center);
  u._liviaCorruptionRounds=0;u._liviaHoldUntil=0;
  return true;
}
function statBonus(u){
  return isLivia(u)&&polarity(u)===R.blueFull?R.fullFormStatBonusRatio:0;
}
function accessibleTiles(map,units,unit){
  if(!map?.tiles||!unit?.alive||!globalThis.TacticalEngine)return[];
  // Reachability over multiple future moves; not merely one-turn movement.
  // Use the same elevation, occupancy and block rules as official movement.
  const lookup=new Map(map.tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
  const start=tileKey(unit.x,unit.y),queue=[lookup.get(start)].filter(Boolean),seen=new Set([start]);
  const candidates=[];
  while(queue.length){
    const from=queue.shift();
    for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){
      const next=lookup.get(tileKey(from.x+dx,from.y+dy));if(!next)continue;
      const k=tileKey(next.x,next.y);if(seen.has(k))continue;
      if(!globalThis.TacticalEngine.canOccupyTerrain(unit,next)||
        globalThis.TacticalEngine.isBlockedByObject(map,next.x,next.y,unit)||
        !globalThis.TacticalEngine.canTraverseElevation(from,next,unit))continue;
      if((units||[]).some(u=>u!==unit&&live(u)&&u.occupiesTile!==false&&u.x===next.x&&u.y===next.y))continue;
      seen.add(k);queue.push(next);candidates.push(next);
    }
  }
  return candidates;
}
function spawnWells(map,units,round,random=Math.random){
  if(!map?.tiles)return 0;
  map.manaWells??=[];
  // A new round cannot create a second copy of an occupied coordinate.
  let spawned=0;
  map.manaWellSpawnedRounds??={};
  for(const livia of (units||[]).filter(u=>live(u)&&isLivia(u)&&u.team!=='N')){
    if(map.manaWellSpawnedRounds[livia.team]===round)continue;
    const owned=map.manaWells.filter(w=>sameTeam(w.team,livia.team));
    if(owned.length>=R.maxManaWells)continue;
    const occupied=new Set(map.manaWells.map(w=>tileKey(w.x,w.y)));
    const eligible=accessibleTiles(map,units,livia).filter(t=>!occupied.has(tileKey(t.x,t.y))&&
      !Number.isNaN(Number(t.elevation)));
    if(!eligible.length)continue;
    const count=Math.min(R.manaWellsPerRound,R.maxManaWells-owned.length);
    for(let i=0;i<count&&eligible.length;i++){
      const idx=Math.min(eligible.length-1,Math.floor(clamp(random(),0,.999999999)*eligible.length));
      const tile=eligible.splice(idx,1)[0];
      map.manaWells.push({x:tile.x,y:tile.y,team:livia.team,amount:R.manaWellRecovery,spawnRound:round});
      spawned++;map.manaWellSpawnedRounds[livia.team]=round;
    }
  }
  return spawned;
}
function createDistortion(map,team,tiles,round){
  if(!map?.tiles||!Array.isArray(tiles)||!tiles.length)return 0;
  map.spatialDistortions??=[];
  const normalized=[...new Set(tiles.map(t=>tileKey(t.x,t.y)))].map(k=>{const[x,y]=k.split(',').map(Number);return{x,y};});
  map.spatialDistortions.push({team,cells:normalized,fromRound:round,// Duration counts COMPLETE future battle rounds. A cast on round N
  // remains active through N+1 and N+2; expiration runs at the start of N+3.
  // All clients/Worker/renderer use the same exclusive expireRound boundary.
  expireRound:round+R.distortionDurationRounds+1});
  return normalized.length;
}
function eligibleWarpLanding(map,units,unit,from,to){
  if(!from||!to||!globalThis.TacticalEngine?.canOccupyTerrain?.(unit,to)||
      globalThis.TacticalEngine.isBlockedByObject(map,to.x,to.y,unit)||
      !globalThis.TacticalEngine.canTraverseElevation(from,to,unit))return false;
  return !(units||[]).some(other=>other!==unit&&live(other)&&other.occupiesTile!==false&&other.x===to.x&&other.y===to.y);
}
function onEnterTile(map,units,unit,round,{random=Math.random}={}){
  if(!map||!unit?.alive)return{restored:0,distorted:false};
  let restored=0;
  const well=(map.manaWells||[]).find(w=>w.x===unit.x&&w.y===unit.y&&sameTeam(w.team,unit.team));
  if(well&&Number(unit.mana)<Number(unit.maxMana)){
    restored=globalThis.UnitRuntimeEngine?.restoreMana?.(unit,well.amount)||0;
    if(restored>0)map.manaWells.splice(map.manaWells.indexOf(well),1);
  }
  const active=(map.spatialDistortions||[]).filter(field=>field.expireRound>round&&
    !sameTeam(field.team,unit.team)&&field.cells.some(cell=>cell.x===unit.x&&cell.y===unit.y));
  if(!active.length||unit._liviaWarpActionChecked)return{restored,distorted:false};
  unit._liviaWarpActionChecked=true;
  if(random()>=R.distortionDisplaceChance)return{restored,distorted:false};
  const at=globalThis.TacticalEngine.tile(map,unit.x,unit.y);
  const neighbors=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>
    globalThis.TacticalEngine.tile(map,at.x+dx,at.y+dy)).filter(t=>eligibleWarpLanding(map,units,unit,at,t));
  // When no neighboring exit is legal, prefer the move origin (if legal),
  // otherwise interrupt on the current legal tile without a fake teleport.
  if(!neighbors.length){
    const from=unit._liviaEntryFrom;
    const origin=from&&globalThis.TacticalEngine.tile(map,from.x,from.y);
    if(!origin||!eligibleWarpLanding(map,units,unit,at,origin))
      return{restored,distorted:true,stopped:true};
    neighbors.push(origin);
  }
  const chosen=neighbors[Math.floor(clamp(random(),0,.999999)*neighbors.length)];
  const previous={x:unit.x,y:unit.y};unit.x=chosen.x;unit.y=chosen.y;
  globalThis.VerticalMobilityEngine?.syncUnit?.(unit,chosen);
  if(!globalThis.VerticalMobilityEngine?.syncUnit)unit.z=Number(chosen.elevation||0);
  globalThis.UnitAnimationEngine?.emitMove?.(unit,{from:previous,kind:'TELEPORT'});
  return{restored,distorted:true,from:previous,to:{x:unit.x,y:unit.y}};
}
function beginMove(unit){
  if(!unit)return;
  delete unit._liviaWarpActionChecked;
  delete unit._liviaMoveInteracted;
  delete unit._liviaMoveInterrupted;
  unit._liviaMoveActionActive=true;
}
function endMove(unit){
  if(!unit)return;
  delete unit._liviaWarpActionChecked;
  delete unit._liviaMoveActionActive;
  delete unit._liviaEntryFrom;
}
/** The authoritative environment calls stageEvent(ENTER_TILE) for EVERY
 * traversal, shove, current, teleport and landing; this is the sole resolver.
 * A move wrapper marks action start/end, not a parallel entry simulation. */
function handleEntry(world,unit,{random=Math.random,log=()=>{},commit=()=>{}}={}){
  if(!unit?.alive)return{restored:0,distorted:false};
  const effect=onEnterTile(world.map,world.units,unit,world.round,{random});
  if(effect.restored>0){unit._liviaMoveInteracted=true;
    log(`${unit.character.name} 回復 ${effect.restored} MP。`);
  }
  if(effect.distorted){unit._liviaMoveInteracted=true;unit._liviaMoveInterrupted=true;
    log(`${unit.character.name} 進入空間扭曲，偏離預定落點。`);
  }
  if(effect.restored>0||effect.distorted)commit(unit);
  // Forced entries are standalone actions; do not silently carry a visited
  // field roll across an unrelated later current, knockback or teleport.
  if(!unit._liviaMoveActionActive)delete unit._liviaWarpActionChecked;
  return effect;
}
function onRoundStart({map,units,round,random=Math.random}={}){
  if(!Number.isInteger(round))return{rounds:0,berserk:[]};
  if(map?.spatialDistortions)map.spatialDistortions=map.spatialDistortions.filter(f=>f.expireRound>round);
  const berserk=[];
  for(const unit of units||[]){
    if(!isLivia(unit)||!live(unit))continue;
    initialize(unit);
    if(unit._liviaBerserkEndRound&&round>unit._liviaBerserkEndRound){
      completeBerserk(unit);
    }
    unit._liviaRound=round;
    if(unit._liviaBerserkEndRound)continue;
    if(polarity(unit)===R.purpleFull){
      unit._liviaCorruptionRounds++;
      const risk=clamp((unit._liviaCorruptionRounds-1)*R.corruptionRiskIncreasePerRound,0,1);
      if(risk>0&&random()<risk){
        unit._liviaOriginalTeam=unit.team;
        unit._liviaOriginalParticipation=unit.participatesInTurn!==false;
        // Ordinary neutral AI must not run this temporary actor a second time.
        unit.participatesInTurn=false;
        unit.team='N';unit._liviaBerserkEndRound=round;
        delete unit._liviaBerserkActionDone;
        unit._liviaCorruptionRounds=0;
        berserk.push(unit.id);continue;
      }
    }
    if(round>unit._liviaHoldUntil){setPolarity(unit,polarity(unit)-R.roundBlueRecovery);}
  }
  spawnWells(map,units,round,random);
  return{round,berserk};
}
function completeBerserk(unit){
  if(!isLivia(unit)||!unit._liviaBerserkEndRound)return false;
  unit.team=unit._liviaOriginalTeam;
  unit.participatesInTurn=unit._liviaOriginalParticipation!==false;
  delete unit._liviaOriginalTeam;delete unit._liviaOriginalParticipation;
  delete unit._liviaBerserkEndRound;delete unit._liviaBerserkActionDone;
  unit._liviaCorruptionRounds=0;
  setPolarity(unit,R.center);
  return true;
}
/** Command on an already-converted neutral actor. No browser-side decisions and
 * no new combat formulas. Uses the same BattleResolution + resource/skill runtime.
 * The caller chooses when the neutral round action is scheduled. */
function chooseBerserkAttack({map,units,unit,runtime,random=Math.random,environmentState=null}={}){
  if(!isLivia(unit)||unit.team!=='N'||!unit.alive)return null;
  const skills=(unit.character?.skills||[]).map(id=>globalThis.SkillDatabase?.get?.(id)).filter(s=>
    s&&s.target==='ENEMY'&&(!s.targetType||s.targetType==='SINGLE')&&
    s.weapon&&!s.utilityAction&&runtime?.canUseSkill?.(unit,s));
  const valid=[];
  for(const skill of skills){
    const active=runtime.skillForUnit(unit,skill);
    for(const target of units||[]){
      if(!target.alive||target.id===unit.id||target.team==='N')continue;
      if(globalThis.TacticalEngine?.canTarget?.(map,unit,target,active,environmentState)&&
        (!globalThis.TacticalEngine.actorCanTrackTarget||
          globalThis.TacticalEngine.actorCanTrackTarget(map,units,unit,target,environmentState,{map,units,environmentState})))
        valid.push({skill:active,target});
    }
  }
  if(!valid.length)return null;
  return valid[Math.min(valid.length-1,Math.floor(clamp(random(),0,.999999)*valid.length))];
}
/** A berserk actor's policy first chooses a RANDOM legal target among both
 * former allies and enemies; when none are in range, use the unchanged
 * TacticalEngine pathfinder for exactly one normal movement allowance. */
function chooseBerserkMove({map,units,unit,random=Math.random,environmentState=null}={}){
  if(!map||!unit?.alive||unit.team!=='N')return[];
  const tactical=globalThis.TacticalEngine;
  if(!tactical?.reachable||!tactical?.pathTo)return[];
  const observers=(units||[]).filter(other=>other?.alive&&other.id!==unit.id&&
    other.team!=='N'&&other.occupiesTile!==false&&
    (!tactical.actorCanTrackTarget||tactical.actorCanTrackTarget(map,units,unit,other,environmentState)));
  if(!observers.length)return[];
  const target=observers[Math.floor(clamp(random(),0,.999999)*observers.length)];
  const locations=[...tactical.reachable(map,units,unit)].map(([key,cost])=>{
    const [x,y]=key.split(',').map(Number);
    return{x,y,cost,distance:Math.abs(x-target.x)+Math.abs(y-target.y)};
  }).filter(cell=>cell.distance<Math.abs(target.x-unit.x)+Math.abs(target.y-unit.y));
  if(!locations.length)return[];
  const best=Math.min(...locations.map(v=>v.distance));
  const eligible=locations.filter(v=>v.distance===best);
  const landing=eligible[Math.floor(clamp(random(),0,.999999)*eligible.length)];
  return tactical.pathTo(map,units,unit,landing.x,landing.y)||[];
}
function magicCloak(unit){return !!unit?.character?.equipment?.some(item=>item?.affixes?.includes('MAGIC_RESIST'))}
function resistMagic(unit,amount,{random=Math.random,unresistable=false}={}){
  const before=Math.max(0,Math.round(asNumber(amount)));
  if(before===0||unresistable||!magicCloak(unit))return{damage:before,blocked:0,triggered:false};
  const triggered=random()<R.cloakProcChance;
  const after=triggered?Math.round(before*R.cloakMagicDamageMultiplier):before;
  return{damage:after,blocked:before-after,triggered};
}
export const LiviaDualityEngine=Object.freeze({RULES:R,isLivia,polarity,initialize,status,setPolarity,
  transformedSkill,afterCommittedSkill,resetBlueAfterUltimate,statBonus,
  onRoundStart,spawnWells,createDistortion,onEnterTile,handleEntry,beginMove,endMove,completeBerserk,chooseBerserkAttack,chooseBerserkMove,resistMagic});
globalThis.LiviaDualityEngine=LiviaDualityEngine;
