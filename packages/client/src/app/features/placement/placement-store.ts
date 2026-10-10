import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import {
  CLIENT_EVENTS,
  DEFAULT_RULES,
  ORIENTATIONS,
  SERVER_EVENTS,
  createCryptoRng,
  generateRandomFleet,
  toPlacedShip,
  validateFleet,
  type Coordinate,
  type ErrorCode,
  type Orientation,
  type PlacementViolation,
  type ShipPlacement,
  type ShipType,
} from '@battleship/core';

import { GameSocketService, type TransportError } from '../../core/game-socket';
import { GameStateService } from '../../core/game-state';
import {
  findShip,
  isSameDraft,
  otherOrientation,
  placeShip,
  removeShip,
  rotateShip,
  shipAt,
  toShipPlacement,
  type DraftChange,
  type FleetDraft,
} from './fleet-draft';

/** What the last placement action did, announced to the player (ADR-0043). */
export const PLACEMENT_FEEDBACK = {
  /** A ship was selected, from the dock or on the board. */
  SELECTED: 'selected',
  /** The selected ship was put on the board, or moved. */
  PLACED: 'placed',
  /** The selected ship was turned. */
  ROTATED: 'rotated',
  /** The selected ship went back to the dock. */
  REMOVED: 'removed',
  /** The rules refuse the position tried; nothing changed. */
  REFUSED: 'refused',
  /** "Randomize" replaced the whole draft. */
  RANDOMIZED: 'randomized',
  /** Water was tapped with no ship selected. */
  NO_SHIP_SELECTED: 'no-ship-selected',
} as const;

/** One of the `PLACEMENT_FEEDBACK` kinds. */
export type PlacementFeedbackKind = (typeof PLACEMENT_FEEDBACK)[keyof typeof PLACEMENT_FEEDBACK];

/** What the last placement action did, with what its message needs. */
export type PlacementFeedback =
  | {
      /** A ship was selected. */
      readonly kind: typeof PLACEMENT_FEEDBACK.SELECTED;
      /** The ship. */
      readonly ship: ShipType;
      /** The direction it extends in, or will once placed from the dock. */
      readonly orientation: Orientation;
      /** Whether it is already on the board. */
      readonly isPlaced: boolean;
    }
  | {
      /** A ship was placed or turned. */
      readonly kind: typeof PLACEMENT_FEEDBACK.PLACED | typeof PLACEMENT_FEEDBACK.ROTATED;
      /** The ship, at its new position. */
      readonly placement: ShipPlacement;
    }
  | {
      /** A ship went back to the dock. */
      readonly kind: typeof PLACEMENT_FEEDBACK.REMOVED;
      /** The ship. */
      readonly ship: ShipType;
    }
  | {
      /** A position was refused. */
      readonly kind: typeof PLACEMENT_FEEDBACK.REFUSED;
      /** The ship that did not move. */
      readonly ship: ShipType;
      /** The rule the position breaks. */
      readonly reason: PlacementViolation;
    }
  | {
      /** An action that names no ship. */
      readonly kind: typeof PLACEMENT_FEEDBACK.RANDOMIZED | typeof PLACEMENT_FEEDBACK.NO_SHIP_SELECTED;
    };

/** Why a placement command failed: the server's refusal, or no reply at all (ADR-0035). */
export type PlacementCommandError = ErrorCode | TransportError;

/** The ship the next tap on the board places or moves. */
export interface SelectedShip {
  /** The ship picked in the dock or on the board. */
  readonly type: ShipType;
  /** Its position on the board; `null` while it is still in the dock. */
  readonly placement: ShipPlacement | null;
  /** The direction it extends in: its own once placed, the one chosen for it while in the dock. */
  readonly orientation: Orientation;
}

/**
 * The state and actions of the placement view (docs/client.md#board--interaction), one per view: provided by
 * `Placement`. The draft is kept here and sent whole with `UPDATE_PLACEMENT` on every change (ADR-0005); the latest
 * `STATE` replaces it only while no update is waiting for its ack (ADR-0054).
 */
@Service({ autoProvided: false })
export class PlacementStore {
  /** Sends the placement commands and delivers `STATE`. */
  private readonly socket = inject(GameSocketService);
  /** The latest snapshot: the rules, the server's draft and both locks. */
  private readonly gameState = inject(GameStateService);
  /** Draws the fleets of "Randomize" (ADR-0007, ADR-0030). */
  private readonly rng = createCryptoRng();

  /** The `PLACEMENT` part of the latest snapshot; `null` once the phase is over. */
  private readonly placement = computed(() => this.gameState.snapshot()?.placement ?? null);

  /** The room's rules, which decide whether ships may touch. */
  readonly rules = computed(() => this.gameState.snapshot()?.rules ?? DEFAULT_RULES);

  /** Set by every local change at once, and by `STATE` while no update is in flight (ADR-0054); read through `draft`. */
  private readonly draftSignal = signal<FleetDraft>(this.serverDraft(), { equal: isSameDraft });
  /** The layout the player sees; ahead of the snapshot while updates wait for their ack. */
  readonly draft = this.draftSignal.asReadonly();
  /** The draft with the cells of each ship, for the board. */
  readonly ships = computed(() => this.draft().map(toPlacedShip));

  /** Whether the player's fleet is locked by `CONFIRM_PLACEMENT`. */
  readonly isConfirmed = computed(() => this.placement()?.hasConfirmed.me ?? false);
  /** Whether the opponent's fleet is locked. */
  readonly isOpponentConfirmed = computed(() => this.placement()?.hasConfirmed.opponent ?? false);

  /** True from sending `CONFIRM_PLACEMENT` or `UNLOCK_PLACEMENT` until its ack; read through `isLockPending`. */
  private readonly isLockPendingSignal = signal(false);
  /** Whether a `CONFIRM_PLACEMENT` or `UNLOCK_PLACEMENT` waits for its ack. */
  readonly isLockPending = this.isLockPendingSignal.asReadonly();
  /** Whether the draft can change: not locked, and no lock change on its way. */
  readonly isEditable = computed(() => !this.isConfirmed() && !this.isLockPending());

  /** Why the draft cannot be confirmed yet, from core's `validateFleet`; `null` for a complete valid fleet. */
  readonly fleetViolation = computed(() => {
    const validation = validateFleet(this.draft(), this.rules());
    return validation.ok ? null : validation.reason;
  });
  /** Whether "Confirm" would be accepted. */
  readonly canConfirm = computed(() => this.isEditable() && this.fleetViolation() === null);

  /** The ship picked in the dock or on the board; "Randomize" and "Confirm" clear it. Read through `selected`. */
  private readonly selectedTypeSignal = signal<ShipType | null>(null);
  /** The direction a ship from the dock is placed in; "Rotate" turns it before the ship is placed. */
  private readonly dockOrientation = signal<Orientation>(ORIENTATIONS.HORIZONTAL);
  /** The ship the next tap on the board places or moves; `null` when none is selected or the fleet is locked. */
  readonly selected = computed<SelectedShip | null>(() => {
    const type = this.selectedTypeSignal();
    if (type === null || !this.isEditable()) {
      return null;
    }
    const placement = findShip(this.draft(), type) ?? null;
    return { type, placement, orientation: placement?.orientation ?? this.dockOrientation() };
  });
  /** The cells of the selected ship, once placed. */
  readonly selectedCells = computed<readonly Coordinate[]>(() => {
    const placement = this.selected()?.placement;
    return placement ? toPlacedShip(placement).coordinates : [];
  });

  /** Set by a refused tap, emptied by every other action; read through `invalidPreview`. */
  private readonly previewSignal = signal<readonly Coordinate[]>([]);
  /** The cells of the last refused position; cleared by the next action. */
  readonly invalidPreview = this.previewSignal.asReadonly();

  /** Set by every action, for the live region; read through `feedback`. */
  private readonly feedbackSignal = signal<PlacementFeedback | null>(null);
  /** What the last action did; `null` before the first one. */
  readonly feedback = this.feedbackSignal.asReadonly();

  /** Set by every ack: the error of a refusal, `null` for a success; read through `error`. */
  private readonly errorSignal = signal<PlacementCommandError | null>(null);
  /** Why the last command failed; cleared by the next one that succeeds. */
  readonly error = this.errorSignal.asReadonly();

  /** `UPDATE_PLACEMENT`s sent and not yet answered; while there is one, `STATE` does not replace the draft. */
  private updatesInFlight = 0;

  /** Follows `STATE` while no update is in flight; stops with the view. */
  constructor() {
    const stopListening = this.socket.on(SERVER_EVENTS.STATE, (snapshot) => {
      if (this.updatesInFlight === 0 && snapshot.placement !== null) {
        this.draftSignal.set(snapshot.placement.myShips.map(toShipPlacement));
      }
    });
    inject(DestroyRef).onDestroy(stopListening);
  }

  /**
   * Selects a ship from the dock, or clears the selection when it is the selected one already.
   * @param type The ship tapped in the dock.
   */
  selectShip(type: ShipType): void {
    if (!this.isEditable()) {
      return;
    }
    this.previewSignal.set([]);
    if (this.selectedTypeSignal() === type) {
      this.selectedTypeSignal.set(null);
      this.feedbackSignal.set(null);
      return;
    }
    this.select(type);
  }

  /**
   * Handles a tapped cell (ADR-0053): a cell of another ship selects that ship; any other cell puts the selected ship
   * there, with the cell as its start, or previews why the rules refuse it.
   * @param coordinate The cell activated on the board.
   */
  activateCell(coordinate: Coordinate): void {
    if (!this.isEditable()) {
      return;
    }
    this.previewSignal.set([]);
    const selected = this.selected();
    const shipOnCell = shipAt(this.draft(), coordinate);
    if (shipOnCell !== null && shipOnCell !== selected?.type) {
      this.select(shipOnCell);
      return;
    }
    if (selected === null) {
      this.feedbackSignal.set({ kind: PLACEMENT_FEEDBACK.NO_SHIP_SELECTED });
      return;
    }
    const change = placeShip(
      this.draft(),
      { type: selected.type, start: coordinate, orientation: selected.orientation },
      this.rules(),
    );
    this.apply(change, selected.type, PLACEMENT_FEEDBACK.PLACED);
  }

  /** Turns the selected ship: about its start once placed, or the direction it will be placed in while in the dock. */
  rotate(): void {
    const selected = this.selected();
    if (selected === null) {
      return;
    }
    this.previewSignal.set([]);
    if (selected.placement === null) {
      const orientation = otherOrientation(selected.orientation);
      this.dockOrientation.set(orientation);
      this.feedbackSignal.set({ kind: PLACEMENT_FEEDBACK.SELECTED, ship: selected.type, orientation, isPlaced: false });
      return;
    }
    this.apply(rotateShip(this.draft(), selected.type, this.rules()), selected.type, PLACEMENT_FEEDBACK.ROTATED);
  }

  /** Puts the selected ship back in the dock; it stays selected, ready to be placed again. */
  remove(): void {
    const selected = this.selected();
    if (selected === null || selected.placement === null) {
      return;
    }
    this.previewSignal.set([]);
    this.dockOrientation.set(selected.orientation);
    this.feedbackSignal.set({ kind: PLACEMENT_FEEDBACK.REMOVED, ship: selected.type });
    this.update(removeShip(this.draft(), selected.type));
  }

  /** Replaces the whole draft with a random valid fleet from core's `generateRandomFleet` (ADR-0007). */
  randomize(): void {
    if (!this.isEditable()) {
      return;
    }
    this.previewSignal.set([]);
    this.selectedTypeSignal.set(null);
    this.feedbackSignal.set({ kind: PLACEMENT_FEEDBACK.RANDOMIZED });
    this.update(generateRandomFleet(this.rules(), this.rng).map(toShipPlacement));
  }

  /** Locks a complete valid fleet with `CONFIRM_PLACEMENT`; does nothing before the fleet is complete. */
  async confirm(): Promise<void> {
    if (!this.canConfirm()) {
      return;
    }
    this.previewSignal.set([]);
    this.selectedTypeSignal.set(null);
    this.feedbackSignal.set(null);
    await this.changeLock(CLIENT_EVENTS.CONFIRM_PLACEMENT);
  }

  /** Reverts a locked fleet to draft with `UNLOCK_PLACEMENT`. */
  async unlock(): Promise<void> {
    if (!this.isConfirmed() || this.isLockPending()) {
      return;
    }
    await this.changeLock(CLIENT_EVENTS.UNLOCK_PLACEMENT);
  }

  /**
   * Selects a ship and says so.
   * @param type The ship.
   */
  private select(type: ShipType): void {
    const placement = findShip(this.draft(), type);
    this.selectedTypeSignal.set(type);
    this.feedbackSignal.set({
      kind: PLACEMENT_FEEDBACK.SELECTED,
      ship: type,
      orientation: placement?.orientation ?? this.dockOrientation(),
      isPlaced: placement !== undefined,
    });
  }

  /**
   * Applies a move or a rotation the rules accept, or previews the one they refuse; a refusal sends nothing.
   * @param change The outcome from `placeShip` or `rotateShip`.
   * @param type The ship that moved or would have.
   * @param kind What an accepted change is announced as.
   */
  private apply(
    change: DraftChange,
    type: ShipType,
    kind: typeof PLACEMENT_FEEDBACK.PLACED | typeof PLACEMENT_FEEDBACK.ROTATED,
  ): void {
    if (!change.ok) {
      this.previewSignal.set(change.preview);
      this.feedbackSignal.set({ kind: PLACEMENT_FEEDBACK.REFUSED, ship: type, reason: change.reason });
      return;
    }
    const placement = findShip(change.draft, type);
    if (placement !== undefined) {
      this.feedbackSignal.set({ kind, placement });
    }
    this.update(change.draft);
  }

  /**
   * Shows a new draft at once and sends it whole with `UPDATE_PLACEMENT` (ADR-0005). A failed update puts back the
   * server's draft, once no other update is in flight (ADR-0054).
   * @param draft The new draft, valid.
   */
  private update(draft: FleetDraft): void {
    this.draftSignal.set(draft);
    this.updatesInFlight++;
    void this.socket.emitWithAck(CLIENT_EVENTS.UPDATE_PLACEMENT, { ships: draft }).then((result) => {
      this.updatesInFlight--;
      if (result.ok) {
        this.errorSignal.set(null);
        return;
      }
      this.errorSignal.set(result.error);
      if (this.updatesInFlight === 0) {
        this.draftSignal.set(this.serverDraft());
      }
    });
  }

  /**
   * Sends a lock change and waits for its ack; the new lock state arrives with the next `STATE`.
   * @param event `CONFIRM_PLACEMENT` or `UNLOCK_PLACEMENT`.
   */
  private async changeLock(
    event: typeof CLIENT_EVENTS.CONFIRM_PLACEMENT | typeof CLIENT_EVENTS.UNLOCK_PLACEMENT,
  ): Promise<void> {
    this.isLockPendingSignal.set(true);
    const result = await this.socket.emitWithAck(event, {});
    this.isLockPendingSignal.set(false);
    this.errorSignal.set(result.ok ? null : result.error);
  }

  /**
   * Reads the draft the server holds.
   * @returns The ships of the latest snapshot, without their coordinates; empty outside placement.
   */
  private serverDraft(): FleetDraft {
    return this.placement()?.myShips.map(toShipPlacement) ?? [];
  }
}
