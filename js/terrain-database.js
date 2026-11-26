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
// Bed categories already used by the river solver. Fractions describe exposed
// tile area, not layers of imaginary groundwater. All fractions sum to one.
const BED_MATERIALS=Object.freeze(["ROCK","GRAVEL","SILT","SOIL","SAND"]);
const PURE_BED=Object.freeze(Object.fromEntries(BED_MATERIALS.map(kind=>[kind,Object.freeze({[kind]:1})])));
export const TerrainMaterial=Object.freeze({
  bedMaterials:BED_MATERIALS,
  bedComposition(tile){return tile?.hydrologyBedComposition||PURE_BED[tile?.hydrologyBedMaterial]||null;},
  bedSignature(tile){const mix=this.bedComposition(tile);return mix?BED_MATERIALS.map(k=>mix[k]||0).join(","):"";},
  bedLabel(tile){const mix=this.bedComposition(tile);if(!mix)return null;
    const authored=tile.hydrologyBedMaterial;if(authored&&mix[authored]>.5)return authored;
    let best=BED_MATERIALS[0];for(const k of BED_MATERIALS)if((mix[k]||0)>(mix[best]||0))best=k;return best;},
  baseTerrain(tile){return tile?.terrain==="WATER"?(tile.dryTerrain||"PLAIN"):tile?.terrain;},
  of(tile){
    if(!tile)return null;
    const base=this.baseTerrain(tile);
    if(base==="WALL")return "ROCK";
    const bed=this.bedLabel(tile);
    if(bed)return bed==="ROCK"?"ROCK":bed==="SAND"?"SAND":"SOIL";
    const explicit=String(tile.material||"").toUpperCase();
    if(explicit==="ROCK"||explicit==="STONE")return "ROCK";
    if(explicit==="SOIL"||explicit==="SAND")return explicit;
    if(base==="HIGH_GROUND")return "ROCK";
    if(base==="SAND")return "SAND";
    return ["PLAIN","MUD","FOREST"].includes(base)?"SOIL":null;
  },
  hasSoil(tile){const bed=this.bedComposition(tile);return bed?(bed.ROCK||0)<1:["SOIL","SAND"].includes(this.of(tile));},
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
