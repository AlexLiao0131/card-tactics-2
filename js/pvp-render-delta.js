/**
 * Immutable, seat-scoped Babylon presentation transport codec.
 * The authoritative game and the existing BabylonRenderer remain unchanged.
 * Full frames initialize/recover a stream; normal revisions send only differences.
 * Both the Cloudflare Worker and the browser import this ONE implementation.
 */
const json=value=>JSON.stringify(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(left,right)=>json(left)===json(right);
const copy=value=>structuredClone(value);
const SECTIONS=['units','cores','presentation'];

function validFrame(frame){
  return !!(frame?.type==='PVP_RENDER_SNAPSHOT'&&typeof frame.matchId==='string'&&
    frame.matchId.length>0&&(frame.seat===0||frame.seat===1)&&
    Number.isSafeInteger(frame.revision)&&frame.revision>=0&&
    frame.snapshot?.revision===frame.revision&&
    Array.isArray(frame.snapshot?.map?.tiles)&&
    Array.isArray(frame.snapshot?.units)&&Array.isArray(frame.snapshot?.cores)&&
    plain(frame.snapshot?.presentation));
}

function compatible(previous,current){
  if(!validFrame(previous)||!validFrame(current)||
     previous.matchId!==current.matchId||previous.seat!==current.seat||
     previous.revision>=current.revision)return false;
  const oldTiles=previous.snapshot.map.tiles,nextTiles=current.snapshot.map.tiles;
  if(oldTiles.length!==nextTiles.length)return false;
  for(let i=0;i<nextTiles.length;i++)
    if(oldTiles[i]?.x!==nextTiles[i]?.x||oldTiles[i]?.y!==nextTiles[i]?.y)return false;
  return true;
}

/** Returns a full frame if the old frame is absent, geometry changed, or a patch is too large. */
export function createRenderUpdate(previous,current,{maxDeltaRatio=0.8}={}){
  if(!validFrame(current))throw Error('PVP_RENDER_FRAME_INVALID');
  if(!compatible(previous,current))return current;
  const base=previous.snapshot,next=current.snapshot;
  const delta={};
  const previousTop={...base},nextTop={...next};
  for(const key of ['map',...SECTIONS,'revision']){
    delete previousTop[key];delete nextTop[key];
  }
  if(!same(previousTop,nextTop))delta.top=copy(nextTop);
  const prevMap={...base.map},nextMap={...next.map};
  delete prevMap.tiles;delete nextMap.tiles;
  if(!same(prevMap,nextMap))delta.mapMeta=copy(nextMap);
  const tiles=[];
  for(let i=0;i<next.map.tiles.length;i++)
    if(!same(base.map.tiles[i],next.map.tiles[i]))
      tiles.push([i,copy(next.map.tiles[i])]);
  if(tiles.length)delta.tiles=tiles;
  for(const key of SECTIONS)if(!same(base[key],next[key]))delta[key]=copy(next[key]);
  const packet={type:'PVP_RENDER_DELTA',matchId:current.matchId,
    seat:current.seat,baseRevision:previous.revision,
    revision:current.revision,delta};
  const fullBytes=json(current).length,deltaBytes=json(packet).length;
  if(deltaBytes>=fullBytes*maxDeltaRatio)return current;
  return packet;
}

/** Fail closed on a lost/out-of-order baseline; caller must request a full frame. */
export function applyRenderUpdate(previous,packet){
  if(validFrame(packet))return copy(packet);
  if(!plain(packet)||packet.type!=='PVP_RENDER_DELTA'||
     !validFrame(previous)||previous.matchId!==packet.matchId||
     previous.seat!==packet.seat||previous.revision!==packet.baseRevision||
     !Number.isSafeInteger(packet.revision)||packet.revision<=packet.baseRevision||
     !plain(packet.delta))throw Error('PVP_RENDER_BASELINE_MISMATCH');
  const d=packet.delta;
  const allowed=['top','mapMeta','tiles',...SECTIONS];
  if(Object.keys(d).some(key=>!allowed.includes(key)))throw Error('PVP_RENDER_DELTA_UNKNOWN_FIELD');
  const result=copy(previous);
  const old=result.snapshot;
  if(Object.hasOwn(d,'top')){
    if(!plain(d.top))throw Error('PVP_RENDER_DELTA_TOP_INVALID');
    for(const key of Object.keys(old))if(!['map',...SECTIONS,'revision'].includes(key))delete old[key];
    for(const [key,value] of Object.entries(d.top)){
      if(['map',...SECTIONS,'revision','__proto__','constructor','prototype'].includes(key))
        throw Error('PVP_RENDER_DELTA_TOP_INVALID');
      old[key]=copy(value);
    }
  }
  if(Object.hasOwn(d,'mapMeta')){
    if(!plain(d.mapMeta)||Object.hasOwn(d.mapMeta,'tiles')||
      Object.keys(d.mapMeta).some(k=>['__proto__','prototype','constructor'].includes(k)))
      throw Error('PVP_RENDER_DELTA_MAP_INVALID');
    old.map={...copy(d.mapMeta),tiles:old.map.tiles};
  }
  if(Object.hasOwn(d,'tiles')){
    if(!Array.isArray(d.tiles)||d.tiles.length>old.map.tiles.length)
      throw Error('PVP_RENDER_DELTA_TILES_INVALID');
    const updated=new Set();
    for(const entry of d.tiles){
      if(!Array.isArray(entry)||entry.length!==2||
        !Number.isSafeInteger(entry[0])||entry[0]<0||entry[0]>=old.map.tiles.length||
        updated.has(entry[0])||!plain(entry[1])||
        old.map.tiles[entry[0]]?.x!==entry[1].x||
        old.map.tiles[entry[0]]?.y!==entry[1].y)
        throw Error('PVP_RENDER_DELTA_TILES_INVALID');
      updated.add(entry[0]);
      old.map.tiles[entry[0]]=copy(entry[1]);
    }
  }
  for(const key of SECTIONS)if(Object.hasOwn(d,key)){
    if(key==='presentation'?!plain(d[key]):!Array.isArray(d[key]))
      throw Error('PVP_RENDER_DELTA_SECTION_INVALID');
    old[key]=copy(d[key]);
  }
  result.revision=packet.revision;
  result.snapshot.revision=packet.revision;
  if(!validFrame(result))throw Error('PVP_RENDER_DELTA_RESULT_INVALID');
  return result;
}
