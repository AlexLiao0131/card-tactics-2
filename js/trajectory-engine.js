export const TrajectoryEngine=(()=>{
  const surfaceZ=(map,x,y)=>Number(TacticalEngine.elevation(TacticalEngine.tile(map,x,y))||0);
  function begin(map,unit,lift=0){
    const ground=surfaceZ(map,unit.x,unit.y),unitZ=Number.isFinite(Number(unit?.z))?Number(unit.z):ground;
    const z=Math.max(unitZ,ground)+Math.max(0,Number(lift||0));
    return {z,state:z>ground?"AIRBORNE":"GROUNDED",fallOrigin:z};
  }
  function inspectStep(map,t,x,y){
    const surface=surfaceZ(map,x,y);
    if(surface>t.z)return{blocked:true,reason:"TERRAIN_FACE",surface,state:t.state,z:t.z};
    if(surface<t.z)return{blocked:false,surface,state:"FALLING",z:t.z,fallOrigin:t.fallOrigin};
    return{blocked:false,surface,state:t.state==="AIRBORNE"?"AIRBORNE":"GROUNDED",z:t.z,fallOrigin:t.fallOrigin};
  }
  function advance(t,i){t.state=i.state;t.z=i.z;t.fallOrigin=i.fallOrigin??t.fallOrigin;return t}
  return Object.freeze({surfaceZ,begin,inspectStep,advance});
})();
globalThis.TrajectoryEngine=TrajectoryEngine;
