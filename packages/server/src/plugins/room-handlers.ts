// Socket.io commands wired to room logic (docs/server.md#socket-handlers): guard → room logic → ack → effects → `STATE`.

import {
  CLIENT_EVENTS,
  ERROR_CODES,
  PAYLOAD_PARSERS,
  SEATS,
  SERVER_EVENTS,
  type AckFailure,
  type AckResponse,
  type ClientToServerEvents,
  type CommandEvent,
  type CommandPayload,
  type Seat,
} from '@battleship/core';
import fp from 'fastify-plugin';

import type { FastifyBaseLogger } from 'fastify';
import type { Socket } from 'socket.io';

import type { RoomManager } from '../room/room-manager.js';
import type { RejectedTransition, RoomState, SeatCommand } from '../room/room.js';
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

/**
 * Handles one command whose payload passed its guard: replies exactly once, then sends what the change requires.
 * @template E The command's event name.
 */
type CommandHandler<E extends CommandEvent> = (payload: CommandPayload<E>, reply: Reply<E>) => void;

/** The commands a seated player sends, which `RoomManager.dispatch` runs. */
type SeatCommandEvent = SeatCommand['type'];

/** Every command the plugin listens to: all client→server events but `ECHO`, which has its own plugin. */
const COMMAND_EVENTS: readonly CommandEvent[] = Object.values(CLIENT_EVENTS).filter(
  (event): event is CommandEvent => event !== CLIENT_EVENTS.ECHO,
);

/** What the `room-handlers` plugin needs; `createServer` passes production defaults, tests inject both. */
export interface RoomHandlersOptions {
  /** The open rooms; one registry per server. */
  readonly rooms: RoomManager;
  /** Current time in epoch ms, passed to room logic and the snapshot projection. */
  readonly now: () => number;
}

/**
 * Listens to every command on every socket (docs/server.md#socket-handlers). A payload that fails its core guard is
 * refused with `INVALID_PAYLOAD` before room logic sees it; a command sent without an ack callback is ignored. An
 * accepted command is acked first, then its effects (`SHOT_RESOLVED`) go to the room and each seated socket gets its
 * own `STATE` projection (ADR-0047).
 */
export default fp<RoomHandlersOptions>(
  (app, options, done) => {
    app.io.on('connection', (socket) => {
      listenToCommands(app.io, socket, app.log.child({ socketId: socket.id }), options);
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
 * @param options The registry and the clock.
 */
function listenToCommands(
  io: GameServer,
  socket: GameSocket,
  log: FastifyBaseLogger,
  { rooms, now }: RoomHandlersOptions,
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
   * Binds the socket to a seat and moves it into the room's Socket.io room, leaving the room it sat in before, if any
   * (ADR-0045). The seat it leaves stays taken: freeing seats arrives with #23.
   * @param roomId The room the socket now plays in.
   * @param seat Its seat there.
   */
  const bind = (roomId: string, seat: Seat): void => {
    const previous = socket.data.binding;
    if (previous !== undefined) {
      void socket.leave(previous.roomId);
    }
    socket.data.binding = { roomId, seat };
    void socket.join(roomId);
  };

  /**
   * Runs a seated player's command against their room: ack, effects to both players, then `STATE` to each.
   * @param event The command, for the log.
   * @param reply Its ack.
   * @param build Builds the room command for the sender's seat.
   */
  const dispatch = (
    event: SeatCommandEvent,
    reply: (response: AckResponse) => void,
    build: (seat: Seat) => SeatCommand,
  ): void => {
    const binding = socket.data.binding;
    if (binding === undefined) {
      refuse(event, reply, { error: ERROR_CODES.NOT_ALLOWED });
      return;
    }
    const at = now();
    const before = rooms.get(binding.roomId);
    const result = rooms.dispatch(binding.roomId, build(binding.seat), at);
    if (!result.ok) {
      refuse(event, reply, result);
      return;
    }
    reply({ ok: true });
    for (const effect of result.effects) {
      io.to(binding.roomId).emit(effect.type, effect.payload);
    }
    if (result.state.phase !== before?.phase) {
      log.info({ roomId: binding.roomId, phase: result.state.phase }, 'Room phase changed');
    }
    sendState(io, result.state, at);
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
      const result = rooms.createRoom(payload);
      if (!result.ok) {
        refuse(CLIENT_EVENTS.CREATE_ROOM, reply, result);
        return;
      }
      bind(result.roomId, SEATS.P1);
      log.info({ roomId: result.roomId, seat: SEATS.P1, roomCount: rooms.size }, 'Room created');
      reply({ ok: true, roomId: result.roomId, playerSecret: result.playerSecret });
      sendState(io, result.state, at);
    },
    JOIN_ROOM: (payload, reply) => {
      // Taking the other seat of one's own room would leave the first seat without a socket.
      if (socket.data.binding?.roomId === payload.roomId) {
        refuse(CLIENT_EVENTS.JOIN_ROOM, reply, { error: ERROR_CODES.NOT_ALLOWED });
        return;
      }
      const at = now();
      const result = rooms.joinRoom(payload, at);
      if (!result.ok) {
        refuse(CLIENT_EVENTS.JOIN_ROOM, reply, result);
        return;
      }
      bind(payload.roomId, SEATS.P2);
      log.info({ roomId: payload.roomId, seat: SEATS.P2, phase: result.state.phase }, 'Room joined');
      reply({ ok: true, playerSecret: result.playerSecret });
      sendState(io, result.state, at);
    },
    UPDATE_RULES: notYetSupported(CLIENT_EVENTS.UPDATE_RULES),
    CONFIRM_RULES: notYetSupported(CLIENT_EVENTS.CONFIRM_RULES),
    UPDATE_PLACEMENT: (payload, reply) => {
      dispatch(CLIENT_EVENTS.UPDATE_PLACEMENT, reply, (seat) => ({
        type: CLIENT_EVENTS.UPDATE_PLACEMENT,
        seat,
        payload,
      }));
    },
    CONFIRM_PLACEMENT: (payload, reply) => {
      dispatch(CLIENT_EVENTS.CONFIRM_PLACEMENT, reply, (seat) => ({
        type: CLIENT_EVENTS.CONFIRM_PLACEMENT,
        seat,
        payload,
      }));
    },
    UNLOCK_PLACEMENT: (payload, reply) => {
      dispatch(CLIENT_EVENTS.UNLOCK_PLACEMENT, reply, (seat) => ({
        type: CLIENT_EVENTS.UNLOCK_PLACEMENT,
        seat,
        payload,
      }));
    },
    UPDATE_TARGETS: (payload, reply) => {
      dispatch(CLIENT_EVENTS.UPDATE_TARGETS, reply, (seat) => ({ type: CLIENT_EVENTS.UPDATE_TARGETS, seat, payload }));
    },
    FIRE: (payload, reply) => {
      dispatch(CLIENT_EVENTS.FIRE, reply, (seat) => ({ type: CLIENT_EVENTS.FIRE, seat, payload }));
    },
    SET_PAUSED: notYetSupported(CLIENT_EVENTS.SET_PAUSED),
    SURRENDER: notYetSupported(CLIENT_EVENTS.SURRENDER),
    REMATCH_CHOICE: notYetSupported(CLIENT_EVENTS.REMATCH_CHOICE),
    LEAVE_ROOM: notYetSupported(CLIENT_EVENTS.LEAVE_ROOM),
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
  for (const socketId of io.sockets.adapter.rooms.get(state.roomId) ?? []) {
    const peer = io.sockets.sockets.get(socketId);
    const binding = peer?.data.binding;
    if (peer !== undefined && binding?.roomId === state.roomId) {
      peer.emit(SERVER_EVENTS.STATE, projectSnapshot(state, binding.seat, sentAt));
    }
  }
}
