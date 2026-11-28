import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {TerrainRenderer} from '../../js/terrain-renderer.js';
import {VisualSurfaceResolver} from '../../js/visual-surface-resolver.js';
import {waterVisualInput,sameWaterVisualInput,captureWaterVisualInput} from '../../js/water-renderer.js';
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
function measure(name,old,next,repeat=25){for(let i=0;i<4;i++){old();next();}const a=[],b=[];for(let i=0;i<repeat;i++){for(const [f,arr] of i%2?[[next,b],[old,a]]:[[old,a],[next,b]]){const s=performance.now();f();arr.push(performance.now()-s);}}console.log(name,JSON.stringify({old:median(a),new:median(b)}));}
const deck=Array(20).fill('imperial_swordsman_card');const g=initializeCanonicalWorld({seed:1234,mapSize:'XLARGE',decks:[deck,deck]});g.randomState=5;
withCanonicalEngines(g,e=>{
 const map=g.battlefield.map;const units=Array.from({length:15},(_,i)=>e.unitRuntime.create({id:`p${i}`,characterId:'imperial_swordsman',team:'P',x:1+(i*7)%30,y:1+(i*3)%20,map}));
 const env=EnvironmentEngine.create({weather:'FOG',timeOfDay:'NIGHT'}),w={map,units,environmentState:env,cores:[],stage:{mode:'VERSUS',intelMode:'DYNAMIC_INTEL'}};
 console.log('map count',map.tiles.length,'units',units.length);measure('FOV',()=>map.tiles.filter(t=>TacticalEngine.teamCanSee(map,units,'P',t,env,w)),()=>TacticalEngine.teamVisibleCells(w,'P'));
});
const tiles=Array.from({length:704},(_,i)=>({x:i%32,y:Math.floor(i/32),terrain:'PLAIN',material:'SOIL',elevation:0,waterDepth:i%5?0:.5,waterSurfaceZ:i%5?null:.5,soilMoisture:.1,waterTurbidity:0,snowDepth:0,iceThickness:0,flowX:0,flowY:0,flowSpeed:0,river:false,ford:false,hydrologyEdgeOutflows:{},hydrologyEdgeDischarge:i%5?{}:{E:{rate:.1,persistentRate:.05}},effects:[],effectDetails:[],fogged:false,reachable:false,attackable:false,aimPreview:false}));
const r=new VisualSurfaceResolver(),s={map:{id:'map',width:32,height:22,tiles,objects:[]},presentation:{environment:{wind:{x:0,y:1,strength:1}}}};
const prior=captureWaterVisualInput(waterVisualInput(s,r)),ignore=new Set(['reachable','targetRange','attackable','deployable','inspected','atmosphericVisible','visionBlocked','deploymentAreaOwner','capturePoint','core']);
measure('water input',()=>JSON.stringify([s.map.id,s.map.width,s.map.height,r.renderedSurfaceGeometryRevision,r.renderedCliffGeometryRevision,tiles.map(t=>{const o={};for(const k of Object.keys(t))if(!ignore.has(k))o[k]=t[k];return o;}),s.map.objects,s.presentation.environment.wind]),()=>sameWaterVisualInput(waterVisualInput(s,r),prior));
const tr=Object.assign(Object.create(TerrainRenderer.prototype),{surfaceResolver:r});measure('grass gate',()=>tr.grassInputs(tiles),()=>tr.grassBroadInputKey(tiles));
const publish=(t)=>{const x=t.x*2,z=t.y*2,a={x:x-1,y:0,z:z-1},b={x:x+1,y:0,z:z-1},c={x:x+1,y:0,z:z+1},d={x:x-1,y:0,z:z+1};r.registerRenderedSurfaceGeometry(t,{triangles:[[a,b,c],[a,c,d]]});};
for(const t of tiles)publish(t);const edges=tiles.filter(t=>t.x<31).slice(0,120).map(t=>({from:t,to:tiles[t.y*32+t.x+1]}));
measure('120 smooth directed routes',()=>{r.beginPublishedSurfaceSampling();for(const e of edges)r.solveTransportSurfacePath(e.from,e.to,1,0);},()=>{r.beginPublishedSurfaceSampling();for(const e of edges)r.transportSurfacePath(e);});
