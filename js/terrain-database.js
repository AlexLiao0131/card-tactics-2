export const TERRAINS={
  PLAIN:{name:"平地",moveCost:1,passable:true,evasion:0,environment:"NONE"},
  MUD:{name:"泥濘",moveCost:2,passable:true,evasion:-5,environment:"NONE"},
  SAND:{name:"沙地",moveCost:2,passable:true,evasion:-2,environment:"NONE",erosionSusceptibility:1.35,infiltration:1.35},
  FOREST:{name:"森林",moveCost:2,passable:true,evasion:10,environment:"GRASS"},
  HIGH_GROUND:{name:"岩質地表",moveCost:1,passable:true,evasion:0,environment:"STONE"},
  WATER:{name:"水域",moveCost:3,passable:true,evasion:0,environment:"WATER"},
  WALL:{name:"障礙",moveCost:999,passable:false,evasion:0,environment:"STONE"}
};
globalThis.TERRAINS=TERRAINS;

// Ground geology is independent of absolute elevation and tactical height.
// HIGH_GROUND remains a compatibility label for authored rock terrain only;
// procedural ground is soil unless an actual material is explicitly authored.
export const HIGH_GROUND_RANGED_ACCURACY=10;
export const TerrainMaterial=Object.freeze({
  baseTerrain(tile){return tile?.terrain==="WATER"?(tile.dryTerrain||"PLAIN"):tile?.terrain;},
  of(tile){
    if(!tile)return null;
    const base=this.baseTerrain(tile);
    if(base==="WALL")return "ROCK";
    if(tile.river===true&&tile.hydrologyBedMaterial==="ROCK")return "ROCK";
    const explicit=String(tile.material||"").toUpperCase();
    if(explicit==="ROCK"||explicit==="STONE")return "ROCK";
    if(explicit==="SOIL"||explicit==="SAND")return explicit;
    if(base==="HIGH_GROUND")return "ROCK";
    if(base==="SAND")return "SAND";
    return ["PLAIN","MUD","FOREST"].includes(base)?"SOIL":null;
  },
  hasSoil(tile){return ["SOIL","SAND"].includes(this.of(tile));},
  isRock(tile){return this.of(tile)==="ROCK";},
  // An exposed cliff face is geological rock beneath a possible soil cover;
  // it does NOT turn the entire upper tile into impermeable bare rock.
  exposedCliffFace(map,tile){
    if(!map||!tile||tile.river||tile.terrain==="WALL")return false;
    return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{
      const other=globalThis.TacticalEngine?.tile?.(map,tile.x+dx,tile.y+dy)||map.tiles?.find(t=>t.x===tile.x+dx&&t.y===tile.y+dy);
      return other&&other.terrain!=="WALL"&&Number(tile.elevation||0)-Number(other.elevation||0)>1.0001;
    });
  }
});
globalThis.TerrainMaterial=TerrainMaterial;
