import { describe, expect, it } from 'vitest';

import {
  BOARD_SIZE,
  completeFleet,
  createSeededRng,
  DEFAULT_RULES,
  FLEET,
  generateRandomFleet,
  SHIP_LENGTH,
  toPlacedShip,
  validateDraft,
  validateFleet,
  type GameRules,
  type Orientation,
  type PlacedShip,
  type ShipPlacement,
  type ShipType,
} from '../src/index.js';

const ADJACENT_FORBIDDEN: GameRules = { ...DEFAULT_RULES, areAdjacentShipsAllowed: false };
const ADJACENT_ALLOWED: GameRules = { ...DEFAULT_RULES, areAdjacentShipsAllowed: true };
const BOTH_SETTINGS = [
  ['forbidden', ADJACENT_FORBIDDEN],
  ['allowed', ADJACENT_ALLOWED],
] as const;
const SEED_COUNT = 500;

function ship(type: ShipType, x: number, y: number, orientation: Orientation = 'HORIZONTAL'): ShipPlacement {
  return { type, start: { x, y }, orientation };
}

/** The placement fields only, so ships compare equal whatever coordinates or extra fields they carry. */
function placementOf({ type, start, orientation }: ShipPlacement): ShipPlacement {
  return { type, start: { x: start.x, y: start.y }, orientation };
}

/** A complete fleet that is valid with adjacency forbidden, in reverse `FLEET` order. */
const SPREAD_FLEET: readonly ShipPlacement[] = [
  ship('DESTROYER', 8, 8, 'VERTICAL'),
  ship('SUBMARINE', 0, 8),
  ship('CRUISER', 0, 6),
  ship('BATTLESHIP', 0, 4),
  ship('CARRIER', 0, 0),
];

/**
 * Four ships whose surroundings leave no 5 free cells in a row or column, so the carrier cannot fit when adjacency is
 * forbidden (`#` ship, `+` surrounding cell):
 *
 *     0123456789
 *   0 ...+#+....
 *   1 ...+#+....
 *   2 ...+++....
 *   3 ++++.+++++
 *   4 ###+.+####
 *   5 ++++.+++++
 *   6 ...+++....
 *   7 ...+#+....
 *   8 ...+#+....
 *   9 ...+#+....
 */
const CARRIER_BLOCKING_DRAFT: readonly ShipPlacement[] = [
  ship('BATTLESHIP', 6, 4),
  ship('CRUISER', 4, 7, 'VERTICAL'),
  ship('SUBMARINE', 0, 4),
  ship('DESTROYER', 4, 0, 'VERTICAL'),
];

/** Whether two ships share a cell or touch, diagonals included. */
function areTouching(a: PlacedShip, b: PlacedShip): boolean {
  return a.coordinates.some((p) => b.coordinates.some((q) => Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1));
}

function expectCompleteValidFleet(fleet: readonly PlacedShip[], rules: GameRules): void {
  expect(validateFleet(fleet, rules)).toEqual({ ok: true, ships: fleet });
  expect(fleet.map((placed) => placed.type)).toEqual(FLEET);
}

describe('toPlacedShip', () => {
  it('extends horizontal ships towards larger x and vertical ships towards larger y', () => {
    expect(toPlacedShip(ship('CRUISER', 2, 7)).coordinates).toEqual([
      { x: 2, y: 7 },
      { x: 3, y: 7 },
      { x: 4, y: 7 },
    ]);
    expect(toPlacedShip(ship('DESTROYER', 9, 0, 'VERTICAL')).coordinates).toEqual([
      { x: 9, y: 0 },
      { x: 9, y: 1 },
    ]);
  });

  it.each(FLEET)('derives SHIP_LENGTH cells for a %s', (type) => {
    expect(toPlacedShip(ship(type, 0, 0, 'VERTICAL')).coordinates).toHaveLength(SHIP_LENGTH[type]);
  });

  it('ignores coordinates and extra fields sent by the client', () => {
    const forged = {
      ...ship('DESTROYER', 0, 0),
      coordinates: [{ x: 5, y: 5 }],
      isSunk: true,
    } as PlacedShip;
    expect(toPlacedShip(forged)).toEqual({
      ...ship('DESTROYER', 0, 0),
      coordinates: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
  });
});

describe('validateDraft', () => {
  it.each(BOTH_SETTINGS)('accepts an empty draft (adjacency %s)', (_name, rules) => {
    expect(validateDraft([], rules)).toEqual({ ok: true, ships: [] });
  });

  it.each(BOTH_SETTINGS)(
    'accepts a valid partial draft, deriving ships in input order (adjacency %s)',
    (_name, rules) => {
      const draft = [ship('SUBMARINE', 5, 5, 'VERTICAL'), ship('CARRIER', 0, 0)];
      expect(validateDraft(draft, rules)).toEqual({ ok: true, ships: draft.map(toPlacedShip) });
    },
  );

  it('accepts a complete valid fleet as a draft', () => {
    const ships = SPREAD_FLEET.map(toPlacedShip);
    expect(validateDraft(SPREAD_FLEET, ADJACENT_FORBIDDEN)).toEqual({ ok: true, ships });
  });

  describe('borders', () => {
    it('accepts ships touching every edge and corner', () => {
      const draft = [
        ship('CARRIER', BOARD_SIZE - 5, 0),
        ship('BATTLESHIP', 0, BOARD_SIZE - 4, 'VERTICAL'),
        ship('DESTROYER', BOARD_SIZE - 2, BOARD_SIZE - 1),
        ship('CRUISER', 0, 0, 'VERTICAL'),
        ship('SUBMARINE', BOARD_SIZE - 1, 3, 'VERTICAL'),
      ];
      expect(validateDraft(draft, ADJACENT_FORBIDDEN).ok).toBe(true);
    });

    it.each([
      ['past the right edge', ship('CARRIER', BOARD_SIZE - 4, 0)],
      ['past the bottom edge', ship('BATTLESHIP', 3, BOARD_SIZE - 3, 'VERTICAL')],
      ['with a negative x', ship('DESTROYER', -1, 4)],
      ['with a negative y', ship('DESTROYER', 4, -1, 'VERTICAL')],
      ['starting off the board', ship('DESTROYER', BOARD_SIZE, 0, 'VERTICAL')],
    ])('rejects a ship %s', (_name, placement) => {
      expect(validateDraft([ship('SUBMARINE', 0, 9), placement], ADJACENT_ALLOWED)).toEqual({
        ok: false,
        reason: 'OUT_OF_BOUNDS',
        shipIndex: 1,
      });
    });
  });

  describe('ship types', () => {
    it.each(BOTH_SETTINGS)('rejects a type placed twice (adjacency %s)', (_name, rules) => {
      const draft = [ship('CRUISER', 0, 0), ship('DESTROYER', 0, 5), ship('CRUISER', 5, 5)];
      expect(validateDraft(draft, rules)).toEqual({ ok: false, reason: 'DUPLICATE_TYPE', shipIndex: 2 });
    });

    it('rejects a sixth ship as a duplicate', () => {
      const draft = [...SPREAD_FLEET, ship('DESTROYER', 6, 2, 'VERTICAL')];
      expect(validateDraft(draft, ADJACENT_FORBIDDEN)).toEqual({ ok: false, reason: 'DUPLICATE_TYPE', shipIndex: 5 });
    });
  });

  describe('overlap', () => {
    it.each(BOTH_SETTINGS)('rejects crossing ships (adjacency %s)', (_name, rules) => {
      const draft = [ship('CARRIER', 2, 4), ship('CRUISER', 4, 3, 'VERTICAL')];
      expect(validateDraft(draft, rules)).toEqual({ ok: false, reason: 'OVERLAP', shipIndex: 1 });
    });

    it.each(BOTH_SETTINGS)('rejects ships sharing a single end cell (adjacency %s)', (_name, rules) => {
      const draft = [ship('DESTROYER', 0, 0), ship('SUBMARINE', 1, 0, 'VERTICAL')];
      expect(validateDraft(draft, rules)).toEqual({ ok: false, reason: 'OVERLAP', shipIndex: 1 });
    });
  });

  describe('adjacency', () => {
    const touchingPairs = [
      ['side by side', [ship('CARRIER', 0, 0), ship('BATTLESHIP', 2, 1)]],
      ['end to end', [ship('DESTROYER', 3, 3), ship('CRUISER', 5, 3)]],
      ['diagonally, down-right', [ship('DESTROYER', 0, 0), ship('CRUISER', 2, 1, 'VERTICAL')]],
      ['diagonally, down-left', [ship('DESTROYER', 5, 5, 'VERTICAL'), ship('SUBMARINE', 2, 7)]],
      ['diagonally, up-right', [ship('DESTROYER', 3, 6), ship('CRUISER', 5, 3, 'VERTICAL')]],
    ] as const;

    it.each(touchingPairs)('rejects ships touching %s when adjacency is forbidden', (_name, draft) => {
      expect(validateDraft(draft, ADJACENT_FORBIDDEN)).toEqual({ ok: false, reason: 'ADJACENT_SHIPS', shipIndex: 1 });
    });

    it.each(touchingPairs)('accepts ships touching %s when adjacency is allowed', (_name, draft) => {
      expect(validateDraft(draft, ADJACENT_ALLOWED).ok).toBe(true);
    });

    it('accepts ships one cell apart, diagonally included, when adjacency is forbidden', () => {
      const draft = [ship('DESTROYER', 0, 0), ship('CRUISER', 3, 2, 'VERTICAL'), ship('SUBMARINE', 0, 6)];
      expect(validateDraft(draft, ADJACENT_FORBIDDEN).ok).toBe(true);
    });
  });

  it('reports the first rule broken, in bounds, type, overlap, adjacency order', () => {
    const outOfBoundsDuplicate = [ship('DESTROYER', 0, 0), ship('DESTROYER', 9, 0)];
    expect(validateDraft(outOfBoundsDuplicate, ADJACENT_FORBIDDEN)).toMatchObject({ reason: 'OUT_OF_BOUNDS' });
    const overlappingDuplicate = [ship('DESTROYER', 0, 0), ship('DESTROYER', 0, 0)];
    expect(validateDraft(overlappingDuplicate, ADJACENT_FORBIDDEN)).toMatchObject({ reason: 'DUPLICATE_TYPE' });
  });
});

describe('validateFleet', () => {
  it.each(BOTH_SETTINGS)('accepts a complete valid fleet in any order (adjacency %s)', (_name, rules) => {
    expect(validateFleet(SPREAD_FLEET, rules)).toEqual({ ok: true, ships: SPREAD_FLEET.map(toPlacedShip) });
  });

  it.each([
    ['empty', []],
    ['partial', SPREAD_FLEET.slice(1)],
  ])('rejects an %s fleet as incomplete', (_name, ships) => {
    expect(validateFleet(ships, ADJACENT_FORBIDDEN)).toEqual({
      ok: false,
      reason: 'INCOMPLETE_FLEET',
      shipIndex: null,
    });
  });

  it('reports a broken rule before incompleteness', () => {
    const draft = [ship('CARRIER', 0, 0), ship('DESTROYER', 0, 1)];
    expect(validateFleet(draft, ADJACENT_FORBIDDEN)).toEqual({ ok: false, reason: 'ADJACENT_SHIPS', shipIndex: 1 });
  });
});

describe('generateRandomFleet', () => {
  it.each(BOTH_SETTINGS)(
    `always gives a complete valid fleet over ${String(SEED_COUNT)} seeds (adjacency %s)`,
    (_name, rules) => {
      for (let seed = 0; seed < SEED_COUNT; seed++) {
        expectCompleteValidFleet(generateRandomFleet(rules, createSeededRng(seed)), rules);
      }
    },
  );

  it.each(BOTH_SETTINGS)('gives the same fleet for the same seed (adjacency %s)', (_name, rules) => {
    expect(generateRandomFleet(rules, createSeededRng(42))).toEqual(generateRandomFleet(rules, createSeededRng(42)));
  });

  it('gives different fleets for different seeds', () => {
    const fleets = Array.from({ length: 20 }, (_, seed) =>
      JSON.stringify(generateRandomFleet(DEFAULT_RULES, createSeededRng(seed))),
    );
    expect(new Set(fleets).size).toBe(fleets.length);
  });

  it('lets ships touch only when adjacency is allowed', () => {
    const touchingFleets = (rules: GameRules): number =>
      Array.from({ length: SEED_COUNT }, (_, seed) => generateRandomFleet(rules, createSeededRng(seed))).filter(
        (fleet) => fleet.some((a, i) => fleet.slice(i + 1).some((b) => areTouching(a, b))),
      ).length;
    expect(touchingFleets(ADJACENT_FORBIDDEN)).toBe(0);
    expect(touchingFleets(ADJACENT_ALLOWED)).toBeGreaterThan(0);
  });
});

describe('completeFleet', () => {
  it.each(BOTH_SETTINGS)('completes an empty draft (adjacency %s)', (_name, rules) => {
    expectCompleteValidFleet(completeFleet([], rules, createSeededRng(1)), rules);
  });

  it.each(BOTH_SETTINGS)(
    'keeps the ships of a partial draft and adds the missing ones (adjacency %s)',
    (_name, rules) => {
      const draft = [ship('DESTROYER', 4, 4, 'VERTICAL'), ship('CARRIER', 0, 9)];
      const fleet = completeFleet(draft, rules, createSeededRng(1));
      expectCompleteValidFleet(fleet, rules);
      expect(fleet.map(placementOf)).toEqual(expect.arrayContaining(draft));
    },
  );

  it.each(BOTH_SETTINGS)(
    `keeps random partial drafts over ${String(SEED_COUNT)} seeds (adjacency %s)`,
    (_name, rules) => {
      for (let seed = 0; seed < SEED_COUNT; seed++) {
        const rng = createSeededRng(seed);
        const draft = rng.shuffle(generateRandomFleet(rules, rng)).slice(0, rng.nextInt(FLEET.length));
        const fleet = completeFleet(draft, rules, rng);
        expectCompleteValidFleet(fleet, rules);
        expect(fleet.map(placementOf)).toEqual(expect.arrayContaining(draft.map(placementOf)));
      }
    },
  );

  it('returns a complete valid draft unchanged, in FLEET order', () => {
    const fleet = completeFleet(SPREAD_FLEET, ADJACENT_FORBIDDEN, createSeededRng(1));
    expect(fleet).toEqual([...SPREAD_FLEET].reverse().map(toPlacedShip));
  });

  it('gives the same fleet for the same draft and seed', () => {
    const draft = [ship('BATTLESHIP', 3, 3)];
    expect(completeFleet(draft, DEFAULT_RULES, createSeededRng(7))).toEqual(
      completeFleet(draft, DEFAULT_RULES, createSeededRng(7)),
    );
  });

  it('re-derives the coordinates of the draft ships', () => {
    const forged = { ...ship('CARRIER', 0, 0), coordinates: [{ x: 9, y: 9 }] } as PlacedShip;
    const carrier = completeFleet([forged], DEFAULT_RULES, createSeededRng(1))[0];
    expect(carrier).toEqual(toPlacedShip(ship('CARRIER', 0, 0)));
  });

  describe('when the draft cannot be completed', () => {
    it('confirms the example draft is valid but leaves no room for a carrier', () => {
      expect(validateDraft(CARRIER_BLOCKING_DRAFT, ADJACENT_FORBIDDEN).ok).toBe(true);
      const carrierPositions = (['HORIZONTAL', 'VERTICAL'] as const).flatMap((orientation) =>
        Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, cell) =>
          ship('CARRIER', cell % BOARD_SIZE, Math.floor(cell / BOARD_SIZE), orientation),
        ),
      );
      const fitting = carrierPositions.filter(
        (carrier) => validateDraft([...CARRIER_BLOCKING_DRAFT, carrier], ADJACENT_FORBIDDEN).ok,
      );
      expect(fitting).toEqual([]);
    });

    it('falls back to a whole random fleet', () => {
      const fleet = completeFleet(CARRIER_BLOCKING_DRAFT, ADJACENT_FORBIDDEN, createSeededRng(3));
      expectCompleteValidFleet(fleet, ADJACENT_FORBIDDEN);
      expect(fleet.map(placementOf)).not.toEqual(expect.arrayContaining([...CARRIER_BLOCKING_DRAFT]));
      // The failed search drew nothing (no carrier position to shuffle), so the fallback sees the seed untouched.
      expect(fleet).toEqual(generateRandomFleet(ADJACENT_FORBIDDEN, createSeededRng(3)));
    });

    it('keeps the same draft when adjacency is allowed, since the carrier fits again', () => {
      const fleet = completeFleet(CARRIER_BLOCKING_DRAFT, ADJACENT_ALLOWED, createSeededRng(3));
      expectCompleteValidFleet(fleet, ADJACENT_ALLOWED);
      expect(fleet.map(placementOf)).toEqual(expect.arrayContaining([...CARRIER_BLOCKING_DRAFT]));
    });
  });

  it.each([
    ['overlapping', [ship('CARRIER', 0, 0), ship('DESTROYER', 2, 0, 'VERTICAL')]],
    ['out-of-bounds', [ship('CARRIER', 8, 0)]],
    ['duplicate', [ship('DESTROYER', 0, 0), ship('DESTROYER', 5, 5)]],
  ])('replaces an invalid %s draft with a whole random fleet', (_name, draft) => {
    const fleet = completeFleet(draft, ADJACENT_FORBIDDEN, createSeededRng(5));
    expect(fleet).toEqual(generateRandomFleet(ADJACENT_FORBIDDEN, createSeededRng(5)));
  });
});
