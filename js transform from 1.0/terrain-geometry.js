(()=>{
"use strict";
const key=(x,y)=>`${x},${y}`;
const surfaceElevation=t=>{
  const z=window.HydrologyEngine?.waterSurfaceZ?.(t);
  return z==null?Number(t?.elevation||0):Number(z);
};
function build(map){
  const tiles=map?.tiles||[],byKey=new Map(tiles.map(t=>[key(t.x,t.y),t])),tops=[],sides=[];
  const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
  for(const tile of tiles){
    const elevation=surfaceElevation(tile);
    tops.push({id:`top:${tile.x},${tile.y}`,tile,x:tile.x,y:tile.y,elevation});
    dirs.forEach(([dx,dy],edge)=>{
      const neighbor=byKey.get(key(tile.x+dx,tile.y+dy));
      if(!neighbor)return;
      const bottom=surfaceElevation(neighbor);
      if(elevation<=bottom)return;
      for(let level=elevation;level>bottom;level--)
        sides.push({id:`side:${tile.x},${tile.y}:${edge}:${level}`,tile,x:tile.x,y:tile.y,edge,topElevation:level,bottomElevation:level-1,levels:1});
    });
  }
  return{tops,sides};
}
window.TerrainGeometry={build,surfaceElevation};
})();