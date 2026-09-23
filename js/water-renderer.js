import { TILE_SIZE, ELEVATION_HEIGHT, tileCenterWorld } from "./coordinate-system.js";
import { waterSurfaceZ } from "./hydrology-engine.js";

const keyOf = tile => `${tile.x},${tile.y}`;

export class WaterRenderer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.material = new BABYLON.StandardMaterial("waterMaterial", scene);
    this.material.diffuseColor = new BABYLON.Color3(0.12, 0.42, 0.75);
    this.material.alpha = 0.58;
    this.material.specularColor = new BABYLON.Color3(0.35, 0.55, 0.75);
  }

  sync(state) {
    const alive = new Set();
    for (const tile of state.grid.tiles) {
      const surface = waterSurfaceZ(tile);
      if (surface == null) continue;
      const key = keyOf(tile);
      alive.add(key);
      let mesh = this.meshes.get(key);
      if (!mesh) {
        mesh = BABYLON.MeshBuilder.CreateBox(`water-${key}`, {
          width: TILE_SIZE * 0.88,
          depth: TILE_SIZE * 0.88,
          height: 0.08
        }, this.scene);
        mesh.material = this.material;
        mesh.isPickable = false;
        this.meshes.set(key, mesh);
      }
      const center = tileCenterWorld(tile);
      mesh.position.set(center.x, surface * ELEVATION_HEIGHT + 0.04, center.z);
    }
    for (const [key, mesh] of this.meshes) {
      if (!alive.has(key)) { mesh.dispose(); this.meshes.delete(key); }
    }
  }
}
