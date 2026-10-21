/** The words of the server status line. */
export interface ServerStatusText {
  /** While `/health` is polled. */
  readonly waking: string;
  /** Under `waking`: why it can take a while. */
  readonly wakingHint: string;
  /** After the poll gave up. */
  readonly unreachable: string;
  /** While the socket opens for the first time. */
  readonly connecting: string;
  /** While Socket.io retries after an open connection dropped. */
  readonly reconnecting: string;
  /**
   * Under `reconnecting` while the tab holds a seat: how long the server keeps it.
   * @param minutes `DISCONNECT_FORFEIT_MS` in minutes.
   * @returns The sentence.
   */
  readonly seatKept: (minutes: number) => string;
  /**
   * Under `connecting` or `reconnecting` once an attempt failed and Socket.io tries again.
   * @param error The last `connect_error` message, as Socket.io words it (e.g. `xhr poll error`).
   * @returns The sentence.
   */
  readonly retrying: (error: string) => string;
  /** After `SERVER_SHUTDOWN`, while the client waits for the next instance. */
  readonly restarting: string;
  /** Under `restarting`. */
  readonly restartingHint: string;
  /** Once the socket is connected. */
  readonly connected: string;
  /** When the server refused the handshake with `PROTOCOL_MISMATCH`; the page shows how to reload. */
  readonly outdated: string;
  /** When a newer connection took the seat (`SESSION_REPLACED`); the page offers to take it back. */
  readonly replaced: string;
  /** When the server refused the handshake for another reason. */
  readonly refused: string;
  /** When the socket gave up otherwise: closed by the server without a reason. */
  readonly disconnected: string;
  /** The button that starts over after `unreachable`, `refused` or `disconnected`. */
  readonly retry: string;
}

/**
 * English strings of the server status line, in one typed object so that `I18nService` (ADR-0018) can supply them per
 * locale later.
 */
export const SERVER_STATUS_TEXT: ServerStatusText = {
  waking: 'Waking up the server…',
  wakingHint: 'A sleeping server usually takes about half a minute to start.',
  unreachable: 'The server is not responding.',
  connecting: 'Connecting…',
  reconnecting: 'Connection lost. Reconnecting…',
  seatKept: (minutes) => `Your seat is kept for ${String(minutes)} minutes after you lose the connection.`,
  retrying: (error) => `The last attempt failed (${error}). Trying again…`,
  restarting: 'The server is restarting…',
  restartingHint: 'You are reconnected as soon as it is back.',
  connected: 'Connected',
  outdated: 'Refused by the server: this page is out of date.',
  replaced: 'Disconnected: this match is open in another tab or on another device.',
  refused: 'The server refused the connection.',
  disconnected: 'Disconnected from the server.',
  retry: 'Try again',
};
