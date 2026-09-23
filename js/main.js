import { createPrototypeBattleState } from "./battle-state.js";
import { BattleSession } from "./battle-session.js";
import { BabylonRenderer } from "./babylon-renderer.js";
import { waterSurfaceZ } from "./hydrology-engine.js";

const canvas = document.getElementById("battleCanvas");
const status = document.getElementById("status");
const state = createPrototypeBattleState();
const session = new BattleSession(state);

const renderer = new BabylonRenderer(canvas, state, {
  onTilePicked(x, y) {
    const result = session.dispatch({ type: "MOVE", unitId: state.selectedUnitId, x, y });
    if (!result.ok) updateStatus(`不可移動到 (${x},${y})：${result.reason}`);
  }
});

function updateStatus(message = "") {
  const player = session.unitById("P1");
  const meteorTile = state.grid.tileAt(state.meteorTarget.x, state.meteorTarget.y);
  const naturalWater = state.grid.tileAt(1, 4);
  status.textContent = [
    message,
    `Player grid=(${player.gridX},${player.gridY})`,
    `Meteor H${meteorTile.elevation} / Water ${Number(meteorTile.waterDepth || 0).toFixed(2)}`,
    `Basin H${naturalWater.elevation} / Surface ${Number(waterSurfaceZ(naturalWater) ?? 0).toFixed(2)}`,
    `Camera=${state.cameraQuarterTurns * 90}° | revision=${state.revision}`
  ].filter(Boolean).join(" ｜ ");
}

session.subscribe((nextState, event) => {
  renderer.sync(nextState);
  updateStatus(event.type === "INIT" ? "1.0 Hydrology 已接入。" : event.type);
});

document.getElementById("rotateLeft").addEventListener("click", () => session.dispatch({ type: "ROTATE_CAMERA", delta: -1 }));
document.getElementById("rotateRight").addEventListener("click", () => session.dispatch({ type: "ROTATE_CAMERA", delta: 1 }));
document.getElementById("meteorButton").addEventListener("click", () => session.dispatch({ type: "METEOR", x: state.meteorTarget.x, y: state.meteorTarget.y, setElevation: 1 }));
document.getElementById("waterButton").addEventListener("click", () => session.dispatch({ type: "ADD_WATER", x: state.meteorTarget.x, y: state.meteorTarget.y, amount: 0.35 }));
