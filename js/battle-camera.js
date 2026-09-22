import { TILE_SIZE } from "./coordinate-system.js";

export class BattleCamera {
  constructor(scene, canvas, state) {
    const target = new BABYLON.Vector3(
      ((state.grid.width - 1) * TILE_SIZE) / 2,
      0,
      ((state.grid.height - 1) * TILE_SIZE) / 2
    );
    this.target = target;
    this.camera = new BABYLON.ArcRotateCamera(
      "battleCamera",
      -Math.PI / 4,
      Math.PI / 3.2,
      24,
      target,
      scene
    );
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.attachControl(canvas, true);
    this.camera.inputs.removeByType("ArcRotateCameraPointersInput");
    this.camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
    this.camera.lowerBetaLimit = this.camera.upperBetaLimit = this.camera.beta;
    this.sync(state);
    window.addEventListener("resize", () => this.sync(state));
  }

  sync(state) {
    this.camera.alpha = -Math.PI / 4 + state.cameraQuarterTurns * Math.PI / 2;
    const aspect = Math.max(0.5, this.camera.getEngine().getRenderWidth() / Math.max(1, this.camera.getEngine().getRenderHeight()));
    const vertical = 10.5;
    this.camera.orthoTop = vertical;
    this.camera.orthoBottom = -vertical;
    this.camera.orthoLeft = -vertical * aspect;
    this.camera.orthoRight = vertical * aspect;
    this.camera.setTarget(this.target);
  }
}
