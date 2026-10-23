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
