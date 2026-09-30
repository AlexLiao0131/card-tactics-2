import { TILE_SIZE,ELEVATION_HEIGHT } from "./coordinate-system.js";
import { VisualSurfaceResolver } from "./visual-surface-resolver.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(x,y)=>`${x},${y}`;
const waterDepth=tile=>Math.max(0,Number(tile?.waterDepth||0));
const logicalSurface=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+waterDepth(tile)
  :Number(tile.waterSurfaceZ);

const SURFACE_OFFSET=.016;
const EPSILON=.001;
const MIN_WATER_DEPTH=.12;
const WATERFALL_MIN_DROP=.18;
const SHORE_EPSILON=.002;
const SHORE_CONVEX_INSET=.20;
const SHORE_PAIR_INSET=.08;
const SHORE_CONCAVE_OUTSET=.10;
const SHORE_EDGE_RELAX=.38;
const SHORE_SEARCH_STEPS=12;
const SHORE_RUGGEDNESS=.11;
const WATER_DEPTH_RANGE=1.5;
const WATER_SHALLOW_COLOR=Object.freeze([.43,.78,.72]);
const WATER_DEEP_COLOR=Object.freeze([.045,.23,.38]);
const WATER_MURKY_COLOR=Object.freeze([.29,.31,.18]);
const WATER_SHALLOW_ALPHA=.34;
const WATER_DEEP_ALPHA=.82;

const DIRS=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}
]);
const EDGE_DIR_BY_RING=Object.freeze({
  1:{dx:0,dy:-1},3:{dx:1,dy:0},5:{dx:0,dy:1},7:{dx:-1,dy:0}
});
const CORNER_DIR_BY_RING=Object.freeze({
  0:{dx:-1,dy:-1},2:{dx:1,dy:-1},4:{dx:1,dy:1},6:{dx:-1,dy:1}
});
const EDGE_CORNERS=Object.freeze({
  1:[0,2],3:[2,4],5:[4,6],7:[6,0]
});

function visualSurface(tile){
  // Rendering consumes the real hydrology surface. No quantized LEVEL_STEP layer.
  return logicalSurface(tile);
}
function hasAnyWater(tile){
  return waterDepth(tile)>EPSILON;
}
function hasVisibleWater(tile){
  return waterDepth(tile)>MIN_WATER_DEPTH;
}
function average(values){
  return values.length?values.reduce((sum,value)=>sum+Number(value||0),0)/values.length:0;
}
function hash01(value){
  const text=String(value||"");let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return(h>>>0)/4294967295;
}
function smooth01(value){
  const t=clamp(value,0,1);
  return t*t*(3-2*t);
}
function mixColor(a,b,t){
  const q=clamp(t,0,1);
  return[
    a[0]+(b[0]-a[0])*q,
    a[1]+(b[1]-a[1])*q,
    a[2]+(b[2]-a[2])*q
  ];
}

export class WaterRenderer{
  constructor(scene,terrainRenderer=null){
    this.scene=scene;
    this.surfaceResolver=terrainRenderer?.surfaceResolver||new VisualSurfaceResolver();
    this.surfaceMeshes=new Map();
    this.surfaceAnimations=new Map();
    this.cascades=new Map();
    this.surfaceSignature="";
    this.cascadeSignature="";
    this.waveTime=0;
    this.waveAccumulator=0;
    this.wind={x:0,z:0,strength:0};

    this.surfaceMaterial=this.makeSurfaceMaterial();

    const cascade=this.makeCascadeMaterial();
    this.cascadeMaterial=cascade.material;
    this.cascadeTexture=cascade.texture;
    this.foamMaterial=this.makeSideMaterial("water-foam",new BABYLON.Color3(.78,.93,1),.52);

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      this.waveTime+=dt;
      this.waveAccumulator+=dt;
      if(this.waveAccumulator>=1/30){
        this.waveAccumulator=0;
        for(const entry of this.surfaceAnimations.values())this.animateSurface(entry,this.waveTime);
      }
      this.cascadeTexture.vOffset=(this.cascadeTexture.vOffset-dt*.72)%1;
      for(const entry of this.cascades.values()){
        entry.foam.rotation.y+=dt*.7;
        const p=1+Math.sin(performance.now()/300+entry.phase)*.055;
        entry.foam.scaling.set(1.08*p,.38,.45*p);
      }
    });
  }

  makeSurfaceMaterial(){
    // Stylized water belongs to the same low-poly visual language as the terrain.
    // Depth, transparency and colour come from shared mesh vertex colours instead
    // of a reflective WaterMaterial that fights the hand-painted presentation.
    const m=new BABYLON.StandardMaterial("water-surface-stylized",this.scene);
    m.diffuseColor=BABYLON.Color3.White();
    m.ambientColor=BABYLON.Color3.White();
    m.emissiveColor=new BABYLON.Color3(.025,.055,.065);
    m.specularColor=new BABYLON.Color3(.16,.23,.27);
    m.specularPower=28;
    m.alpha=1;
    m.backFaceCulling=false;
    // Vertex-alpha water must not write an opaque depth pre-pass. Safari/WebGL can
    // otherwise reveal dark hairline seams where adjacent transparent triangles
    // meet or where a shallow shoreline overlays the terrain below.
    m.needDepthPrePass=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null){
      m.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    }
    return m;
  }

  makeSideMaterial(name,color,alpha){
    const m=new BABYLON.StandardMaterial(name,this.scene);
    m.diffuseColor=color;
    m.emissiveColor=color.scale(.08);
    m.alpha=alpha;
    m.specularColor=new BABYLON.Color3(.10,.16,.22);
    m.specularPower=18;
    m.backFaceCulling=false;
    m.needDepthPrePass=true;
    return m;
  }

  makeCascadeMaterial(){
    const texture=new BABYLON.DynamicTexture("cascade-flow-texture",{width:96,height:256},this.scene,false);
    texture.hasAlpha=true;
    const ctx=texture.getContext();
    ctx.clearRect(0,0,96,256);
    const gradient=ctx.createLinearGradient(0,0,96,0);
    gradient.addColorStop(0,"rgba(170,225,255,0.18)");
    gradient.addColorStop(.5,"rgba(225,248,255,0.62)");
    gradient.addColorStop(1,"rgba(150,215,250,0.16)");
    ctx.fillStyle=gradient;
    ctx.fillRect(0,0,96,256);
    ctx.strokeStyle="rgba(255,255,255,0.55)";
    ctx.lineWidth=3;
    for(let y=8;y<256;y+=34){
      ctx.beginPath();
      ctx.moveTo(8,y);
      ctx.bezierCurveTo(30,y+8,62,y-8,88,y+2);
      ctx.stroke();
    }
    texture.update();
    texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapU=BABYLON.Texture.WRAP_ADDRESSMODE;

    const material=new BABYLON.StandardMaterial("cascade-water",this.scene);
    material.diffuseTexture=texture;
    material.opacityTexture=texture;
    material.emissiveTexture=texture;
    material.diffuseColor=new BABYLON.Color3(.42,.76,.94);
    material.emissiveColor=new BABYLON.Color3(.12,.28,.36);
    material.alpha=.70;
    material.specularColor=new BABYLON.Color3(.75,.88,.96);
    material.specularPower=48;
    material.backFaceCulling=false;
    material.needDepthPrePass=true;
    return{material,texture};
  }

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}
  turbidity(tile){return clamp(tile?.waterTurbidity||0,0,1);}
  waterTiles(state){return tilesOf(state).filter(hasVisibleWater);}
  byKey(tiles){return new Map(tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));}
  allByKey(state){return new Map(tilesOf(state).map(tile=>[keyOf(tile.x,tile.y),tile]));}

  disposeMap(map){
    for(const value of map.values()){
      if(value?.root)value.root.dispose();
      else value?.dispose?.();
    }
    map.clear();
  }

  disposeSurfaceMeshes(){
    this.disposeMap(this.surfaceMeshes);
    this.surfaceAnimations.clear();
  }

  setWind(value){
    const strength=clamp(value?.strength||0,0,3);
    let x=Number(value?.x||0),z=Number(value?.y??value?.z??0);
    const length=Math.hypot(x,z);
    if(strength<=EPSILON||length<=EPSILON){this.wind={x:0,z:0,strength:0};return this.wind;}
    x/=length;z/=length;
    this.wind={x,z,strength};
    return this.wind;
  }

  tileMotion(tile){
    let x=Number(tile?.flowX||0),z=Number(tile?.flowY||0);
    const speed=clamp(tile?.flowSpeed||0,0,3.2),length=Math.hypot(x,z);
    if(speed<=EPSILON||length<=EPSILON)return{x:0,z:0,speed:0};
    return{x:x/length,z:z/length,speed};
  }

  accumulateVertexMotion(out,index,tile){
    const motion=this.tileMotion(tile);
    out.flowXSum[index]=(out.flowXSum[index]||0)+motion.x*motion.speed;
    out.flowZSum[index]=(out.flowZSum[index]||0)+motion.z*motion.speed;
    out.flowSpeedSum[index]=(out.flowSpeedSum[index]||0)+motion.speed;
    out.flowSampleCount[index]=(out.flowSampleCount[index]||0)+1;
  }

  componentFlow(component){
    let vx=0,vz=0,speedSum=0,count=0;
    for(const tile of component?.tiles||[]){
      const fx=Number(tile?.flowX||0),fz=Number(tile?.flowY||0),speed=Math.max(0,Number(tile?.flowSpeed||0));
      const length=Math.hypot(fx,fz);
      if(length<=EPSILON||speed<=EPSILON)continue;
      vx+=fx/length*speed;vz+=fz/length*speed;speedSum+=speed;count++;
    }
    const length=Math.hypot(vx,vz);
    if(length>EPSILON)return{x:vx/length,z:vz/length,speed:speedSum/Math.max(1,count),flowing:true};
    // Standing water still has a very slow crossed ripple, but no fake downstream flow.
    return{x:.8,z:.6,speed:.16,flowing:false};
  }

  animateSurface(entry,time){
    const mesh=entry?.mesh;if(!mesh||mesh.isDisposed?.())return;
    const base=entry.basePositions,positions=entry.positions,normals=entry.normals,weights=entry.waveWeights;
    const flowX=entry.flowX||[],flowZ=entry.flowZ||[],flowSpeeds=entry.flowSpeeds||[];
    const wind=this.wind||{x:0,z:0,strength:0};
    const windStrength=clamp(wind.strength||0,0,3),windUnit=windStrength/3;
    const wx=Number(wind.x||0),wz=Number(wind.z||0),wpx=-wz,wpz=wx;
    const windAmp=ELEVATION_HEIGHT*(.010*windUnit+.045*windUnit*windUnit);
    const windK=(2.15+windStrength*.72)/TILE_SIZE;
    const windRate=.75+windStrength*.82;
    const calmAmp=ELEVATION_HEIGHT*.007;

    for(let i=0;i<base.length/3;i++){
      const o=i*3,x=base[o],z=base[o+2],w=Number(weights[i]||0);
      let wave=0,dydx=0,dydz=0;

      const fs=clamp(flowSpeeds[i]||0,0,3.2);
      let fx=Number(flowX[i]||0),fz=Number(flowZ[i]||0),flen=Math.hypot(fx,fz);
      if(fs>EPSILON&&flen>EPSILON){
        fx/=flen;fz/=flen;
        const fpx=-fz,fpz=fx;
        const flowUnit=smooth01(fs/3.2);
        const flowAmp=ELEVATION_HEIGHT*(.014+.026*flowUnit);
        const flowK=(3.0+fs*1.25)/TILE_SIZE;
        const crossK=(4.3+fs*.85)/TILE_SIZE;
        const rate=.82+fs*.96;
        const along=x*fx+z*fz,cross=x*fpx+z*fpz;
        const p1=along*flowK-time*rate*2.8;
        const p2=cross*crossK-time*rate*1.12;
        wave+=flowAmp*(Math.sin(p1)+.28*Math.sin(p2));
        dydx+=flowAmp*(Math.cos(p1)*flowK*fx+.28*Math.cos(p2)*crossK*fpx);
        dydz+=flowAmp*(Math.cos(p1)*flowK*fz+.28*Math.cos(p2)*crossK*fpz);
      }else if(windStrength<=EPSILON){
        // Still water is not perfectly frozen, but calm motion stays subtle.
        const p1=(x*.78+z*.42)*(2.0/TILE_SIZE)-time*.46;
        const p2=(x*.31-z*.86)*(2.6/TILE_SIZE)+time*.31;
        wave+=calmAmp*(Math.sin(p1)+.42*Math.sin(p2));
        dydx+=calmAmp*(Math.cos(p1)*(2.0/TILE_SIZE)*.78+.42*Math.cos(p2)*(2.6/TILE_SIZE)*.31);
        dydz+=calmAmp*(Math.cos(p1)*(2.0/TILE_SIZE)*.42-.42*Math.cos(p2)*(2.6/TILE_SIZE)*.86);
      }

      if(windStrength>EPSILON){
        const along=x*wx+z*wz,cross=x*wpx+z*wpz;
        const p1=along*windK-time*windRate*2.35;
        const p2=cross*(windK*1.42)+time*windRate*.72;
        wave+=windAmp*(Math.sin(p1)+.36*Math.sin(p2));
        dydx+=windAmp*(Math.cos(p1)*windK*wx+.36*Math.cos(p2)*windK*1.42*wpx);
        dydz+=windAmp*(Math.cos(p1)*windK*wz+.36*Math.cos(p2)*windK*1.42*wpz);
      }

      wave*=w;dydx*=w;dydz*=w;
      positions[o]=x;positions[o+1]=base[o+1]+wave;positions[o+2]=z;
      const inv=1/Math.hypot(dydx,1,dydz);
      normals[o]=-dydx*inv;normals[o+1]=inv;normals[o+2]=-dydz*inv;
    }
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions,false,false);
    mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,normals,false,false);
  }

  cascadeTarget(tile){
    const x=Number(tile?.hydrologyCascadeToX),y=Number(tile?.hydrologyCascadeToY),drop=Number(tile?.hydrologyCascadeDrop||0);
    if(!Number.isFinite(x)||!Number.isFinite(y)||drop<WATERFALL_MIN_DROP)return null;
    return{x,y,drop};
  }

  cascadeMatches(from,to){
    if(!from||!to)return false;
    const target=this.cascadeTarget(from);
    return !!target&&target.x===Number(to.x)&&target.y===Number(to.y)&&this.flowMatches(from,to);
  }

  flowDirection(tile){
    const fx=Number(tile?.flowX||0),fy=Number(tile?.flowY||0);
    if(Math.abs(fx)<=EPSILON&&Math.abs(fy)<=EPSILON)return null;
    return Math.abs(fx)>=Math.abs(fy)
      ?{dx:Math.sign(fx),dy:0}
      :{dx:0,dy:Math.sign(fy)};
  }

  flowMatches(from,to){
    if(!from||!to)return false;
    const dir=this.flowDirection(from);
    return !!dir&&from.x+dir.dx===to.x&&from.y+dir.dy===to.y;
  }

  isCascadeBoundary(a,b){
    if(!hasAnyWater(a)||!hasAnyWater(b))return false;
    return this.cascadeMatches(a,b)||this.cascadeMatches(b,a);
  }

  continuousWaterEdge(a,b){
    return !!a&&!!b&&hasVisibleWater(a)&&hasVisibleWater(b)&&!this.isCascadeBoundary(a,b);
  }

  surfaceComponents(waterTiles){
    const map=this.byKey(waterTiles);
    const unseen=new Set(waterTiles.map(tile=>keyOf(tile.x,tile.y)));
    const out=[];

    while(unseen.size){
      const firstKey=unseen.values().next().value;
      unseen.delete(firstKey);
      const first=map.get(firstKey);
      const group=this.surfaceGroup(first);
      const queue=[first],tiles=[];

      while(queue.length){
        const tile=queue.shift();
        tiles.push(tile);
        for(const dir of DIRS){
          const n=map.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
          if(!n||this.surfaceGroup(n)!==group||!this.continuousWaterEdge(tile,n))continue;
          const k=keyOf(n.x,n.y);
          if(!unseen.has(k))continue;
          unseen.delete(k);
          queue.push(n);
        }
      }

      out.push({id:`${group}:${out.length}`,group,tiles});
    }
    return out;
  }

  cornerContext(tile,index,allMap){
    const dir=CORNER_DIR_BY_RING[index];
    if(!dir)return null;

    const gx=Number(tile.x)+dir.dx*.5;
    const gy=Number(tile.y)+dir.dy*.5;
    const xs=[Math.floor(gx),Math.ceil(gx)];
    const ys=[Math.floor(gy),Math.ceil(gy)];
    const slots=[];
    for(const y of ys)for(const x of xs){
      slots.push({x,y,tile:allMap.get(keyOf(x,y))||null});
    }

    const slotTiles=new Map(slots.filter(slot=>slot.tile).map(slot=>[keyOf(slot.x,slot.y),slot.tile]));
    const start=slotTiles.get(keyOf(tile.x,tile.y));
    const members=[];
    const seen=new Set();
    const queue=start&&hasVisibleWater(start)?[start]:[];

    while(queue.length){
      const current=queue.shift();
      const currentKey=keyOf(current.x,current.y);
      if(seen.has(currentKey))continue;
      seen.add(currentKey);
      members.push(current);

      for(const dir of DIRS){
        const next=slotTiles.get(keyOf(current.x+dir.dx,current.y+dir.dy));
        if(!next||seen.has(keyOf(next.x,next.y)))continue;
        if(this.continuousWaterEdge(current,next))queue.push(next);
      }
    }

    const memberKeys=new Set(members.map(member=>keyOf(member.x,member.y)));
    const drySlots=slots.filter(slot=>!memberKeys.has(keyOf(slot.x,slot.y)));
    let cascade=false;
    for(const member of members){
      for(const dir of DIRS){
        const next=slotTiles.get(keyOf(member.x+dir.dx,member.y+dir.dy));
        if(!next||memberKeys.has(keyOf(next.x,next.y))||!hasAnyWater(next))continue;
        if(this.isCascadeBoundary(member,next)){cascade=true;break;}
      }
      if(cascade)break;
    }

    return{gx,gy,slots,members,drySlots,memberKeys,cascade};
  }

  cornerMembers(tile,index,allMap){
    return this.cornerContext(tile,index,allMap)?.members||[tile];
  }

  ringMode(tile,index,allMap){
    const edgeDir=EDGE_DIR_BY_RING[index];
    if(edgeDir){
      const neighbor=allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy));
      if(this.continuousWaterEdge(tile,neighbor))return"INTERNAL";
      if(neighbor&&hasAnyWater(neighbor)&&this.isCascadeBoundary(tile,neighbor))return"CASCADE";
      return"SHORE";
    }

    const context=this.cornerContext(tile,index,allMap);
    if(!context)return"SHORE";
    if(context.cascade)return"CASCADE";
    return context.members.length===4?"INTERNAL":"SHORE";
  }

  ringWaterLevel(tile,index,allMap){
    const edgeDir=EDGE_DIR_BY_RING[index];
    if(edgeDir){
      const neighbor=allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy));
      if(this.continuousWaterEdge(tile,neighbor)){
        return average([visualSurface(tile),visualSurface(neighbor)]);
      }
      return visualSurface(tile);
    }

    const members=this.cornerMembers(tile,index,allMap);
    return members.length?average(members.map(visualSurface)):visualSurface(tile);
  }

  cornerCanRelax(context){
    if(!context||context.cascade)return false;
    const members=context.members||[];
    const memberKeys=context.memberKeys||new Set();
    const slotTiles=new Map(context.slots.filter(slot=>slot.tile).map(slot=>[keyOf(slot.x,slot.y),slot.tile]));

    for(const member of members){
      for(const dir of DIRS){
        const next=slotTiles.get(keyOf(member.x+dir.dx,member.y+dir.dy));
        if(!next||memberKeys.has(keyOf(next.x,next.y)))continue;
        if(!this.surfaceResolver.canSlope(member,next))return false;
      }
    }
    return true;
  }

  centroidOfTiles(tiles){
    if(!tiles?.length)return null;
    return{
      x:average(tiles.map(tile=>Number(tile.x)))*TILE_SIZE,
      z:average(tiles.map(tile=>Number(tile.y)))*TILE_SIZE,
      level:average(tiles.map(visualSurface))
    };
  }

  ruggedShorePoint(point,key,scale=1){
    const amount=TILE_SIZE*SHORE_RUGGEDNESS*Math.max(0,Number(scale||0));
    if(amount<=EPSILON)return point;
    // Stable coordinate noise: no frame-to-frame shimmer and no dependency on
    // a particular map/character. The same natural boundary point always resolves
    // to the same irregular silhouette.
    const dx=(hash01(`${key}:x`)*2-1)*amount;
    const dz=(hash01(`${key}:z`)*2-1)*amount;
    return{x:point.x+dx,z:point.z+dz};
  }

  cornerNaturalTarget(tile,index,allMap){
    const context=this.cornerContext(tile,index,allMap);
    const dir=CORNER_DIR_BY_RING[index]||{dx:0,dy:0};
    const sampleX=(Number(tile.x)+dir.dx*.5)*TILE_SIZE;
    const sampleZ=(Number(tile.y)+dir.dy*.5)*TILE_SIZE;
    const base={x:sampleX,z:sampleZ};
    let target=base;

    // Topology smoothing remains conservative near a cliff, but ruggedness does
    // not disappear there: natural rock banks should not suddenly become rulers.
    if(context&&this.cornerCanRelax(context)){
      const wet=context.members||[];
      const count=wet.length;
      let targetCentroid=null;
      let amount=0;
      if(count===1){
        targetCentroid=this.centroidOfTiles(wet);
        amount=SHORE_CONVEX_INSET;
      }else if(count===2){
        targetCentroid=this.centroidOfTiles(wet);
        amount=SHORE_PAIR_INSET;
      }else if(count===3){
        const existingDry=context.drySlots.filter(slot=>slot.tile).map(slot=>slot.tile);
        if(existingDry.length){
          targetCentroid=this.centroidOfTiles(existingDry);
          amount=SHORE_CONCAVE_OUTSET;
        }
      }
      if(targetCentroid&&amount>0){
        const dx=targetCentroid.x-base.x,dz=targetCentroid.z-base.z;
        const length=Math.hypot(dx,dz);
        if(length>EPSILON){
          target={
            x:base.x+dx/length*TILE_SIZE*amount,
            z:base.z+dz/length*TILE_SIZE*amount
          };
        }
      }
    }

    const gx=context?.gx??(Number(tile.x)+dir.dx*.5);
    const gy=context?.gy??(Number(tile.y)+dir.dy*.5);
    return this.ruggedShorePoint(target,`shore-corner:${gx.toFixed(3)}:${gy.toFixed(3)}`,.72);
  }

  edgeNaturalTarget(tile,index,sample,allMap){
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const base={
      x:cx+Number(sample.ox||0)*TILE_SIZE,
      z:cz+Number(sample.oz||0)*TILE_SIZE
    };
    const edgeDir=EDGE_DIR_BY_RING[index];
    const neighbor=edgeDir?allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy)):null;
    const cornerIndices=EDGE_CORNERS[index];
    let target=base;

    // On ordinary erodible banks use the topology-smoothed midpoint. On rock/cliff
    // banks keep the positional anchor but still apply the same natural roughness.
    if(cornerIndices&&(!neighbor||this.surfaceResolver.canSlope(tile,neighbor))){
      const a=this.cornerNaturalTarget(tile,cornerIndices[0],allMap);
      const b=this.cornerNaturalTarget(tile,cornerIndices[1],allMap);
      const smoothed={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      target={
        x:base.x+(smoothed.x-base.x)*SHORE_EDGE_RELAX,
        z:base.z+(smoothed.z-base.z)*SHORE_EDGE_RELAX
      };
    }

    const wx=(base.x/TILE_SIZE).toFixed(3),wz=(base.z/TILE_SIZE).toFixed(3);
    return this.ruggedShorePoint(target,`shore-edge:${wx}:${wz}`,.95);
  }

  naturalShoreTarget(tile,index,sample,allMap){
    return CORNER_DIR_BY_RING[index]
      ?this.cornerNaturalTarget(tile,index,allMap)
      :this.edgeNaturalTarget(tile,index,sample,allMap);
  }

  projectShoreline(anchor,target,anchorLevel,targetLevel,allMap,fallbackTerrain){
    const clearance=t=>{
      const x=anchor.x+(target.x-anchor.x)*t;
      const z=anchor.z+(target.z-anchor.z)*t;
      const level=anchorLevel+(targetLevel-anchorLevel)*t;
      const terrain=this.surfaceResolver.sampleHeightAtWorld(x,z,allMap);
      const resolved=terrain==null?fallbackTerrain:terrain;
      return{value:level-Number(resolved||0),x,z,level};
    };

    const end=clearance(1);
    if(end.value>=-SHORE_EPSILON)return{x:end.x,z:end.z,level:end.level,clipped:false};

    const start=clearance(0);
    if(start.value<=SHORE_EPSILON)return{x:start.x,z:start.z,level:start.level,clipped:true};

    let low=0,high=1;
    for(let i=0;i<SHORE_SEARCH_STEPS;i++){
      const mid=(low+high)/2;
      if(clearance(mid).value>=0)low=mid;else high=mid;
    }
    const hit=clearance((low+high)/2);
    return{x:hit.x,z:hit.z,level:hit.level,clipped:true};
  }

  shorelinePoint(tile,index,sample,allMap){
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const fullX=cx+Number(sample.ox||0)*TILE_SIZE;
    const fullZ=cz+Number(sample.oz||0)*TILE_SIZE;
    const mode=this.ringMode(tile,index,allMap);
    const ringWater=this.ringWaterLevel(tile,index,allMap);

    if(mode!=="SHORE"){
      return{x:fullX,z:fullZ,level:ringWater,clipped:false,relaxed:false,mode};
    }

    const target=this.naturalShoreTarget(tile,index,sample,allMap);
    let anchor={x:cx,z:cz};
    let anchorLevel=visualSurface(tile);

    if(CORNER_DIR_BY_RING[index]){
      const context=this.cornerContext(tile,index,allMap);
      const centroid=this.centroidOfTiles(context?.members||[]);
      if(centroid){anchor={x:centroid.x,z:centroid.z};anchorLevel=centroid.level;}
    }

    const projected=this.projectShoreline(
      anchor,
      target,
      anchorLevel,
      ringWater,
      allMap,
      Number(sample.height||0)
    );
    return{
      ...projected,
      relaxed:Math.hypot(target.x-fullX,target.z-fullZ)>EPSILON,
      mode
    };
  }

  waterVertexVisual(point,allMap,turbidity=0){
    const terrain=this.surfaceResolver.sampleHeightAtWorld(point.x,point.z,allMap);
    const depth=Math.max(0,Number(point.level)-(terrain==null?Number(point.level):Number(terrain)));
    const t=smooth01(depth/WATER_DEPTH_RANGE);
    let color=mixColor(WATER_SHALLOW_COLOR,WATER_DEEP_COLOR,t);
    const murky=clamp(Number(turbidity||0),0,1);
    if(murky>EPSILON)color=mixColor(color,WATER_MURKY_COLOR,murky*.58);
    const alpha=clamp(
      WATER_SHALLOW_ALPHA+(WATER_DEEP_ALPHA-WATER_SHALLOW_ALPHA)*t+murky*.06,
      WATER_SHALLOW_ALPHA,
      .88
    );
    return{depth,color,alpha};
  }

  addVertex(out,cache,point,allMap,turbidity,tile){
    const y=Number(point.level)*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const cacheKey=`${point.x.toFixed(5)}:${y.toFixed(5)}:${point.z.toFixed(5)}`;
    const existing=cache.get(cacheKey);
    if(existing!=null){this.accumulateVertexMotion(out,existing,tile);return existing;}

    const visual=this.waterVertexVisual(point,allMap,turbidity);
    const index=out.positions.length/3;
    out.positions.push(point.x,y,point.z);
    out.uvs.push(point.x/(TILE_SIZE*3.25),point.z/(TILE_SIZE*3.25));
    out.colors.push(visual.color[0],visual.color[1],visual.color[2],visual.alpha);
    out.waveWeights.push(smooth01(visual.depth/.34));
    out.flowXSum.push(0);out.flowZSum.push(0);out.flowSpeedSum.push(0);out.flowSampleCount.push(0);
    this.accumulateVertexMotion(out,index,tile);
    cache.set(cacheKey,index);
    return index;
  }

  pushTriangle(out,a,b,c){
    if(a===b||b===c||c===a)return;
    const ax=out.positions[a*3],az=out.positions[a*3+2];
    const bx=out.positions[b*3],bz=out.positions[b*3+2];
    const cx=out.positions[c*3],cz=out.positions[c*3+2];
    const abx=bx-ax,abz=bz-az,acx=cx-ax,acz=cz-az;
    const geometricY=abz*acx-abx*acz;
    if(Math.abs(geometricY)<=EPSILON)return;
    if(geometricY>0){const swap=b;b=c;c=swap;}
    out.indices.push(a,b,c);
  }

  buildSurface(component,state){
    const out={positions:[],indices:[],normals:[],uvs:[],colors:[],waveWeights:[],flowXSum:[],flowZSum:[],flowSpeedSum:[],flowSampleCount:[]};
    const cache=new Map();
    const allMap=this.allByKey(state);
    const componentTurbidity=average(component.tiles.map(tile=>this.turbidity(tile)));
    let clippedPoints=0;

    for(const tile of component.tiles){
      const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
      const centerIndex=this.addVertex(out,cache,{x:cx,z:cz,level:visualSurface(tile)},allMap,componentTurbidity,tile);
      const terrainRing=this.surfaceResolver.ringSamples(tile,allMap);
      const ringPoints=terrainRing.map((sample,index)=>{
        const point=this.shorelinePoint(tile,index,sample,allMap);
        if(point.clipped)clippedPoints++;
        return point;
      });
      const ringIndices=ringPoints.map(point=>this.addVertex(out,cache,point,allMap,componentTurbidity,tile));

      for(let i=0;i<ringIndices.length;i++){
        this.pushTriangle(out,centerIndex,ringIndices[i],ringIndices[(i+1)%ringIndices.length]);
      }
    }

    if(!out.positions.length||!out.indices.length)return null;
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);

    const mesh=new BABYLON.Mesh(`water-surface-${component.id}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=out.positions;data.indices=out.indices;data.normals=out.normals;data.uvs=out.uvs;data.colors=out.colors;
    data.applyToMesh(mesh,true);
    mesh.material=this.surfaceMaterial;
    mesh.alphaIndex=10;
    mesh.useVertexColors=true;
    mesh.hasVertexAlpha=true;
    mesh.isPickable=false;
    mesh.visibility=component.group==="fogged"?.22:1;
    mesh.metadata={
      kind:"water-surface",
      tileCount:component.tiles.length,
      sharedWetEdges:true,
      hydrologySurface:true,
      quantizedLevels:false,
      clippedShorePoints:clippedPoints,
      naturalShoreline:true,
      topologyAwareShoreRelaxation:true,
      ruggedNaturalShoreline:true,
      ruggedRockBanks:true,
      visualSurfaceResolver:true,
      microRegionsPerTile:9,
      stylizedWater:true,
      depthGradient:true,
      vertexAlpha:true,
      alphaIndex:10,
      componentTurbidity,
      vertexCount:out.positions.length/3,
      triangleCount:out.indices.length/3
    };
    const flow=this.componentFlow(component);
    const vertexFlowX=[],vertexFlowZ=[],vertexFlowSpeeds=[];
    for(let i=0;i<out.positions.length/3;i++){
      const count=Math.max(1,Number(out.flowSampleCount[i]||0));
      let vx=Number(out.flowXSum[i]||0)/count,vz=Number(out.flowZSum[i]||0)/count;
      const speed=Number(out.flowSpeedSum[i]||0)/count,length=Math.hypot(vx,vz);
      if(length>EPSILON){vx/=length;vz/=length;}else{vx=0;vz=0;}
      vertexFlowX.push(vx);vertexFlowZ.push(vz);vertexFlowSpeeds.push(speed);
    }
    this.surfaceAnimations.set(component.id,{
      mesh,
      basePositions:Float32Array.from(out.positions),
      positions:Float32Array.from(out.positions),
      normals:Float32Array.from(out.normals),
      waveWeights:Float32Array.from(out.waveWeights),
      flowX:Float32Array.from(vertexFlowX),
      flowZ:Float32Array.from(vertexFlowZ),
      flowSpeeds:Float32Array.from(vertexFlowSpeeds)
    });
    mesh.metadata.waterSurfaceWave=true;
    mesh.metadata.waveDirection=flow.flowing?{x:flow.x,z:flow.z}:null;
    mesh.metadata.averageFlowSpeed=flow.flowing?flow.speed:0;
    mesh.metadata.localFlowSpeedWaves=true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  cascadeEdges(state,waterTiles){
    const allMap=this.allByKey(state),out=[];
    for(const tile of waterTiles){
      const target=this.cascadeTarget(tile);
      if(!target)continue;
      const receiver=allMap.get(keyOf(target.x,target.y));
      if(!receiver||!hasAnyWater(receiver)||!this.cascadeMatches(tile,receiver))continue;

      const top=visualSurface(tile),bottom=visualSurface(receiver),drop=top-bottom;
      if(drop<=EPSILON)continue;
      out.push({
        id:`${tile.x},${tile.y}->${receiver.x},${receiver.y}`,
        tile,receiver,dx:Math.sign(receiver.x-tile.x),dy:Math.sign(receiver.y-tile.y),top,bottom,drop,
        authoredDrop:target.drop,
        speed:Math.max(.6,Number(tile.flowSpeed||0)+drop*.55)
      });
    }
    return out;
  }

  buildCascade(edge){
    const dirX=edge.dx,dirZ=edge.dy;
    const perpX=-dirZ,perpZ=dirX;
    const cx=Number(edge.tile.x)*TILE_SIZE,cz=Number(edge.tile.y)*TILE_SIZE;
    const edgeX=cx+dirX*TILE_SIZE*.5,edgeZ=cz+dirZ*TILE_SIZE*.5;
    const topY=edge.top*ELEVATION_HEIGHT+SURFACE_OFFSET*.9;
    const bottomY=edge.bottom*ELEVATION_HEIGHT+SURFACE_OFFSET*.9;
    const width=TILE_SIZE*.82;
    const half=width*.5;
    const inset=TILE_SIZE*.24;
    const lip=.035;

    const sections=[
      {x:cx+dirX*inset,z:cz+dirZ*inset,y:topY},
      {x:edgeX-dirX*lip,z:edgeZ-dirZ*lip,y:topY},
      {x:edgeX+dirX*lip,z:edgeZ+dirZ*lip,y:bottomY},
      {x:edgeX+dirX*inset,z:edgeZ+dirZ*inset,y:bottomY}
    ];

    const positions=[],indices=[],normals=[],uvs=[];
    let distance=0;
    for(let i=0;i<sections.length;i++){
      if(i){
        const a=sections[i-1],b=sections[i];
        distance+=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      }
      const s=sections[i];
      for(const side of [-1,1]){
        positions.push(
          s.x+perpX*half*side,
          s.y,
          s.z+perpZ*half*side
        );
        uvs.push(side<0?0:1,distance/(TILE_SIZE*.55));
        normals.push(0,0,0);
      }
      if(i<sections.length-1){
        const b=i*2,n=(i+1)*2;
        indices.push(b,n+1,n,b,b+1,n+1);
      }
    }
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);

    const mesh=new BABYLON.Mesh(`cascade-${edge.id}`,this.scene);
    const data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;
    data.applyToMesh(mesh,false);
    mesh.material=this.cascadeMaterial;
    mesh.isPickable=false;
    mesh.visibility=edge.tile.fogged?.16:1;
    mesh.metadata={kind:"water-cascade",drop:edge.drop,flowSpeed:edge.speed};

    const foam=BABYLON.MeshBuilder.CreateTorus(
      `cascade-foam-${edge.id}`,
      {diameter:TILE_SIZE*.42,thickness:.045,tessellation:20},
      this.scene
    );
    foam.material=this.foamMaterial;
    foam.isPickable=false;
    foam.position.set(
      edgeX+dirX*TILE_SIZE*.18,
      bottomY+.018,
      edgeZ+dirZ*TILE_SIZE*.18
    );
    foam.visibility=mesh.visibility;

    const root=new BABYLON.TransformNode(`cascade-root-${edge.id}`,this.scene);
    mesh.parent=root;foam.parent=root;
    return{root,mesh,foam,phase:(edge.tile.x*13+edge.tile.y*7)%17};
  }

  surfaceSignatureFor(components,state){
    const terrain=tilesOf(state).map(tile=>[
      keyOf(tile.x,tile.y),
      Number(tile.elevation||0).toFixed(4),
      waterDepth(tile).toFixed(4),
      hasAnyWater(tile)?visualSurface(tile).toFixed(4):"dry",
      Number(tile.flowX||0),Number(tile.flowY||0),Number(tile.flowSpeed||0).toFixed(3),
      tile.hydrologyCascadeToX??"n",tile.hydrologyCascadeToY??"n",Number(tile.hydrologyCascadeDrop||0).toFixed(3),
      tile.fogged?1:0
    ].join(":" )).sort().join(",");
    const groups=components.map(component=>
      `${component.id}:${component.tiles.map(tile=>keyOf(tile.x,tile.y)).sort().join(",")}`
    ).sort().join("|");
    return`${groups}#${terrain}`;
  }

  cascadeSignatureFor(edges){
    return edges.map(e=>`${e.id}:${e.top.toFixed(4)}:${e.bottom.toFixed(4)}:${e.speed.toFixed(2)}`).sort().join("|");
  }


  sync(state){
    this.setWind(state?.presentation?.environment?.wind||state?.environment?.wind||state?.wind||null);
    const waterTiles=this.waterTiles(state);
    const components=this.surfaceComponents(waterTiles);
    const cascades=this.cascadeEdges(state,waterTiles);

    const surfaceSignature=this.surfaceSignatureFor(components,state);
    if(surfaceSignature!==this.surfaceSignature){
      this.disposeSurfaceMeshes();
      for(const component of components){
        const mesh=this.buildSurface(component,state);
        if(mesh)this.surfaceMeshes.set(component.id,mesh);
      }
      this.surfaceSignature=surfaceSignature;
    }
    for(const entry of this.surfaceAnimations.values()){
      if(!entry?.mesh?.metadata)continue;
      entry.mesh.metadata.windWaveStrength=this.wind.strength;
      entry.mesh.metadata.windWaveDirection=this.wind.strength>EPSILON?{x:this.wind.x,z:this.wind.z}:null;
    }

    const cascadeSignature=this.cascadeSignatureFor(cascades);
    if(cascadeSignature!==this.cascadeSignature){
      this.disposeMap(this.cascades);
      for(const edge of cascades)this.cascades.set(edge.id,this.buildCascade(edge));
      this.cascadeSignature=cascadeSignature;
    }

    if(!waterTiles.length){
      this.disposeSurfaceMeshes();this.disposeMap(this.cascades);
      this.surfaceSignature=this.cascadeSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      sideMeshes:0,
      cascades:this.cascades.size,
      separatedWaterLevels:false,
      hydrologyContinuousSurface:true,
      sharedWetEdges:true,
      quantizedLevels:false,
      thinCascadeRibbon:true,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:MIN_WATER_DEPTH,
      shorelineSkirts:false,
      terrainClippedShoreline:true,
      naturalShoreline:true,
      topologyAwareShoreRelaxation:true,
      ruggedNaturalShoreline:true,
      ruggedRockBanks:true,
      sharedVisualSurfaceResolver:true,
      microRegionsPerTile:9,
      stylizedWater:true,
      animatedWaterSurface:true,
      waterWaveAnimation:"vertex-displacement-30hz",
      localFlowSpeedWaves:true,
      windDrivenWaves:true,
      windWaveStrength:Number(this.wind?.strength||0),
      currentOverlay:false,
      reflectiveWaterMaterial:false,
      depthGradient:true,
      vertexAlpha:true,
      transparentDepthPrePass:false,
      visualSurfaceResolver:this.surfaceResolver.diagnostics(),
      cascadesRequireHydrologyDirection:true,
      cascadesRequireHydrologyMetadata:true,
      cascadesRequireDownstreamWater:true
    };
  }
}
