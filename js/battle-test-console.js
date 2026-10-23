(()=>{
"use strict";

const MOON_OPTIONS=[["FULL","滿月／有月光"],["PARTIAL","微弱月光"],["NONE","無月光"]];
const WEATHER_OPTIONS=[["SCORCHING_SUN","烈日"],["CLEAR","晴朗"],["FOG","迷霧"],["RAIN","雨"],["HEAVY_RAIN","豪大雨"],["THUNDERSTORM","雷雨"],["TYPHOON","颱風"],["SNOW","降雪"],["BLIZZARD","暴風雪"]];
const WIND_OPTIONS=[["CALM","無風"],["N","北向"],["NE","東北向"],["E","東向"],["SE","東南向"],["S","南向"],["SW","西南向"],["W","西向"],["NW","西北向"]];
const FORCE_OPTIONS=[["FIRE","火"],["HEAVY_FIRE","高熱"],["EXPLOSION","爆炸"],["WIND","風"],["THUNDER","雷"],["IMPACT","衝擊"],["AVALANCHE_TRIGGER","雪崩觸發"]];
function runtime(){return window.CardTacticsRuntime?.debug||null}
function cards(){return Object.values(window.CARDS||{}).filter(Boolean).sort((a,b)=>String(a.name).localeCompare(String(b.name),"zh-Hant"))}
function items(){return globalThis.ItemDatabase?.list?.()||[]}
function option(value,label){return`<option value="${value}">${label}</option>`}
function ensureStyles(){if(document.getElementById("battleTestConsoleStyles"))return;const style=document.createElement("style");style.id="battleTestConsoleStyles";style.textContent=`.battle-test-console{display:none;position:absolute;z-index:135;right:80px;bottom:96px;width:min(430px,calc(100vw - 92px));max-height:72vh;overflow:auto;border:1px solid #8a7147;border-radius:11px;background:#081018f7;box-shadow:0 16px 48px #000c;font-size:11px}.battle-test-console.open{display:block}.battle-test-console>header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #3c4654;background:#081018fc}.battle-test-console>header button{width:30px;height:30px;padding:0}.battle-test-body{padding:8px;display:grid;gap:8px}.battle-test-section{border:1px solid #2f3b49;border-radius:8px;padding:8px;background:#0b141e}.battle-test-section h4{margin:0 0 6px;color:#f0d494;font-size:11px}.battle-test-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}.battle-test-row.triple{grid-template-columns:1fr 1fr 1fr}.battle-test-console select,.battle-test-console input,.battle-test-console button{min-width:0;width:100%;padding:7px;font-size:10px}.battle-test-status{padding:6px 8px;border-radius:6px;background:#071018;color:#b9c6d4;min-height:28px}.battle-test-status.ok{color:#9ff2af}.battle-test-status.bad{color:#ff9b9b}@media(max-width:700px){.battle-test-console{right:68px;bottom:92px;width:calc(100vw - 78px);max-height:66vh}.battle-test-row,.battle-test-row.triple{grid-template-columns:1fr}}.test-annotation-layer[hidden],.test-annotation-drag[hidden]{display:none!important}.test-annotation-layer{position:fixed;inset:0;pointer-events:none;z-index:220}.test-annotation-toolbar{position:fixed;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;gap:7px;align-items:center;max-width:calc(100vw - 20px);padding:8px;background:#07121cf2;border:1px solid #c99a45;border-radius:9px;box-shadow:0 8px 30px #0009;pointer-events:auto;color:#fff;font-size:12px}.test-annotation-toolbar button{font:inherit;border:1px solid #8a7147;border-radius:6px;background:#172a38;color:#f7e6be;padding:7px;white-space:nowrap}.test-annotation-toolbar button:disabled{opacity:.5}.test-annotation-drag{position:fixed;border:2px dashed #ffc466;background:#ffb93030;pointer-events:none;box-sizing:border-box}.test-annotation-mark{position:fixed;width:16px;height:16px;border-radius:50%;border:2px solid #ffd16e;background:#fe9f4844;transform:translate(-50%,-50%);box-shadow:0 0 4px #000;pointer-events:none}.test-annotation-help{font-size:10px;color:#d5decf}@media(max-width:600px){.test-annotation-toolbar{flex-wrap:wrap;justify-content:center;width:calc(100vw - 20px)}.test-annotation-help{width:100%;text-align:center}}`;document.head.appendChild(style)}

// Observe the existing Babylon scene without wrapping Renderer.sync(),
// creating a second diagnostics store, or touching the GL error flag.
// A completed onAfterRender callback means the scene submitted a render;
// it does NOT prove that each subsystem synced or that the GPU drew every pixel.
function makeRenderEvidence(){
  let boundScene=null,observer=null,lastSampleMs=0,lastObserved=null;
  let lastPresented=null,lastDrawn=null;
  let lastFailureCapture=-Infinity,lastMismatchAt=null,lastMismatchLogged=false;
  const recent=[];
  const maxRecent=24;
  const subsystemLedger=new Map();
  const subsystemNames=['sky','lighting','camera','picker','terrain','water','mapObjects','units','environment','objectives','highlights','shadows','unitHud','actionAnchor'];
  const diag=()=>window.CardTacticsDiagnostics;
  const live=()=>window.CardTacticsRenderer;
  const asNum=value=>Number.isFinite(Number(value))?Number(value):null;
  const meshState=mesh=>{
    if(!mesh||mesh.isDisposed?.())return{exists:false};
    const mat=mesh.material,effect=mesh.subMeshes?.find(sub=>sub?._drawWrapper?.effect)?._drawWrapper?.effect||mat?.getEffect?.();
    return{exists:true,id:mesh.uniqueId,name:mesh.name,enabled:mesh.isEnabled?.()??null,visible:mesh.isVisible!==false,
      vertices:mesh.getTotalVertices?.()??null,indices:mesh.getTotalIndices?.()??null,
      material:mat?.name||null,maxSimultaneousLights:mat?.maxSimultaneousLights??null,
      shaderReady:effect?.isReady?.()??null,
      shaderError:String(effect?.getCompilationError?.()||'').slice(0,500)||null};
  };
  function snapshot(){
    const v=live(),s=v?.scene;if(!v||!s)return null;
    const state=window.CardTacticsRuntime?.getBattleSnapshot?.();
    const errors=Object.fromEntries([...(v.subsystemErrors||new Map())].map(([key,val])=>[key,String(val).slice(0,700)]));
    const terrain=meshState(v.terrain?.meshes?.get('surface')),
      cliffs=meshState(v.terrain?.meshes?.get('cliffs'));
    const water=v.water?.waterSeamDiagnostics?.()||null;
    const burning=(v.lastState?.map?.tiles||[]).filter(tile=>(tile.effects||[]).includes('BURNING')).length;
    const lightReceivers=(v.environment?.fireLights||[]).map(light=>({
      name:light.name,enabled:light.isEnabled?.()??null,
      count:light.includedOnlyMeshes?.length??null,
      terrain:light.includedOnlyMeshes?.includes(v.terrain?.meshes?.get('surface'))??false,
      cliffs:light.includedOnlyMeshes?.includes(v.terrain?.meshes?.get('cliffs'))??false
    }));
    const stateRevision=asNum(state?.revision),presentedRevision=asNum(v.lastState?.revision);
    return{
      at:new Date().toISOString(),round:state?.round??v.lastState?.round??null,
      phase:state?.phase??v.lastState?.phase??null,
      weather:v.lastState?.presentation?.environment?.weather??null,
      stateRevision,presentedRevision,
      // onAfterRender supplies evidence of scene submission, not a GPU completion fence.
      lastSceneSubmissionRevision:lastDrawn?.presentedRevision??null,
      revisionAgreement:stateRevision!=null&&presentedRevision!=null?stateRevision===presentedRevision:null,
      contextLost:v.engine?._gl?.isContextLost?.()??null,
      rendererErrors:errors,
      terrain:{surface:terrain,cliffs,builds:{...v.terrain?.updateCounts}},
      water:{revision:water?.revision??null,regions:water?.surfaceRegions??null,
        meshes:water?.surfaceMeshes??null,warnings:water?.warningCount??null,
        missingWetEdges:water?.internalBoundaries?.internalMissingSurfaceEdges??null,
        unweldedEdges:water?.internalBoundaries?.internalUnweldedEdges??null},
      fire:{burningTiles:burning,physicalLights:v.environment?.fireLights?.length??null,
        sources:lightReceivers.slice(0,16)},
      scene:{meshes:s.meshes?.length??null,activeMeshes:s.getActiveMeshes?.()?.length??null},
      performance:{frameMs:v.performanceStats?.frameMs??null,renderMs:v.performanceStats?.renderMs??null,
        drawCalls:v.performanceStats?.drawCallsPerFrame??null}
    };
  }
  function emit(type,data){
    if(diag()?.isEnabled?.())diag().push(type,data);
  }
  function remember(entry){
    recent.push(entry);if(recent.length>maxRecent)recent.shift();
  }
  function observe(fromScene=false){
    const v=live(),s=v?.scene;if(!v||!s)return;
    const ms=performance.now();
    if(fromScene&&ms-lastSampleMs<500)return;
    lastSampleMs=ms;
    const next=snapshot();if(!next)return;
    if(fromScene)lastDrawn={at:next.at,presentedRevision:next.presentedRevision};
    const currErrors=next.rendererErrors;
    // The authoritative sync outcome belongs to BabylonRenderer; this is
    // *observed* after scene submission, not a wrapper of syncSubsystem().
    // Preserve last exception-free revision across subsequent failures.
    for(const name of subsystemNames){
      const record=subsystemLedger.get(name)||{lastObservedExceptionFreeRevision:null,
        lastObservedFailureRevision:null,lastFailureAt:null,observedFailures:0};
      if(Object.prototype.hasOwnProperty.call(currErrors,name)){
        if(!lastObserved||lastObserved.rendererErrors[name]!==currErrors[name]){
          record.lastObservedFailureRevision=next.presentedRevision;
          record.lastFailureAt=next.at;record.observedFailures++;
        }
      }else record.lastObservedExceptionFreeRevision=next.presentedRevision;
      subsystemLedger.set(name,record);
    }
    const priorErrors=lastObserved?.rendererErrors||{};
    const newlyFailed=Object.keys(currErrors).filter(key=>currErrors[key]!==priorErrors[key]);
    const recovered=Object.keys(priorErrors).filter(key=>!(key in currErrors));
    const missing=lastObserved?.terrain?.surface?.exists&& !next.terrain.surface.exists;
    const missingCliffs=lastObserved?.terrain?.cliffs?.exists&& !next.terrain.cliffs.exists;
    const returnedSurface=lastObserved?.terrain?.surface?.exists===false&&next.terrain.surface.exists===true;
    const returnedCliffs=lastObserved?.terrain?.cliffs?.exists===false&&next.terrain.cliffs.exists===true;
    // A short state/presentation gap is normal between actions; log only
    // an observed disagreement that persists beyond multiple scene renders.
    if(next.revisionAgreement===false){if(lastMismatchAt==null)lastMismatchAt=ms;}
    else{lastMismatchAt=null;lastMismatchLogged=false;}
    const lagging=lastMismatchAt!=null&&ms-lastMismatchAt>=1500&&!lastMismatchLogged;
    if(lagging)lastMismatchLogged=true;
    const currentShaders=[next.terrain.surface,next.terrain.cliffs].filter(m=>m.shaderError).map(m=>({name:m.name,error:m.shaderError}));
    const previousShaders=[lastObserved?.terrain?.surface,lastObserved?.terrain?.cliffs].filter(m=>m?.shaderError).map(m=>m.name);
    const shaderChange=currentShaders.filter(m=>!previousShaders.includes(m.name));
    const problems=[];
    if(newlyFailed.length)problems.push('SUBSYSTEM_ERROR');
    if(missing||missingCliffs)problems.push('TERRAIN_MESH_DISAPPEARED');
    if(shaderChange.length)problems.push('SHADER_COMPILATION_ERROR');
    if(lagging)problems.push('PERSISTENT_PRESENTATION_REVISION_GAP');
    if(next.contextLost===true&&lastObserved?.contextLost!==true)problems.push('CONTEXT_LOST');
    const buildsChanged=lastObserved&&JSON.stringify(lastObserved.terrain.builds)!==JSON.stringify(next.terrain.builds);
    const revisionChanged=lastObserved&&lastObserved.presentedRevision!==next.presentedRevision;
    const geometryReturned=returnedSurface||returnedCliffs;
    if(problems.length||recovered.length||geometryReturned||buildsChanged||revisionChanged){
      const event={at:next.at,round:next.round,revision:next.presentedRevision,
        currentRevision:next.stateRevision,sceneSubmissionRevision:next.lastSceneSubmissionRevision,
        problems,recovered,geometryReturned,
        errors:newlyFailed.map(key=>({name:key,message:currErrors[key]})),
        shaderErrors:shaderChange,
        terrain:next.terrain,water:next.water,
        fire:{burningTiles:next.fire.burningTiles,physicalLights:next.fire.physicalLights}};
      remember(event);
      if(problems.length){emit('TEST_RENDER_ANOMALY',event);
        // Existing Diagnostics capture persists error evidence across reloads.
        if(ms-lastFailureCapture>60000){lastFailureCapture=ms;diag()?.capture?.('AUTO_RENDER_ANOMALY');}
      }else if(recovered.length||geometryReturned)emit('TEST_RENDER_RECOVERED',event);
    }
    lastObserved=next;
    lastPresented={at:next.at,revision:next.presentedRevision};
  }
  function bind(){
    const scene=live()?.scene;
    if(!scene||scene===boundScene)return;
    if(boundScene&&observer)boundScene.onAfterRenderObservable?.remove(observer);
    boundScene=scene;lastObserved=null;lastDrawn=null;subsystemLedger.clear();
    observer=scene.onAfterRenderObservable?.add(()=>observe(true))||null;
  }
  // The TEST console exists before the game creates its Babylon scene.
  // Bind only to that scene's supported render observation hook.
  window.addEventListener('cardtactics:battle-render',bind);
  window.addEventListener('cardtactics:state',bind);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)bind()});
  bind();
  return{
    capture:()=>{bind();observe(false);return{schema:'TEST_RENDER_FORENSICS_V1',
      at:new Date().toISOString(),current:lastObserved||snapshot(),
      lastSubmission:lastDrawn,lastObservedRevision:lastPresented,
      subsystemRevisions:Object.fromEntries(subsystemLedger),
      transitions:recent.slice(-16),
      interpretation:'scene submission != GPU pixel proof; no verified per-subsystem success revision without Renderer instrumentation'};}
  };
}

// TEST-only, read-only geometry annotation. The normal GridPicker and
// BattleInputController remain the only owners of gameplay picking/movement.
// Capture-phase pointer handling prevents an annotation drag from panning,
// selecting units, or triggering a card action; no second Renderer/State exists.
function makeTileAnnotator(panel,status,renderEvidence,onModeChange=()=>{}){
  const layer=document.createElement("div");layer.className="test-annotation-layer";layer.hidden=true;
  const toolbar=document.createElement("div");toolbar.className="test-annotation-toolbar";
  const help=document.createElement("span");help.className="test-annotation-help";help.textContent="點選或拖曳框選格子，不會操作戰棋";
  const reason=document.createElement("select");reason.title="異常類別";
  for(const [code,title] of [["WATER_DQ","積水／D-Q"],["TERRAIN_HOLE","地形破洞"],["FIRE_RENDER","火災／光照"],["OTHER_VISUAL","其他顯示異常"]]){
    const opt=document.createElement("option");opt.value=code;opt.textContent=title;reason.appendChild(opt);
  }
  reason.style.cssText="background:#142535;color:#fff;border:1px solid #8a7147;border-radius:6px;padding:6px;min-width:100px";
  const count=document.createElement("span");count.textContent="已選 0 格";
  const save=document.createElement("button");save.type="button";save.textContent="記錄到 LOG";save.disabled=true;
  const undo=document.createElement("button");undo.type="button";undo.textContent="清空";
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent="退出";
  toolbar.append(help,reason,count,save,undo,cancel);layer.appendChild(toolbar);
  const drag=document.createElement("div");drag.className="test-annotation-drag";drag.hidden=true;layer.appendChild(drag);
  document.body.appendChild(layer);
  let active=false,pointer=null,marks=[],selected=new Map(),boundCanvas=null;
  const renderer=()=>window.CardTacticsRenderer;
  const canvas=()=>renderer()?.canvas;
  const scene=()=>renderer()?.scene;
  const coords=(event)=>{
    const rect=canvas()?.getBoundingClientRect();
    return rect?{x:event.clientX-rect.left,y:event.clientY-rect.top,rect}:null;
  };
  const tileKey=tile=>`${tile.x},${tile.y}`;
  const project=(mesh)=>{
    const v=renderer(),engine=v?.engine,camera=v?.camera?.camera,s=v?.scene;
    if(!engine||!camera||!s||!mesh)return null;
    const vp=camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());
    const p=BABYLON.Vector3.Project(mesh.getAbsolutePosition(),BABYLON.Matrix.Identity(),s.getTransformMatrix(),vp);
    const rect=v.canvas.getBoundingClientRect();
    return Number.isFinite(p.x)&&Number.isFinite(p.y)?{x:rect.left+p.x*rect.width/Math.max(1,engine.getRenderWidth()),y:rect.top+p.y*rect.height/Math.max(1,engine.getRenderHeight())}:null;
  };
  const mapTiles=()=>[...(renderer()?.picker?.hitMeshes?.values?.()||[])].filter(m=>!m.isDisposed?.());
  const update=()=>{
    count.textContent=`已選 ${selected.size} 格`;save.disabled=!selected.size;
    marks.forEach(node=>node.remove());marks=[];
    for(const mesh of mapTiles()){
      const meta=mesh.metadata||{};
      if(!selected.has(tileKey(meta)))continue;
      const p=project(mesh);if(!p)continue;
      const mark=document.createElement("span");mark.className="test-annotation-mark";
      mark.style.left=`${p.x}px`;mark.style.top=`${p.y}px`;layer.appendChild(mark);marks.push(mark);
      if(marks.length>=160)break;
    }
  };
  const addTile=tile=>{if(tile&&Number.isInteger(tile.x)&&Number.isInteger(tile.y))selected.set(tileKey(tile),{x:tile.x,y:tile.y})};
  const nearestPick=(e)=>{
    const v=renderer(),c=coords(e),s=scene();if(!v||!c||!s)return null;
    const localX=c.x*Math.max(1,v.engine.getRenderWidth())/Math.max(1,c.rect.width);
    const localY=c.y*Math.max(1,v.engine.getRenderHeight())/Math.max(1,c.rect.height);
    const valid=mesh=>mesh?.metadata?.kind==="tile-hit";
    let hit=s.pick(localX,localY,valid,false,v.camera?.camera);
    if(!hit?.hit)hit=s.pick(c.x,c.y,valid,false,v.camera?.camera);
    const meta=hit?.pickedMesh?.metadata;
    return hit?.hit&&meta?.kind==="tile-hit"?{x:meta.x,y:meta.y}:null;
  };
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  function pointerDown(e){if(!active||e.target!==canvas())return;
    stop(e);
    if(pointer||e.button!==0)return;
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,ex:e.clientX,ey:e.clientY};
    try{canvas()?.setPointerCapture?.(e.pointerId)}catch(_){}
  }
  function pointerMove(e){if(!active||e.target!==canvas())return;stop(e);
    if(!pointer||pointer.id!==e.pointerId)return;
    pointer.ex=e.clientX;pointer.ey=e.clientY;
    const distance=Math.hypot(pointer.ex-pointer.x,pointer.ey-pointer.y);
    drag.hidden=distance<8;
    if(!drag.hidden){drag.style.left=`${Math.min(pointer.x,pointer.ex)}px`;drag.style.top=`${Math.min(pointer.y,pointer.ey)}px`;
      drag.style.width=`${Math.abs(pointer.ex-pointer.x)}px`;drag.style.height=`${Math.abs(pointer.ey-pointer.y)}px`;}
  }
  function pointerUp(e){if(!active||e.target!==canvas())return;stop(e);
    if(!pointer||pointer.id!==e.pointerId)return;
    const a=pointer;pointer=null;drag.hidden=true;
    try{canvas()?.releasePointerCapture?.(e.pointerId)}catch(_){}
    const distance=Math.hypot(e.clientX-a.x,e.clientY-a.y);
    if(distance<8)addTile(nearestPick(e));
    else{
      const left=Math.min(a.x,e.clientX),right=Math.max(a.x,e.clientX),top=Math.min(a.y,e.clientY),bottom=Math.max(a.y,e.clientY);
      for(const mesh of mapTiles()){
        const p=project(mesh);if(p&&p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom)addTile(mesh.metadata);
      }
    }
    update();
  }
  function pointerCancel(e){if(!active||e.target!==canvas())return;stop(e);
    if(pointer?.id===e.pointerId){pointer=null;drag.hidden=true;}
  }
  function keydown(e){
    if(active&&e.key==="Escape"){
      e.preventDefault();e.stopImmediatePropagation();end(false);
    }
  }
  // One exit path owns cleanup for toolbar / TEST button / Escape / page hide.
  // Exit means return to gameplay; reopening TEST is never implicit.
  function end(openPanel=false){
    if(boundCanvas){
      const previousCanvas=boundCanvas;
      previousCanvas.removeEventListener("pointerdown",pointerDown,true);
      previousCanvas.removeEventListener("pointermove",pointerMove,true);
      previousCanvas.removeEventListener("pointerup",pointerUp,true);
      previousCanvas.removeEventListener("pointercancel",pointerCancel,true);
      previousCanvas.removeEventListener("lostpointercapture",pointerCancel,true);
      if(pointer){
        try{
          if(previousCanvas.hasPointerCapture?.(pointer.id))previousCanvas.releasePointerCapture(pointer.id);
        }catch(_){}
      }
      boundCanvas=null;
    }
    active=false;pointer=null;drag.hidden=true;layer.hidden=true;
    marks.forEach(node=>node.remove());marks=[];selected.clear();
    panel.classList.toggle("open",openPanel);
    onModeChange(false);
  }
  function start(){
    if(active)return;
    const v=renderer();if(!v?.scene||!v?.picker?.hitMeshes?.size){status("無法標註：戰場尚未建立格子拾取資料。",false);return;}
    boundCanvas=v.canvas;
    if(!boundCanvas){status("無法標註：戰場畫布尚未建立。",false);return;}
    boundCanvas.addEventListener("pointerdown",pointerDown,true);
    boundCanvas.addEventListener("pointermove",pointerMove,true);
    boundCanvas.addEventListener("pointerup",pointerUp,true);
    boundCanvas.addEventListener("pointercancel",pointerCancel,true);
    boundCanvas.addEventListener("lostpointercapture",pointerCancel,true);
    active=true;selected.clear();layer.hidden=false;panel.classList.remove("open");
    onModeChange(true);update();
  }
  // All fields below are observations of the published state and actual
  // terrain/water meshes. A D surface is correctly level; a Q-only film is
  // expected to track terrain. Neither condition is diagnosed from colour.
  function snapshotTile(tile){
    const v=renderer(),live=window.CardTacticsRuntime?.getBattleSnapshot?.();
    const mapTile=live?.map?.tiles?.find(t=>t.x===tile.x&&t.y===tile.y)
      ||window.CardTacticsRuntime?.getBattleMap?.()?.tiles?.find(t=>t.x===tile.x&&t.y===tile.y);
    if(!mapTile)return{...tile,unavailable:"tile-not-in-snapshot"};
    const key=tileKey(tile),resolver=v?.terrain?.surfaceResolver;
    const terrain=resolver?.getRenderedSurfaceGeometry(mapTile);
    const publish=v?.water?.surfacePresentation?.get(key);
    const node=v?.water?.sheetFlowNetwork?.get(key);
    const vertices=(publish?.polygons||[]).flat();
    const levels=vertices.map(x=>x.waterY==null?NaN:Number(x.waterY)).filter(Number.isFinite);
    const terrainY=(terrain?.triangles||[]).flat().map(p=>Number(p.y)).filter(Number.isFinite);
    const hit=v?.picker?.hitMeshes?.get(key);
    const center=hit?resolver?.publishedSurfacePoint?.(mapTile,hit.position.x,hit.position.z)||null:null;
    const summary=values=>values.length?{min:Math.min(...values),max:Math.max(...values)}:null;
    const channels=(records)=> (records||[]).slice(0,8).map(edge=>({id:edge.id,q:Number(edge.q||0),kind:edge.qKind||null,cascade:!!edge.cascade,joinValid:!!edge.geometryJoinValid,join:edge.geometryJoin||null}));
    return{
      x:tile.x,y:tile.y,terrain:mapTile.terrain||null,material:mapTile.material||null,elevation:Number(mapTile.elevation||0),
      waterDepth:Number(mapTile.waterDepth||0),waterSurfaceZ:mapTile.waterSurfaceZ??null,
      river:mapTile.river===true,flowX:Number(mapTile.flowX||0),flowY:Number(mapTile.flowY||0),flowSpeed:Number(mapTile.flowSpeed||0),
      hydrologyEdgeOutflows:mapTile.hydrologyEdgeOutflows??null,effects:(mapTile.effects||[]).slice(0,16),fogged:!!mapTile.fogged,
      publishedTerrain:{revision:terrain?.revision??null,triangleCount:terrain?.triangles?.length??0,heights:summary(terrainY),center: center?{x:center.x,y:center.y,z:center.z,triangleIndex:center.triangleIndex}:null},
      publishedWater:{owner:publish?(publish.stored?"D_STORED_WITH_Q_HANDOFF":"Q_FILM"):"NONE",model:publish?.model??null,
        polygons:publish?.polygons?.length??0,wetArea:publish?.wetArea??0,maxDepth:publish?.maxDepth??0,
        waterHeights:summary(levels),clippedPoints:publish?.clippedPoints??0,
        representativeVertices:vertices.slice(0,12).map(p=>({x:p.x,y:p.y,z:p.z,waterY:p.waterY,depth:p.depth,clipped:p.clipped}))},
      qNetwork:node?{in:channels(node.incoming),out:channels(node.outgoing),status:node.sheetStatus||null}:null
    };
  }
  function meshSummary(mesh){
    if(!mesh)return{exists:false};
    const positions=mesh.getVerticesData?.(BABYLON.VertexBuffer.PositionKind)||[];
    const indices=mesh.getIndices?.()||[];
    let invalid=0,wrongIndices=0;
    for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))invalid++;
    for(const index of indices)if(!Number.isInteger(index)||index<0||index>=positions.length/3)wrongIndices++;
    const effect=mesh.subMeshes?.find(sm=>sm?._drawWrapper?.effect)?._drawWrapper?.effect||mesh.material?.getEffect?.();
    return{exists:true,name:mesh.name,enabled:mesh.isEnabled?.()??null,visibility:mesh.visibility,
      vertices:positions.length/3,triangles:indices.length/3,invalidCoordinates:invalid,invalidIndices:wrongIndices,
      material:{name:mesh.material?.name||null,maxSimultaneousLights:mesh.material?.maxSimultaneousLights??null,
        effectReady:effect?.isReady?.()??null,effectCompilationError:effect?.getCompilationError?.()||null}};
  }
  function saveAnnotation(){
    if(!active||!selected.size)return;
    const d=window.CardTacticsDiagnostics;
    if(!d?.isEnabled?.()){status("無法寫入：請先在 Settings 開啟診斷紀錄。",false);end();return;}
    const v=renderer(),chosen=[...selected.values()].sort((a,b)=>a.y-b.y||a.x-b.x);
    const detailed=chosen.slice(0,48).map(snapshotTile);
    const evidence={schema:"TEST_SELECTED_TILES_V1",at:new Date().toISOString(),
      round:window.CardTacticsRuntime?.getBattleSnapshot?.()?.round??null,
      weather:window.CardTacticsRuntime?.getBattleSnapshot?.()?.presentation?.environment?.weather??null,
      annotationType:reason.value,selectedCount:chosen.length,tiles:chosen,detailedTiles:detailed,
      detailedLimit:48,detailedTruncated:chosen.length>48,
      waterSeams:v?.water?.waterSeamDiagnostics?.()||null,
      terrainMeshes:{surface:meshSummary(v?.terrain?.meshes?.get("surface")),cliffs:meshSummary(v?.terrain?.meshes?.get("cliffs"))},
      fireLighting:{activeFireEffects:detailed.filter(t=>t.effects?.includes("BURNING")).length,
        sources:v?.environment?.fireLights?.map(light=>({name:light.name,enabled:light.isEnabled?.()??null,range:light.range,
          includedMeshCount:light.includedOnlyMeshes?.length??0,includesCliffs:light.includedOnlyMeshes?.includes(v?.terrain?.meshes?.get("cliffs"))??false})).slice(0,16)||[],
        fireFields:v?.environment?.fireFields?.size??null,lightFieldCells:v?.environment?.lightFieldCells??null},
      gpu:{webGLContextLost:v?.engine?._gl?.isContextLost?.()??null,webGLVersion:v?.engine?.webGLVersion??null},
      rendererEvidence:renderEvidence.capture()
    };
    d.push("TEST_TILE_ANNOTATION",evidence);
    d.capture("TEST_SELECTED_TILES"); // Existing capture force-persists the annotation event in Settings → TEST → LOG.
    status(`已標註 ${chosen.length} 格並寫入 Settings → TEST → LOG。`,true);
    end(false);
  }
  save.onclick=saveAnnotation;cancel.onclick=()=>end(false);undo.onclick=()=>{selected.clear();update()};
  const onHidden=()=>{if(document.hidden&&active)end(false)};
  const onPageExit=()=>{if(active)end(false)};
  document.addEventListener("visibilitychange",onHidden);
  window.addEventListener("pagehide",onPageExit);
  window.addEventListener("keydown",keydown,true);
  // Canvas listeners are attached by start() because TEST mounts before a
  // battlefield renderer may exist. Removed on every exit; never leak handlers.
  return{start,cancel:()=>end(false),isActive:()=>active};
}

function mount(){
 const battle=document.getElementById("battleScreen"),rail=document.querySelector(".battle-right-rail");if(!battle||!rail||document.getElementById("battleTestConsole"))return;ensureStyles();
 const toggle=document.createElement("button");toggle.id="battleTestToggle";toggle.type="button";toggle.textContent="TEST";toggle.title="Battle Test Console";rail.insertBefore(toggle,rail.querySelector("#endTurn")||null);
 const panel=document.createElement("aside");panel.id="battleTestConsole";panel.className="battle-test-console";panel.innerHTML=`<header><strong>Battle Test Console</strong><button id="battleTestClose" type="button">×</button></header><div class="battle-test-body">
 <section class="battle-test-section"><h4>天氣／環境</h4><div class="battle-test-row"><select id="testTimeOfDay"><option value="DAY">白天</option><option value="NIGHT">夜晚</option></select><button id="testApplyTimeOfDay">切換日夜</button></div><div class="battle-test-row"><select id="testMoonlight">${MOON_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select><button id="testApplyMoonlight">切換月光</button></div><div class="battle-test-row"><select id="testWeather">${WEATHER_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select><input id="testWeatherTurns" type="number" min="0" max="99" value="5"></div><button id="testApplyWeather">立即切換天氣</button><div class="battle-test-row"><select id="testWindDirection">${WIND_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select><input id="testWindStrength" type="number" min="0" max="8" step="0.1" value="1"></div><button id="testApplyWind">立即切換風向／風力</button><div class="battle-test-row triple"><input id="testEnvX" type="number" min="0" value="0" placeholder="X"><input id="testEnvY" type="number" min="0" value="0" placeholder="Y"><select id="testEnvForce">${FORCE_OPTIONS.map(([v,n])=>option(v,n)).join("")}</select></div><div class="battle-test-row"><button id="testApplyForce">套用環境力</button><button id="testClearTileEffects">清除格子效果</button></div></section>
 <section class="battle-test-section"><h4>卡牌／生成單位</h4><select id="testCard"></select><div class="battle-test-row"><button id="testGivePlayerCard">加入我方手牌</button><button id="testGiveEnemyCard">加入敵方手牌</button></div><div class="battle-test-row triple"><select id="testSpawnOwner"><option value="PLAYER">我方</option><option value="ENEMY" selected>敵方</option><option value="NEUTRAL">中立</option></select><input id="testSpawnX" type="number" min="0" value="0" placeholder="X"><input id="testSpawnY" type="number" min="0" value="0" placeholder="Y"></div><button id="testSpawnUnit">以角色卡直接生成</button></section>
 <section class="battle-test-section"><h4>單位站位</h4><select id="testUnit"></select><div class="battle-test-row"><input id="testMoveX" type="number" min="0" value="0" placeholder="X"><input id="testMoveY" type="number" min="0" value="0" placeholder="Y"></div><button id="testMoveUnit">立即改變站位</button></section>
 <section class="battle-test-section"><h4>道具／Gold</h4><select id="testItem">${items().map(item=>option(item.id,`${item.name}｜${item.id}`)).join("")}</select><div class="battle-test-row"><button id="testGiveItem">Call 到選定單位</button><button id="testGroundItem">Call 到單位腳下</button></div><button id="testAddGold">Gold +500</button></section>
 <section class="battle-test-section"><h4>問題格子標註／LOG</h4><p>標註模式僅取證，不移動單位、不改動地形或水文。點擊單格，或拖曳框選多格，完成後寫入設定中的診斷 LOG。</p><button id="testMarkTiles">標註問題格（點選／框選）</button><button id="testCaptureRender" type="button">記錄渲染異常狀態到 LOG</button></section>
 <div id="battleTestStatus" class="battle-test-status">待命。</div></div>`;battle.appendChild(panel);
 const $=id=>panel.querySelector(`#${id}`),status=(message,ok=true)=>{const el=$("battleTestStatus");el.textContent=message;el.classList.toggle("ok",ok);el.classList.toggle("bad",!ok)};
 const renderEvidence=makeRenderEvidence();
 const annotate=makeTileAnnotator(panel,status,renderEvidence,active=>{
   toggle.textContent=active?"退出標註":"TEST";
   toggle.title=active?"結束問題格標註，恢復戰棋操作":"Battle Test Console";
   toggle.setAttribute("aria-pressed",String(active));
 });
 $("testMarkTiles").onclick=()=>annotate.start();
 $("testCaptureRender").onclick=()=>{
   const d=window.CardTacticsDiagnostics;
   if(!d?.isEnabled?.()){status("請先在 Settings 開啟診斷紀錄。",false);return;}
   const evidence=renderEvidence.capture();d.push("TEST_RENDER_FORENSICS",evidence);
   d.capture("TEST_RENDER_FORENSICS");
   status("已記錄渲染狀態、Revision 對照與最近重建／異常事件。",true);
 };
 const cardSelect=$("testCard");for(const card of cards()){const kind=card.type==="CHARACTER"?"角色":"法術";cardSelect.insertAdjacentHTML("beforeend",option(card.id,`[${kind}] ${card.name}｜${card.id}`));}
 function syncEnvironmentControls(){const data=runtime()?.state?.(),wind=data?.wind;if(!wind)return;if(data?.moonlight)$("testMoonlight").value=data.moonlight;if(data?.timeOfDay)$("testTimeOfDay").value=data.timeOfDay;const direction=String(wind.direction||(wind.calm?"CALM":"CALM")).toUpperCase();if([...$("testWindDirection").options].some(o=>o.value===direction))$("testWindDirection").value=direction;$("testWindStrength").value=direction==="CALM"?0:Number(wind.strength||0)}
 function refreshUnits(){const debug=runtime(),data=debug?.state?.(),select=$("testUnit"),previous=select.value;select.innerHTML="";for(const unit of data?.units||[]){const team=unit.team==="P"?"我":unit.team==="E"?"敵":"中";select.insertAdjacentHTML("beforeend",option(unit.id,`[${team}] ${unit.name} (${unit.x},${unit.y})${unit.stealthed?"｜潛行":""}`));}if([...select.options].some(o=>o.value===previous))select.value=previous;syncMoveCoords()}
 function selectedUnit(){return runtime()?.state?.()?.units?.find(unit=>unit.id===$("testUnit").value)||null}
 function liveSelectedUnit(){return globalThis.UnitRuntimeEngine?.getLiveUnit?.($("testUnit").value)||null}
 function syncMoveCoords(){const unit=selectedUnit();if(!unit)return;$("testMoveX").value=unit.x;$("testMoveY").value=unit.y}
 toggle.onclick=()=>{if(annotate.isActive()){annotate.cancel();return;}panel.classList.toggle("open");if(panel.classList.contains("open")){refreshUnits();syncEnvironmentControls()}};$("battleTestClose").onclick=()=>panel.classList.remove("open");$("testUnit").onchange=syncMoveCoords;
 $("testApplyTimeOfDay").onclick=()=>{const ok=runtime()?.setTimeOfDay?.($("testTimeOfDay").value);status(ok?`日夜已切換：${$("testTimeOfDay").selectedOptions[0]?.textContent}`:"日夜切換失敗。",!!ok)};
 $("testApplyMoonlight").onclick=()=>{const ok=runtime()?.setMoonlight?.($("testMoonlight").value);status(ok?`月光已切換：${$("testMoonlight").selectedOptions[0]?.textContent}`:"月光切換失敗。",!!ok)};
 $("testApplyWeather").onclick=()=>{const ok=runtime()?.setWeather?.($("testWeather").value,Number($("testWeatherTurns").value));status(ok?`天氣已切換：${$("testWeather").selectedOptions[0]?.textContent}`:"天氣切換失敗。",!!ok)};
 $("testApplyWind").onclick=()=>{const direction=$("testWindDirection").value,strength=direction==="CALM"?0:Number($("testWindStrength").value),ok=runtime()?.setWind?.(direction,strength);status(ok?`風況已切換：${$("testWindDirection").selectedOptions[0]?.textContent}`:"風況切換失敗。",!!ok);if(ok)syncEnvironmentControls()};
 $("testWindDirection").onchange=()=>{if($("testWindDirection").value==="CALM")$("testWindStrength").value=0;else if(Number($("testWindStrength").value)<=0)$("testWindStrength").value=1};
 $("testApplyForce").onclick=()=>{const ok=runtime()?.applyEnvironmentForce?.(Number($("testEnvX").value),Number($("testEnvY").value),$("testEnvForce").value);status(ok?"環境力已套用。":"環境力套用失敗，請檢查座標。",!!ok)};
 $("testClearTileEffects").onclick=()=>{const ok=runtime()?.clearTileEffects?.(Number($("testEnvX").value),Number($("testEnvY").value));status(ok?"格子暫時效果已清除。":"清除失敗，請檢查座標。",!!ok)};
 $("testGivePlayerCard").onclick=()=>{const card=window.CARDS?.[cardSelect.value],ok=runtime()?.giveCard?.(cardSelect.value,"PLAYER");status(ok?`我方手牌加入：${card?.name||cardSelect.value}`:"加入我方手牌失敗。",!!ok)};
 $("testGiveEnemyCard").onclick=()=>{const card=window.CARDS?.[cardSelect.value],ok=runtime()?.giveCard?.(cardSelect.value,"ENEMY");status(ok?`敵方手牌加入：${card?.name||cardSelect.value}`:"加入敵方手牌失敗。",!!ok)};
 $("testSpawnUnit").onclick=()=>{const card=window.CARDS?.[cardSelect.value],ok=runtime()?.spawnCharacterCard?.(cardSelect.value,$("testSpawnOwner").value,Number($("testSpawnX").value),Number($("testSpawnY").value));status(ok?`已生成：${card?.name||cardSelect.value}`:"生成失敗：必須選角色卡、合法空格。",!!ok);if(ok)refreshUnits()};
 $("testMoveUnit").onclick=()=>{const unit=selectedUnit(),ok=runtime()?.moveUnit?.($("testUnit").value,Number($("testMoveX").value),Number($("testMoveY").value));status(ok?`${unit?.name||"單位"} 站位已更新。`:"移動失敗：請檢查單位、座標或該格是否被占用。",!!ok);if(ok)refreshUnits()};
 $("testGiveItem").onclick=()=>{const unit=liveSelectedUnit(),item=ItemDatabase.get($("testItem").value),payload=unit&&ItemRuntimeEngine.addItem(unit,item?.id,{owned:false,source:"DEBUG"});status(payload?`TEST｜${unit.character.name} 取得 ${item.name}。`:"Call 道具失敗：角色道具欄可能已滿。",!!payload);if(payload)window.CardTacticsRuntime?.refresh?.()};
 $("testGroundItem").onclick=()=>{const unit=liveSelectedUnit(),item=ItemDatabase.get($("testItem").value),payload=unit&&ItemInventoryEngine.spawnGroundItem(item?.id,unit.x,unit.y,{owned:false,source:"DEBUG"});status(payload?`TEST｜${item.name} 生成於 (${unit.x},${unit.y})。`:"地面生成失敗。",!!payload);if(payload)window.CardTacticsRuntime?.refresh?.()};
 $("testAddGold").onclick=()=>{const total=ItemInventoryEngine.addGold(500);status(`TEST｜Gold +500｜目前 ${total} G。`,true)};
 window.addEventListener("cardtactics:state",()=>{if(panel.classList.contains("open"))refreshUnits()});window.addEventListener("cardtactics:battle-render",()=>{if(panel.classList.contains("open"))refreshUnits()});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
