import { unitWorldPosition } from "./coordinate-system.js";

export class UnitRenderer {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map();
    this.materials = {
      P: this.material("player", new BABYLON.Color3(0.20, 0.55, 0.95)),
      E: this.material("enemy", new BABYLON.Color3(0.90, 0.24, 0.24)),
      N: this.material("neutral", new BABYLON.Color3(0.75, 0.65, 0.25))
    };
  }

  material(name, color) {
    const mat = new BABYLON.StandardMaterial(name, this.scene);
    mat.diffuseColor = color;
    return mat;
  }

  sync(state) {
    for (const unit of state.units) {
      if (!unit.alive) continue;
      let mesh = this.meshes.get(unit.id);
      if (!mesh) {
        mesh = BABYLON.MeshBuilder.CreateCapsule(`unit-${unit.id}`, { height: 1.6, radius: 0.42 }, this.scene);
        mesh.metadata = { kind: "unit", unitId: unit.id };
        mesh.material = this.materials[unit.team] ?? this.materials.N;
        this.meshes.set(unit.id, mesh);
      }
      const tile = state.grid.tileAt(unit.gridX, unit.gridY);
      if (!tile) continue;
      const target = unitWorldPosition(unit, tile);
      mesh.position.copyFrom(target);
    }
  }
}
