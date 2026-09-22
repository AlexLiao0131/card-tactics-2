import { TILE_SIZE, ELEVATION_HEIGHT, tileCenterWorld } from "./coordinate-system.js";

const tileKey = tile => `${tile.x},${tile.y}`;

export class TerrainRenderer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.materials = {
      soil: this.makeMaterial("soil", new BABYLON.Color3(0.30, 0.42, 0.24)),
      rock: this.makeMaterial("rock", new BABYLON.Color3(0.34, 0.36, 0.39)),
      selected: this.makeMaterial("selected", new BABYLON.Color3(0.26, 0.55, 0.85))
    };
  }

  makeMaterial(name, color) {
    const mat = new BABYLON.StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = BABYLON.Color3.Black();
    return mat;
  }

  sync(state) {
    for (const tile of state.grid.tiles) {
      const key = tileKey(tile);
      let mesh = this.meshes.get(key);
      const height = Math.max(0.18, (Number(tile.elevation || 0) + 1) * ELEVATION_HEIGHT);
      if (!mesh || mesh.metadata?.height !== height) {
        mesh?.dispose();
        mesh = BABYLON.MeshBuilder.CreateBox(`tile-${key}`, {
          width: TILE_SIZE * 0.94,
          depth: TILE_SIZE * 0.94,
          height
        }, this.scene);
        mesh.metadata = { kind: "tile", x: tile.x, y: tile.y, height };
        this.meshes.set(key, mesh);
      }
      const center = tileCenterWorld(tile);
      mesh.position.set(center.x, center.y - height / 2 + 0.02, center.z);
      mesh.material = tile.material === "ROCK" ? this.materials.rock : this.materials.soil;
      mesh.receiveShadows = true;
    }
  }
}
