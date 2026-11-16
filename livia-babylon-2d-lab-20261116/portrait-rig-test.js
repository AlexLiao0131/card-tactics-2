/* 2.5D portrait mesh visual experiment, NOT a real 4-direction rig.
 * Source art is the canonical main-branch hero card illustration.
 * No gameplay, production rendering code or battle DOM is changed.
 */
/* Livia hybrid visual laboratory – independent of the Card Tactics 2.0 game.
 * Reads existing canonical battle rendering & environment modules from ../js/.
 * No original JS, HTML, saves, cards, combat rules, or PVP files are mutated.
 * Input actions here are visual demonstrations only, not gameplay commits.
 */
const $=id=>document.getElementById(id);
const canvas=$('battleCanvas'),statusEl=$('turnStatus');
const TILE_SIZE=2,ELEVATION_HEIGHT=.8;
const FACING=['E','S','W','N'];
const NAMES={E:'東',S:'南',W:'西',N:'北'};
let renderer,map,environment,cores=[],livia,stageData,lastEvents=[],revision=0,busy=false,tilesByKey=new Map();
let animation=null,pose='idle',frame=0,frameTime=0,attackEnd=0,moveQueue=[],moving=null;
let faceIndex=0,lastFrame=performance.now();
let portraitMode='mesh',portraitModeFrames=0,portraitTime=0;
const PORTRAIT_H=2.25;
const PORTRAIT_PATH='../assets/images/cards/heroes/livia.png';
function setStatus(msg,error=false){
 const first=String(msg).split('\n')[0];statusEl.textContent=first.length>110?first.slice(0,110)+'…':first;
 if(error){appendLog('啟動或同步錯誤：'+msg,true);$('battleLogShell').classList.add('active');}
}
function tileAt(x,y){return map?.tiles?.find(tile=>tile.x===x&&tile.y===y)||null;}
function canShowAt(tile){return tile&&tile.terrain!=='WALL'&&!((map.objects||[]).some(o=>!o.destroyed&&o.blocksMovement&&o.x===tile.x&&o.y===tile.y));}
function groundY(tile){
 if(!tile)return 0;
 const resolver=renderer?.terrain?.surfaceResolver;
 const sampled=resolver?.sampleRenderedHeight?.(tile,tilesByKey,0,0);
 const height=Number.isFinite(sampled)?sampled:Number(tile.elevation||0);
 const water=Number(tile.waterDepth||0)>.0001?Number(tile.waterSurfaceZ):null;
 return Math.max(height,Number.isFinite(water)?water:height)*ELEVATION_HEIGHT;
}
async function bootCore(){
 const modules=['terrain-database.js','environment-object-engine.js','map-database.js','hydrology-engine.js','mass-flow-engine.js','climate-engine.js','environment-resolver.js','map-generator.js','conductivity-engine.js','environment-engine.js','visual-database.js','unit-animation-engine.js'];
 for(let i=0;i<modules.length;i++){
  setStatus(`原版環境模組 ${i+1}/${modules.length}：${modules[i]}`);
  await import(`../js/${modules[i]}`);
 }
 if(!globalThis.HydrologyEngine||!globalThis.MapGenerator||!globalThis.EnvironmentEngine)throw Error('原版地圖與環境規則尚未就緒');
}
function initMap(){
 const mode=new URLSearchParams(location.search).get('map')==='static'?'static':'generated';
 if(mode==='static'){
  map=MapDatabase.createMap('versus_core_field');
  cores=[];stageData={mode:'固定測試地圖'};
 }else{
  try{
   const generated=MapGenerator.generateVersus({size:'MEDIUM',seed:20261115});
   map=generated.map;cores=generated.cores||[];stageData={mode:'原版中型隨機地圖',meta:generated.meta};
  }catch(error){
   console.error('原版隨機地圖生成失敗，切換為官方固定地圖',error);
   map=MapDatabase.createMap('versus_core_field');cores=[];stageData={mode:'原版固定地圖（自動回退）'};
  }
 }
 tilesByKey=new Map(map.tiles.map(tile=>[`${tile.x},${tile.y}`,tile]));
 // Same canonical subsystem order as original BattleSetupEngine.
 EnvironmentObjectEngine.initializeMap(map,{seed:map.seed??map.id});
 HydrologyEngine.initializeMap(map);
 environment=EnvironmentEngine.create({timeOfDay:'DAY',moonlight:'PARTIAL',weather:'CLEAR'});
 ClimateEngine.initializeMap(map,environment);
 revision=0;
}
function snapshot(){
 const env=EnvironmentEngine,weather=env.legacyWeather(environment),wind=env.windAt(environment);
 return{
  revision:++revision,round:Number(environment.climate?.turn||0)+1,phase:'PLAYER_TURN',mode:'command',
  map,cores,units:[],selected:null,
  presentation:{
   environment:{weather,timeOfDay:environment.timeOfDay,moonlight:environment.moonlight,wind,
    precipitation:env.precipitationAt(environment),fog:env.fogAt(environment),thunder:env.thunderAt(environment),
    climate:env.climateSnapshot(environment),lightSources:[]},
   deploymentPoints:[],capturableTiles:[],areas:[],visibility:{},
  },
 };
}
function diagnostics(){
 if(!renderer)return;
 const issues=renderer.subsystemErrors;
 if(issues?.size){
  const brief=[...issues.entries()].slice(0,4).map(([name,err])=>`${name}: ${String(err).split('\n')[0]}`).join('\n');
  if(diagnostics.last!==brief){diagnostics.last=brief;setStatus(`原版渲染器同步問題：\n${brief}`,true);}
 }
}
function publish(){
 if(!renderer||!map)return;
 renderer.sync(snapshot(),lastEvents);
 lastEvents=[];
 if(livia)placeLivia();
 diagnostics();
 const weather=EnvironmentEngine.legacyWeather(environment);
 const weatherLabels={CLEAR:'晴朗',FOG:'迷霧',RAIN:'雨',HEAVY_RAIN:'豪雨',THUNDERSTORM:'雷暴',TYPHOON:'颱風',SNOW:'降雪',BLIZZARD:'暴風雪',SCORCHING_SUN:'烈日'};
 $('weatherIndicator').textContent=`${environment.timeOfDay==='DAY'?'☀':'☾'} ${weatherLabels[weather]||weather}`;
 $('mapMeta').textContent=`${stageData?.mode||''}｜${map.width}×${map.height}｜環境回合 ${environment.climate?.turn||0}｜${environment.timeOfDay==='DAY'?'白天':'夜晚'}｜${weatherLabels[weather]||weather}`;
 $('playerCoreHp').textContent=cores[0]?`${cores[0].hp}/${cores[0].maxHp}`:'—';
 $('enemyCoreHp').textContent=cores[1]?`${cores[1].hp}/${cores[1].maxHp}`:'—';
 if(cores.length)$('versusCoreHud').classList.add('available');
 refreshEnvironmentControls();
}
async function prepareRenderer(){
 const {BabylonRenderer}=await import('../js/babylon-renderer.js');
 renderer=new BabylonRenderer(canvas,snapshot(),{onTilePicked:(x,y)=>onTileClicked(x,y)});
 globalThis.HybridLiviaDebug=Object.freeze({getRenderer:()=>renderer,getMap:()=>map,getClimate:()=>environment});
 renderer.sync(snapshot());
 const e=[...renderer.subsystemErrors.keys()];
 if(e.includes('terrain')||e.includes('water'))throw Error('原版 Babylon 地形／水面模組載入失敗：'+e.join(', '));
}
function originTile(){
 const midX=Math.floor(map.width*.35),midY=Math.floor(map.height*.5);
 const c=map.tiles.filter(canShowAt).sort((a,b)=>
  Math.hypot(a.x-midX,a.y-midY)-Math.hypot(b.x-midX,b.y-midY) || a.y-b.y);
 return c[0]||map.tiles[0];
}
// Tessellated single-image quad: the same source artwork is sampled at every
// vertex, so face, costume and equipment do not mutate between animation poses.
// This is a FRONT-VIEW-only proof of concept: no real side/back art is inferred.
function buildPortraitMesh(scene,aspect){
 const rows=28,cols=18,width=PORTRAIT_H*aspect,vertices=[],uvs=[],indices=[];
 for(let j=0;j<=rows;j++){
  const v=j/rows;
  for(let i=0;i<=cols;i++){
   const u=i/cols;
   vertices.push((u-.5)*width,(v-.5)*PORTRAIT_H,0);
   uvs.push(u,v);
  }
 }
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;
  indices.push(a,c,b,b,c,d);
 }
 const mesh=new BABYLON.Mesh('livia-portrait-deformable',scene);
 const vertexData=new BABYLON.VertexData();
 vertexData.positions=vertices;vertexData.indices=indices;vertexData.uvs=uvs;
 vertexData.applyToMesh(mesh,true);
 mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
 mesh.isPickable=false;mesh.renderingGroupId=0;
 return {mesh,base:new Float32Array(vertices),coords:new Float32Array(uvs),positions:new Float32Array(vertices),width};
}
async function prepareLivia(){
 const scene=renderer.scene;
 const tex=await new Promise((resolve,reject)=>{
  let texture;
  texture=new BABYLON.Texture(
   PORTRAIT_PATH,scene,false,true,BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
   ()=>resolve(texture),
   (message,exception)=>reject(new Error(`正式立繪載入失敗：${PORTRAIT_PATH}｜${message||exception?.message||'未知錯誤'}`))
  );
  if(texture.isReady())resolve(texture);
 });
 tex.hasAlpha=true;
 tex.wrapU=tex.wrapV=BABYLON.Texture.CLAMP_ADDRESSMODE;
 const size=tex.getSize();
 if(!size.width||!size.height)throw Error('正式立繪的 PNG 尺寸無效');
 const portrait=buildPortraitMesh(scene,size.width/size.height);
 const material=new BABYLON.StandardMaterial('livia-single-art-2d-mesh',scene);
 material.diffuseTexture=tex;
 material.useAlphaFromDiffuseTexture=true;
 material.transparencyMode=BABYLON.Material.MATERIAL_ALPHATEST;
 material.alphaCutOff=.08;
 material.disableLighting=true;
 material.emissiveColor=BABYLON.Color3.White();
 material.specularColor=BABYLON.Color3.Black();
 material.backFaceCulling=false;
 portrait.mesh.material=material;
 const shadow=BABYLON.MeshBuilder.CreateDisc('livia-contact-shadow',{radius:.50,tessellation:28},scene);
 shadow.rotation.x=Math.PI/2;shadow.isPickable=false;
 const sm=new BABYLON.StandardMaterial('livia-contact-shadow-mat',scene);
 sm.diffuseColor=BABYLON.Color3.Black();sm.alpha=.30;sm.disableLighting=true;
 shadow.material=sm;
 const tile=originTile();
 livia={mesh:portrait.mesh,shadow,material,texture:tex,portrait,x:tile.x,y:tile.y,drawX:tile.x,drawY:tile.y};
 placeLivia();
 scene.onBeforeRenderObservable.add(updateSpriteFrame);
 setPose('idle');
}
function placeLivia(){
 if(!livia||!map)return;
 const x=livia.drawX,y=livia.drawY;
 const t=tileAt(Math.round(x),Math.round(y))||tileAt(livia.x,livia.y);
 let h=groundY(t);
 if(moving){
  const from=tileAt(moving.fromX,moving.fromY),to=tileAt(moving.toX,moving.toY);
  const length=Math.hypot(moving.toX-moving.fromX,moving.toY-moving.fromY)||1;
  const fraction=Math.max(0,Math.min(1,Math.hypot(x-moving.fromX,y-moving.fromY)/length));
  h=groundY(from)+(groundY(to)-groundY(from))*fraction;
 }
 // The bottom of the original portrait is anchored at rendered terrain height.
 livia.mesh.position.set(x*TILE_SIZE,h+PORTRAIT_H*.5+.02,y*TILE_SIZE);
 livia.shadow.position.set(x*TILE_SIZE,h+.025,y*TILE_SIZE);
 // No mirrored side view: this experiment is explicitly a single source angle.
 livia.mesh.scaling.x=1;
}
function setPose(name){pose=name;frame=0;frameTime=0;updatePose();}
function applySpriteTexture(){/* Not used: one unchanged full-resolution source texture. */}
function updatePortraitDeformation(dt,now){
 if(!livia)return;
 const rig=livia.portrait,src=rig.base,dst=rig.positions,uv=rig.coords;
 const t=now*.001;
 const walking=pose==='walk',acting=pose==='attack';
 let impact=0;
 if(acting){
  const p=Math.max(0,Math.min(1,1-(attackEnd-now)/750));
  impact=Math.sin(Math.PI*p);
 }
 const bodyBreath=Math.sin(t*2.4);
 const step=Math.sin(t*9.4);
 for(let i=0;i<src.length;i+=3){
  const uvIndex=i/3*2,u=uv[uvIndex],v=uv[uvIndex+1],x=src[i],y=src[i+1];
  let dx=0,dy=0;
  if(portraitMode==='mesh'){
   // All terms fade toward both feet and the highest hair pixel to reduce
   // UV tearing at contour boundaries. This is illustrative 2.5D warp,
   // not skeletal animation nor an invented rear/side perspective.
   const mid=Math.max(0,Math.sin(Math.PI*v));
   const upper=Math.max(0,Math.min(1,(v-.26)/.53));
   const cape=Math.pow(1-v,1.6)*Math.max(0,(u-.43)/.57);
   dx += .014*bodyBreath*mid*upper;
   dx += .055*Math.sin(t*1.8+v*3)*cape;
   dy += .007*bodyBreath*mid*upper;
   if(walking){dx += .045*step*mid;dy += .022*Math.abs(step)*mid;}
   if(acting){dx += .12*impact*upper*mid;dy += .035*impact*upper*mid;}
  }
  dst[i]=x+dx;dst[i+1]=y+dy;dst[i+2]=0;
 }
 rig.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind,dst,false,false);
}
function updatePose(){
 $('contextHudSlot').textContent=`莉維亞｜${pose==='idle'?'待機':pose==='walk'?'移動動勢':'出招動勢'}｜${portraitMode==='mesh'?'2.5D 網格變形':'原始立繪（無變形）'}`;
}
function togglePortraitMode(){
 portraitMode=portraitMode==='mesh'?'flat':'mesh';
 updatePose();
 setStatus(`對照：${portraitMode==='mesh'?'網格變形':'原圖無變形'}。只測試正面立繪，沒有產生假的左右／背面。`);
}
function autoWalk(){
 if(!livia||moving||moveQueue.length)return;
 const from=tileAt(livia.x,livia.y);
 const candidates=[[1,0],[0,1],[-1,0],[0,-1]].map(([dx,dy])=>tileAt(livia.x+dx,livia.y+dy)).filter(canShowAt)
  .filter(t=>Math.abs(Number(t.elevation||0)-Number(from.elevation||0))<=1);
 const target=candidates[0]||originTile();
 if(target&&target!==from)startMoveTo(target.x,target.y);
 else setStatus('目前沒有合適的相鄰展示格，請點選其他位置。');
}
function startMoveTo(x,y){
 if(!livia||!map)return false;
 const dest=tileAt(x,y);
 if(!canShowAt(dest))return false;
 if(moving)return false;
 if(dest.x===livia.x&&dest.y===livia.y){setPose('idle');return true;}
 // Movement is visual-only; no action costs or gameplay engine state is changed.
 const dx=x-livia.x,dy=y-livia.y;
 faceIndex=Math.abs(dx)>=Math.abs(dy)?(dx>=0?0:2):(dy>=0?1:3);
 moving={fromX:livia.x,fromY:livia.y,toX:x,toY:y,start:performance.now(),duration:Math.max(420,Math.hypot(dx,dy)*350)};
 setPose('walk');
 return true;
}
function playAttack(){if(!livia)return;moving=null;livia.drawX=livia.x;livia.drawY=livia.y;setPose('attack');attackEnd=performance.now()+750;}
function updateSpriteFrame(){
 if(!livia)return;
 const now=performance.now(),dt=Math.min(.07,(now-lastFrame)/1000);lastFrame=now;
 if(moving){
  const t=Math.min(1,(now-moving.start)/moving.duration);
  const eased=t*t*(3-2*t);
  livia.drawX=moving.fromX+(moving.toX-moving.fromX)*eased;
  livia.drawY=moving.fromY+(moving.toY-moving.fromY)*eased;
  if(t>=1){livia.x=moving.toX;livia.y=moving.toY;livia.drawX=livia.x;livia.drawY=livia.y;moving=null;setPose('idle');}
 }
 if(pose==='attack'&&now>=attackEnd)setPose('idle');
 frameTime+=dt;
 updatePortraitDeformation(dt,now);
 placeLivia();
 if(commandVisible&&Math.round(now/90)!==Math.round((now-dt*1000)/90))updateCommandAnchor();
}
function cycleFace(){togglePortraitMode();}
async function advanceTurn(){
 if(busy||!environment)return;
 busy=true;
 try{
  setStatus('原版 EnvironmentEngine 正在更新氣候／水文…');
  await new Promise(r=>requestAnimationFrame(r));
  lastEvents=EnvironmentEngine.advanceEnvironmentTurn(map,environment);
  publish();
 }catch(e){setStatus('原版環境回合失敗：'+(e.stack||e.message),true);}
 finally{busy=false;}
}

// This lab uses the actual BattleUI DOM, its CSS and the native battle camera.
// Only the command CONTENT is visual-only and lives in the original #skillBar.
let awaitingTile=false, commandVisible=false, selectedTile=null;
const weatherName={CLEAR:'晴朗',FOG:'迷霧',RAIN:'雨',HEAVY_RAIN:'豪雨',THUNDERSTORM:'雷暴',TYPHOON:'颱風',SNOW:'降雪',BLIZZARD:'暴風雪',SCORCHING_SUN:'烈日'};
function appendLog(msg,error=false){
 const line=document.createElement('div');line.className=error?'lab-error':'lab-msg';line.textContent=String(msg);
 $('battleLog').prepend(line);
 while($('battleLog').children.length>50)$('battleLog').lastChild?.remove();
}
function openCommand(){
 if(!livia)return;
 commandVisible=true;
 const bar=$('skillBar');bar.replaceChildren();
 const h=document.createElement('strong');h.textContent='莉維亞';bar.appendChild(h);
 const items=[['移動',()=>{awaitingTile=true;closeCommand();setStatus('移動：點選目的地格（僅視覺測試）');}],
 ['攻擊',()=>{playAttack();closeCommand();setStatus('莉維亞｜攻擊展示');}],
 ['待機',()=>{moving=null;livia.drawX=livia.x;livia.drawY=livia.y;setPose('idle');closeCommand();setStatus('莉維亞｜待機展示');}],
 ['原圖／2.5D 對照',()=>{cycleFace();openCommand();}]];
 for(const [name,action] of items){const b=document.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',action);bar.appendChild(b);}
 updateCommandAnchor();
}
function closeCommand(){commandVisible=false;$('skillBar').replaceChildren();}
function updateCommandAnchor(){
 if(!livia||!renderer||!commandVisible)return;
 const target=livia.mesh.position.clone();target.y+=.6;
 const camera=renderer.camera.camera,scene=renderer.scene,engine=renderer.engine;
 const projected=BABYLON.Vector3.Project(target,BABYLON.Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));
 const box=canvas.getBoundingClientRect();
 $('skillBar').style.setProperty('--menu-x',`${box.left+projected.x*box.width/Math.max(1,engine.getRenderWidth())}px`);
 $('skillBar').style.setProperty('--menu-y',`${box.top+projected.y*box.height/Math.max(1,engine.getRenderHeight())}px`);
}
function onTileClicked(x,y){
 const tile=tileAt(x,y);if(!tile)return false;
 if(awaitingTile){
   awaitingTile=false;
   if(!startMoveTo(x,y)){setStatus('此格無法做移動展示：障礙物或單位尚在移動');openCommand();return false;}
   return true;
 }
 if(livia&&x===livia.x&&y===livia.y){openCommand();return true;}
 selectedTile=tile;showTileInspection(tile);
 closeCommand();
 return true;
}
function showTileInspection(tile){
 const text=[`格 (${tile.x}, ${tile.y})`, `地形 ${tile.terrain}`,`高度 ${tile.elevation??0}`,`水深 ${Number(tile.waterDepth||0).toFixed(3)}`,`積雪 ${Number(tile.snowDepth||0).toFixed(3)}`,`冰厚 ${Number(tile.iceThickness||0).toFixed(3)}`];
 $('contextTileTitle').textContent=text[0];
 $('contextTileMeta').textContent=`地形：${tile.terrain}｜高度：${tile.elevation??0}`;
 $('contextTileStatus').textContent=`環境：${EnvironmentEngine.legacyWeather(environment)}`;
 $('contextTileDetails').textContent=text.join('\n');
 showInspectorTab('tile');$('battleContextInspector').classList.add('open');
}
function showUnitInspection(){
 if(!livia)return;
 $('contextHudSlot').textContent='莉維亞｜原圖 2.5D 網格測試（單一正面視角）';
 $('contextUnitStats').textContent='同一張正式立繪：呼吸、披風與移動動勢。未生成真實側面或背面；出招非真正骨架動畫。原版戰鬥規則未變。';
 $('contextUnitPosition').textContent=`(${livia.x}, ${livia.y})｜單正面｜${pose}｜${portraitMode}`;
 showInspectorTab('unit');$('battleContextInspector').classList.add('open');
}
function showInspectorTab(tab){
 $('contextUnitPanel').style.display=tab==='unit'?'block':'none';
 $('contextTilePanel').style.display=tab==='tile'?'block':'none';
}
function buildEnvironmentControls(){
 const content=$('mapStageInfo');content.replaceChildren();
 const instructions=document.createElement('div');instructions.className='lab-note';
 instructions.textContent='原始立繪 2.5D 測試：不生成新方向圖片，保留原角色的臉與裝備。點莉維亞開指令選單可切換「原圖／網格變形」；地形、天候與鏡頭使用原版系統。此版本不代表已實現四方向。';
 content.appendChild(instructions);
 const makeRow=(name,element)=>{const label=document.createElement('label');label.className='lab-field';label.textContent=name;label.appendChild(element);content.append(label);};
 const weather=document.createElement('select');weather.id='labWeather';
 for(const [value,name] of Object.entries(weatherName)){const opt=new Option(name,value);weather.add(opt);}
 makeRow('天氣',weather);
 const moon=document.createElement('select');moon.id='labMoon';
 for(const [id,name] of [['FULL','滿月'],['PARTIAL','半月'],['NONE','無月']])moon.add(new Option(name,id));
 makeRow('月相',moon);
 const mapMode=document.createElement('select');mapMode.id='labMap';mapMode.add(new Option('原版隨機中型地圖','generated'));mapMode.add(new Option('原版固定測試地圖','static'));
 makeRow('地圖',mapMode);
 const line=document.createElement('div');line.className='lab-line';
 const dayNight=document.createElement('button');dayNight.textContent='日夜切換';
 dayNight.addEventListener('click',()=>{EnvironmentEngine.setTimeOfDay(environment,environment.timeOfDay==='DAY'?'NIGHT':'DAY');publish();});
 line.appendChild(dayNight);content.appendChild(line);
 weather.addEventListener('change',()=>{try{EnvironmentEngine.setWeather(environment,weather.value,map,{applyPulse:false});publish();}catch(e){setStatus('氣候切換失敗：'+String(e.message||e),true);}});
 moon.addEventListener('change',()=>{EnvironmentEngine.setMoonlight(environment,moon.value);publish();});
 mapMode.addEventListener('change',()=>{const url=new URL(location.href);url.searchParams.set('map',mapMode.value);location.assign(url.toString());});
 refreshEnvironmentControls();
}
function refreshEnvironmentControls(){
 if(!environment)return;
 const value=EnvironmentEngine.legacyWeather(environment);
 if($('labWeather'))$('labWeather').value=value;
 if($('labMoon'))$('labMoon').value=environment.moonlight||'PARTIAL';
 if($('labMap'))$('labMap').value=new URLSearchParams(location.search).get('map')==='static'?'static':'generated';
}
function wire(){
 $('battleBack').onclick=()=>location.assign('../');
 $('resetMap').onclick=()=>location.reload();
 $('rotateLeft').onclick=()=>renderer?.rotate(-1);
 $('rotateRight').onclick=()=>renderer?.rotate(1);
 $('projectionToggle').onclick=()=>{renderer?.toggleProjection();$('projectionToggle').textContent=renderer?.camera?.projection==='ISO'?'正視圖':'斜視圖';};
 $('resetView').onclick=()=>renderer?.resetView();
 $('endTurn').onclick=advanceTurn;
 $('nextUnit').onclick=()=>{awaitingTile=false;showUnitInspection();openCommand();};
 $('mapToggle').onclick=()=>{$('mapInfoShell').classList.toggle('open');};
 $('mapClose').onclick=()=>{$('mapInfoShell').classList.remove('open');};
 $('logToggle').onclick=()=>{$('battleLogShell').classList.toggle('active');};
 $('logClose').onclick=()=>{$('battleLogShell').classList.remove('active');};
 $('contextClose').onclick=()=>{$('battleContextInspector').classList.remove('open');};
 $('contextUnitTab').onclick=showUnitInspection;
 $('contextTileTab').onclick=()=>{if(selectedTile)showTileInspection(selectedTile);};
 document.querySelectorAll('#battleLogTabs [data-log-type]').forEach(btn=>btn.addEventListener('click',()=>{}));
 window.addEventListener('cardtactics:battle-inspect-hold',ev=>{
   const point=ev.detail;if(!point||!livia)return;
   const tile=tileAt(point.x,point.y);
   if(point.x===livia.x&&point.y===livia.y)showUnitInspection();else if(tile)showTileInspection(tile);
 });
}
async function main(){
 try{
  if(!window.BABYLON)throw Error('Babylon.js CDN 沒有載入。請使用 Safari 開啟 GitHub Pages。');
  if(!BABYLON.MixMaterial)throw Error('原版地圖需要 Babylon Materials Library，CDN 載入失敗。');
  if(!document.querySelector('#battleScreen.active > #battleCanvas'))throw Error('原版戰場結構未完整建立。');
  wire();
  await bootCore();initMap();buildEnvironmentControls();
  await prepareRenderer();await prepareLivia();
  publish();openCommand();
  appendLog('莉維亞原始高清立繪 + 2.5D 網格變形測試已啟動。沒有生成新角色圖、假四方向，正式遊戲未修改。');
  setStatus('莉維亞｜原圖 2.5D 測試。使用指令選單切換網格變形與純原圖；此頁只有正面。');
 }catch(error){console.error(error);setStatus(`啟動失敗：${error?.message||error}\n${String(error?.stack||'').slice(0,1000)}`,true);}
}
main();
