import { TILE_SIZE,ELEVATION_HEIGHT,SURFACE_RENDER_ORDER } from "./coordinate-system.js";
import { VisualSurfaceResolver, hasStoredWaterDepth, CONNECTED_STORED_WATER_MAX_DROP } from "./visual-surface-resolver.js";

const tilesOf=state=>state?.map?.tiles||state?.grid?.tiles||[];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value||0)));
const keyOf=(x,y)=>`${x},${y}`;
const waterDepth=tile=>Math.max(0,Number(tile?.waterDepth||0));
const logicalSurface=tile=>tile?.waterSurfaceZ==null
  ?Number(tile?.elevation||0)+waterDepth(tile)
  :Number(tile.waterSurfaceZ);

const SURFACE_OFFSET=.016;
const EPSILON=.001;
const WATERFALL_MIN_DROP=CONNECTED_STORED_WATER_MAX_DROP;
const WATER_DEPTH_RANGE=1.5;
const WATER_SHALLOW_COLOR=Object.freeze([.43,.78,.72]);
const WATER_DEEP_COLOR=Object.freeze([.045,.23,.38]);
const WATER_MURKY_COLOR=Object.freeze([.29,.31,.18]);
const WATER_SHALLOW_ALPHA=.46;
const WATER_DEEP_ALPHA=.82;
// Runoff UVs use world-distance phase so adjacent hydrology edges read as one
// moving stream instead of restarting their texture at every tile boundary.
const RUNOFF_UV_REPEAT_DISTANCE=TILE_SIZE*.78;
// Water/terrain intersection is the shared shoreline; no overlap distance.

const DIRS=Object.freeze([
  {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}
]);

function visualSurface(tile){
  // Rendering consumes the real hydrology surface. No quantized LEVEL_STEP layer.
  return logicalSurface(tile);
}
function hasAnyWater(tile){
  // Match Hydrology's D>0.0001 and the Q-only VisualSurfaceResolver owner.
  // EPSILON (.001) below is mesh/geometry precision, not a water cutoff.
  return hasStoredWaterDepth(tile);
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

// The battle snapshot is republished after selections, movement highlights and
// UI interactions. Those annotation fields are NOT water input. Preserve every
// other published tile field exactly (no quantization/hash), the actual map
// objects, scene geometry revisions, and the authored wind. This is one
// renderer-side invalidation contract, not another water/flow model.
const WATER_NON_VISUAL_ANNOTATIONS=new Set([
  "reachable","targetRange","attackable","deployable","inspected",
  "atmosphericVisible","visionBlocked","deploymentAreaOwner","capturePoint","core"
]);
function waterVisualInputSignature(state,resolver){
  const tiles=tilesOf(state).map(tile=>{
    const visual={};
    for(const key of Object.keys(tile||{}))
      if(!WATER_NON_VISUAL_ANNOTATIONS.has(key))visual[key]=tile[key];
    return visual;
  });
  // Both revisions come from the one terrain surface registry, not from
  // independent water heights or an approximate dirty-region heuristic.
  return JSON.stringify([
    state?.map?.id??null,state?.map?.width??null,state?.map?.height??null,
    resolver?.renderedSurfaceGeometryRevision??null,
    resolver?.renderedCliffGeometryRevision??null,
    tiles,state?.map?.objects||[],
    state?.presentation?.environment?.wind??state?.environment?.wind??state?.wind??null
  ]);
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
    // Derived, read-only topology for the current hydrology snapshot. Not a
    // second water state: no volumes or gameplay depth are written here.
    this.sheetFlowNetwork=new Map();
    // The exact shared water polygons already used by buildSurface. Cascades
    // must inspect this SAME D/Q wet shape, not the old D-only shoreline.
    this.surfacePresentation=new Map();
    // Exact per-tile, cliff-clipped polygons consumed by buildSurface(). Ice
    // may borrow these published polygons, never derive a second waterline.
    this.publishedWaterTileTriangles=new Map();
    this.sheetFlowSurfaces=new Map();
    this.sheetFlowMeshes=new Map();
    this.surfaceSignature="";
    this.surfaceTileInputSignatures=new Map();
    this.lastWaterVisualInput=null;
    this.lastWaterVisualRevision=null;
    this.visualInputAudit={syncs:0,identicalInputsSkipped:0,keyBuildMs:0,keyLength:0};
    // Geometry registries publish immutable buffers; cache their EXACT XYZ
    // fingerprint by source-object identity, not by a global revision number.
    this.publishedWaterGeometrySignatures=new WeakMap();
    this.surfaceSolveStats={totalTiles:0,resolvedTiles:0,reusedTiles:0};
    this.surfaceRebuildDetail=null;
    this.surfaceRebuildHistory=[];
    this.surfaceMeshSignatures=new Map();
    // Separate actual indexed geometry ownership from flow/colour/wave inputs.
    // An attribute-only change must not dispose a conforming water mesh.
    this.surfaceGeometrySignatures=new Map();
    // Exact per-component tile ownership, for skipping unrelated component
    // polygon/cliff/signature work. No duplicate topology or hydrology state.
    this.surfaceComponentMembership=new Map();
    this.surfaceComponentSourceSignatures=new Map();
    // The global publication still notifies snow/ice owners, while each
    // component separately marks whether its actual geometry was replaced.
    // Unrelated water-body edits must not invalidate stable frozen vertices.
    this.surfaceComponentGeometryVersions=new Map();
    this.componentGeometryVersionSerial=0;
    // Derived exact cliff-clipped polygons for tiles inside changing water
    // components. Cached only by immutable resolver publication identity and
    // the original conservative dirty dependency set.
    this.surfaceTileOwnedPolygons=new Map();
    // Derived per-polygon conforming triangle layouts. Only the authoritative
    // WaterRenderer owns this cache; it has no gameplay or Mesh ownership.
    // Face identity and ALL nearby float32 vertices gate every reuse.
    this.surfacePolygonTriangulations=new Map();
    // Exact topology reuse within the existing canonical component owner.
    // Only identical float32 X/Z positions, face ownership/indices, and the
    // actual connected tile graph permit bypassing conforming triangulation.
    // No hydrology state, alternate geometry, approximation or persistent GPU
    // resource is created; cached indices are derived from the published mesh.
    this.surfaceTopologyLayouts=new Map();
    // Per-tile immutable vertex evaluations. One owner and one invalidation
    // contract: the exact published polygons, conservative Dirty halo, local
    // source field, and component-wide turbidity. Shared vertex interning is
    // still performed by addVertex in its original stable order.
    this.surfaceTriangulationStats={reusedFaces:0,recomputedFaces:0,
      topologyVerifiedFacesReused:0,elapsedMs:0,exactLayoutHits:0,exactLayoutMisses:0};
    this.publishedSurfaceSourcesSignature=null;
    this.publishedWaterGeometryRevision=0;
    this.levelSamples=null;
    // Snapshot-scoped memo for the SAME authored D/Q cliff connectivity.
    // No cached result survives a new BattlePresentation or terrain publication.
    this.waterEdgeContinuity=null;
    this.waterEdgeContinuityStats={hits:0,misses:0};
    this.surfaceMeshUpdate={reused:0,attributesUpdated:0,verticesUpdated:0,
      topologyIndicesUpdated:0,topologyBuffersReallocated:0,built:0,
      disposed:0,colorUploads:0,attributeUploads:0,indexUploads:0,
      vertexBufferUploads:0,vertexBufferUploadBytes:0,estimatedUploadBytes:0};
    this.cascadeMeshSignatures=new Map();
    this.cascadeMeshUpdate={reused:0,built:0,disposed:0};
    // Read-only accelerators for the ONE published D/Q presentation and
    // immutable terrain-cliff registry. Weak keys follow their source buffers:
    // no second water state, no stale tile ownership or geometry copies.
    this.waterPolygonSpatialIndex=new WeakMap();
    this.cascadeGeometrySignatures=new WeakMap();
    this.runoffMeshSignatures=new Map();
    this.runoffMeshUpdate={reused:0,built:0,disposed:0};
    this.sourceSignature="";
    this.waveTime=0;
    this.waveAccumulator=0;
    // Whether a GPU-water component was actually displaced by a special wave.
    // Normal water remains shader-driven; no idle full-region scan is needed.
    this.surfaceSpecialsActive=false;
    this.wind={x:0,z:0,strength:0};
    this.renderableWaterKeys=new Set();
    this.rogueWaves=[];
    this.seenRogueWaveSequences=new Set();
    this.whirlpools=new Map();
    this.waterSeamRegistry=new Map();
    // Read-only geometry audit is computed on demand, never during animation.
    this.seamAuditRevision=0;
    this.seamAuditCache=null;

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
      // Expired waves are retired in-place. The old per-frame filter allocated
      // an extra Array even when the water had no special wave active.
      const waves=this.rogueWaves;
      let retained=0;
      for(let i=0;i<waves.length;i++){
        const wave=waves[i],age=this.waveTime-wave.startedAt;
        if(age>wave.duration+.25){wave.visual?.dispose?.();continue;}
        this.updateRogueWaveVisual(wave,age);
        waves[retained++]=wave;
      }
      waves.length=retained;

      this.waveAccumulator+=dt;
      if(this.waveAccumulator>=1/30){
        this.waveAccumulator=0;
        if(this.gpuSurfaceWaves){
          // Ordinary wind/flow waves are already displaced by the GPU. Only
          // exceptional disturbances need CPU polygon vertex animation.
          if(waves.length||this.whirlpools.size){
            const activeSurfaceIds=new Set();
            for(const wave of waves)for(const id of wave.surfaceIds||[])activeSurfaceIds.add(id);
            for(const whirl of this.whirlpools.values())for(const id of whirl.surfaceIds||[])activeSurfaceIds.add(id);
            let anySpecial=false;
            for(const entry of this.surfaceAnimations.values()){
              if(activeSurfaceIds.has(entry.id))this.animateSpecialSurface(entry,this.waveTime);
              else if(entry.specialActive)this.resetSpecialSurface(entry);
              if(entry.specialActive)anySpecial=true;
            }
            this.surfaceSpecialsActive=anySpecial;
          }else if(this.surfaceSpecialsActive){
            // Restore changed vertices ONCE on the transition back to calm.
            for(const entry of this.surfaceAnimations.values())
              if(entry.specialActive)this.resetSpecialSurface(entry);
            this.surfaceSpecialsActive=false;
          }
        }else{
          // Preserve the existing CPU wave fallback when shaders are absent.
          for(const entry of this.surfaceAnimations.values())this.animateSurface(entry,this.waveTime);
        }
      }
      for(const whirl of this.whirlpools.values())this.updateWhirlpoolVisual(whirl,dt);
      this.cascadeTexture.vOffset=(this.cascadeTexture.vOffset-dt*.72)%1;
      // Runoff is a persistent directional transport surface. A slightly clearer
      // scroll rate plus continuous world-distance UV phase makes Q visibly travel
      // from the spring toward its receiver rather than shimmer in place per tile.
      this.runoffTexture.vOffset=(this.runoffTexture.vOffset-dt*.46)%1;
      for(const entry of this.cascades.values()){
        // Hydrology flow intensity animates the existing waterfall impact
        // geometry. A flow-only change must not destroy its rock-bound mesh.
        const impact=Math.max(.32,Number(entry.impactScale||1));
        const foamWidth=entry.foamWidthRatio??1;
        const foamThickness=entry.foamThicknessRatio??1;
        const p=1+Math.sin(this.waveTime*(2.6+impact*.9)+entry.phase)*(.035+.035*Math.min(1,impact));
        for(const group of entry.impacts||[]){
          group.foam.rotation.y+=dt*.7;
          group.foam.scaling.set(1.02*p*foamWidth,(.24+.08*Math.min(1,impact))*foamThickness,.62*p*foamWidth);
          for(let i=0;i<(group.ripples||[]).length;i++){
            const ripple=group.ripples[i],q=(this.waveTime*(.52+.30*impact)+entry.phase*.07+i*.46)%1,scale=.55+q*.95;
            const width=entry.rippleWidthRatios?.[i]??1;
            ripple.scaling.set(scale*width,.22,scale*.68*width);
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
    // Bank transparency belongs to vertex alpha, so the flow texture itself stays
    // opaque enough to carry visible directional highlights on bright terrain.
    cross.addColorStop(0,"rgb(168,205,214)");
    cross.addColorStop(.22,"rgb(190,226,232)");
    cross.addColorStop(.5,"rgb(224,245,247)");
    cross.addColorStop(.78,"rgb(190,226,232)");
    cross.addColorStop(1,"rgb(168,205,214)");
    ctx.fillStyle=cross;ctx.fillRect(0,0,96,256);
    ctx.strokeStyle="rgba(248,255,255,0.72)";ctx.lineWidth=2;
    for(let y=14;y<256;y+=42){ctx.beginPath();ctx.moveTo(8,y);ctx.bezierCurveTo(28,y+6,64,y-5,88,y+2);ctx.stroke();}
    ctx.strokeStyle="rgba(214,246,250,0.45)";ctx.lineWidth=1;
    for(let y=34;y<256;y+=42){ctx.beginPath();ctx.moveTo(18,y);ctx.bezierCurveTo(38,y-4,62,y+5,80,y);ctx.stroke();}
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
    // Surface ownership is determined by actual stored hydrology depth, not an
    // independent display cutoff. Clipped terrain triangles determine the visible
    // wet portion of each 3x3 terrain patch; Q-only flow stays with runoffEdges().
    const selected=tilesOf(state).filter(hasAnyWater);
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
    // If an external owner clears geometry, the next identical snapshot still
    // must republish its authoritative water surfaces.
    this.lastWaterVisualInput=null;
    this.disposeMap(this.surfaceMeshes);
    this.surfaceAnimations.clear();
    this.surfaceMeshSignatures.clear();
    this.surfaceGeometrySignatures.clear();
    this.surfaceComponentMembership.clear();
    this.surfaceComponentSourceSignatures.clear();
    this.surfaceComponentGeometryVersions.clear();
    this.surfaceTileOwnedPolygons.clear();
    this.surfacePolygonTriangulations.clear();
    this.surfaceTopologyLayouts.clear();
    this.surfaceRebuildHistory.length=0;
    this.publishedSurfaceSourcesSignature=null;
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
    // The D/Q boundary network is already the unique inventory of real
    // directed transfers. River flowX/flowY identifies only the authored main
    // route, so it cannot describe lateral lake intake, backwater or branches.
    const tileKey=keyOf(tile?.x,tile?.y),node=this.sheetFlowNetwork?.get(tileKey);
    if(!node)return{x:0,z:0,speed:0};
    let vx=0,vz=0,inVolume=0,outVolume=0;
    const transport=(edge,incoming)=>{
      if(!edge||(!edge.geometryJoinValid&&!edge.cascade))return;
      // Hydrology has already converted Q to the volume moved in this step.
      // Do not duplicate its per-turn unit conversion in a renderer.
      const volume=Math.max(0,Number(edge.transportVolume||0));
      if(volume<=EPSILON)return;
      const otherKey=incoming?edge.fromKey:edge.toKey;
      const [ex,ez]=String(otherKey||"").split(",").map(Number);
      if(!Number.isFinite(ex)||!Number.isFinite(ez))return;
      const dx=incoming?Number(tile.x)-ex:ex-Number(tile.x);
      const dz=incoming?Number(tile.y)-ez:ez-Number(tile.y);
      if(Math.abs(dx)+Math.abs(dz)!==1)return;
      vx+=dx*volume;vz+=dz*volume;
      if(incoming)inVolume+=volume;else outVolume+=volume;
    };
    for(const edge of node.incoming||[])transport(edge,true);
    for(const edge of node.outgoing||[])transport(edge,false);
    const length=Math.hypot(vx,vz);
    if(length<=EPSILON)return{x:0,z:0,speed:0};
    // Convert the already-measured discharge volume to a surface advection
    // speed through this tile's existing wetted channel cross-section.
    // This never creates a second Q value or changes the gameplay D store.
    const moved=Math.max(inVolume,outVolume);
    const depth=Math.max(.15,waterDepth(tile));
    const width=clamp(Number(tile?.hydrologyChannelWidthFraction??1),.15,1);
    const speed=clamp(moved/(depth*width),0,3.2);
    return{x:vx/length,z:vz/length,speed};
  }

  accumulateVertexMotion(out,index,tile,knownMotion=null){
    const motion=knownMotion||this.tileMotion(tile);
    out.flowXSum[index]=(out.flowXSum[index]||0)+motion.x*motion.speed;
    out.flowZSum[index]=(out.flowZSum[index]||0)+motion.z*motion.speed;
    out.flowSpeedSum[index]=(out.flowSpeedSum[index]||0)+motion.speed;
    out.flowSampleCount[index]=(out.flowSampleCount[index]||0)+1;
  }

  componentFlow(component){
    let vx=0,vz=0,speedSum=0,count=0;
    for(const tile of component?.tiles||[]){
      const motion=this.tileMotion(tile);
      if(motion.speed<=EPSILON)continue;
      vx+=motion.x*motion.speed;vz+=motion.z*motion.speed;
      speedSum+=motion.speed;count++;
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
    if(!a||!b||!this.isRenderableWater(a)||!this.isRenderableWater(b))return false;
    const lookup=this.waterEdgeContinuity;
    // Preserve direction-sensitive HydrologyEngine.edgeFlowState semantics.
    // The key must not assume that querying A→B is equivalent to B→A.
    const key=lookup?`${keyOf(a.x,a.y)}>${keyOf(b.x,b.y)}`:null;
    if(lookup?.has(key)){
      this.waterEdgeContinuityStats.hits++;
      return lookup.get(key);
    }
    const dx=Number(b.x)-Number(a.x),dy=Number(b.y)-Number(a.y);
    // Both D and measured Q use the SAME shared published-rock seam rule.
    // A submerged cliff is the bed of one water body, not a second water mesh.
    const wall=this.surfaceResolver.getRenderedCliffGeometry(a,{dx,dy})||
      this.surfaceResolver.getRenderedCliffGeometry(b,{dx:-dx,dy:-dy});
    const continuous=wall
      ?!!this.surfaceResolver.submergedStoredWaterCliff(a,b)&&!this.isCascadeBoundary(a,b)
      :this.surfaceResolver.canSlope(a,b)&&!this.isCascadeBoundary(a,b);
    if(lookup){lookup.set(key,continuous);this.waterEdgeContinuityStats.misses++;}
    return continuous;
  }

  // Authoritative CONTACT rule for both component membership and vertex
  // welding. A component can wind around a cliff and meet itself on opposite
  // levels: being in the same transitive component is not permission to weld
  // across that hard local cliff. Use precisely the same D/Q edge decision.
  surfaceEdgeContinuous(tile,next){
    if(!tile||!next)return false;
    const dx=Number(tile.x)-Number(next.x),dy=Number(tile.y)-Number(next.y);
    if(dx===0&&dy===0)return true;
    if(Math.abs(dx)+Math.abs(dy)!==1)return false;
    if(hasAnyWater(tile)&&hasAnyWater(next))return this.continuousWaterEdge(tile,next);
    const a=keyOf(tile.x,tile.y),b=keyOf(next.x,next.y);
    return[...(this.sheetFlowNetwork?.get(a)?.incoming||[]),
           ...(this.sheetFlowNetwork?.get(a)?.outgoing||[])]
      .some(edge=>edge.geometryJoinValid&&!edge.cascade&&
        ((edge.fromKey===a&&edge.toKey===b)||(edge.fromKey===b&&edge.toKey===a)));
  }

  // All D and Q tiles use one surface connectivity and one horizontal Mesh
  // builder. Published cliffs are NOT continuous horizontal water boundaries.
  presentationComponents(presentation){
    const tiles=[...presentation.values()].map(item=>item.tile);
    const by=this.byKey(tiles),remaining=new Set(by.keys()),out=[];
    while(remaining.size){
      const first=by.get(remaining.values().next().value);
      const group=this.surfaceGroup(first),queue=[first],members=[];
      remaining.delete(keyOf(first.x,first.y));
      while(queue.length){
        const tile=queue.shift();members.push(tile);
        for(const dir of DIRS){
          const neighbor=by.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));
          if(!neighbor||this.surfaceGroup(neighbor)!==group||!this.surfaceEdgeContinuous(tile,neighbor))continue;
          const neighborKey=keyOf(neighbor.x,neighbor.y);
          if(!remaining.delete(neighborKey))continue;
          queue.push(neighbor);
        }
      }
      // A stable location-derived component identity prevents another region's
      // insertion/deletion from renumbering unrelated water meshes. The exact
      // polygon/signature comparison below still owns the actual reuse decision.
      const anchor=members.reduce((min,tile)=>
        !min||Number(tile.y)<Number(min.y)||
        (Number(tile.y)===Number(min.y)&&Number(tile.x)<Number(min.x))?tile:min,null);
      out.push({id:`${group}:${anchor.x},${anchor.y}`,group,tiles:members});
    }
    return out;
  }

  waterLevelAtWorld(tile,x,z,allMap){
    if(!tile)return 0;
    // Within one immutable presentation sync, the shared terrain vertices and
    // shoreline searches repeatedly ask for identical tile/world samples.
    // Cache exact coordinates, never rounded coordinates or a second D value.
    const samples=this.levelSamples;
    const sampleKey=samples?`${tile.x},${tile.y}:${x}:${z}`:null;
    if(samples?.has(sampleKey))return samples.get(sampleKey);
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
    const level=total>EPSILON?weighted/total:visualSurface(tile);
    if(samples)samples.set(sampleKey,level);
    return level;
  }

  clipTerrainTriangleAtWaterline(tile,triangle,allMap,wet=true){
    // Storage water has a world-space surface and terrain has registered XYZ
    // triangles. Their actual intersection is the ONLY wet/dry handoff boundary.
    if(!Array.isArray(triangle)||triangle.length!==3)return[];
    const vertices=triangle.map(point=>{
      const level=this.waterLevelAtWorld(tile,point.x,point.z,allMap);
      const waterY=level*ELEVATION_HEIGHT,terrainY=Number(point.y);
      return{x:Number(point.x),y:terrainY,z:Number(point.z),terrainY,waterY,level,clearance:waterY-terrainY};
    });
    const inside=vertex=>wet?vertex.clearance>0:vertex.clearance<=0;
    const interpolate=(a,b)=>{
      const t=a.clearance/(a.clearance-b.clearance);
      const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      const waterY=a.waterY+(b.waterY-a.waterY)*t;
      const terrainY=a.terrainY+(b.terrainY-a.terrainY)*t;
      return{x,y:terrainY,z,terrainY,waterY,level:waterY/ELEVATION_HEIGHT,clearance:0};
    };
    const polygon=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length],aIn=inside(a),bIn=inside(b);
      if(aIn)polygon.push(a);
      if(aIn!==bIn)polygon.push(interpolate(a,b));
    }
    return polygon;
  }

  clipTerrainTriangleToWater(tile,triangle,allMap){
    return this.clipTerrainTriangleAtWaterline(tile,triangle,allMap,true).map(point=>({
      x:point.x,z:point.z,level:point.level,
      depth:Math.max(0,point.clearance/ELEVATION_HEIGHT),
      clipped:point.clearance<=EPSILON*ELEVATION_HEIGHT*2,
      mode:"TERRAIN_INTERSECTION"
    }));
  }

  waterSurfacePolygons(tile,allMap){
    // Never report a storage water surface for a tile owned by Q-only flow.
    if(!hasAnyWater(tile))return[];
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

  // The first 3x3 micro-region is the spring outlet. Its exact end section
  // is shared with the ongoing Q-only runoff (not a separate radial puddle).
  springOutletLength(edge){
    return edge?.from?.hydrologySource===true&&
      (edge.from.sourceKind==="SPRING_SOURCE"||edge.from.springSourceFootprint===true)&&
      edge.from.hydrologySourceDisabled!==true&&!edge.fromPooled&&!edge.cascade&&(edge.runoffSegments||[]).some(s=>s.kind==="SURFACE_RUNOFF")
      ?TILE_SIZE/3:0;
  }

  // Both sides of the spring/runoff join are clipped from the SAME registered
  // terrain polygons using the SAME path-distance scalar. Therefore the join
  // has identical XYZ even where the 3x3 terrain has an irregular slope.
  clipSpringOutletPolygon(points,joinLength,sourceSide){
    if(!joinLength)return points;
    const limit=joinLength/TILE_SIZE;
    const inside=p=>sourceSide?Number(p.along)<=limit+EPSILON:Number(p.along)>=limit-EPSILON;
    const lerp=(a,b)=>{
      const delta=Number(b.along)-Number(a.along),t=Math.abs(delta)<=EPSILON?0:clamp((limit-Number(a.along))/delta,0,1);
      return Object.fromEntries(Object.keys(a).filter(k=>typeof a[k]==="number"&&typeof b[k]==="number")
        .map(k=>[k,Number(a[k])+(Number(b[k])-Number(a[k]))*t]).concat([["along",limit]]));
    };
    const result=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],insideA=inside(a),insideB=inside(b);
      if(insideA)result.push(a);
      if(insideA!==insideB)result.push(lerp(a,b));
    }
    return result;
  }

  sourceFootprintSignatureFor(sources,runoffs=[]){
    const outlets=runoffs.filter(edge=>this.springOutletLength(edge)>0)
      .map(edge=>`${edge.id}:${Number(edge.edgeDischarge||0).toFixed(4)}:${Number(edge.flowPathStart||0).toFixed(3)}`).sort().join("|");
    return`${Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0)}#${outlets}#`+(sources||[]).map(source=>{
      const tile=source.tile||{};
      return`${Number(tile.x)},${Number(tile.y)}:${Number(source.rate||0).toFixed(4)}:${waterDepth(tile).toFixed(4)}:${tile.fogged?1:0}`;
    }).sort().join("|");
  }

  buildSourceFootprint(source,runoffs=[]){
    const tile=source?.tile;if(!tile||waterDepth(tile)>EPSILON)return null;
    // A source outlet is already part of its tile's one shared sheet mesh.
    if(this.sheetFlowSurfaces.has(keyOf(tile.x,tile.y)))return null;
    const edges=runoffs.filter(edge=>edge.from===tile&&this.springOutletLength(edge)>0);
    if(!edges.length)return null;
    const positions=[],indices=[],normals=[],uvs=[],colors=[];
    for(const edge of edges){
      const width=this.transportCrossSection(edge).width;
      if(width<=EPSILON)continue;
      for(const segment of edge.runoffSegments||[]){
        if(segment.kind!=="SURFACE_RUNOFF")continue;
        const footprint=this.surfaceResolver.transportSurfaceFootprint(edge,segment);
        for(const polygon of footprint.polygons){
          if(polygon.tile!==tile)continue;
          const points=this.clipSpringOutletPolygon(polygon.points,this.springOutletLength(edge),true);
          if(points.length<3)continue;
          const first=positions.length/3;
          for(const p of points){
            const point=this.canonicalWaterPoint({x:Number(p.x),y:Number(p.y)+SURFACE_OFFSET*.42,z:Number(p.z)});
            positions.push(point.x,point.y,point.z);normals.push(0,0,0);
            uvs.push((Number(p.across)/width+1)*.5,
              (Number(edge.flowPathStart||0)+Number(p.along)*TILE_SIZE)/Math.max(EPSILON,Number(edge.flowPathRepeat||RUNOFF_UV_REPEAT_DISTANCE)));
            // Keep the EXACT alpha at the handoff, but make the centre of the
            // outlet visibly emerge past the existing ring of spring stones.
            const emerge=clamp(1-Number(p.along)*TILE_SIZE/this.springOutletLength(edge),0,1);
            colors.push(1,1,1,(.72+.28*emerge)*Number(p.bankFade));
          }
          for(let i=1;i<points.length-1;i++){
            const a=points[0],b=points[i],c=points[i+1];
            if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))>1e-10)indices.push(first,first+i,first+i+1);
          }
        }
      }
    }
    if(!indices.length)return null;
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`spring-outlet-${tile.x}-${tile.y}`,this.scene),data=new BABYLON.VertexData();
    Object.assign(data,{positions,indices,normals,uvs,colors});data.applyToMesh(mesh,false);
    mesh.material=this.runoffMaterial;mesh.alphaIndex=SURFACE_RENDER_ORDER.RUNOFF;mesh.isPickable=false;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.visibility=tile.fogged?.18:1;
    mesh.metadata={kind:"water-source-footprint",hydrologySource:true,sourceKind:tile.sourceKind||null,
      rate:source.rate,terrainConforming:true,gameplayDepth:false,connectedToRunoff:true,
      actualSourceFlowEdges:edges.map(edge=>edge.id),sharedTransportTriangles:true,sharedOutletJoin:true,radialWetFade:false};
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
    // Explicit depth is already resolved against published terrain triangles;
    // do not resample a second terrain height (or waste a lookup per vertex).
    const explicit=Number.isFinite(Number(point.depth));
    const terrain=explicit?null:this.surfaceResolver.sampleHeightAtWorld(point.x,point.z,allMap);
    const depth=explicit?Math.max(0,Number(point.depth)):Math.max(0,Number(point.level)-(terrain==null?Number(point.level):Number(terrain)));
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

  onRenderedCliffWaterSeam(tile,point,allMap,localCliffSeams=null){
    // Published rock geometry is immutable during a single water-surface
    // build. Gather the same upstream lips and downhill feet once per tile,
    // rather than repeating eight geometry lookups at every water vertex.
    const tileKey=keyOf(tile.x,tile.y);
    let series=localCliffSeams?.get(tileKey);
    if(!series){
      series=[];
      for(const dir of DIRS){
        const lip=this.surfaceResolver.getRenderedCliffGeometry(tile,dir)?.lip;
        if(lip)series.push(lip);
        const uphill=allMap?.get(keyOf(tile.x-dir.dx,tile.y-dir.dy));
        const foot=uphill?this.surfaceResolver.getRenderedCliffGeometry(uphill,dir)?.foot:null;
        if(foot)series.push(foot);
      }
      localCliffSeams?.set(tileKey,series);
    }
    for(const line of series){
      for(let i=0;i<line.length-1;i++){
        const a=line[i],b=line[i+1],vx=b.x-a.x,vz=b.z-a.z,wx=point.x-a.x,wz=point.z-a.z,len=vx*vx+vz*vz;
        if(len<=1e-12)continue;
        const t=(wx*vx+wz*vz)/len;
        if(t<0||t>1)continue;
        const dx=a.x+vx*t-point.x,dz=a.z+vz*t-point.z;
        if(dx*dx+dz*dz<=1e-12)return true;
      }
    }
    return false;
  }

  addVertex(out,cache,point,allMap,turbidity,tile,sources=[],knownMotion=null,localCliffSeams=null,prepared=null){
    const y=Number(point.level)*ELEVATION_HEIGHT+SURFACE_OFFSET;
    const seam=this.canonicalWaterPoint({x:Number(point.x),y,z:Number(point.z)});
    // A topological contact uses one XYZ even when the two local D/Q solvers
    // report different heights at the same XZ. DO NOT weld every point in the
    // component indiscriminately: a loop around a cliff could put the upper
    // and lower (legitimately different) water layers in the same component.
    // Use the SAME direct edge-continuity owner as presentationComponents.
    const cacheKey=`${seam.x.toFixed(5)}:${seam.z.toFixed(5)}`;
    const contacts=cache.get(cacheKey)||[];
    const contact=contacts.find(record=>record.tiles.some(owner=>
      this.surfaceEdgeContinuous(owner,tile)));
    const existing=contact?.index;
    if(existing!=null){
      if(!contact.tiles.some(owner=>owner===tile))contact.tiles.push(tile);
      const owners=out.vertexContactTiles[existing];
      if(!owners.some(owner=>owner===tile))owners.push(tile);
      // A genuinely connected D/D boundary takes its height from the already
      // authoritative, cliff-aware hydrology interpolation. This eliminates
      // tile-order dependence when the two stored surfaces slope differently.
      // Never use this for unconnected cliff/cascade surfaces: those are built
      // in different components before this code runs.
      if(hasAnyWater(tile)&&out.storedVertexAuthority[existing]&&
        Math.fround(out.positions[existing*3+1])!==Math.fround(seam.y)){
        out.positions[existing*3+1]=
          this.waterLevelAtWorld(tile,seam.x,seam.z,allMap)*ELEVATION_HEIGHT+SURFACE_OFFSET;
      }
      // Stored D is the authoritative height at a D/Q join, as well as the
      // colour/depth owner. Q can contribute velocity but cannot open a
      // second height layer inside the same connected water component.
      if(hasAnyWater(tile)&&!out.storedVertexAuthority[existing]){
        out.positions[existing*3+1]=seam.y;
        const visual=prepared?.visual||this.waterVertexVisual(point,allMap,turbidity);
        if(prepared&&!prepared.visual)prepared.visual=visual;
        out.colors[existing*4]=visual.color[0];
        out.colors[existing*4+1]=visual.color[1];
        out.colors[existing*4+2]=visual.color[2];
        out.colors[existing*4+3]=visual.alpha;
        const onCliffLip=prepared?.onCliffLip??this.onRenderedCliffWaterSeam(tile,point,allMap,localCliffSeams);
        if(prepared&&prepared.onCliffLip===undefined)prepared.onCliffLip=onCliffLip;
        out.waveWeights[existing]=onCliffLip?0:smooth01(visual.depth/.34);
        const sourceField=prepared?.sourceField||(visual.depth<=EPSILON||onCliffLip
          ?{weight:0,phase:0}:this.sourceFieldAt(point,sources));
        if(prepared&&!prepared.sourceField)prepared.sourceField=sourceField;
        out.sourceWeights[existing]=sourceField.weight;
        out.sourcePhases[existing]=sourceField.phase;
        out.storedVertexAuthority[existing]=true;
      }
      this.accumulateVertexMotion(out,existing,tile,knownMotion);
      return existing;
    }

    const visual=prepared?.visual||this.waterVertexVisual(point,allMap,turbidity);
    if(prepared&&!prepared.visual)prepared.visual=visual;
    const index=out.positions.length/3;
    out.positions.push(seam.x,seam.y,seam.z);
    out.uvs.push(seam.x/(TILE_SIZE*3.25),seam.z/(TILE_SIZE*3.25));
    out.colors.push(visual.color[0],visual.color[1],visual.color[2],visual.alpha);
    out.storedVertexAuthority.push(hasAnyWater(tile));
    out.vertexContactTiles.push([tile]);
    const onCliffLip=prepared?.onCliffLip??this.onRenderedCliffWaterSeam(tile,point,allMap,localCliffSeams);
    if(prepared&&prepared.onCliffLip===undefined)prepared.onCliffLip=onCliffLip;
    out.waveWeights.push(onCliffLip?0:smooth01(visual.depth/.34));
    const sourceField=prepared?.sourceField||(visual.depth<=EPSILON||onCliffLip?{weight:0,phase:0}:this.sourceFieldAt(point,sources));
    if(prepared&&!prepared.sourceField)prepared.sourceField=sourceField;
    out.sourceWeights.push(sourceField.weight);out.sourcePhases.push(sourceField.phase);
    out.flowXSum.push(0);out.flowZSum.push(0);out.flowSpeedSum.push(0);out.flowSampleCount.push(0);
    this.accumulateVertexMotion(out,index,tile,knownMotion);
    contacts.push({index,tiles:[tile]});
    cache.set(cacheKey,contacts);
    return index;
  }

  pushTriangle(out,a,b,c){
    if(a===b||b===c||c===a)return;
    // The rendering buffer stores float32 positions. Test whether the actual
    // GPU-representable XZ triangle has area, rather than applying the global
    // EPSILON (a linear simulation tolerance) as a world-area cutoff. The old
    // cutoff silently removed valid, narrow clipped shoreline triangles.
    const ax=Math.fround(out.positions[a*3]),az=Math.fround(out.positions[a*3+2]);
    const bx=Math.fround(out.positions[b*3]),bz=Math.fround(out.positions[b*3+2]);
    const cx=Math.fround(out.positions[c*3]),cz=Math.fround(out.positions[c*3+2]);
    const area=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    if(area===0)return;
    if(area>0){const swap=b;b=c;c=swap;}
    // Intersected D/Q micro-triangles may publish the exact same triangular
    // face twice. The canonical index owner is one draw triangle, not two
    // coincident alpha faces (which z-fight and manufacture non-manifold
    // edges). Deduplicate during the original topology assembly, including
    // cached triangle reuse below; never overlay a cover-up mesh.
    const id=[a,b,c].sort((x,y)=>x-y).join(":");
    if(out.triangleKeys.has(id))return;
    out.triangleKeys.add(id);
    out.indices.push(a,b,c);
  }

  // Build a height-independent, exact identity for the *existing* canonical
  // vertex/face layout. When every float32 X/Z value, indexed polygon,
  // polygon owner and tile-connectivity edge matches, only Y (and attributes)
  // may differ. In that case the original conforming triangle index order is
  // identical. Ambiguous X/Z aliases always run the full original solver:
  // their different Y layers can change which boundary points may be welded.
  surfaceTopologyLayout(component,out,polygons,polygonOwners){
    if(!component||!polygons)return null;
    const n=out.positions.length/3;
    if(!Number.isSafeInteger(n)||!n)return null;
    const coordinates=new Float32Array(n*2),seen=new Set();
    for(let i=0;i<n;i++){
      const x=Math.fround(out.positions[i*3]),z=Math.fround(out.positions[i*3+2]);
      if(!Number.isFinite(x)||!Number.isFinite(z))return null;
      // Native coordinate identity, no quantization and no random/hash alias.
      const key=String(x)+":"+String(z);
      if(seen.has(key))return null;
      seen.add(key);
      coordinates[i*2]=x;coordinates[i*2+1]=z;
    }
    const faceIndices=[],faceLengths=[],owners=[];
    for(let i=0;i<polygons.length;i++){
      const poly=polygons[i];
      faceLengths.push(poly.length);
      owners.push(String(polygonOwners?.[i]??""));
      for(const index of poly)faceIndices.push(index);
    }
    // Connectivity is determined only by the same authoritative
    // surfaceEdgeContinuous() used by presentationComponents()/addVertex().
    // A topology/continuity edit cannot reuse obsolete T-junctions.
    const members=new Map(component.tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
    const connections=[];
    for(const tile of component.tiles){
      for(const dir of [{dx:1,dy:0},{dx:0,dy:1}]){
        const other=members.get(keyOf(Number(tile.x)+dir.dx,Number(tile.y)+dir.dy));
        if(other&&this.surfaceEdgeContinuous(tile,other))
          connections.push(keyOf(tile.x,tile.y)+">"+keyOf(other.x,other.y));
      }
    }
    connections.sort();
    return{coordinates,faceIndices,faceLengths,owners,connections};
  }

  // Equality is exact (float32 GPU-representable X/Z and integer face indices).
  // Not a content hash, not an epsilon, and not a second topology authority.
  sameSurfaceTopologyLayout(previous,next){
    if(!previous||!next)return false;
    for(const key of ["coordinates","faceIndices","faceLengths","owners","connections"]){
      const a=previous[key],b=next[key];
      if(a.length!==b.length)return false;
      for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
    }
    return true;
  }

  // One conforming triangulation for the EXISTING published wet polygons.
  // D-only polygons have the terrain's original tessellation; Q transport
  // triangles can be subdivided. At a shared edge their vertices must become
  // part of both triangles, otherwise a valid D/Q boundary becomes a T-junction
  // despite having the same water level. Use the actual float32 render-space
  // coordinates and split the original polygon edges BEFORE triangulating;
  // there is no second water surface, patch mesh, or visual shoreline offset.
  triangulateSurfacePolygons(out,polygons,polygonOwners=null,priorFaces=null){
    const vertexCount=out.positions.length/3;
    const positions=out.positions;
    const renderPoints=new Array(vertexCount);
    const cellSize=TILE_SIZE/3;
    const buckets=new Map();
    const cell=(x,z)=>`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`;
    for(let i=0;i<vertexCount;i++){
      const p={x:Math.fround(positions[i*3]),y:Math.fround(positions[i*3+1]),z:Math.fround(positions[i*3+2])};
      renderPoints[i]=p;
      const k=cell(p.x,p.z),indices=buckets.get(k)||[];
      indices.push(i);buckets.set(k,indices);
    }
    const edgeSplits=new Map();
    let splitEdges=0,insertedEdgeVertices=0;
    // Every cached face is keyed by its owner-local ordinal, exact float32
    // boundary, and the COMPLETE nearby vertex set. A neighbour introducing a
    // T-junction necessarily changes one of those cells, invalidating this face.
    // We store coordinate identities, not old indices: preceding tiles are free
    // to add/remove vertices without invalidating an otherwise exact face.
    // The wet footprint and the conforming triangle connection are horizontal
    // topology. Water heights are vertex positions, NOT triangle identity.
    // Keep exact float32 X/Z (no rounding) and refuse ambiguous X/Z aliases;
    // different-height layers must use the full 3D conforming builder.
    const footprintKeys=renderPoints.map(p=>`${p.x}:${p.z}`);
    const indexByFootprint=new Map();
    for(let i=0;i<footprintKeys.length;i++){
      const key=footprintKeys[i];
      if(indexByFootprint.has(key))indexByFootprint.set(key,null);
      else indexByFootprint.set(key,i);
    }
    const cellSignatures=new Map();
    for(const [id,ids] of buckets)
      cellSignatures.set(id,JSON.stringify(ids.map(i=>footprintKeys[i]).sort()));
    const nextFaces=new Map(),ownerOrdinals=new Map();
    let reusedFaces=0,recomputedFaces=0,topologyVerifiedFacesReused=0;
    const triangulationStart=performance.now();
    const faceSignature=face=>{
      const points=face.map(index=>renderPoints[index]);
      const maxCoordinate=Math.max(1,...points.flatMap(p=>[Math.abs(p.x),Math.abs(p.z)]));
      const tolerance=Math.max(.00001,2*Math.pow(2,-23)*maxCoordinate);
      const minX=Math.floor((Math.min(...points.map(p=>p.x))-tolerance)/cellSize);
      const maxX=Math.floor((Math.max(...points.map(p=>p.x))+tolerance)/cellSize);
      const minZ=Math.floor((Math.min(...points.map(p=>p.z))-tolerance)/cellSize);
      const maxZ=Math.floor((Math.max(...points.map(p=>p.z))+tolerance)/cellSize);
      // JSON encodes unambiguous boundaries/cell contents. No numeric hashes,
      // quantization or approximate equality enter the reuse decision.
      const cells=[];
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
        const k=`${x}:${z}`,signature=cellSignatures.get(k);
        if(signature!==undefined)cells.push([k,signature]);
      }
      return JSON.stringify([face.map(i=>footprintKeys[i]),cells]);
    };
    // Spacing follows the existing five-decimal seam registry and GPU float32
    // positions; this component already contains no cliff/cascade separation.
    const renderTolerance=(...values)=>Math.max(0.00001,
      2*Math.pow(2,-23)*Math.max(1,...values.map(v=>Math.abs(v))));
    const edgeVertices=(a,b,priorCandidates=null)=>{
      const id=a<b?`${a}:${b}`:`${b}:${a}`;
      const cached=edgeSplits.get(id);
      if(cached)return a<b?cached:{ids:[...cached.ids].reverse(),candidates:cached.candidates};
      const u=a<b?a:b,v=a<b?b:a;
      const A=renderPoints[u],B=renderPoints[v],dx=B.x-A.x,dz=B.z-A.z;
      const len2=dx*dx+dz*dz;
      const result=[{index:u,t:0},{index:v,t:1}],candidates=[];
      if(len2>0){
        const spatial=renderTolerance(A.x,A.z,B.x,B.z);
        const qualifies=index=>{
          if(index===u||index===v)return;
          const P=renderPoints[index],px=P.x-A.x,pz=P.z-A.z;
          const t=(px*dx+pz*dz)/len2;
          if(t<=0||t>=1||Math.hypot(px-dx*t,pz-dz*t)>spatial)return;
          // Geometry in a transitive region can still straddle a real cliff
          // with two independent surface layers. Join only local tile pairs
          // authorised by the SAME direct D/Q connection used for regions.
          const owners=out.vertexContactTiles;
          if(owners){
            const belongs=(endpoint)=>owners[index]?.some(source=>
              owners[endpoint]?.some(other=>this.surfaceEdgeContinuous(source,other)));
            if(!belongs(u)&&!belongs(v))return;
          }
          // All X/Z candidates are saved, not just those currently coplanar.
          // A future change in water height can create or remove a T-junction.
          candidates.push(footprintKeys[index]);
          // This component has already passed the authored no-cascade /
          // submerged-cliff continuity check. A different height on a
          // projected edge is precisely the cracked D/Q join: split the
          // original triangle edge at the REAL neighbour vertex rather than
          // discarding its contact and leaving two free boundaries. The
          // shared index gives both sides one XYZ and one GPU wave input.
          result.push({index,t});
        };
        // Unchanged exact X/Z surroundings have the same possible edge joins.
        // Recheck the CURRENT projected edge before reusing those candidates.
        // If any horizontal key is ambiguous, fall through to the full solver.
        const validPrior=Array.isArray(priorCandidates)&&
          priorCandidates.every(key=>indexByFootprint.get(key)!=null);
        if(validPrior){
          for(const key of priorCandidates)qualifies(indexByFootprint.get(key));
        }else{
          const minX=Math.floor((Math.min(A.x,B.x)-spatial)/cellSize);
          const maxX=Math.floor((Math.max(A.x,B.x)+spatial)/cellSize);
          const minZ=Math.floor((Math.min(A.z,B.z)-spatial)/cellSize);
          const maxZ=Math.floor((Math.max(A.z,B.z)+spatial)/cellSize);
          const seen=new Set([u,v]);
          for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
            for(const index of buckets.get(`${ix}:${iz}`)||[]){
              if(seen.has(index))continue;
              seen.add(index);
              qualifies(index);
            }
          }
        }
      }
      result.sort((a,b)=>a.t-b.t||a.index-b.index);
      const unique=[];
      for(const item of result){
        const previous=unique.at(-1),P=renderPoints[item.index];
        if(previous){
          const Q=renderPoints[previous.index];
          if(P.x===Q.x&&P.y===Q.y&&P.z===Q.z)continue;
        }
        unique.push(item);
      }
      const ids=unique.map(v=>v.index);
      if(ids.length>2){splitEdges++;insertedEdgeVertices+=ids.length-2;}
      const record={ids,candidates};
      edgeSplits.set(id,record);
      return a<b?record:{ids:[...ids].reverse(),candidates};
    };
    let sourcePolygons=0;
    const tileIndexRanges=new Map();
    for(let polygonIndex=0;polygonIndex<polygons.length;polygonIndex++){
      const face=polygons[polygonIndex];
      if(face.length<3)continue;
      sourcePolygons++;
      const indexStart=out.indices.length;
      const owner=polygonOwners?.[polygonIndex]??"";
      const ordinal=ownerOrdinals.get(owner)||0;
      ownerOrdinals.set(owner,ordinal+1);
      const faceId=JSON.stringify([owner,ordinal]);
      const signature=faceSignature(face);
      const old=priorFaces?.get(faceId);
      // The edge solver is still authoritative: recompute the CURRENT exact
      // float32 XZ collinearity for every edge. Within one continuous water
      // body the neighbouring vertex supplies the common Y; a new/removed
      // T-junction invalidates cached triangles even if
      // their X/Z footprints are identical. No guessed water-level tolerance.
      const mayReuseCandidates=old?.footprintTopology===true&&old.signature===signature;
      const edges=face.map((index,i)=>
        edgeVertices(index,face[(i+1)%face.length],
          mayReuseCandidates?old.edges?.[i]?.candidates:null));
      const edgeChains=edges.map((edge,i)=>({edge:i,
        vertices:edge.ids.map(id=>footprintKeys[id]),candidates:edge.candidates}));
      // A pair of surfaces at the same X/Z but different Y is ambiguous.
      // Reuse only when all cached triangle AND edge vertices map uniquely.
      const stable=keys=>keys.every(key=>indexByFootprint.get(key)!=null);
      const sameEdges=old?.edges?.length===edgeChains.length&&
        old.edges.every((prior,i)=>prior.vertices.length===edgeChains[i].vertices.length&&
          prior.vertices.every((key,j)=>key===edgeChains[i].vertices[j]));
      const reuse=old?.footprintTopology===true&&old.signature===signature&&
        stable(old.vertices)&&sameEdges;
      if(reuse){
        for(let i=0;i<old.triangles.length;i+=3)
          this.pushTriangle(out,indexByFootprint.get(old.triangles[i]),
            indexByFootprint.get(old.triangles[i+1]),
            indexByFootprint.get(old.triangles[i+2]));
        nextFaces.set(faceId,old);
        reusedFaces++;
        // An elevation-only edit is a valid topology cache hit. The original
        // Babylon vertex/normal uploader below still submits the NEW heights.
        topologyVerifiedFacesReused++;
      }else{
        const boundary=[];
        for(let i=0;i<edges.length;i++){
          const chain=edges[i].ids;
          for(let j=0;j<chain.length-1;j++){
            if(boundary.at(-1)!==chain[j])boundary.push(chain[j]);
          }
        }
        if(boundary.length>2){
          // Fan triangulation can discard a collinear sub-edge attached to its
          // pivot. Ear clipping the convex published polygon instead preserves
          // EVERY split boundary segment without adding synthetic centroids.
          while(boundary.length>3){
            let ear=-1;
            for(let i=0;i<boundary.length;i++){
              const a=renderPoints[boundary[(i+boundary.length-1)%boundary.length]];
              const b=renderPoints[boundary[i]];
              const c=renderPoints[boundary[(i+1)%boundary.length]];
              if((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)===0)continue;
              // A legal ear must leave a NON-degenerate polygon. Otherwise a
              // long unsplit edge would swallow the split points at the end.
              const rest=boundary.filter((_,j)=>j!==i);
              let restArea=0;
              for(let k=0;k<rest.length;k++){
                const p=renderPoints[rest[k]],q=renderPoints[rest[(k+1)%rest.length]];
                restArea+=p.x*q.z-p.z*q.x;
              }
              if(restArea!==0){ear=i;break;}
            }
            if(ear<0)break;
            this.pushTriangle(out,boundary[(ear+boundary.length-1)%boundary.length],
              boundary[ear],boundary[(ear+1)%boundary.length]);
            boundary.splice(ear,1);
          }
          if(boundary.length===3)this.pushTriangle(out,boundary[0],boundary[1],boundary[2]);
        }
        const triangleKeys=out.indices.slice(indexStart).map(id=>footprintKeys[id]);
        nextFaces.set(faceId,{footprintTopology:true,signature,edges:edgeChains,triangles:triangleKeys,
          vertices:[...new Set([...triangleKeys,...edgeChains.flatMap(e=>e.vertices)])]});
        recomputedFaces++;
      }
      if(owner&&out.indices.length>indexStart){
        const prior=tileIndexRanges.get(owner);
        if(prior)prior.indexCount+=out.indices.length-indexStart;
        else tileIndexRanges.set(owner,{startIndex:indexStart,indexCount:out.indices.length-indexStart});
      }
    }
    if(this.surfaceTriangulationStats){
      this.surfaceTriangulationStats.reusedFaces+=reusedFaces;
      this.surfaceTriangulationStats.topologyVerifiedFacesReused+=topologyVerifiedFacesReused;
      this.surfaceTriangulationStats.recomputedFaces+=recomputedFaces;
      this.surfaceTriangulationStats.elapsedMs+=performance.now()-triangulationStart;
    }
    return{sourcePolygons,splitEdges,insertedEdgeVertices,tileIndexRanges,
      reusedFaces,recomputedFaces,topologyVerifiedFacesReused,faceCache:nextFaces};
  }

  // The published rugged cliff shoulder extends outside its owning tile.
  // Where that cliff is submerged AND both stored-water tiles are one
  // continuous water body, the neighbour owns the shared horizontal footprint.
  // Clip ONLY the portion outside the source tile: dropping a whole wet
  // polygon by its centroid leaves half-overlaps or tears out valid water.
  // The cut follows the grid's authored tile boundary, not a visual offset.
  clipSubmergedShoulderToTile(polygon,limits){
    let points=polygon;
    for(const {axis,bound,keepLess} of limits){
      if(points.length<3)break;
      if(points.every(point=>keepLess?Number(point[axis])<=bound:Number(point[axis])>=bound))continue;
      const next=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length];
        const inA=keepLess?Number(a[axis])<=bound:Number(a[axis])>=bound;
        const inB=keepLess?Number(b[axis])<=bound:Number(b[axis])>=bound;
        if(inA)next.push(a);
        if(inA!==inB){
          const t=(bound-Number(a[axis]))/(Number(b[axis])-Number(a[axis]));
          const point={...a};
          for(const key of Object.keys(a)){
            if(typeof a[key]==="number"&&typeof b[key]==="number")
              point[key]=a[key]+(b[key]-a[key])*t;
          }
          point[axis]=bound;
          // A tile-ownership cut is not a newly generated wet/dry shoreline.
          point.clipped=Boolean(a.clipped&&b.clipped);
          next.push(point);
        }
      }
      points=next.filter((point,i)=>
        !(i>0&&point.x===next[i-1].x&&point.z===next[i-1].z&&point.level===next[i-1].level));
      if(points.length>1){
        const first=points[0],last=points.at(-1);
        if(first.x===last.x&&first.z===last.z&&first.level===last.level)points.pop();
      }
    }
    if(points.length<3)return[];
    if(points!==polygon)points.triangleIndex=polygon.triangleIndex;
    return points;
  }

  // Resolve ownership with the EXISTING submerged-cliff/continuous-water
  // contract. No separate water-body test, water level, or render overlay.
  // Other cliffs (exposed rock, dry banks, waterfalls) are left untouched.
  componentSurfacePolygons(component,presentation,clipReuse=null){
    const members=new Map(component.tiles.map(tile=>[keyOf(tile.x,tile.y),tile]));
    let excludedSubmergedShoulders=0,clippedSubmergedShoulders=0;
    const tiles=component.tiles.map(tile=>{
      const key=keyOf(tile.x,tile.y),source= presentation.get(key)?.polygons||[];
      const previous=clipReuse?.previous?.get(key);
      const canReuse=previous?.componentId===component.id&&
        previous.source===source&&!clipReuse.dirtyKeys.has(key);
      let owned=null,excluded=0,clipped=0;
      if(canReuse){
        owned=previous.owned;
        excluded=previous.excluded;clipped=previous.clipped;
        clipReuse.metrics.tilesClippingReused++;
      }else{
        const limits=[];
        if(hasAnyWater(tile))for(const dir of DIRS){
          const neighbor=members.get(keyOf(Number(tile.x)+dir.dx,Number(tile.y)+dir.dy));
          if(!neighbor||!hasAnyWater(neighbor))continue;
          if(!this.surfaceResolver.getRenderedCliffGeometry(tile,dir))continue;
          if(!this.surfaceResolver.submergedStoredWaterCliff(tile,neighbor))continue;
          if(!this.continuousWaterEdge(tile,neighbor))continue;
          limits.push(dir.dx!==0
            ?{axis:"x",bound:(Number(tile.x)+dir.dx*.5)*TILE_SIZE,keepLess:dir.dx>0}
            :{axis:"z",bound:(Number(tile.y)+dir.dy*.5)*TILE_SIZE,keepLess:dir.dy>0});
        }
        owned=[];
        for(const polygon of source){
          if(!limits.length){owned.push(polygon);continue;}
          const retained=this.clipSubmergedShoulderToTile(polygon,limits);
          if(retained.length<3){excluded++;continue;}
          if(retained!==polygon)clipped++;
          owned.push(retained);
        }
        if(clipReuse)clipReuse.metrics.tilesClippingRecomputed++;
      }
      excludedSubmergedShoulders+=excluded;
      clippedSubmergedShoulders+=clipped;
      clipReuse?.next.set(key,{componentId:component.id,source,owned,excluded,clipped});
      // Motion always comes from this snapshot's one Q network owner.
      return{tile,key,polygons:owned,motion:this.tileMotion(tile)};
    });
    return{tiles,excludedSubmergedShoulders,clippedSubmergedShoulders};
  }

  // GPU wave pinning reads actual local cliff lips and adjacent uphill feet.
  // Keep those LOCAL published rock lines as part of the cache dependency;
  // an unrelated cliff elsewhere must not invalidate this water region.
  componentCliffSeams(component,byKey){
    return component.tiles.map(tile=>DIRS.map(dir=>{
      const own=this.surfaceResolver.getRenderedCliffGeometry(tile,dir);
      const uphill=byKey.get(keyOf(tile.x-dir.dx,tile.y-dir.dy));
      const adjacent=uphill?this.surfaceResolver.getRenderedCliffGeometry(uphill,dir):null;
      return[own?.lip??null,adjacent?.foot??null];
    }));
  }

  // Geometry-only identity. Polygon order and XYZ are part of the exact
  // conforming triangulation input; flow/colour/depth/sources are deliberately
  // excluded. Any changed footprint, height, polygon split or owner goes through
  // the original conforming builder, never an approximate dirty threshold.
  surfaceGeometrySignatureFor(component,resolved){
    const geometry=resolved.tiles.map(({key,polygons})=>[key,polygons.map(polygon=>
      polygon.map(point=>[point.x,point.z,point.level]))]);
    return JSON.stringify([component.group,geometry]);
  }

  // Cache ONLY per-tile pure visual evaluations in the existing owned-polygon
  // record; the cache lives and dies with that authoritative tile geometry.
  // Local samples are not GPU
  // geometry, vertex indices, or a second water owner: every published mesh is
  // still assembled by addVertex in one canonical D/Q order. Reusing samples
  // cannot change the stored-D precedence at a shared vertex.
  preparedSurfaceTileSamples(component,tile,polygons,allMap,turbidity,sources,cliffSeams,reuse){
    if(!reuse)return null;
    const start=performance.now(),key=keyOf(tile.x,tile.y);
    const sourcesSignature=JSON.stringify(sources.map(source=>[source.x,source.z,source.rate]));
    const previous=reuse.previous.get(key)?.vertexSamples,stored=hasAnyWater(tile);
    if(previous?.componentId===component.id&&previous.polygons===polygons&&
      previous.stored===stored&&previous.turbidity===turbidity&&
      previous.sourcesSignature===sourcesSignature&&!reuse.dirtyKeys.has(key)){
      const owned=reuse.next.get(key)||{componentId:component.id,owned:polygons};
      owned.vertexSamples=previous;reuse.next.set(key,owned);
      reuse.metrics.tilesReused++;
      reuse.metrics.verticesReused+=previous.samples.reduce((n,a)=>n+a.length,0);
      reuse.metrics.elapsedMs+=performance.now()-start;
      return previous.samples;
    }
    // The initial evaluation remains lazy. On a heavy-rain tick most tiles
    // really are Dirty; eagerly sampling shared Q vertices would add CPU work
    // without providing a cache hit. addVertex fills only requested samples.
    const samples=polygons.map(polygon=>polygon.map(()=>({})));
    const owned=reuse.next.get(key)||{componentId:component.id,owned:polygons};
    owned.vertexSamples={componentId:component.id,polygons,stored,turbidity,
      sourcesSignature,samples};
    reuse.next.set(key,owned);
    reuse.metrics.tilesEvaluated++;
    reuse.metrics.verticesEvaluated+=samples.reduce((n,a)=>n+a.length,0);
    reuse.metrics.elapsedMs+=performance.now()-start;
    return samples;
  }

  // Preserve a single Babylon Mesh per component while uploading the exact
  // changed float32 span. The fallback writes the full buffer on Babylon builds
  // without direct-range updates. No epsilon, rate limit, or rounded value is
  // allowed to hide a geometry change. One contiguous range = one GPU call.
  uploadSurfaceVertexData(mesh,kind,values,stride=0){
    const prior=mesh.getVerticesData?.(kind);
    let first=0,last=values.length-1;
    if(prior?.length===values.length){
      while(first<values.length&&prior[first]===Math.fround(values[first]))first++;
      if(first===values.length)return{bytes:0,changed:false};
      while(last>first&&prior[last]===Math.fround(values[last]))last--;
    }
    const oldBuffer=mesh.getVertexBuffer?.(kind);
    const updatable=oldBuffer?.isUpdatable?.()!==false;
    let bytes=0;
    if(prior?.length===values.length&&updatable&&typeof mesh.updateVerticesDataDirectly==="function"){
      const span=Float32Array.from(values.slice(first,last+1));
      mesh.updateVerticesDataDirectly(kind,span,first,false);
      bytes=span.byteLength;
    }else if(prior?.length===values.length&&updatable){
      mesh.updateVerticesData(kind,values,false,false);
      bytes=values.length*4;
    }else{
      mesh.setVerticesData(kind,values,true,stride||undefined);
      bytes=values.length*4;
    }
    this.surfaceMeshUpdate.estimatedUploadBytes+=bytes;
    this.surfaceMeshUpdate.vertexBufferUploads=(this.surfaceMeshUpdate.vertexBufferUploads||0)+1;
    this.surfaceMeshUpdate.vertexBufferUploadBytes=(this.surfaceMeshUpdate.vertexBufferUploadBytes||0)+bytes;
    return{bytes,changed:true};
  }

  // Single authoritative accumulator shape for both full geometry builds and
  // attribute-only refreshes. addVertex() requires vertexContactTiles when
  // welding shared D/Q vertices; keeping two separate object literals allowed
  // the refresh path to omit it and throw during a real blizzard battle.
  createSurfaceVertexAccumulator(){
    return{positions:[],indices:[],triangleKeys:new Set(),normals:[],uvs:[],colors:[],
      vertexContactTiles:[],storedVertexAuthority:[],waveWeights:[],
      sourceWeights:[],sourcePhases:[],flowXSum:[],flowZSum:[],
      flowSpeedSum:[],flowSampleCount:[]};
  }

  // Derive the exact shader and CPU-animation inputs from the existing canonical
  // vertex accumulator. The builder and attribute refresh share this one path.
  surfaceMotionAttributes(out){
    const vertexFlowX=[],vertexFlowZ=[],vertexFlowSpeeds=[];
    const waterAnim=[],waterBaseXZ=[],waterSource=[];
    for(let i=0;i<out.positions.length/3;i++){
      const count=Math.max(1,Number(out.flowSampleCount[i]||0));
      let vx=Number(out.flowXSum[i]||0)/count,vz=Number(out.flowZSum[i]||0)/count;
      const speed=Number(out.flowSpeedSum[i]||0)/count,length=Math.hypot(vx,vz);
      if(length>EPSILON){vx/=length;vz/=length;}else{vx=0;vz=0;}
      vertexFlowX.push(vx);vertexFlowZ.push(vz);vertexFlowSpeeds.push(speed);
      waterAnim.push(vx,vz,speed,Number(out.waveWeights[i]||0));
      waterBaseXZ.push(Number(out.positions[i*3]||0),Number(out.positions[i*3+2]||0));
      waterSource.push(Number(out.sourceWeights[i]||0),Number(out.sourcePhases[i]||0));
    }
    return{vertexFlowX,vertexFlowZ,vertexFlowSpeeds,waterAnim,waterBaseXZ,waterSource};
  }

  // No triangulation, index edits, dispose or new Babylon Mesh. Re-evaluate the
  // attributes from the SAME owned wet polygons using addVertex's D/Q authority
  // and canonical sharing rules. If any GPU-representable vertex differs, the
  // caller must use the complete conforming geometry path instead.
  refreshSurfaceAttributes(component,resolved,state,mesh,entry,allMap,vertexReuse=null){
    if(!mesh||!entry||!this.gpuSurfaceWaves)return false;
    const out=this.createSurfaceVertexAccumulator();
    const cache=new Map(),cliffSeams=new Map();
    const sources=component.sources??this.activeHydrologySources(state);
    const baseTiles=component.tiles.some(hasAnyWater)
      ?component.tiles.filter(hasAnyWater):component.tiles;
    const turbidity=average(baseTiles.map(tile=>this.turbidity(tile)));
    for(const {tile,polygons,motion} of resolved.tiles){
      const samples=this.preparedSurfaceTileSamples(component,tile,polygons,allMap,
        turbidity,sources,cliffSeams,vertexReuse);
      for(let pi=0;pi<polygons.length;pi++)for(let vi=0;vi<polygons[pi].length;vi++)
        this.addVertex(out,cache,polygons[pi][vi],allMap,turbidity,tile,sources,motion,
          cliffSeams,samples?.[pi]?.[vi]);
    }
    const rest=entry.basePositions;
    if(out.positions.length!==rest.length)return false;
    for(let i=0;i<out.positions.length;i++)
      if(Math.fround(out.positions[i])!==rest[i])return false;
    const attrs=this.surfaceMotionAttributes(out);
    // Update colours only if GPU vertex colours actually changed.
    const prior=mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind)||[];
    if(prior.length!==out.colors.length)return false;
    let colorChanged=false;
    for(let i=0;i<prior.length;i++)if(prior[i]!==Math.fround(out.colors[i])){
      colorChanged=true;break;
    }
    if(colorChanged){
      mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind,out.colors,false,false);
      this.surfaceMeshUpdate.colorUploads++;
      this.surfaceMeshUpdate.estimatedUploadBytes+=out.colors.length*4;
    }
    entry.authoredWaveWeights.set(out.waveWeights);
    entry.authoredSourceWeights.set(out.sourceWeights);
    entry.sourcePhases.set(out.sourcePhases);
    entry.flowX.set(attrs.vertexFlowX);
    entry.flowZ.set(attrs.vertexFlowZ);
    entry.flowSpeeds.set(attrs.vertexFlowSpeeds);
    // The authoritative frozen mask is reapplied by syncFrozenSurfaceWaves(),
    // using the EXISTING indices and ranges; it also updates GPU wave inputs.
    entry.frozenWaveSignature=null;
    const flow=this.componentFlow(component);
    mesh.metadata.componentTurbidity=turbidity;
    mesh.metadata.waterSourceUpwelling=sources.length>0;
    mesh.metadata.waveDirection=flow.flowing?{x:flow.x,z:flow.z}:null;
    mesh.metadata.averageFlowSpeed=flow.flowing?flow.speed:0;
    return true;
  }

  buildSurface(component,state,presentation,resolvedSurface=null,allMap=null,previousMesh=null,priorFaces=null,vertexReuse=null){
    const out=this.createSurfaceVertexAccumulator();
    const cache=new Map(),localCliffSeams=new Map(),tileMap=allMap||this.allByKey(state),
      sources=component.sources??this.activeHydrologySources(state),componentTurbidity=average((component.tiles.some(hasAnyWater)
      ?component.tiles.filter(hasAnyWater):component.tiles).map(tile=>this.turbidity(tile)));
    let clippedPoints=0,terrainTriangles=0,waterPolygons=0;
    const resolved=resolvedSurface||this.componentSurfacePolygons(component,presentation);
    const exclusiveSubmergedShoulders=resolved.excludedSubmergedShoulders;
    const clippedSubmergedShoulders=resolved.clippedSubmergedShoulders;
    const wetPolygons=[],polygonOwners=[];
    for(const {tile,polygons,motion} of resolved.tiles){
      const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);
      terrainTriangles+=geometry?.triangles?.length||0;
      const samples=this.preparedSurfaceTileSamples(component,tile,polygons,tileMap,
        componentTurbidity,sources,localCliffSeams,vertexReuse);
      for(let pi=0;pi<polygons.length;pi++){
        const polygon=polygons[pi];
        waterPolygons++;clippedPoints+=polygon.filter(point=>point.clipped).length;
        const vertices=polygon.map((point,vi)=>this.addVertex(out,cache,point,tileMap,
          componentTurbidity,tile,sources,motion,localCliffSeams,samples?.[pi]?.[vi]));
        wetPolygons.push(vertices);
        polygonOwners.push(keyOf(tile.x,tile.y));
      }
    }
    const exactLayout=this.surfaceTopologyLayout(component,out,wetPolygons,polygonOwners);
    const cachedLayout=this.surfaceTopologyLayouts.get(component.id);
    let triangulation;
    if(exactLayout&&cachedLayout&&this.sameSurfaceTopologyLayout(cachedLayout,exactLayout)){
      // The previous publication's final topology is used by the one existing
      // indexed mesh owner. New water heights still recompute normals, wave
      // inputs, ice source buffers and any changed Babylon vertex buffers.
      out.indices=cachedLayout.indices.slice();
      triangulation={...cachedLayout.triangulation,
        tileIndexRanges:new Map(cachedLayout.tileIndexRanges),
        reusedFaces:cachedLayout.triangulation.sourcePolygons,
        recomputedFaces:0,topologyVerifiedFacesReused:cachedLayout.triangulation.sourcePolygons};
      this.surfacePolygonTriangulations.set(component.id,cachedLayout.faceCache);
      this.surfaceTriangulationStats.reusedFaces+=triangulation.reusedFaces;
      this.surfaceTriangulationStats.topologyVerifiedFacesReused+=triangulation.topologyVerifiedFacesReused;
      this.surfaceTriangulationStats.exactLayoutHits++;
    }else{
      const fresh=this.triangulateSurfacePolygons(out,wetPolygons,polygonOwners,priorFaces);
      this.surfacePolygonTriangulations.set(component.id,fresh.faceCache);
      triangulation=fresh;
      this.surfaceTriangulationStats.exactLayoutMisses++;
    }
    if(!out.positions.length||!out.indices.length){
      this.surfaceTopologyLayouts.delete(component.id);
      return null;
    }
    // Layouts are bound to the same component lifecycle as the original
    // surfaceMeshSignatures; no cache entry outlives its published component.
    if(exactLayout)this.surfaceTopologyLayouts.set(component.id,{
      ...exactLayout,indices:out.indices.slice(),
      faceCache:this.surfacePolygonTriangulations.get(component.id),
      tileIndexRanges:new Map(triangulation.tileIndexRanges),
      triangulation:{sourcePolygons:triangulation.sourcePolygons,
        splitEdges:triangulation.splitEdges,
        insertedEdgeVertices:triangulation.insertedEdgeVertices}
    });
    else this.surfaceTopologyLayouts.delete(component.id);
    BABYLON.VertexData.ComputeNormals(out.positions,out.indices,out.normals);
    // The indexed D/Q triangulation is authoritative even when the shoreline
    // changes. Mesh *identity* is independent of the vertex/index layout:
    // preserve the existing Babylon owner and update or replace its own buffers
    // rather than disposing/recreating a Component mesh on every topology edit.
    // This is not a second water surface or a relaxed seam algorithm.
    const existing=previousMesh&&!previousMesh.isDisposed?.()?previousMesh:null;
    const sameVertexCount=!!existing&&existing.getTotalVertices?.()===out.positions.length/3;
    const oldIndices=existing?.getIndices?.()||[];
    const sameIndexLayout=sameVertexCount&&oldIndices.length===out.indices.length&&
      out.indices.every((index,i)=>oldIndices[i]===index);
    const mesh=existing||new BABYLON.Mesh(`water-surface-${component.id}`,this.scene);
    let positionChanged=!sameVertexCount;
    if(sameVertexCount){
      positionChanged=this.uploadSurfaceVertexData(mesh,BABYLON.VertexBuffer.PositionKind,out.positions,3).changed;
      this.uploadSurfaceVertexData(mesh,BABYLON.VertexBuffer.NormalKind,out.normals,3);
      this.uploadSurfaceVertexData(mesh,BABYLON.VertexBuffer.UVKind,out.uvs,2);
      this.uploadSurfaceVertexData(mesh,BABYLON.VertexBuffer.ColorKind,out.colors,4);
      if(!sameIndexLayout){
        // Index order/count can change with exact conforming splits. The old
        // index buffer is replaced, but material, Mesh identity, scene ownership
        // and animated pivots remain stable. Ice observes a new geometry version.
        mesh.setIndices(out.indices,null,true);
        this.surfaceMeshUpdate.topologyIndicesUpdated++;
        this.surfaceMeshUpdate.indexUploads++;
      }
    }else{
      // A true vertex-count change requires replacement of Babylon's vertex
      // buffers. VertexData.applyToMesh on the existing Mesh owns this change;
      // it does not allocate a competing Mesh or a second renderer.
      const data=new BABYLON.VertexData();
      data.positions=out.positions;data.indices=out.indices;
      data.normals=out.normals;data.uvs=out.uvs;data.colors=out.colors;
      data.applyToMesh(mesh,true);
      if(existing){
        this.surfaceMeshUpdate.topologyBuffersReallocated++;
        this.surfaceMeshUpdate.indexUploads++;
      }
    }
    if(existing)mesh.refreshBoundingInfo?.();
    mesh.material=this.surfaceMaterial;mesh.alphaIndex=SURFACE_RENDER_ORDER.STORED_WATER;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.visibility=component.group==="fogged"?.22:1;
    mesh.metadata={kind:"water-surface",tileCount:component.tiles.length,
      unifiedDQ:true,storedTiles:component.tiles.filter(hasAnyWater).length,
      qOnlyTiles:component.tiles.filter(tile=>!hasAnyWater(tile)).length,sharedWetEdges:true,hydrologySurface:true,quantizedLevels:false,clippedShorePoints:clippedPoints,exactTerrainIntersection:true,renderedTerrainTriangles:true,terrainTriangles,waterPolygons,syntheticShoreline:false,visualSurfaceResolver:true,stylizedWater:true,depthGradient:true,vertexAlpha:true,alphaIndex:SURFACE_RENDER_ORDER.STORED_WATER,componentTurbidity,vertexCount:out.positions.length/3,triangleCount:out.indices.length/3,conformingTriangulation:triangulation,
      exclusiveSubmergedShoulders,clippedSubmergedShoulders};
    const flow=this.componentFlow(component);
    const {vertexFlowX,vertexFlowZ,vertexFlowSpeeds,waterAnim,waterBaseXZ,waterSource}=
      this.surfaceMotionAttributes(out);
    if(this.gpuSurfaceWaves){
      // Only freeze/unfreeze modifies the existing per-vertex wave attributes;
      // the mesh positions, wet footprint and triangulation never rebuild.
      if(sameVertexCount){
        this.uploadSurfaceVertexData(mesh,"waterAnim",waterAnim,4);
        this.uploadSurfaceVertexData(mesh,"waterBaseXZ",waterBaseXZ,2);
        this.uploadSurfaceVertexData(mesh,"waterSource",waterSource,2);
      }else{
        mesh.setVerticesData("waterAnim",waterAnim,true,4);
        mesh.setVerticesData("waterBaseXZ",waterBaseXZ,true,2);
        mesh.setVerticesData("waterSource",waterSource,true,2);
      }
    }
    // Upload count is an estimate from client-side float/element arrays; the
    // underlying browser driver may allocate additional backing storage.
    if(!sameVertexCount)this.surfaceMeshUpdate.estimatedUploadBytes+=4*(out.positions.length+
      out.normals.length+out.uvs.length+out.colors.length+
      (this.gpuSurfaceWaves?waterAnim.length+waterBaseXZ.length+waterSource.length:0));
    if(!sameIndexLayout)this.surfaceMeshUpdate.estimatedUploadBytes+=
      out.indices.length*(out.positions.length/3>65535?4:2);
    this.surfaceAnimations.set(component.id,{id:component.id,tileKeys:new Set(component.tiles.filter(hasAnyWater).map(tile=>keyOf(tile.x,tile.y))),mesh,basePositions:Float32Array.from(out.positions),baseNormals:Float32Array.from(out.normals),positions:Float32Array.from(out.positions),normals:Float32Array.from(out.normals),waveWeights:Float32Array.from(out.waveWeights),authoredWaveWeights:Float32Array.from(out.waveWeights),sourceWeights:Float32Array.from(out.sourceWeights),authoredSourceWeights:Float32Array.from(out.sourceWeights),sourcePhases:Float32Array.from(out.sourcePhases),flowX:Float32Array.from(vertexFlowX),flowZ:Float32Array.from(vertexFlowZ),flowSpeeds:Float32Array.from(vertexFlowSpeeds),frozenWaveSignature:"",specialActive:false});
    mesh.metadata.tileIndexRanges=triangulation.tileIndexRanges;
    mesh.metadata.waterSurfaceWave=true;mesh.metadata.waterSourceUpwelling=sources.length>0;mesh.metadata.waterSpecialActive=false;mesh.metadata.waveDirection=flow.flowing?{x:flow.x,z:flow.z}:null;mesh.metadata.averageFlowSpeed=flow.flowing?flow.speed:0;mesh.metadata.localFlowSpeedWaves=true;
    mesh.metadata.geometryCommitChange=!existing||!sameVertexCount||!sameIndexLayout||positionChanged;
    mesh.metadata.incrementalVertexUpdate=sameIndexLayout&&!!existing;
    mesh.metadata.incrementalTopologyUpdate=!!existing&&!sameIndexLayout;
    mesh.freezeWorldMatrix();return mesh;
  }

  // A visible frozen surface is the SAME water mesh in a solid state.
  // Stop its waves by changing only the existing wave/source vertex attributes;
  // the authored D/Q mesh and the water-level solver are left untouched.
  // Frozen/lightly frozen tiles are selected from ClimateEngine's actual
  // iceThickness state, not a height/drop/distance tuning threshold.
  syncFrozenSurfaceWaves(state){
    const frozen=new Set(tilesOf(state).filter(tile=>
      waterDepth(tile)>0&&Number(tile.iceThickness||0)>0)
      .map(tile=>keyOf(tile.x,tile.y)));
    for(const entry of this.surfaceAnimations.values()){
      const ranges=entry.mesh?.metadata?.tileIndexRanges;
      if(!(ranges instanceof Map))continue;
      const keys=[...ranges.keys()].filter(key=>frozen.has(key));
      const signature=keys.join("|");
      if(entry.frozenWaveSignature===signature)continue;
      entry.frozenWaveSignature=signature;
      const indices=entry.mesh.getIndices(),masked=new Set();
      for(const key of keys){
        const range=ranges.get(key);
        for(let i=range.startIndex;i<range.startIndex+range.indexCount;i++)masked.add(indices[i]);
      }
      const count=entry.basePositions.length/3,animation=[],sources=[];
      for(let i=0;i<count;i++){
        const weight=masked.has(i)?0:entry.authoredWaveWeights[i];
        const source=masked.has(i)?0:entry.authoredSourceWeights[i];
        entry.waveWeights[i]=weight;entry.sourceWeights[i]=source;
        animation.push(entry.flowX[i],entry.flowZ[i],entry.flowSpeeds[i],weight);
        sources.push(source,entry.sourcePhases[i]);
      }
      if(this.gpuSurfaceWaves){
        entry.mesh.updateVerticesData("waterAnim",animation,false,false);
        entry.mesh.updateVerticesData("waterSource",sources,false,false);
        this.surfaceMeshUpdate.attributeUploads+=2;
        this.surfaceMeshUpdate.estimatedUploadBytes+=animation.length*4+sources.length*4;
      }
      entry.mesh.metadata.frozenWaveTiles=keys.length;
    }
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

  renderedTerrainYAtPoint(tile,point){
    // The triangles registered by TerrainRenderer, not grid elevations, own the
    // visible slope and rugged cliff shoulder. Unsupported points are not terrain.
    const triangles=this.surfaceResolver.getRenderedSurfaceGeometry(tile)?.triangles;
    if(!triangles?.length)return null;
    for(const triangle of triangles){
      const bary=this.pointInTriangleXZ(point,triangle[0],triangle[1],triangle[2]);
      if(!bary)continue;
      return Number(triangle[0].y)*bary.u+Number(triangle[1].y)*bary.w+Number(triangle[2].y)*bary.v;
    }
    return null;
  }

  terrainSurfaceYAtPoint(tile,point){
    const y=this.renderedTerrainYAtPoint(tile,point);
    // Used by the original spring footprint as a defensive fallback if terrain
    // is not yet published. Runoff never uses this fallback.
    return y==null?Number(tile?.elevation||0)*ELEVATION_HEIGHT:y;
  }

  flowCorridorHalfWidth(edge){
    return this.surfaceResolver.transportHalfWidth(edge);
  }

  transportCrossSection(edge){
    // Persistent hydrology Q determines the existing corridor width. The old
    // sine/edge-id displacement did not follow any flow or terrain data and
    // repeatedly bent/tapered a thin sheet into a ribbon (the "seaweed" shape).
    // Keep one unchanged cross-section for runoff and a Q-only waterfall lip.
    return{width:this.flowCorridorHalfWidth(edge)};
  }

  runoffEdges(state){
    const all=tilesOf(state),by=this.byKey(all),seen=new Set(),out=[],hydrologyEdges=[];
    for(const tile of all){
      for(const dir of [{dx:1,dy:0},{dx:0,dy:1}]){
        const neighbor=by.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));if(!neighbor)continue;
        const flow=this.hydrologyEdgeState(tile,neighbor);
        if(!flow?.flowing||!flow.from||!flow.to)continue;

        // Inventory every published Q edge, including edges wholly within
        // standing water, before selecting the subset drawn as terrain runoff.
        hydrologyEdges.push(flow);

        // Visual ownership follows the actual standing-water renderer, not raw
        // storage. Sub-threshold water plus a real Q remains a transport film.
        const fromPooled=this.isRenderableWater(flow.from),toPooled=this.isRenderableWater(flow.to);
        const fromStored=hasAnyWater(flow.from),toStored=hasAnyWater(flow.to);
        if(!flow.cascade&&fromPooled&&toPooled)continue;

        const sourceEdge=flow.from?.hydrologySource===true||flow.to?.hydrologySource===true;
        const downhillTransport=Number(flow.surfaceDrop||0)>EPSILON*4;
        const persistentTransport=Number(flow.persistentRate??flow.edgeDischarge??0)>EPSILON;
        if(!flow.sheetFlow&&!sourceEdge&&!downhillTransport&&!persistentTransport)continue;

        const id=`${flow.from.x},${flow.from.y}->${flow.to.x},${flow.to.y}`;if(seen.has(id))continue;seen.add(id);
        const edge={
          id,from:flow.from,to:flow.to,fromPooled,toPooled,fromStored,toStored,
          cascade:flow.cascade===true,
          rate:Number(flow.rate||0),edgeDischarge:Number(flow.edgeDischarge??flow.rate??0),persistentRate:Number(flow.persistentRate??flow.edgeDischarge??0),
          transportVolume:Number(flow.transportVolume??flow.volume??0),surfaceDrop:Number(flow.surfaceDrop||0),
          hydraulicPower:Number(flow.hydraulicPower||0),reason:flow.reason||null
        };
        // All published Q stays in this directed inventory for sheet-flow
        // signatures and cascade animation, including water that crosses a
        // real stored-water shoreline. The old non-cascade SURFACE_RUNOFF mesh
        // must never be reintroduced when rain changes a slope from D=0 to D>0.
        edge.runoffSegments=this.runoffSegmentsForEdge(edge,state);
        out.push(edge);
      }
    }
    this.sheetFlowNetwork=this.surfaceResolver.sheetFlowBoundaryNetwork(all,hydrologyEdges);
    return this.assignRunoffPathPhases(out);
  }

  appendTerrainConformingRunoff(edge,segment,width,positions,indices,normals,uvs,colors,allMap){
    // The shared VisualSurfaceResolver owns the Q-only wet footprint. This
    // renderer only converts its published terrain XYZ polygons to Babylon.
    const wetContours=[edge.from,edge.to].filter(tile=>waterDepth(tile)>EPSILON)
      .flatMap(tile=>this.waterSurfacePolygons(tile,allMap));
    const footprint=this.surfaceResolver.transportSurfaceFootprint(edge,segment,{
      // Q-only ground belongs to the unified published-water intersection.
      // This legacy waterfall junction must not paint a second Q ribbon.
      surfaceTriangles:(tile,triangles)=>waterDepth(tile)>EPSILON
        ?triangles.map(triangle=>this.clipTerrainTriangleAtWaterline(tile,triangle,allMap,false)).filter(polygon=>polygon.length>=3)
        :[]
    });
    for(const {points:terrainPoints} of footprint.polygons){
      const points=this.clipSpringOutletPolygon(terrainPoints,this.springOutletLength(edge),false);
      if(points.length<3)continue;
      const first=positions.length/3;
      for(const p of points){
        const x=Number(p.x),z=Number(p.z);
        const waterline=p.clearance===0||wetContours.some(poly=>this.pointOnPolygonBoundary({x,z},poly,1e-9));
        const point=this.canonicalWaterPoint({x,y:Number(p.y)+(waterline?SURFACE_OFFSET:SURFACE_OFFSET*.42),z});
        positions.push(point.x,point.y,point.z);normals.push(0,0,0);
        uvs.push((Number(p.across)/width+1)*.5,
          (Number(edge.flowPathStart||0)+Number(p.along)*TILE_SIZE)/Math.max(EPSILON,Number(edge.flowPathRepeat||RUNOFF_UV_REPEAT_DISTANCE)));
        colors.push(1,1,1,.72*Number(p.bankFade));
      }
      for(let i=1;i<points.length-1;i++){
        const a=points[0],b=points[i],c=points[i+1];
        if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))>1e-10)indices.push(first,first+i,first+i+1);
      }
    }
  }

  appendCliffJunction(edge,segment,cliff,metrics,spans,allMap,positions,indices,normals,uvs,colors){
    // The cascade mesh is built from these SAME exact wall columns. Its lip
    // and foot vertex positions, not a nominal grid midpoint, own the joins.
    const from=edge.from,to=edge.to;
    const dx=Number(to.x)-Number(from.x),dz=Number(to.y)-Number(from.y),length=Math.hypot(dx,dz);
    if(length<=EPSILON)return;
    const px=-dz/length,pz=dx/length,ux=dx/length,uz=dz/length;
    const width=this.transportCrossSection(edge).width;
    if(width<=EPSILON)return;
    const approach=segment.kind==="CASCADE_APPROACH";
    const target=approach?from:to;
    const pooledReceiver=!approach&&edge.toPooled;
    const downstreamPolygons=pooledReceiver?this.waterSurfacePolygons(to,allMap):[];
    const originX=Number(from.x)*TILE_SIZE,originZ=Number(from.y)*TILE_SIZE;
    const across=p=>(Number(p.x)-originX)*px+(Number(p.z)-originZ)*pz;
    for(const span of spans){
      const distances=this.wallColumnDistances(span,metrics),columns=distances.map(d=>this.wallSampleAtDistance(metrics,d));
      if(columns.length<2)continue;
      const valid=[],base=positions.length/3,steps=8;
      // Column-major order guarantees every edge of the actual rugged lip/foot
      // is represented in the runoff approach and landing, too.
      for(let row=0;row<=steps;row++){
        const t=row/steps;
        for(const sample of columns){
          const seam=approach?sample.lip:sample.foot;
          const sideDistance=across(sample.lip),side=sideDistance/width;
          const anchor={x:(approach?from.x:to.x)*TILE_SIZE+px*sideDistance,
            z:(approach?from.y:to.y)*TILE_SIZE+pz*sideDistance};
          let targetPoint=anchor,fullPath=true;
          if(pooledReceiver){
            const intervals=this.segmentWaterIntervals(seam,anchor,downstreamPolygons);
            // The destination water polygon is a genuine world-space boundary.
            // If the waterfall already lands inside its water, no dry film is needed.
            if(intervals.some(v=>v.start<=1e-8))fullPath=false;
            else if(intervals.length){
              const first=intervals[0];
              targetPoint={x:seam.x+(anchor.x-seam.x)*first.start,
                z:seam.z+(anchor.z-seam.z)*first.start};
            }
          }
          const p0=approach?anchor:seam,p1=approach?seam:targetPoint;
          const x=p0.x+(p1.x-p0.x)*t,z=p0.z+(p1.z-p0.z)*t;
          const terrainY=this.renderedTerrainYAtPoint(target,{x,z});
          const exactSeam=approach&&row===steps||!approach&&row===0;
          const waterline=pooledReceiver&&row===steps&&fullPath&&this.waterSurfaceLevelAtPoint({x,z},downstreamPolygons,null)!=null;
          const y=exactSeam?Number(seam.y):terrainY;
          valid.push(fullPath&&(exactSeam||y!=null));
          const point=this.canonicalWaterPoint({x,y:(y??0)+(waterline?SURFACE_OFFSET:SURFACE_OFFSET*.42),z});
          positions.push(point.x,point.y,point.z);normals.push(0,0,0);
          const travel=(x-originX)*ux+(z-originZ)*uz;
          uvs.push((side+1)*.5,(Number(edge.flowPathStart||0)+travel)/Math.max(EPSILON,Number(edge.flowPathRepeat||RUNOFF_UV_REPEAT_DISTANCE)));
          colors.push(1,1,1,.72*Math.max(0,1-Math.abs(side)));
        }
      }
      const n=columns.length;
      for(let i=0;i<steps;i++)for(let j=0;j<n-1;j++){
        const a=base+i*n+j,b=a+1,c=a+n,d=c+1;
        if(valid[i*n+j]&&valid[i*n+j+1]&&valid[(i+1)*n+j]&&valid[(i+1)*n+j+1])indices.push(a,b,d,a,d,c);
      }
    }
  }

  buildRunoff(edge,state=null){
    const from=edge.from,to=edge.to;
    const segments=(edge.runoffSegments||[]).filter(segment=>Number(segment.end)-Number(segment.start)>EPSILON);
    if(!segments.length)return null;
    const positions=[],indices=[],normals=[],uvs=[],colors=[];
    const allMap=state?this.allByKey(state):new Map([[keyOf(from.x,from.y),from],[keyOf(to.x,to.y),to]]);
    const direction={dx:Math.sign(Number(to.x)-Number(from.x)),dy:Math.sign(Number(to.y)-Number(from.y))};
    const wall=edge.cascade?this.surfaceResolver.getRenderedCliffGeometry(from,direction):null;
    const metrics=wall?this.wallPathMetrics(wall):null;
    const width=this.transportCrossSection(edge).width;
    if(width<=EPSILON)return null;
    // Exactly the same Hydrology surface/cliff footprint used by buildCascade.
    // No 0.5-grid assumption, guessed half-width splice, or independent rock lip.
    const cascadeEdge={tile:from,receiver:to,edgeDischarge:edge.edgeDischarge,rate:edge.rate,transportVolume:edge.transportVolume};
    const spans=metrics?this.cascadeSpillIntervals(cascadeEdge,state||{map:{tiles:[from,to]}},wall):[];
    for(const segment of segments){
      if(segment.kind==="SURFACE_RUNOFF"){
        this.appendTerrainConformingRunoff(edge,segment,width,positions,indices,normals,uvs,colors,allMap);
      }else if(metrics&&spans.length){
        this.appendCliffJunction(edge,segment,wall,metrics,spans,allMap,positions,indices,normals,uvs,colors);
      }
    }
    if(!indices.length)return null;
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);
    const mesh=new BABYLON.Mesh(`runoff-${edge.id}`,this.scene),data=new BABYLON.VertexData();
    Object.assign(data,{positions,indices,normals,uvs,colors});data.applyToMesh(mesh,false);
    mesh.material=this.runoffMaterial;mesh.alphaIndex=SURFACE_RENDER_ORDER.RUNOFF;mesh.isPickable=false;mesh.useVertexColors=true;mesh.hasVertexAlpha=true;mesh.visibility=(from.fogged&&to.fogged)?.16:1;
    const fromNetwork=this.sheetFlowNetwork?.get(keyOf(from.x,from.y));
    const toNetwork=this.sheetFlowNetwork?.get(keyOf(to.x,to.y));
    const publishedEdge=fromNetwork?.outgoing.find(item=>item.id===edge.id);
    mesh.metadata={kind:"water-surface-runoff",hydrologyEdgeReason:edge.reason,edgeDischarge:edge.edgeDischarge,persistentRate:edge.persistentRate,transportVolume:edge.transportVolume,surfaceDrop:edge.surfaceDrop,terrainConforming:true,registeredTriangleOnly:true,triangleClippedSurfaceFlow:segments.some(segment=>segment.kind==="SURFACE_RUNOFF"),gameplayDepth:false,pooledSurfaceExcluded:true,poolBoundaryHandoff:true,cascade:edge.cascade===true,cascadeApproach:segments.some(segment=>segment.kind==="CASCADE_APPROACH"),cascadeLanding:segments.some(segment=>segment.kind==="CASCADE_LANDING"),softWetFootprint:true,hardRailGeometry:false,transportOnly:!edge.fromPooled&&!edge.toPooled,shallowStoredTransport:(!edge.fromPooled&&edge.fromStored)||(!edge.toPooled&&edge.toStored),continuousFlowUv:true,flowPathStart:Number(edge.flowPathStart||0),runoffSegments:segments.map(segment=>({start:segment.start,end:segment.end,kind:segment.kind,startKind:segment.startKind,endKind:segment.endKind})),exactShorelineHandoff:segments.some(segment=>segment.startKind==="WATERLINE_TRIANGLE"||segment.endKind==="WATERLINE_TRIANGLE"),registeredCliffSeam:!!metrics,sharedWallColumns:true,
      sheetBoundaryQ:{incoming:Number(fromNetwork?.qIn||0),outgoing:Number(fromNetwork?.qOut||0),receiverIncoming:Number(toNetwork?.qIn||0),receiverOutgoing:Number(toNetwork?.qOut||0),sourceRate:Number(fromNetwork?.sourceRate||0)},
      publishedGeometryJoin:publishedEdge?.geometryJoin||"NO_PUBLISHED_Q_EDGE",publishedGeometryJoinValid:publishedEdge?.geometryJoinValid===true,
      publishedTerrainRevision:Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0),publishedCliffRevision:Number(this.surfaceResolver.renderedCliffGeometryRevision||0)};
    return mesh;
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

  // Direct read of the already built Babylon surface triangles, at rest
  // (before GPU wave displacement). The diagnostic never creates geometry.
  // This separates a Resolver height error from a Mesh construction error.
  renderedWaterMeshPointDiagnostics(x,z,publishedY=null){
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;
    const point={x,z},candidates=[];
    // Surface components and measured-Q runoff ribbons are different Mesh
    // owners. Inspect BOTH: slope defects may occur only in the transport
    // ribbon even when the published D/Q surface is terrain-conforming.
    const published=[...this.surfaceAnimations.values()].map(entry=>({
      mesh:entry.mesh,positions:entry.basePositions,kind:"PUBLISHED_DQ_SURFACE",id:entry.id}));
    const transport=[...this.runoffs.values()].map(mesh=>({
      mesh,positions:mesh?.getVerticesData?.(BABYLON.VertexBuffer.PositionKind),
      kind:"RUNOFF_Q_TRANSPORT",id:mesh?.name}));
    for(const {mesh,positions,kind,id} of [...published,...transport]){
      if(!mesh||mesh.isDisposed?.()||!positions?.length)continue;
      const indices=mesh.getIndices?.();if(!indices?.length)continue;
      let best=null,triangleHits=0;
      const vertex=i=>({x:positions[i*3],y:positions[i*3+1],z:positions[i*3+2]});
      for(let i=0;i+2<indices.length;i+=3){
        const a=vertex(indices[i]),b=vertex(indices[i+1]),c=vertex(indices[i+2]);
        // 1e-7 is the native pointInTriangleXZ XZ tolerance.
        if(x<Math.min(a.x,b.x,c.x)-1e-7||x>Math.max(a.x,b.x,c.x)+1e-7||
           z<Math.min(a.z,b.z,c.z)-1e-7||z>Math.max(a.z,b.z,c.z)+1e-7)continue;
        const bary=this.pointInTriangleXZ(point,a,b,c);
        if(!bary)continue;
        const restY=a.y*bary.u+b.y*bary.w+c.y*bary.v;
        triangleHits++;
        const candidate={meshName:mesh.name,meshKind:kind,meshId:id,
          triangleIndex:i/3,restY,
          deltaFromPublished:publishedY==null?null:restY-publishedY};
        if(!best||(publishedY!=null&&Math.abs(candidate.deltaFromPublished)<Math.abs(best.deltaFromPublished)))best=candidate;
      }
      if(best)candidates.push({...best,containingMeshTriangles:triangleHits,
        hydrologyEdgeReason:kind==="RUNOFF_Q_TRANSPORT"?mesh.metadata?.hydrologyEdgeReason??null:null,
        runoffSegments:kind==="RUNOFF_Q_TRANSPORT"?mesh.metadata?.runoffSegments??null:null});
    }
    if(!candidates.length)return null;
    candidates.sort((a,b)=>publishedY!=null?
      Math.abs(a.deltaFromPublished)-Math.abs(b.deltaFromPublished):0);
    return{...candidates[0],meshCandidates:candidates.slice(0,12),
      gpuWaveReadback:false};
  }

  // TEST/Diagnostics only: read the same published water polygons used to
  // build Mesh geometry. A missing polygon is reported as missing; no fallback
  // plane, guessed tile elevation, or second D/Q height model is permitted.
  publishedWaterPointDiagnostics(tile,x,z){
    if(!tile||!Number.isFinite(x)||!Number.isFinite(z))return null;
    const published=this.surfacePresentation.get(keyOf(tile.x,tile.y));
    if(!published?.polygons?.length)return null;
    const point={x,z};
    for(let polygonIndex=0;polygonIndex<published.polygons.length;polygonIndex++){
      const polygon=published.polygons[polygonIndex];
      if(!this.pointInPolygon(point,polygon))continue;
      for(let i=1;i+1<polygon.length;i++){
        const a=polygon[0],b=polygon[i],c=polygon[i+1];
        const bary=this.pointInTriangleXZ(point,a,b,c);
        if(!bary)continue;
        const sample=field=>Number(a[field])*bary.u+Number(b[field])*bary.w+Number(c[field])*bary.v;
        return{owner:published.stored?"STORED_D_WITH_Q_HANDOFF":"TRANSPORT_Q",
          model:published.model,polygonIndex,triangleIndex:polygon.triangleIndex??null,
          subTriangleIndex:i-1,waterY:sample("waterY"),terrainY:sample("terrainY"),
          depth:sample("depth"),level:sample("level"),
          terrainRevision:published.geometryRevision??null,
          gpuWaveReadback:false};
      }
    }
    return null;
  }

  // The existing presentation polygons are the ONLY waterline authority.
  // They are spatially partitioned on the same published 3x3 terrain-patch
  // scale. The boundary halo is EXACTLY pointOnPolygonBoundary's tolerance;
  // a point that the original query accepts can never be lost at a cell edge.
  // Array-order insertion preserves the original "first containing polygon"
  // selection, including overlapping shoreline fragments.
  indexedWaterPolygonsAt(point,polygons){
    if(!Array.isArray(polygons)||!point)return polygons||[];
    const cellSize=TILE_SIZE/3,boundary=TILE_SIZE*.00025;
    const x=Number(point.x),z=Number(point.z);
    if(!Number.isFinite(x)||!Number.isFinite(z))return polygons;
    let lookup=this.waterPolygonSpatialIndex.get(polygons);
    if(!this.waterPolygonSpatialIndex.has(polygons)){
      const buckets=new Map();
      let allFinite=true;
      for(const polygon of polygons){
        if(!polygon?.length)continue;
        let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
        for(const p of polygon){
          const x=Number(p.x),z=Number(p.z);
          if(!Number.isFinite(x)||!Number.isFinite(z)){
            allFinite=false;break;
          }
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);
          minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
        }
        if(!allFinite)break;
        const x0=Math.floor((minX-boundary)/cellSize);
        const x1=Math.floor((maxX+boundary)/cellSize);
        const z0=Math.floor((minZ-boundary)/cellSize);
        const z1=Math.floor((maxZ+boundary)/cellSize);
        for(let ix=x0;ix<=x1;ix++)for(let iz=z0;iz<=z1;iz++){
          const key=`${ix}:${iz}`,bucket=buckets.get(key)||[];
          bucket.push(polygon);buckets.set(key,bucket);
        }
      }
      // Preserve the original linear contract for malformed source geometry.
      lookup=allFinite?buckets:null;
      this.waterPolygonSpatialIndex.set(polygons,lookup);
    }
    return lookup?.get(`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`)||
      (lookup?[]:polygons);
  }

  waterSurfaceLevelAtPoint(point,polygons,fallback=null){
    for(const polygon of this.indexedWaterPolygonsAt(point,polygons)){
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

  segmentWaterIntervals(a,b,polygons){
    const spans=[];
    for(const polygon of polygons||[])for(const span of this.segmentPolygonIntervals(a,b,polygon))spans.push(span);
    return this.mergeDistanceSpans(spans,1e-5);
  }

  runoffSegmentsForEdge(edge,state){
    // The segments describe hydrologic connectivity, never a guessed half-grid
    // shoreline. buildRunoff clips each leg against actual registered triangles,
    // wet contour vertices, and published cliff lip/foot polylines.
    // Terrain-conforming Q-only sheets own dry slopes. The existing clipped
    // stored-water polygons own D>0 land. A fixed-width handoff strip drawn
    // across their shared gradient is a duplicate, and becomes a visible
    // seaweed-shaped rail as soon as rain wets any part of the slope.
    // Keep the REAL Q edge in runoffEdges() for signatures/flow phase, but
    // request no legacy surface-runoff geometry for non-cascade transport.
    if(!edge.cascade)return [];
    const segments=[];
    if(!edge.fromPooled)segments.push({start:0,end:1,kind:"CASCADE_APPROACH",startKind:"HYDROLOGY_SOURCE",endKind:"CLIFF_LIP",profileOffset:0});
    segments.push({start:0,end:1,kind:"CASCADE_LANDING",startKind:"CLIFF_FOOT",endKind:edge.toPooled?"WATERLINE_TRIANGLE":"HYDROLOGY_RECEIVER",profileOffset:1});
    return segments;
  }

  assignRunoffPathPhases(edges){
    // Q is a directed graph. Carry one accumulated world-distance phase through that
    // graph so every edge of a spring-fed stream samples the animated texture at the
    // phase where the previous edge ended. Branches inherit the same upstream phase.
    const outgoing=new Map(),incoming=new Map();
    for(const edge of edges||[]){
      const fk=keyOf(edge.from.x,edge.from.y),tk=keyOf(edge.to.x,edge.to.y);
      if(!outgoing.has(fk))outgoing.set(fk,[]);outgoing.get(fk).push(edge);
      incoming.set(tk,Number(incoming.get(tk)||0)+1);
    }
    const distance=new Map(),queue=[];
    const enqueue=(k,d)=>{const current=distance.get(k);if(current!=null&&current<=d+EPSILON)return;distance.set(k,d);queue.push(k);};
    for(const edge of edges||[]){
      const fk=keyOf(edge.from.x,edge.from.y);
      if(edge.from?.hydrologySource===true||!incoming.has(fk))enqueue(fk,0);
    }
    while(queue.length){
      const fk=queue.shift(),base=Number(distance.get(fk)||0);
      for(const edge of outgoing.get(fk)||[]){
        const tk=keyOf(edge.to.x,edge.to.y);
        enqueue(tk,base+TILE_SIZE);
      }
    }
    for(const edge of edges||[]){
      const fk=keyOf(edge.from.x,edge.from.y),known=distance.get(fk);
      edge.flowPathStart=Number.isFinite(Number(known))?Number(known):hash01(fk)*TILE_SIZE*.35;
      edge.flowPathRepeat=RUNOFF_UV_REPEAT_DISTANCE;
    }
    return edges;
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

  wallSampleAtLateral(metrics,from,to,crossDistance){
    // Match a transport-film cross-section to the ACTUAL rendered wall.
    // Project the rough lip onto the lateral axis of the directed hydrology
    // edge, then interpolate the registered wall vertices at that crossing.
    // This works for all four cardinal directions without tile/seed cases.
    if(!metrics||!from||!to)return null;
    const dx=Number(to.x)-Number(from.x),dz=Number(to.y)-Number(from.y),length=Math.hypot(dx,dz);
    if(length<=EPSILON)return null;
    const alongX=dx/length,alongZ=dz/length,perpX=-alongZ,perpZ=alongX;
    const originX=Number(from.x)*TILE_SIZE,originZ=Number(from.y)*TILE_SIZE;
    const cross=point=>(Number(point.x)-originX)*perpX+(Number(point.z)-originZ)*perpZ;
    const target=Number(crossDistance),lip=metrics.lip;
    for(let i=0;i<metrics.count-1;i++){
      const a=cross(lip[i]),b=cross(lip[i+1]);
      if(target<Math.min(a,b)-EPSILON||target>Math.max(a,b)+EPSILON)continue;
      const ratio=Math.abs(b-a)<=EPSILON?0:clamp((target-a)/(b-a),0,1);
      const distance=metrics.cumulative[i]+(metrics.cumulative[i+1]-metrics.cumulative[i])*ratio;
      const sample=this.wallSampleAtDistance(metrics,distance);
      const edgeT=((Number(sample.lip.x)-originX)*alongX+(Number(sample.lip.z)-originZ)*alongZ)/(TILE_SIZE*length);
      return{...sample,edgeT};
    }
    return null;
  }

  wallColumnDistances(span,metrics){
    const values=[Number(span.start)];
    for(const distance of metrics?.cumulative||[])if(distance>Number(span.start)+EPSILON&&distance<Number(span.end)-EPSILON)values.push(distance);
    values.push(Number(span.end));
    values.sort((a,b)=>a-b);
    return values.filter((value,index)=>index===0||Math.abs(value-values[index-1])>EPSILON);
  }

  // Rock below the receiver's REAL stored D is a submerged river/lake bed,
  // even if Hydrology measured transport across that edge this turn. Intersect
  // the published wet lip span with only the exposed crest; no extra water
  // state or separate terrain/sample geometry is introduced.
  exposedCascadeIntervals(edge,metrics,spans){
    if(!hasAnyWater(edge?.receiver))return spans;
    const receivingWaterY=visualSurface(edge.receiver)*ELEVATION_HEIGHT;
    if(!Number.isFinite(receivingWaterY))return spans;
    const visible=[];
    for(const span of spans||[]){
      for(let i=0;i<metrics.count-1;i++){
        const start=Math.max(Number(span.start),metrics.cumulative[i]);
        const end=Math.min(Number(span.end),metrics.cumulative[i+1]);
        if(end-start<=EPSILON)continue;
        const lipA=this.wallSampleAtDistance(metrics,start)?.lip;
        const lipB=this.wallSampleAtDistance(metrics,end)?.lip;
        if(!lipA||!lipB)continue;
        const a=Number(lipA.y)-receivingWaterY-EPSILON;
        const b=Number(lipB.y)-receivingWaterY-EPSILON;
        if(a<=0&&b<=0)continue;
        const crossing=start+(end-start)*a/(a-b);
        const first=a>0?start:crossing, last=b>0?end:crossing;
        if(last-first>EPSILON)visible.push({start:first,end:last});
      }
    }
    return this.mergeDistanceSpans(visible);
  }

  cascadeSpillIntervals(edge,state,wall,polygons=null){
    const metrics=this.wallPathMetrics(wall);
    if(!metrics)return[];
    const edgeId=`${edge.tile.x},${edge.tile.y}->${edge.receiver.x},${edge.receiver.y}`;
    const solved=this.surfacePresentation?.get(keyOf(edge.tile.x,edge.tile.y));
    // Authoritative waterfall wet spans are solved against the published,
    // crooked rock lip together with the horizontal D/Q water surface. They
    // replace an independently projected tile-centre/straight-edge fallback.
    if(solved?.cascadeLipSpans&&Object.hasOwn(solved.cascadeLipSpans,edgeId))
      return this.exposedCascadeIntervals(edge,metrics,solved.cascadeLipSpans[edgeId]);
    const waterPolygons=polygons??this.surfacePresentation.get(keyOf(edge.tile.x,edge.tile.y))?.polygons
      ??this.waterSurfacePolygons(edge.tile,this.allByKey(state));
    const spans=[];
    for(let i=0;i<metrics.count-1;i++){
      const a=metrics.lip[i],b=metrics.lip[i+1],segmentStart=metrics.cumulative[i],length=metrics.cumulative[i+1]-segmentStart;
      if(length<=EPSILON)continue;
      for(const polygon of waterPolygons){
        for(const interval of this.segmentPolygonIntervals(a,b,polygon))spans.push({start:segmentStart+interval.start*length,end:segmentStart+interval.end*length});
      }
    }

    const merged=this.mergeDistanceSpans(spans);
    if(merged.length)return this.exposedCascadeIntervals(edge,metrics,merged);

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
    const {width}=this.transportCrossSection(edge);
    const left=this.wallSampleAtLateral(metrics,edge.tile,edge.receiver,-width);
    const right=this.wallSampleAtLateral(metrics,edge.tile,edge.receiver,width);
    if(!left||!right)return[];
    const start=Math.min(left.distance,right.distance),end=Math.max(left.distance,right.distance);
    return end-start>EPSILON
      ?this.exposedCascadeIntervals(edge,metrics,[{start,end,transportFootprint:true,sharedRunoffLip:true}]):[];
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
    // Physical transport Q and stored-water overtopping are distinct facts.
    // Q-only sheets keep the Hydrology edge contract. A standing water surface
    // can also overtop an ACTUAL cliff lip along a neighbouring edge that the
    // tile-scale Q routing did not individually select. Never infer a waterfall
    // from elevation difference alone: verify the recorded lip and the exact
    // upper-water/terrain polygon intersection before drawing anything.
    for(const tile of tilesOf(state)){
      for(const dir of [{dx:1,dy:0},{dx:0,dy:1}]){
        const neighbor=allMap.get(keyOf(tile.x+dir.dx,tile.y+dir.dy));if(!neighbor)continue;
        const flow=this.hydrologyEdgeState(tile,neighbor);
        const transported=Math.max(0,Number(flow?.transportVolume??flow?.volume??0));
        // A dynamic waterfall needs an actual Hydrology transfer across THIS cliff.
        // Decorative cliff-lip intersections with a tiny stored D alone are not
        // a discharge; emitting them created curtain-only rain waterfalls with
        // no upstream Q, downstream water or conservation record.
        const resolved=flow?.cascade&&flow.from&&flow.to&&transported>0.0001?flow:null;
        if(!resolved)continue;
        const high=resolved.from,low=resolved.to,id=`${high.x},${high.y}->${low.x},${low.y}`;
        if(seen.has(id))continue;
        const top=Number.isFinite(Number(resolved.fromSurface))?Number(resolved.fromSurface):visualSurface(high);
        const bottom=Number.isFinite(Number(resolved.toSurface))?Number(resolved.toSurface):(hasAnyWater(low)?visualSurface(low):Number(low.elevation||0));
        const drop=Math.max(0,Number(resolved.surfaceDrop??(top-bottom)));
        if(drop<WATERFALL_MIN_DROP)continue;
        seen.add(id);
        out.push({
          id,tile:high,receiver:low,dx:Math.sign(low.x-high.x),dy:Math.sign(low.y-high.y),
          top,bottom,drop,authoredDrop:resolved.authored?Number(high.hydrologyCascadeDrop||drop):null,
          speed:Math.max(.6,Number(high.flowSpeed||0),Number(resolved.rate||0),drop*.55),
          flowVolume:Number(resolved.volume||0),transportVolume:Number(resolved.transportVolume??resolved.volume??0),
          edgeDischarge:Number(resolved.edgeDischarge??resolved.rate??0),
          hydraulicPower:Number(resolved.hydraulicPower??Math.max(0,Number(resolved.rate||0))*drop),
          hydrologyEdgeReason:resolved.reason||null,authored:resolved.authored===true,
          storedWaterOvertopping:resolved.storedWaterOvertopping===true,receiverWet:hasAnyWater(low)
        });
      }
    }
    return out;
  }

  buildCascade(edge,state){
    const dir=this.cascadeDirection(edge);if(!dir)return null;
    const wall=this.surfaceResolver.getRenderedCliffGeometry(edge.tile,dir);
    const metrics=this.wallPathMetrics(wall);if(!metrics)return null;
    // Use the already published surface polygons. A tile-index fallback is
    // only needed when the renderer is invoked before that presentation exists.
    let fallbackTiles=null;
    const fallbackMap=()=>fallbackTiles??=this.allByKey(state);
    const upstreamPolygons=this.surfacePresentation.get(keyOf(edge.tile.x,edge.tile.y))?.polygons
      ??this.waterSurfacePolygons(edge.tile,fallbackMap());
    const spans=this.cascadeSpillIntervals(edge,state,wall,upstreamPolygons);if(!spans.length)return null;
    const downstreamPolygons=this.surfacePresentation.get(keyOf(edge.receiver.x,edge.receiver.y))?.polygons
      ??(edge.receiverWet?this.waterSurfacePolygons(edge.receiver,fallbackMap()):[]);
    // A rock-face foot can lie outside the clipped receiver polygon in XZ.
    // Never interpret that missing sample as a dry rock floor when the receiver
    // actually stores D. Use the real waterline as a minimum stop height.
    const receiverWaterY=hasAnyWater(edge.receiver)
      ?visualSurface(edge.receiver)*ELEVATION_HEIGHT:-Infinity;
    const positions=[],indices=[],normals=[],uvs=[],impactGroups=[];
    // The rock triangles in wall.segments[].faces are captured from the actual
    // Babylon cliff mesh. A bilinear lip/foot strip does not share its interior
    // triangle planes and can be swallowed by the irregular rock decoration.
    // Subdivide/crop ONLY those actual triangles; do not infer a second wall.
    const outward=wall.outward;
    const clip=(polygon,distance)=>{
      const result=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a),db=distance(b),aInside=da>=-1e-9,bInside=db>=-1e-9;
        if(aInside)result.push(a);
        if(aInside!==bInside){
          const t=da/(da-db),p={};
          for(const key of ['x','y','z','s','v','stopY'])p[key]=Number(a[key])+(Number(b[key])-Number(a[key]))*t;
          result.push(p);
        }
      }
      return result;
    };
    const putFace=(polygon,span)=>{
      if(polygon.length<3)return;
      const first=positions.length/3;
      for(const point of polygon){
        // The whole water face and rock face use the same triangle topology.
        // A common outward displacement (rather than averaged corner normals)
        // keeps the sheet in front of every facet and leaves no cracks at bends.
        // Keep the lip/foot on the published seam for runoff/waterline joins.
        const v=clamp(point.v,0,1),clearance=SURFACE_OFFSET*4*v*(1-v);
        const welded=this.canonicalWaterPoint({
          x:Number(point.x)+Number(outward.x)*clearance,
          y:Number(point.y)+SURFACE_OFFSET*.42,
          z:Number(point.z)+Number(outward.z)*clearance
        });
        positions.push(welded.x,welded.y,welded.z);
        uvs.push((Number(point.s)-Number(span.start))/Math.max(EPSILON,Number(span.end)-Number(span.start)),Number(point.v)*2.25);
        normals.push(0,0,0);
      }
      for(let i=1;i<polygon.length-1;i++){
        const a=polygon[0],b=polygon[i],c=polygon[i+1];
        const ab={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},ac={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
        const area=Math.hypot(ab.y*ac.z-ab.z*ac.y,ab.z*ac.x-ab.x*ac.z,ab.x*ac.y-ab.y*ac.x);
        if(area>1e-12)indices.push(first,first+i,first+i+1);
      }
    };
    for(let spanIndex=0;spanIndex<spans.length;spanIndex++){
      const span=spans[spanIndex],distances=this.wallColumnDistances(span,metrics),impactPoints=[];
      // Above the actual lip, pooled water may stand higher than the rock edge.
      // Preserve the true stored free-surface seam without lifting the entire
      // rock-conforming curtain off its triangles.
      const topEdge=[];
      for(const distance of distances){
        const sample=this.wallSampleAtDistance(metrics,distance);
        const storedTop=this.waterSurfaceLevelAtPoint(sample.lip,upstreamPolygons,null);
        const topY=storedTop==null?sample.lip.y+SURFACE_OFFSET*.42:Number(storedTop)*ELEVATION_HEIGHT+SURFACE_OFFSET;
        topEdge.push({lip:sample.lip,topY});
        const downstream=this.waterSurfaceLevelAtPoint(sample.foot,downstreamPolygons,null);
        const landY=Math.max(sample.foot.y+SURFACE_OFFSET*.42,
          receiverWaterY+SURFACE_OFFSET,
          downstream==null?-Infinity:Number(downstream)*ELEVATION_HEIGHT+SURFACE_OFFSET);
        impactPoints.push({x:sample.foot.x,y:landY,z:sample.foot.z});
      }
      for(let i=0;i<topEdge.length-1;i++){
        const a=topEdge[i],b=topEdge[i+1];
        if(a.topY<=a.lip.y+SURFACE_OFFSET*.42+EPSILON&&b.topY<=b.lip.y+SURFACE_OFFSET*.42+EPSILON)continue;
        const base=positions.length/3;
        for(const p of [
          {x:a.lip.x,y:a.topY,z:a.lip.z,v:0},
          {x:b.lip.x,y:b.topY,z:b.lip.z,v:0},
          {x:b.lip.x,y:b.lip.y+SURFACE_OFFSET*.42,z:b.lip.z,v:1},
          {x:a.lip.x,y:a.lip.y+SURFACE_OFFSET*.42,z:a.lip.z,v:1}
        ]){
          const shared=this.canonicalWaterPoint(p);
          positions.push(shared.x,shared.y,shared.z);normals.push(0,0,0);
          uvs.push(i/Math.max(1,topEdge.length-1),p.v*2.25);
        }
        indices.push(base,base+1,base+2,base,base+2,base+3);
      }
      // Clip each genuine face triangle to the exact waterfall spill interval.
      // For a submerged receiver, also clip at the existing lower free surface;
      // the submerged portion belongs to the pooled water, not a waterfall.
      for(let i=0;i<metrics.count-1;i++){
        const section=wall.segments?.[i];if(!section?.faces?.length)continue;
        const s0=metrics.cumulative[i],s1=metrics.cumulative[i+1];
        if(s1<=span.start+EPSILON||s0>=span.end-EPSILON)continue;
        const downstream0=this.waterSurfaceLevelAtPoint(metrics.foot[i],downstreamPolygons,null);
        const downstream1=this.waterSurfaceLevelAtPoint(metrics.foot[i+1],downstreamPolygons,null);
        const floor0=Math.max(metrics.foot[i].y,receiverWaterY,
          downstream0==null?-Infinity:Number(downstream0)*ELEVATION_HEIGHT);
        const floor1=Math.max(metrics.foot[i+1].y,receiverWaterY,
          downstream1==null?-Infinity:Number(downstream1)*ELEVATION_HEIGHT);
        for(const face of section.faces){
          let polygon=(face.vertices||[]).map(p=>({
            x:Number(p.x),y:Number(p.y),z:Number(p.z),v:Number(p.v),
            s:s0+(s1-s0)*Number(p.u),
            stopY:floor0+(floor1-floor0)*Number(p.u)
          }));
          if(polygon.length!==3)continue;
          polygon=clip(polygon,p=>p.s-Number(span.start));
          if(polygon.length<3)continue;
          polygon=clip(polygon,p=>Number(span.end)-p.s);
          if(polygon.length<3)continue;
          polygon=clip(polygon,p=>p.y-p.stopY);
          if(polygon.length<3)continue;
          putFace(polygon,span);
        }
      }
      if(impactPoints.length)impactGroups.push({spanIndex,points:impactPoints});
    }
    if(!indices.length)return null;
    BABYLON.VertexData.ComputeNormals(positions,indices,normals);

    const mesh=new BABYLON.Mesh(`cascade-${edge.id}`,this.scene),data=new BABYLON.VertexData();
    data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;data.applyToMesh(mesh,false);
    mesh.material=this.cascadeMaterial;mesh.alphaIndex=SURFACE_RENDER_ORDER.CASCADE;mesh.isPickable=false;mesh.visibility=edge.tile.fogged?.16:1;
    mesh.metadata={kind:"water-cascade",drop:edge.drop,flowSpeed:edge.speed,flowVolume:edge.flowVolume,transportVolume:edge.transportVolume,edgeDischarge:edge.edgeDischarge,hydraulicPower:edge.hydraulicPower,renderedCliffGeometry:true,exactCliffFace:true,exactWaterPolygonCliffIntersection:true,spillIntervals:spans.map(span=>({start:span.start,end:span.end})),wetSpans:spans.length,weldedBoundarySeams:true,sharedWaterGeometryRegistry:true,actualRenderedRockFaces:true,matchingRockFaceTriangulation:true,receiverWet:edge.receiverWet,hydrologyEdgeReason:edge.hydrologyEdgeReason,storedWaterOvertopping:edge.storedWaterOvertopping===true};

    const root=new BABYLON.TransformNode(`cascade-root-${edge.id}`,this.scene);mesh.parent=root;
    const impact=Math.max(0,Number(edge.hydraulicPower||0)),impactScale=clamp(Math.sqrt(impact+.01),.32,1.45),impacts=[];
    for(const group of impactGroups){
      const count=Math.max(1,group.points.length),center=group.points.reduce((acc,point)=>({x:acc.x+point.x/count,y:acc.y+point.y/count,z:acc.z+point.z/count}),{x:0,y:0,z:0});
      const foam=BABYLON.MeshBuilder.CreateTorus(`cascade-foam-${edge.id}-${group.spanIndex}`,{diameter:TILE_SIZE*(.30+.22*impactScale),thickness:.026+.018*Math.min(1,impactScale),tessellation:20},this.scene);
      foam.material=this.foamMaterial;foam.alphaIndex=SURFACE_RENDER_ORDER.FOAM;foam.isPickable=false;foam.position.set(center.x,center.y+.020,center.z);foam.visibility=mesh.visibility;foam.parent=root;
      const ripples=[];
      for(let i=0;i<2;i++){
        const ripple=BABYLON.MeshBuilder.CreateTorus(`cascade-ripple-${i}-${edge.id}-${group.spanIndex}`,{diameter:TILE_SIZE*(.28+.12*i+.16*impactScale),thickness:.020,tessellation:18},this.scene);
        ripple.material=this.foamMaterial;ripple.alphaIndex=SURFACE_RENDER_ORDER.FOAM;ripple.isPickable=false;ripple.position.set(center.x+dir.dx*TILE_SIZE*.035,center.y+.012+i*.002,center.z+dir.dy*TILE_SIZE*.035);ripple.visibility=0;ripple.parent=root;ripples.push(ripple);
      }
      impacts.push({foam,ripples,center});
    }
    return{root,mesh,impacts,impactScale,geometryImpactScale:impactScale,foamWidthRatio:1,foamThicknessRatio:1,rippleWidthRatios:[1,1],baseVisibility:mesh.visibility,phase:(edge.tile.x*13+edge.tile.y*7)%17};
  }


  // Exact input dependency snapshots for the ONE VisualSurfaceResolver solve.
  // This is a presentation cache, not a copy of Hydrology's D/Q state.
  // Comparing published XYZ (rather than geometry registry revision alone)
  // avoids invalidating unrelated ponds when distant terrain is republished.
  publishedWaterGeometrySignature(geometry,kind){
    if(!geometry)return null;
    let signature=this.publishedWaterGeometrySignatures.get(geometry);
    if(signature===undefined){
      signature=kind==="CLIFF"
        ?JSON.stringify([geometry.lip,geometry.foot,geometry.segments,geometry.outward,geometry.drop])
        :JSON.stringify(geometry.triangles);
      this.publishedWaterGeometrySignatures.set(geometry,signature);
    }
    return signature;
  }

  surfaceTileInputs(state){
    const signatures=new Map();
    for(const tile of tilesOf(state)){
      const key=keyOf(tile.x,tile.y),node=this.sheetFlowNetwork.get(key);
      const edges=[...(node?.incoming||[]),...(node?.outgoing||[])]
        .map(edge=>[edge.id,edge.fromKey,edge.toKey,edge.q,edge.qKind,
          edge.cascade,edge.geometryJoinValid,edge.geometryJoin,
          edge.transportVolume,edge.measuredRate,edge.persistentRate])
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
      const geometry=this.surfaceResolver.getRenderedSurfaceGeometry(tile);
      // Native registered wall geometry is the only authority for cascade lip
      // and cliff contact; exclude global revision counters from signatures.
      const cliffs=DIRS.map(dir=>this.publishedWaterGeometrySignature(
        this.surfaceResolver.getRenderedCliffGeometry(tile,dir),"CLIFF"));
      signatures.set(key,JSON.stringify([
        tile.x,tile.y,tile.elevation,tile.waterDepth,tile.waterSurfaceZ,
        tile.flowSpeed,tile.flowX,tile.flowY,tile.river,
        tile.channelBankElevation,tile.hydrologyChannelWidthFraction,
        tile.hydrologySource,tile.hydrologySourceDisabled,tile.sourceKind,
        tile.hydrologyDrain,tile.hydrologySourceInflow,tile.fogged,
        this.publishedWaterGeometrySignature(geometry,"SURFACE"),cliffs,edges,
        // These exact render inputs influence colour, source waves, or authored
        // cliff/water transitions. Do not let a global signature change while
        // the local dirty dependency map incorrectly reports "unchanged".
        tile.waterTurbidity,tile.hydrologyRequestedSourceInflow,
        tile.discharge,tile.hydrologyCascadeToX,tile.hydrologyCascadeToY,
        tile.hydrologyCascadeDrop,tile.hydrologyEdgeOutflows
      ]));
    }
    return signatures;
  }

  // A world-space water sample can consult cardinal neighbours around a
  // shoreline point; Q/D handoff can sample that neighbour once more.
  // A two-cell Chebyshev halo therefore conservatively includes every source
  // input, even across an irregular cliff or wet/dry boundary.
  changedSurfaceTileKeys(next,{geometryOnly=false}={}){
    const changed=new Set(),previous=this.surfaceTileInputSignatures;
    // One exact snapshot dependency contract feeds two distinct consumers:
    // polygon clipping needs physical height/Q/terrain, while mesh attributes
    // also need flow direction, colour turbidity and visibility. Do not turn a
    // pure shader/visibility edit into a 25-tile waterline re-clipping job.
    // These are the indices in surfaceTileInputs(), NOT rounded simulations.
    const attributesOnly=new Set([6,7,16,20]);
    const affectsGeometry=(before,after)=>{
      if(before===after)return false;
      if(!geometryOnly||before===undefined)return true;
      const old=JSON.parse(before),current=JSON.parse(after);
      return old.some((value,i)=>!attributesOnly.has(i)&&
        JSON.stringify(value)!==JSON.stringify(current[i]));
    };
    const mark=key=>{
      const [x,y]=key.split(",").map(Number);
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      // Waterline sampling really depends on neighbours up to two cells out.
      // Keep that physical dependency, but only for true polygon inputs.
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)
        changed.add(keyOf(x+dx,y+dy));
    };
    for(const [key,signature] of next)
      if(affectsGeometry(previous.get(key),signature))mark(key);
    for(const key of previous.keys())if(!next.has(key))mark(key);
    return changed;
  }

  // The component can bypass polygon clipping, hydrology-source filtering,
  // cliff signature serialization and the indexed topology builder ONLY if
  // every tile in the conservative existing dependency halo is unchanged,
  // the exact member set is identical and all active spring fields are equal.
  // Do not substitute rounded water levels, smaller dirty halos or an inferred
  // "similar enough" region. The unchanged Mesh and animation remain the
  // authoritative published data until a genuinely affected component builds.
  surfaceComponentMembershipSignature(component){
    return component.tiles.map(tile=>keyOf(tile.x,tile.y)).sort().join("|");
  }

  canReuseUnchangedSurfaceComponent(component,dirtyKeys,sourcesChanged,mesh,animation,
    oldMembership,oldSignature,oldGeometrySignature,previousPresentation,presentation){
    if(sourcesChanged||!mesh||mesh.isDisposed?.()||!animation||
      oldSignature==null||oldGeometrySignature==null||
      oldMembership!==this.surfaceComponentMembershipSignature(component))return false;
    // The resolver is the single authoritative polygon publisher. An actual
    // publication change must win over our dependency prefilter even if an
    // upstream producer forgot to advertise a changed input.
    return !component.tiles.some(tile=>{
      const key=keyOf(tile.x,tile.y);
      return dirtyKeys.has(key)||
        previousPresentation?.get(key)?.polygons!==presentation?.get(key)?.polygons||
        previousPresentation?.get(key)?.stored!==presentation?.get(key)?.stored;
    });
  }

  // Change categories are derived from the EXACT signatures already used
  // by the incremental resolver. These counters are observations only, not
  // extra invalidation rules or a second water-surface calculation.
  surfaceInputChangeReasons(next){
    const prior=this.surfaceTileInputSignatures;
    const reasons={initial:0,addedOrRemoved:0,waterStorage:0,qNetwork:0,
      publishedTerrain:0,publishedCliffs:0,visibility:0,other:0};
    if(!this.surfaceSignature){reasons.initial=next.size;return reasons;}
    const compare=(a,b,indices)=>indices.some(i=>JSON.stringify(a[i])!==JSON.stringify(b[i]));
    const otherIndices=[0,1,2,9,10,11,12,13,14,15,20,21,22,23,24,25,26];
    for(const [key,signature] of next){
      const previous=prior.get(key);
      if(previous===undefined){reasons.addedOrRemoved++;continue;}
      if(previous===signature)continue;
      const a=JSON.parse(previous),b=JSON.parse(signature);
      let accounted=false;
      if(compare(a,b,[3,4])){reasons.waterStorage++;accounted=true;}
      if(compare(a,b,[5,6,7,8,19])){reasons.qNetwork++;accounted=true;}
      if(compare(a,b,[17])){reasons.publishedTerrain++;accounted=true;}
      if(compare(a,b,[18])){reasons.publishedCliffs++;accounted=true;}
      if(compare(a,b,[16])){reasons.visibility++;accounted=true;}
      if(compare(a,b,otherIndices)){reasons.other++;accounted=true;}
      if(!accounted)reasons.other++;
    }
    for(const key of prior.keys())if(!next.has(key))reasons.addedOrRemoved++;
    return reasons;
  }
  waterRebuildDiagnostics(){return this.surfaceRebuildDetail?{...this.surfaceRebuildDetail,
    inputReasons:{...this.surfaceRebuildDetail.inputReasons},meshReasons:{...this.surfaceRebuildDetail.meshReasons}}:null;}

  surfaceSignatureFor(components,state){
    const terrain=tilesOf(state).map(tile=>[
      keyOf(tile.x,tile.y),
      Number(tile.elevation||0).toFixed(4),
      waterDepth(tile).toFixed(4),
      hasAnyWater(tile)?visualSurface(tile).toFixed(4):"dry",
      Number(tile.flowX||0),Number(tile.flowY||0),Number(tile.flowSpeed||0).toFixed(3),
      Number(tile.waterTurbidity||0).toFixed(3),
      tile.hydrologySource===true&&tile.hydrologySourceDisabled!==true?1:0,
      Number(tile.hydrologySourceInflow||0).toFixed(4),
      tile.hydrologyCascadeToX??"n",tile.hydrologyCascadeToY??"n",Number(tile.hydrologyCascadeDrop||0).toFixed(3),
      ...["N","E","S","W"].map(dir=>{const f=tile.hydrologyEdgeOutflows?.[dir];return f?`${dir}>${f.toX},${f.toY}:${Number(f.rate||0).toFixed(3)}:${Number(f.cliffDrop||0).toFixed(3)}`:`${dir}-`; }),
      tile.fogged?1:0
    ].join(":" )).sort().join(",");
    const groups=components.map(component=>
      `${component.id}:${component.tiles.map(tile=>keyOf(tile.x,tile.y)).sort().join(",")}`
    ).sort().join("|");
    const qEdges=[...this.sheetFlowNetwork.values()].flatMap(node=>node.outgoing||[])
      .map(edge=>`${edge.id}:${Number(edge.q||0).toFixed(4)}:${edge.geometryJoinValid?1:0}:${edge.cascade?1:0}`)
      .sort().join("|");
    return`${Number(this.surfaceResolver.renderedSurfaceGeometryRevision||0)}:${Number(this.surfaceResolver.renderedCliffGeometryRevision||0)}:${groups}#${terrain}#Q:${qEdges}`;
  }

  // Only a source capable of influencing a real vertex in THIS published
  // water region belongs to that region's shader-input dependency. The radius
  // is exactly the one used by sourceFieldAt(); no new flow/visual threshold.
  // The bounding box is conservative (false positives are safe, false
  // negatives are not), and all polygons remain owned by the one resolver.
  componentHydrologySources(resolved,sources){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const item of resolved.tiles)for(const polygon of item.polygons)for(const point of polygon){
      const x=Number(point.x),z=Number(point.z);
      if(x<minX)minX=x;if(x>maxX)maxX=x;
      if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
    }
    if(minX===Infinity)return[];
    return sources.filter(source=>{
      const radius=TILE_SIZE*(.55+.18*Math.sqrt(Math.max(0,source.rate)));
      const dx=Math.max(minX-source.x,0,source.x-maxX);
      const dz=Math.max(minZ-source.z,0,source.z-maxZ);
      return dx*dx+dz*dz<radius*radius;
    });
  }

  surfaceMeshSignatureFor(component,presentation,sources,byKey,resolvedSurface=null){
    // Cache identity is the EXACT geometry AND shader inputs consumed by THIS
    // water region, not the global terrain/cliff registry revision. A registry
    // rebuild elsewhere does not change these polygons or local cliff seams.
    // Use the same filtered polygons that buildSurface() actually triangulates.
    const resolved=resolvedSurface||this.componentSurfacePolygons(component,presentation);
    // The previous whole-component JSON.stringify recursively serialized
    // every D/Q polygon and cliff lip on every weather sync, even when the
    // resolver reused their immutable arrays. Cache only the serialized form
    // of the EXISTING published polygons by identity. Length-prefixed fields
    // preserve exact content-based comparison without an alias-prone hash.
    const pack=parts=>parts.map(part=>`${part.length}:${part}`).join("");
    const tiles=resolved.tiles.map(({tile,key,polygons,motion})=>pack([
      JSON.stringify([key,hasAnyWater(tile),this.turbidity(tile),motion.x,motion.z,motion.speed]),
      pack(polygons.map(polygon=>this.cascadeGeometrySignature(polygon)))
    ]));
    const cliffs=this.componentCliffSeams(component,byKey).map(directions=>
      pack(directions.map(([lip,foot])=>pack([
        this.cascadeGeometrySignature(lip),this.cascadeGeometrySignature(foot)
      ]))));
    return pack([
      JSON.stringify([component.id,component.group,resolved.excludedSubmergedShoulders,
        resolved.clippedSubmergedShoulders,sources.map(source=>[source.x,source.z,source.rate])]),
      pack(tiles),pack(cliffs)
    ]);
  }

  // Exact, lossless signatures of immutable published geometry. The resolver
  // issues new polygon arrays when D/Q water changes; TerrainRenderer issues
  // new cliff geometry when its rock triangles change. Identity is a safe
  // reuse key for serializing an unchanged object, never the actual comparison
  // key: the resulting content string still determines the cache hit.
  cascadeGeometrySignature(value){
    if(value===null||value===undefined)return "null";
    if(typeof value!=="object")return JSON.stringify(value);
    let signature=this.cascadeGeometrySignatures.get(value);
    if(signature===undefined){
      signature=JSON.stringify(value);
      this.cascadeGeometrySignatures.set(value,signature);
    }
    return signature;
  }

  cascadeSignatureFor(edge){
    // The only dependencies are this cascade's actual hydraulic values,
    // registered rock face and the two published D/Q shorelines. Serialize
    // each immutable source once, even when many falls touch the same pool.
    const wall=this.surfaceResolver.getRenderedCliffGeometry(edge.tile,this.cascadeDirection(edge));
    const upstream=this.surfacePresentation.get(keyOf(edge.tile.x,edge.tile.y));
    const downstream=this.surfacePresentation.get(keyOf(edge.receiver.x,edge.receiver.y));
    // Flow speed, hydraulic power and transported volume are dynamic
    // presentation inputs; they do not change the rock-bound triangles.
    // For Q-only falls, transport cross-section DOES define the wet lip width,
    // so keep its exact discharge/volume as geometric dependencies.
    const transportOnly=!this.isRenderableWater(edge.tile);
    const physical=JSON.stringify([
      edge.top,edge.bottom,edge.drop,
      transportOnly?edge.transportVolume:null,
      transportOnly?edge.edgeDischarge:null,
      transportOnly?edge.flowVolume:null,
      edge.hydrologyEdgeReason,edge.storedWaterOvertopping,edge.receiverWet,
      hasAnyWater(edge.receiver)?visualSurface(edge.receiver):null
    ]);
    // Raw exact JSON fragments maintain the original null/array/object
    // comparison semantics, including the Q-only waterfall approach.
    const parts=[physical,
      this.cascadeGeometrySignature(upstream?.polygons??null),
      this.cascadeGeometrySignature(upstream?.cascadeLipSpans?.[edge.id]??null),
      this.cascadeGeometrySignature(downstream?.polygons??null),
      this.cascadeGeometrySignature(wall?.lip??null),
      this.cascadeGeometrySignature(wall?.foot??null),
      this.cascadeGeometrySignature(wall?.segments??null),
      this.cascadeGeometrySignature(wall?.outward??null)
    ];
    // Length-prefix keeps the complete comparison unambiguous even when
    // labels or future geometry fields contain punctuation.
    return parts.map(part=>`${part.length}:${part}`).join("");
  }


  // A runoff strip is built from one directed Hydrology edge, its exact
  // published D/Q end surfaces and its registered rock-face geometry. A distant
  // Q edge or water body is NOT an input to buildRunoff(). This conservative,
  // exact content signature allows unaffected runoff Meshes to survive regional
  // weather/hydrology updates. No independent water geometry is calculated.
  runoffMeshSignatureFor(edge){
    const fromKey=keyOf(edge.from.x,edge.from.y),toKey=keyOf(edge.to.x,edge.to.y);
    const dir={dx:Math.sign(edge.to.x-edge.from.x),dy:Math.sign(edge.to.y-edge.from.y)};
    const wall=edge.cascade?this.surfaceResolver.getRenderedCliffGeometry(edge.from,dir):null;
    const fromNode=this.sheetFlowNetwork.get(fromKey),toNode=this.sheetFlowNetwork.get(toKey);
    return JSON.stringify([
      edge.id,edge.rate,edge.persistentRate,edge.edgeDischarge,
      edge.transportVolume,edge.surfaceDrop,edge.flowPathStart,edge.flowPathRepeat,
      edge.reason,edge.cascade,edge.fromPooled,edge.toPooled,
      edge.fromStored,edge.toStored,edge.runoffSegments,
      this.surfaceTileInputSignatures.get(fromKey)??null,
      this.surfaceTileInputSignatures.get(toKey)??null,
      this.cascadeGeometrySignature(this.surfacePresentation.get(fromKey)?.polygons??null),
      this.cascadeGeometrySignature(this.surfacePresentation.get(fromKey)?.cascadeLipSpans?.[edge.id]??null),
      this.cascadeGeometrySignature(this.surfacePresentation.get(toKey)?.polygons??null),
      wall?[
        this.publishedWaterGeometrySignature(wall,"CLIFF"),
        wall.revision??null
      ]:null,
      fromNode?.qIn,fromNode?.qOut,fromNode?.sourceRate,
      toNode?.qIn,toNode?.qOut,
      // buildRunoff() samples local fog and keeps these visibilities per Mesh.
      edge.from.fogged,edge.to.fogged
    ]);
  }

  sync(state,presentationEvents=[]){
    const signatureStart=performance.now();
    const input=waterVisualInputSignature(state,this.surfaceResolver);
    const signatureElapsed=performance.now()-signatureStart;
    this.visualInputAudit.keyBuildMs=Math.round(signatureElapsed*100)/100;
    this.visualInputAudit.keyLength=input.length;
    // The only presentation event consumed by WaterRenderer.sync() is
    // ROGUE_WAVE; all other events are owned by other presentation systems.
    const waveEvent=(presentationEvents||[]).some(event=>
      String(event?.type||"").toUpperCase()==="ROGUE_WAVE");
    const currentRevision=Number(state?.revision??0);
    const reset=this.lastWaterVisualRevision!=null&&
      currentRevision<this.lastWaterVisualRevision;
    // A new battle is an entirely new publication authority, even if its
    // canonical component IDs and X/Z positions happen to match prior play.
    if(reset){this.surfaceTopologyLayouts.clear();this.surfaceRebuildHistory.length=0;}
    this.lastWaterVisualRevision=currentRevision;
    if(!reset&&!waveEvent&&input===this.lastWaterVisualInput){
      this.visualInputAudit.identicalInputsSkipped++;
      return;
    }
    this.visualInputAudit.syncs++;
    // A sync consumes one BattlePresentation snapshot. Never carry cached water
    // heights into the next snapshot, even if a tile retains the same ID.
    this.levelSamples=new Map();
    this.waterEdgeContinuity=new Map();
    this.waterEdgeContinuityStats={hits:0,misses:0};
    this.surfaceResolver.beginPublishedSurfaceSampling();
    const flowStart=performance.now();
    this.setWind(state?.presentation?.environment?.wind||state?.environment?.wind||state?.wind||null);
    const waterTiles=this.waterTiles(state);
    const oldNetwork=this.sheetFlowNetwork;
    const runoffs=this.runoffEdges(state);
    const cascades=this.cascadeEdges(state,waterTiles);
    const sources=this.activeHydrologySources(state);
    globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.flowInventory",performance.now()-flowStart);
    // This signature uses the true D/Q inputs, not the generated polygons.
    // Terrain and Q change on turns, not on every animation frame.
    // A spring may inherit its rate from discharge, rather than explicit
    // hydrologySourceInflow. That exact shader input is part of the revision
    // contract even when the D/Q surface happens to remain unchanged.
    const activeSourceSignature=JSON.stringify(sources.map(source=>
      [source.x,source.z,source.rate]));
    const surfaceSignature=this.surfaceSignatureFor([],state)+"#sources:"+activeSourceSignature;
    const surfaceChanged=surfaceSignature!==this.surfaceSignature;
    if(surfaceChanged){
      this.seamAuditRevision++;
      this.seamAuditCache=null;
      const tiles=tilesOf(state),allMap=this.allByKey(state);
      const solveStart=performance.now();
      const nextTileInputs=this.surfaceTileInputs(state);
      const inputReasons=this.surfaceInputChangeReasons(nextTileInputs);
      const previousPresentation=this.surfacePresentation;
      // The cache is valid only inside one continuously tracked presentation.
      // A reset/cleared scene must perform a complete first solve.
      const dirtyKeys=this.surfaceSignature
        ?this.changedSurfaceTileKeys(nextTileInputs):new Set(tiles.map(tile=>keyOf(tile.x,tile.y)));
      // The resolver only re-clips a polygon when real wet-footprint inputs
      // changed; flow directions, fog and turbidity update the existing mesh.
      const polygonDirtyKeys=this.surfaceSignature
        ?this.changedSurfaceTileKeys(nextTileInputs,{geometryOnly:true}):dirtyKeys;
      const presentation=this.surfaceResolver.presentationWaterSurfaces(tiles,this.sheetFlowNetwork,
        (tile,x,z)=>this.waterLevelAtWorld(tile,x,z,allMap),
        {previous:previousPresentation,dirtyKeys:polygonDirtyKeys,previousNetwork:oldNetwork});
      const resolvedTiles=tiles.filter(tile=>dirtyKeys.has(keyOf(tile.x,tile.y))).length;
      const polygonResolvedTiles=tiles.filter(tile=>polygonDirtyKeys.has(keyOf(tile.x,tile.y))).length;
      this.surfaceSolveStats={totalTiles:tiles.length,resolvedTiles,
        polygonResolvedTiles,reusedTiles:tiles.length-resolvedTiles,
        polygonReusedTiles:tiles.length-polygonResolvedTiles};
      const meshReasons={newComponent:0,changedGeometryOrShader:0,reused:0,disposed:0};
      this.surfaceTileInputSignatures=nextTileInputs;
      this.surfacePresentation=presentation;
      globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.surfaceSolve",performance.now()-solveStart);
      const buildStart=performance.now();
      const components=this.presentationComponents(presentation);
      // The sheet-flow map is consulted only for presence of authored Q-only
      // surfaces (spring outlet ownership and batch aliases). Preserve the
      // canonical VisualSurfaceResolver's records by identity: duplicating
      // every published polygon and vertex each rainy turn is unnecessary and
      // creates GC pressure precisely when water geometry is being rebuilt.
      this.sheetFlowSurfaces=new Map([...presentation].filter(([,entry])=>!entry.stored));
      const previousMeshes=this.surfaceMeshes;
      const previousAnimations=this.surfaceAnimations;
      const previousSignatures=this.surfaceMeshSignatures;
      const previousGeometrySignatures=this.surfaceGeometrySignatures;
      const previousMembership=this.surfaceComponentMembership;
      const previousComponentSources=this.surfaceComponentSourceSignatures;
      const previousComponentGeometryVersions=this.surfaceComponentGeometryVersions;
      const previousPolygonTriangulations=this.surfacePolygonTriangulations;
      const sourcesChanged=this.publishedSurfaceSourcesSignature!==activeSourceSignature;
      const clipReuse={dirtyKeys:polygonDirtyKeys,previous:this.surfaceTileOwnedPolygons,next:new Map(),
        metrics:{tilesClippingReused:0,tilesClippingRecomputed:0}};
      // Tile clipping and vertex samples share one immutable owner record and
      // one invalidation lifecycle: no layered or competing tile caches.
      const vertexReuse={dirtyKeys,previous:clipReuse.previous,next:clipReuse.next,
        metrics:{tilesReused:0,tilesEvaluated:0,verticesReused:0,verticesEvaluated:0,elapsedMs:0}};
      // Compare the resolved, exact D/Q polygons before touching any GPU mesh.
      // Free all obsolete buffers before allocating replacements, so heavy
      // floods do not temporarily double WebGL memory during an update.
      const signatureStart=performance.now();
      let unchangedComponentsSkipped=0,unrelatedSourceUpdatesSkipped=0;
      const sourceKey=items=>JSON.stringify(items.map(source=>[source.x,source.z,source.rate]));
      const planned=components.map(component=>{
        const mesh=previousMeshes.get(component.id);
        const valid=!!mesh&&!mesh.isDisposed?.();
        const previousSignature=previousSignatures.get(component.id);
        const previousGeometrySignature=previousGeometrySignatures.get(component.id);
        // The previous published owned polygons provide a conservative exact
        // spatial bound. A changed spring outside the bound cannot contribute
        // to this component's shader inputs; no new geometry is inferred.
        let localSourceSignature=previousComponentSources.get(component.id);
        let relevantSourcesChanged=sourcesChanged;
        if(sourcesChanged&&valid&&component.tiles.every(tile=>
          clipReuse.previous.get(keyOf(tile.x,tile.y))?.componentId===component.id)){
          const owned={tiles:component.tiles.map(tile=>({
            polygons:clipReuse.previous.get(keyOf(tile.x,tile.y)).owned}))};
          localSourceSignature=sourceKey(this.componentHydrologySources(owned,sources));
          relevantSourcesChanged=localSourceSignature!==previousComponentSources.get(component.id);
        }
        const unchanged=this.canReuseUnchangedSurfaceComponent(
          component,dirtyKeys,relevantSourcesChanged,valid?mesh:null,
          previousAnimations.get(component.id),previousMembership.get(component.id),
          previousSignature,previousGeometrySignature,previousPresentation,presentation);
        if(unchanged){
          unchangedComponentsSkipped++;
          if(sourcesChanged&&!relevantSourcesChanged)unrelatedSourceUpdatesSkipped++;
          for(const tile of component.tiles){
            const key=keyOf(tile.x,tile.y),record=clipReuse.previous.get(key);
            if(record?.componentId===component.id&&record.source===presentation.get(key)?.polygons)
              clipReuse.next.set(key,record);
          }
          return{component,resolved:null,signature:previousSignature,
            geometrySignature:previousGeometrySignature,localSourceSignature,mesh,reuse:true};
        }
        const resolved=this.componentSurfacePolygons(component,presentation,clipReuse);
        const localSources=this.componentHydrologySources(resolved,sources);
        const signature=this.surfaceMeshSignatureFor(component,presentation,localSources,allMap,resolved);
        const geometrySignature=this.surfaceGeometrySignatureFor(component,resolved);
        localSourceSignature=sourceKey(localSources);
        const reuse=valid&&previousSignature===signature;
        return{component:{...component,sources:localSources},resolved,signature,geometrySignature,
          localSourceSignature,mesh:valid?mesh:null,reuse};
      });
      globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.componentSignatures",performance.now()-signatureStart);
      const retained=new Set(planned.filter(item=>item.reuse).map(item=>item.component.id));
      this.surfaceMeshUpdate={reused:retained.size,attributesUpdated:0,verticesUpdated:0,
        topologyIndicesUpdated:0,topologyBuffersReallocated:0,built:0,disposed:0,
        colorUploads:0,attributeUploads:0,indexUploads:0,
        vertexBufferUploads:0,vertexBufferUploadBytes:0,estimatedUploadBytes:0};
      meshReasons.reused=retained.size;
      this.surfaceMeshes=new Map();
      this.surfaceAnimations=new Map();
      this.surfaceMeshSignatures=new Map();
      this.surfaceGeometrySignatures=new Map();
      this.surfaceComponentMembership=new Map();
      this.surfaceComponentSourceSignatures=new Map();
      this.surfaceComponentGeometryVersions=new Map();
      this.surfacePolygonTriangulations=new Map();
      this.surfaceTriangulationStats={reusedFaces:0,recomputedFaces:0,
        topologyVerifiedFacesReused:0,elapsedMs:0,exactLayoutHits:0,exactLayoutMisses:0};
      this.surfaceTileOwnedPolygons=clipReuse.next;
      this.sheetFlowMeshes.clear(); // Aliases only: never dispose twice.
      this.resetWaterSeamRegistry();
      // Register unchanged canonical resting vertices before rebuilding any
      // neighbouring component, preserving the existing cross-component seams.
      for(const {component,mesh,geometrySignature} of planned){
        // Never register obsolete vertices from a changed shoreline/height;
        // only actual same-geometry regions may author retained seam points.
        if(!mesh||previousGeometrySignatures.get(component.id)!==geometrySignature)continue;
        const positions=previousAnimations.get(component.id)?.basePositions;
        if(!positions)continue;
        for(let i=0;i<positions.length;i+=3)
          this.canonicalWaterPoint({x:positions[i],y:positions[i+1],z:positions[i+2]});
      }
      let geometryChanged=false;
      for(const item of planned){
        const {component,resolved,signature,geometrySignature}=item;
        const previous=item.mesh,animation=previousAnimations.get(component.id);
        const matchingGeometry=previous&&animation&&
          previousGeometrySignatures.get(component.id)===geometrySignature;
        let mesh=null,keepPreviousAnimation=false,builtGeometry=false;
        if(item.reuse){mesh=previous;keepPreviousAnimation=true;}
        else if(matchingGeometry&&this.refreshSurfaceAttributes(component,resolved,state,previous,animation,allMap,vertexReuse)){
          mesh=previous;keepPreviousAnimation=true;
          this.surfaceMeshUpdate.attributesUpdated++;
          meshReasons.reused++;
        }else{
          mesh=this.buildSurface(component,state,presentation,resolved,allMap,previous,
            previousPolygonTriangulations.get(component.id),vertexReuse);
          builtGeometry=true;
          geometryChanged ||= mesh?.metadata?.geometryCommitChange!==false;
          if(mesh===previous&&previous){
            if(mesh.metadata?.incrementalVertexUpdate)
              this.surfaceMeshUpdate.verticesUpdated++;
          }else{
            if(mesh)this.surfaceMeshUpdate.built++;
            if(previous){meshReasons.disposed++;this.surfaceMeshUpdate.disposed++;}
          }
          if(previous)meshReasons.changedGeometryOrShader++;
          else meshReasons.newComponent++;
        }
        if(!mesh)continue;
        if(keepPreviousAnimation){
          const oldFaces=previousPolygonTriangulations.get(component.id);
          if(oldFaces)this.surfacePolygonTriangulations.set(component.id,oldFaces);
        }
        this.surfaceMeshes.set(component.id,mesh);
        this.surfaceMeshSignatures.set(component.id,signature);
        this.surfaceGeometrySignatures.set(component.id,geometrySignature);
        this.surfaceComponentMembership.set(component.id,
          this.surfaceComponentMembershipSignature(component));
        this.surfaceComponentSourceSignatures.set(component.id,item.localSourceSignature);
        const componentGeometryChanged=!previous||
          (builtGeometry&&mesh.metadata?.geometryCommitChange!==false);
        const retainedVersion=previousComponentGeometryVersions.get(component.id);
        this.surfaceComponentGeometryVersions.set(component.id,
          componentGeometryChanged||retainedVersion==null
            ?++this.componentGeometryVersionSerial:retainedVersion);
        if(keepPreviousAnimation&&animation)this.surfaceAnimations.set(component.id,animation);
        for(const tile of component.tiles){
          const key=keyOf(tile.x,tile.y);
          if(this.sheetFlowSurfaces.has(key))this.sheetFlowMeshes.set(key,mesh);
        }
      }
      for(const [id,mesh] of previousMeshes)if(!this.surfaceMeshes.has(id)){
        mesh.dispose();meshReasons.disposed++;this.surfaceMeshUpdate.disposed++;
        geometryChanged=true;
      }
      // Prune the exact topology of removed components as soon as their
      // Babylon mesh owner is disposed. Unchanged components retain identity.
      for(const id of this.surfaceTopologyLayouts.keys())
        if(!this.surfaceMeshes.has(id))this.surfaceTopologyLayouts.delete(id);
      if(geometryChanged)this.publishedWaterGeometryRevision++;
      // Share the exact, *final* Babylon mesh triangles (including water
      // canonical seam welding and conforming edge subdivisions). A frozen
      // surface cannot invent a second triangulation or shoreline.
      const iceSources=new Map();
      for(const [id,mesh] of this.surfaceMeshes){
        const positions=this.surfaceAnimations.get(id)?.basePositions;
        const indices=mesh.getIndices?.();
        if(!positions||!indices)continue;
        for(const [key,range] of mesh.metadata?.tileIndexRanges||[])
          iceSources.set(key,{positions,indices,range,
            geometryVersion:this.surfaceComponentGeometryVersions.get(id)});
      }
      this.publishedWaterTileTriangles=iceSources;
      this.surfaceSignature=surfaceSignature;
      this.publishedSurfaceSourcesSignature=activeSourceSignature;
      this.surfaceRebuildDetail={revision:this.seamAuditRevision,at:new Date().toISOString(),
        totalTiles:tiles.length,dirtyTiles:resolvedTiles,reusedTileResults:tiles.length-resolvedTiles,
        polygonDirtyTiles:polygonResolvedTiles,polygonReusedTiles:tiles.length-polygonResolvedTiles,
        publishedWaterTiles:presentation.size,inputReasons,meshReasons,
        unchangedComponentsSkipped,componentsInspected:components.length-unchangedComponentsSkipped,
        unrelatedSourceUpdatesSkipped,
        ...clipReuse.metrics,
        vertexTilesReused:vertexReuse.metrics.tilesReused,
        vertexTilesEvaluated:vertexReuse.metrics.tilesEvaluated,
        vertexSamplesReused:vertexReuse.metrics.verticesReused,
        vertexSamplesEvaluated:vertexReuse.metrics.verticesEvaluated,
        vertexSampleCacheMs:Number(vertexReuse.metrics.elapsedMs.toFixed(2)),
        triangulationFacesReused:this.surfaceTriangulationStats.reusedFaces,
        topologyVerifiedFacesReused:this.surfaceTriangulationStats.topologyVerifiedFacesReused,
        triangulationFacesRecomputed:this.surfaceTriangulationStats.recomputedFaces,
        triangulationMs:Number(this.surfaceTriangulationStats.elapsedMs.toFixed(2)),
        exactTopologyLayoutHits:this.surfaceTriangulationStats.exactLayoutHits,
        exactTopologyLayoutMisses:this.surfaceTriangulationStats.exactLayoutMisses,
        surfaceSolveMs:Number((buildStart-solveStart).toFixed(2)),
        meshBuildMs:Number((performance.now()-buildStart).toFixed(2))};
      // The renderer's one commit pipeline can now match expensive water
      // rebuilds to a game revision without reading an unrelated later state.
      // Retain a bounded read-only history, not a second simulation cache.
      this.surfaceRebuildHistory.push({gameRevision:state?.revision??null,
        round:state?.round??null,...this.surfaceRebuildDetail});
      if(this.surfaceRebuildHistory.length>32)this.surfaceRebuildHistory.shift();
      globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.surfaceMeshes",performance.now()-buildStart);
    }else this.sheetFlowNetwork=oldNetwork;
    // WaterRenderer owns wave motion for liquid AND frozen water. Climate
    // changes must not leave animated liquid vertices protruding through ice.
    this.syncFrozenSurfaceWaves(state);
    this.syncRogueWaveEvents(presentationEvents,state);
    this.syncWhirlpools(state);
    for(const entry of this.surfaceAnimations.values()){
      if(!entry?.mesh?.metadata)continue;
      entry.mesh.metadata.windWaveStrength=this.wind.strength;
      entry.mesh.metadata.windWaveDirection=this.wind.strength>EPSILON?{x:this.wind.x,z:this.wind.z}:null;
    }

    const cascadeStart=performance.now();
    const previousCascades=this.cascades,previousCascadeSignatures=this.cascadeMeshSignatures;
    const cascadeSignatureStart=performance.now();
    const cascadePlans=cascades.map(edge=>({edge,signature:this.cascadeSignatureFor(edge)}));
    globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.cascadeSignatures",performance.now()-cascadeSignatureStart);
    const unchangedCascades=new Set(cascadePlans
      .filter(({edge,signature})=>previousCascadeSignatures.get(edge.id)===signature)
      .map(({edge})=>edge.id));
    const retainedCascades=new Set([...unchangedCascades]
      .filter(id=>previousCascades.has(id)));
    this.cascadeMeshUpdate={reused:retainedCascades.size,built:0,disposed:0};
    for(const [id,entry] of previousCascades){
      if(retainedCascades.has(id))continue;
      entry.root.dispose();
      this.cascadeMeshUpdate.disposed++;
    }
    // Keep the original Babylon mesh/foam animation for unaffected cliff
    // edges. Register their precise water vertices before newly built edges
    // consume the shared seam registry.
    this.cascades=new Map();
    this.cascadeMeshSignatures=new Map();
    for(const {edge,signature} of cascadePlans){
      this.cascadeMeshSignatures.set(edge.id,signature);
      const retained=retainedCascades.has(edge.id)?previousCascades.get(edge.id):null;
      if(!retained)continue;
      this.cascades.set(edge.id,retained);
      // Visibility changes are presentation-only: they do not alter waterfall
      // triangles, foam topology or wave input. Preserve the Babylon buffers.
      const visibility=edge.tile.fogged?.16:1;
      retained.baseVisibility=visibility;
      retained.mesh.visibility=visibility;
      // Refresh all flow-only properties without rebuilding either the cliff
      // surface or its foam/ripple meshes. Animation uses impactScale below.
      retained.impactScale=clamp(Math.sqrt(Math.max(0,Number(edge.hydraulicPower||0))+.01),.32,1.45);
      const original=Math.max(.32,Number(retained.geometryImpactScale||retained.impactScale));
      retained.foamWidthRatio=(.30+.22*retained.impactScale)/(.30+.22*original);
      retained.foamThicknessRatio=(.026+.018*Math.min(1,retained.impactScale))/(.026+.018*Math.min(1,original));
      retained.rippleWidthRatios=[0,1].map(i=>(.28+.12*i+.16*retained.impactScale)/(.28+.12*i+.16*original));
      Object.assign(retained.mesh.metadata,{
        drop:edge.drop,flowSpeed:edge.speed,flowVolume:edge.flowVolume,
        transportVolume:edge.transportVolume,edgeDischarge:edge.edgeDischarge,
        hydraulicPower:edge.hydraulicPower,hydrologyEdgeReason:edge.hydrologyEdgeReason,
        storedWaterOvertopping:edge.storedWaterOvertopping===true,
        receiverWet:edge.receiverWet
      });
      for(const group of retained.impacts||[])group.foam.visibility=visibility;
      if(surfaceChanged){
        const positions=retained.mesh?.getVerticesData?.(BABYLON.VertexBuffer.PositionKind)||[];
        for(let i=0;i<positions.length;i+=3)
          this.canonicalWaterPoint({x:positions[i],y:positions[i+1],z:positions[i+2]});
      }
    }
    const cascadeBuildStart=performance.now();
    for(const {edge} of cascadePlans){
      // Unchanged edges without a mesh were already determined to have no
      // exposed wet rock face. Retry them when their local geometry changes.
      if(unchangedCascades.has(edge.id))continue;
      const built=this.buildCascade(edge,state);
      if(built){this.cascades.set(edge.id,built);this.cascadeMeshUpdate.built++;}
    }
    globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.cascadeMeshes",performance.now()-cascadeBuildStart);
    globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.cascades",performance.now()-cascadeStart);
    const runoffStart=performance.now();
    const priorRunoffs=this.runoffs,priorRunoffSignatures=this.runoffMeshSignatures;
    // Q-only sheets already belong to the shared surface Mesh. Only cliff
    // junctions with actual runoff segments can own dedicated geometry.
    const runoffPlans=runoffs.filter(edge=>(edge.runoffSegments||[])
      .some(segment=>Number(segment.end)-Number(segment.start)>EPSILON))
      .map(edge=>({edge,signature:this.runoffMeshSignatureFor(edge)}));
    const runoffIds=new Set(runoffPlans.map(plan=>plan.edge.id));
    this.runoffs=new Map();
    this.runoffMeshSignatures=new Map();
    this.runoffMeshUpdate={reused:0,built:0,disposed:0};
    for(const {edge,signature} of runoffPlans){
      this.runoffMeshSignatures.set(edge.id,signature);
      const old=priorRunoffs.get(edge.id);
      if(priorRunoffSignatures.get(edge.id)===signature&&(!old||!old.isDisposed?.())){
        if(old){
          this.runoffs.set(edge.id,old);
          this.runoffMeshUpdate.reused++;
        }
        // A dry/zero-area junction with unchanged inputs remains without a
        // drawable Mesh; do not repeat its geometry clipping every sync.
        continue;
      }
      if(old){old.dispose();this.runoffMeshUpdate.disposed++;}
      const built=this.buildRunoff(edge,state);
      if(built){this.runoffs.set(edge.id,built);this.runoffMeshUpdate.built++;}
    }
    for(const [id,mesh] of priorRunoffs)if(!runoffIds.has(id)){
      mesh.dispose();this.runoffMeshUpdate.disposed++;
    }
    globalThis.CardTacticsDiagnostics?.recordPerf?.("waterSync.runoffs",performance.now()-runoffStart);
    if(this.sourceFootprints.size)this.disposeMap(this.sourceFootprints);
    this.sourceSignature=this.sourceFootprintSignatureFor(sources,runoffs);

    if(!this.surfaceMeshes.size&&!runoffs.length&&!sources.length){
      this.disposeMap(this.cascades);this.disposeMap(this.runoffs);
      this.sheetFlowSurfaces.clear();this.sheetFlowMeshes.clear();
      this.surfacePresentation.clear();
      this.publishedWaterTileTriangles.clear();
      this.resetWaterSeamRegistry();
      this.seamAuditRevision++;this.seamAuditCache=null;
      this.surfaceSignature=this.sourceSignature="";
      this.runoffMeshSignatures.clear();
      this.runoffMeshUpdate={reused:0,built:0,disposed:0};
      this.surfaceTileInputSignatures.clear();
      this.surfaceSolveStats={totalTiles:0,resolvedTiles:0,reusedTiles:0};
      this.surfaceRebuildDetail=null;
      this.cascadeMeshSignatures.clear();
      this.cascadeMeshUpdate={reused:0,built:0,disposed:0};
      this.surfaceMeshSignatures.clear();
      this.surfaceGeometrySignatures.clear();
      this.surfaceComponentMembership.clear();
      this.surfaceComponentSourceSignatures.clear();
      this.surfaceComponentGeometryVersions.clear();
      this.surfaceTileOwnedPolygons.clear();
      this.surfacePolygonTriangulations.clear();
      this.surfaceTopologyLayouts.clear();
        this.publishedSurfaceSourcesSignature=null;
        this.publishedWaterGeometryRevision++;
        this.surfaceMeshUpdate={reused:0,attributesUpdated:0,verticesUpdated:0,
          topologyIndicesUpdated:0,topologyBuffersReallocated:0,built:0,disposed:0,
          colorUploads:0,attributeUploads:0,indexUploads:0,
          vertexBufferUploads:0,vertexBufferUploadBytes:0,estimatedUploadBytes:0};
    }
    this.levelSamples=null;
    // Commit only after the entire official sync has completed successfully.
    this.lastWaterVisualInput=input;
  }

  // Diagnostic-only audit of the PRESENTED water mesh, not a second water
  // topology builder. Uses the actual index buffers and the same rest positions
  // and motion attributes supplied to the GPU/CPU surface animator.
  // Coastline edges are legitimate: an open boundary alone is NOT a crack.
  // Read-only audit: published D/Q polygons are the expected wet footprint,
  // and the same Surface Mesh triangles are the actual visible footprint.
  // A boundary beyond the wet polygon is a legitimate shoreline; an unmatched
  // edge whose exterior still belongs to wet polygons is a stitching candidate.
  auditInternalWaterBoundaries(edgeKeys,meshAttributes,addIssue){
    const bins=new Map(),actualBins=new Map(),binSize=TILE_SIZE;
    const binId=(x,z)=>`${x},${z}`;
    const place=(table,item,minX,maxX,minZ,maxZ)=>{
      for(let x=Math.floor(minX/binSize);x<=Math.floor(maxX/binSize);x++)
        for(let z=Math.floor(minZ/binSize);z<=Math.floor(maxZ/binSize);z++){
          const id=binId(x,z),bucket=table.get(id)||[];
          bucket.push(item);table.set(id,bucket);
        }
    };
    const insideTriangle=(x,z,a,b,c)=>{
      const dx=b.x-a.x,dz=b.z-a.z,ex=c.x-a.x,ez=c.z-a.z;
      const det=dx*ez-dz*ex;if(Math.abs(det)<1e-12)return false;
      const rx=x-a.x,rz=z-a.z,u=(rx*ez-rz*ex)/det,v=(dx*rz-dz*rx)/det;
      return u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7;
    };
    const insidePolygon=(x,z,p)=>{
      let inside=false;
      for(let i=0,j=p.length-1;i<p.length;j=i++){
        const a=p[i],b=p[j];
        if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
      }
      return inside;
    };
    for(const item of this.surfacePresentation?.values?.()||[]){
      for(const polygon of item.polygons||[]){
        if(polygon.length<3)continue;
        const xs=polygon.map(v=>v.x),zs=polygon.map(v=>v.z);
        place(bins,polygon,Math.min(...xs),Math.max(...xs),Math.min(...zs),Math.max(...zs));
      }
    }
    for(const [id,{positions,mesh}] of meshAttributes){
      const ids=mesh.getIndices?.()||[];
      for(let i=0;i+2<ids.length;i+=3){
        const tri=[ids[i],ids[i+1],ids[i+2]].map(index=>({
          x:positions[index*3],z:positions[index*3+2]}));
        if(tri.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))continue;
        place(actualBins,tri,Math.min(...tri.map(v=>v.x)),Math.max(...tri.map(v=>v.x)),
          Math.min(...tri.map(v=>v.z)),Math.max(...tri.map(v=>v.z)));
      }
    }
    const covered=(table,x,z,triangle=false)=>{
      const options=table.get(binId(Math.floor(x/binSize),Math.floor(z/binSize)))||[];
      for(const p of options){
        if(triangle?insideTriangle(x,z,p[0],p[1],p[2]):insidePolygon(x,z,p))return true;
      }
      return false;
    };
    const result={expectedWetPolygons:[...this.surfacePresentation.values()].reduce((a,b)=>a+(b.polygons?.length||0),0),
      shorelineEdges:0,internalMissingSurfaceEdges:0,internalUnweldedEdges:0,
      testedOpenEdges:0,unknownBoundaryEdges:0,locations:[]};
    for(const list of edgeKeys.values()){
      if(list.length!==1)continue;
      const edge=list[0],positions=meshAttributes.get(edge.id)?.positions;
      if(!positions||edge.third==null){result.unknownBoundaryEdges++;continue;}
      const a=edge.vertex1*3,b=edge.vertex2*3,c=edge.third*3;
      const ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2];
      const cx=positions[c],cz=positions[c+2],dx=bx-ax,dz=bz-az;
      const len=Math.hypot(dx,dz);
      if(len<=1e-7){result.unknownBoundaryEdges++;continue;}
      // Offset away from the only triangle bordering this open edge.
      const side=Math.sign(dx*(cz-az)-dz*(cx-ax));
      if(!side){result.unknownBoundaryEdges++;continue;}
      const gap=Math.min(TILE_SIZE*.015,len*.08),mx=(ax+bx)*.5,mz=(az+bz)*.5;
      const sx=mx+side*dz/len*gap,sz=mz-side*dx/len*gap;
      result.testedOpenEdges++;
      if(!covered(bins,sx,sz)){
        result.shorelineEdges++;
        continue;
      }
      if(covered(actualBins,sx,sz,true)){
        result.internalUnweldedEdges++;
        const location={kind:"UNWELDED_WET_BOUNDARY",mesh:edge.id,
          x:Number(mx.toFixed(5)),z:Number(mz.toFixed(5))};
        if(result.locations.length<24)result.locations.push(location);
        addIssue(location.kind,[mx,positions[a+1],mz],
          {mesh:edge.id,expectedWet:true,actualWet:true,sample:[Number(sx.toFixed(5)),Number(sz.toFixed(5))]});
      }else{
        result.internalMissingSurfaceEdges++;
        const location={kind:"MISSING_WET_SURFACE_TRIANGLE",mesh:edge.id,
          x:Number(mx.toFixed(5)),z:Number(mz.toFixed(5))};
        if(result.locations.length<24)result.locations.push(location);
        addIssue(location.kind,[mx,positions[a+1],mz],
          {mesh:edge.id,expectedWet:true,actualWet:false,sample:[Number(sx.toFixed(5)),Number(sz.toFixed(5))]});
      }
    }
    return result;
  }

  // Mirror of the existing waterAmbientWave vertex shader, solely for manual
  // diagnostics. Never writes Mesh/State; it cannot read the final GPU pixels.
  diagnosticWaveHeight(entry,i,time,windVisual){
    if(entry?.specialActive)return null;
    const x=Number(entry.basePositions[i*3]),z=Number(entry.basePositions[i*3+2]);
    const fx=Number(entry.flowX?.[i]||0),fz=Number(entry.flowZ?.[i]||0);
    const speed=clamp(Number(entry.flowSpeeds?.[i]||0),0,3.2);
    const weight=Number(entry.waveWeights?.[i]||0);
    const source=Number(entry.sourceWeights?.[i]||0),sourcePhase=Number(entry.sourcePhases?.[i]||0);
    const raw=clamp(this.wind?.strength||0,0,8),visual=clamp(windVisual,0,8);
    let wave=0;
    const fl=Math.hypot(fx,fz);
    if(speed>.001&&fl>.001){
      const a=fx/fl,b=fz/fl,perpX=-b,perpZ=a,flowUnit=smooth01(speed/3.2);
      const amp=ELEVATION_HEIGHT*(.014+.026*flowUnit);
      const k=(3+speed*1.25)/TILE_SIZE,crossK=(4.3+speed*.85)/TILE_SIZE;
      const rate=.82+speed*.96;
      const p1=(x*a+z*b)*k-time*rate*2.8;
      const p2=(x*perpX+z*perpZ)*crossK-time*rate*1.12;
      wave+=amp*(Math.sin(p1)+.28*Math.sin(p2));
    }else if(raw<=.001){
      const p1=(x*.78+z*.42)*(2/TILE_SIZE)-time*.46;
      const p2=(x*.31-z*.86)*(2.6/TILE_SIZE)+time*.31;
      wave+=ELEVATION_HEIGHT*.009*(Math.sin(p1)+.42*Math.sin(p2));
    }
    if(raw>.001){
      const windX=Number(this.wind?.x||0),windZ=Number(this.wind?.z||0);
      const len=Math.hypot(windX,windZ),a=len>.001?windX/len:windX,b=len>.001?windZ/len:windZ;
      const presence=smooth01(raw/.8);
      const amp=ELEVATION_HEIGHT*Math.min(.24,.010*presence+.012*visual+.0036*visual*visual);
      const k=(2.15+visual*.72)/TILE_SIZE,rate=.75+visual*.82;
      const p1=(x*a+z*b)*k-time*rate*2.35;
      const p2=(x*-b+z*a)*(k*1.42)+time*rate*.72;
      wave+=amp*(Math.sin(p1)+.36*Math.sin(p2));
    }
    return Number(entry.basePositions[i*3+1])+wave*weight+
      ELEVATION_HEIGHT*.034*source*(.58+.42*Math.sin(time*4.4-sourcePhase*Math.PI*2));
  }

  // Compare diagnostically displaced GPU-wave vertices interpolated over the
  // existing water triangles against published TERRAIN triangles. Manual only:
  // sampled shader-equation mirror, never GPU readback or a new mesh solver.
  waveTerrainDiagnostics(){
    const started=performance.now(),t=this.waveTime;
    const windVisual=globalThis.EnvironmentEngine?.windVisualStrength?.(
      clamp(this.wind?.strength||0,0,8))??clamp(this.wind?.strength||0,0,8);
    const times=[t,t+.2,t+.4,t+.6];
    const points=[],result={mode:"READ_ONLY_SHADER_EQUATION_MIRROR_NOT_GPU_READBACK",
      sampleTimes:times.map(v=>Math.round(v*1000)/1000),testedTriangles:0,
      terrainSamples:0,intersectingTriangleSamples:0,distinctAffectedTriangles:0,
      specialSurfaceTriangles:0,positions:points};
    const resolver=this.surfaceResolver;
    for(const [id,mesh] of this.surfaceMeshes){
      const animation=this.surfaceAnimations.get(id),indices=mesh.getIndices?.()||[];
      if(!animation)continue;
      if(animation.specialActive){result.specialSurfaceTriangles+=Math.floor(indices.length/3);continue;}
      const heights=times.map(time=>{
        const values=new Float32Array(animation.basePositions.length/3);
        for(let v=0;v<values.length;v++)values[v]=this.diagnosticWaveHeight(animation,v,time,windVisual);
        return values;
      });
      const positions=animation.basePositions;
      for(let j=0;j+2<indices.length;j+=3){
        const a=indices[j],b=indices[j+1],c=indices[j+2];
        if([a,b,c].some(v=>v<0||v*3+2>=positions.length))continue;
        const x=(positions[a*3]+positions[b*3]+positions[c*3])/3;
        const z=(positions[a*3+2]+positions[b*3+2]+positions[c*3+2])/3;
        const tx=Math.round(x/TILE_SIZE),tz=Math.round(z/TILE_SIZE);
        let ground=null;
        for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
          const point=resolver.publishedSurfacePoint?.({x:tx+dx,y:tz+dz},x,z);
          if(point){ground=point.y;break;}
        }
        if(ground==null)continue;
        result.terrainSamples++;result.testedTriangles++;
        let affected=false;
        for(let k=0;k<times.length;k++){
          const y=(heights[k][a]+heights[k][b]+heights[k][c])/3;
          if(y<ground){
            affected=true;result.intersectingTriangleSamples++;
            if(points.length<24)points.push({mesh:id,triangle:j/3,
              x:Number(x.toFixed(5)),z:Number(z.toFixed(5)),
              terrainY:Number(ground.toFixed(5)),waveY:Number(y.toFixed(5)),
              difference:Number((ground-y).toFixed(5)),time:result.sampleTimes[k]});
          }
        }
        if(affected)result.distinctAffectedTriangles++;
      }
    }
    result.auditMs=Math.round((performance.now()-started)*100)/100;
    return result;
  }

  // Read the SAME render client's surface footprint and actual tactical mesh
  // ownership; no new overlay surfaces, colliders, or visual state.
  overlayWaterDiagnostics(highlights){
    const waterKeys=new Set([...this.surfacePresentation.entries()]
      .filter(([,v])=>(v?.polygons?.length||0)>0).map(([key])=>key));
    const spots=[],result={wetSurfaceTiles:waterKeys.size,
      overlayMeshes:0,overlayWetTileMeshes:0,overlayDryTileMeshes:0,
      activeTransparentWetOverlays:0,locations:spots,
      interpretation:"COINCIDENT_WET_TILE_CANDIDATES_NOT_PIXEL_OCCLUSION"};
    for(const [type,meshes] of [["DEPLOYMENT",highlights?.areas],["TACTICAL",highlights?.dynamic]]){
      for(const [key,mesh] of meshes||[]){
        result.overlayMeshes++;
        if(!waterKeys.has(key)){result.overlayDryTileMeshes++;continue;}
        result.overlayWetTileMeshes++;
        const alpha=Number(mesh.material?.alpha??1),visible=mesh.isEnabled?.()!==false&&mesh.isVisible!==false&&mesh.visibility!==0;
        if(alpha<1&&visible)result.activeTransparentWetOverlays++;
        if(spots.length<24)spots.push({tile:key,type,alpha,visible,
          alphaIndex:mesh.alphaIndex??null,vertices:mesh.getTotalVertices?.()??null});
      }
    }
    return result;
  }

  waterSeamDiagnostics({detailed=false}={}){
    if(this.seamAuditCache?.revision===this.seamAuditRevision)
      return detailed?{...this.seamAuditCache.full,
        wind:{...this.wind},waveTime:Math.round(this.waveTime*100000)/100000,
        specialAnimatedRegions:[...this.surfaceAnimations.values()].filter(entry=>entry.specialActive).length,
        waveTerrain:this.waveTerrainDiagnostics(),
        overlayWater:this.overlayWaterDiagnostics(globalThis.CardTacticsRenderer?.highlights)}
        :this.seamAuditCache.summary;
    const started=performance.now();
    const key=(x,y,z)=>`${Number(x).toFixed(5)}:${Number(y).toFixed(5)}:${Number(z).toFixed(5)}`;
    const round=n=>Math.round(n*100000)/100000;
    const edgeKeys=new Map(),vertexLocations=new Map(),meshAttributes=new Map();
    const sameMeshPositions=new Map();
    const regions=[],issues=[],differentLevelLocations=[];
    const counters={triangles:0,vertices:0,invalidVertices:0,invalidIndices:0,
      degenerateTriangles:0,nonManifoldEdges:0,openBoundaryEdges:0,
      sharedCrossMeshEdges:0,
      coincidentCrossMeshVertices:0,crossMeshVertexMotionMismatch:0,
      coincidentSameMeshVertices:0,sameMeshWaveInputMismatch:0,
      conformingSplitEdges:0,conformingInsertedEdgeVertices:0,
      excludedSubmergedShoulderPolygons:0,clippedSubmergedShoulderPolygons:0,
      sameMeshColorMismatch:0,sameMeshNormalMismatch:0,
      crossMeshColorMismatch:0,crossMeshNormalMismatch:0,
      missingSurfaceAnimation:0,
      differentHeightAtSameXZ:0,registeredSeamPositions:this.waterSeamRegistry.size};
    const addIssue=(kind,point,extra={})=>{
      if(issues.length>=24)return;
      issues.push({kind,x:round(point[0]),y:round(point[1]),z:round(point[2]),...extra});
    };
    const scalar=(array,i)=>Number(array?.[i]||0);
    const waveDifference=(a,b)=>{
      const x=a.attributes,y=b.attributes;
      // Identical world position and time are necessary but not sufficient:
      // different per-vertex weights/flow/source values animate differently.
      return Math.max(...x.map((value,i)=>Math.abs(value-y[i])));
    };
    for(const [id,mesh] of this.surfaceMeshes){
      const animation=this.surfaceAnimations.get(id);
      const positions=animation?.basePositions||mesh?.getVerticesData?.(BABYLON.VertexBuffer.PositionKind)||[];
      const indices=mesh?.getIndices?.()||[];
      const colors=mesh?.getVerticesData?.(BABYLON.VertexBuffer.ColorKind)||[];
      const vertexCount=Math.floor(positions.length/3);
      const region={id,tiles:mesh?.metadata?.tileCount??null,
        vertices:vertexCount,triangles:Math.floor(indices.length/3),
        alphaIndex:mesh?.alphaIndex??null,visibility:mesh?.visibility??null,
        transparent:!!mesh?.hasVertexAlpha,
        gpuWave:this.gpuSurfaceWaves,animationPresent:!!animation,
        conformingSplitEdges:mesh?.metadata?.conformingTriangulation?.splitEdges??0,
        conformingInsertedEdgeVertices:mesh?.metadata?.conformingTriangulation?.insertedEdgeVertices??0,
        excludedSubmergedShoulderPolygons:mesh?.metadata?.exclusiveSubmergedShoulders??0,
        clippedSubmergedShoulderPolygons:mesh?.metadata?.clippedSubmergedShoulders??0,
        invalidTriangles:0,degenerateTriangles:0,openBoundaryEdges:0};
      regions.push(region);counters.vertices+=vertexCount;
      counters.conformingSplitEdges+=region.conformingSplitEdges;
      counters.conformingInsertedEdgeVertices+=region.conformingInsertedEdgeVertices;
      counters.excludedSubmergedShoulderPolygons+=region.excludedSubmergedShoulderPolygons;
      counters.clippedSubmergedShoulderPolygons+=region.clippedSubmergedShoulderPolygons;
      if(!animation)counters.missingSurfaceAnimation++;
      meshAttributes.set(id,{positions,animation,colors,mesh});
      const keys=new Array(vertexCount);
      for(let i=0;i<vertexCount;i++){
        const x=Number(positions[i*3]),y=Number(positions[i*3+1]),z=Number(positions[i*3+2]);
        if(![x,y,z].every(Number.isFinite)){counters.invalidVertices++;continue;}
        const k=key(x,y,z);keys[i]=k;
        const identity=`${id}:${k}`;
        const attrs=[scalar(animation?.flowX,i),scalar(animation?.flowZ,i),
          scalar(animation?.flowSpeeds,i),scalar(animation?.waveWeights,i),
          scalar(animation?.sourceWeights,i),scalar(animation?.sourcePhases,i)];
        const color=[scalar(colors,i*4),scalar(colors,i*4+1),
          scalar(colors,i*4+2),scalar(colors,i*4+3)];
        const normal=[scalar(animation?.baseNormals,i*3),
          scalar(animation?.baseNormals,i*3+1),scalar(animation?.baseNormals,i*3+2)];
        const other=sameMeshPositions.get(identity);
        if(other){
          counters.coincidentSameMeshVertices++;
          const delta=Math.max(...attrs.map((v,j)=>Math.abs(v-other.attrs[j])));
          if(delta>0.0001){
            counters.sameMeshWaveInputMismatch++;
            addIssue("SAME_MESH_WAVE_INPUT",[x,y,z],{mesh:id,indices:[other.index,i],delta:round(delta)});
          }
          if(Math.max(...color.map((v,j)=>Math.abs(v-other.color[j])))>.02)counters.sameMeshColorMismatch++;
          if(Math.max(...normal.map((v,j)=>Math.abs(v-other.normal[j])))>.02)counters.sameMeshNormalMismatch++;
        }else sameMeshPositions.set(identity,{index:i,attrs,color,normal});
      }
      // One undirected edge record per triangle. Interior shared edges within
      // a region cancel out; the remaining edges are physical coastlines OR
      // potential open seams, not automatic evidence of holes.
      for(let i=0;i+2<indices.length;i+=3){
        const face=[Number(indices[i]),Number(indices[i+1]),Number(indices[i+2])];
        if(face.some(n=>!Number.isInteger(n)||n<0||n>=vertexCount||!keys[n])){
          counters.invalidIndices++;region.invalidTriangles++;continue;
        }
        const a=face[0]*3,b=face[1]*3,c=face[2]*3;
        const ax=positions[b]-positions[a],az=positions[b+2]-positions[a+2],
          bx=positions[c]-positions[a],bz=positions[c+2]-positions[a+2];
        if(Math.abs(ax*bz-az*bx)<1e-10){
          counters.degenerateTriangles++;region.degenerateTriangles++;
          addIssue("DEGENERATE_WATER_TRIANGLE",
            [positions[a],positions[a+1],positions[a+2]],{mesh:id});
        }
        counters.triangles++;
        for(const [u,v] of [[face[0],face[1]],[face[1],face[2]],[face[2],face[0]]]){
          const k1=keys[u],k2=keys[v];
          if(k1===k2)continue;
          const edge=k1<k2?`${k1}|${k2}`:`${k2}|${k1}`;
          const list=edgeKeys.get(edge)||[];
          const third=face.find(index=>index!==u&&index!==v);
          list.push({id,vertex1:u,vertex2:v,third});edgeKeys.set(edge,list);
        }
      }
    }
    // A large lake may have tens of thousands of *interior* vertices. Check
    // motion inputs only on actual region boundary endpoints; avoid allocating
    // per-vertex objects for the whole lake on a hot iPhone.
    const checkedBoundaryVertices=new Set();
    const registerBoundaryVertex=(id,index)=>{
      const identity=`${id}:${index}`;
      if(checkedBoundaryVertices.has(identity))return;
      checkedBoundaryVertices.add(identity);
      const {positions,animation,colors,mesh}=meshAttributes.get(id)||{};
      if(!positions)return;
      const x=Number(positions[index*3]),y=Number(positions[index*3+1]),z=Number(positions[index*3+2]);
      const item={mesh:id,point:[x,y,z],attributes:[
        scalar(animation?.flowX,index),scalar(animation?.flowZ,index),
        scalar(animation?.flowSpeeds,index),scalar(animation?.waveWeights,index),
        scalar(animation?.sourceWeights,index),scalar(animation?.sourcePhases,index)],
        color:[scalar(colors,index*4),scalar(colors,index*4+1),
          scalar(colors,index*4+2),scalar(colors,index*4+3)],
        normal:[scalar(animation?.baseNormals,index*3),
          scalar(animation?.baseNormals,index*3+1),scalar(animation?.baseNormals,index*3+2)],
        visibility:Number(mesh?.visibility??1)};
      const xy=`${x.toFixed(5)}:${z.toFixed(5)}`,same=vertexLocations.get(xy)||[];
      for(const other of same){
        if(other.mesh===id)continue;
        if(Math.abs(y-other.point[1])>0.001){
          counters.differentHeightAtSameXZ++;
          if(differentLevelLocations.length<16)differentLevelLocations.push({
            x:round(x),z:round(z),firstMesh:other.mesh,secondMesh:id,
            firstY:round(other.point[1]),secondY:round(y)});
          continue; // a waterfall or a stepped water surface can legitimately differ
        }
        counters.coincidentCrossMeshVertices++;
        const colorDelta=Math.max(...item.color.map((v,i)=>Math.abs(v-other.color[i])));
        if(colorDelta>.02||Math.abs(item.visibility-other.visibility)>.02){
          counters.crossMeshColorMismatch++;
          addIssue("CROSS_MESH_COLOR_ALPHA",item.point,{meshes:[other.mesh,id],
            maxColorDelta:round(colorDelta),visibility:[other.visibility,item.visibility]});
        }
        const normalDelta=Math.max(...item.normal.map((v,i)=>Math.abs(v-other.normal[i])));
        if(normalDelta>.02)counters.crossMeshNormalMismatch++;
        const delta=waveDifference(item,other);
        if(delta>0.0001){
          counters.crossMeshVertexMotionMismatch++;
          addIssue("CROSS_MESH_WAVE_INPUT",item.point,
            {meshes:[other.mesh,id],maxAttributeDelta:round(delta)});
        }
      }
      same.push(item);vertexLocations.set(xy,same);
    };
    for(const [edge,list] of edgeKeys){
      // More than two coincident faces on one 3D edge is a topology error,
      // independent of whether that edge lies at a tile boundary.
      if(list.length>2){
        counters.nonManifoldEdges++;
        if(issues.length<24){const nums=edge.split('|')[0].split(':').map(Number);
          addIssue("NON_MANIFOLD_WATER_EDGE",nums,{meshes:[...new Set(list.map(x=>x.id))]});}
      }else if(list.length===1){
        counters.openBoundaryEdges++;
        const region=regions.find(r=>r.id===list[0].id);
        if(region)region.openBoundaryEdges++;
      }else if(list[0].id!==list[1].id){
        counters.sharedCrossMeshEdges++;
      }
      if(list.length===1||list.some(record=>record.id!==list[0].id))
        for(const record of list){
          registerBoundaryVertex(record.id,record.vertex1);
          registerBoundaryVertex(record.id,record.vertex2);
        }
    }
    const internalBoundaries=this.auditInternalWaterBoundaries(edgeKeys,meshAttributes,addIssue);
    const summary={revision:this.seamAuditRevision,
      topology:"EXISTING_REGION_COMPONENTS",waveSampleSpace:"WORLD_XZ",
      meshCacheScope:"LOCAL_PUBLISHED_DQ_POLYGONS_CLIFF_SEAMS_TILE_FLOW",
      waveMode:this.gpuSurfaceWaves?"GPU_SHADER":"CPU_VERTEX",
      surfaceRegions:this.surfaceMeshes.size,surfaceMeshes:this.surfaceMeshes.size,
      update:{...this.surfaceMeshUpdate},cascades:{count:this.cascades.size,update:{...this.cascadeMeshUpdate}},
      ...counters,internalBoundaries,warningCount:counters.invalidVertices+counters.invalidIndices+
        counters.degenerateTriangles+counters.nonManifoldEdges+
        counters.crossMeshVertexMotionMismatch+counters.sameMeshWaveInputMismatch+
        counters.missingSurfaceAnimation+
        internalBoundaries.internalMissingSurfaceEdges,
      visualBoundaryCandidates:counters.crossMeshColorMismatch+
        counters.crossMeshNormalMismatch+counters.sameMeshColorMismatch+
        counters.sameMeshNormalMismatch+internalBoundaries.internalUnweldedEdges,
      openEdgesAreNotNecessarilyCracks:true,
      waveAttributeCheck:"CROSS_REGION_BOUNDARY_ONLY",
      internalWetBoundaryCheck:"EXPECTED_PUBLISHED_WET_POLYGONS_VS_ACTUAL_TRIANGLES",
      gpuDisplacedPositionsNotReadBack:true,
      measuredGeometryVersion:"REST_POSITIONS_AND_WAVE_INPUTS",
      auditMs:round(performance.now()-started)};
    const full={...summary,regions:regions.slice(0,30),issues,differentLevelLocations,
      wind:{...this.wind},waveTime:round(this.waveTime),
      transparentWater:{alphaIndex:[...new Set(regions.map(r=>r.alphaIndex))],
        prepass:!!this.surfaceMaterial?.needDepthPrePass,
        mode:this.surfaceMaterial?.transparencyMode??null}};
    this.seamAuditCache={revision:this.seamAuditRevision,summary,full};
    return detailed?{...full,
      waveTerrain:this.waveTerrainDiagnostics(),
      overlayWater:this.overlayWaterDiagnostics(globalThis.CardTacticsRenderer?.highlights)}:summary;
  }

  diagnostics(){
    return{
      surfaceMeshes:this.surfaceMeshes.size,
      surfaceMeshUpdate:this.surfaceMeshUpdate,
      publishedWaterGeometryRevision:this.publishedWaterGeometryRevision,
      surfaceSolveStats:this.surfaceSolveStats,
      surfaceRebuildDetail:this.waterRebuildDiagnostics(),
      meshCacheScope:"LOCAL_PUBLISHED_DQ_POLYGONS_CLIFF_SEAMS_TILE_FLOW",
      waterLevelMemoizedPerSync:true,
      edgeConnectivityMemoizedPerSync:true,
      edgeConnectivitySamples:{...this.waterEdgeContinuityStats},
      publishedTerrainSamples:{...this.surfaceResolver.publishedSurfaceSampleStats},
      sideMeshes:0,
      cascades:this.cascades.size,
      cascadeMeshUpdate:this.cascadeMeshUpdate,
      waterfallGeometryLookup:"PUBLISHED_DQ_POLYGON_SPATIAL_INDEX",
      cascadeSignatureScope:"EXACT_LOCAL_PUBLISHED_GEOMETRY_MEMOIZED",
      surfaceRunoffs:this.runoffs.size,
      runoffMeshUpdate:this.runoffMeshUpdate,
      runoffCacheScope:"PER_DIRECTED_HYDROLOGY_EDGE_PUBLISHED_DQ_CLIFF",
      activeSourceFootprints:this.sourceFootprints.size,
      separatedWaterLevels:false,
      hydrologyContinuousSurface:true,
      sharedWetEdges:true,
      quantizedLevels:false,
      thinCascadeRibbon:false,
      sharedEdgeCascade:true,
      cascadeImpactRipples:true,
      perTileWaterBoxes:false,
      minVisibleWaterDepth:EPSILON,
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
      sheetFlowSurfaceMeshes:0,
      unifiedDQSurfaceMeshes:true,
      visualInputInvalidation:{...this.visualInputAudit},
      qSurfaceMeshAliases:this.sheetFlowMeshes.size,
      sheetFlowBoundaryInventory:true,
      sheetFlowActiveTiles:[...this.sheetFlowNetwork.values()].filter(tile=>tile.incoming.length||tile.outgoing.length).length,
      sheetFlowGeometryRejectedEdges:new Set([...this.sheetFlowNetwork.values()].flatMap(tile=>tile.outgoing)
        .filter(edge=>!edge.geometryJoinValid&&!edge.cascade).map(edge=>edge.id)).size,
      hydraulicImpactPower:true,
      sourceUpwellingField:true,
      dryReceiverCascade:true
    };
  }
}
