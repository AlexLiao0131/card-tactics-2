/**
 * Shared perception / mirror-battle rules for single-player, Gemini and PvP.
 *
 * No renderer, browser, Durable Object, network or alternate combat math.
 * The host supplies the existing TacticalEngine, world references, item storage,
 * resource engine and random stream. State is plain structured-cloneable data.
 * The host MUST settle an affected side's turn before scheduling the next.
 */
export function clonePerceptionRuntime(value,seen=new WeakMap()) {
  if(typeof value==='function'||typeof value==='symbol')return undefined;
  if(value===null||typeof value!=='object')return value;
  if(seen.has(value))return seen.get(value);
  const tag=Object.prototype.toString.call(value);
  if(tag==='[object Date]')return new Date(value.getTime());
  if(tag==='[object ArrayBuffer]')return value.slice(0);
  if(tag==='[object DataView]')return new DataView(clonePerceptionRuntime(value.buffer,seen),value.byteOffset,value.byteLength);
  if(ArrayBuffer.isView(value))return new value.constructor(value);
  const result=tag==='[object Map]'?new Map():tag==='[object Set]'?new Set():Array.isArray(value)?[]:{};
  seen.set(value,result);
  if(tag==='[object Map]'){
    for(const [key,item]of value)result.set(clonePerceptionRuntime(key,seen),clonePerceptionRuntime(item,seen));
  }else if(tag==='[object Set]'){
    for(const item of value)result.add(clonePerceptionRuntime(item,seen));
  }else for(const [key,item]of Object.entries(value)){
    if(typeof item!=='function'&&typeof item!=='symbol')result[key]=clonePerceptionRuntime(item,seen);
  }
  return result;
}

export function createBattlePerceptionState(){return{pending:{},serial:0,session:null};}

/** All callbacks are synchronous; callers own transaction/rollback boundaries. */
export function createBattlePerceptionEngine({state,world,replaceWorld,tactical,unitRuntime,
  itemDatabase=()=>null,groundItems=()=>[],restoreGroundItems=()=>{},cardStates=()=>[],
  random=Math.random,teams={PLAYER:'P',ENEMY:'E',NEUTRAL:'N'},onSwitch=()=>{},
  onRestore=()=>{},storeRuntimeMap=true}={}) {
  if(!state||typeof world!=='function'||typeof replaceWorld!=='function'||!tactical)
    throw new Error('PERCEPTION_ENGINE_DEPENDENCIES_REQUIRED');
  state.pending??={};state.serial??=0;state.session??=null;
  const realWorld=()=>state.session?.real||world();
  const activeFor=team=>!!state.session?.active&&state.session.team===team;
  const sessionRealUnit=mirror=>state.session?.active&&mirror?.mirrorOfUnitId?
    state.session.real.units.find(unit=>unit.id===mirror.mirrorOfUnitId)||null:null;
  function charge(mirrorUnit,spent){
    if(!spent||!state.session?.active||mirrorUnit?.hallucination||
       mirrorUnit?.team!==state.session.team)return false;
    const realUnit=sessionRealUnit(mirrorUnit);
    if(!realUnit||realUnit.team!==state.session.team)return false;
    realUnit.mana=Math.max(0,Number(realUnit.mana||0)-Math.max(0,Number(spent.cost||0)));
    for(const [key,payment]of Object.entries(spent.resources||{})){
      const resource=realUnit.resources?.[key];if(!resource)continue;
      resource.value=Math.max(0,Number(resource.value||0)-Math.max(0,Number(payment?.cost||0)));
    }
    return true;
  }
  function visibleHostilesFor(team,source=world()){
    const observers=(source.units||[]).filter(u=>u?.alive&&u.team===team&&!u.hallucination);
    const hostiles=(source.units||[]).filter(u=>u?.alive&&u.team!==team&&!u.hallucination&&u.team!==teams.NEUTRAL);
    if(!observers.length)return [];
    return hostiles.filter(target=>observers.some(observer=>tactical.canSee(source.map,observer,target,source.environmentState||null)));
  }
  function schedule({source,targetTeam,skill,action}={}){
    if(!source?.alive||![teams.PLAYER,teams.ENEMY].includes(targetTeam)||targetTeam===source.team)return null;
    const observed=visibleHostilesFor(targetTeam).map(unit=>unit.id);
    const existing=state.pending[targetTeam];
    const turns=Math.max(1,Number(action?.durationTurns||1));
    const illusionCount=Math.max(0,Number(action?.illusionCount||2));
    const record={targetTeam,sourceUnitId:source.id,sourceSkillId:skill?.id||null,
      turnsRemaining:Math.max(turns,Number(existing?.turnsRemaining||0)),
      illusionCount:Math.max(illusionCount,Number(existing?.illusionCount||0)),
      observedSourceIds:[...new Set([...(existing?.observedSourceIds||[]),...observed])]};
    state.pending[targetTeam]=record;return record;
  }
  function inject(record,mirror){
    const {map,units,cores,environmentState}=mirror;
    const observers=units.filter(u=>u?.alive&&u.team===record.targetTeam&&!u.hallucination);
    const occupied=new Set(units.filter(u=>u?.alive).map(u=>`${u.x},${u.y}`));
    const coreCells=new Set((cores||[]).map(core=>`${core.x},${core.y}`));
    const candidates=map.tiles.filter(tile=>!occupied.has(`${tile.x},${tile.y}`)&&
      !coreCells.has(`${tile.x},${tile.y}`)&&observers.some(observer=>tactical.canSee(map,observer,tile,environmentState||null)));
    const sources=(record.observedSourceIds||[]).map(id=>units.find(u=>u.id===id&&u.alive&&!u.hallucination&&u.team!==record.targetTeam)).filter(Boolean);
    if(!sources.length||!candidates.length)return[];
    const made=[],count=Math.min(Math.max(0,Number(record.illusionCount||2)),candidates.length);
    for(let i=0;i<count;i++){
      const source=sources[i%sources.length];
      const valid=candidates.filter(tile=>tactical.canOccupyTerrain(source,tile)&&!tactical.isBlockedByObject(map,tile.x,tile.y,source));
      if(!valid.length)break;
      const tile=valid[Math.floor(random()*valid.length)],fake=clonePerceptionRuntime({...source,_runtimeMap:null});
      fake.id=`hallucination_${++state.serial}`;fake.x=tile.x;fake.y=tile.y;
      fake.z=Number(tactical.elevation(tile)||0);fake.hp=1;fake.alive=true;
      fake.hallucination=true;fake.mirrorOnly=true;fake.mirrorOfUnitId=null;
      fake.hallucinationSourceId=source.id;
      fake.perceivedHp=Math.max(1,Number(source.hp||source.character?.combat?.hp||1));
      fake.perceivedMaxHp=Math.max(fake.perceivedHp,Number(source.character?.combat?.hp||fake.perceivedHp));
      fake.cardId=null;fake.effects=(fake.effects||[]).filter(effect=>effect?.type!=='STEALTH');
      fake.participatesInTurn=false;fake.canCapture=false;fake.countsForObjectives=false;
      fake.moved=true;fake.acted=true;fake.waited=true;
      if(storeRuntimeMap)fake._runtimeMap=map;
      units.push(fake);occupied.add(`${tile.x},${tile.y}`);made.push(fake);
      const index=candidates.indexOf(tile);if(index>=0)candidates.splice(index,1);
    }
    return made;
  }
  function begin(team){
    if(state.session?.active)return false;
    const record=state.pending[team];if(!record||Number(record.turnsRemaining||0)<=0)return false;
    const real=world(),groundSnapshot=groundItems()||[];
    const mirror={...clonePerceptionRuntime(Object.fromEntries(Object.entries(real).filter(([key])=>!['map','units','stage','stageState','environmentState','cores'].includes(key)))),
      map:clonePerceptionRuntime(real.map),stage:clonePerceptionRuntime(real.stage),
      stageState:clonePerceptionRuntime(real.stageState),
      environmentState:clonePerceptionRuntime(real.environmentState),
      cores:clonePerceptionRuntime(real.cores),
      units:real.units.map(unit=>clonePerceptionRuntime({...unit,_runtimeMap:null}))};
    for(const unit of mirror.units){if(storeRuntimeMap)unit._runtimeMap=mirror.map;unit.mirrorOfUnitId=unit.id;}
    inject(record,mirror);
    // Construct the isolated world completely before switching references.
    replaceWorld(mirror);
    state.session={active:true,team,real,groundSnapshot,record,
      // Death/graveyard effects in the perception battle must never mutate
      // actual card zones; only real played-card expenditures persist.
      defeatCards:clonePerceptionRuntime(cardStates()),};
    record.turnsRemaining=Math.max(0,Number(record.turnsRemaining||1)-1);
    if(record.turnsRemaining<=0)delete state.pending[team];else state.pending[team]=record;
    onSwitch();return true;
  }
  function livePayloadIds(){
    const ids=new Set();
    for(const unit of world().units||[])for(const key of ['inventory','cargo'])
      for(const payload of unit?.[key]||[])if(payload?.id)ids.add(payload.id);
    for(const payload of groundItems()||[])if(payload?.id)ids.add(payload.id);
    return ids;
  }
  function reconcileConsumedItems(realUnit,liveIds){
    for(const key of ['inventory','cargo']){
      const original=Array.isArray(realUnit?.[key])?realUnit[key]:[];
      realUnit[key]=original.filter(payload=>{
        if(!payload?.id)return true;
        if(liveIds.has(payload.id))return true;
        const item=itemDatabase()?.get?.(payload.itemId);
        return item?.use?.consume!==true;
      });
    }
  }
  function end(team){
    const session=state.session;if(!session?.active||session.team!==team)return false;
    const liveIds=livePayloadIds();
    for(const mirrorUnit of world().units||[]){
      if(!mirrorUnit?.mirrorOfUnitId||mirrorUnit.hallucination)continue;
      const realUnit=session.real.units.find(unit=>unit.id===mirrorUnit.mirrorOfUnitId)||null;
      if(!realUnit)continue;
      if(mirrorUnit.team===session.team){
        realUnit.moved=!!mirrorUnit.moved;realUnit.acted=!!mirrorUnit.acted;
        realUnit.waited=!!mirrorUnit.waited;
        realUnit.itemInteractionUsed=Number(mirrorUnit.itemInteractionUsed||0);
        // Only the affected actor's actual expenditures cross the simulation
        // boundary. Autonomous mirrored opponents have NO real-world side effects.
        reconcileConsumedItems(realUnit,liveIds);
      }
    }
    replaceWorld(session.real);
    restoreGroundItems(session.groundSnapshot);
    state.session=null;
    onRestore();return true;
  }
  function reset(){state.session=null;state.pending={};}
  return Object.freeze({schedule,begin,end,charge,inject,activeFor,realWorld,reset});
}
