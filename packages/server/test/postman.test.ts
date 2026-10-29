// Replays the saved Postman Socket.IO messages against the test server, so they stay valid inside `pnpm test`
// (docs/development.md#local-tooling, ADR-0068).

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { CLIENT_EVENTS, ERROR_CODES, PROTOCOL_VERSION } from '@battleship/core';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { ACK_TIMEOUT_MS, app, baseUrl, clock, start, stop, track } from './socket-harness.js';

const POSTMAN_DIR = resolve(import.meta.dirname, '../../../postman');
const COLLECTION_DIR = join(POSTMAN_DIR, 'collections/Battleship API');
const ENVIRONMENT_FILE = join(POSTMAN_DIR, 'environments/localhost.environment.yaml');
/** Time between two steps, as a person clicking through the collection would leave. */
const STEP_MS = 1_000;

/** A `*.request.yaml` of kind `socket.io-request`, reduced to what a connection needs. */
interface SocketIoRequest {
  readonly url: string;
  readonly headers?: readonly { readonly key: string; readonly value: string }[];
  /** The folder of its saved messages, relative to the request file. */
  readonly messages?: string;
}

/** A `*.message.yaml`. */
interface SocketIoMessage {
  readonly eventName: string;
  readonly acknowledgement: boolean;
  readonly args: readonly { readonly content: string; readonly contentType: string }[];
}

/**
 * One step of the replay, in the order the collection's descriptions give (**Seat P1**). A step names a request by its
 * file name without `.request.yaml`, which is the name Postman shows, and, to send one of its saved messages, the
 * message's file name without `.message.yaml`. The connection of a request opens at its first step and stays open
 * until a `disconnect` step closes it, as Postman's Disconnect button does.
 */
type Step =
  | {
      readonly request: string;
      readonly message: string;
      /** The ack, compared with `toEqual` (asymmetric matchers allowed). */
      readonly ack: unknown;
      /** Copies this field of the ack into the collection variable of the same name, as the manual flow does. */
      readonly capture?: string;
    }
  | {
      readonly request: string;
      /** The request's connection must fail, with this `connect_error` message; it sends nothing. */
      readonly connectError: string;
    }
  | {
      readonly request: string;
      /** Closes the request's open connection; the next step runs once the server has seen it go. */
      readonly disconnect: true;
    };

const OK = { ok: true };
const NOT_ALLOWED = { ok: false, error: ERROR_CODES.NOT_ALLOWED };
const OK_WITH_SECRET = { ok: true, playerSecret: expect.any(String) as unknown };

/**
 * The replay. Every saved message must be sent at least once and every Socket.IO request connected, or the coverage
 * test fails: a new message needs a step here, with the reply it is meant to get, a refusal included.
 */
const STEPS: readonly Step[] = [
  {
    request: 'ECHO',
    message: 'hello',
    ack: { ok: true, payload: { hello: 'postman' }, protocolVersion: PROTOCOL_VERSION },
  },
  // An outdated client is told to reload (ADR-0061, ADR-0062).
  { request: 'ECHO — wrong protocol version', connectError: ERROR_CODES.PROTOCOL_MISMATCH },
  // The foreign origin is refused before the WebSocket upgrade (ADR-0021).
  { request: 'ECHO — foreign origin', connectError: 'websocket error' },
  {
    request: 'Seat P1',
    message: CLIENT_EVENTS.CREATE_ROOM,
    ack: { ...OK_WITH_SECRET, roomId: expect.any(String) as unknown },
    capture: 'roomId',
  },
  { request: 'Seat P2', message: CLIENT_EVENTS.JOIN_ROOM, ack: OK_WITH_SECRET },
  // Rules negotiation (ADR-0003, ADR-0004): P1's edit makes version 1, so P2's confirmation of version 0 is stale.
  { request: 'Seat P1', message: CLIENT_EVENTS.UPDATE_RULES, ack: { ok: true, rulesVersion: 1 } },
  {
    request: 'Seat P2',
    message: `${CLIENT_EVENTS.CONFIRM_RULES} — stale`,
    ack: { ok: false, error: ERROR_CODES.STALE_RULES },
  },
  { request: 'Seat P2', message: CLIENT_EVENTS.CONFIRM_RULES, ack: OK },
  // The second confirmation of version 1 starts placement.
  { request: 'Seat P1', message: CLIENT_EVENTS.CONFIRM_RULES, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.UPDATE_PLACEMENT, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.CONFIRM_PLACEMENT, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.UNLOCK_PLACEMENT, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.UPDATE_PLACEMENT, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.CONFIRM_PLACEMENT, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.UNLOCK_PLACEMENT, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.CONFIRM_PLACEMENT, ack: OK },
  // The second fleet locked starts the match, P1 first.
  { request: 'Seat P1', message: CLIENT_EVENTS.CONFIRM_PLACEMENT, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.UPDATE_TARGETS, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.FIRE, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.UPDATE_TARGETS, ack: OK },
  { request: 'Seat P2', message: CLIENT_EVENTS.FIRE, ack: OK },
  // Pausing needs the opponent away (ADR-0074); P2's seat is kept while it is (ADR-0072).
  { request: 'Seat P1', message: CLIENT_EVENTS.SET_PAUSED, ack: NOT_ALLOWED },
  { request: 'Seat P2', disconnect: true },
  { request: 'Seat P1', message: `${CLIENT_EVENTS.SET_PAUSED} — resume`, ack: OK },
  { request: 'Seat P1', message: CLIENT_EVENTS.SET_PAUSED, ack: OK },
  // Leaving a match is a surrender (#35).
  { request: 'Seat P1', message: CLIENT_EVENTS.LEAVE_ROOM, ack: NOT_ALLOWED },
  {
    request: 'Seat P1',
    message: `${CLIENT_EVENTS.CREATE_ROOM} — invalid payload`,
    ack: { ok: false, error: ERROR_CODES.INVALID_PAYLOAD },
  },
  // Before a match, leaving frees the seat at once; the room had no one else, so it closes (ADR-0073).
  {
    request: 'Seat P1',
    message: CLIENT_EVENTS.CREATE_ROOM,
    ack: { ...OK_WITH_SECRET, roomId: expect.any(String) as unknown },
    capture: 'roomId',
  },
  { request: 'Seat P1', message: CLIENT_EVENTS.LEAVE_ROOM, ack: OK },
];

afterEach(stop);

/** Every file under a folder whose name ends with the suffix, as absolute paths. */
function filesEndingWith(directory: string, suffix: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith(suffix))
    .map((file) => join(directory, file))
    .sort();
}

/** A YAML file's content, unchecked: the caller states the shape it expects. */
function readYaml(file: string): unknown {
  return parse(readFileSync(file, 'utf8'));
}

/** A Socket.IO request ready to connect: headers defaulted, messages as an absolute folder. */
interface LoadedRequest {
  readonly url: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
  readonly messageDir: string | undefined;
}

/** The Socket.IO requests by name. */
function socketIoRequests(): Map<string, LoadedRequest> {
  const requests = new Map<string, LoadedRequest>();
  for (const file of filesEndingWith(COLLECTION_DIR, '.request.yaml')) {
    const request = readYaml(file) as SocketIoRequest & { readonly $kind: string };
    if (request.$kind === 'socket.io-request') {
      requests.set(basename(file, '.request.yaml'), {
        url: request.url,
        headers: request.headers ?? [],
        messageDir: request.messages === undefined ? undefined : resolve(dirname(file), request.messages),
      });
    }
  }
  return requests;
}

/** The collection's and the environment's variables, by key. */
function postmanVariables(): Map<string, string> {
  const variables = new Map<string, string>();
  for (const file of [join(COLLECTION_DIR, '.resources/definition.yaml'), ENVIRONMENT_FILE]) {
    const { variables: collection, values } = readYaml(file) as {
      readonly variables?: readonly { readonly key: string; readonly value: string }[];
      readonly values?: readonly { readonly key: string; readonly value: string }[];
    };
    for (const { key, value } of [...(collection ?? []), ...(values ?? [])]) {
      variables.set(key, value);
    }
  }
  return variables;
}

/** Replaces each `{{name}}`; a name without a value fails the replay, as Postman would send it unresolved. */
function substitute(text: string, variables: ReadonlyMap<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, name: string) => {
    const value = variables.get(name);
    if (value === undefined || value === '') {
      throw new Error(`Postman variable {{${name}}} has no value at this step`);
    }
    return value;
  });
}

function messageFile(messageDir: string | undefined, message: string): string {
  if (messageDir === undefined) {
    throw new Error(`the request has no saved messages, so it cannot send ${message}`);
  }
  return join(messageDir, `${message}.message.yaml`);
}

describe('the Postman collection', () => {
  it('has a replay step for every saved Socket.IO message and request', () => {
    const requests = socketIoRequests();
    const used = new Set<string>();
    for (const step of STEPS) {
      const request = requests.get(step.request);
      expect(request, `step for unknown request "${step.request}"`).toBeDefined();
      if ('message' in step) {
        used.add(messageFile(request?.messageDir, step.message));
      }
    }
    const saved = filesEndingWith(POSTMAN_DIR, '.message.yaml');
    expect(saved.length).toBeGreaterThan(0);
    expect(
      saved.filter((file) => !used.has(file)).map((file) => relative(POSTMAN_DIR, file)),
      'messages without a replay step',
    ).toEqual([]);
    expect(
      [...used].filter((file) => !saved.includes(file)),
      'steps without a saved message',
    ).toEqual([]);
    expect(
      [...requests.keys()].filter((name) => !STEPS.some((step) => step.request === name)),
      'requests without a replay step',
    ).toEqual([]);
  });

  it('gets the expected reply to every saved message from the server', async () => {
    await replay(socketIoRequests());
  });

  // The proof that the replay checks the handshake: the same collection without the version fails at its first step.
  it('fails when the requests leave out the protocol version', async () => {
    const withoutVersion = new Map(
      [...socketIoRequests()].map(([name, request]) => [
        name,
        { ...request, url: request.url.replace(/\?protocolVersion=[^&]*/, '') },
      ]),
    );
    await expect(replay(withoutVersion)).rejects.toThrow(/step 1: ECHO › hello: connect_error.*PROTOCOL_MISMATCH/);
  });
});

/**
 * Waits for a connection to open or be refused.
 * @returns The `connect_error` message, or `undefined` once connected.
 */
function connection(socket: Socket): Promise<string | undefined> {
  return new Promise((settle) => {
    socket.once('connect_error', (error) => {
      settle(error.message);
    });
    socket.once('connect', () => {
      settle(undefined);
    });
  });
}

/**
 * Closes a request's open connection and waits until the server has dropped the socket, so its seat is away by the
 * next step.
 * @param open The open connections, by request name; the closed one is removed.
 * @param request The request whose connection closes.
 * @param label The step, for the failure message.
 */
async function disconnect(open: Map<string, Socket>, request: string, label: string): Promise<void> {
  const socket = open.get(request);
  const socketId = socket?.id;
  if (socket === undefined || socketId === undefined) {
    expect.fail(`${label}: the request is not connected`);
  }
  socket.close();
  open.delete(request);
  await vi.waitFor(() => {
    expect(app.io.of('/').sockets.has(socketId), `${label}: the server still has the socket`).toBe(false);
  });
}

/**
 * Plays `STEPS` against a fresh test server; the first step that gets another reply than expected fails the replay.
 * @param requests The Socket.IO requests to connect, by name.
 */
async function replay(requests: ReadonlyMap<string, LoadedRequest>): Promise<void> {
  const variables = postmanVariables();
  await start({ allowedOrigins: [variables.get('allowedOrigin') ?? ''] });
  variables.set('baseUrl', baseUrl);
  const open = new Map<string, Socket>();

  for (const [index, step] of STEPS.entries()) {
    const label = `step ${String(index + 1)}: ${step.request}${'message' in step ? ` › ${step.message}` : ''}`;
    if ('disconnect' in step) {
      await disconnect(open, step.request, label);
      continue;
    }
    clock.advance(STEP_MS);
    const request = requests.get(step.request);
    if (request === undefined) {
      expect.fail(`${label}: unknown request`);
    }
    // Postman's Socket.IO client speaks WebSocket only.
    const connectRequest = (): Socket => {
      return track(
        connect(substitute(request.url, variables), {
          transports: ['websocket'],
          reconnection: false,
          extraHeaders: Object.fromEntries(
            request.headers.map(({ key, value }) => [key, substitute(value, variables)] as const),
          ),
        }),
      );
    };

    if (!('message' in step)) {
      expect(await connection(connectRequest()), `${label}: connect_error`).toBe(step.connectError);
      continue;
    }

    let socket = open.get(step.request);
    if (socket === undefined) {
      socket = connectRequest();
      open.set(step.request, socket);
      expect(await connection(socket), `${label}: connect_error`).toBeUndefined();
    }
    const message = readYaml(messageFile(request.messageDir, step.message)) as SocketIoMessage;
    expect(message.acknowledgement, `${label}: saved without an ack`).toBe(true);
    const args = message.args.map(({ content, contentType }) => {
      const text = substitute(content, variables);
      return contentType === 'json' ? (JSON.parse(text) as unknown) : text;
    });
    const ack: unknown = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(message.eventName, ...args);
    expect(ack, label).toEqual(step.ack);
    if (step.capture !== undefined) {
      variables.set(step.capture, String((ack as Record<string, unknown>)[step.capture]));
    }
  }
}
