import {
  DEFAULT_RULES,
  ORIENTATIONS,
  PLACEMENT_VIOLATIONS,
  SHIP_TYPES,
  toPlacedShip,
  type GameRules,
  type ShipPlacement,
} from '@battleship/core';
import { describe, expect, it } from 'vitest';

import {
  fitOnBoard,
  isSameDraft,
  placeShip,
  removeShip,
  rotateShip,
  shipAt,
  toShipPlacement,
  type FleetDraft,
} from './fleet-draft';

/** A carrier on A1–A5. */
const CARRIER: ShipPlacement = {
  type: SHIP_TYPES.CARRIER,
  start: { x: 0, y: 0 },
  orientation: ORIENTATIONS.HORIZONTAL,
};
/** A destroyer on C1–D1. */
const DESTROYER: ShipPlacement = {
  type: SHIP_TYPES.DESTROYER,
  start: { x: 0, y: 2 },
  orientation: ORIENTATIONS.VERTICAL,
};

/** The default rules with ships allowed to touch. */
const TOUCHING_ALLOWED: GameRules = { ...DEFAULT_RULES, areAdjacentShipsAllowed: true };

describe('toShipPlacement', () => {
  it('drops the derived coordinates, which the payload guard refuses', () => {
    expect(toShipPlacement(toPlacedShip(CARRIER))).toStrictEqual(CARRIER);
  });
});

describe('fitOnBoard', () => {
  it('keeps a start that fits', () => {
    expect(fitOnBoard({ ...CARRIER, start: { x: 5, y: 9 } }).start).toEqual({ x: 5, y: 9 });
  });

  it('moves the start back along the ship until the last cell is on the board', () => {
    expect(fitOnBoard({ ...CARRIER, start: { x: 8, y: 3 } }).start).toEqual({ x: 5, y: 3 });
    expect(fitOnBoard({ ...DESTROYER, start: { x: 7, y: 9 } }).start).toEqual({ x: 7, y: 8 });
  });
});

describe('shipAt', () => {
  it('finds the ship on any of its cells, and none on water', () => {
    const draft: FleetDraft = [CARRIER, DESTROYER];

    expect(shipAt(draft, { x: 4, y: 0 })).toBe(SHIP_TYPES.CARRIER);
    expect(shipAt(draft, { x: 0, y: 3 })).toBe(SHIP_TYPES.DESTROYER);
    expect(shipAt(draft, { x: 5, y: 0 })).toBeNull();
  });
});

describe('placeShip', () => {
  it('adds a ship from the dock, in FLEET order', () => {
    const change = placeShip([DESTROYER], CARRIER, DEFAULT_RULES);

    expect(change).toEqual({ ok: true, draft: [CARRIER, DESTROYER] });
  });

  it('moves a placed ship instead of adding it twice', () => {
    const moved = { ...CARRIER, start: { x: 3, y: 6 } };

    expect(placeShip([CARRIER, DESTROYER], moved, DEFAULT_RULES)).toEqual({ ok: true, draft: [moved, DESTROYER] });
  });

  it('fits a start too close to the edge onto the board', () => {
    const change = placeShip([], { ...CARRIER, start: { x: 9, y: 9 } }, DEFAULT_RULES);

    expect(change).toEqual({ ok: true, draft: [{ ...CARRIER, start: { x: 5, y: 9 } }] });
  });

  it('refuses touching ships when the rules forbid it, with the cells to preview', () => {
    const change = placeShip([CARRIER], { ...DESTROYER, start: { x: 5, y: 1 } }, DEFAULT_RULES);

    expect(change).toEqual({
      ok: false,
      reason: PLACEMENT_VIOLATIONS.ADJACENT_SHIPS,
      preview: [
        { x: 5, y: 1 },
        { x: 5, y: 2 },
      ],
    });
  });

  it('accepts touching ships when the rules allow it', () => {
    expect(placeShip([CARRIER], { ...DESTROYER, start: { x: 5, y: 1 } }, TOUCHING_ALLOWED).ok).toBe(true);
  });

  it('refuses overlapping ships', () => {
    const change = placeShip([CARRIER], { ...DESTROYER, start: { x: 2, y: 0 } }, TOUCHING_ALLOWED);

    expect(change).toMatchObject({ ok: false, reason: PLACEMENT_VIOLATIONS.OVERLAP });
  });
});

describe('rotateShip', () => {
  it('turns a ship about its start', () => {
    const change = rotateShip([CARRIER], SHIP_TYPES.CARRIER, DEFAULT_RULES);

    expect(change).toEqual({ ok: true, draft: [{ ...CARRIER, orientation: ORIENTATIONS.VERTICAL }] });
  });

  it('fits the turned ship onto the board', () => {
    const atBottom = { ...CARRIER, start: { x: 2, y: 8 } };

    expect(rotateShip([atBottom], SHIP_TYPES.CARRIER, DEFAULT_RULES)).toEqual({
      ok: true,
      draft: [{ type: SHIP_TYPES.CARRIER, start: { x: 2, y: 5 }, orientation: ORIENTATIONS.VERTICAL }],
    });
  });

  it('refuses a turn onto another ship, previewing the turned ship', () => {
    const change = rotateShip([CARRIER, DESTROYER], SHIP_TYPES.CARRIER, DEFAULT_RULES);

    expect(change).toMatchObject({ ok: false, reason: PLACEMENT_VIOLATIONS.OVERLAP });
    expect(change.ok ? [] : change.preview).toHaveLength(5);
  });

  it('leaves the draft alone for a ship in the dock', () => {
    const draft: FleetDraft = [DESTROYER];

    expect(rotateShip(draft, SHIP_TYPES.CARRIER, DEFAULT_RULES)).toEqual({ ok: true, draft });
  });
});

describe('removeShip', () => {
  it('takes the ship off the board', () => {
    expect(removeShip([CARRIER, DESTROYER], SHIP_TYPES.CARRIER)).toEqual([DESTROYER]);
  });
});

describe('isSameDraft', () => {
  it('compares positions, not order or identity', () => {
    expect(isSameDraft([CARRIER, DESTROYER], [toPlacedShip(DESTROYER), { ...CARRIER }])).toBe(true);
    expect(isSameDraft([CARRIER], [CARRIER, DESTROYER])).toBe(false);
    expect(isSameDraft([CARRIER], [{ ...CARRIER, orientation: ORIENTATIONS.VERTICAL }])).toBe(false);
    expect(isSameDraft([CARRIER], [{ ...CARRIER, start: { x: 0, y: 1 } }])).toBe(false);
  });
});
