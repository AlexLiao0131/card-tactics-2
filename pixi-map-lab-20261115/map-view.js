/* Card Tactics 2.0 — PixiJS map viewer.
 * Uses the existing game's MapGenerator, HydrologyEngine, ClimateEngine and
 * EnvironmentEngine. This file owns DISPLAY and INPUT only. No gameplay rules.
 */
const statusEl=document.getElementById('status');
const stageEl=document.getElementById('stage');
const controls=document.getElementById('controls');
const info=document.getElementById('tileinfo');
const $=q=>document.querySelector(q);
const DEBUG=false;
const TERRAIN_KEYS=['PLAIN','FOREST','HIGH_GROUND','MUD','SAND','WALL','WATERBED','SNOW','ICE','WET'];
const TERRAIN_LABEL={PLAIN:'平地',FOREST:'森林',HIGH_GROUND:'高地',MUD:'泥濘',SAND:'沙地',WALL:'岩壁',WATER:'水域'};
const WEATHER_LABEL={CLEAR:'晴朗',FOG:'濃霧',RAIN:'降雨',HEAVY_RAIN:'豪雨',THUNDERSTORM:'雷暴',TYPHOON:'颱風',SNOW:'降雪',BLIZZARD:'暴風雪',SCORCHING_SUN:'烈日'};
const TILE_W=96,TILE_H=48,HALF_W=TILE_W/2,HALF_H=TILE_H/2,ELEV=23,PROP_W=112,PROP_H=150;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hex=(r,g,b)=>r*65536+g*256+b;
const hash=(x,y,k=0)=>{let h=(Math.imul(x+31,73856093)^Math.imul(y+41,19349663)^Math.imul(k+63,83492791))>>>0;h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;return h>>>0;};
const iso=(x,y,z=0)=>({x:(x-y)*HALF_W,y:(x+y)*HALF_H-z*ELEV});
const num=(n)=>Number(n||0);
const asFixed=(n,d=2)=>num(n).toFixed(d);
let app=null,PIXI=null,map=null,engineState=null,generated=null,graphics={},core=[],deploymentPoints=[],currentMode='static';
let camera={zoom:1,x:0,y:0,panX:0,panY:0};
let mapContainer=null,tilesLayer=null,fxWorld=null,pointerLayer=null,weatherLayer=null;
let selected=null,hovered=null,gridVisible=false;
let atlasTerrain=null,atlasProps=null,terrainFrames={},propFrames={};
let lastWeatherKey='',currentPhase=0,autoTimer=null,tickerTime=0,lastFxDraw=-1,lastEvents=[],busy=false;
let pointerData=new Map(),gesture=null,activeDrag=false;
let tilesList=[],propsList=[],flowList=[],weatherStreaks=[];
function status(txt,error=false){statusEl.textContent=txt;statusEl.classList.toggle('error',error);}

async function loadScript(url){return new Promise((resolve,reject)=>{
 const s=document.createElement('script');s.src=url;s.async=true;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('無法載入 '+url));};document.head.appendChild(s);
});}
async function bootPixi(){
 const cdns=['https://cdn.jsdelivr.net/npm/pixi.js@8.23.0/dist/pixi.min.js','https://unpkg.com/pixi.js@8.23.0/dist/pixi.min.js'];
 for(const uri of cdns){try{await loadScript(uri);if(window.PIXI)return window.PIXI;}catch(e){}}
 throw Error('PixiJS CDN 無法載入。請用 Safari 開啟 GitHub Pages 網址，並確認網路連線。');
}
async function bootRules(){
 // EXACT original module order and original exports, not replicated rules.
 const paths=['terrain-database.js','environment-object-engine.js','map-database.js','hydrology-engine.js','mass-flow-engine.js','climate-engine.js','environment-resolver.js','map-generator.js','conductivity-engine.js','environment-engine.js'];
 for(let i=0;i<paths.length;i++){
  const p=paths[i];status(`載入原版規則模組 ${i+1}/${paths.length}：${p}`);
  try{await import(`../js/${p}`);}catch(err){throw Error(`無法載入既有專案 ../js/${p}。請將整個 pixi-map-lab-20261115 資料夾放在專案根目錄。\n${err.message}`);}
 }
 if(!globalThis.MapGenerator||!globalThis.MapDatabase||!globalThis.HydrologyEngine||!globalThis.EnvironmentEngine||!globalThis.ClimateEngine){throw Error('原專案地形／水文／氣候核心未初始化完整。');}
}
const frame=(base,x,y,w,h)=>new PIXI.Texture({source:base.source,frame:new PIXI.Rectangle(x,y,w,h)});
async function loadArt(){
 const [terrain,props]=await Promise.all([PIXI.Assets.load('./assets/terrain-atlas.png'),PIXI.Assets.load('./assets/props-atlas.png')]);
 atlasTerrain=terrain;atlasProps=props;
 for(const [i,key]of TERRAIN_KEYS.entries())terrainFrames[key]=Array.from({length:6},(_,j)=>frame(terrain,j*TILE_W,i*TILE_H,TILE_W,TILE_H));
 const names=['pine','oak','birch','dead','boulder','bush','pillar','ruins','blue_core','red_core','spring','flag'];
 names.forEach((key,j)=>propFrames[key]=frame(props,(j%4)*PROP_W,Math.floor(j/4)*PROP_H,PROP_W,PROP_H));
}
function initApp(){
 app=new PIXI.Application();return app.init({backgroundAlpha:0,antialias:false,resolution:Math.min(2,window.devicePixelRatio||1),resizeTo:stageEl,preference:'webgl'}).then(()=>{
  stageEl.appendChild(app.canvas);app.canvas.style.touchAction='none';
  mapContainer=new PIXI.Container();mapContainer.eventMode='none';mapContainer.sortableChildren=true;
  tilesLayer=new PIXI.Container();tilesLayer.sortableChildren=true;
  fxWorld=new PIXI.Container();fxWorld.sortableChildren=true;
  pointerLayer=new PIXI.Container();pointerLayer.sortableChildren=true;
  mapContainer.addChild(tilesLayer,fxWorld,pointerLayer);app.stage.addChild(mapContainer);
  weatherLayer=new PIXI.Graphics();app.stage.addChild(weatherLayer);
  app.ticker.add(tick);
  bindCanvasInput();
 });
}
function makeTileScene(){
 const m=$('#mapSelect').value;currentMode=m;const seed=num($('#seed').value)||20261115;
 if(m==='static'){
  map=globalThis.MapDatabase.createMap('versus_core_field');
  generated={meta:{size:'MAP_DATABASE',seed:null,validation:'REFERENCE',riverTiles:0}};
  core=[];deploymentPoints=[];
 }else if(m==='prototype'){
  map=globalThis.MapDatabase.createMap('prototype_field');
  generated={meta:{size:'MAP_DATABASE',seed:null,validation:'REFERENCE',riverTiles:0}};
  core=[];deploymentPoints=[];
 }else{
  generated=globalThis.MapGenerator.generateVersus({size:m.toUpperCase(),seed});
  map=generated.map;core=generated.cores||[];deploymentPoints=generated.deploymentPoints||[];
 }
 // Same creation order as BattleSetupEngine.create() in the primary game.
 globalThis.EnvironmentObjectEngine.initializeMap(map,{seed:map.seed??map.id});
 globalThis.HydrologyEngine.initializeMap(map);
 engineState=globalThis.EnvironmentEngine.create({timeOfDay:'DAY',moonlight:'PARTIAL',weather:'CLEAR'});
 globalThis.ClimateEngine.initializeMap(map,engineState);
 selected=null;lastEvents=[];
 renderScene();fitMap();refreshUi();
 status(`載入成功｜${map.name}｜${map.width}×${map.height}｜原版地形・水文・天氣規則`);
}
const tileAt=(x,y)=>map?.tiles?.find(t=>t.x===x&&t.y===y)||null;
const tileHeight=t=>num(t?.elevation);
function makePoly(g,p,color,alpha=1){g.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)g.lineTo(p[i].x,p[i].y);g.closePath();g.fill({color,alpha});return g;}
function tilesKey(t){
 if(globalThis.ClimateEngine.isFrozen(t))return 'ICE';
 if(num(t.snowDepth)>.15)return 'SNOW';
 if(t.terrain==='WALL')return 'WALL';
 if(t.terrain==='WATER' && t.dryTerrain)return String(t.dryTerrain);
 return TERRAIN_KEYS.includes(t.terrain)?t.terrain:'PLAIN';
}
function drawSideFace(g,t,p,side,lowerH){
 const amount=Math.max(.15, (num(t.elevation)-lowerH)*ELEV);
 if(amount<=.16)return;
 const first=side==='east'?{x:p.x+HALF_W,y:p.y}:{x:p.x,y:p.y+HALF_H};
 const second=side==='east'?{x:p.x,y:p.y+HALF_H}:{x:p.x-HALF_W,y:p.y};
 const a=first,b=second,c={x:b.x,y:b.y+amount},d={x:a.x,y:a.y+amount};
 makePoly(g,[a,b,c,d],side==='east'?0x384a50:0x52625c);
 g.moveTo(a.x,a.y).lineTo(b.x,b.y).stroke({color:0xc2c0a1,width:1,alpha:.32});
 const rh=hash(t.x,t.y,side==='east'?14:15);
 for(let i=0;i<Math.min(4,Math.floor(amount/7)+1);i++){
  const k=.2+i*.17, lx=a.x+(b.x-a.x)*k,ly=a.y+(b.y-a.y)*k+Math.min(amount*.4,4+i*4);
  g.moveTo(Math.round(lx),Math.round(ly)).lineTo(Math.round(lx+(side==='east'?-6:6)),Math.round(ly+((rh+i)%3))).stroke({color:0x243941,width:1.1,alpha:.55});
 }
}
function terrainTint(t){
 if(num(t.soilMoisture)>.28&&t.terrain==='PLAIN')return 0xe0f0e5;
 if(t.terrain==='HIGH_GROUND')return 0xe0e5ed;
 return 0xffffff;
}
function addProp(container,key,x,y,size=1,order=0,tint=0xffffff){
 const tex=propFrames[key];if(!tex)return;
 const sprite=new PIXI.Sprite(tex);sprite.anchor.set(.5,.905);sprite.position.set(x,y);sprite.scale.set(size);sprite.roundPixels=true;sprite.tint=tint;sprite.zIndex=order;
 container.addChild(sprite);return sprite;
}
function createWaterGraphics(t,top){
 const depth=num(t.waterDepth),hasStored=depth>globalThis.HydrologyEngine.EPSILON;
 const flowing=t.river===true&&(num(t.hydrologyOutflowRate)>0.0001||num(t.discharge)>0.0001||num(t.flowSpeed)>.001);
 const g=new PIXI.Graphics();
 if(hasStored){
  const h=clamp(depth,0,5), y=-h*ELEV;
  const points=[{x:0,y:-HALF_H+y},{x:HALF_W,y},{x:0,y:HALF_H+y},{x:-HALF_W,y}];
  makePoly(g,points,depth>1.5?0x166480:0x298e9c,depth>1.5?.85:.64);
  g.moveTo(0,-HALF_H+y).lineTo(HALF_W,y).stroke({color:0x98ebe0,width:1.5,alpha:.63});
  g.moveTo(HALF_W,y).lineTo(0,HALF_H+y).stroke({color:0x58d1d7,width:1,alpha:.65});
 }else if(flowing){
  // Q-only river transport is a separate canonical water state (not fake stored D).
  const fx=num(t.flowX),fy=num(t.flowY);const goVertical=Math.abs(fy)>=Math.abs(fx);
  const v=goVertical?[[0,-HALF_H*.80],[HALF_W*.45,0],[0,HALF_H*.78],[-HALF_W*.44,0]]:[[-HALF_W*.75,0],[0,-HALF_H*.45],[HALF_W*.72,0],[0,HALF_H*.45]];
  makePoly(g,v.map(([x,y])=>({x,y})),0x298498,.75);
 }
 if(hasStored||flowing){
  const rand=hash(t.x,t.y,88);for(let i=0;i<3;i++){
   const x=((rand>>>i*5)%48)-24, y=((rand>>>(i*5+2))%18)-9;
   g.moveTo(x-5,y-depth*ELEV).lineTo(x+5,y-depth*ELEV-1).stroke({color:0xb2f6ed,width:1,alpha:.45});
  }
 }
 return g;
}
function addSnowLayer(tileContainer,t){
 const snow=num(t.snowDepth),ice=num(t.iceThickness);
 if(snow>.15){const sp=new PIXI.Sprite(terrainFrames.SNOW[hash(t.x,t.y,9)%6]);sp.anchor.set(.5);sp.alpha=clamp(.18+snow*.20,.2,.95);tileContainer.addChild(sp);}
 if(ice>=.25&&num(t.waterDepth)>0){const sp=new PIXI.Sprite(terrainFrames.ICE[hash(t.x,t.y,10)%6]);sp.anchor.set(.5);sp.y=-Math.min(ice,2)*ELEV*.35;sp.alpha=clamp(ice*.6,.2,.8);tileContainer.addChild(sp);}
}
function highlightPolygon(g,cx,cy,fill=0x5beed4){
 makePoly(g,[{x:cx,y:cy-HALF_H},{x:cx+HALF_W,y:cy},{x:cx,y:cy+HALF_H},{x:cx-HALF_W,y:cy}],fill,.16);
 g.moveTo(cx,cy-HALF_H).lineTo(cx+HALF_W,cy).lineTo(cx,cy+HALF_H).lineTo(cx-HALF_W,cy).closePath().stroke({color:fill,width:3,alpha:.94});
}
function renderScene(){
 if(!app||!map)return;
 tilesLayer.removeChildren().forEach(x=>x.destroy({children:true}));
 fxWorld.removeChildren().forEach(x=>x.destroy({children:true}));
 pointerLayer.removeChildren().forEach(x=>x.destroy({children:true}));
 tilesList=[];propsList=[];flowList=[];
 const objects=new Map();
 for(const o of map.objects||[]){if(o.destroyed||o.carriedBy)continue;const key=`${o.x},${o.y}`;const list=objects.get(key)||[];list.push(o);objects.set(key,list);}
 const captures=new Map();for(const d of deploymentPoints)if(d?.capturable){const at=d.captureTiles?.[0]||d.area?.[0];if(at)captures.set(`${at.x},${at.y}`,d);}
 const items=[...map.tiles].sort((a,b)=>a.x+a.y-b.x-b.y||a.y-b.y);
 for(const t of items){
  const xyz=iso(t.x,t.y,tileHeight(t));const sort=t.x+t.y;
  const group=new PIXI.Container();group.position.set(xyz.x,xyz.y);group.zIndex=sort*100+1;group.roundPixels=true;
  const side=new PIXI.Graphics();
  const east=tileAt(t.x+1,t.y),south=tileAt(t.x,t.y+1);
  const lowerEast=east?Math.min(num(t.elevation),num(east.elevation)):num(t.elevation)-2.3;
  const lowerSouth=south?Math.min(num(t.elevation),num(south.elevation)):num(t.elevation)-2.3;
  if(num(t.elevation)>lowerEast)drawSideFace(side,t,{x:0,y:0},'east',lowerEast);
  if(num(t.elevation)>lowerSouth)drawSideFace(side,t,{x:0,y:0},'south',lowerSouth);
  if(side.geometry)group.addChild(side);
  const type=tilesKey(t), tex=terrainFrames[type]||terrainFrames.PLAIN;
  const texTile=new PIXI.Sprite(tex[hash(t.x,t.y,5)%6]);texTile.anchor.set(.5);texTile.roundPixels=true;texTile.tint=terrainTint(t);group.addChild(texTile);
  if(gridVisible){const g=new PIXI.Graphics();g.moveTo(0,-HALF_H).lineTo(HALF_W,0).lineTo(0,HALF_H).lineTo(-HALF_W,0).closePath().stroke({color:0xbfdac6,width:.75,alpha:.30});group.addChild(g);}
  if(num(t.waterDepth)>globalThis.HydrologyEngine.EPSILON||t.river){
   const g=createWaterGraphics(t,xyz);group.addChild(g);flowList.push({t,graphics:g,phase:(hash(t.x,t.y,12)%23)/23});
  }
  addSnowLayer(group,t);
  if(selected&&selected.x===t.x&&selected.y===t.y){const g=new PIXI.Graphics();highlightPolygon(g,0,0);group.addChild(g);}
  if(hovered&&hovered.x===t.x&&hovered.y===t.y){const g=new PIXI.Graphics();highlightPolygon(g,0,0,0xffd18f);group.addChild(g);}
  tilesLayer.addChild(group);tilesList.push({t,p:xyz});
  const place=objects.get(`${t.x},${t.y}`)||[];
  let layer=sort*100+40;
  if(t.terrain==='WALL'&&!place.some(o=>o.blocksMovement)){
   addProp(group,hash(t.x,t.y,33)%3===0?'pillar':'ruins',0,-2, .72, layer);
  }
  for(const obj of place){
   let name=null,scale=1;
   if(obj.type==='TREE'){name=['pine','oak','birch'][hash(t.x,t.y,37)%3];scale=clamp(.8+(hash(t.x,t.y,44)%26)/100,.8,1.05);}
   else if(obj.type==='DEAD_TREE')name='dead';
   else if(obj.type==='BUSH')name='bush';
   else if(obj.type==='LOG'||obj.type==='STUMP')name='ruins';
   else if(obj.type==='BOULDER'||obj.type==='ROCK'){name='boulder';scale=.88;}
   else if(obj.type==='SPRING'){name='spring';scale=.85;}
   else if(obj.type==='CORE'){name=String(obj.id).toLowerCase().includes('enemy')?'red_core':'blue_core';scale=.82;}
   if(name)addProp(group,name,0,0,scale,layer++);
  }
  if(!place.length&&t.terrain==='FOREST')addProp(group,['pine','oak','birch'][hash(t.x,t.y,46)%3],0,0,.92,layer);
  if(captures.has(`${t.x},${t.y}`))addProp(group,'flag',12,-4,.65,layer+5);
 }
 updateHud();
}
function updateHud(){
 const climate=engineState;const env=globalThis.EnvironmentEngine;
 const weather=env.legacyWeather?.(climate)||climate?.weather||'CLEAR';
 $('#turnValue').textContent=String(num(climate?.climate?.turn)).padStart(2,'0');
 $('#weatherValue').textContent=WEATHER_LABEL[weather]||weather;
 $('#dayValue').textContent=climate?.timeOfDay==='NIGHT'?'月夜':'白晝';
 $('#moonValue').textContent=({FULL:'滿月',PARTIAL:'半月',NONE:'無月'})[climate?.moonlight]||climate?.moonlight||'—';
 $('#waterValue').textContent=map.tiles.filter(t=>num(t.waterDepth)>env.HYDROLOGY?.EPSILON||num(t.waterDepth)>.0001).length;
 $('#snowValue').textContent=map.tiles.filter(t=>num(t.snowDepth)>.15).length;
 $('#terrainValue').textContent=`${map.width} × ${map.height}`;
 $('#cycleValue').textContent=`日夜 ${env.DAY_NIGHT_INTERVAL} 回合／天氣 ${env.NATURAL_WEATHER_INTERVAL} 回合`;
 const effect=globalThis.HydrologyEngine.waterInventory(map);
 $('#waterVol').textContent=asFixed(effect.surface,2);
 if(selected){const t=tileAt(selected.x,selected.y);if(t){
  info.innerHTML=`<div class="tile-title">${TERRAIN_LABEL[t.terrain]||t.terrain} <small>(${t.x}, ${t.y})</small></div><div class="kv"><span>地形高度</span><b>${asFixed(t.elevation,2)}</b></div><div class="kv"><span>儲水深度 D</span><b>${asFixed(t.waterDepth,3)}</b></div><div class="kv"><span>水面 Z</span><b>${t.waterSurfaceZ==null?'—':asFixed(t.waterSurfaceZ,3)}</b></div><div class="kv"><span>積雪厚度</span><b>${asFixed(t.snowDepth,3)}</b></div><div class="kv"><span>冰層厚度</span><b>${asFixed(t.iceThickness,3)}</b></div><div class="kv"><span>河道 Q</span><b>${asFixed(t.hydrologyOutflowRate??t.discharge,3)}</b></div><div class="tile-foot">以上為原版 Game State 數據，不是 PixiJS 推算。</div>`;
 }}else info.innerHTML='<div class="emptyhint">點一下地圖格子，檢視原版地形、水深、積雪與冰層數值。</div>';
 const dark=climate.timeOfDay==='NIGHT';
 document.documentElement.classList.toggle('isnight',dark);
 document.documentElement.dataset.weather=weather;
 document.documentElement.style.setProperty('--night-dim',dark?(climate.moonlight==='NONE'?.62:climate.moonlight==='FULL'?.37:.47):0);
 const label=weather===lastWeatherKey?'':` · ${WEATHER_LABEL[weather]||weather}`;
 lastWeatherKey=weather;
 $('#moonSelect').value=climate.moonlight;
 $('#weatherSelect').value=weather;
 }
function fitMap(){
 if(!app||!map)return;
 const box=stageEl.getBoundingClientRect();
 if(box.width<100||box.height<100)return;
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const t of map.tiles){const c=iso(t.x,t.y,num(t.elevation));minX=Math.min(minX,c.x-48);maxX=Math.max(maxX,c.x+48);minY=Math.min(minY,c.y-140);maxY=Math.max(maxY,c.y+120);}
 const w=maxX-minX+30,h=maxY-minY+30;
 camera.zoom=clamp(Math.min((box.width-32)/w,(box.height-38)/h),.27,1.25);
 camera.panX=0;camera.panY=0;
 camera.x=box.width/2-(minX+maxX)*.5*camera.zoom;
 camera.y=box.height/2-(minY+maxY)*.5*camera.zoom;
 applyCam();
 }
function applyCam(){mapContainer.position.set(camera.x+camera.panX,camera.y+camera.panY);mapContainer.scale.set(camera.zoom);}
function pickTile(localX,localY){
 const wx=(localX-mapContainer.x)/camera.zoom,wy=(localY-mapContainer.y)/camera.zoom;
 let best=null,order=-Infinity;
 for(const {t,p}of tilesList){
  const d=Math.abs((wx-p.x)/HALF_W)+Math.abs((wy-p.y)/HALF_H);
  if(d<=1.02){const z=t.x+t.y+num(t.elevation)*.1;if(z>order){best=t;order=z;}}
 }
 return best;
 }
function updateSelection(t){selected=t?{x:t.x,y:t.y}:null;renderScene();refreshUi();}
function bindCanvasInput(){
 const c=app.canvas;
 function pt(e){const r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
 c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);pointerData.set(e.pointerId,{start:pt(e),now:pt(e)});if(pointerData.size===2){const p=[...pointerData.values()];gesture={type:'pinch',distance:Math.hypot(p[0].now.x-p[1].now.x,p[0].now.y-p[1].now.y),zoom:camera.zoom,panX:camera.panX,panY:camera.panY};}else gesture={type:'drag',x:pt(e).x,y:pt(e).y,panX:camera.panX,panY:camera.panY};activeDrag=false;});
 c.addEventListener('pointermove',e=>{const p=pointerData.get(e.pointerId);if(!p)return;p.now=pt(e);
  if(pointerData.size>1){const ps=[...pointerData.values()];const dist=Math.hypot(ps[0].now.x-ps[1].now.x,ps[0].now.y-ps[1].now.y);camera.zoom=clamp(gesture.zoom*dist/Math.max(1,gesture.distance),.23,2.3);activeDrag=true;}
  else if(gesture?.type==='drag'){const delta=Math.hypot(p.now.x-p.start.x,p.now.y-p.start.y);if(delta>5)activeDrag=true;camera.panX=gesture.panX+(p.now.x-gesture.x);camera.panY=gesture.panY+(p.now.y-gesture.y);}
  applyCam();
 });
 function release(e){const p=pointerData.get(e.pointerId);if(!p)return;pointerData.delete(e.pointerId);if(pointerData.size===0){
  if(!activeDrag){const q=pickTile(p.now.x,p.now.y);if(q)updateSelection(q);}
  gesture=null;activeDrag=false;
 }else if(pointerData.size===1){const rem=[...pointerData.values()][0];gesture={type:'drag',x:rem.now.x,y:rem.now.y,panX:camera.panX,panY:camera.panY};activeDrag=true;}}
 c.addEventListener('pointerup',release);c.addEventListener('pointercancel',release);
 c.addEventListener('wheel',e=>{e.preventDefault();const old=camera.zoom;camera.zoom=clamp(old*(e.deltaY>0?.9:1.1),.23,2.4);applyCam();},{passive:false});
 }
function tick(ticker){
 tickerTime+=ticker.deltaMS/1000;
 weatherFx(ticker.deltaMS/1000);
 // Animated water is a visual interpolation of existing water volumes / Q.
 for(const item of flowList){const g=item.graphics;if(g?.destroyed)continue;const phase=tickerTime*1.4+item.phase*6.28;g.alpha=.92+.08*Math.sin(phase);}
 }
function weatherFx(dt){
 if(!app||!engineState)return;
 // Rebuild precipitation graphics at 25 FPS, not on every device refresh.
 if(tickerTime-lastFxDraw<.040)return;lastFxDraw=tickerTime;
 const env=globalThis.EnvironmentEngine,weather=env.legacyWeather?.(engineState)||'CLEAR';
 const w=stageEl.clientWidth,h=stageEl.clientHeight;
 if(w<=0||h<=0)return;
 weatherLayer.clear();
 const night=engineState.timeOfDay==='NIGHT';
 if(night){const darkness=engineState.moonlight==='NONE'?.61:engineState.moonlight==='FULL'?.38:.50;weatherLayer.rect(0,0,w,h).fill({color:0x071830,alpha:darkness});}
 if(weather==='FOG'||weather==='BLIZZARD'){
  for(let i=0;i<4;i++){const y=h*(i+.5)/4+Math.sin(tickerTime*.3+i)*18;weatherLayer.ellipse(w*.5+Math.sin(tickerTime*.1+i)*80,y,w*.56,28).fill({color:0xb8d0df,alpha:weather==='FOG'?.08:.052});}
 }
 if(weather==='RAIN'||weather==='HEAVY_RAIN'||weather==='THUNDERSTORM'||weather==='TYPHOON'||weather==='SNOW'||weather==='BLIZZARD'){
  const snow=weather==='SNOW'||weather==='BLIZZARD';const count=snow?42:weather==='RAIN'?60:weather==='HEAVY_RAIN'?125:145;
  const wind=env.windAt?.(engineState)||{x:1,strength:1};
  const sx=wind.strength*(snow?2.5:3.5);
  for(let i=0;i<count;i++){
   const k=hash(i,91,7);const x=((k%997)/997*w+tickerTime*(snow?14+sx:65+sx*2)*(i%2?1:.65))%(w+60)-30;
   const y=(((k>>>8)%941)/941*h+tickerTime*(snow?20+(i%8)*5:165+(i%9)*12))%(h+70)-35;
   if(snow)weatherLayer.rect(Math.floor(x),Math.floor(y),i%5===0?3:2,i%5===0?3:2).fill({color:0xf2f9f9,alpha:.45+(i%5)*.08});
   else weatherLayer.moveTo(x,y).lineTo(x-2-sx*.20,y+9+(i%4)*3).stroke({color:0xb1d8ed,width:1,alpha:weather==='RAIN'?.39:.57});
  }
 }
 if(weather==='THUNDERSTORM'||weather==='TYPHOON'){
  const flash=Math.max(0,Math.sin(tickerTime*.72+1.1));if(flash>.988)weatherLayer.rect(0,0,w,h).fill({color:0xd6e9ff,alpha:(flash-.988)*15});
 }
 }
function refreshUi(){if(map&&engineState)updateHud();}
async function stepTurn(){if(busy||!map||!engineState)return;busy=true;try{
 status('原版 EnvironmentEngine 正在推進水文與氣候…');
 await new Promise(r=>requestAnimationFrame(()=>r()));
 lastEvents=globalThis.EnvironmentEngine.advanceEnvironmentTurn(map,engineState)||[];
 renderScene();refreshUi();
 status(`環境更新完成：${lastEvents.length} 個事件｜現在 ${WEATHER_LABEL[globalThis.EnvironmentEngine.legacyWeather(engineState)]||engineState.weather}`);
 }catch(e){console.error(e);status('原版環境更新失敗：'+e.message,true);stopAuto();}finally{busy=false;}}
function stopAuto(){clearInterval(autoTimer);autoTimer=null;$('#auto').textContent='▶ 自動推演';$('#auto').classList.remove('chosen');}
function bindControls(){
 $('#advance').addEventListener('click',stepTurn);
 $('#auto').addEventListener('click',()=>{if(autoTimer){stopAuto();return;}autoTimer=setInterval(stepTurn,2200);$('#auto').textContent='⏸ 暫停推演';$('#auto').classList.add('chosen');});
 $('#mapSelect').addEventListener('change',()=>{stopAuto();try{makeTileScene();}catch(e){console.error(e);status(`原版地圖生成失敗：${e.message}`,true);}});
 $('#regenerate').addEventListener('click',()=>{stopAuto();try{makeTileScene();}catch(e){console.error(e);status(`原版地圖生成失敗：${e.message}`,true);}});
 $('#weatherSelect').addEventListener('change',e=>{if(!engineState)return;try{
  const weather=e.target.value;
  const turns=globalThis.EnvironmentEngine.WEATHER_TURNS?.[weather]??null;
  lastEvents=globalThis.EnvironmentEngine.setWeather(engineState,weather,map,{duration:turns,source:'MANUAL',applyPulse:true})||[];
  renderScene();refreshUi();status(`使用原版 setWeather()：${WEATHER_LABEL[weather]||weather}`);
 }catch(err){console.error(err);status('無法變更天氣：'+err.message,true);}});
 $('#dayToggle').addEventListener('click',()=>{if(!engineState)return;globalThis.EnvironmentEngine.setTimeOfDay(engineState,engineState.timeOfDay==='DAY'?'NIGHT':'DAY');refreshUi();});
 $('#moonSelect').addEventListener('change',e=>{if(!engineState)return;globalThis.EnvironmentEngine.setMoonlight(engineState,e.target.value);refreshUi();});
 $('#gridToggle').addEventListener('click',()=>{gridVisible=!gridVisible;$('#gridToggle').classList.toggle('chosen',gridVisible);renderScene();});
 $('#fit').addEventListener('click',fitMap);
 $('#zoomIn').addEventListener('click',()=>{camera.zoom=clamp(camera.zoom*1.18,.24,2.4);applyCam();});
 $('#zoomOut').addEventListener('click',()=>{camera.zoom=clamp(camera.zoom/1.18,.24,2.4);applyCam();});
 const ro=new ResizeObserver(()=>{if(app)fitMap();});ro.observe(stageEl);
 }
async function main(){
 try{bindControls();status('初始化 PixiJS 渲染器…');
  const [p]=await Promise.all([bootPixi(),bootRules()]);
  PIXI=p;await initApp();await loadArt();makeTileScene();
  $('#loading').classList.add('hidden');
 }catch(e){console.error(e);status(e.message,true);$('#loading').innerHTML=`<div class="fail"><b>載入失敗</b><p>${String(e.message).replace(/[<>]/g,'')}</p><p>此頁必須放在 <code>card-tactics-2/pixi-map-preview/index.html</code>，並透過 GitHub Pages 開啟。</p></div>`;}
}
main();
