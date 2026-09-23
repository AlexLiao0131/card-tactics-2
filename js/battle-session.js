import { addWater, deformTerrain, redistribute, waterDepth } from "./hydrology-engine.js";

export class BattleSession {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state, { type: "INIT" });
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.state.revision += 1;
    for (const listener of this.listeners) listener(this.state, event);
  }

  unitById(id) { return this.state.units.find(unit => unit.id === id) ?? null; }
  occupied(x, y, excludeId = null) {
    return this.state.units.some(unit => unit.alive && unit.id !== excludeId && unit.gridX === x && unit.gridY === y);
  }

  canMove(unit, x, y) {
    const from = this.state.grid.tileAt(unit.gridX, unit.gridY);
    const to = this.state.grid.tileAt(x, y);
    if (!from || !to || this.occupied(x, y, unit.id)) return false;
    const distance = Math.abs(unit.gridX - x) + Math.abs(unit.gridY - y);
    const elevationDelta = Number(to.elevation) - Number(from.elevation);
    return distance === 1 && elevationDelta <= 1 && elevationDelta >= -1;
  }

  dispatch(intent) {
    switch (intent?.type) {
      case "MOVE": return this.move(intent);
      case "METEOR": return this.meteor(intent);
      case "ADD_WATER": return this.addWater(intent);
      case "ROTATE_CAMERA": return this.rotateCamera(intent);
      default: return { ok: false, reason: "UNKNOWN_INTENT" };
    }
  }

  move({ unitId, x, y }) {
    const unit = this.unitById(unitId);
    if (!unit?.alive) return { ok: false, reason: "UNIT_NOT_AVAILABLE" };
    if (!this.canMove(unit, x, y)) return { ok: false, reason: "ILLEGAL_MOVE" };
    const from = { x: unit.gridX, y: unit.gridY };
    unit.gridX = x; unit.gridY = y;
    this.emit({ type: "UNIT_MOVED", unitId, from, to: { x, y } });
    return { ok: true };
  }

  meteor({ x, y, setElevation = 1 }) {
    const tile = this.state.grid.tileAt(x, y);
    if (!tile) return { ok: false, reason: "NO_TILE" };
    const events = deformTerrain(this.state.grid, x, y, { setElevation, source: "METEOR" });
    this.emit({ type: "HYDROLOGY_UPDATED", source: "METEOR", events });
    return { ok: true, events };
  }

  addWater({ x, y, amount = 0.35 }) {
    const tile = this.state.grid.tileAt(x, y);
    if (!tile) return { ok: false, reason: "NO_TILE" };
    const events = [];
    const before = waterDepth(tile);
    addWater(tile, amount, events);
    redistribute(this.state.grid, { source: "DEBUG_ADD_WATER", events });
    this.emit({ type: "HYDROLOGY_UPDATED", source: "DEBUG_ADD_WATER", x, y, from: before, to: waterDepth(tile), events });
    return { ok: true, events };
  }

  rotateCamera({ delta = 1 }) {
    const turns = ((this.state.cameraQuarterTurns + delta) % 4 + 4) % 4;
    this.state.cameraQuarterTurns = turns;
    this.emit({ type: "CAMERA_ROTATED", quarterTurns: turns });
    return { ok: true };
  }
}
