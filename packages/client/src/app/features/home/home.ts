import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { CONNECTION_STATUSES, GameSocketService } from '../../core/game-socket';
import { RoomEntryService, type RoomEntryError } from '../../core/room-entry';
import { roomEntryErrorMessage } from '../../core/room-entry.text';
import { NicknameForm } from '../../shared/nickname-form/nickname-form';
import { HOME_TEXT } from './home.text';

/**
 * The home screen at `/`: a nickname, then "Create room", which seats the player as `P1` and opens the room's own page,
 * `/r/<roomId>`, whose address is the link to share (docs/client.md#routes--lobby-flow, ADR-0049).
 */
@Component({
  selector: 'app-home',
  imports: [NicknameForm],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly socket = inject(GameSocketService);
  private readonly roomEntry = inject(RoomEntryService);
  private readonly router = inject(Router);

  /** The words of the screen. */
  protected readonly text = HOME_TEXT;
  /** Whether commands can be sent, which the form needs before it submits. */
  protected readonly isConnected = computed(() => this.socket.status() === CONNECTION_STATUSES.CONNECTED);
  /** Why the last attempt failed; cleared by the next one. */
  protected readonly error = signal<RoomEntryError | null>(null);
  /** The message for `error`, or `null`. */
  protected readonly errorMessage = computed(() => {
    const error = this.error();
    return error === null ? null : roomEntryErrorMessage(error);
  });

  /**
   * Creates a room and opens its page; a failure stays on the home screen with its message. An arrow function, so the
   * form can call it without losing `this`.
   * @param nickname The trimmed nickname.
   */
  protected readonly create = async (nickname: string): Promise<void> => {
    this.error.set(null);
    const result = await this.roomEntry.create(nickname);
    if (result.ok) {
      await this.router.navigate(['/r', result.roomId]);
    } else {
      this.error.set(result.error);
    }
  };
}
