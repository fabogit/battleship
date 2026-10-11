/** The words of the room page, apart from the views it hosts. */
export interface RoomText {
  /** The heading of the join view. */
  readonly joinHeading: string;
  /**
   * Under the join heading.
   * @param roomId The id from the address, shown so the player can tell which room invited them.
   * @returns The invitation, ending with what to do.
   */
  readonly joinIntro: (roomId: string) => string;
  /** The join button. */
  readonly join: string;
  /** The join button while the seat is being taken. */
  readonly joining: string;
  /** While the room's first snapshot is on its way. */
  readonly entering: string;
  /** The heading of the view for a room the tab has left. */
  readonly leftHeading: string;
  /** Why a room the tab has left cannot be played here. */
  readonly leftReason: string;
  /** The heading of the not-found view. */
  readonly notFoundHeading: string;
  /** Why a room may not be found. */
  readonly notFoundReason: string;
  /** The heading of the full-room view. */
  readonly fullHeading: string;
  /** Why the room is full. */
  readonly fullReason: string;
  /** The link back to the home screen. */
  readonly createOwn: string;
}

/**
 * English strings of the room page, in one typed object so that `I18nService` (ADR-0018) can supply them per locale
 * later.
 */
export const ROOM_TEXT: RoomText = {
  joinHeading: 'Join a match',
  joinIntro: (roomId) => `You have been invited to room ${roomId}. Choose a nickname to take the free seat.`,
  join: 'Join room',
  joining: 'Joining room…',
  entering: 'Entering the room…',
  leftHeading: 'You left this room',
  leftReason: 'You have entered another room since, so this page no longer follows this one.',
  notFoundHeading: 'Room not found',
  notFoundReason:
    'The link may be mistyped, or the room has closed: rooms do not survive a server restart and expire when left empty.',
  fullHeading: 'This room is full',
  fullReason: 'Two players are already in this room.',
  createOwn: 'Create a new room',
};
