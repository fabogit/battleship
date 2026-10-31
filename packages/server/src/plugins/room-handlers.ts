// Socket.io commands wired to room logic (docs/server.md#socket-handlers): guard → room logic → ack → effects → `STATE`.
// A failure in room logic is contained to its room (ADR-0104).

import {
  CLIENT_EVENTS,
  ERROR_CODES,
  GAME_OVER_TTL_MS,
  PAYLOAD_PARSERS,
  ROOM_CLOSED_REASONS,
  ROOM_PHASES,
  SEATS,
  SERVER_EVENTS,
  WAITING_TTL_MS,
  type AckFailure,
  type AckResponse,
  type ClientToServerEvents,
  type CommandEvent,
  type CommandPayload,
  type RoomClosedReason,
  type Seat,
  type UpdateRulesAckData,
} from '@battleship/core';
import fp from 'fastify-plugin';

import type { FastifyBaseLogger } from 'fastify';
import type { Socket } from 'socket.io';

import type { Clock } from '../clock.js';
import type { RoomManager } from '../room/room-manager.js';
import { ROOM_TIMER_KINDS, RoomTimers, type RoomTimerKind } from '../room/room-timers.js';
import type { RejectedTransition, RoomState, SeatCommand, SeatCommandEvent } from '../room/room.js';
import { projectSnapshot } from '../room/snapshot.js';
import type { GameServer, GameSocket } from './socket-io.js';

/**
 * The reply one command's ack carries, read from its callback in `ClientToServerEvents`.
 * @template E The command's event name.
 */
type CommandAck<E extends CommandEvent> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/**
 * Sends a command's reply to the client's ack callback. A failure fits every command's reply.
 * @template E The command's event name.
 */
type Reply<E extends CommandEvent> = (response: CommandAck<E> | AckFailure) => void;

/** The commands that take a seat, and with it move the socket out of the room it sat in before. */
type SeatTakingEvent = typeof CLIENT_EVENTS.CREATE_ROOM | typeof CLIENT_EVENTS.JOIN_ROOM;

/**
 * What a contained failure was running, for its log line (ADR-0104): a command, a socket's `connection` or `disconnect`,
 * or a room timer.
 */
type FailureSource =
  | {
      /** The client event being handled. */
      readonly event: CommandEvent | 'connection' | 'disconnect';
    }
  | {
      /** The room timer whose task ran. */
      readonly timer: RoomTimerKind;
    };

/**
 * Handles one command whose payload passed its guard: replies exactly once, then sends what the change requires.
 * @template E The command's event name.
 */
type CommandHandler<E extends CommandEvent> = (payload: CommandPayload<E>, reply: Reply<E>) => void;

/**
 * The ack data of a command whose accepted ack is a bare `{ ok: true }`.
 * @returns No data.
 */
const NO_ACK_DATA = (): object => ({});

/**
 * Every command the plugin listens to: all client→server events but `ECHO`, which has its own plugin and no guard.
 * Exported for the tests, which send each one malformed.
 */
export const COMMAND_EVENTS: readonly CommandEvent[] = Object.values(CLIENT_EVENTS).filter(
  (event): event is CommandEvent => event !== CLIENT_EVENTS.ECHO,
);

/** What the `room-handlers` plugin needs; `createServer` passes production defaults, tests inject both. */
export interface RoomHandlersOptions {
  /** The open rooms; one registry per server. */
  readonly rooms: RoomManager;
  /**
   * The time of each command, passed to room logic and the snapshot projection, and the room timers: the end of
   * placement, the disconnect forfeit, the waiting TTL and the game-over TTL (ADR-0065).
   */
  readonly clock: Clock;
}

/** What the listeners of one socket share with the rest of the plugin. */
interface CommandContext {
  /** The open rooms. */
  readonly rooms: RoomManager;
  /** Current time in epoch ms. */
  readonly now: () => number;
  /**
   * Brings a room's timers in line with its stored state: the end of placement, the forfeit of the seat away longest,
   * the waiting TTL and the game-over TTL; called after every accepted command and every change to its seats' presence.
   * @param roomId The room that changed; an id no room has stops whatever timers it had left.
   */
  readonly reviewTimers: (roomId: string) => void;
  /**
   * Compares each seat of a room with the sockets bound to it and records every seat that dropped or came back
   * (ADR-0072); when one did, every socket of the room gets `STATE` and the timers are reviewed.
   * @param roomId The room whose sockets changed; an id no room has is ignored.
   * @returns Whether a seat's presence changed, so `STATE` went out.
   */
  readonly syncPresence: (roomId: string) => boolean;
  /**
   * Removes a room nobody is left in (ADR-0073) and logs it as "Room closed".
   * @param roomId The room to remove.
   * @param reason What freed its last seat, for the log: `LEAVE_ROOM`, `DISCONNECT_FORFEIT`, or the `CREATE_ROOM` or
   * `JOIN_ROOM` that moved its only player on (ADR-0095).
   */
  readonly closeRoom: (roomId: string, reason: string) => void;
  /**
   * Runs work that follows a change already stored in a room, containing a throw to that room (ADR-0104): the error is
   * logged as "Room failed" and the room closes with the `ROOM_CLOSED` reason `SERVER_ERROR`.
   * @param roomId The room the work is for.
   * @param source What the work belongs to, for the log.
   * @param task The work.
   * @param onFailure Runs after a throw, before the room closes: a command's `SERVER_ERROR` ack.
   */
  readonly contain: (roomId: string, source: FailureSource, task: () => void, onFailure?: () => void) => void;
}

/**
 * Listens to every command on every socket (docs/server.md#socket-handlers). A payload that fails its core guard is
 * refused with `INVALID_PAYLOAD` before room logic sees it; a command sent without an ack callback is ignored. An
 * accepted command is acked first, then its effects (`SHOT_RESOLVED`) go to the room and each seated socket gets its
 * own `STATE` projection (ADR-0047). Placement ends on a room timer, at the end of the start countdown or at the
 * deadline, and the match starts with `DICE_ROLLED` (ADR-0090, ADR-0092). Seat presence is tracked here too
 * (docs/server.md#seat-presence, ADR-0072): a seat with no socket bound to it is away, its forfeit clock runs as a room
 * timer, and every socket of the room gets `STATE` when a seat drops or comes back. A room nobody joins expires after
 * `WAITING_TTL_MS` (ADR-0096), a room in `GAME_OVER` after `GAME_OVER_TTL_MS`, and one nobody is left in closes
 * (docs/server.md#room-lifecycle); the sockets still in an expired room lose their seat and get `ROOM_CLOSED`
 * (ADR-0097). A throw in room logic stays in its room (ADR-0104): before anything is stored it refuses the command with
 * `SERVER_ERROR`; after a change is stored, in a timer task, or in a socket's `connection` or `disconnect`, it closes
 * the room with the `ROOM_CLOSED` reason `SERVER_ERROR`.
 */
export default fp<RoomHandlersOptions>(
  (app, { rooms, clock }, done) => {
    const { io } = app;
    const timers = new RoomTimers(clock, (roomId, kind, error) => {
      failRoom(roomId, { timer: kind }, error);
    });

    /**
     * Removes a room and unbinds the sockets still in it, so that a later room drawing the same id never reaches them.
     * @param roomId The room to remove.
     * @param reason Why, for `ROOM_CLOSED` to every socket still bound to it (ADR-0097); left out when nobody is left
     * in the room, whose sockets have all lost their seat already.
     */
    const removeRoom = (roomId: string, reason?: RoomClosedReason): void => {
      rooms.remove(roomId);
      timers.stopRoom(roomId);
      for (const peer of socketsIn(io, roomId)) {
        if (peer.data.binding?.roomId === roomId) {
          delete peer.data.binding;
          if (reason !== undefined) {
            peer.emit(SERVER_EVENTS.ROOM_CLOSED, { roomId, reason });
          }
        }
      }
      io.in(roomId).socketsLeave(roomId);
    };

    /**
     * Removes a room whose TTL ran out, telling the sockets still in it.
     * @param roomId The room to remove.
     * @param kind The timer that ran out, for the log.
     * @param reason The same cause, as `ROOM_CLOSED` names it.
     */
    const expire = (roomId: string, kind: RoomTimerKind, reason: RoomClosedReason): void => {
      removeRoom(roomId, reason);
      app.log.info({ roomId, reason: kind, roomCount: rooms.size }, 'Room expired');
    };

    const closeRoom = (roomId: string, reason: string): void => {
      removeRoom(roomId);
      app.log.info({ roomId, reason, roomCount: rooms.size }, 'Room closed');
    };

    /**
     * Closes a room whose handling threw after a change was stored (ADR-0104). Logged first, so the error is on record
     * whatever the removal does.
     * @param roomId The room that failed.
     * @param source What was running, for the log.
     * @param error What it threw; Pino logs it with its stack.
     */
    const failRoom = (roomId: string, source: FailureSource, error: unknown): void => {
      app.log.error({ roomId, ...source, err: error }, 'Room failed');
      removeRoom(roomId, ROOM_CLOSED_REASONS.SERVER_ERROR);
    };

    const contain = (roomId: string, source: FailureSource, task: () => void, onFailure?: () => void): void => {
      try {
        task();
      } catch (error) {
        onFailure?.();
        failRoom(roomId, source, error);
      }
    };

    /**
     * Runs a room's forfeit when its timer fires: the seat is freed before the match, or loses it (ADR-0072).
     * @param roomId The room whose `DISCONNECT_FORFEIT` timer ran out.
     */
    const forfeit = (roomId: string): void => {
      const at = clock.now();
      const before = rooms.get(roomId);
      const forfeited = rooms.forfeitDue(roomId, at);
      if (forfeited === undefined) {
        reviewTimers(roomId);
        return;
      }
      app.log.info({ roomId, seat: forfeited.seat }, 'Seat forfeited');
      if (forfeited.state === null) {
        closeRoom(roomId, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT);
        return;
      }
      if (forfeited.state.phase !== before?.phase) {
        app.log.info({ roomId, phase: forfeited.state.phase }, 'Room phase changed');
      }
      sendState(io, forfeited.state, at);
      reviewTimers(roomId);
    };

    /**
     * Ends a room's placement when its timer fires: unconfirmed fleets are completed and locked, and the match starts
     * with the dice roll (ADR-0090, ADR-0091, ADR-0092). `DICE_ROLLED` goes to every socket of the room, then each
     * seated socket gets `STATE`, as an effect precedes the snapshot after a command (ADR-0047).
     * @param roomId The room whose `PLACEMENT` timer ran out.
     */
    const endPlacement = (roomId: string): void => {
      const at = clock.now();
      const ended = rooms.endPlacementDue(roomId, at);
      if (ended === undefined) {
        reviewTimers(roomId);
        return;
      }
      if (ended.completedSeats.length > 0) {
        app.log.info({ roomId, seats: ended.completedSeats }, 'Fleets completed');
      }
      app.log.info({ roomId, rolls: ended.dice.rolls, starter: ended.dice.starter }, 'Dice rolled');
      app.log.info({ roomId, phase: ended.state.phase }, 'Room phase changed');
      io.to(roomId).emit(SERVER_EVENTS.DICE_ROLLED, ended.dice);
      sendState(io, ended.state, at);
      reviewTimers(roomId);
    };

    const reviewTimers = (roomId: string): void => {
      const room = rooms.get(roomId);
      if (room === undefined) {
        timers.stopRoom(roomId);
        return;
      }
      // Deadlines are stored with the room, so starting a timer again on every review lands on the same time.
      const placementEnd = rooms.placementEndsAt(roomId);
      if (placementEnd === undefined) {
        timers.stop(roomId, ROOM_TIMER_KINDS.PLACEMENT);
      } else {
        timers.start(roomId, ROOM_TIMER_KINDS.PLACEMENT, placementEnd, () => {
          endPlacement(roomId);
        });
      }
      const pending = rooms.nextForfeit(roomId);
      if (pending === undefined) {
        timers.stop(roomId, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT);
      } else {
        timers.start(roomId, ROOM_TIMER_KINDS.DISCONNECT_FORFEIT, pending.at, () => {
          forfeit(roomId);
        });
      }
      // The waiting TTL counts from the room's entry into `WAITING_FOR_OPPONENT`: at creation, or when a seat was freed
      // before the match. A join stops it, so the next freed seat starts a new one (ADR-0096).
      if (room.phase !== ROOM_PHASES.WAITING_FOR_OPPONENT) {
        timers.stop(roomId, ROOM_TIMER_KINDS.WAITING_FOR_OPPONENT);
      } else if (!timers.isRunning(roomId, ROOM_TIMER_KINDS.WAITING_FOR_OPPONENT)) {
        timers.start(roomId, ROOM_TIMER_KINDS.WAITING_FOR_OPPONENT, clock.now() + WAITING_TTL_MS, () => {
          expire(roomId, ROOM_TIMER_KINDS.WAITING_FOR_OPPONENT, ROOM_CLOSED_REASONS.WAITING_TTL);
        });
      }
      // The game-over TTL counts from the end of the match; leaving `GAME_OVER` (a rematch, #36) stops it.
      if (room.phase !== ROOM_PHASES.GAME_OVER) {
        timers.stop(roomId, ROOM_TIMER_KINDS.GAME_OVER);
      } else if (!timers.isRunning(roomId, ROOM_TIMER_KINDS.GAME_OVER)) {
        timers.start(roomId, ROOM_TIMER_KINDS.GAME_OVER, clock.now() + GAME_OVER_TTL_MS, () => {
          expire(roomId, ROOM_TIMER_KINDS.GAME_OVER, ROOM_CLOSED_REASONS.GAME_OVER_TTL);
        });
      }
    };

    const syncPresence = (roomId: string): boolean => {
      const at = clock.now();
      let changed: RoomState | undefined;
      for (const seat of Object.values(SEATS)) {
        const isConnected = isSeatConnected(io, roomId, seat);
        const next = rooms.setPresence(roomId, seat, isConnected, at);
        if (next !== undefined) {
          changed = next;
          app.log.info({ roomId, seat }, isConnected ? 'Seat reconnected' : 'Seat disconnected');
        }
      }
      if (changed === undefined) {
        return false;
      }
      sendState(io, changed, at);
      reviewTimers(roomId);
      return true;
    };

    const context: CommandContext = { rooms, now: () => clock.now(), reviewTimers, syncPresence, closeRoom, contain };
    io.on('connection', (socket) => {
      listenToCommands(io, socket, app.log.child({ socketId: socket.id }), context);
    });
    // Pending TTLs must not fire into a closed server; the system clock's timers would not keep it alive anyway.
    app.addHook('onClose', (_instance, hookDone) => {
      timers.stopAll();
      hookDone();
    });
    done();
  },
  { name: 'room-handlers', fastify: '5.x', dependencies: ['socket-io'] },
);

/**
 * Registers the command listeners of one socket.
 * @param io The server, to reach the other socket of a room.
 * @param socket The new connection.
 * @param log The socket's logger, carrying its `socketId`.
 * @param context The registry, the clock, the timer review, seat presence, room closing and failure containment.
 */
function listenToCommands(
  io: GameServer,
  socket: GameSocket,
  log: FastifyBaseLogger,
  { rooms, now, reviewTimers, syncPresence, closeRoom, contain }: CommandContext,
): void {
  /**
   * Logs a refused command and sends the error back. The violation of `INVALID_PLACEMENT` and `INVALID_TARGETS` is
   * logged, never sent (ADR-0032).
   * @param event The command.
   * @param reply Its ack.
   * @param rejection The error code, and the rule broken when there is one.
   */
  const refuse = (
    event: CommandEvent,
    reply: (response: AckFailure) => void,
    rejection: Pick<RejectedTransition, 'error' | 'violation'>,
  ): void => {
    log.info({ event, error: rejection.error, violation: rejection.violation }, 'Command refused');
    reply({ ok: false, error: rejection.error });
  };

  /**
   * Runs a command's room logic through `RoomManager`, which stores the new state only once the pure transition has
   * returned (ADR-0104): a throw has stored nothing, so it is logged as "Command failed" and the command is refused
   * with `SERVER_ERROR`, the room keeping its state.
   * @template T What the call returns.
   * @param event The command, for the log.
   * @param roomId The room it runs against, for the log; none for `CREATE_ROOM`, whose room does not exist yet.
   * @param transition The `RoomManager` call.
   * @returns What the call returned, or the refusal.
   */
  const tryTransition = <T>(
    event: CommandEvent,
    roomId: string | undefined,
    transition: () => T,
  ): T | RejectedTransition => {
    try {
      return transition();
    } catch (error) {
      log.error({ roomId, event, err: error }, 'Command failed');
      return { ok: false, error: ERROR_CODES.SERVER_ERROR };
    }
  };

  /**
   * Runs what an accepted command does once its room has stored the new state, the ack included: a throw closes the
   * room (ADR-0104), and the sender gets `SERVER_ERROR` if it has no ack yet. Socket.io sends only the first reply to
   * an ack, so the failure's reply is dropped when the ack already went out.
   * @param event The command, for the log.
   * @param roomId The room that stored the change.
   * @param reply The command's ack.
   * @param task The ack, the effects, the timer review and `STATE`.
   */
  const settle = (
    event: CommandEvent,
    roomId: string,
    reply: (response: AckFailure) => void,
    task: () => void,
  ): void => {
    contain(roomId, { event }, task, () => {
      reply({ ok: false, error: ERROR_CODES.SERVER_ERROR });
    });
  };

  /**
   * Takes every socket bound to a freed seat out of the room: the secret that could bring it back is gone.
   * @param roomId Where the seat was.
   * @param seat The seat room logic just freed.
   */
  const unbindSeat = (roomId: string, seat: Seat): void => {
    for (const peer of socketsIn(io, roomId)) {
      if (peer.data.binding?.roomId === roomId && peer.data.binding.seat === seat) {
        delete peer.data.binding;
        void peer.leave(roomId);
      }
    }
    log.info({ roomId, seat }, 'Seat left');
  };

  /**
   * Tells a room that a seat was freed before the match: the other player, if any, gets `STATE`, and a room nobody is
   * left in closes.
   * @param roomId Where the seat was freed.
   * @param before The room before the seat was freed, to log a change of phase.
   * @param state The room after it, or `null` once room logic left nobody in it.
   * @param reason What freed the seat, for the log of a room that closes.
   */
  const settleFreedSeat = (
    roomId: string,
    before: RoomState | undefined,
    state: RoomState | null,
    reason: string,
  ): void => {
    if (state === null) {
      closeRoom(roomId, reason);
      return;
    }
    if (state.phase !== before?.phase) {
      log.info({ roomId, phase: state.phase }, 'Room phase changed');
    }
    sendState(io, state, now());
    reviewTimers(roomId);
  };

  /**
   * Binds the socket to a seat and moves it into the room's Socket.io room, leaving the room it sat in before, if any
   * (ADR-0045). A seat it leaves in `WAITING_FOR_OPPONENT`, where it was the only player, is freed as by `LEAVE_ROOM`,
   * so the room closes (ADR-0095). A seat it leaves in a later phase stays taken, and is away once no other socket is
   * bound to it, as after a disconnection (ADR-0072): its stored session can still bring it back.
   * @param roomId The room the socket now plays in.
   * @param seat Its seat there.
   * @param event The command that took the seat, for the log of a room it closes.
   */
  const bind = (roomId: string, seat: Seat, event: SeatTakingEvent): void => {
    const previous = socket.data.binding;
    if (previous !== undefined) {
      void socket.leave(previous.roomId);
      // A failure there closes the room left behind, not the one the socket moves to.
      contain(previous.roomId, { event }, () => {
        const before = rooms.get(previous.roomId);
        const freed =
          before?.phase === ROOM_PHASES.WAITING_FOR_OPPONENT ? rooms.leave(previous.roomId, previous.seat) : undefined;
        if (freed?.ok === true) {
          unbindSeat(previous.roomId, previous.seat);
          settleFreedSeat(previous.roomId, before, freed.state, event);
        } else {
          syncPresence(previous.roomId);
        }
      });
    }
    socket.data.binding = { roomId, seat };
    void socket.join(roomId);
  };

  /**
   * Runs a seated player's command against their room: ack, effects to both players, then `STATE` to each.
   * @template T The data an accepted command's ack carries besides `ok`.
   * @param event The command, for the log.
   * @param reply Its ack.
   * @param build Builds the room command for the sender's seat.
   * @param ackData Reads the ack's data from the room after the command; `NO_ACK_DATA` for a bare `{ ok: true }`.
   */
  const dispatch = <T extends object>(
    event: SeatCommandEvent,
    reply: (response: AckResponse<NoInfer<T>>) => void,
    build: (seat: Seat) => SeatCommand,
    ackData: (state: RoomState) => T,
  ): void => {
    const binding = socket.data.binding;
    if (binding === undefined) {
      refuse(event, reply, { error: ERROR_CODES.NOT_ALLOWED });
      return;
    }
    const at = now();
    const before = rooms.get(binding.roomId);
    const result = tryTransition(event, binding.roomId, () => rooms.dispatch(binding.roomId, build(binding.seat), at));
    if (!result.ok) {
      refuse(event, reply, result);
      return;
    }
    settle(event, binding.roomId, reply, () => {
      reply({ ok: true, ...ackData(result.state) });
      for (const effect of result.effects) {
        io.to(binding.roomId).emit(effect.type, effect.payload);
      }
      if (result.state.phase !== before?.phase) {
        log.info({ roomId: binding.roomId, phase: result.state.phase }, 'Room phase changed');
      }
      // A confirmation or an unlock moves the end of placement without changing the phase.
      reviewTimers(binding.roomId);
      sendState(io, result.state, at);
    });
  };

  /**
   * Frees the sender's seat (`LEAVE_ROOM`, docs/server.md#leaving): every socket bound to it loses it, since the
   * secret that could bring it back is gone. The ack comes first, then the other player gets `STATE`; the leaver gets
   * none. A room nobody is left in closes.
   * @param reply The ack.
   */
  const leave = (reply: (response: AckResponse) => void): void => {
    const binding = socket.data.binding;
    if (binding === undefined) {
      refuse(CLIENT_EVENTS.LEAVE_ROOM, reply, { error: ERROR_CODES.NOT_ALLOWED });
      return;
    }
    const { roomId, seat } = binding;
    const before = rooms.get(roomId);
    const result = tryTransition(CLIENT_EVENTS.LEAVE_ROOM, roomId, () => rooms.leave(roomId, seat));
    if (!result.ok) {
      refuse(CLIENT_EVENTS.LEAVE_ROOM, reply, result);
      return;
    }
    settle(CLIENT_EVENTS.LEAVE_ROOM, roomId, reply, () => {
      unbindSeat(roomId, seat);
      reply({ ok: true });
      settleFreedSeat(roomId, before, result.state, CLIENT_EVENTS.LEAVE_ROOM);
    });
  };

  /**
   * Refuses a command whose room logic has not landed yet with `NOT_ALLOWED`, after its guard (ADR-0046).
   * @param event The command.
   * @returns Its handler.
   */
  const notYetSupported =
    <E extends CommandEvent>(event: E): CommandHandler<E> =>
    (_payload, reply) => {
      refuse(event, reply, { error: ERROR_CODES.NOT_ALLOWED });
    };

  /** One handler per command; the mapped type makes a command without a handler a compile error. */
  const handlers: { readonly [E in CommandEvent]: CommandHandler<E> } = {
    CREATE_ROOM: (payload, reply) => {
      const at = now();
      const result = tryTransition(CLIENT_EVENTS.CREATE_ROOM, undefined, () => rooms.createRoom(payload));
      if (!result.ok) {
        refuse(CLIENT_EVENTS.CREATE_ROOM, reply, result);
        return;
      }
      settle(CLIENT_EVENTS.CREATE_ROOM, result.roomId, reply, () => {
        bind(result.roomId, SEATS.P1, CLIENT_EVENTS.CREATE_ROOM);
        log.info({ roomId: result.roomId, seat: SEATS.P1, roomCount: rooms.size }, 'Room created');
        reply({ ok: true, roomId: result.roomId, playerSecret: result.playerSecret });
        reviewTimers(result.roomId);
        sendState(io, result.state, at);
      });
    },
    JOIN_ROOM: (payload, reply) => {
      // Taking the other seat of one's own room would leave the first seat without a socket.
      if (socket.data.binding?.roomId === payload.roomId) {
        refuse(CLIENT_EVENTS.JOIN_ROOM, reply, { error: ERROR_CODES.NOT_ALLOWED });
        return;
      }
      const at = now();
      const result = tryTransition(CLIENT_EVENTS.JOIN_ROOM, payload.roomId, () => rooms.joinRoom(payload, at));
      if (!result.ok) {
        refuse(CLIENT_EVENTS.JOIN_ROOM, reply, result);
        return;
      }
      settle(CLIENT_EVENTS.JOIN_ROOM, payload.roomId, reply, () => {
        bind(payload.roomId, result.seat, CLIENT_EVENTS.JOIN_ROOM);
        log.info({ roomId: payload.roomId, seat: result.seat, phase: result.state.phase }, 'Room joined');
        reply({ ok: true, playerSecret: result.playerSecret });
        // The join ends the room's wait, which stops its waiting TTL.
        reviewTimers(payload.roomId);
        sendState(io, result.state, at);
      });
    },
    UPDATE_RULES: (payload, reply) => {
      // An edit that changes nothing keeps the version, so the ack always names the version now in place (ADR-0082).
      dispatch<UpdateRulesAckData>(
        CLIENT_EVENTS.UPDATE_RULES,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.UPDATE_RULES, seat, payload }),
        (state) => ({ rulesVersion: state.rulesVersion }),
      );
    },
    CONFIRM_RULES: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.CONFIRM_RULES,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.CONFIRM_RULES, seat, payload }),
        NO_ACK_DATA,
      );
    },
    UPDATE_PLACEMENT: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.UPDATE_PLACEMENT,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.UPDATE_PLACEMENT, seat, payload }),
        NO_ACK_DATA,
      );
    },
    CONFIRM_PLACEMENT: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.CONFIRM_PLACEMENT,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.CONFIRM_PLACEMENT, seat, payload }),
        NO_ACK_DATA,
      );
    },
    UNLOCK_PLACEMENT: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.UNLOCK_PLACEMENT,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.UNLOCK_PLACEMENT, seat, payload }),
        NO_ACK_DATA,
      );
    },
    UPDATE_TARGETS: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.UPDATE_TARGETS,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload }),
        NO_ACK_DATA,
      );
    },
    FIRE: (payload, reply) => {
      dispatch(CLIENT_EVENTS.FIRE, reply, (seat) => ({ type: CLIENT_EVENTS.FIRE, seat, payload }), NO_ACK_DATA);
    },
    SET_PAUSED: (payload, reply) => {
      dispatch(
        CLIENT_EVENTS.SET_PAUSED,
        reply,
        (seat) => ({ type: CLIENT_EVENTS.SET_PAUSED, seat, payload }),
        NO_ACK_DATA,
      );
    },
    SURRENDER: notYetSupported(CLIENT_EVENTS.SURRENDER),
    REMATCH_CHOICE: notYetSupported(CLIENT_EVENTS.REMATCH_CHOICE),
    LEAVE_ROOM: (_payload, reply) => {
      leave(reply);
    },
  };

  /**
   * Runs one command: guard, then handler.
   * @param event The command.
   * @param payload The raw payload, untrusted.
   * @param reply Its ack.
   */
  const run = <E extends CommandEvent>(event: E, payload: unknown, reply: Reply<E>): void => {
    const parsed = PAYLOAD_PARSERS[event](payload);
    if (parsed === null) {
      refuse(event, reply, { error: ERROR_CODES.INVALID_PAYLOAD });
      return;
    }
    handlers[event](parsed, reply);
  };

  // The handshake's own `connection` listener ran first: a resumed session has put the socket in its room and
  // replaced the sockets it took the seat from (ADR-0063). A seat coming back sends `STATE` to the whole room; a seat
  // that never dropped (a zombie replaced) only needs one for the new socket.
  const resumed = socket.data.binding;
  if (resumed !== undefined) {
    contain(resumed.roomId, { event: 'connection' }, () => {
      if (!syncPresence(resumed.roomId)) {
        const state = rooms.get(resumed.roomId);
        if (state !== undefined) {
          socket.emit(SERVER_EVENTS.STATE, projectSnapshot(state, resumed.seat, now()));
        }
      }
    });
  }

  // Socket.io has already taken the socket out of its rooms here, so a seat it was the last socket of is away.
  socket.on('disconnect', () => {
    const binding = socket.data.binding;
    if (binding !== undefined) {
      contain(binding.roomId, { event: 'disconnect' }, () => {
        syncPresence(binding.roomId);
      });
    }
  });

  // The socket is widened to Socket.io's untyped event map: its typed `on` cannot take an event name held in a
  // variable. Inbound arguments are untrusted anyway, so the listener takes `unknown`.
  const untypedSocket: Socket = socket;
  for (const event of COMMAND_EVENTS) {
    untypedSocket.on(event, (payload: unknown, ack: unknown) => {
      if (typeof ack !== 'function') {
        return;
      }
      run(event, payload, ack as Reply<CommandEvent>);
    });
  }
}

/**
 * Sends `STATE` to every socket seated in a room, each with its own projection (fog-of-war, ADR-0038).
 * @param io The server.
 * @param state The room after the change.
 * @param sentAt Current time in epoch ms, for the remaining times.
 */
function sendState(io: GameServer, state: RoomState, sentAt: number): void {
  for (const peer of socketsIn(io, state.roomId)) {
    const binding = peer.data.binding;
    if (binding?.roomId === state.roomId) {
      peer.emit(SERVER_EVENTS.STATE, projectSnapshot(state, binding.seat, sentAt));
    }
  }
}

/**
 * Whether a seat is connected (ADR-0072): at least one socket in the room's Socket.io room is bound to it.
 * @param io The server.
 * @param roomId The room holding the seat, whose Socket.io room has the same name.
 * @param seat Which of its two seats.
 * @returns `false` for a seat whose last socket disconnected or moved to another room.
 */
function isSeatConnected(io: GameServer, roomId: string, seat: Seat): boolean {
  return socketsIn(io, roomId).some((peer) => peer.data.binding?.roomId === roomId && peer.data.binding.seat === seat);
}

/**
 * The sockets in a room's Socket.io room, copied, so the caller may move them out while walking the list.
 * @param io The server.
 * @param roomId The room, whose Socket.io room has the same name.
 * @returns The connected sockets in it, in joining order.
 */
function socketsIn(io: GameServer, roomId: string): GameSocket[] {
  return [...(io.sockets.adapter.rooms.get(roomId) ?? [])].flatMap(
    (socketId) => io.sockets.sockets.get(socketId) ?? [],
  );
}
