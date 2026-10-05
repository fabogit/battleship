# Battleship

Real-time 1v1 Battleship in the browser: two players meet in a private room, place their fleets and fire at each other's board until one fleet is sunk. The definitions follow the [specification](docs/overview.md) and the [decisions](docs/adr/README.md).

## Language

### Rooms and players

**Room**:
A private space for exactly two players, shared via link (`/r/<roomId>`). It outlives a match: a rematch is played in the same room. "Lobby" names a client screen (`features/lobby`: waiting and rules), not the room.
_Avoid_: lobby (for the room itself), game

**Seat**:
One of the two public positions in a room: `P1` for the creator, `P2` for the joiner. A disconnected player keeps their seat for `DISCONNECT_FORFEIT_MS`.
_Avoid_: host, slot

**Nickname**:
The name a player chooses before creating or joining a room; trimmed, non-empty, at most `NICKNAME_MAX_LENGTH` characters, rendered as text only.
_Avoid_: username

**Player secret**:
The credential the server returns on `CREATE_ROOM` and `JOIN_ROOM`; it is never sent to the other player.
_Avoid_: token, password

**Session**:
A room id plus its player secret, stored by `SessionStore`, that binds a reconnecting socket back to its seat. The latest connection to a seat wins.
_Avoid_: login

**Phase**:
The stage a room is in: `WAITING_FOR_OPPONENT`, `RULES_NEGOTIATION`, `PLACEMENT`, `IN_PROGRESS` or `GAME_OVER`.
_Avoid_: stage, status

**Good faith**:
The design principle that players cooperate to play a match: the room is symmetric, with no host and no kick, and conflicts are resolved by mutual confirmation.

### Rules

**Rules**:
The settings of a room that both players agree on before placement: extra turn on hit, adjacent ships, turn time limit, salvo mode and timeout action.
_Avoid_: settings, options

**Rules version**:
A counter the server increments on every rules edit; a rules confirmation names the version it confirms.
_Avoid_: rules hash

**Confirmation**:
A player's agreement to the current rules version, or to their own fleet. Any rules edit clears both rules confirmations; a confirmed fleet stays locked until the player unlocks it.
_Avoid_: ready

**Salvo mode**:
The rule (`salvoMode`) under which a turn fires as many targets as the shot allowance; standard mode is a salvo of size 1.
_Avoid_: volley, multi-shot

**Extra turn on hit**:
The rule (`consecutiveTurnOnHit`, standard mode only) that gives the shooter another turn after any `HIT` or `SUNK`. It excludes salvo mode.
_Avoid_: consecutive turn, bonus turn

**Timeout action**:
What a turn that runs out of time does: `AUTO_RANDOM_SHOT` keeps the valid draft targets and fills the rest randomly; `PASS_TURN` discards the draft and passes the turn.

### Placement

**Fleet**:
The five ships each player places: carrier (5), battleship (4), cruiser (3), submarine (3), destroyer (2).
_Avoid_: navy

**Draft**:
A player's unconfirmed, freely changeable choice, synced to the server on every change: the ship layout during placement (0–5 ships), or the targets of the current turn before `FIRE`.
_Avoid_: selection, pending layout

**Start countdown**:
The delay of `min(START_COUNTDOWN_MS, time to deadline)` that runs once both fleets are confirmed; an unlock cancels it.

**Auto-completion**:
What the server does at the placement deadline: it completes every unconfirmed fleet with `completeFleet` and locks it.
_Avoid_: auto placement

**Dice roll**:
The server-side d6 roll for each player, ties re-rolled, that decides who starts; it is repeated every match.
_Avoid_: coin toss

### Battle

**Match**:
One game in a room, from the dice roll to game over. A rematch starts a new match in the same room.
_Avoid_: game, round

**Shot allowance**:
The number of targets a turn fires (`shotsAllowed`): 1 in standard mode; in salvo mode, `min(shooter's surviving ships, opponent's unshot cells)`.
_Avoid_: shot count

**Auto shot**:
A shot the server fires for a player when the turn times out under `AUTO_RANDOM_SHOT`, uniformly random among unshot cells.
_Avoid_: AI shot

**AFK**:
A turn that ended on its timer instead of a `FIRE`. Every one increments the player's AFK counter; any `FIRE` resets it.
_Avoid_: idle, inactive

**Pause**:
The frozen state of a match in progress, entered automatically when a player's socket drops: the turn timer stops with its remaining time. Only the connected player may resume or pause again while the opponent is away; the forfeit clock keeps running.
_Avoid_: suspend

**Forfeit**:
The end of a match by absence: `AFK_FORFEIT` when a player reaches `MAX_CONSECUTIVE_AFK_TURNS` (unless both are AFK), `DISCONNECT_FORFEIT` when a disconnected player does not return within `DISCONNECT_FORFEIT_MS`.
_Avoid_: walkover

**Surrender**:
A player's own decision to end a match in progress, through `SURRENDER` or `LEAVE_ROOM`.
_Avoid_: resign, concede, quit

**Abandoned**:
The end of a match in which both players are AFK; it has no winner.

**Rematch choice**:
What each player picks at game over: `SAME_RULES`, `CHANGE_RULES` or `LEAVE`. `CHANGE_RULES` wins over `SAME_RULES`.
_Avoid_: replay

### Protocol

**Snapshot**:
The full per-player view of a room (`STATE`, `PlayerStateSnapshot`) that the server pushes after every change and on (re)connect; the client's source of truth.
_Avoid_: delta, state update

**Fog-of-war**:
The rule that each client receives only its own fleet and the shot history; the opponent's fleet is revealed at game over.

**Protocol version**:
The `PROTOCOL_VERSION` constant, bumped on any breaking protocol change and checked in the Socket.io handshake; a mismatched client is told to reload.

**Foreign origin**:
A browser `Origin` that `ALLOWED_ORIGINS` does not match; it gets `403` on HTTP and a refused Socket.io handshake. Requests without an `Origin` are allowed.

### Hosting

**Spin-down**:
Render stopping the free instance after 15 minutes without inbound traffic; every room in memory is lost.
_Avoid_: sleep, shutdown

**Cold start**:
The wait while Render brings a spun-down instance back up (about 24 s measured); the client polls `/health` until it answers.
_Avoid_: spin-up

### Delivery

**Milestone**:
One step of the roadmap, M0–M5, that ends deployed and playable on the production URLs. The roadmap calls the same steps phases 0–5.
_Avoid_: phase (reserved for the room phase), sprint

**Review & consolidation**:
The last issue of every milestone: analysis of `main`, triage, small themed PRs, then a production re-measure and a retro.
