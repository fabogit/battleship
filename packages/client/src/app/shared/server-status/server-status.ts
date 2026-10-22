import { Component, computed, effect, inject, untracked } from '@angular/core';
import { DISCONNECT_FORFEIT_MS } from '@battleship/core';

import { CLOSE_REASONS, CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { ServerWakeService, WAKE_STATUSES } from '../../core/server-wake';
import { SessionStore } from '../../core/session-store';
import { wholeMinutes } from '../countdown';
import { SERVER_STATUS_TEXT } from './server-status.text';

/** How the status line colours its message (ADR-0043). */
export const STATUS_TONES = {
  /** Waiting for something: waking, connecting, retrying. */
  PENDING: 'pending',
  /** Connected. */
  OK: 'ok',
  /** Given up or refused. */
  ERROR: 'error',
} as const;

/** One of the `STATUS_TONES`. */
export type StatusTone = (typeof STATUS_TONES)[keyof typeof STATUS_TONES];

/** What the status line shows at one moment. */
export interface StatusLine {
  /** The main message. */
  readonly message: string;
  /** Its colour, by what it means. */
  readonly tone: StatusTone;
  /** Smaller lines under it, e.g. the last failed attempt; empty for none. */
  readonly details: readonly string[];
  /** Whether a "Try again" button follows: the poll or the socket gave up, and retrying may help. */
  readonly canRetry: boolean;
}

/**
 * Wakes the server and opens the socket when the app starts, and tells the player where that stands
 * (docs/client.md#cold-start-handling, docs/client.md#connection-states). The app shell renders it once, above every
 * page, so nickname entry stays usable while the server wakes up. It tells "refused" (the server said no, and why)
 * from "retrying" (Socket.io tries again, with the last attempt's error), and after `SERVER_SHUTDOWN` it waits for the
 * next instance and reconnects (ADR-0075).
 */
@Component({
  selector: 'app-server-status',
  templateUrl: './server-status.html',
  styleUrl: './server-status.css',
})
export class ServerStatus {
  /** The wake-up poll. */
  private readonly wake = inject(ServerWakeService);
  /** Opened once the server is awake. */
  private readonly socket = inject(GameSocketService);
  /** Whether the tab holds a seat, which the server keeps for a while after a drop. */
  private readonly sessions = inject(SessionStore);

  /** The words shown for each state. */
  private readonly text = SERVER_STATUS_TEXT;
  /** The words of the retry button. */
  protected readonly retryLabel = this.text.retry;

  /** What the line shows, from the poll's status, then the socket's. */
  protected readonly line = computed<StatusLine>(() => {
    const isRestarting = this.socket.closeReason() === CLOSE_REASONS.SERVER_SHUTDOWN;
    switch (this.wake.status()) {
      case WAKE_STATUSES.IDLE:
      case WAKE_STATUSES.WAKING:
        return isRestarting
          ? pending(this.text.restarting, [this.text.restartingHint])
          : pending(this.text.waking, [this.text.wakingHint]);
      case WAKE_STATUSES.UNREACHABLE:
        return { message: this.text.unreachable, tone: STATUS_TONES.ERROR, details: [], canRetry: true };
      case WAKE_STATUSES.AWAKE:
        return this.socketLine(isRestarting);
    }
  });

  /**
   * Starts the wake-up poll as soon as the shell is created, and again, forced, once the server has announced a
   * restart and disconnected the socket (#51 F15): the instance that answered before is gone.
   */
  constructor() {
    void this.start();
    effect(() => {
      if (
        this.socket.status() === CONNECTION_STATUSES.DISCONNECTED &&
        this.socket.closeReason() === CLOSE_REASONS.SERVER_SHUTDOWN
      ) {
        untracked(() => {
          void this.start({ isForced: true });
        });
      }
    });
  }

  /**
   * Polls `/health` until the server answers, then opens the socket. Waking an awake server returns at once unless
   * forced, and `connect()` reopens a socket that gave up.
   * @param options `isForced` polls even when the server answered before.
   */
  protected async start(options: { readonly isForced?: boolean } = {}): Promise<void> {
    if (await this.wake.wake(options)) {
      this.socket.connect();
    }
  }

  /** Starts over from the retry button, polling again: the server may have restarted since it last answered. */
  protected retry(): void {
    void this.start({ isForced: true });
  }

  /**
   * Words the socket's state once the server is awake.
   * @param isRestarting Whether the server announced a restart (`SERVER_SHUTDOWN`).
   * @returns What to show: retrying with the last error, refused with its reason, or connected.
   */
  private socketLine(isRestarting: boolean): StatusLine {
    switch (this.socket.status()) {
      case CONNECTION_STATUSES.CONNECTED:
        return { message: this.text.connected, tone: STATUS_TONES.OK, details: [], canRetry: false };
      case CONNECTION_STATUSES.CONNECTING: {
        const retryError = this.socket.retryError();
        const retrying = retryError === null ? [] : [this.text.retrying(retryError)];
        if (isRestarting) {
          return pending(this.text.restarting, [this.text.restartingHint, ...retrying]);
        }
        if (this.socket.isReconnecting()) {
          const seatKept =
            this.sessions.current() === null ? [] : [this.text.seatKept(wholeMinutes(DISCONNECT_FORFEIT_MS))];
          return pending(this.text.reconnecting, [...seatKept, ...retrying]);
        }
        return pending(this.text.connecting, retrying);
      }
      case CONNECTION_STATUSES.DISCONNECTED:
        switch (this.socket.closeReason()) {
          case CLOSE_REASONS.PROTOCOL_MISMATCH:
            return { message: this.text.outdated, tone: STATUS_TONES.ERROR, details: [], canRetry: false };
          case CLOSE_REASONS.SESSION_REPLACED:
            return { message: this.text.replaced, tone: STATUS_TONES.ERROR, details: [], canRetry: false };
          case CLOSE_REASONS.SERVER_SHUTDOWN:
            return pending(this.text.restarting, [this.text.restartingHint]);
          case CLOSE_REASONS.REFUSED:
            return { message: this.text.refused, tone: STATUS_TONES.ERROR, details: [], canRetry: true };
          case CLOSE_REASONS.SERVER_DISCONNECT:
          case null:
            return { message: this.text.disconnected, tone: STATUS_TONES.ERROR, details: [], canRetry: true };
        }
    }
  }
}

/**
 * Builds a line for a state that waits for something.
 * @param message The main message.
 * @param details The smaller lines under it.
 * @returns The line, without a retry button.
 */
function pending(message: string, details: readonly string[]): StatusLine {
  return { message, tone: STATUS_TONES.PENDING, details, canRetry: false };
}
