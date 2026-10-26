# Generals.io Tournaments

This is a tournament webapp for running events for the game [generals.io](http://generals.io/). Tournament formats are developed as we need them. The available ones are documented below.

## Tournament Formats

### Arena
#### Supports: FFA, 1v1
Arena tournaments will play in the arena style that [lichess.org](https://lichess.org/tournament) uses where the tournament runs for a set amount of time and the player with the most points at the end wins. You accumulate points based on your performance in the tournament. Whenever your current game ends, you jump in the queue to be paired with new players to jump into a new game.

### Double Elimination
#### Supports: 1v1, 2v2 (bring your partner)
Players play in a double elimination bracket until one winner wins the grand finals. The number of games played per round are configurable for the winners backet, losers bracket, semifinals, and finals. A tournament can use the total seed points (TSP) from the main generals.io site for seeding the bracket as well as limiting participants to those that qualified this season. Most of the info is out of date, but you can [read more about season rankings here](https://www.reddit.com/r/generalsio/wiki/index#wiki_season_tournament_information).

### Dynamic DYP
#### Supports: 2v2
In this format players will be paired with a new random teammate for several rounds. You will never play with the same partner twice. After these preliminary rounds finish up, the top 8 players with the most points will form teams among themselves and play out a quick single elimination tournament to determine the top two players.

### Team Arena
#### Supports: 2v2, Big Team (arena format only)
Arena-duration events played as fixed teams. Two pairing modes:
*Bring Your Partner* (captain-managed rosters with voluntary join requests,
optional random fill, and an explicit short-handed opt-in) and
*Random Partners* (shuffled into full teams per game). The game size must be
a whole multiple of the team size (2v2 is fixed at two teams of two).

Every active member must personally confirm readiness for each game;
confirmations expire after 90 seconds, so the event page renews them while
a player stays opted in. One member unreadying un-queues the whole team.
Scoring is shared per team: placement points count only the teams strictly
outlived, plus actual enemy captures, a win bonus, and a duration bonus for
the top two teams — there are no win-streak multipliers in team arenas.
See `functions/src/util/TeamArena.js` for the canonical rules.

A dispatched game waits for its replay until 20 minutes after the event's
`endTime` (arenas can run an hour; long games finishing after the event
ends still count). Once that grace deadline passes with no replay, the game
is cancelled, its players are released, and it earns no score.

## Multi-stage events
This is a special type of event where event organizers can set up multiple stages to be played in a single event. Each stage is its own event, of any type, that gets tied to this "parent" multi-stage event. For now, we are using this to try out several custom maps in a single event to get a variety of gameplay. In the future, Dynamic DYP could probably be converted to generate a multi-stage event with the finals being a Double Elimination bracket once that format supports 2v2.

## Security model

Everything in Firestore is readable by anyone (the generals.io homepage reads
the events list and the `generals.io/homepage` doc without logging in), but
nothing can be written without proving who you are. `firestore.rules` is the
source of truth and `firestore-rules-tests/` covers every rule:

```
npm --prefix firestore-rules-tests install   # once
npm --prefix firestore-rules-tests test      # starts the Firestore emulator
```

### Logging in

generals.io is the identity provider. Nobody types a username here, and no
Cloud Function runs during login, so there is no cold start.

1. The events app sends the player to `https://generals.io/?eventGetUsername=true`.
2. generals.io asks its own server (`POST /api/event/handoffToken`) for a
   **Firebase custom token**: an RS256 JWT for `uid = username`, signed by the
   `events-handoff@generals-tournaments` service account (which has no IAM
   roles), valid for two minutes. See `server/EventHandoff.js` in the generals
   repo.
3. generals.io redirects back to `https://events.generals.io/?handoffToken=...`.
4. The app calls `signInWithCustomToken`. Firebase Auth verifies the signature.
   From then on every Firestore write carries `request.auth.uid`, and the rules
   only let players touch their own player doc, queue/check-in entry, partner
   fields, and chat messages.
5. Organizers are the names in the `generals.io/admins` document
   (`{names: [...]}`), which only organizers can edit. Results, brackets, and
   event settings are organizer or function only. Keep `ADMINS` in
   `constants.ts` (UI gating) in sync with that document.

### Local development

Run the app on `localhost:8100` or `localhost:4200` and click Login. The app
adds `eventDevPort` to the generals.io redirect and generals.io sends the token
back to your local server instead of events.generals.io. The exchange still
happens against the production functions, so you log in as your real account.

### Bots and the public API

`GET` endpoints of the API stay public. Anything that changes an event
(`join`, `queue`, `lobby`) requires `Authorization: Bearer <key>`. Keys are a
comma separated list in the `API_KEYS` secret. See `bot/README.md`.

### Secrets

Secrets live in Secret Manager, not `functions.config()`:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `EVENTS_SERVICE_ACCOUNT_KEY` | generals.io server only | key JSON for `events-handoff@...`, signs login tokens |
| `API_KEYS` | `api` function, generals.io server, bots | comma separated keys for the write endpoints |
| `SLACK_WEBHOOK_URL` | `onCreateMessage` | chat mirror |

```
firebase functions:secrets:access EVENTS_SERVICE_ACCOUNT_KEY  # copy to the game server
firebase functions:secrets:set API_KEYS                       # rotate / add bot keys
```

For the emulator, copy `functions/.secret.local.example` to
`functions/.secret.local`.

### Rolling out an auth change

Deploy in this order so logins never break for longer than a redeploy:

1. `npm run deploy-functions` then `npm run deploy-hosting` (events repo).
2. On the game server set `EVENTS_SERVICE_ACCOUNT_KEY` (the key JSON or a path
   to it) and `EVENTS_API_KEY` (one of the `API_KEYS` entries), then redeploy
   it (generals repo).
3. `firebase deploy --only firestore:rules`. Until this step the database is
   still open, after it every existing visitor has to log in again.

## Audit status and known release blockers

A tournament hardening pass added consistency checks, atomic Big Team roster
transactions, bracket validation, and an offline regression suite
(`npm run test:tournaments`, see `test/`).

A modifier/replay support pass added all twelve game modifier ids (0-11) to
event creation/editing, lobby URL serialization, and replay simulation:

- `game-options.ts` / `functions/src/util/EventGameOptions.js` normalize and
  validate modifier ids (unknown, fractional, or mutually exclusive ids
  reject) and nested `modifier_options` (currently ChessClock's
  `StartingClock`/`ClockIncrement`/`DontLimitMoveSpeed`, normalized against
  the defaults 10/5/false).
- `joinLobby` emits modifiers in the comma-delimited grammar the main client
  parses and serializes `modifier_options` as JSON; the main client's
  `client/js/queue/EventGameOptions.js` parses them and rejects malformed
  configs rather than starting a wrong lobby.
- `functions/src/util/simulator.js` `getReplayStats(replayId, server,
  expectedOptions)` validates the decoded replay's modifier set and
  effective ChessClock config against `event.options` — an explicit
  `null`/`[]` expects an unmodified replay — before simulation, and all
  three result writers (`games`, `matches`, `dyp-matches` `onWrite`) pass
  `event.options`, so a modifier tournament never counts an unmodified or
  wrong-clock replay. Unknown modifier ids in a replay always fail closed.
- ChessClock replays can carry exact elapsed-time metadata
  (`chessClockElapsed`, ms relative to game start, with per-player death
  offsets). `elapsedMs` semantics are three-way: `undefined` means a
  classic fixed-speed replay (finished = started + turns/speed), a number
  means exact wall-clock duration, and `null` means a ChessClock replay
  that predates the metadata — its finish time is *unknown* and persisted
  as `null` rather than estimated, and such games earn no arena duration
  bonus and cannot auto-DQ a record on finish-time overlap.
- `npm run test:modifiers` (`test/modifier-options.test.js`) exercises the
  normalization contracts, the create/edit form persistence, lobby URL
  serialization, and the three real `onWrite` handlers end-to-end against
  the explicit fake Firestore and locally compressed replay fixtures,
  including zero-write assertions for modifier/clock mismatches.
- Strongholds are supported through custom maps only: the main engine's
  custom-map initializer transfers `CustomMap` strongholds (with their
  configured strengths) onto the live map and they serialize into replays.
  Generated-map stronghold placement is not implemented, so the create form
  stores the stronghold fields but exposes no placement controls.

The following gaps are known, deliberately unfixed, and must not be treated
as resolved:

- **Team-arena and non-arena Big Team roster mutations now require the
  authenticated backend.** Firestore rules are locked down (see the
  Security model above): `teamArenaAction` and `teamBracketAction`
  callable functions own every arena and Big Team roster mutation against
  `context.auth.uid`, organizers resolve from the `generals.io/admins`
  document only. Team arenas also deny direct client self-registration;
  both arena and non-arena Big Team events deny direct self-deletion and
  protected roster-field writes. The lobby
  bootstrap additionally trusts only the API-key-verified dispatch
  snapshot — browser-supplied rosters/options are ignored server-side.
  Rule-emulator coverage for the new denial paths is authored in
  `firestore-rules-tests/rules.test.js` but pending integration (the
  emulator dependencies are not installed in this environment), and the
  callable/lobby paths are exercised only by the offline fake-Firestore
  suites, not production Firestore or a live browser.
- **Big Team Dynamic DYP finals are unsupported.** Dynamic DYP finals
  backend logic in `functions/src/events/dynamicDYP.ts` is commented out, and
  the finals UI (`dynamic-dyp-finals-teams`) hardcodes 8 finalists on
  2-player teams. Big Team or non-2v2 finals are not implemented.
- **Replay polling is majority-prevalence, not roster-exact.**
  `functions/src/events/matches/onWrite.ts` and
  `functions/src/events/dyp-matches/onWrite.ts` accept any replay that is
  newer, untracked, and has `ranking.length <= roster size`, then take a
  majority among the tracked players. An unrelated match involving a bare
  majority of expected players can be counted as a tournament match.
- **Replay increments are not idempotent.** Both `onWrite` handlers batch
  score increments after a stale `event.replays` check, so concurrent
  invocations can count the same replay twice (`arrayUnion` dedupes the id
  but not the increments).
- **Captain adds teammates without consent.** `setBigTeam` enforces captain
  authority and roster consistency, but there is no invite/consent schema —
  a captain can pull any eligible player onto a roster.
- **Match lobby names changed.** `joinLobby` now names match lobbies
  `match_{eventId}_{matchNumber}` so simultaneous events cannot collide.
  Do not switch an active tournament's link naming mid-run when deploying.
- **Generic Dynamic DYP scheduling is heuristic.** Unlike the classic 2v2
  path, the generic scheduler only minimizes repeated teammates
  heuristically; it does guarantee match counts stay within one of each
  other (`max - min <= 1`).
- **Existing e2e test is starter copy.** `e2e/src/app.e2e-spec.ts` still
  asserts the Ionic starter text (`'Start with Ionic UI Components'`) and
  does not exercise this app.
- **CI does not run tests.** `.github/workflows/` builds and deploys only;
  neither workflow invokes a test step.
- **Full build/frontend verification is pending dependencies.** The
  offline suites (`test/tournaments.test.js`,
  `test/modifier-options.test.js`) exercise the hardened logic and the
  real `onWrite` result handlers against an in-memory fake Firestore and
  a stubbed axios. They verify the code's own read-before-write,
  no-partial-write, and replay-validation behavior, but they are
  documented mocks — they are NOT proof of real Firestore transaction
  concurrency, security, or UI behavior. `node_modules` are not installed
  in this checkout, so the Angular app has not been compiled or run in a
  browser with these changes.
