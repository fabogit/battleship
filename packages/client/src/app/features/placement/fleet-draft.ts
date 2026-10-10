import {
  BOARD_SIZE,
  FLEET,
  ORIENTATIONS,
  SHIP_LENGTH,
  toPlacedShip,
  validateDraft,
  type Coordinate,
  type GameRules,
  type Orientation,
  type PlacementViolation,
  type ShipPlacement,
  type ShipType,
} from '@battleship/core';

/** A placement draft as `UPDATE_PLACEMENT` sends it: at most one ship per type, in `FLEET` order, no coordinates. */
export type FleetDraft = readonly ShipPlacement[];

/** The outcome of moving or rotating one ship of a draft (ADR-0053). */
export type DraftChange =
  | {
      /** Discriminant: the rules accept the new position. */
      readonly ok: true;
      /** The draft with the ship at its new position. */
      readonly draft: FleetDraft;
    }
  | {
      /** Discriminant: the rules refuse the new position; the draft is unchanged. */
      readonly ok: false;
      /** The rule the position breaks, from core's `validateDraft`. */
      readonly reason: PlacementViolation;
      /** The cells the refused ship would occupy, for the board's invalid preview. */
      readonly preview: readonly Coordinate[];
    };

/**
 * Keeps only the fields `UPDATE_PLACEMENT` accepts: the payload guard refuses any other property (ADR-0031), so the
 * derived coordinates of a `PlacedShip` must not travel back to the server.
 * @param ship A ship, possibly with its coordinates.
 * @returns A new placement with `type`, `start` and `orientation` only.
 */
export function toShipPlacement({ type, start, orientation }: ShipPlacement): ShipPlacement {
  return { type, start: { x: start.x, y: start.y }, orientation };
}

/**
 * Shifts a ship's start back towards the board, so that a ship whose tapped start cell is too close to the right or
 * bottom edge still fits, as close to that cell as possible (ADR-0053).
 * @param placement The ship with the tapped cell as its start.
 * @returns The same ship with the start moved back just enough to keep every cell on the board.
 */
export function fitOnBoard(placement: ShipPlacement): ShipPlacement {
  const lastStart = BOARD_SIZE - SHIP_LENGTH[placement.type];
  const { x, y } = placement.start;
  const start =
    placement.orientation === ORIENTATIONS.HORIZONTAL
      ? { x: Math.min(x, lastStart), y }
      : { x, y: Math.min(y, lastStart) };
  return { type: placement.type, start, orientation: placement.orientation };
}

/**
 * Finds the ship lying on a cell.
 * @param draft The draft.
 * @param coordinate A cell on the board.
 * @returns The type of the ship on that cell, or `null` for water.
 */
export function shipAt(draft: FleetDraft, coordinate: Coordinate): ShipType | null {
  const ship = draft
    .map(toPlacedShip)
    .find((placed) => placed.coordinates.some(({ x, y }) => x === coordinate.x && y === coordinate.y));
  return ship?.type ?? null;
}

/**
 * Finds one ship of a draft.
 * @param draft The draft.
 * @param type The ship to look for.
 * @returns Its placement, or `undefined` while it is still in the dock.
 */
export function findShip(draft: FleetDraft, type: ShipType): ShipPlacement | undefined {
  return draft.find((ship) => ship.type === type);
}

/**
 * Puts a ship at a position, moving it when it is already placed, and checks the result with core's `validateDraft`.
 * The start is first fitted onto the board (`fitOnBoard`), so a tap never fails for lack of room.
 * @param draft The current draft, valid.
 * @param placement The ship, its start being the tapped cell.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @returns The new draft in `FLEET` order, or the broken rule with the cells to preview.
 */
export function placeShip(draft: FleetDraft, placement: ShipPlacement, rules: GameRules): DraftChange {
  const fitted = fitOnBoard(placement);
  const candidate = sortByFleet([...draft.filter((ship) => ship.type !== fitted.type), fitted]);
  const validation = validateDraft(candidate, rules);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, preview: toPlacedShip(fitted).coordinates };
  }
  return { ok: true, draft: candidate };
}

/**
 * Turns a placed ship about its start cell, fitted onto the board like a tap (ADR-0053).
 * @param draft The current draft, valid.
 * @param type A ship of the draft.
 * @param rules The room's rules; only `areAdjacentShipsAllowed` matters.
 * @returns The new draft, or the broken rule with the cells to preview; the draft unchanged when the ship is not placed.
 */
export function rotateShip(draft: FleetDraft, type: ShipType, rules: GameRules): DraftChange {
  const ship = findShip(draft, type);
  if (ship === undefined) {
    return { ok: true, draft };
  }
  return placeShip(draft, { ...ship, orientation: otherOrientation(ship.orientation) }, rules);
}

/**
 * Takes a ship off the board, back to the dock.
 * @param draft The current draft.
 * @param type The ship to remove.
 * @returns The draft without it.
 */
export function removeShip(draft: FleetDraft, type: ShipType): FleetDraft {
  return draft.filter((ship) => ship.type !== type);
}

/**
 * Tells whether two drafts hold the same ships at the same positions, whatever their order.
 * @param a One draft.
 * @param b The other draft.
 * @returns True when every ship of one is in the other with the same start and orientation.
 */
export function isSameDraft(a: FleetDraft, b: FleetDraft): boolean {
  return (
    a.length === b.length &&
    a.every((ship) => {
      const other = findShip(b, ship.type);
      return (
        other !== undefined &&
        other.orientation === ship.orientation &&
        other.start.x === ship.start.x &&
        other.start.y === ship.start.y
      );
    })
  );
}

/**
 * The orientation a rotation turns a ship to: "Rotate" toggles between the two.
 * @param orientation The current orientation.
 * @returns `VERTICAL` for `HORIZONTAL`, `HORIZONTAL` for `VERTICAL`.
 */
export function otherOrientation(orientation: Orientation): Orientation {
  return orientation === ORIENTATIONS.HORIZONTAL ? ORIENTATIONS.VERTICAL : ORIENTATIONS.HORIZONTAL;
}

/**
 * Orders ships as `FLEET` lists them, largest first, so that every payload lists the same draft the same way.
 * @param ships At most one ship per type.
 * @returns A new array in `FLEET` order.
 */
function sortByFleet(ships: readonly ShipPlacement[]): ShipPlacement[] {
  return [...ships].sort((a, b) => FLEET.indexOf(a.type) - FLEET.indexOf(b.type));
}
