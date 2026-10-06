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
const WATER_SHALLOW_ALPHA=.46;
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
    this.terrainRenderer=terrainRenderer||null;
    this.surfaceResolver=terrainRenderer?.surfaceResolver||new VisualSurfaceResolver();
    this.surfaceMeshes=new Map();
    this.surfaceAnimations=new Map();
    this.surfaceSignature="";
    this.embeddedCascadeCount=0;
    this.waveTime=0;
    this.waveAccumulator=0;
    this.wind={x:0,z:0,strength:0};
    this.renderableWaterKeys=new Set();
    this.rogueWaves=[];
    this.seenRogueWaveSequences=new Set();
    this.whirlpools=new Map();

    this.surfaceMaterial=this.makeSurfaceMaterial();
    this.rogueFoamMaterial=this.makeSideMaterial("rogue-wave-foam",new BABYLON.Color3(.90,.98,1),.86);

    this.beforeRender=this.scene.onBeforeRenderObservable.add(()=>{
      const dt=Math.min(.05,Math.max(0,Number(this.scene.getEngine().getDeltaTime()||16)/1000));
      this.waveTime+=dt;

      // Presentation events stay on the CPU, but persistent wind / current waves are
      // displaced by the water material on the GPU. This avoids rebuilding and
      // uploading every water vertex 30 times per second on mobile.
      const active=[];
      for(const wave of this.rogueWaves){
        const age=this.waveTime-wave.startedAt;
        if(age>wave.duration+.25){wave.visual?.dispose?.();continue;}
        this.updateRogueWaveVisual(wave,age);active.push(wave);
      }
      this.rogueWaves=active;

      this.waveAccumulator+=dt;
      if(this.waveAccumulator>=1/30){
        this.waveAccumulator=0;
        if(this.gpuSurfaceWaves){
          const activeSurfaceIds=new Set();
          for(const wave of this.rogueWaves)for(const id of wave.surfaceIds||[])activeSurfaceIds.add(id);
          for(const whirl of this.whirlpools.values())for(const id of whirl.surfaceIds||[])activeSurfaceIds.add(id);
          for(const entry of this.surfaceAnimations.values()){
            if(activeSurfaceIds.has(entry.id))this.animateSpecialSurface(entry,this.waveTime);
            else if(entry.specialActive)this.resetSpecialSurface(entry);
          }
        }else{
          // Safety fallback for environments where CustomMaterial is unavailable.
          for(const entry of this.surfaceAnimations.values())this.animateSurface(entry,this.waveTime);
        }
      }
      for(const whirl of this.whirlpools.values())this.updateWhirlpoolVisual(whirl,dt);
    });
  }

  makeSurfaceMaterial(){
    // Stylized water belongs to the same low-poly visual language as the terrain.
    // Depth, transparency and colour come from shared mesh vertex colours instead
    // of a reflective WaterMaterial that fights the hand-painted presentation.
    this.gpuSurfaceWaves=typeof BABYLON.CustomMaterial==="function";
    const m=this.gpuSurfaceWaves
      ?new BABYLON.CustomMaterial("water-surface-stylized",this.scene)
      :new BABYLON.StandardMaterial("water-surface-stylized",this.scene);
    if(this.gpuSurfaceWaves){
      // x/y = normalized local current direction, z = current speed, w = shoreline wave weight.
      m.AddAttribute("waterAnim");
      m.AddAttribute("waterBaseXZ");
      m.AddAttribute("waterCascade");
      m.AddUniform("waterTime","float",0);
      m.AddUniform("waterSpecialActive","float",0);
      m.AddUniform("waterWind","vec4",new BABYLON.Vector4(0,0,0,0));
      m.AddUniform("waterTileSize","float",TILE_SIZE);
      m.AddUniform("waterElevationHeight","float",ELEVATION_HEIGHT);
      m.Vertex_Definitions(`
        attribute vec4 waterAnim;
        attribute vec2 waterBaseXZ;
        attribute vec2 waterCascade;
        varying vec2 vWaterCascade;
        vec3 waterWaveValue;
        float waterSmooth01(float value){
          float t=clamp(value,0.0,1.0);
          return t*t*(3.0-2.0*t);
        }
        vec3 waterAmbientWave(vec3 p,vec4 animData){
          float height=0.0;
          float dydx=0.0;
          float dydz=0.0;
          float fs=clamp(animData.z,0.0,3.2);
          vec2 flow=animData.xy;
          float flowLength=length(flow);
          float rawWind=clamp(waterWind.z,0.0,8.0);
          float windStrength=clamp(waterWind.w,0.0,8.0);
          float calmAmp=waterElevationHeight*.009;
          if(fs>.001&&flowLength>.001){
            flow/=flowLength;
            vec2 flowPerp=vec2(-flow.y,flow.x);
            float flowUnit=waterSmooth01(fs/3.2);
            float flowAmp=waterElevationHeight*(.014+.026*flowUnit);
            float flowK=(3.0+fs*1.25)/waterTileSize;
            float crossK=(4.3+fs*.85)/waterTileSize;
            float rate=.82+fs*.96;
            float along=dot(p.xz,flow);
            float cross=dot(p.xz,flowPerp);
            float p1=along*flowK-waterTime*rate*2.8;
            float p2=cross*crossK-waterTime*rate*1.12;
            float s1=sin(p1),s2=sin(p2),c1=cos(p1),c2=cos(p2);
            height+=flowAmp*(s1+.28*s2);
            dydx+=flowAmp*(c1*flowK*flow.x+.28*c2*crossK*flowPerp.x);
            dydz+=flowAmp*(c1*flowK*flow.y+.28*c2*crossK*flowPerp.y);
          }else if(rawWind<=.001){
            float p1=(p.x*.78+p.z*.42)*(2.0/waterTileSize)-waterTime*.46;
            float p2=(p.x*.31-p.z*.86)*(2.6/waterTileSize)+waterTime*.31;
            float s1=sin(p1),s2=sin(p2),c1=cos(p1),c2=cos(p2);
            height+=calmAmp*(s1+.42*s2);
            dydx+=calmAmp*(c1*(2.0/waterTileSize)*.78+.42*c2*(2.6/waterTileSize)*.31);
            dydz+=calmAmp*(c1*(2.0/waterTileSize)*.42-.42*c2*(2.6/waterTileSize)*.86);
          }
          if(rawWind>.001){
            vec2 wind=waterWind.xy;
            float windLength=length(wind);
            if(windLength>.001)wind/=windLength;
            vec2 windPerp=vec2(-wind.y,wind.x);
            float windPresence=waterSmooth01(rawWind/.8);
            float windAmp=waterElevationHeight*min(.24,.010*windPresence+.012*windStrength+.0036*windStrength*windStrength);
            float windK=(2.15+windStrength*.72)/waterTileSize;
            float windRate=.75+windStrength*.82;
            float along=dot(p.xz,wind);
            float cross=dot(p.xz,windPerp);
            float p1=along*windK-waterTime*windRate*2.35;
            float p2=cross*(windK*1.42)+waterTime*windRate*.72;
            float s1=sin(p1),s2=sin(p2),c1=cos(p1),c2=cos(p2);
            height+=windAmp*(s1+.36*s2);
            dydx+=windAmp*(c1*windK*wind.x+.36*c2*windK*1.42*windPerp.x);
            dydz+=windAmp*(c1*windK*wind.y+.36*c2*windK*1.42*windPerp.y);
          }
          return vec3(height,dydx,dydz);
        }
      `);
      m.Vertex_Before_PositionUpdated(`
        waterWaveValue=waterAmbientWave(vec3(waterBaseXZ.x,positionUpdated.y,waterBaseXZ.y),waterAnim);
        positionUpdated.y+=waterWaveValue.x*waterAnim.w;
      `);
      m.Vertex_MainEnd(`vWaterCascade=waterCascade;`);
      m.Fragment_Definitions(`varying vec2 vWaterCascade;`);
      m.Fragment_Custom_Diffuse(`
        if(vWaterCascade.y>.5){
          float cascadePhase=vWaterCascade.x*18.0-waterTime*5.2;
          float cascadeStreak=.5+.5*sin(cascadePhase);
          float cascadeFine=.5+.5*sin(cascadePhase*1.87+vPositionW.x*2.6+vPositionW.z*2.2);
          float cascadeFoam=smoothstep(.70,1.0,cascadeStreak)*.22+smoothstep(.76,1.0,cascadeFine)*.10;
          float lipFoam=(1.0-smoothstep(.0,.13,vWaterCascade.x))+smoothstep(.87,1.0,vWaterCascade.x);
          baseColor.rgb=mix(baseColor.rgb,vec3(.86,.96,1.0),clamp(cascadeFoam+lipFoam*.12,0.0,.38));
        }
      `);
      m.Vertex_Before_NormalUpdated(`
        if(waterAnim.w>.001){
          if(waterSpecialActive>.5){
            normalUpdated=normalize(vec3(
              normalUpdated.x-waterWaveValue.y*waterAnim.w,
              max(.18,normalUpdated.y),
              normalUpdated.z-waterWaveValue.z*waterAnim.w
            ));
          }else{
            normalUpdated=normalize(vec3(-waterWaveValue.y*waterAnim.w,1.0,-waterWaveValue.z*waterAnim.w));
          }
        }
      `);
      m.onBindObservable.add(mesh=>{
        const effect=m.getEffect?.();if(!effect)return;
        const raw=clamp(this.wind?.strength||0,0,8),visual=globalThis.EnvironmentEngine?.windVisualStrength?.(raw)??raw;
        effect.setFloat("waterTime",this.waveTime);
        effect.setFloat("waterSpecialActive",mesh?.metadata?.waterSpecialActive?1:0);
        effect.setFloat4("waterWind",Number(this.wind?.x||0),Number(this.wind?.z||0),raw,visual);
        effect.setFloat("waterTileSize",TILE_SIZE);
        effect.setFloat("waterElevationHeight",ELEVATION_HEIGHT);
      });
    }
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

  surfaceGroup(tile){return tile?.fogged?"fogged":"visible";}
  turbidity(tile){return clamp(tile?.waterTurbidity||0,0,1);}
  waterTiles(state){
    const tiles=tilesOf(state),by=new Map(tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
    const visible=new Set(tiles.filter(hasVisibleWater).map(tile=>keyOf(tile.x,tile.y)));
    const selected=tiles.filter(tile=>{
      if(hasVisibleWater(tile))return true;
      if(!hasAnyWater(tile))return false;
      // A thin film surrounded by established water is still part of that water
      // body. Rendering it prevents a perfect one-tile terrain rectangle from
      // punching through an otherwise continuous lake/flood surface.
      let neighbors=0;
      for(const dir of DIRS){
        if(visible.has(keyOf(tile.x+dir.dx,tile.y+dir.dy)))neighbors++;
      }
      return neighbors>=2;
    });
    this.renderableWaterKeys=new Set(selected.map(tile=>keyOf(tile.x,tile.y)));
    return selected;
  }
  isRenderableWater(tile){return !!tile&&this.renderableWaterKeys.has(keyOf(tile.x,tile.y));}
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
    const strength=clamp(value?.strength||0,0,8);
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
    const flowX=entry.flowX||[],flowZ=entry.flowZ||[],flowSpeeds=entry.flowSpeeds||[],wind=this.wind||{x:0,z:0,strength:0};
    const rawWindStrength=clamp(wind.strength||0,0,8),windStrength=globalThis.EnvironmentEngine?.windVisualStrength?.(rawWindStrength)??rawWindStrength;
    const wx=Number(wind.x||0),wz=Number(wind.z||0),wpx=-wz,wpz=wx,windPresence=smooth01(rawWindStrength/.8);
    // Keep low wind close to the old look, then let actual 4-8 force steepen the
    // surface progressively. The only cap is geometric safety, not wind compression.
    const windAmp=ELEVATION_HEIGHT*Math.min(.24,.010*windPresence+.012*windStrength+.0036*windStrength*windStrength),windK=(2.15+windStrength*.72)/TILE_SIZE,windRate=.75+windStrength*.82,calmAmp=ELEVATION_HEIGHT*.009;
    const rogueWaves=this.rogueWaves.filter(wave=>wave.surfaceIds.has(entry.id));
    for(let i=0;i<base.length/3;i++){
      const o=i*3,x=base[o],z=base[o+2],w=Number(weights[i]||0);let wave=0,dydx=0,dydz=0;
      const fs=clamp(flowSpeeds[i]||0,0,3.2);let fx=Number(flowX[i]||0),fz=Number(flowZ[i]||0),flen=Math.hypot(fx,fz);
      if(fs>EPSILON&&flen>EPSILON){
        fx/=flen;fz/=flen;const fpx=-fz,fpz=fx,flowUnit=smooth01(fs/3.2),flowAmp=ELEVATION_HEIGHT*(.014+.026*flowUnit),flowK=(3+fs*1.25)/TILE_SIZE,crossK=(4.3+fs*.85)/TILE_SIZE,rate=.82+fs*.96,along=x*fx+z*fz,cross=x*fpx+z*fpz,p1=along*flowK-time*rate*2.8,p2=cross*crossK-time*rate*1.12;
        wave+=flowAmp*(Math.sin(p1)+.28*Math.sin(p2));dydx+=flowAmp*(Math.cos(p1)*flowK*fx+.28*Math.cos(p2)*crossK*fpx);dydz+=flowAmp*(Math.cos(p1)*flowK*fz+.28*Math.cos(p2)*crossK*fpz);
      }else if(rawWindStrength<=EPSILON){
        const p1=(x*.78+z*.42)*(2/TILE_SIZE)-time*.46,p2=(x*.31-z*.86)*(2.6/TILE_SIZE)+time*.31;
        wave+=calmAmp*(Math.sin(p1)+.42*Math.sin(p2));dydx+=calmAmp*(Math.cos(p1)*(2/TILE_SIZE)*.78+.42*Math.cos(p2)*(2.6/TILE_SIZE)*.31);dydz+=calmAmp*(Math.cos(p1)*(2/TILE_SIZE)*.42-.42*Math.cos(p2)*(2.6/TILE_SIZE)*.86);
      }
      if(rawWindStrength>EPSILON){
        const along=x*wx+z*wz,cross=x*wpx+z*wpz,p1=along*windK-time*windRate*2.35,p2=cross*(windK*1.42)+time*windRate*.72;
        wave+=windAmp*(Math.sin(p1)+.36*Math.sin(p2));dydx+=windAmp*(Math.cos(p1)*windK*wx+.36*Math.cos(p2)*windK*1.42*wpx);dydz+=windAmp*(Math.cos(p1)*windK*wz+.36*Math.cos(p2)*windK*1.42*wpz);
      }
      for(const whirl of this.whirlpools.values()){
        if(!whirl.surfaceIds?.has(entry.id))continue;const rx=x-whirl.cx,rz=z-whirl.cz,r=Math.hypot(rx,rz),radius=Math.max(TILE_SIZE*.7,whirl.radiusWorld);if(r>=radius)continue;
        const q=1-r/radius,mask=smooth01(q),strength=Math.max(.5,Number(whirl.strength||2.4)),dip=ELEVATION_HEIGHT*Math.min(.34,.045+.028*strength),ring=ELEVATION_HEIGHT*Math.min(.08,.012+.006*strength)*Math.sin(r*(5.2/TILE_SIZE)-time*(2.3+strength*.65));
        wave+=(-dip*mask*mask+ring*mask);const radial=(r>.001?1/r:0),slope=(2*dip*mask/radius-ring*(5.2/TILE_SIZE)*Math.cos(r*(5.2/TILE_SIZE)-time*(2.3+strength*.65)))*mask;dydx+=slope*rx*radial;dydz+=slope*rz*radial;
      }
      let rogueShiftX=0,rogueShiftZ=0;
      for(const rogue of rogueWaves){
        const age=time-rogue.startedAt;if(age<0||age>rogue.duration)continue;
        const t=clamp(age/rogue.duration,0,1),progress=smooth01(t),crestBase=rogue.startAlong+(rogue.endAlong-rogue.startAlong)*progress,along=x*rogue.dx+z*rogue.dz,perp=-x*rogue.dz+z*rogue.dx,edgeDistance=Math.min(perp-(rogue.minPerp-TILE_SIZE*.65),(rogue.maxPerp+TILE_SIZE*.65)-perp);
        if(edgeDistance<=0)continue;
        const edgeFade=smooth01(edgeDistance/(TILE_SIZE*.65)),phase=Number(rogue.phase||0),frontWarp=TILE_SIZE*(.10*Math.sin(perp*(1.35/TILE_SIZE)+phase)+.045*Math.sin(perp*(3.8/TILE_SIZE)+phase*1.73)),crest=crestBase+frontWarp,delta=along-crest;
        const width=TILE_SIZE*.46,troughWidth=width*1.18,curlWidth=width*.62;
        const crestShape=Math.exp(-(delta*delta)/(2*width*width)),retreatDelta=delta-TILE_SIZE*.62,retreatShape=Math.exp(-(retreatDelta*retreatDelta)/(2*troughWidth*troughWidth)),curlDelta=delta+TILE_SIZE*.30,curlShape=Math.exp(-(curlDelta*curlDelta)/(2*curlWidth*curlWidth));
        const retreatPhase=1-smooth01(clamp((t-.04)/.24,0,1)),pushPhase=smooth01(clamp((t-.14)/.28,0,1)),curlPhase=smooth01(clamp((t-.50)/.24,0,1)),lateFade=1-.32*smooth01(clamp((t-.84)/.16,0,1));
        const crossVariation=clamp(.90+.10*Math.sin(perp*(1.8/TILE_SIZE)+phase*.71)+.05*Math.sin(perp*(4.6/TILE_SIZE)+phase*1.41),.76,1.12);
        const pushGain=1.02*pushPhase*lateFade,curlGain=.30*curlPhase,retreatGain=.58*retreatPhase;
        const height=rogue.amplitude*(pushGain*crestShape-retreatGain*retreatShape+curlGain*curlShape)*edgeFade*crossVariation;
        wave+=height;
        const dAlong=rogue.amplitude*((-delta/(width*width))*pushGain*crestShape+retreatGain*(retreatDelta/(troughWidth*troughWidth))*retreatShape-curlGain*(curlDelta/(curlWidth*curlWidth))*curlShape)*edgeFade*crossVariation;
        dydx+=dAlong*rogue.dx;dydz+=dAlong*rogue.dz;
        const surge=TILE_SIZE*(-.10*retreatPhase*retreatShape+.17*pushPhase*crestShape+.09*curlPhase*curlShape)*edgeFade*crossVariation;
        rogueShiftX+=rogue.dx*surge;rogueShiftZ+=rogue.dz*surge;
      }
      wave*=w;dydx*=w;dydz*=w;rogueShiftX*=w;rogueShiftZ*=w;positions[o]=x+rogueShiftX;positions[o+1]=base[o+1]+wave;positions[o+2]=z+rogueShiftZ;if(w<=EPSILON){normals[o]=entry.baseNormals[o];normals[o+1]=entry.baseNormals[o+1];normals[o+2]=entry.baseNormals[o+2];}else{const inv=1/Math.hypot(dydx,1,dydz);normals[o]=-dydx*inv;normals[o+1]=inv;normals[o+2]=-dydz*inv;}
    }
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions,false,false);mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,normals,false,false);
  }

  resetSpecialSurface(entry){
    const mesh=entry?.mesh;if(!mesh||mesh.isDisposed?.())return;
    entry.positions.set(entry.basePositions);
    entry.normals.set(entry.baseNormals);
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,entry.positions,false,false);
    mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,entry.normals,false,false);
    entry.specialActive=false;if(mesh.metadata)mesh.metadata.waterSpecialActive=false;
  }

  animateSpecialSurface(entry,time){
    const mesh=entry?.mesh;if(!mesh||mesh.isDisposed?.())return;
    const base=entry.basePositions,positions=entry.positions,normals=entry.normals,weights=entry.waveWeights;
    const whirls=[...this.whirlpools.values()].filter(whirl=>whirl.surfaceIds?.has(entry.id)).map(whirl=>{
      const strength=Math.max(.5,Number(whirl.strength||2.4));
      return{...whirl,radius:Math.max(TILE_SIZE*.7,whirl.radiusWorld),strength,dip:ELEVATION_HEIGHT*Math.min(.34,.045+.028*strength),ringAmp:ELEVATION_HEIGHT*Math.min(.08,.012+.006*strength),ringRate:2.3+strength*.65};
    });
    const rogues=this.rogueWaves.filter(rogue=>rogue.surfaceIds?.has(entry.id)).map(rogue=>{
      const age=time-rogue.startedAt;if(age<0||age>rogue.duration)return null;
      const t=clamp(age/rogue.duration,0,1),progress=smooth01(t);
      return{...rogue,t,crestBase:rogue.startAlong+(rogue.endAlong-rogue.startAlong)*progress,retreatPhase:1-smooth01(clamp((t-.04)/.24,0,1)),pushPhase:smooth01(clamp((t-.14)/.28,0,1)),curlPhase:smooth01(clamp((t-.50)/.24,0,1)),lateFade:1-.32*smooth01(clamp((t-.84)/.16,0,1))};
    }).filter(Boolean);
    if(!whirls.length&&!rogues.length){if(entry.specialActive)this.resetSpecialSurface(entry);return;}
    const vertexCount=base.length/3;
    for(let i=0;i<vertexCount;i++){
      const o=i*3,x=base[o],z=base[o+2],w=Number(weights[i]||0);let wave=0,dydx=0,dydz=0,shiftX=0,shiftZ=0;
      if(w>EPSILON){
        for(const whirl of whirls){
          const rx=x-whirl.cx,rz=z-whirl.cz,r=Math.hypot(rx,rz);if(r>=whirl.radius)continue;
          const q=1-r/whirl.radius,mask=smooth01(q),angle=r*(5.2/TILE_SIZE)-time*whirl.ringRate,ring=whirl.ringAmp*Math.sin(angle);
          wave+=(-whirl.dip*mask*mask+ring*mask);
          const radial=r>.001?1/r:0,slope=(2*whirl.dip*mask/whirl.radius-ring*(5.2/TILE_SIZE)*Math.cos(angle))*mask;
          dydx+=slope*rx*radial;dydz+=slope*rz*radial;
        }
        for(const rogue of rogues){
          const along=x*rogue.dx+z*rogue.dz,perp=-x*rogue.dz+z*rogue.dx,edgeDistance=Math.min(perp-(rogue.minPerp-TILE_SIZE*.65),(rogue.maxPerp+TILE_SIZE*.65)-perp);if(edgeDistance<=0)continue;
          const phase=Number(rogue.phase||0),frontWarp=TILE_SIZE*(.10*Math.sin(perp*(1.35/TILE_SIZE)+phase)+.045*Math.sin(perp*(3.8/TILE_SIZE)+phase*1.73)),delta=along-(rogue.crestBase+frontWarp);
          // Outside this band every Gaussian contribution is visually negligible.
          // Avoid three exponentials for distant vertices while keeping the same crest shape.
          if(Math.abs(delta)>TILE_SIZE*2.15)continue;
          const edgeFade=smooth01(edgeDistance/(TILE_SIZE*.65)),width=TILE_SIZE*.46,troughWidth=width*1.18,curlWidth=width*.62;
          const crestShape=Math.exp(-(delta*delta)/(2*width*width)),retreatDelta=delta-TILE_SIZE*.62,retreatShape=Math.exp(-(retreatDelta*retreatDelta)/(2*troughWidth*troughWidth)),curlDelta=delta+TILE_SIZE*.30,curlShape=Math.exp(-(curlDelta*curlDelta)/(2*curlWidth*curlWidth));
          const crossVariation=clamp(.90+.10*Math.sin(perp*(1.8/TILE_SIZE)+phase*.71)+.05*Math.sin(perp*(4.6/TILE_SIZE)+phase*1.41),.76,1.12),pushGain=1.02*rogue.pushPhase*rogue.lateFade,curlGain=.30*rogue.curlPhase,retreatGain=.58*rogue.retreatPhase;
          wave+=rogue.amplitude*(pushGain*crestShape-retreatGain*retreatShape+curlGain*curlShape)*edgeFade*crossVariation;
          const dAlong=rogue.amplitude*((-delta/(width*width))*pushGain*crestShape+retreatGain*(retreatDelta/(troughWidth*troughWidth))*retreatShape-curlGain*(curlDelta/(curlWidth*curlWidth))*curlShape)*edgeFade*crossVariation;
          dydx+=dAlong*rogue.dx;dydz+=dAlong*rogue.dz;
          const surge=TILE_SIZE*(-.10*rogue.retreatPhase*retreatShape+.17*rogue.pushPhase*crestShape+.09*rogue.curlPhase*curlShape)*edgeFade*crossVariation;
          shiftX+=rogue.dx*surge;shiftZ+=rogue.dz*surge;
        }
      }
      positions[o]=x+shiftX*w;positions[o+1]=base[o+1]+wave*w;positions[o+2]=z+shiftZ*w;
      if(w<=EPSILON){normals[o]=entry.baseNormals[o];normals[o+1]=entry.baseNormals[o+1];normals[o+2]=entry.baseNormals[o+2];}
      else{const inv=1/Math.hypot(dydx*w,1,dydz*w);normals[o]=-dydx*w*inv;normals[o+1]=inv;normals[o+2]=-dydz*w*inv;}
    }
    mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,positions,false,false);
    mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind,normals,false,false);
    entry.specialActive=true;if(mesh.metadata)mesh.metadata.waterSpecialActive=true;
  }

  createRogueWaveVisual(wave){
    if(!globalThis.BABYLON||!wave?.cells?.length)return null;
    // The rogue wave itself is the animated water mesh. Presentation meshes
    // only provide sparse breaking spray after the crest starts to curl.
    // No foam strip, ground ribbon, or tube is used to draw the wave front.
    const root=new BABYLON.TransformNode(`rogue-wave-spray-${wave.token}`,this.scene),spray=[];
    const capacity=Math.max(6,Math.min(18,Math.ceil((Number(wave.maxPerp-wave.minPerp)||0)/TILE_SIZE)+3));
    for(let i=0;i<capacity;i++){
      const droplet=BABYLON.MeshBuilder.CreateSphere(`rogue-wave-spray-${wave.token}-${i}`,{diameter:.07+(i%4)*.018,segments:4},this.scene);
      droplet.parent=root;droplet.material=this.rogueFoamMaterial;droplet.isPickable=false;droplet.visibility=0;droplet.metadata={phase:hash01(`${wave.token}:spray:${i}`)*Math.PI*2};
      spray.push(droplet);
    }
    root.metadata={kind:"rogue-wave-spray",presentationOnly:true,waterMeshIsWaveBody:true,noFoamRibbon:true};
    return{root,spray,dispose:()=>root.dispose(false,false)};
  }

  updateRogueWaveVisual(wave,age){
    const visual=wave?.visual;if(!visual)return;
    const t=clamp(age/Math.max(.001,wave.duration),0,1),progress=smooth01(t),crestBase=wave.startAlong+(wave.endAlong-wave.startAlong)*progress,curlPhase=smooth01(clamp((t-.50)/.24,0,1)),fade=smooth01(Math.min(1,t*5))*smooth01(Math.min(1,(1-t)*5)),phase=Number(wave.phase||0),frontHalf=TILE_SIZE*.62;
    let front=(wave.cells||[]).filter(cell=>{
      const warp=TILE_SIZE*(.10*Math.sin(Number(cell.perp)*(1.35/TILE_SIZE)+phase)+.045*Math.sin(Number(cell.perp)*(3.8/TILE_SIZE)+phase*1.73));
      return Math.abs(Number(cell.along)-(crestBase+warp))<=frontHalf;
    }).sort((a,b)=>Number(a.perp)-Number(b.perp));
    if(front.length>visual.spray.length){
      const sampled=[],last=front.length-1,count=visual.spray.length;
      for(let i=0;i<count;i++)sampled.push(front[Math.round(i*last/Math.max(1,count-1))]);
      front=sampled;
    }
    for(let i=0;i<visual.spray.length;i++){
      const droplet=visual.spray[i],cell=front[i];
      if(!cell||curlPhase<=.02){droplet.visibility=0;continue;}
      const meta=droplet.metadata||{},localPhase=Number(meta.phase||0),warp=TILE_SIZE*(.10*Math.sin(Number(cell.perp)*(1.35/TILE_SIZE)+phase)+.045*Math.sin(Number(cell.perp)*(3.8/TILE_SIZE)+phase*1.73)),crest=crestBase+warp,delta=clamp(crest-Number(cell.along),-TILE_SIZE*.34,TILE_SIZE*.34),side=(hash01(`${wave.token}:side:${cell.key}`)-.5)*TILE_SIZE*.52;
      const x=Number(cell.x)+wave.dx*delta-wave.dz*side,z=Number(cell.z)+wave.dz*delta+wave.dx*side,pulse=.5+.5*Math.sin(age*(7.6+(i%4)*.58)+localPhase),y=Number(cell.surfaceY||wave.surfaceY||0)+wave.amplitude*(.62+.28*pulse);
      droplet.position.set(x-wave.dx*TILE_SIZE*(.02+.05*pulse),y,z-wave.dz*TILE_SIZE*(.02+.05*pulse));droplet.scaling.set(.72+.50*pulse,1+.85*pulse,.72+.50*pulse);droplet.visibility=fade*curlPhase*(.18+.48*pulse);
    }
  }

  syncRogueWaveEvents(events=[],state=null){
    for(const event of events||[]){
      if(String(event?.type||"").toUpperCase()!=="ROGUE_WAVE")continue;
      const token=String(event.sequence??`${event.windForce||0}:${event.cells?.length||0}:${event.dx||0},${event.dy||0}:${event.durationMs||0}`);
      if(this.seenRogueWaveSequences.has(token))continue;
      this.seenRogueWaveSequences.add(token);while(this.seenRogueWaveSequences.size>64)this.seenRogueWaveSequences.delete(this.seenRogueWaveSequences.values().next().value);
      const cells=event.cells||[],dx=Number(event.dx||0),dz=Number(event.dy||0),length=Math.hypot(dx,dz);if(!cells.length||length<=EPSILON)continue;
      const ux=dx/length,uz=dz/length,px=-uz,pz=ux,cellKeys=new Set(cells.map(cell=>keyOf(cell.x,cell.y))),surfaceIds=new Set();
      for(const[id,entry]of this.surfaceAnimations)if([...entry.tileKeys].some(tileKey=>cellKeys.has(tileKey)))surfaceIds.add(id);
      if(!surfaceIds.size)continue;
      const stateTiles=new Map(tilesOf(state).map(tile=>[keyOf(tile.x,tile.y),tile]));
      const world=cells.map(cell=>{
        const x=Number(cell.x)*TILE_SIZE,z=Number(cell.y)*TILE_SIZE,tile=stateTiles.get(keyOf(cell.x,cell.y)),surfaceY=tile?logicalSurface(tile)*ELEVATION_HEIGHT+SURFACE_OFFSET:0;
        return{key:keyOf(cell.x,cell.y),x,z,along:x*ux+z*uz,perp:x*px+z*pz,surfaceY};
      });
      const along=world.map(point=>point.along),perp=world.map(point=>point.perp),surfaces=world.map(point=>point.surfaceY).filter(Number.isFinite),surfaceY=surfaces.length?average(surfaces):0;
      const wave={token,surfaceIds,cells:world,dx:ux,dz:uz,startAlong:Math.min(...along)-TILE_SIZE*.75,endAlong:Math.max(...along)+TILE_SIZE*.75,minPerp:Math.min(...perp),maxPerp:Math.max(...perp),amplitude:ELEVATION_HEIGHT*clamp(event.waveHeight??.45,.25,.90),duration:Math.max(.9,Number(event.durationMs||1600)/1000),startedAt:this.waveTime,surfaceY,phase:hash01(token)*Math.PI*2};
      wave.visual=this.createRogueWaveVisual(wave);this.rogueWaves.push(wave);
    }
  }

  whirlpoolState(state){
    const groups=new Map(),surfaceByKey=new Map(tilesOf(state).map(tile=>[keyOf(tile.x,tile.y),logicalSurface(tile)*ELEVATION_HEIGHT+SURFACE_OFFSET]));
    for(const tile of tilesOf(state)){
      const detail=(tile.effectDetails||[]).find(effect=>String(effect?.type||"")==="WHIRLPOOL");if(!detail)continue;const id=String(detail.vortexId||`${detail.centerX},${detail.centerY}`);if(!groups.has(id))groups.set(id,{id,cells:[],centerX:Number(detail.centerX??tile.x),centerY:Number(detail.centerY??tile.y),radius:Number(detail.radius||2),strength:Number(detail.strength||2.4)});groups.get(id).cells.push({x:Number(tile.x),y:Number(tile.y),surfaceY:Number(surfaceByKey.get(keyOf(tile.x,tile.y))||0)});
    }
    return groups;
  }
  createWhirlpoolVisual(whirl){
    const root=new BABYLON.TransformNode(`whirlpool-${whirl.id}`,this.scene),foam=this.rogueFoamMaterial,spirals=[];
    for(let arm=0;arm<2;arm++){
      const points=[],steps=28;for(let i=0;i<steps;i++){const u=i/(steps-1),a=arm*Math.PI+u*Math.PI*3.6,r=whirl.radiusWorld*(.86-.72*u);points.push(new BABYLON.Vector3(Math.cos(a)*r,.025+u*.015,Math.sin(a)*r));}
      const tube=BABYLON.MeshBuilder.CreateTube(`whirlpool-spiral-${whirl.id}-${arm}`,{path:points,radius:.025,tessellation:5,cap:BABYLON.Mesh.CAP_ALL},this.scene);tube.parent=root;tube.material=foam;tube.isPickable=false;tube.visibility=.62;spirals.push(tube);
    }
    const ring=BABYLON.MeshBuilder.CreateTorus(`whirlpool-core-${whirl.id}`,{diameter:Math.max(.25,whirl.radiusWorld*.28),thickness:.035,tessellation:24},this.scene);ring.parent=root;ring.material=foam;ring.isPickable=false;ring.visibility=.76;
    root.metadata={kind:"whirlpool",presentationOnly:true,waterOnly:true,vortexId:whirl.id};return{root,spirals,ring,phase:hash01(whirl.id)*Math.PI*2};
  }
  updateWhirlpoolVisual(whirl,dt){
    const visual=whirl.visual;if(!visual)return;const speed=1.8+Math.max(.5,Number(whirl.strength||2.4))*.65;visual.root.rotation.y-=dt*speed;const pulse=.92+.12*Math.sin(this.waveTime*3.4+visual.phase);visual.root.scaling.set(pulse,1,pulse);visual.ring.scaling.set(1+.12*Math.sin(this.waveTime*4.2+visual.phase),.45,1+.12*Math.sin(this.waveTime*4.2+visual.phase));
  }
  syncWhirlpools(state){
    const next=this.whirlpoolState(state),live=new Set(next.keys());for(const[id,entry]of this.whirlpools)if(!live.has(id)){entry.visual?.root?.dispose?.();this.whirlpools.delete(id);}
    for(const[id,data]of next){const surfaceIds=new Set(),cellKeys=new Set(data.cells.map(cell=>keyOf(cell.x,cell.y)));for(const[surfaceId,entry]of this.surfaceAnimations)if([...entry.tileKeys].some(k=>cellKeys.has(k)))surfaceIds.add(surfaceId);if(!surfaceIds.size){const stale=this.whirlpools.get(id);stale?.visual?.root?.dispose?.();this.whirlpools.delete(id);continue;}const cx=data.centerX*TILE_SIZE,cz=data.centerY*TILE_SIZE,radiusWorld=Math.max(TILE_SIZE*.75,data.radius*TILE_SIZE),surfaceY=data.cells.length?average(data.cells.map(c=>c.surfaceY)):0;let entry=this.whirlpools.get(id);if(!entry){entry={...data,cx,cz,radiusWorld,surfaceY,surfaceIds};entry.visual=this.createWhirlpoolVisual(entry);this.whirlpools.set(id,entry);}else Object.assign(entry,data,{cx,cz,radiusWorld,surfaceY,surfaceIds});entry.visual.root.position.set(cx,surfaceY+.018,cz);}
  }

  waterEdgeRelation(a,b){
    const state=globalThis.HydrologyEngine?.edgeFlowState?.(a,b,{
      maxSlopeDelta:this.surfaceResolver.maxVisualSlopeDelta,
      minCascadeDrop:WATERFALL_MIN_DROP
    });
    if(state)return{...state,authored:state.authored===true,slope:state.type==="CONTINUOUS"&&state.reason==="TRAVERSABLE"};
    // HydrologyEngine is part of the battle runtime. This fallback keeps the
    // renderer inert rather than inventing a waterfall if it is unavailable.
    if(!hasAnyWater(a)||!hasAnyWater(b))return{type:"SHORE",drop:0,high:null,low:null,authored:false};
    return{type:"LEVEL_BREAK",drop:Math.abs(visualSurface(a)-visualSurface(b)),high:null,low:null,authored:false};
  }

  isCascadeBoundary(a,b){
    return this.waterEdgeRelation(a,b).type==="CASCADE";
  }

  continuousWaterEdge(a,b){
    return !!a&&!!b&&this.isRenderableWater(a)&&this.isRenderableWater(b)&&this.waterEdgeRelation(a,b).type==="CONTINUOUS";
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
    const members=[];
    const seen=new Set();
    const ownerKey=keyOf(tile.x,tile.y);
    const queue=[];
    if(this.isRenderableWater(tile)){seen.add(ownerKey);queue.push(tile);}

    // All water patches meeting at one geometric corner must derive that corner
    // from the same connected set. Flood only inside this 2x2 corner block and
    // only across Hydrology CONTINUOUS edges; LEVEL_BREAK/CASCADE edges remain
    // hard boundaries. This restores shared vertices without leaking around cliffs.
    while(queue.length){
      const current=queue.shift();
      members.push(current);
      for(const step of DIRS){
        const nx=Number(current.x)+step.dx,ny=Number(current.y)+step.dy;
        const next=slotTiles.get(keyOf(nx,ny));
        if(!next||!this.isRenderableWater(next)||seen.has(keyOf(nx,ny)))continue;
        if(!this.continuousWaterEdge(current,next))continue;
        seen.add(keyOf(nx,ny));queue.push(next);
      }
    }

    const memberKeys=new Set(members.map(member=>keyOf(member.x,member.y)));
    const drySlots=slots.filter(slot=>!memberKeys.has(keyOf(slot.x,slot.y)));
    let cascade=false,levelBreak=false;

    // Corner boundary type is owner-local. Looking at every edge in the 2x2
    // neighbourhood lets an unrelated cliff on the far side contaminate this
    // tile's corner and is another form of cross-break topology leakage.
    for(const sideDir of [{dx:dir.dx,dy:0},{dx:0,dy:dir.dy}]){
      const next=allMap.get(keyOf(tile.x+sideDir.dx,tile.y+sideDir.dy));
      if(!next||!hasAnyWater(next))continue;
      const relation=this.waterEdgeRelation(tile,next);
      if(relation.type==="CASCADE")cascade=true;
      else if(relation.type==="LEVEL_BREAK")levelBreak=true;
    }

    return{gx,gy,slots,members,drySlots,memberKeys,cascade,levelBreak};
  }

  cornerMembers(tile,index,allMap){
    return this.cornerContext(tile,index,allMap)?.members||[tile];
  }

  ringMode(tile,index,allMap){
    const edgeDir=EDGE_DIR_BY_RING[index];
    if(edgeDir){
      const neighbor=allMap.get(keyOf(tile.x+edgeDir.dx,tile.y+edgeDir.dy));
      // A missing cardinal neighbour is the rectangular battlefield boundary, not
      // an ordinary dry shore. Treat it explicitly so shoreline projection never
      // samples beyond the map and invents terrain from the water tile itself.
      if(!neighbor)return"MAP_BOUNDARY";
      if(this.continuousWaterEdge(tile,neighbor))return"INTERNAL";
      if(hasAnyWater(neighbor)){
        const relation=this.waterEdgeRelation(tile,neighbor);
        if(relation.type==="CASCADE")return"CASCADE";
        if(relation.type==="LEVEL_BREAK")return"LEVEL_BREAK";
      }
      return"SHORE";
    }

    const context=this.cornerContext(tile,index,allMap);
    if(!context)return"MAP_BOUNDARY";
    // A corner can touch both the map edge and a real dry bank. The dry bank must
    // win, otherwise the corner is forced to the rectangular map edge while the
    // adjacent cardinal edge is clipped as SHORE, producing the visible wedge/crack.
    if(context.cascade)return"CASCADE";
    if(context.levelBreak)return"LEVEL_BREAK";
    const existingDry=context.drySlots.filter(slot=>slot.tile);
    if(existingDry.length)return"SHORE";
    if(context.slots.some(slot=>!slot.tile))return"MAP_BOUNDARY";
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
    if(!context||context.cascade||context.levelBreak)return false;
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

  mapBoundaryTarget(tile,sample){
    // Open-map water terminates exactly on the battlefield edge. Geometry stays
    // watertight; only wave displacement is suppressed at the cut face. Insetting
    // the mesh or fading its alpha creates the visible cracks seen on Safari.
    const cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    return{x:cx+Number(sample.ox||0)*TILE_SIZE,z:cz+Number(sample.oz||0)*TILE_SIZE};
  }

  renderedTerrainHeightAtWorld(worldX,worldZ,allMap,fallback=null){
    const tx=Math.round(Number(worldX||0)/TILE_SIZE),ty=Math.round(Number(worldZ||0)/TILE_SIZE);
    const tile=allMap?.get(keyOf(tx,ty));
    if(!tile)return fallback==null?null:Number(fallback);
    const ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE,oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    return this.surfaceResolver.sampleRenderedHeight(tile,allMap,ox,oz);
  }

  renderedTerrainHeightForTilePoint(owner,worldX,worldZ,allMap,fallback=null){
    if(!owner)return this.renderedTerrainHeightAtWorld(worldX,worldZ,allMap,fallback);
    let tx=Number(owner.x),ty=Number(owner.y);
    let ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE;
    let oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    // Exact shared-edge samples belong to the water tile that is currently being
    // tessellated. Only a point that truly crossed an edge switches to the neighbour.
    // This removes Math.round() ambiguity at cliff/shore edges without inventing a
    // second height field.
    const edgeEpsilon=1e-7;
    if(ox>.5+edgeEpsilon)tx+=1;else if(ox<-.5-edgeEpsilon)tx-=1;
    if(oz>.5+edgeEpsilon)ty+=1;else if(oz<-.5-edgeEpsilon)ty-=1;
    const tile=allMap?.get(keyOf(tx,ty));
    if(!tile)return fallback==null?null:Number(fallback);
    ox=(Number(worldX||0)-tx*TILE_SIZE)/TILE_SIZE;
    oz=(Number(worldZ||0)-ty*TILE_SIZE)/TILE_SIZE;
    return this.surfaceResolver.sampleRenderedHeight(tile,allMap,ox,oz);
  }

  projectShoreline(anchor,target,anchorLevel,targetLevel,allMap,fallbackTerrain,ownerTile=null){
    const clearance=t=>{
      const x=anchor.x+(target.x-anchor.x)*t;
      const z=anchor.z+(target.z-anchor.z)*t;
      const level=anchorLevel+(targetLevel-anchorLevel)*t;
      const terrain=this.renderedTerrainHeightForTilePoint(ownerTile,x,z,allMap,fallbackTerrain);
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

    if(mode==="MAP_BOUNDARY"){
      const target=this.mapBoundaryTarget(tile,sample);
      return{x:target.x,z:target.z,level:ringWater,clipped:true,relaxed:false,boundary:true,mode};
    }

    if(mode!=="SHORE"){
      return{x:fullX,z:fullZ,level:ringWater,clipped:false,relaxed:false,boundary:false,mode};
    }

    // Shore geometry has one source of truth again: the natural shoreline target
    // is intersected with the exact rendered terrain. Cliff profiles belong to
    // waterfall/cliff rendering only; they must not pull the whole water patch
    // inward or replace this shoreline topology.
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
      Number(sample.height||0),
      tile
    );
    return{
      ...projected,
      relaxed:Math.hypot(target.x-fullX,target.z-fullZ)>EPSILON,
      boundary:false,
      mode
    };
  }

  lerpWaterPoint(a,b,t){const q=clamp(Number(t||0),0,1);return{x:Number(a.x)+(Number(b.x)-Number(a.x))*q,z:Number(a.z)+(Number(b.z)-Number(a.z))*q,level:Number(a.level)+(Number(b.level)-Number(a.level))*q,clipped:!!(a.clipped||b.clipped),relaxed:!!(a.relaxed||b.relaxed),boundary:!!(a.boundary&&b.boundary),mode:a.mode===b.mode?a.mode:"BLENDED"};}

  edgeWaterPoint(a,mid,b,t){const q=clamp(Number(t||0),0,1);return q<=.5?this.lerpWaterPoint(a,mid,q*2):this.lerpWaterPoint(mid,b,(q-.5)*2);}

  waterPatchGrid(tile,allMap){
    const terrainRing=this.surfaceResolver.ringSamples(tile,allMap),ring=terrainRing.map((sample,index)=>this.shorelinePoint(tile,index,sample,allMap));
    const steps=[0,1/3,2/3,1],nw=ring[0],ne=ring[2],se=ring[4],sw=ring[6],grid=[];
    const boundaryTop=ring[1].mode==="MAP_BOUNDARY",boundaryRight=ring[3].mode==="MAP_BOUNDARY",boundaryBottom=ring[5].mode==="MAP_BOUNDARY",boundaryLeft=ring[7].mode==="MAP_BOUNDARY";
    for(let rowIndex=0;rowIndex<steps.length;rowIndex++){
      const t=steps[rowIndex];
      const left=this.edgeWaterPoint(nw,ring[7],sw,t),right=this.edgeWaterPoint(ne,ring[3],se,t),row=[];
      for(let colIndex=0;colIndex<steps.length;colIndex++){
        const q=steps[colIndex];
        const top=this.edgeWaterPoint(nw,ring[1],ne,q),bottom=this.edgeWaterPoint(sw,ring[5],se,q);
        const bilinear=(field)=>(1-q)*(1-t)*Number(nw[field])+q*(1-t)*Number(ne[field])+(1-q)*t*Number(sw[field])+q*t*Number(se[field]);
        const mapBoundary=(rowIndex===0&&boundaryTop)||(rowIndex===steps.length-1&&boundaryBottom)||(colIndex===0&&boundaryLeft)||(colIndex===steps.length-1&&boundaryRight);
        row.push({
          x:(1-t)*Number(top.x)+t*Number(bottom.x)+(1-q)*Number(left.x)+q*Number(right.x)-bilinear("x"),
          z:(1-t)*Number(top.z)+t*Number(bottom.z)+(1-q)*Number(left.z)+q*Number(right.z)-bilinear("z"),
          level:(1-t)*Number(top.level)+t*Number(bottom.level)+(1-q)*Number(left.level)+q*Number(right.level)-bilinear("level"),
          clipped:(t===0&&top.clipped)||(t===1&&bottom.clipped)||(q===0&&left.clipped)||(q===1&&right.clipped),
          relaxed:(t===0&&top.relaxed)||(t===1&&bottom.relaxed)||(q===0&&left.relaxed)||(q===1&&right.relaxed),
          boundaryWaveFade:mapBoundary?0:1,
          mode:"PATCH"
        });
      }
      grid.push(row);
    }
    return{grid,ring};
  }

  waterVertexVisual(point,allMap,turbidity=0,tile=null){
    const terrain=this.renderedTerrainHeightForTilePoint(tile,point.x,point.z,allMap,tile?Number(tile.elevation||0):null);
    // Water colour/depth and clipping sample the exact 4x4 terrain triangles that
    // TerrainRenderer draws. A second interpolated height field is what caused
    // water to paste through/downhill terrain even when both systems looked valid alone.
    const resolvedTerrain=terrain==null&&tile?Number(tile.elevation||0):terrain;
    const depth=Math.max(0,Number(point.level)-(resolvedTerrain==null?Number(point.level):Number(resolvedTerrain)));
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

    const visual=this.waterVertexVisual(point,allMap,turbidity,tile);
    const index=out.positions.length/3;
    out.positions.push(point.x,y,point.z);
    out.uvs.push(point.x/(TILE_SIZE*3.25),point.z/(TILE_SIZE*3.25));
    const boundaryWaveFade=clamp(point.boundaryWaveFade??1,0,1);
    out.colors.push(visual.color[0],visual.color[1],visual.color[2],visual.alpha);
    out.waveWeights.push(smooth01(visual.depth/.34)*boundaryWaveFade);
    out.flowXSum.push(0);out.flowZSum.push(0);out.flowSpeedSum.push(0);out.flowSampleCount.push(0);
    out.cascadeData.push(0,0);
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

  addCascadeVertex(out,point,turbidity,tile,progress=0){
    const index=out.positions.length/3;
    const depthTone=smooth01((.28+Math.max(0,Number(point.drop||0))*.18)/WATER_DEPTH_RANGE);
    let color=mixColor(WATER_SHALLOW_COLOR,WATER_DEEP_COLOR,depthTone);
    const murky=clamp(Number(turbidity||0),0,1);if(murky>EPSILON)color=mixColor(color,WATER_MURKY_COLOR,murky*.58);
    const alpha=clamp(.68+Math.sin(clamp(progress,0,1)*Math.PI)*.08+murky*.04,.62,.82);
    const worldY=Number.isFinite(Number(point.worldY))
      ?Number(point.worldY)
      :Number(point.level)*ELEVATION_HEIGHT+SURFACE_OFFSET;
    out.positions.push(Number(point.x),worldY,Number(point.z));
    out.uvs.push(Number(point.x)/(TILE_SIZE*3.25),Number(point.z)/(TILE_SIZE*3.25));
    out.colors.push(color[0],color[1],color[2],alpha);
    out.waveWeights.push(0);
    out.flowXSum.push(0);out.flowZSum.push(0);out.flowSpeedSum.push(0);out.flowSampleCount.push(0);
    out.cascadeData.push(clamp(progress,0,1),1);
    return index;
  }

  cascadeDirection(edge){
    const dx=Math.sign(Number(edge?.dx||0)),dy=Math.sign(Number(edge?.dy||0));
    if(dx===1&&dy===0)return{id:"E",dx:1,dy:0};
    if(dx===-1&&dy===0)return{id:"W",dx:-1,dy:0};
    if(dx===0&&dy===1)return{id:"S",dx:0,dy:1};
    if(dx===0&&dy===-1)return{id:"N",dx:0,dy:-1};
    return null;
  }

  waterGridEdgePoints(tile,dir,allMap){
    const patch=this.waterPatchGrid(tile,allMap)?.grid;
    if(!patch?.length)return[];
    if(dir.id==="N")return [...patch[0]];
    if(dir.id==="E")return patch.map(row=>row[3]);
    if(dir.id==="S")return [...patch[3]].reverse();
    if(dir.id==="W")return [...patch].reverse().map(row=>row[0]);
    return[];
  }

  waterGridFlowRows(tile,dir,allMap){
    const patch=this.waterPatchGrid(tile,allMap)?.grid;
    if(!patch?.length)return[];
    const rows=[];
    if(dir.id==="E"){
      for(let step=0;step<4;step++)rows.push(patch.map(row=>row[step]));
    }else if(dir.id==="W"){
      for(let step=0;step<4;step++)rows.push([...patch].reverse().map(row=>row[3-step]));
    }else if(dir.id==="S"){
      for(let step=0;step<4;step++)rows.push([...patch[step]].reverse());
    }else if(dir.id==="N"){
      for(let step=0;step<4;step++)rows.push([...patch[3-step]]);
    }
    return rows;
  }

  appendCascadeSheet(out,edge,turbidity,allMap){
    const dir=this.cascadeDirection(edge);
    const profile=dir&&this.terrainRenderer?.cliffFaceProfile?.(edge.tile,dir,allMap);
    if(!profile?.points?.length)return;

    const highEdge=this.waterGridEdgePoints(edge.tile,dir,allMap);
    const lowRows=this.waterGridFlowRows(edge.receiver,dir,allMap);
    const cliff=profile.points;
    const columns=Math.min(highEdge.length,cliff.length,...lowRows.map(row=>row.length));
    if(columns<2)return;

    const topLevel=Number(edge.top),bottomLevel=Number(edge.bottom),drop=Math.max(0,topLevel-bottomLevel);
    if(drop<WATERFALL_MIN_DROP)return;
    const topWaterY=topLevel*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const bottomWaterY=bottomLevel*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const dirX=Number(dir.dx),dirZ=Number(dir.dy);
    const wallRenderOffset=SURFACE_OFFSET*.75;

    const pointRow=(points,progress,worldYForPoint)=>points.slice(0,columns).map((point,index)=>({
      x:Number(point.x),z:Number(point.z),drop,progress,
      worldY:Number(worldYForPoint(point,index))
    }));

    const rows=[];
    const appendRow=points=>{
      if(points.length!==columns)return;
      const previous=rows[rows.length-1];
      if(previous&&points.every((point,index)=>
        Math.hypot(point.x-previous[index].x,point.z-previous[index].z,point.worldY-previous[index].worldY)<=1e-7
      ))return;
      rows.push(points);
    };

    appendRow(pointRow(highEdge,0,()=>topWaterY));

    const wall=cliff.slice(0,columns).map(point=>({
      x:Number(point.x)+dirX*wallRenderOffset,
      z:Number(point.z)+dirZ*wallRenderOffset,
      topY:Number(point.topY),
      bottomY:Number(point.bottomY)
    }));
    appendRow(pointRow(wall,.04,()=>topWaterY));

    const footY=wall.map(point=>Math.max(bottomWaterY,Number(point.bottomY)+SURFACE_OFFSET));
    for(const progress of [.34,.67,.94]){
      appendRow(pointRow(wall,progress,(point,index)=>
        topWaterY+(footY[index]-topWaterY)*(progress/.94)
      ));
    }

    for(let step=0;step<lowRows.length;step++){
      const source=lowRows[step].slice(0,columns);
      const progress=.94+(step+1)/lowRows.length*.06;
      const landing=source.map((point,index)=>{
        const wallPoint=wall[index];
        const along=(Number(point.x)-wallPoint.x)*dirX+(Number(point.z)-wallPoint.z)*dirZ;
        const x=along>0?Number(point.x):wallPoint.x;
        const z=along>0?Number(point.z):wallPoint.z;
        const terrain=this.renderedTerrainHeightForTilePoint(
          edge.receiver,x,z,allMap,Number(edge.receiver?.elevation||0)
        );
        const groundY=Number(terrain??edge.receiver?.elevation??0)*ELEVATION_HEIGHT+SURFACE_OFFSET;
        return{x,z,drop,progress,worldY:Math.max(bottomWaterY,groundY)};
      });
      appendRow(landing);
    }

    if(rows.length<2)return;
    const grid=rows.map(row=>row.map(point=>this.addCascadeVertex(
      out,point,turbidity,edge.tile,point.progress
    )));

    const distance3=(a,b)=>{
      const ax=out.positions[a*3],ay=out.positions[a*3+1],az=out.positions[a*3+2];
      const bx=out.positions[b*3],by=out.positions[b*3+1],bz=out.positions[b*3+2];
      return (ax-bx)**2+(ay-by)**2+(az-bz)**2;
    };

    for(let r=0;r<grid.length-1;r++)for(let c=0;c<columns-1;c++){
      const a=grid[r][c],b=grid[r][c+1],d=grid[r+1][c],e=grid[r+1][c+1];
      if(distance3(a,e)<=distance3(b,d))out.indices.push(a,b,e,a,e,d);
      else out.indices.push(a,b,d,b,e,d);
    }
  }

  buildSurface(component,state,cascades=[]){
    const out={positions:[],indices:[],normals:[],uvs:[],colors:[],waveWeights:[],flowXSum:[],flowZSum:[],flowSpeedSum:[],flowSampleCount:[],cascadeData:[]};
    const cache=new Map(),allMap=this.allByKey(state),componentTurbidity=average(component.tiles.map(tile=>this.turbidity(tile)));let clippedPoints=0;
    for(const tile of component.tiles){
      const patch=this.waterPatchGrid(tile,allMap);clippedPoints+=patch.ring.filter(point=>point.clipped).length;
      const grid=patch.grid.map(row=>row.map(point=>this.addVertex(out,cache,point,allMap,componentTurbidity,tile)));
      for(let row=0;row<3;row++)for(let col=0;col<3;col++){
        const nw=grid[row][col],ne=grid[row][col+1],sw=grid[row+1][col],se=grid[row+1][col+1],alternate=(Number(tile.x)+Number(tile.y)+row+col)&1;
        if(alternate===0){this.pushTriangle(out,nw,ne,se);this.pushTriangle(out,nw,se,sw);}else{this.pushTriangle(out,nw,ne,sw);this.pushTriangle(out,ne,se,sw);}
      }
    }
    const componentKeys=new Set(component.tiles.map(tile=>keyOf(tile.x,tile.y)));
    const componentCascades=(cascades||[]).filter(edge=>componentKeys.has(keyOf(edge.tile.x,edge.tile.y)));
    for(const edge of componentCascades)this.appendCascadeSheet(out,edge,componentTurbidity,allMap);
    if(!out.positions.length||!out.indices.length)return null;
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
    const mesh=new BABYLON.Mesh(`water-surface-${component.id}`,this.scene),data=new BABYLON.VertexData();data.positions=out.positions;data.indices=out.indices;data.normals=out.normals;data.uvs=out.uvs;data.colors=out.colors;data.applyToMesh(mesh,true);
    mesh.material=this.surfaceMaterial;mesh.alphaIndex=10;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.visibility=component.group==="fogged"?.22:1;
    mesh.metadata={kind:"water-surface",tileCount:component.tiles.length,sharedWetEdges:true,hydrologySurface:true,quantizedLevels:false,clippedShorePoints:clippedPoints,naturalShoreline:true,topologyAwareShoreRelaxation:true,ruggedNaturalShoreline:true,ruggedRockBanks:true,visualSurfaceResolver:true,microRegionsPerTile:9,patchVerticesPerTile:16,trianglesPerTile:18,embeddedCascadeSheets:componentCascades.length,stylizedWater:true,depthGradient:true,vertexAlpha:true,alphaIndex:10,componentTurbidity,vertexCount:out.positions.length/3,triangleCount:out.indices.length/3};
    const flow=this.componentFlow(component),vertexFlowX=[],vertexFlowZ=[],vertexFlowSpeeds=[],waterAnim=[],waterBaseXZ=[];
    for(let i=0;i<out.positions.length/3;i++){const count=Math.max(1,Number(out.flowSampleCount[i]||0));let vx=Number(out.flowXSum[i]||0)/count,vz=Number(out.flowZSum[i]||0)/count;const speed=Number(out.flowSpeedSum[i]||0)/count,length=Math.hypot(vx,vz);if(length>EPSILON){vx/=length;vz/=length;}else{vx=0;vz=0;}vertexFlowX.push(vx);vertexFlowZ.push(vz);vertexFlowSpeeds.push(speed);waterAnim.push(vx,vz,speed,Number(out.waveWeights[i]||0));waterBaseXZ.push(Number(out.positions[i*3]||0),Number(out.positions[i*3+2]||0));}
    if(this.gpuSurfaceWaves){mesh.setVerticesData("waterAnim",waterAnim,false,4);mesh.setVerticesData("waterBaseXZ",waterBaseXZ,false,2);mesh.setVerticesData("waterCascade",out.cascadeData,false,2);}
    this.surfaceAnimations.set(component.id,{id:component.id,tileKeys:new Set(component.tiles.map(tile=>keyOf(tile.x,tile.y))),mesh,basePositions:Float32Array.from(out.positions),baseNormals:Float32Array.from(out.normals),positions:Float32Array.from(out.positions),normals:Float32Array.from(out.normals),waveWeights:Float32Array.from(out.waveWeights),flowX:Float32Array.from(vertexFlowX),flowZ:Float32Array.from(vertexFlowZ),flowSpeeds:Float32Array.from(vertexFlowSpeeds),specialActive:false});
    mesh.metadata.waterSurfaceWave=true;mesh.metadata.waterSpecialActive=false;mesh.metadata.waveDirection=flow.flowing?{x:flow.x,z:flow.z}:null;mesh.metadata.averageFlowSpeed=flow.flowing?flow.speed:0;mesh.metadata.localFlowSpeedWaves=true;mesh.freezeWorldMatrix();return mesh;
  }

  cascadeEdges(state,waterTiles){
    const allMap=this.allByKey(state),out=[];
    const rendered=new Set(waterTiles.map(tile=>keyOf(tile.x,tile.y)));
    const pairs=[[1,0],[0,1]];
    for(const tile of waterTiles){
      for(const[dx,dy]of pairs){
        const neighbor=allMap.get(keyOf(tile.x+dx,tile.y+dy));
        if(!neighbor)continue;
        const relation=this.waterEdgeRelation(tile,neighbor);
        if(relation.type!=="CASCADE"||!relation.high||!relation.low)continue;
        const high=relation.high,low=relation.low;
        const dir=this.cascadeDirection({dx:low.x-high.x,dy:low.y-high.y});
        const cliff=dir&&this.terrainRenderer?.cliffFaceProfile?.(high,dir,allMap);
        if(!cliff)continue;
        const top=visualSurface(high),bottom=hasAnyWater(low)?visualSurface(low):Number(low.elevation||0);
        const drop=top-bottom;
        if(drop<WATERFALL_MIN_DROP)continue;
        out.push({
          id:`${high.x},${high.y}->${low.x},${low.y}`,
          tile:high,receiver:low,
          dx:Math.sign(low.x-high.x),dy:Math.sign(low.y-high.y),
          top,bottom,drop,
          authoredDrop:relation.authored?Number(high.hydrologyCascadeDrop||drop):null,
          hydrologyEdgeReason:relation.reason||null,
          hydrologyEdgeRate:Number(relation.rate||0),
          inferredFromSurface:false,
          speed:Math.max(.6,Number(high.flowSpeed||0)+drop*.55),
          receiverRendered:rendered.has(keyOf(low.x,low.y))
        });
      }
    }
    return out;
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

  sync(state,presentationEvents=[]){
    this.setWind(state?.presentation?.environment?.wind||state?.environment?.wind||state?.wind||null);
    const waterTiles=this.waterTiles(state);
    const components=this.surfaceComponents(waterTiles);
    const cascades=this.cascadeEdges(state,waterTiles);
    this.embeddedCascadeCount=cascades.length;

    const surfaceSignature=this.surfaceSignatureFor(components,state);
    if(surfaceSignature!==this.surfaceSignature){
      this.disposeSurfaceMeshes();
      for(const component of components){
        const mesh=this.buildSurface(component,state,cascades);
        if(mesh)this.surfaceMeshes.set(component.id,mesh);
      }
      this.surfaceSignature=surfaceSignature;
    }
    this.syncRogueWaveEvents(presentationEvents,state);
    this.syncWhirlpools(state);
    for(const entry of this.surfaceAnimations.values()){
      if(!entry?.mesh?.metadata)continue;
      entry.mesh.metadata.windWaveStrength=this.wind.strength;
      entry.mesh.metadata.windWaveDirection=this.wind.strength>EPSILON?{x:this.wind.x,z:this.wind.z}:null;
    }

    if(!waterTiles.length){
      this.disposeSurfaceMeshes();
      this.surfaceSignature="";this.embeddedCascadeCount=0;
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      sideMeshes:0,
      cascades:this.embeddedCascadeCount,
      separatedWaterLevels:false,
      hydrologyContinuousSurface:true,
      sharedWetEdges:true,
      quantizedLevels:false,
      thinCascadeRibbon:false,
      embeddedCascadeSheet:true,
      sharedEdgeCascade:true,
      cascadeImpactRipples:false,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:MIN_WATER_DEPTH,
      shorelineSkirts:false,
      terrainClippedShoreline:true,
      naturalShoreline:true,
      shorelineRenderClearance:0,
      shorelineAlphaFadeDepth:0,
      mapBoundaryTermination:true,
      mapBoundaryInset:0,
      mapBoundaryWaveFade:true,
      mapBoundaryAlphaFade:false,
      topologyAwareShoreRelaxation:true,
      ruggedNaturalShoreline:true,
      ruggedRockBanks:true,
      sharedVisualSurfaceResolver:true,
      microRegionsPerTile:9,
      stylizedWater:true,
      animatedWaterSurface:true,
      waterWaveAnimation:this.gpuSurfaceWaves?"gpu-vertex-displacement":"cpu-vertex-displacement-30hz",
      gpuSurfaceWaves:this.gpuSurfaceWaves,
      cpuSurfaceUploadsOnlyForSpecialEvents:this.gpuSurfaceWaves,
      localFlowSpeedWaves:true,
      windDrivenWaves:true,
      windWaveStrength:Number(this.wind?.strength||0),
      refinedWaterTopology:true,
      edgeTopologyFromHydrologySurface:true,
      slopeWaterUsesSharedEdgeLevels:true,
      slopeWaterContinuousByTerrainResolver:true,
      implicitLevelBreaksRenderedAsCascades:false,
      waterSurfaceTrianglesPerTile:18,
      rogueWavePresentation:true,
      rogueWaveWaterBodyDeformation:true,
      rogueWaveFoamCrest:false,
      rogueWaveSprayOnly:true,
      activeRogueWaves:this.rogueWaves.length,
      whirlpoolPresentation:true,
      activeWhirlpools:this.whirlpools.size,
      currentOverlay:false,
      reflectiveWaterMaterial:false,
      depthGradient:true,
      vertexAlpha:true,
      transparentDepthPrePass:false,
      visualSurfaceResolver:this.surfaceResolver.diagnostics(),
      cascadesRequireHydrologyDirection:true,
      cascadesRequireHydrologyMetadata:false,
      cascadesRequireDownstreamWater:false,
      cascadeAuthority:"HydrologyEngine.edgeFlowState",
      rendererCascadeInference:false
    };
  }
}
