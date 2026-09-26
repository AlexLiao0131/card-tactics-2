export const TrajectoryEngine=(()=>{
  const surfaceZ=(map,x,y)=>Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0);
  const isAirborneState=state=>state==="AIRBORNE"||state==="FALLING";
  function begin(map,unit,lift=0){
    const tile=TacticalEngine.tile(map,unit.x,unit.y),ground=surfaceZ(map,unit.x,unit.y),unitZ=Number.isFinite(Number(unit?.z))?Number(unit.z):ground;
    const forcedLift=Math.max(0,Number(lift||0));
    const layered=forcedLift<=0&&window.VerticalMobilityEngine&&!VerticalMobilityEngine.contactsGround(unit);
    if(layered){
      const vertical=VerticalMobilityEngine.describe(unit,tile);
      return {z:vertical.physicalZ,state:"LAYERED",layered:true,unit,fallOrigin:vertical.physicalZ};
    }
    const z=Math.max(unitZ,ground)+forcedLift;
    return {z,state:z>ground?"AIRBORNE":"GROUNDED",layered:false,unit,fallOrigin:z};
  }
  function inspectStep(map,t,x,y){
    const tile=TacticalEngine.tile(map,x,y),surface=surfaceZ(map,x,y);
    if(t.layered&&window.VerticalMobilityEngine&&tile){
      const vertical=VerticalMobilityEngine.describe(t.unit,tile);
      return{blocked:false,surface,state:"LAYERED",z:vertical.physicalZ,fallOrigin:t.fallOrigin,verticalMode:vertical.mode};
    }
    if(surface>t.z)return{blocked:true,reason:"TERRAIN_FACE",surface,state:t.state,z:t.z};
    if(surface<t.z)return{blocked:false,surface,state:"FALLING",z:t.z,fallOrigin:t.fallOrigin};
    return{blocked:false,surface,state:t.state==="AIRBORNE"?"AIRBORNE":"GROUNDED",z:t.z,fallOrigin:t.fallOrigin};
  }
  function advance(t,i){t.state=i.state;t.z=i.z;t.fallOrigin=i.fallOrigin??t.fallOrigin;t.layered=i.state==="LAYERED";return t}
  return Object.freeze({surfaceZ,isAirborneState,begin,inspectStep,advance});
})();
globalThis.TrajectoryEngine=TrajectoryEngine;
