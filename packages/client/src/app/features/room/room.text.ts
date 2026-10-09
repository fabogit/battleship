/** The words of the room page, apart from the waiting screen. */
export interface RoomText {
  /** The heading of the join view. */
  readonly joinHeading: string;
  /**
   * Under the join heading.
   * @param roomId The room's id.
   * @returns The sentence.
   */
  readonly joinIntro: (roomId: string) => string;
  /** The join button. */
  readonly join: string;
  /** The join button while the seat is being taken. */
  readonly joining: string;
  /** While the room's first snapshot is on its way. */
  readonly entering: string;
  /** The heading of the phases after placement, until the battle view (#20) takes over. */
  readonly matchHeading: string;
  /**
   * Who the opponent is, after placement.
   * @param nickname The opponent's nickname.
   * @returns The sentence.
   */
  readonly opponentIs: (nickname: string) => string;
  /** What comes next, until the battle view (#20) takes over. */
  readonly matchNext: string;
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
  matchHeading: 'Both fleets are ready',
  opponentIs: (nickname) => `You are playing against ${nickname}.`,
  matchNext: 'The battle board comes next.',
  notFoundHeading: 'Room not found',
  notFoundReason:
    'The link may be mistyped, or the room has closed: rooms do not survive a server restart and expire when left empty.',
  fullHeading: 'This room is full',
  fullReason: 'Two players are already in this room.',
  createOwn: 'Create a new room',
};
