import * as admin from 'firebase-admin';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';

import {DoublesPairingStrategy, GameStatus, IArenaEvent, IArenaGameTeam, IArenaTeam} from '../../../types';
import * as TeamArena from '../util/TeamArena';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

// a player must re-confirm readiness within this window; the queue UI
// renews it every 30 seconds while the player stays opted in
export const READY_TTL_MS = 90 * 1000;

/**
 * Transactional team arena matchmaking. Called from the arena event update
 * handler for events where isTeamArena() is true. Dispatches at most one
 * game per trigger; the event write it performs re-triggers the handler so
 * further games are created until the queue is exhausted.
 *
 * Bring-your-partner: the first N wholly-ready teams (all members fresh and
 * full roster, or the captain opted into short-handed play) go together,
 * FIFO by the time the team's last member FIRST confirmed: arenaQueueAt is
 * stamped on the first ready and never moved by heartbeat renewals, so a
 * queued team's position cannot reset.
 *
 * Random partners: the OLDEST freshly-ready individuals are picked (same
 * arenaQueueAt ordering, so nobody starves), then shuffled and grouped
 * into full teams of teamSize; a game only forms when enough players for
 * the nominal gameSize are queued.
 */
export async function handleTeamArenaEventUpdate(
    snapshot: DocumentSnapshot): Promise<void> {
  return db.runTransaction(async tx => {
    const eventSnap = await tx.get(snapshot.ref);
    if (!eventSnap.exists) return;
    const event = (eventSnap.data() || {}) as IArenaEvent;

    try {
      TeamArena.validateTeamArenaConfig(event);
    } catch (error) {
      console.log(`invalid team arena config on ${eventSnap.id}: ${error}`);
      return;
    }

    const now = Date.now();
    // no matchmaking before the start or at/after the end of the event
    if (!(event.startTime <= now && now < event.endTime)) {
      return;
    }
    if (event.winners?.length) {
      return;  // finalized
    }

    const playing = new Set(event.arenaPlaying || []);
    const ready = event.arenaReady || {};
    const queueAt = event.arenaQueueAt || {};
    // a ready stamp only counts while inside the freshness window;
    // clock-skewed future timestamps are rejected like missing ones
    const isFresh = (name: string) =>
        Number.isFinite(ready[name]) && ready[name] <= now &&
        now - ready[name] < READY_TTL_MS;
    // a player's queue position is their first fresh confirmation, never
    // the latest heartbeat; fall back to the ready stamp for events that
    // predate the queue-position map
    const firstReady = (name: string) =>
        Number.isFinite(queueAt[name]) ? queueAt[name] :
        (ready[name] || 0);

    const bringYourPartner =
        event.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER;

    // collect every candidate name so player docs can be read before writes
    const candidates = new Set<string>();
    if (bringYourPartner) {
      for (const team of event.arenaTeams || []) {
        for (const member of team.members || []) {
          candidates.add(member);
        }
      }
    } else {
      for (const name of Object.keys(ready)) {
        candidates.add(name);
      }
    }
    const playerDocs = new Map<string, admin.firestore.DocumentSnapshot>();
    for (const name of candidates) {
      playerDocs.set(
          name, await tx.get(eventSnap.ref.collection('players').doc(name)));
    }

    // a queued player must be registered, not disqualified, not withdrawn,
    // freshly ready, and not locked into an in-flight game
    const eligible = (name: string) => {
      const doc = playerDocs.get(name);
      const player = doc?.data() || {};
      return !!doc && doc.exists && player.name === name && !player.dq &&
          !player.withdrawn && !playing.has(name) && isFresh(name);
    };

    const teamsPerGame = event.playersPerGame / event.teamSize!;
    const counter = (event.arenaMatchNumber || 0) + 1;

    let dispatched: IArenaGameTeam[];
    let pickedTeams: IArenaTeam[] = [];
    if (bringYourPartner) {
      // a team is queuable only when every active member is freshly ready
      // and the roster is full or explicitly allowed to play short-handed
      const queueable = (event.arenaTeams || []).filter(team =>
          Array.isArray(team.members) && team.members.length > 0 &&
          (team.members.length === event.teamSize ||
              !!team.allowShortHanded) &&
          team.members.every(eligible));

      // FIFO order: a team's queue position is the moment its last member
      // first confirmed, ties broken by stable team id
      const readyAt = (team: IArenaTeam) =>
          Math.max(...team.members.map(member => firstReady(member)));
      queueable.sort((a, b) =>
          readyAt(a) - readyAt(b) || a.id.localeCompare(b.id));

      // nominal team count is required even for short-handed rosters; a
      // partial game would skew placement scoring
      pickedTeams = queueable.slice(0, teamsPerGame);
      if (pickedTeams.length < teamsPerGame) return;

      dispatched = pickedTeams.map(team => ({
        id: team.id,
        name: team.name,
        players: team.members.slice(),
      }));
    } else {
      // random partners: take the OLDEST queued players first so frequent
      // renewals or a busy backlog can never starve the head of the queue,
      // then shuffle only the picked set into teams
      const pool = Object.keys(ready).filter(name => eligible(name));
      if (pool.length < event.playersPerGame) return;
      pool.sort((a, b) => firstReady(a) - firstReady(b) ||
          a.localeCompare(b));
      const picked = pool.slice(0, event.playersPerGame);
      for (let i = picked.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [picked[i], picked[j]] = [picked[j], picked[i]];
      }

      dispatched = [];
      for (let i = 0; i < teamsPerGame; i++) {
        const players = picked.slice(i * event.teamSize!, (i + 1) *
            event.teamSize!);
        dispatched.push({
          id: `match_${counter}_team_${i}`,
          name: players.join(' & '),
          players,
        });
      }
    }

    const players = dispatched.reduce(
        (all: string[], team) => all.concat(team.players), []);
    if (new Set(players).size !== players.length) {
      // should be impossible: same name can only be on one team
      console.log(`duplicate player in dispatch for ${eventSnap.id}`);
      return;
    }

    const gameId = `game_${counter}`;
    const lobby = `event_team_${eventSnap.id}_${counter}`;
    const eventTeam = TeamArena.normalizeLobby({
      version: 1,
      teamSize: event.teamSize,
      gameSize: event.playersPerGame,
      teams: dispatched.map(team => team.players),
    });

    // snapshot the lobby configuration at dispatch: later event edits can
    // never retroactively invalidate a game already sent to a lobby.
    // Firestore cannot hold the nested rosters directly, so the document
    // carries the stored codec shape; the wire contract is unchanged.
    const storedEventTeam = TeamArena.storeLobby(eventTeam);
    const options = event.options || {};
    const server = event.server;

    tx.create(eventSnap.ref.collection('games').doc(gameId), {
      players,
      arenaTeams: dispatched,
      eventTeam: storedEventTeam,
      options,
      server,
      lobby,
      started: now,
      status: GameStatus.STARTED,
      timesChecked: 0,
    });
    tx.create(eventSnap.ref.collection('redirect').doc(gameId), {
      players: players.slice(),
      arenaTeams: dispatched,
      eventTeam: storedEventTeam,
      options,
      server,
      gameId,
      lobby,
      started: now,
    });

    // remove the dispatched players' readiness and queue position, and
    // prune any expired or invalid entries while the event document is
    // already being written
    const arenaReady = {...ready};
    const arenaQueueAt = {...queueAt};
    for (const name of Object.keys(arenaReady)) {
      if (players.includes(name) || !eligible(name)) {
        delete arenaReady[name];
        delete arenaQueueAt[name];
      }
    }

    const update: {[key: string]: any} = {
      arenaReady,
      arenaQueueAt,
      arenaPlaying: admin.firestore.FieldValue.arrayUnion(...players),
      arenaParticipants: admin.firestore.FieldValue.arrayUnion(...players),
      arenaMatchNumber: counter,
      ongoingGameCount: admin.firestore.FieldValue.increment(1),
    };

    // fixed teams record the members that actually got dispatched
    if (bringYourPartner && event.arenaTeams) {
      const pickedIds = new Set(pickedTeams.map(team => team.id));
      update.arenaTeams = event.arenaTeams.map(team =>
          pickedIds.has(team.id) ?
          {...team,
            participants: Array.from(
                new Set([...(team.participants || []), ...team.members]))} :
          team);
    }

    tx.update(eventSnap.ref, update);
  });
}
