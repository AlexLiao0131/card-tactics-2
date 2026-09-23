import { GridState } from "./grid-state.js";
import { initializeMap } from "./hydrology-engine.js";
import { createEnvironmentState } from "./environment-engine.js";
import { initializeClimateMap } from "./climate-engine.js";
export function createPrototypeBattleState(){
 const elevations=[[0,0,0,0,0,1,1,1],[0,0,0,1,1,1,2,2],[0,0,1,1,2,2,3,2],[0,0,1,2,2,1,1,1],[0,0,0,1,1,0,0,0],[0,0,0,0,0,0,0,0]],basins=new Set(["1,4","2,4","1,5"]),tiles=[];
 for(let y=0;y<6;y++)for(let x=0;x<8;x++){const e=elevations[y][x],water=basins.has(`${x},${y}`);tiles.push({x,y,elevation:e,terrain:water?"WATER":(e>=2?"HIGH_GROUND":"PLAIN"),waterDepth:water?undefined:0,snowDepth:0,iceThickness:0,material:e>=2?"ROCK":"SOIL"})}
 const grid=new GridState({width:8,height:6,tiles});initializeMap(grid);const environmentState=createEnvironmentState({weather:"CLEAR"});initializeClimateMap(grid,environmentState);
 const baseChar={combat:{move:4},terrainTraits:[],weapons:{},armor:{type:"LIGHT"},equipment:[]};
 return{revision:0,round:1,grid,environmentState,units:[{id:"P1",team:"P",name:"Player",gridX:1,gridY:1,alive:true,character:{...baseChar}},{id:"E1",team:"E",name:"Enemy",gridX:6,gridY:4,alive:true,character:{...baseChar}}],selectedUnitId:"P1",meteorTarget:{x:6,y:2},cameraQuarterTurns:0}
}
