/* Livia hybrid visual laboratory – independent of the Card Tactics 2.0 game.
 * Reads existing canonical battle rendering & environment modules from ../js/.
 * No original JS, HTML, saves, cards, combat rules, or PVP files are mutated.
 * Input actions here are visual demonstrations only, not gameplay commits.
 */
const $=id=>document.getElementById(id);
const status=$('status'),canvas=$('battleCanvas');
const TILE_SIZE=2,ELEVATION_HEIGHT=.8;
const FACING=['E','S','W','N'];
const NAMES={E:'東',S:'南',W:'西',N:'北'};
let renderer,map,environment,cores=[],livia,stageData,lastEvents=[],revision=0,busy=false,tilesByKey=new Map();
let animation=null,pose='idle',frame=0,frameTime=0,attackEnd=0,moveQueue=[],moving=null;
let faceIndex=0,lastFrame=performance.now();
function setStatus(msg,error=false){status.textContent=msg;status.classList.toggle('error',error);}
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
 const mode=$('map').value;
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
 const e=renderer.subsystemErrors;
 if(e?.size){
  const brief=[...e.entries()].slice(0,3).map(([name,err])=>`${name}: ${String(err).split('\n')[0]}`).join('\n');
  setStatus(`原版渲染器有 ${e.size} 個模組尚未成功同步：\n${brief}`,true);
 }else if(!status.classList.contains('error')){
  setStatus(`Babylon 3D 場景就緒｜${map.width}×${map.height}｜2D 莉維亞獨立 Sprite。點地格或按「移動展示」檢查高低差。`);
 }
}
function publish(){
 if(!renderer||!map)return;
 renderer.sync(snapshot(),lastEvents);
 lastEvents=[];
 if(livia)placeLivia();
 diagnostics();
 const w=EnvironmentEngine.legacyWeather(environment);
 $('hudEnv').textContent=`${environment.timeOfDay==='DAY'?'☀ 白天':'☾ 夜晚'} · ${w}\n環境回合 ${environment.climate?.turn||0}`;
}
async function prepareRenderer(){
 const {BabylonRenderer}=await import('../js/babylon-renderer.js');
 renderer=new BabylonRenderer(canvas,snapshot(),{onTilePicked:(x,y)=>startMoveTo(x,y)});
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
async function prepareLivia(){
 // Authentic 2D sprite sheet from supplied Livia character reference.
 const paths=['idle','walk','attack'].flatMap(name=>Array.from({length:4},(_,i)=>`./assets/livia-${name}-${i}.png`));
 const textures=paths.map(path=>new BABYLON.Texture(path,renderer.scene,false,false,BABYLON.Texture.NEAREST_SAMPLINGMODE));
 await Promise.all(textures.map(tex=>new Promise((res,rej)=>{
  if(tex.isReady())return res();tex.onLoadObservable.addOnce(res);tex.onErrorObservable.addOnce(()=>rej(Error('角色貼圖載入失敗')));
 })));
 const material=new BABYLON.StandardMaterial('livia-sprite-material',renderer.scene);
 material.diffuseTexture=textures[0];
 material.useAlphaFromDiffuseTexture=true;material.transparencyMode=BABYLON.Material.MATERIAL_ALPHATEST;
 material.alphaCutOff=.3;material.disableLighting=true;material.emissiveColor=BABYLON.Color3.White();
 material.backFaceCulling=false;material.specularColor=BABYLON.Color3.Black();
 const mesh=BABYLON.MeshBuilder.CreatePlane('livia-2d-character',{width:2.25,height:2.25},renderer.scene);
 mesh.material=material;mesh.billboardMode=BABYLON.Mesh.BILLBOARDMODE_ALL;
 mesh.isPickable=false;mesh.renderingGroupId=0;
 const shadow=BABYLON.MeshBuilder.CreateDisc('livia-contact-shadow',{radius:.50,tessellation:28},renderer.scene);
 shadow.rotation.x=Math.PI/2;shadow.isPickable=false;
 const sm=new BABYLON.StandardMaterial('livia-contact-shadow-mat',renderer.scene);
 sm.diffuseColor=BABYLON.Color3.Black();sm.alpha=.30;sm.disableLighting=true;sm.emissiveColor=BABYLON.Color3.Black();shadow.material=sm;
 const tile=originTile();
 livia={mesh,shadow,material,textures,x:tile.x,y:tile.y,drawX:tile.x,drawY:tile.y};
 placeLivia();
 renderer.scene.onBeforeRenderObservable.add(updateSpriteFrame);
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
 livia.mesh.position.set(x*TILE_SIZE,h+.965,y*TILE_SIZE);
 livia.shadow.position.set(x*TILE_SIZE,h+.025,y*TILE_SIZE);
 livia.mesh.scaling.x=FACING[faceIndex]==='W'?-1:1;
}
function setPose(name){pose=name;frame=0;frameTime=0;applySpriteTexture();updatePose();}
function applySpriteTexture(){
 if(!livia)return;
 const offset=pose==='idle'?0:pose==='walk'?4:8;
 const tex=livia.textures[offset+frame];
 livia.material.diffuseTexture=tex;
}
function updatePose(){
 $('pose').textContent=`${pose==='idle'?'待機':pose==='walk'?'移動':'攻擊'} / 朝${NAMES[FACING[faceIndex]]}`;
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
 const delay=pose==='idle'?.26:pose==='walk'?.14:.17;
 if(frameTime>=delay){frameTime%=delay;frame=(frame+1)%4;applySpriteTexture();}
 placeLivia();
}
function cycleFace(){faceIndex=(faceIndex+1)%4;placeLivia();updatePose();}
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
function wire(){
 $('idle').onclick=()=>{moving=null;if(livia){livia.drawX=livia.x;livia.drawY=livia.y;}setPose('idle')};
 $('walk').onclick=autoWalk;
 $('attack').onclick=playAttack;
 $('face').onclick=cycleFace;
 $('rotateLeft').onclick=()=>renderer?.rotate(-1);
 $('rotateRight').onclick=()=>renderer?.rotate(1);
 $('zoomIn').onclick=()=>renderer?.camera?.zoomBy(1.18);
 $('zoomOut').onclick=()=>renderer?.camera?.zoomBy(.85);
 $('dayNight').onclick=()=>{if(!environment)return;EnvironmentEngine.setTimeOfDay(environment,environment.timeOfDay==='DAY'?'NIGHT':'DAY');publish()};
 $('weather').onchange=()=>{
  if(!environment)return;
  try{EnvironmentEngine.setWeather(environment,$('weather').value,map,{duration:5,applyPulse:false});publish()}
  catch(e){setStatus('天氣切換失敗：'+e.message,true)}
 };
 $('turn').onclick=advanceTurn;
 $('reset').onclick=()=>location.reload();
 $('map').onchange=()=>{const url=new URL(location.href);url.searchParams.set('map',$('map').value);location.assign(url.href);};
}
async function main(){
 try{
  if(!window.BABYLON)throw Error('Babylon.js CDN 沒有載入。請使用 Safari 開啟 GitHub Pages。');
  if(!BABYLON.MixMaterial)throw Error('原版地圖需要 Babylon Materials Library，CDN 載入失敗。');
  const requested=new URLSearchParams(location.search).get('map');
  if(requested==='static'||requested==='generated')$('map').value=requested;
  wire();await bootCore();initMap();await prepareRenderer();await prepareLivia();
  publish();
  setStatus('原版 Babylon 3D 地圖 + 莉維亞 2D 角色已載入。可點擊地格測試定位。這是視覺隔離原型，沒有動到主遊戲。');
 }catch(error){console.error(error);setStatus(`啟動失敗：${error?.message||error}\n${String(error?.stack||'').slice(0,500)}`,true);}
}
main();
