import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {GeneralsServer} from '../../../../constants';
import {DoublesPairingStrategy, EventType, GameSpeed, GameStatus, IArenaEvent, IGame, IGeneralsReplay, ILeaderboardPlayer} from '../../../../types';
import {getReplaysForUsername} from '../../util/generals';
import * as simulator from '../../util/simulator';
import * as TeamArena from '../../util/TeamArena';
import {recordSanityCheck} from '../players/onUpdate';
import {getFinishedTime, timeoutAfter, keepLookingIn10Seconds} from '../../util/util';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onWriteGame =
    functions.firestore.document('events/{eventId}/games/{gameId}')
        .onWrite(async (gameDoc, context) => {
          if (gameDoc.after.exists) {
            const eventRef = gameDoc.after.ref.parent.parent!;

            // on create, increment the amount on ongoing games; team arena
            // dispatches already increment it inside the dispatch
            // transaction, identified by their immutable arenaTeams roster
            if (!gameDoc.before.exists && !gameDoc.after.data()?.arenaTeams) {
              await eventRef.update({
                ongoingGameCount: admin.firestore.FieldValue.increment(1),
              });
            }

            try {
              await lookForFinishedGame(gameDoc.after, eventRef);
            } catch (error) {
              console.log(gameDoc.after.id, error);
              await keepLookingIn10Seconds(gameDoc.after);
            }
          }
          return 'Done';
        });

async function lookForFinishedGame(
    snapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    ): Promise<any> {
  const game = (snapshot.data() || {}) as IGame;
  const {players} = game;
  const timesChecked = game.timesChecked || 0;
  const TWENTY_MINUTES = 12000;  // 120 * 10 = 1200 -> 20 minutes (in seconds)

  console.log(`looking for finished game ${snapshot.id}`);

  // get the event data
  const eventSnap = await eventRef.get();
  const event = (eventSnap.data() || {}) as IArenaEvent;

  // team arena games are scored by team outcome, and their dispatched
  // players stay locked in arenaPlaying until the game resolves
  if (TeamArena.isTeamArena(event)) {
    return lookForFinishedTeamArenaGame(snapshot, eventRef, event,
        timesChecked);
  }

  // if we still haven't found a replay within 20 minutes, pull the plug
  // note: the /games subcollection only applies to FFA Arena events
  if (timesChecked >= TWENTY_MINUTES) {
    console.log('it has been 20 minutes');
    await eventRef.update({
      ongoingGameCount: admin.firestore.FieldValue.increment(-1),
    });
    return await snapshot.ref.delete();
  }

  const {replayId, started} = game;
  console.log(`looking at game ${snapshot.id}, replayId: ${
      replayId}, started: ${started}`);

  // if we have a game with some players, and we haven't set a replayId yet,
  // find games for these players
  if (!replayId && players?.length) {
    // get the list of tracked replays for this event
    const trackedReplays = event.replays || [];
    console.log(`${trackedReplays.length} tracked replays for ${eventSnap.id}`);

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replays = await getReplaysForPlayers(
        players, trackedReplays, game.started, event.server);

    console.log('got all replays for players')

    const {count, replay} = getMostPrevalentReplay(replays);
    if (replay) {
      console.log(`${replay.id} is shared by ${count} of the ${
          players.length} players`);
    }

    if (count > players.length / 2) {
      // if over half (but not exactly half) of the og players were in this
      // game, and we have not tracked it already, count the game
      await saveReplayToGame(
          replay.id, replay.started, snapshot, eventRef, event);
    } else {
      // otherwise, gotta keep looking, start in 10 seconds
      await keepLookingIn10Seconds(snapshot);
    }
  }

  // in the case of there being no replay, but there is a replayId and started
  // timestamp, we can pull down the replay and calculate scores for this game
  else if (!game.replay && (replayId && started)) {
    console.log('we have a replayId and started, save replay to game');
    await saveReplayToGame(replayId, started, snapshot, eventRef, event);
  }
}

/**
 * Given the list of usernames, get the last 10 replays for each of them, and
 * then return a list of the replays that:
 * 1) aren't already tracked on this event
 * 2) started after this lobby was created
 * 3) the replay has <= the # of usernames in this game
 *
 * @param usernames
 * @param trackedReplays
 * @param gameStarted
 * @param server
 */
async function getReplaysForPlayers(
    usernames: string[],
    trackedReplays: string[],
    gameStarted: number,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay[]> {
  // for each player, request their latest 80 replays
  const replayPromises: Promise<IGeneralsReplay[]>[] =
      usernames.map(name => getReplaysForUsername(name, 0, 80, server));

  // wait for all requests to come back or timeout after 10 seconds
  const replays = await Promise.race([
    Promise.all(replayPromises),
    timeoutAfter(10000, []),
  ]);

  return flatten(replays).filter(replay => {
    // replays must exist, not already be tracked, and have to start
    // after this game was created in the database
    return replay && !trackedReplays.includes(replay.id) &&
        replay.started > gameStarted &&
        replay.ranking.length <= usernames.length;
  });
}

/**
 * Given a list of replays for the players in this game, return the replay that
 * is most prevalent in this list, along with the number of times it is seen
 * @param replays
 */
function getMostPrevalentReplay(replays: IGeneralsReplay[]):
    {count: number, replay: IGeneralsReplay} {
  // build up a map of the present replays and their counts
  const replayCounts = new Map<string, {
    replay: IGeneralsReplay,
    count: number,
  }>();
  console.log(`loaded ${replays.length} replays`);
  replays.forEach(replay => {
    const {count} = (replayCounts.get(replay.id) || {count: 0});
    replayCounts.set(replay.id, {replay, count: count + 1});
  });

  // determine which replay has the most shared players
  let most = {count: 0, replay: replays[0]};
  for (const entry of replayCounts.values()) {
    const {count, replay} = entry;
    if (count > most.count) {
      most = {count, replay};
    }
  }

  return most;
}

async function saveReplayToGame(
    replayId: string,
    started: number,
    gameSnapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    event: IArenaEvent,
    ): Promise<void> {
  const batch = db.batch();
  batch.update(eventRef, {
    replays: admin.firestore.FieldValue.arrayUnion(replayId),
    completedGameCount: admin.firestore.FieldValue.increment(1),
    ongoingGameCount: admin.firestore.FieldValue.increment(-1),
  });

  console.log(`getting replay stats for ${replayId}`);

  // pull down the replay and save it to the game doc; the event's options
  // verify the replay was actually played with the configured modifiers
  const {scores, summary, turns, elapsedMs} =
      await simulator.getReplayStats(replayId, event.server, event.options);


  const speed = event.options?.speed ?? GameSpeed.SPEED_1X;
  const finished = getFinishedTime(started, turns, speed, elapsedMs);
  const afterTime = finished !== null && event.endTime < finished;

  // determine if the winner is on a streak
  const [winner, second] = scores;
  const snapshot = await eventRef.collection('players').doc(winner.name).get();
  const {currentStreak} = snapshot.data() || {};

  // don't do streaks for FFA, instead just give a 5 point bonus for 1st
  if (event.type === EventType.FFA) {
    winner.points += 5;

    // to encourage long battles, award extra points to first and second so they
    // can duke it out; exact clock replays use the real duration, an unknown
    // legacy clock duration earns no bonus
    if (!afterTime) {
      const mins = elapsedMs === undefined ? Math.floor(turns / 60) :
          (elapsedMs === null ? 0 : Math.floor(elapsedMs / 60000));
      winner.points += mins;
      second.points += Math.floor(mins / 2);
    }
  }
  // all other types, double points from the 3rd win in a row onward
  // we use the number 2 here because currentStreak is about to be updated to
  // 3+, but could currently be 2 in the database prior to this game
  else if (currentStreak >= 2) {
    winner.streak = true;
    winner.points *= 2;
  }

  // save the replay to the game doc
  batch.update(gameSnapshot.ref, {
    replayId: replayId,
    started: started,
    finished: finished,
    ...(elapsedMs !== undefined ? {elapsedMs} : {}),
    replay: {scores, summary, turns,
        ...(elapsedMs !== undefined ? {elapsedMs} : {})},
    status: GameStatus.FINISHED,
  });

  // update each of the player's leaderboard item
  for (const player of scores) {
    // determine if this player is in the event
    const playerRef = eventRef.collection('players').doc(player.name);
    const playerDoc = await playerRef.get();
    if (!playerDoc.exists) continue;

    const recordId = `${replayId}_${player.name}`;

    // determine finished for this player; exact clock replays use the
    // player's death offset (or the game duration for survivors), an
    // unknown legacy clock duration yields an unknown finish
    const record = {
      replayId: replayId,
      started: started,
      finished: getFinishedTime(started, player.lastTurn, speed,
          player.elapsedMs ?? elapsedMs),
      ...player,
    };

    // save the record in case we ever build features around this
    batch.set(eventRef.collection('records').doc(recordId), record);

    // set lastThreeOpponents if this is a 1v1 event
    let opponents: string[] = [];
    if (event.type === EventType.ONE_VS_ONE) {
      const {lastThreeOpponents = []} =
          playerDoc.data() as ILeaderboardPlayer;
      const opponent = scores.find(p => p.name !== player.name)?.name;
      opponents = [opponent, ...lastThreeOpponents.slice(0, 2)];
    }

    // update the player's points, streak, and record on the leaderboard
    batch.update(playerRef, {
      points: admin.firestore.FieldValue.increment(player.points),
      currentStreak:
          player.rank === 1 ? admin.firestore.FieldValue.increment(1) : 0,
      record: admin.firestore.FieldValue.arrayUnion(record),
      lastThreeOpponents: opponents,
    });
  }

  console.log('committing...');
  await batch.commit();
  console.log('done!');
}

// a team arena game's replay may legitimately appear up to 20 minutes
// after the arena itself ended; a game that still has no replay by then is
// cancelled, and its players unlocked, exactly once
const REPLAY_GRACE_MS = 20 * 60 * 1000;

// keep retrying the replay search every 10 seconds until the replay
// deadline (the legacy keepLooking stops after 1000 checks, which is too
// short a bound for this branch and too long to repurpose)
function keepLookingTeamArena(
    snapshot: DocumentSnapshot,
    deadlineMs: number,
    ): Promise<void> {
  return new Promise(resolve => {
    if (Date.now() < deadlineMs) {
      setTimeout(async () => {
        await snapshot.ref.update({
          timesChecked: admin.firestore.FieldValue.increment(1),
        });
        resolve();
      }, 10000);
    } else {
      resolve();
    }
  });
}

/**
 * Team arena variant of lookForFinishedGame: the dispatched roster is
 * immutable on the game doc, the winning team comes from the replay's real
 * team outcome (not the individual leaderboard), and the locked
 * arenaPlaying names are released exactly once, whether the game scores or
 * is cancelled.
 */
async function lookForFinishedTeamArenaGame(
    snapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    event: IArenaEvent,
    timesChecked: number,
    ): Promise<any> {
  const game = (snapshot.data() || {}) as IGame;
  const players = game.players || [];
  const {replayId, started} = game;

  // a resolved game is terminal: never refetch, retry, or re-release
  if (game.status === GameStatus.FINISHED ||
      game.status === GameStatus.CANCELLED) {
    return;
  }

  // replays for games played inside the event window are looked for until
  // 20 minutes after the arena itself ends; hitting the deadline cancels
  // the game instead of leaving its players locked forever
  const deadline = event.endTime + REPLAY_GRACE_MS;
  if (Date.now() >= deadline) {
    console.log(`team arena game ${snapshot.id} passed the replay ` +
        'deadline, cancelling and releasing players');
    return db.runTransaction(async tx => {
      const gameSnap = await tx.get(snapshot.ref);
      if (!gameSnap.exists) return;
      const current = gameSnap.data() as IGame;
      if (current.status === GameStatus.FINISHED ||
          current.status === GameStatus.CANCELLED) {
        return;  // already resolved concurrently; never decrement twice
      }
      // delete the pending redirect in the same transaction so a stale
      // acknowledgement can never launch a cancelled game
      tx.delete(eventRef.collection('redirect').doc(snapshot.id));
      tx.update(eventRef, {
        ongoingGameCount: admin.firestore.FieldValue.increment(-1),
        arenaPlaying: admin.firestore.FieldValue.arrayRemove(...players),
      });
      tx.update(snapshot.ref, {status: GameStatus.CANCELLED});
    });
  }

  // the dispatch-time configuration snapshot is authoritative: edits to
  // the event after dispatch can never invalidate a live game's contract
  const server = game.server ?? event.server;

  if (!replayId && players.length) {
    const trackedReplays = event.replays || [];
    const replays = await getReplaysForPlayers(
        players, trackedReplays, game.started, server);

    // candidates are deduped and must post-date the lobby creation and
    // carry the exact dispatched roster (a short-handed team means fewer
    // than the nominal gameSize names); an already-tracked or invalid
    // candidate is skipped rather than blocking a later valid one
    const expected = new Set(players);
    const seen = new Set<string>();
    const candidates = replays.filter(replay => {
      if (!replay || seen.has(replay.id)) return false;
      seen.add(replay.id);
      return replay.started >= game.started &&
          replay.ranking.length === players.length &&
          replay.ranking.every(entry => expected.has(entry.name));
    });

    for (const candidate of candidates) {
      console.log(`${candidate.id} matches the dispatched roster`);
      try {
        const resolved = await saveTeamArenaReplayToGame(
            candidate.id, candidate.started, snapshot, eventRef, event);
        if (resolved) {
          return;
        }
        // claimed concurrently by a different game while this one is still
        // unresolved: keep trying the remaining candidates
        console.log(`${candidate.id} already claimed by another game`);
      } catch (error) {
        // an options/partition mismatch only disqualifies this candidate;
        // a later replay may still be the real one
        console.log(`${candidate.id} rejected: ${error}`);
      }
    }
    await keepLookingTeamArena(snapshot, deadline);
  } else if (!game.replay && (replayId && started)) {
    const resolved = await saveTeamArenaReplayToGame(
        replayId, started, snapshot, eventRef, event);
    if (!resolved) {
      await keepLookingTeamArena(snapshot, deadline);
    }
  }
}

/**
 * Scores a dispatched team arena game from its replay and applies the
 * results in a single idempotent transaction: replay tracking, counters,
 * records, player points, fixed-team totals, and the arenaPlaying release
 * all commit together, and a retry or concurrent trigger that finds the
 * replay already applied is a no-op.
 */
async function saveTeamArenaReplayToGame(
    replayId: string,
    started: number,
    gameSnapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    event: IArenaEvent,
    ): Promise<boolean> {
  const game = (gameSnapshot.data() || {}) as IGame;
  const arenaTeams = game.arenaTeams || [];
  const players = game.players || [];

  console.log(`getting team arena replay stats for ${replayId}`);

  // the dispatch-time configuration snapshot on the game doc is
  // authoritative; an event edited after dispatch can never invalidate the
  // contract its lobby was configured with
  const gameOptions = game.options ?? event.options;
  const gameServer = game.server ?? event.server;

  // validates the replay's modifiers against the dispatched config and its
  // decoded roster against the dispatched teams before any writes happen
  const {scores, summary, turns, elapsedMs, teamOutcomes} =
      await simulator.getTeamArenaReplayStats(
          replayId, gameServer, gameOptions, arenaTeams);

  const speed = gameOptions?.speed ?? GameSpeed.SPEED_1X;
  const finished = getFinishedTime(started, turns, speed, elapsedMs);
  const afterTime = finished !== null && event.endTime < finished;

  // duration bonus window: no bonus past the deadline or when a legacy
  // clock replay has an unknown duration; otherwise use the exact elapsed
  // time, or the turn count scaled by the configured game speed
  const speedFactor = parseFloat(gameOptions?.speed || '1x') || 1;
  const durationMinutes = afterTime ? 0 :
      elapsedMs === undefined ? Math.floor(turns / (60 * speedFactor)) :
      (elapsedMs === null ? 0 : Math.floor(elapsedMs / 60000));

  const outcomes = teamOutcomes || [];
  const {teams: scoredTeams, scores: scoredPlayers} =
      TeamArena.scoreTeamArena(arenaTeams, scores, outcomes,
          durationMinutes);
  const pointsByTeamId = new Map<string, number>();
  const rankById = new Map<string, number>();
  for (const team of scoredTeams) {
    pointsByTeamId.set(team.id, team.points);
    rankById.set(team.id, team.rank);
  }
  const teamIdByName = new Map<string, string>();
  for (const team of arenaTeams) {
    for (const name of team.players) {
      teamIdByName.set(name, team.id);
    }
  }

  console.log('committing team arena results...');
  return db.runTransaction(async tx => {
    const gameSnap = await tx.get(gameSnapshot.ref);
    if (!gameSnap.exists) return true;  // timed out or removed
    const eventSnap = await tx.get(eventRef);
    const freshGame = (gameSnap.data() || {}) as IGame;
    const freshEvent = (eventSnap.data() || {}) as IArenaEvent;

    // resolved: a retry, a concurrent trigger, or a stale trigger on a
    // cancelled game finds nothing left to do
    if (freshGame.status === GameStatus.FINISHED ||
        freshGame.status === GameStatus.CANCELLED) {
      console.log(`${replayId} already resolved for ${gameSnapshot.id}`);
      return true;
    }
    // claimed: the replay was already applied to a different game while
    // this one is still unresolved; the caller must keep searching
    if ((freshEvent.replays || []).includes(replayId)) {
      console.log(`${replayId} already claimed by another game`);
      return false;
    }

    // all reads before writes
    const playerDocs = new Map<string, admin.firestore.DocumentSnapshot>();
    for (const player of scoredPlayers) {
      playerDocs.set(player.name,
          await tx.get(eventRef.collection('players').doc(player.name)));
    }

    const eventUpdate: {[key: string]: any} = {
      replays: admin.firestore.FieldValue.arrayUnion(replayId),
      completedGameCount: admin.firestore.FieldValue.increment(1),
      ongoingGameCount: admin.firestore.FieldValue.increment(-1),
      arenaPlaying: admin.firestore.FieldValue.arrayRemove(...players),
    };

    const finalScores: any[] =
        scoredPlayers.map((player: any) => ({...player}));
    const finalPointsByName = new Map<string, number>();
    for (const player of scoredPlayers) {
      const playerDoc = playerDocs.get(player.name);
      if (!playerDoc || !playerDoc.exists) continue;
      const playerRef = eventRef.collection('players').doc(player.name);

      const record = {
        replayId,
        started,
        finished: getFinishedTime(started, player.lastTurn, speed,
            player.elapsedMs ?? elapsedMs),
        ...player,
        teamId: teamIdByName.get(player.name),
      };

      const history =
          (((playerDoc.data() || {}) as ILeaderboardPlayer).record || [])
              .map(existing => ({...existing}));
      const sanity = recordSanityCheck(
          [...history, record], event, (playerDoc.data() || {}).dq);
      const finalized = sanity.record!.find(
          r => r.replayId === replayId) || record;
      const scoreIndex =
          finalScores.findIndex((s: any) => s.name === player.name);
      finalScores[scoreIndex] = {...finalScores[scoreIndex],
          points: finalized.points, streak: finalized.streak};
      finalPointsByName.set(player.name, finalized.points);

      tx.set(eventRef.collection('records').doc(
          `${replayId}_${player.name}`), finalized);

      // shared team points plus the personal streak the history earns
      tx.update(playerRef, {
        points: sanity.points,
        currentStreak: sanity.currentStreak,
        record: sanity.record,
      });
    }

    // BYP fixed teams accumulate totals once per game; random-partner
    // games have no standing teams to update
    const bringYourPartner = event.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER;
    if (bringYourPartner && Array.isArray(freshEvent.arenaTeams)) {
      const playedById = new Map(arenaTeams.map(team => [team.id, team]));
      eventUpdate.arenaTeams = freshEvent.arenaTeams.map(team => {
        const played = playedById.get(team.id);
        if (!played) return team;
        const base = pointsByTeamId.get(team.id) || 0;
        const shared = scoredTeams.length === 2 &&
            played.players.every(name =>
                finalPointsByName.get(name) === base * 2) ?
            base * 2 : base;
        return {
          ...team,
          points: (team.points || 0) + shared,
          games: (team.games || 0) + 1,
          wins: (team.wins || 0) + (rankById.get(team.id) === 1 ? 1 : 0),
          participants: Array.from(new Set([
            ...(team.participants || []), ...played.players])),
        };
      });
    }
    // delete the consumed redirect in the same transaction so a stale
    // acknowledgement can never launch an already-scored game
    tx.delete(eventRef.collection('redirect').doc(gameSnapshot.id));
    tx.update(eventRef, eventUpdate);

    tx.update(gameSnapshot.ref, {
      replayId,
      started,
      finished,
      ...(elapsedMs !== undefined ? {elapsedMs} : {}),
      replay: {
        scores: finalScores,
        teams: scoredTeams,
        summary,
        turns,
        teamOutcomes: outcomes,
        ...(elapsedMs !== undefined ? {elapsedMs} : {}),
      },
      status: GameStatus.FINISHED,
    });
    return true;
  });
}
