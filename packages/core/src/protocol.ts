// Socket.io event maps shared by server and client (docs/protocol.md). Type-only: core keeps zero runtime dependencies.

/** Callback a client passes as the last argument of a command to receive the server's reply. */
export type Ack<T> = (response: T) => void;

/** Body of `GET /health` (docs/deployment.md#backend-render); the client polls it to wake the server (docs/client.md#cold-start-handling). */
export interface HealthResponse {
  readonly status: 'ok';
  /** Seconds since the server process started. */
  readonly uptime: number;
}

/** Reply to the Phase 0 `ECHO` connectivity check. */
export interface EchoResponse {
  readonly ok: true;
  readonly payload: unknown;
  readonly protocolVersion: number;
}

export interface ClientToServerEvents {
  /** Phase 0 connectivity check (issue #3): the server acks with the payload it received. */
  ECHO: (payload: unknown, ack: Ack<EchoResponse>) => void;
}

export interface ServerToClientEvents {
  /** The server is restarting; any match in progress is lost (docs/deployment.md#backend-render). */
  SERVER_SHUTDOWN: (payload: Record<string, never>) => void;
}
