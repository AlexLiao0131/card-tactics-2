export const ConductivityEngine=(()=>{
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]],key=(x,y)=>`${x},${y}`;
  function connectedRegion(map,start,{isConductiveTile}={}){
    if(!start||!isConductiveTile?.(start.x,start.y))return[];
    const byKey=new Map((map?.tiles||[]).map(t=>[key(t.x,t.y),t])),seen=new Set(),queue=[start],out=[];
    while(queue.length){
      const p=queue.shift(),k=key(p.x,p.y);if(seen.has(k))continue;seen.add(k);
      const tile=byKey.get(k);if(!tile||!isConductiveTile(tile.x,tile.y))continue;out.push(tile);
      for(const[dX,dY]of DIRS){const n={x:tile.x+dX,y:tile.y+dY},nk=key(n.x,n.y);if(!seen.has(nk)&&byKey.has(nk))queue.push(n)}
    }
    return out;
  }
  return Object.freeze({connectedRegion});
})();
globalThis.ConductivityEngine=ConductivityEngine;
