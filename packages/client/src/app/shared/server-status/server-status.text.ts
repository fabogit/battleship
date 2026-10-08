/** The words of the server status line. */
export interface ServerStatusText {
  /** While `/health` is polled. */
  readonly waking: string;
  /** Under `waking`: why it can take a while. */
  readonly wakingHint: string;
  /** After the poll gave up. */
  readonly unreachable: string;
  /** While the socket opens, or retries after a drop. */
  readonly connecting: string;
  /** Once the socket is connected. */
  readonly connected: string;
  /** When the socket gave up: closed by the server, or refused. */
  readonly disconnected: string;
  /** The button that starts over after `unreachable` or `disconnected`. */
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
  connected: 'Connected',
  disconnected: 'Disconnected from the server.',
  retry: 'Try again',
};
