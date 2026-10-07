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
const WATER_DEPTH_RANGE=1.5;
const WATER_SHALLOW_COLOR=Object.freeze([.43,.78,.72]);
const WATER_DEEP_COLOR=Object.freeze([.045,.23,.38]);
const WATER_MURKY_COLOR=Object.freeze([.29,.31,.18]);
const WATER_SHALLOW_ALPHA=.46;
const WATER_DEEP_ALPHA=.82;

const DIRS=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}
]);

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
    this.runoffs=new Map();
    this.sourceFootprints=new Map();
    this.surfaceSignature="";
    this.cascadeSignature="";
    this.runoffSignature="";
    this.sourceSignature="";
    this.waveTime=0;
    this.waveAccumulator=0;
    this.wind={x:0,z:0,strength:0};
    this.renderableWaterKeys=new Set();
    this.rogueWaves=[];
    this.seenRogueWaveSequences=new Set();
    this.whirlpools=new Map();
    this.waterSeamRegistry=new Map();

    this.surfaceMaterial=this.makeSurfaceMaterial();

    const cascade=this.makeCascadeMaterial();
    this.cascadeMaterial=cascade.material;
    this.cascadeTexture=cascade.texture;
    const runoff=this.makeRunoffMaterial();
    this.runoffMaterial=runoff.material;
    this.runoffTexture=runoff.texture;
    this.foamMaterial=this.makeSideMaterial("water-foam",new BABYLON.Color3(.78,.93,1),.52);
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
      this.cascadeTexture.vOffset=(this.cascadeTexture.vOffset-dt*.72)%1;
      this.runoffTexture.vOffset=(this.runoffTexture.vOffset-dt*.28)%1;
      for(const entry of this.cascades.values()){
        const impact=Math.max(.32,Number(entry.impactScale||1)),p=1+Math.sin(this.waveTime*(2.6+impact*.9)+entry.phase)*(.035+.035*Math.min(1,impact));
        for(const group of entry.impacts||[]){
          group.foam.rotation.y+=dt*.7;
          group.foam.scaling.set(1.02*p,.24+.08*Math.min(1,impact),.62*p);
          for(let i=0;i<(group.ripples||[]).length;i++){
            const ripple=group.ripples[i],q=(this.waveTime*(.52+.30*impact)+entry.phase*.07+i*.46)%1,scale=.55+q*.95;
            ripple.scaling.set(scale,.22,scale*.68);
            ripple.visibility=entry.baseVisibility*(1-q)*.72;
          }
        }
      }
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
      m.AddAttribute("waterSource");
      m.AddUniform("waterTime","float",0);
      m.AddUniform("waterSpecialActive","float",0);
      m.AddUniform("waterWind","vec4",new BABYLON.Vector4(0,0,0,0));
      m.AddUniform("waterTileSize","float",TILE_SIZE);
      m.AddUniform("waterElevationHeight","float",ELEVATION_HEIGHT);
      m.Vertex_Definitions(`
        attribute vec4 waterAnim;
        attribute vec2 waterBaseXZ;
        attribute vec2 waterSource;
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
        float sourcePulse=waterSource.x*(0.58+0.42*sin(waterTime*4.4-waterSource.y*6.2831853));
        positionUpdated.y+=waterWaveValue.x*waterAnim.w+waterElevationHeight*.034*sourcePulse;
      `);
      m.Vertex_Before_NormalUpdated(`
        if(waterSpecialActive>.5){
          normalUpdated=normalize(vec3(
            normalUpdated.x-waterWaveValue.y*waterAnim.w,
            max(.18,normalUpdated.y),
            normalUpdated.z-waterWaveValue.z*waterAnim.w
          ));
        }else{
          normalUpdated=normalize(vec3(-waterWaveValue.y*waterAnim.w,1.0,-waterWaveValue.z*waterAnim.w));
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

  makeCascadeMaterial(){
    const texture=new BABYLON.DynamicTexture("cascade-flow-texture",{width:96,height:256},this.scene,true);
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
    material.diffuseColor=new BABYLON.Color3(.46,.79,.96);
    material.emissiveColor=new BABYLON.Color3(.025,.075,.095);
    material.alpha=.78;
    material.specularColor=new BABYLON.Color3(.58,.76,.90);
    material.specularPower=34;
    material.backFaceCulling=false;
    material.needDepthPrePass=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return{material,texture};
  }

  makeRunoffMaterial(){
    // Surface runoff is a thin terrain-following film, not a miniature waterfall.
    // Give it its own low-contrast flow texture so it cannot draw bright rails across
    // established river/lake surfaces or inherit the cascade's white streak pattern.
    const texture=new BABYLON.DynamicTexture("runoff-flow-texture",{width:96,height:256},this.scene,true);
    texture.hasAlpha=true;
    const ctx=texture.getContext();
    ctx.clearRect(0,0,96,256);
    const cross=ctx.createLinearGradient(0,0,96,0);
    cross.addColorStop(0,"rgba(164,220,236,0.04)");
    cross.addColorStop(.22,"rgba(160,224,238,0.20)");
    cross.addColorStop(.5,"rgba(190,236,244,0.30)");
    cross.addColorStop(.78,"rgba(160,224,238,0.20)");
    cross.addColorStop(1,"rgba(164,220,236,0.04)");
    ctx.fillStyle=cross;ctx.fillRect(0,0,96,256);
    ctx.strokeStyle="rgba(228,248,250,0.14)";ctx.lineWidth=2;
    for(let y=18;y<256;y+=52){ctx.beginPath();ctx.moveTo(12,y);ctx.bezierCurveTo(32,y+5,62,y-4,84,y+2);ctx.stroke();}
    texture.update();texture.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;texture.wrapU=BABYLON.Texture.CLAMP_ADDRESSMODE;

    const material=new BABYLON.StandardMaterial("surface-runoff-water",this.scene);
    material.diffuseTexture=texture;
    material.diffuseColor=new BABYLON.Color3(.39,.70,.76);
    // The wet-footprint mesh owns bank transparency through vertex alpha. Keep the
    // animated texture as colour/detail only; multiplying texture alpha * material
    // alpha * vertex alpha made real Q-only spring flow almost disappear on bright
    // terrain even though the geometry existed. The old black rail is prevented by
    // zero-alpha bank vertices, not by hiding the whole transport surface.
    material.useAlphaFromDiffuseTexture=false;
    material.emissiveColor=new BABYLON.Color3(.055,.12,.14);
    material.alpha=.56;
    material.specularColor=new BABYLON.Color3(.18,.30,.34);
    material.specularPower=20;
    // A paper-thin water film should not turn into a black shadow patch when the
    // directional light is grazing the terrain. Terrain geometry still supplies Y.
    material.disableLighting=true;
    material.backFaceCulling=false;material.needDepthPrePass=false;
    if(BABYLON.Material?.MATERIAL_ALPHABLEND!=null)material.transparencyMode=BABYLON.Material.MATERIAL_ALPHABLEND;
    return{material,texture};
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
    const sourceWeights=entry.sourceWeights||[],sourcePhases=entry.sourcePhases||[];
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
      wave*=w;dydx*=w;dydz*=w;rogueShiftX*=w;rogueShiftZ*=w;
      const sourceWeight=Number(sourceWeights[i]||0),sourcePhase=Number(sourcePhases[i]||0);
      if(sourceWeight>EPSILON)wave+=ELEVATION_HEIGHT*.034*sourceWeight*(.58+.42*Math.sin(time*4.4-sourcePhase*Math.PI*2));
      positions[o]=x+rogueShiftX;positions[o+1]=base[o+1]+wave;positions[o+2]=z+rogueShiftZ;const inv=1/Math.hypot(dydx,1,dydz);normals[o]=-dydx*inv;normals[o+1]=inv;normals[o+2]=-dydz*inv;
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
      const inv=1/Math.hypot(dydx*w,1,dydz*w);normals[o]=-dydx*w*inv;normals[o+1]=inv;normals[o+2]=-dydz*w*inv;
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

  cascadeTarget(tile){
    const x=Number(tile?.hydrologyCascadeToX),y=Number(tile?.hydrologyCascadeToY),drop=Number(tile?.hydrologyCascadeDrop||0);
    if(!Number.isFinite(x)||!Number.isFinite(y)||drop<WATERFALL_MIN_DROP)return null;
    return{x,y,drop};
  }

  legacyCascadeState(a,b){
    const targetA=this.cascadeTarget(a),targetB=this.cascadeTarget(b);
    let from=null,to=null,target=null;
    if(targetA&&targetA.x===Number(b?.x)&&targetA.y===Number(b?.y)){from=a;to=b;target=targetA;}
    else if(targetB&&targetB.x===Number(a?.x)&&targetB.y===Number(a?.y)){from=b;to=a;target=targetB;}
    if(!from||!to||!hasAnyWater(from))return null;
    const top=visualSurface(from),bottom=hasAnyWater(to)?visualSurface(to):Number(to?.elevation||0),drop=top-bottom;
    if(drop<WATERFALL_MIN_DROP)return null;
    return{cascade:true,flowing:true,authored:true,from,to,dirX:Math.sign(to.x-from.x),dirY:Math.sign(to.y-from.y),surfaceDrop:drop,rate:Number(from.discharge||0),reason:"LEGACY_AUTHORED_CASCADE",authoredDrop:target.drop};
  }

  hydrologyEdgeState(a,b){
    if(!a||!b)return null;
    const resolved=globalThis.HydrologyEngine?.edgeFlowState?.(a,b,{
      minCascadeDrop:WATERFALL_MIN_DROP,
      minCliffDrop:this.surfaceResolver.maxVisualSlopeDelta
    });
    return resolved||this.legacyCascadeState(a,b);
  }

  isCascadeBoundary(a,b){
    if(!a||!b||(!hasAnyWater(a)&&!hasAnyWater(b)))return false;
    return this.hydrologyEdgeState(a,b)?.cascade===true;
  }

  continuousWaterEdge(a,b){
    return !!a&&!!b&&this.isRenderableWater(a)&&this.isRenderableWater(b)&&!this.isCascadeBoundary(a,b);
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

  waterLevelAtWorld(tile,x,z,allMap){
    if(!tile)return 0;
    const gx=Number(x)/TILE_SIZE,gz=Number(z)/TILE_SIZE;
    const xs=[Math.floor(gx),Math.ceil(gx)],zs=[Math.floor(gz),Math.ceil(gz)];
    const local=new Map();
    for(const cy of zs)for(const cx of xs){
      const candidate=allMap.get(keyOf(cx,cy));
      if(candidate&&this.isRenderableWater(candidate))local.set(keyOf(cx,cy),candidate);
    }
    local.set(keyOf(tile.x,tile.y),tile);

    // Only blend hydrologically continuous water. A cascade/cliff is a hard
    // discontinuity, so its upper and lower free surfaces never get averaged.
    const reachable=new Map(),queue=[tile];
    while(queue.length){
      const current=queue.shift(),k=keyOf(current.x,current.y);
      if(reachable.has(k))continue;reachable.set(k,current);
      for(const dir of DIRS){
        const next=local.get(keyOf(current.x+dir.dx,current.y+dir.dy));
        if(next&&!reachable.has(keyOf(next.x,next.y))&&this.continuousWaterEdge(current,next))queue.push(next);
      }
    }

    let weighted=0,total=0;
    for(const current of reachable.values()){
      const wx=Math.max(0,1-Math.abs(gx-Number(current.x)));
      const wz=Math.max(0,1-Math.abs(gz-Number(current.y)));
      const w=wx*wz;if(w<=EPSILON)continue;
      weighted+=visualSurface(current)*w;total+=w;
    }
    return total>EPSILON?weighted/total:visualSurface(tile);
  }

  clipTerrainTriangleToWater(tile,triangle,allMap){
    if(!Array.isArray(triangle)||triangle.length!==3)return[];
    const vertices=triangle.map(point=>{
      const level=this.waterLevelAtWorld(tile,point.x,point.z,allMap);
      const waterY=level*ELEVATION_HEIGHT,terrainY=Number(point.y||0);
      return{x:Number(point.x),z:Number(point.z),terrainY,waterY,level,clearance:waterY-terrainY};
    });
    const inside=vertex=>vertex.clearance>EPSILON*ELEVATION_HEIGHT;
    const interpolate=(a,b)=>{
      const denom=a.clearance-b.clearance;
      const t=Math.abs(denom)<=1e-9?.5:clamp(a.clearance/denom,0,1);
      const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      const waterY=a.waterY+(b.waterY-a.waterY)*t;
      const terrainY=a.terrainY+(b.terrainY-a.terrainY)*t;
      return{x,z,terrainY,waterY,level:waterY/ELEVATION_HEIGHT,clearance:waterY-terrainY};
    };
    const polygon=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length],aIn=inside(a),bIn=inside(b);
      if(aIn)polygon.push(a);
      if(aIn!==bIn)polygon.push(interpolate(a,b));
    }
    return polygon.map(point=>({
      x:point.x,z:point.z,level:point.level,
      depth:Math.max(0,point.clearance/ELEVATION_HEIGHT),
      clipped:point.clearance<=EPSILON*ELEVATION_HEIGHT*2,
      mode:"TERRAIN_INTERSECTION"
    }));
  }

  waterSurfacePolygons(tile,allMap){
    const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);
    if(!geometry?.triangles?.length)return[];
    const polygons=[];
    for(const triangle of geometry.triangles){
      const polygon=this.clipTerrainTriangleToWater(tile,triangle,allMap);
      if(polygon.length>=3)polygons.push(polygon);
    }
    return polygons;
  }

  activeHydrologySources(state){
    // Source activity is a boundary condition, not a standing-water test. A spring
    // remains visually identifiable while its injected volume is immediately being
    // transported away and local storage is below the ordinary water-surface cutoff.
    return tilesOf(state).filter(tile=>
      tile?.hydrologySource===true&&tile?.hydrologySourceDisabled!==true
    ).map(tile=>({
      tile,x:Number(tile.x)*TILE_SIZE,z:Number(tile.y)*TILE_SIZE,
      rate:Math.max(0,Number(tile.hydrologySourceInflow??tile.hydrologyRequestedSourceInflow??tile.discharge??1))
    }));
  }

  sourceFootprintSignatureFor(sources){
    return`${Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0)}#`+(sources||[]).map(source=>{
      const tile=source.tile||{};
      return`${Number(tile.x)},${Number(tile.y)}:${Number(source.rate||0).toFixed(4)}:${tile.fogged?1:0}`;
    }).sort().join("|");
  }

  buildSourceFootprint(source){
    const tile=source?.tile;if(!tile)return null;
    const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);if(!geometry?.triangles?.length)return null;
    const rate=Math.max(0,Number(source.rate||0)),radius=TILE_SIZE*clamp(.19+Math.sqrt(rate)*.035,.19,.30),segments=18;
    const positions=[],indices=[],normals=[],uvs=[],colors=[],cx=Number(tile.x)*TILE_SIZE,cz=Number(tile.y)*TILE_SIZE;
    const push=(x,z,u,v,alpha)=>{const y=this.terrainSurfaceYAtPoint(tile,{x,z})+SURFACE_OFFSET*.60,point=this.canonicalWaterPoint({x,y,z});positions.push(point.x,point.y,point.z);uvs.push(u,v);normals.push(0,0,0);colors.push(1,1,1,alpha);return positions.length/3-1;};
    const center=push(cx,cz,.5,.5,.82),ring=[];
    for(let i=0;i<segments;i++){
      const angle=i/segments*Math.PI*2,noise=.94+.06*Math.sin(angle*3+hash01(`${tile.x},${tile.y}`)*Math.PI*2),r=radius*noise;
      ring.push(push(cx+Math.cos(angle)*r,cz+Math.sin(angle)*r,.5+Math.cos(angle)*.5,.5+Math.sin(angle)*.5,0));
    }
    for(let i=0;i<segments;i++)indices.push(center,ring[i],ring[(i+1)%segments]);
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`spring-wet-footprint-${tile.x}-${tile.y}`,this.scene),data=new BABYLON.VertexData();
    Object.assign(data,{positions,indices,normals,uvs,colors});data.applyToMesh(mesh,false);
    mesh.material=this.runoffMaterial;mesh.alphaIndex=11;mesh.isPickable=false;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.visibility=tile.fogged?.18:1;
    mesh.metadata={kind:"water-source-footprint",hydrologySource:true,sourceKind:tile.sourceKind||null,rate,terrainConforming:true,gameplayDepth:false,canonicalWetFootprint:true,radialWetFade:true};
    return mesh;
  }

  sourceFieldAt(point,sources){
    let weight=0,phase=0;
    for(const source of sources||[]){
      const distance=Math.hypot(Number(point.x)-source.x,Number(point.z)-source.z);
      const radius=TILE_SIZE*(.55+.18*Math.sqrt(Math.max(0,source.rate)));
      if(distance>=radius)continue;
      const q=1-distance/radius,w=smooth01(q)*Math.min(1.5,.55+source.rate*.45);
      if(w>weight){weight=w;phase=distance/Math.max(TILE_SIZE,EPSILON);}
    }
    return{weight,phase};
  }

  waterVertexVisual(point,allMap,turbidity=0){
    const terrain=this.surfaceResolver.sampleHeightAtWorld(point.x,point.z,allMap);
    const depth=Number.isFinite(Number(point.depth))?Math.max(0,Number(point.depth)):Math.max(0,Number(point.level)-(terrain==null?Number(point.level):Number(terrain)));
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

  addVertex(out,cache,point,allMap,turbidity,tile,sources=[]){
    const y=Number(point.level)*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const seam=this.canonicalWaterPoint({x:Number(point.x),y,z:Number(point.z)});
    const cacheKey=`${seam.x.toFixed(5)}:${seam.y.toFixed(5)}:${seam.z.toFixed(5)}`;
    const existing=cache.get(cacheKey);
    if(existing!=null){this.accumulateVertexMotion(out,existing,tile);return existing;}

    const visual=this.waterVertexVisual(point,allMap,turbidity);
    const index=out.positions.length/3;
    out.positions.push(seam.x,seam.y,seam.z);
    out.uvs.push(seam.x/(TILE_SIZE*3.25),seam.z/(TILE_SIZE*3.25));
    out.colors.push(visual.color[0],visual.color[1],visual.color[2],visual.alpha);
    out.waveWeights.push(smooth01(visual.depth/.34));
    const sourceField=this.sourceFieldAt(point,sources);
    out.sourceWeights.push(sourceField.weight);out.sourcePhases.push(sourceField.phase);
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
    const out={positions:[],indices:[],normals:[],uvs:[],colors:[],waveWeights:[],sourceWeights:[],sourcePhases:[],flowXSum:[],flowZSum:[],flowSpeedSum:[],flowSampleCount:[]};
    const cache=new Map(),allMap=this.allByKey(state),sources=this.activeHydrologySources(state),componentTurbidity=average(component.tiles.map(tile=>this.turbidity(tile)));
    let clippedPoints=0,terrainTriangles=0,waterPolygons=0;
    for(const tile of component.tiles){
      const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);
      terrainTriangles+=geometry?.triangles?.length||0;
      for(const polygon of this.waterSurfacePolygons(tile,allMap)){
        waterPolygons++;clippedPoints+=polygon.filter(point=>point.clipped).length;
        const vertices=polygon.map(point=>this.addVertex(out,cache,point,allMap,componentTurbidity,tile,sources));
        for(let i=1;i<vertices.length-1;i++)this.pushTriangle(out,vertices[0],vertices[i],vertices[i+1]);
      }
    }
    if(!out.positions.length||!out.indices.length)return null;
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
    const mesh=new BABYLON.Mesh(`water-surface-${component.id}`,this.scene),data=new BABYLON.VertexData();data.positions=out.positions;data.indices=out.indices;data.normals=out.normals;data.uvs=out.uvs;data.colors=out.colors;data.applyToMesh(mesh,true);
    mesh.material=this.surfaceMaterial;mesh.alphaIndex=10;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.visibility=component.group==="fogged"?.22:1;
    mesh.metadata={kind:"water-surface",tileCount:component.tiles.length,sharedWetEdges:true,hydrologySurface:true,quantizedLevels:false,clippedShorePoints:clippedPoints,exactTerrainIntersection:true,renderedTerrainTriangles:true,terrainTriangles,waterPolygons,syntheticShoreline:false,visualSurfaceResolver:true,stylizedWater:true,depthGradient:true,vertexAlpha:true,alphaIndex:10,componentTurbidity,vertexCount:out.positions.length/3,triangleCount:out.indices.length/3};
    const flow=this.componentFlow(component),vertexFlowX=[],vertexFlowZ=[],vertexFlowSpeeds=[],waterAnim=[],waterBaseXZ=[],waterSource=[];
    for(let i=0;i<out.positions.length/3;i++){const count=Math.max(1,Number(out.flowSampleCount[i]||0));let vx=Number(out.flowXSum[i]||0)/count,vz=Number(out.flowZSum[i]||0)/count;const speed=Number(out.flowSpeedSum[i]||0)/count,length=Math.hypot(vx,vz);if(length>EPSILON){vx/=length;vz/=length;}else{vx=0;vz=0;}vertexFlowX.push(vx);vertexFlowZ.push(vz);vertexFlowSpeeds.push(speed);waterAnim.push(vx,vz,speed,Number(out.waveWeights[i]||0));waterBaseXZ.push(Number(out.positions[i*3]||0),Number(out.positions[i*3+2]||0));waterSource.push(Number(out.sourceWeights[i]||0),Number(out.sourcePhases[i]||0));}
    if(this.gpuSurfaceWaves){mesh.setVerticesData("waterAnim",waterAnim,false,4);mesh.setVerticesData("waterBaseXZ",waterBaseXZ,false,2);mesh.setVerticesData("waterSource",waterSource,false,2);}
    this.surfaceAnimations.set(component.id,{id:component.id,tileKeys:new Set(component.tiles.map(tile=>keyOf(tile.x,tile.y))),mesh,basePositions:Float32Array.from(out.positions),baseNormals:Float32Array.from(out.normals),positions:Float32Array.from(out.positions),normals:Float32Array.from(out.normals),waveWeights:Float32Array.from(out.waveWeights),sourceWeights:Float32Array.from(out.sourceWeights),sourcePhases:Float32Array.from(out.sourcePhases),flowX:Float32Array.from(vertexFlowX),flowZ:Float32Array.from(vertexFlowZ),flowSpeeds:Float32Array.from(vertexFlowSpeeds),specialActive:false});
    mesh.metadata.waterSurfaceWave=true;mesh.metadata.waterSourceUpwelling=sources.length>0;mesh.metadata.waterSpecialActive=false;mesh.metadata.waveDirection=flow.flowing?{x:flow.x,z:flow.z}:null;mesh.metadata.averageFlowSpeed=flow.flowing?flow.speed:0;mesh.metadata.localFlowSpeedWaves=true;mesh.freezeWorldMatrix();return mesh;
  }

  cascadeDirection(edge){
    const dx=Math.sign(Number(edge?.dx||0)),dy=Math.sign(Number(edge?.dy||0));
    if(dx===1&&dy===0)return{id:"E",dx:1,dy:0};
    if(dx===-1&&dy===0)return{id:"W",dx:-1,dy:0};
    if(dx===0&&dy===1)return{id:"S",dx:0,dy:1};
    if(dx===0&&dy===-1)return{id:"N",dx:0,dy:-1};
    return null;
  }

  oppositeDirection(dir){return dir?this.cascadeDirection({dx:-dir.dx,dy:-dir.dy}):null;}

  pointOnPolygonBoundary(point,polygon,tolerance=TILE_SIZE*.00025){
    if(!point||!polygon?.length)return false;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],vx=Number(b.x)-Number(a.x),vz=Number(b.z)-Number(a.z),wx=Number(point.x)-Number(a.x),wz=Number(point.z)-Number(a.z);
      const vv=vx*vx+vz*vz,t=vv>EPSILON?clamp((wx*vx+wz*vz)/vv,0,1):0,px=Number(a.x)+vx*t,pz=Number(a.z)+vz*t;
      if(Math.hypot(Number(point.x)-px,Number(point.z)-pz)<=tolerance)return true;
    }
    return false;
  }

  pointInPolygon(point,polygon){
    if(!point||!polygon?.length)return false;
    if(this.pointOnPolygonBoundary(point,polygon))return true;
    let inside=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const xi=Number(polygon[i].x),zi=Number(polygon[i].z),xj=Number(polygon[j].x),zj=Number(polygon[j].z),z=Number(point.z),x=Number(point.x);
      const crosses=((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/((zj-zi)||1e-9)+xi);
      if(crosses)inside=!inside;
    }
    return inside;
  }

  pointInTriangleXZ(point,a,b,c,tolerance=1e-7){
    const px=Number(point.x),pz=Number(point.z),ax=Number(a.x),az=Number(a.z),bx=Number(b.x),bz=Number(b.z),cx=Number(c.x),cz=Number(c.z);
    const v0x=cx-ax,v0z=cz-az,v1x=bx-ax,v1z=bz-az,v2x=px-ax,v2z=pz-az;
    const d00=v0x*v0x+v0z*v0z,d01=v0x*v1x+v0z*v1z,d11=v1x*v1x+v1z*v1z,d20=v2x*v0x+v2z*v0z,d21=v2x*v1x+v2z*v1z,den=d00*d11-d01*d01;
    if(Math.abs(den)<=1e-12)return null;
    const v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den,u=1-v-w;
    if(u<-tolerance||v<-tolerance||w<-tolerance)return null;
    return{u,v,w};
  }

  terrainSurfaceYAtPoint(tile,point){
    const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);
    for(const triangle of geometry?.triangles||[]){
      const bary=this.pointInTriangleXZ(point,triangle[0],triangle[1],triangle[2]);
      if(!bary)continue;
      return Number(triangle[0].y)*bary.u+Number(triangle[1].y)*bary.w+Number(triangle[2].y)*bary.v;
    }
    return Number(tile?.elevation||0)*ELEVATION_HEIGHT;
  }

  flowCorridorHalfWidth(edge){
    // Q describes transport while waterDepth describes storage. A moving film needs
    // a finite wetted corridor even when storage on the slope is nearly zero. Keep
    // one generic Q->width mapping for slope runoff and the waterfall lip hand-off.
    const q=Math.max(0,Number((edge?.edgeDischarge??edge?.rate)??0));
    const transported=Math.max(0,Number(edge?.transportVolume||0));
    const strength=Math.max(q,transported*.5);
    return TILE_SIZE*clamp(.10+Math.sqrt(strength)*.075,.10,.26);
  }

  transportCrossSection(edge,local=0){
    // One deterministic cross-section function is shared by the horizontal runoff
    // approach and the waterfall lip. This closes the old geometry gap where Q could
    // jump from an invisible ground reach into a separately-centred waterfall sheet.
    const q=clamp(local,0,1),baseHalfWidth=this.flowCorridorHalfWidth(edge),phase=hash01(edge?.id||"")*Math.PI*2,envelope=Math.sin(Math.PI*q);
    return{
      baseHalfWidth,phase,
      meander:(Math.sin(q*Math.PI*2+phase)*.16+Math.sin(q*Math.PI*4+phase*.37)*.05)*baseHalfWidth*envelope,
      width:baseHalfWidth*(.82+.14*Math.sin(q*Math.PI+phase*.35)+.08*Math.sin(q*Math.PI*3+phase))
    };
  }

  runoffEdges(state){
    const all=tilesOf(state),by=this.byKey(all),seen=new Set(),out=[];
    for(const tile of all){
      for(const dir of [{dx:1,dy:0},{dx:0,dy:1}]){
        const neighbor=by.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));if(!neighbor)continue;
        const flow=this.hydrologyEdgeState(tile,neighbor);
        // Transport and storage are separate. Every transported edge must have one
        // horizontal owner up to its hand-off boundary. A cascade owns the vertical
        // cliff face only; when its upstream tile has no standing-water mesh, runoff
        // must still draw the source/ground approach from the tile centre to the lip.
        if(!flow?.flowing||!flow.from||!flow.to)continue;
        // Visual ownership must follow the surface renderer, not raw storage.
        // A tile with 0 < waterDepth <= MIN_WATER_DEPTH can contain real storage
        // without owning a standing-water mesh. Treating any positive depth as
        // "pooled" made both systems step aside: Surface skipped it for being too
        // shallow while Runoff skipped it for having storage. That is why a spring
        // could show Qin/Qout and even produce a downstream waterfall while the
        // ground reach between them looked completely dry.
        const fromPooled=this.isRenderableWater(flow.from),toPooled=this.isRenderableWater(flow.to);
        const fromStored=hasAnyWater(flow.from),toStored=hasAnyWater(flow.to);
        const cascadeApproach=flow.cascade===true&&!fromPooled;
        if(flow.cascade===true&&!cascadeApproach)continue;
        if(!flow.cascade&&fromPooled&&toPooled)continue;
        const sourceEdge=flow.from?.hydrologySource===true||flow.to?.hydrologySource===true;
        const downhillTransport=Number(flow.surfaceDrop||0)>EPSILON*4;
        const persistentTransport=Number(flow.persistentRate??flow.edgeDischarge??0)>EPSILON;
        // A sustained per-edge Q is surface transport even when the local terrain is
        // flat and storage has fallen to ~0. v8 suppressed those flat downstream
        // edges to eliminate the old black rail, which also hid real spring-fed
        // through-flow after the first source edge. The rail was a geometry/material
        // problem, not evidence that flat Q should be invisible. Pooled water still
        // owns its own surface, while dry transport-only reaches use the feathered
        // terrain-conforming runoff footprint below.
        if(!flow.sheetFlow&&!sourceEdge&&!downhillTransport&&!persistentTransport)continue;
        const id=`${flow.from.x},${flow.from.y}->${flow.to.x},${flow.to.y}`;if(seen.has(id))continue;seen.add(id);
        out.push({
          id,from:flow.from,to:flow.to,fromPooled,toPooled,fromStored,toStored,cascadeApproach,
          rate:Number(flow.rate||0),edgeDischarge:Number(flow.edgeDischarge??flow.rate??0),persistentRate:Number(flow.persistentRate??flow.edgeDischarge??0),
          transportVolume:Number(flow.transportVolume??flow.volume??0),surfaceDrop:Number(flow.surfaceDrop||0),
          hydraulicPower:Number(flow.hydraulicPower||0),reason:flow.reason||null
        });
      }
    }
    return out;
  }

  buildRunoff(edge){
    const from=edge.from,to=edge.to,dx=Number(to.x)-Number(from.x),dz=Number(to.y)-Number(from.y),len=Math.hypot(dx,dz)||1,px=-dz/len,pz=dx/len;
    // Storage owns pooled terrain. A normal runoff edge may cross the full centre-to-
    // centre segment; a cascade approach stops exactly at the shared cliff lip (t=.5)
    // where the vertical cascade takes ownership.
    const tStart=edge.fromPooled?.5:0,tEnd=edge.cascadeApproach?.5:(edge.toPooled?.5:1);if(tEnd-tStart<=EPSILON)return null;
    const steps=Math.max(6,Math.ceil((tEnd-tStart)*14));
    const positions=[],indices=[],normals=[],uvs=[],colors=[];
    // Five samples across the film give us transparent feathering at both banks.
    // The old two-vertex cross section made every edge a hard rectangular rail.
    const lateral=[-1,-.56,0,.56,1],alpha=[0,.40,.68,.40,0],row=lateral.length;
    for(let i=0;i<=steps;i++){
      const local=i/steps,t=tStart+(tEnd-tStart)*local,profile=this.transportCrossSection(edge,local),meander=profile.meander,width=profile.width;
      const cx=(Number(from.x)+(Number(to.x)-Number(from.x))*t)*TILE_SIZE+px*meander,cz=(Number(from.y)+(Number(to.y)-Number(from.y))*t)*TILE_SIZE+pz*meander;
      const tile=t<.5?from:to;
      for(let j=0;j<row;j++){
        const side=lateral[j],x=cx+px*width*side,z=cz+pz*width*side,y=this.terrainSurfaceYAtPoint(tile,{x,z})+SURFACE_OFFSET*.42;
        const point=this.canonicalWaterPoint({x,y,z});positions.push(point.x,point.y,point.z);uvs.push((side+1)*.5,local*2.0);normals.push(0,0,0);
        colors.push(1,1,1,alpha[j]);
      }
    }
    for(let i=0;i<steps;i++)for(let j=0;j<row-1;j++){const a=i*row+j,b=a+1,c=a+row,d=c+1;indices.push(a,b,d,a,d,c);}
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`runoff-${edge.id}`,this.scene),data=new BABYLON.VertexData();
    Object.assign(data,{positions,indices,normals,uvs,colors});data.applyToMesh(mesh,false);
    mesh.material=this.runoffMaterial;mesh.alphaIndex=11;mesh.isPickable=false;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.visibility=(from.fogged&&to.fogged)?.16:1;
    mesh.metadata={kind:"water-surface-runoff",hydrologyEdgeReason:edge.reason,edgeDischarge:edge.edgeDischarge,persistentRate:edge.persistentRate,transportVolume:edge.transportVolume,surfaceDrop:edge.surfaceDrop,terrainConforming:true,gameplayDepth:false,pooledSurfaceExcluded:true,poolBoundaryHandoff:true,cascadeApproach:edge.cascadeApproach===true,softWetFootprint:true,hardRailGeometry:false,transportOnly:!edge.fromPooled&&!edge.toPooled,shallowStoredTransport:(!edge.fromPooled&&edge.fromStored)||(!edge.toPooled&&edge.toStored)};
    return mesh;
  }

  runoffSignatureFor(edges){
    // Geometry clips at the midpoint whenever a standing-water surface owns one
    // endpoint. Include that ownership in the cache signature so crossing the
    // visible-water threshold cannot leave a stale full-length/half-length strip.
    return`${Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0)}#`+edges.map(edge=>`${edge.id}:${edge.rate.toFixed(4)}:${edge.surfaceDrop.toFixed(4)}:${edge.transportVolume.toFixed(4)}:${edge.fromPooled?1:0}:${edge.toPooled?1:0}:${edge.cascadeApproach?1:0}`).sort().join("|");
  }

  polygonSurfaceLevelAtPoint(point,polygon){
    if(!point||!polygon?.length)return null;
    for(let i=1;i<polygon.length-1;i++){
      const a=polygon[0],b=polygon[i],c=polygon[i+1],bary=this.pointInTriangleXZ(point,a,b,c);
      if(!bary)continue;
      return Number(a.level)*bary.u+Number(b.level)*bary.w+Number(c.level)*bary.v;
    }
    return null;
  }

  waterSurfaceLevelAtPoint(point,polygons,fallback=null){
    for(const polygon of polygons||[]){
      if(!this.pointInPolygon(point,polygon))continue;
      const level=this.polygonSurfaceLevelAtPoint(point,polygon);
      if(level!=null&&Number.isFinite(level))return level;
    }
    return fallback==null?null:Number(fallback);
  }

  segmentPolygonIntervals(a,b,polygon){
    if(!a||!b||!polygon?.length)return[];
    const ax=Number(a.x),az=Number(a.z),bx=Number(b.x),bz=Number(b.z),rx=bx-ax,rz=bz-az,rr=rx*rx+rz*rz;
    if(rr<=1e-12)return[];
    const ts=[0,1],cross=(x1,z1,x2,z2)=>x1*z2-z1*x2,addT=value=>{const t=clamp(Number(value),0,1);if(!ts.some(existing=>Math.abs(existing-t)<=1e-7))ts.push(t);};
    for(let i=0;i<polygon.length;i++){
      const c=polygon[i],d=polygon[(i+1)%polygon.length],cx=Number(c.x),cz=Number(c.z),sx=Number(d.x)-cx,sz=Number(d.z)-cz,qx=cx-ax,qz=cz-az,den=cross(rx,rz,sx,sz);
      if(Math.abs(den)>1e-10){
        const t=cross(qx,qz,sx,sz)/den,u=cross(qx,qz,rx,rz)/den;
        if(t>=-1e-7&&t<=1+1e-7&&u>=-1e-7&&u<=1+1e-7)addT(t);
      }else if(Math.abs(cross(qx,qz,rx,rz))<=1e-8){
        addT(((cx-ax)*rx+(cz-az)*rz)/rr);
        addT(((Number(d.x)-ax)*rx+(Number(d.z)-az)*rz)/rr);
      }
    }
    ts.sort((x,y)=>x-y);
    const intervals=[];
    for(let i=0;i<ts.length-1;i++){
      const t0=ts[i],t1=ts[i+1];if(t1-t0<=1e-7)continue;
      const tm=(t0+t1)/2,point={x:ax+rx*tm,z:az+rz*tm};
      if(this.pointInPolygon(point,polygon))intervals.push({start:t0,end:t1});
    }
    return intervals;
  }

  mergeDistanceSpans(spans,tolerance=TILE_SIZE*.00025){
    const sorted=(spans||[]).filter(span=>Number(span.end)-Number(span.start)>EPSILON).sort((a,b)=>a.start-b.start),merged=[];
    for(const span of sorted){
      const next={start:Number(span.start),end:Number(span.end)},last=merged[merged.length-1];
      if(last&&next.start<=last.end+tolerance)last.end=Math.max(last.end,next.end);
      else merged.push(next);
    }
    return merged;
  }

  wallPathMetrics(wall){
    const lip=wall?.lip||[],foot=wall?.foot||[],count=Math.min(lip.length,foot.length);
    if(count<2)return null;
    const cumulative=[0];let total=0;
    for(let i=0;i<count-1;i++){
      total+=Math.hypot(Number(lip[i+1].x)-Number(lip[i].x),Number(lip[i+1].z)-Number(lip[i].z));
      cumulative.push(total);
    }
    return total>EPSILON?{lip,foot,count,cumulative,total}:null;
  }

  wallSampleAtDistance(metrics,distance){
    if(!metrics)return null;
    const d=clamp(Number(distance||0),0,metrics.total),{lip,foot,cumulative,count}=metrics;
    let segment=0;while(segment<count-2&&cumulative[segment+1]<d-EPSILON)segment++;
    const span=Math.max(EPSILON,cumulative[segment+1]-cumulative[segment]),t=clamp((d-cumulative[segment])/span,0,1);
    const mix=(a,b)=>{
      const na=a?.normal||{x:0,z:0},nb=b?.normal||na;
      let nx=Number(na.x)+(Number(nb.x)-Number(na.x))*t,nz=Number(na.z)+(Number(nb.z)-Number(na.z))*t,n=Math.hypot(nx,nz)||1;nx/=n;nz/=n;
      return{x:Number(a.x)+(Number(b.x)-Number(a.x))*t,y:Number(a.y)+(Number(b.y)-Number(a.y))*t,z:Number(a.z)+(Number(b.z)-Number(a.z))*t,normal:{x:nx,z:nz}};
    };
    return{distance:d,lip:mix(lip[segment],lip[segment+1]),foot:mix(foot[segment],foot[segment+1])};
  }

  wallColumnDistances(span,metrics){
    const values=[Number(span.start)];
    for(const distance of metrics?.cumulative||[])if(distance>Number(span.start)+EPSILON&&distance<Number(span.end)-EPSILON)values.push(distance);
    values.push(Number(span.end));
    values.sort((a,b)=>a-b);
    return values.filter((value,index)=>index===0||Math.abs(value-values[index-1])>EPSILON);
  }

  cascadeSpillIntervals(edge,state,wall,polygons=null){
    const allMap=this.allByKey(state),waterPolygons=polygons||this.waterSurfacePolygons(edge.tile,allMap),metrics=this.wallPathMetrics(wall);
    if(!metrics)return[];
    const spans=[];
    for(let i=0;i<metrics.count-1;i++){
      const a=metrics.lip[i],b=metrics.lip[i+1],segmentStart=metrics.cumulative[i],length=metrics.cumulative[i+1]-segmentStart;
      if(length<=EPSILON)continue;
      for(const polygon of waterPolygons){
        for(const interval of this.segmentPolygonIntervals(a,b,polygon))spans.push({start:segmentStart+interval.start*length,end:segmentStart+interval.end*length});
      }
    }

    const merged=this.mergeDistanceSpans(spans);
    if(merged.length)return merged;

    // Never widen a real lake/river surface merely because Q is present: that was
    // the v6 path that could create a waterfall on a dry protrusion inside a lake.
    // A transport-only reach (below the standing-water render threshold) may still
    // arrive at a cliff. In that case the same Q corridor used by surface runoff is
    // the canonical wet footprint at the lip, so the waterfall inherits that exact
    // transport width instead of inventing one on a pooled surface.
    if(this.isRenderableWater(edge?.tile))return[];
    const q=Math.max(0,Number((edge?.edgeDischarge??edge?.rate)??0)),transport=Math.max(0,Number(edge?.transportVolume||0));
    if(q<=EPSILON&&transport<=EPSILON)return[];
    // Use the exact same transport cross-section that reaches the cliff lip from
    // buildRunoff(cascadeApproach). The waterfall may change direction vertically,
    // but it may not invent a wider or independently-centred wet span on the wall.
    const lipProfile=this.transportCrossSection(edge,1),width=Math.min(metrics.total,lipProfile.width*2),start=Math.max(0,(metrics.total-width)*.5);
    return width>EPSILON?[{start,end:start+width,transportFootprint:true,sharedRunoffLip:true}]:[];
  }

  resetWaterSeamRegistry(){this.waterSeamRegistry.clear();}

  canonicalWaterPoint(point){
    const x=Number(point.x),y=Number(point.y),z=Number(point.z),key=`${x.toFixed(5)}:${z.toFixed(5)}`,layers=this.waterSeamRegistry.get(key)||[];
    const tolerance=Math.max(1e-6,SURFACE_OFFSET*.05);
    for(const existing of layers)if(Math.abs(Number(existing.y)-y)<=tolerance)return existing;
    const stored={x,y,z};layers.push(stored);this.waterSeamRegistry.set(key,layers);return stored;
  }


  cascadeEdges(state,waterTiles){
    const allMap=this.allByKey(state),out=[],seen=new Set();
    // Scan every undirected gameplay edge exactly once. Starting only from wet
    // tiles and only looking east/south misses west/north spill faces when the low
    // receiver is still dry. Hydrology's per-edge flux decides the direction.
    for(const tile of tilesOf(state)){
      for(const dir of [{dx:1,dy:0},{dx:0,dy:1}]){
        const neighbor=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));if(!neighbor)continue;
        const flow=this.hydrologyEdgeState(tile,neighbor);
        const transported=Math.max(0,Number(flow?.transportVolume??flow?.volume??0));
        if(!flow?.cascade||!flow.from||!flow.to||(!hasAnyWater(flow.from)&&transported<=EPSILON))continue;
        const high=flow.from,low=flow.to,id=`${high.x},${high.y}->${low.x},${low.y}`;
        if(seen.has(id))continue;seen.add(id);
        const top=Number.isFinite(Number(flow.fromSurface))?Number(flow.fromSurface):visualSurface(high);
        const bottom=Number.isFinite(Number(flow.toSurface))?Number(flow.toSurface):(hasAnyWater(low)?visualSurface(low):Number(low.elevation||0));
        const drop=Math.max(0,Number(flow.surfaceDrop??(top-bottom)));
        if(drop<WATERFALL_MIN_DROP)continue;
        out.push({
          id,tile:high,receiver:low,dx:Math.sign(low.x-high.x),dy:Math.sign(low.y-high.y),
          top,bottom,drop,authoredDrop:flow.authored?Number(high.hydrologyCascadeDrop||drop):null,
          speed:Math.max(.6,Number(high.flowSpeed||0),Number(flow.rate||0),drop*.55),
          flowVolume:Number(flow.volume||0),transportVolume:Number(flow.transportVolume??flow.volume??0),edgeDischarge:Number(flow.edgeDischarge??flow.rate??0),hydraulicPower:Number(flow.hydraulicPower??Math.max(0,Number(flow.rate||0))*drop),
          hydrologyEdgeReason:flow.reason||null,authored:flow.authored===true,receiverWet:hasAnyWater(low)
        });
      }
    }
    return out;
  }

  buildCascade(edge,state){
    const dir=this.cascadeDirection(edge);if(!dir)return null;
    const wall=this.surfaceResolver.getRenderedCliffGeometry(edge.tile,dir);
    const metrics=this.wallPathMetrics(wall);if(!metrics)return null;
    const allMap=this.allByKey(state),upstreamPolygons=this.waterSurfacePolygons(edge.tile,allMap),spans=this.cascadeSpillIntervals(edge,state,wall,upstreamPolygons);if(!spans.length)return null;
    const downstreamPolygons=edge.receiverWet?this.waterSurfacePolygons(edge.receiver,allMap):[];
    const positions=[],indices=[],normals=[],uvs=[],impactGroups=[];
    let vertexBase=0;
    const rowFractions=[0,.25,.50,.75,1];

    for(let spanIndex=0;spanIndex<spans.length;spanIndex++){
      const span=spans[spanIndex],distances=this.wallColumnDistances(span,metrics),columnsData=distances.map(distance=>this.wallSampleAtDistance(metrics,distance));
      if(columnsData.length<2)continue;
      const columns=columnsData.length,stripBase=vertexBase,impactPoints=[];
      for(let r=0;r<rowFractions.length;r++){
        const v=rowFractions[r];
        for(let c=0;c<columns;c++){
          const u=columns===1?0:c/(columns-1),sample=columnsData[c],lip=sample.lip,foot=sample.foot;
          const fallbackTop=this.waterLevelAtWorld(edge.tile,lip.x,lip.z,allMap),topLevel=this.waterSurfaceLevelAtPoint(lip,upstreamPolygons,fallbackTop),topY=Number(topLevel)*ELEVATION_HEIGHT+SURFACE_OFFSET;
          const downstreamLevel=this.waterSurfaceLevelAtPoint(foot,downstreamPolygons,null),bottomY=downstreamLevel==null?Number(foot.y)+SURFACE_OFFSET:Number(downstreamLevel)*ELEVATION_HEIGHT+SURFACE_OFFSET;
          const y=topY+(Math.min(topY,bottomY)-topY)*v,baseX=Number(lip.x)+(Number(foot.x)-Number(lip.x))*v,baseZ=Number(lip.z)+(Number(foot.z)-Number(lip.z))*v;
          let nx=Number(lip.normal?.x||0)+(Number(foot.normal?.x||0)-Number(lip.normal?.x||0))*v,nz=Number(lip.normal?.z||0)+(Number(foot.normal?.z||0)-Number(lip.normal?.z||0))*v,nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
          // Only the horizontal top/bottom seams must stay welded. Vertical side
          // columns are still part of the visible sheet and need the same outward
          // clearance as its interior; pinning them to the rock produced the dark
          // wall interference/z-fighting visible beside narrow waterfalls.
          const boundary=r===0||r===rowFractions.length-1,seamEnvelope=boundary?0:Math.sin(Math.PI*v),offset=SURFACE_OFFSET*.48*seamEnvelope;
          const point=this.canonicalWaterPoint({x:baseX+nx*offset,y,z:baseZ+nz*offset});
          positions.push(point.x,point.y,point.z);uvs.push(u,v*2.25);normals.push(0,0,0);
          if(r===rowFractions.length-1)impactPoints.push(point);
        }
      }
      for(let r=0;r<rowFractions.length-1;r++)for(let c=0;c<columns-1;c++){
        const a=stripBase+r*columns+c,b=a+1,d=stripBase+(r+1)*columns+c,e=d+1;indices.push(a,b,e,a,e,d);
      }
      vertexBase+=rowFractions.length*columns;
      if(impactPoints.length)impactGroups.push({spanIndex,points:impactPoints});
    }
    if(!indices.length)return null;
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);

    const mesh=new BABYLON.Mesh(`cascade-${edge.id}`,this.scene),data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;data.applyToMesh(mesh,false);
    mesh.material=this.cascadeMaterial;mesh.alphaIndex=12;mesh.isPickable=false;mesh.visibility=edge.tile.fogged?.16:1;
    mesh.metadata={kind:"water-cascade",drop:edge.drop,flowSpeed:edge.speed,flowVolume:edge.flowVolume,transportVolume:edge.transportVolume,edgeDischarge:edge.edgeDischarge,hydraulicPower:edge.hydraulicPower,renderedCliffGeometry:true,exactCliffFace:true,exactWaterPolygonCliffIntersection:true,spillIntervals:spans.map(span=>({start:span.start,end:span.end})),wetSpans:spans.length,weldedBoundarySeams:true,sharedWaterGeometryRegistry:true,interiorNormalOffsetOnly:true,receiverWet:edge.receiverWet,hydrologyEdgeReason:edge.hydrologyEdgeReason};

    const root=new BABYLON.TransformNode(`cascade-root-${edge.id}`,this.scene);mesh.parent=root;
    const impact=Math.max(0,Number(edge.hydraulicPower||0)),impactScale=clamp(Math.sqrt(impact+.01),.32,1.45),impacts=[];
    for(const group of impactGroups){
      const count=Math.max(1,group.points.length),center=group.points.reduce((acc,point)=>({x:acc.x+point.x/count,y:acc.y+point.y/count,z:acc.z+point.z/count}),{x:0,y:0,z:0});
      const foam=BABYLON.MeshBuilder.CreateTorus(`cascade-foam-${edge.id}-${group.spanIndex}`,{diameter:TILE_SIZE*(.30+.22*impactScale),thickness:.026+.018*Math.min(1,impactScale),tessellation:20},this.scene);
      foam.material=this.foamMaterial;foam.alphaIndex=13;foam.isPickable=false;foam.position.set(center.x,center.y+.020,center.z);foam.visibility=mesh.visibility;foam.parent=root;
      const ripples=[];
      for(let i=0;i<2;i++){
        const ripple=BABYLON.MeshBuilder.CreateTorus(`cascade-ripple-${i}-${edge.id}-${group.spanIndex}`,{diameter:TILE_SIZE*(.28+.12*i+.16*impactScale),thickness:.020,tessellation:18},this.scene);
        ripple.material=this.foamMaterial;ripple.alphaIndex=13;ripple.isPickable=false;ripple.position.set(center.x+dir.dx*TILE_SIZE*.035,center.y+.012+i*.002,center.z+dir.dy*TILE_SIZE*.035);ripple.visibility=0;ripple.parent=root;ripples.push(ripple);
      }
      impacts.push({foam,ripples,center});
    }
    return{root,mesh,impacts,impactScale,baseVisibility:mesh.visibility,phase:(edge.tile.x*13+edge.tile.y*7)%17};
  }


  surfaceSignatureFor(components,state){
    const terrain=tilesOf(state).map(tile=>[
      keyOf(tile.x,tile.y),
      Number(tile.elevation||0).toFixed(4),
      waterDepth(tile).toFixed(4),
      hasAnyWater(tile)?visualSurface(tile).toFixed(4):"dry",
      Number(tile.flowX||0),Number(tile.flowY||0),Number(tile.flowSpeed||0).toFixed(3),
      tile.hydrologyCascadeToX??"n",tile.hydrologyCascadeToY??"n",Number(tile.hydrologyCascadeDrop||0).toFixed(3),
      ...["N","E","S","W"].map(dir=>{const f=tile.hydrologyEdgeOutflows?.[dir];return f?`${dir}>${f.toX},${f.toY}:${Number(f.rate||0).toFixed(3)}:${Number(f.cliffDrop||0).toFixed(3)}`:`${dir}-`; }),
      tile.fogged?1:0
    ].join(":" )).sort().join(",");
    const groups=components.map(component=>
      `${component.id}:${component.tiles.map(tile=>keyOf(tile.x,tile.y)).sort().join(",")}`
    ).sort().join("|");
    return`${Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0)}:${groups}#${terrain}`;
  }

  cascadeSignatureFor(edges){
    return`${Number(this.surfaceResolver.renderedCliffGeometryRevision||0)}#${this.surfaceSignature}#`+edges.map(e=>`${e.id}:${e.top.toFixed(4)}:${e.bottom.toFixed(4)}:${e.speed.toFixed(2)}:${Number(e.hydraulicPower||0).toFixed(3)}:${Number(e.transportVolume||0).toFixed(4)}:${Number(e.edgeDischarge||0).toFixed(4)}`).sort().join("|");
  }


  sync(state,presentationEvents=[]){
    this.setWind(state?.presentation?.environment?.wind||state?.environment?.wind||state?.wind||null);
    const waterTiles=this.waterTiles(state);
    const components=this.surfaceComponents(waterTiles);
    const cascades=this.cascadeEdges(state,waterTiles);
    const runoffs=this.runoffEdges(state);
    const sources=this.activeHydrologySources(state);

    const surfaceSignature=this.surfaceSignatureFor(components,state);
    if(surfaceSignature!==this.surfaceSignature){
      this.disposeSurfaceMeshes();
      this.resetWaterSeamRegistry();
      for(const component of components){
        const mesh=this.buildSurface(component,state);
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

    const cascadeSignature=this.cascadeSignatureFor(cascades);
    if(cascadeSignature!==this.cascadeSignature){
      this.disposeMap(this.cascades);
      for(const edge of cascades){const built=this.buildCascade(edge,state);if(built)this.cascades.set(edge.id,built);}
      this.cascadeSignature=cascadeSignature;
    }

    const runoffSignature=this.runoffSignatureFor(runoffs);
    if(runoffSignature!==this.runoffSignature){
      this.disposeMap(this.runoffs);
      for(const edge of runoffs){const built=this.buildRunoff(edge);if(built)this.runoffs.set(edge.id,built);}
      this.runoffSignature=runoffSignature;
    }

    const sourceSignature=this.sourceFootprintSignatureFor(sources);
    if(sourceSignature!==this.sourceSignature){
      this.disposeMap(this.sourceFootprints);
      for(const source of sources){const built=this.buildSourceFootprint(source);if(built)this.sourceFootprints.set(`${source.tile.x},${source.tile.y}`,built);}
      this.sourceSignature=sourceSignature;
    }

    if(!waterTiles.length&&!runoffs.length&&!sources.length){
      this.disposeSurfaceMeshes();this.disposeMap(this.cascades);this.disposeMap(this.runoffs);this.disposeMap(this.sourceFootprints);this.resetWaterSeamRegistry();
      this.surfaceSignature=this.cascadeSignature=this.runoffSignature=this.sourceSignature="";
    }
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      sideMeshes:0,
      cascades:this.cascades.size,
      surfaceRunoffs:this.runoffs.size,
      activeSourceFootprints:this.sourceFootprints.size,
      separatedWaterLevels:false,
      hydrologyContinuousSurface:true,
      sharedWetEdges:true,
      quantizedLevels:false,
      thinCascadeRibbon:false,
      sharedEdgeCascade:true,
      cascadeImpactRipples:true,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:MIN_WATER_DEPTH,
      shorelineSkirts:false,
      terrainClippedShoreline:true,
      exactRenderedTerrainIntersection:true,
      syntheticShorelineProjection:false,
      renderedSurfaceGeometryRegistry:true,
      sharedVisualSurfaceResolver:true,
      stylizedWater:true,
      animatedWaterSurface:true,
      waterWaveAnimation:this.gpuSurfaceWaves?"gpu-vertex-displacement":"cpu-vertex-displacement-30hz",
      gpuSurfaceWaves:this.gpuSurfaceWaves,
      cpuSurfaceUploadsOnlyForSpecialEvents:this.gpuSurfaceWaves,
      localFlowSpeedWaves:true,
      windDrivenWaves:true,
      windWaveStrength:Number(this.wind?.strength||0),
      refinedWaterTopology:true,
      canonicalWetFootprint:true,
      transportWaterVisibleWithoutGameplayDepth:true,
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
      cascadeAuthority:"HydrologyEngine.edgeFlowState",
      cascadesRequireHydrologyDirection:false,
      cascadesRequireHydrologyMetadata:false,
      cascadesRequireDownstreamWater:false,
      multiEdgeCascades:true,
      exactRenderedCliffFace:true,
      weldedCascadeSeams:true,
      interiorNormalOffsetOnly:true,
      hydraulicWetSpans:true,
      exactPolygonLipIntersection:true,
      dischargeBackedLipWidth:true,
      runoffOverPooledWater:false,
      runoffPoolBoundaryHandoff:true,
      dedicatedRunoffMaterial:true,
      fixedCascadeWidth:false,
      persistentPerEdgeDischarge:true,
      hydraulicImpactPower:true,
      sourceUpwellingField:true,
      dryReceiverCascade:true
    };
  }
}
