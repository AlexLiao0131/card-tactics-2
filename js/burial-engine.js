export const BurialEngine=(()=>{
  "use strict";
  const key=(x,y)=>`${x},${y}`;
  const clean=n=>Math.max(0,Math.round(Number(n||0)*1000)/1000);
  const bodyHeight=unit=>Math.max(.25,Number(unit?.character?.collision?.height??2));
  const isAirOrSubsurface=unit=>{const mode=String(unit?.verticalState?.mode||"");return !!(globalThis.VerticalMobilityEngine?.isAirborne?.(unit)||globalThis.VerticalMobilityEngine?.isBurrowed?.(unit)||mode==="DIVING"||mode==="SWIMMING");};

  function state(unit){return unit?.burial||null;}
  function totalDepth(unit){return Math.max(0,Number(unit?.burial?.depth||0));}
  function movementPenalty(unit){return Math.max(0,Number(unit?.burial?.movementPenalty||0));}
  function canMove(unit){return !!unit?.alive&&!unit?.burial?.immobilized;}
  function canAct(unit){return !!unit?.alive&&!unit?.burial?.fullyBuried;}

  function clear(unit){
    if(!unit)return false;
    const had=!!unit.burial;
    delete unit.burial;
    delete unit.renderZ;
    return had;
  }

  function syncRenderPose(unit,map){
    if(!unit?.alive||!unit?.burial)return;
    const tile=map?.tiles?.find(t=>t.x===unit.x&&t.y===unit.y);
    if(!tile)return;
    const solid=Math.max(0,Number(unit.burial.solidDepth||0));
    if(solid>0)unit.renderZ=Number(tile.elevation||unit.z||0)-solid;
    else delete unit.renderZ;
  }

  function classify(depth,height){
    const ratio=height>0?depth/height:0;
    return{
      ratio,
      fullyBuried:ratio>=1,
      immobilized:ratio>=.72,
      movementPenalty:ratio>=.55?2:ratio>=.28?1:0,
      stage:ratio>=1?"SUBMERGED":ratio>=.72?"TRAPPED":ratio>=.45?"CHEST":ratio>=.20?"LEGS":"LIGHT"
    };
  }

  function positiveSnowDeposits(events){
    const out=new Map();
    for(const event of events||[]){
      if(event?.type!=="SNOW_DEPTH_CHANGED")continue;
      const delta=Math.max(0,Number(event.to||0)-Number(event.from||0));if(delta<=.0005)continue;
      const source=String(event.source||"").toUpperCase();
      if(!source.includes("FAILURE")&&!source.includes("AVALANCHE"))continue;
      const k=key(event.x,event.y);out.set(k,clean(Number(out.get(k)||0)+delta));
    }
    return out;
  }

  function positiveSolidDeposits(events){
    const out=new Map();
    for(const event of events||[]){
      if(event?.type!=="ELEVATION_CHANGED")continue;
      const source=String(event.source||"").toUpperCase();
      if(!source.includes("FAILURE")&&!source.includes("MASS_FLOW"))continue;
      const deposit=Math.max(0,Number(event.deposit||0)-Number(event.erosion||0),Number(event.deltaElevation||0));
      if(deposit<=.0005)continue;
      const material=String(event.material||"SOIL").toUpperCase(),k=key(event.x,event.y),prev=out.get(k)||{depth:0,material};
      prev.depth=clean(prev.depth+deposit);prev.material=material;out.set(k,prev);
    }
    return out;
  }

  function applyEnvironmentEvents(units,map,events=[]){
    const snow=positiveSnowDeposits(events),solid=positiveSolidDeposits(events),results=[];
    if(!snow.size&&!solid.size)return results;
    for(const unit of units||[]){
      if(!unit?.alive||isAirOrSubsurface(unit))continue;
      const k=key(unit.x,unit.y),snowDepth=Math.max(0,Number(snow.get(k)||0)),solidInfo=solid.get(k),solidDepth=Math.max(0,Number(solidInfo?.depth||0));
      if(snowDepth<=0&&solidDepth<=0)continue;
      const previous=unit.burial||{snowDepth:0,solidDepth:0,depth:0};
      const nextSnow=clean(Number(previous.snowDepth||0)+snowDepth),nextSolid=clean(Number(previous.solidDepth||0)+solidDepth),depth=clean(nextSnow+nextSolid),height=bodyHeight(unit),classification=classify(depth,height);
      unit.burial={snowDepth:nextSnow,solidDepth:nextSolid,depth,height,materials:[...(new Set([...(previous.materials||[]),...(snowDepth>0?["SNOW"]:[]),...(solidDepth>0?[solidInfo?.material||"SOIL"]:[])]))],...classification};
      syncRenderPose(unit,map);
      results.push({type:"UNIT_BURIED",unitId:unit.id,characterId:unit.character?.id||null,name:unit.character?.name||unit.id,x:unit.x,y:unit.y,addedSnow:snowDepth,addedSolid:solidDepth,depth,bodyHeight:height,...classification});
    }
    return results;
  }

  function movementAllowance(unit,baseMove){
    if(!canMove(unit))return 0;
    return Math.max(0,Number(baseMove||0)-movementPenalty(unit));
  }

  return Object.freeze({state,totalDepth,movementPenalty,movementAllowance,canMove,canAct,clear,syncRenderPose,applyEnvironmentEvents});
})();
globalThis.BurialEngine=BurialEngine;
