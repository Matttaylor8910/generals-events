import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {EventFormat, EventType, IArenaEvent, IDoubleElimEvent, IEvent, ILeaderboardPlayer, ILeaderboardPlayerStats, IPlayerHistoryRecord, Visibility} from '../../../../types';
import {getCurrentStars} from '../../util/generals';
import * as TeamArena from '../../util/TeamArena';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onUpdatePlayer =
    functions.firestore.document('events/{eventId}/players/{playerId}')
        .onUpdate(async (doc, context) => {
          console.log(`${doc.after.id} updated`);
          const player = doc.after.data() as ILeaderboardPlayer;
          const playerRef = doc.after.ref;
          const eventSnap = await playerRef.parent.parent!.get();
          const event = (eventSnap.data() || {}) as IArenaEvent;

          const currentStars =
              await getCurrentStars(player.name, event.type, event.server);
          const eventWins = await getEventWins(player.name, event.type);

          // support dq for Multi-Stage Events
          const messageRef = db.collection('events')
              .doc(event.parentId || context.params.eventId)
              .collection('messages').doc();

          return db.runTransaction(async tx => {
            const playerSnap = await tx.get(playerRef);
            if (!playerSnap.exists) return;
            const eventTxSnap = await tx.get(playerRef.parent.parent!);
            const current = playerSnap.data() as ILeaderboardPlayer;
            const freshEvent = (eventTxSnap.data() || {}) as IArenaEvent;

            const updates: Partial<ILeaderboardPlayer> =
                recordSanityCheck(
                    (current.record || []).map(existing => ({...existing})),
                    freshEvent, current.dq);

            const totalSeedPoints = getTSP(freshEvent, current);
            console.log(`${current.name} has ${totalSeedPoints} TSP`);

            // generate some stats from the current record
            updates.stats = {
              eventWins,
              currentStars,
              totalSeedPoints,
              ...getStats(updates.record!),
            } as ILeaderboardPlayerStats;

            // if this player just got disqualied, update their doc and send a
            // message to the chat to let people know
            if (updates.dq && !current.dq) {
              // TODO: support dq for multiple reasons
              const reason = 'playing in multiple games at once';
              tx.set(messageRef, {
                sender: 'Automated Message',
                text: `${current.name} has been disqualified for ${reason}.`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                color: 'red',
              });
            }

            tx.update(playerRef, updates);
          });
        });

export function recordSanityCheck(
    record: IPlayerHistoryRecord[],
    event: IArenaEvent,
    currentDq = false,
    ): Partial<ILeaderboardPlayer> {
  // sort by finish time, falling back to start time for records whose finish
  // is unknown (legacy Chess Clock replays)
  record.sort((a, b) => (a.finished ?? a.started) - (b.finished ?? b.started));
  let dq = currentDq;

  // compare the original and the newly sorted games in the record to see if
  // there are any streaks/points to fix up
  let currentStreak = 0;
  let i = 0;
  while (i < record.length) {
    const game = record[i];
    const nextGame = record[i + 1];

    // accidental dupe, skip it
    if (game.replayId === nextGame?.replayId) {
      record.splice(i, 1); 
      continue;
    }

    // keep track of current streak
    const winner = record[i].rank === 1;
    if (winner) {
      currentStreak++;
    } else {
      currentStreak = 0;
    }

    // only records tagged as two-team games streak; untagged keep the legacy event rule
    const streakEligible = game.teamCount !== undefined ?
        game.teamCount === 2 :
        event.type !== EventType.FFA && !TeamArena.isTeamArena(event);
    if (!streakEligible) {
      // do nothing
    }
    // if this player should be on a streak, but their record indicates they are
    // not, fix the streak and double their points
    else if (currentStreak >= 3 && !game.streak) {
      console.log('should be on a streak, but they are not');
      game.streak = true;
      game.points *= 2;
    }
    // if this player is shouldn't be on a streak, but their record indicates
    // they are, fix the streak and halve their points
    else if (currentStreak < 3 && game.streak) {
      console.log('shouldn\'t be on a streak, but they are');
      game.streak = false;
      game.points /= 2;
    }
    // this player's streak and points should be correct for this game
    else {
      // do nothing
    }

    // finally increment to check the next record
    i++;
  }

  // overlap detection runs on a copy ordered by start time, independently
  // of the finish-sorted record above: an unknown-finish record sorted
  // between two known games by finish time would otherwise mask their
  // overlap. Only a finite known finish can close an interval, so a legacy
  // clock record with an unknown finish still can never end an interval —
  // but a later game that started while a known-finish game was still
  // running is unambiguously overlapping
  const byStart = record.slice().sort((a, b) => a.started - b.started);
  for (let i = 0; i + 1 < byStart.length; i++) {
    const game = byStart[i];
    const nextGame = byStart[i + 1];
    if (Number.isFinite(game.finished) &&
        game.replayId !== nextGame.replayId &&
        nextGame.started < (game.finished as number)) {
      console.log(`${game.replayId} overlaps with ${nextGame.replayId}`);
      dq = true;
    }
  }

  return {
    dq,
    record,
    currentStreak,
    points: record.map(r => r.points).reduce((a, b) => a + b, 0),
  };
}

function getStats(record: IPlayerHistoryRecord[]):
    Partial<ILeaderboardPlayerStats> {
  const totalGames = record.length;
  const wins = record.filter(r => r.rank === 1);
  const totalWins = wins.length;
  const totalDeaths = totalGames - totalWins;

  // wins / totalGames
  const winRate = totalGames > 0 ? totalWins / totalGames : 0;

  // find the quickest win (fewest turns), or null
  wins.sort((a, b) => a.lastTurn - b.lastTurn);
  const quickestWin = wins[0]?.lastTurn || null;
  const totalWinTurns = wins.map(w => w.lastTurn).reduce((a, b) => a + b, 0);

  // calculate some additional stats
  let totalKills = 0;
  let totalTurns = 0;
  let totalRank = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let perfectStarts = 0;
  let totalTiles = 0;

  for (const game of record) {
    totalKills += game.kills;
    totalTurns += game.lastTurn;
    totalRank += game.rank;

    // streaks
    currentStreak = game.rank === 1 ? currentStreak + 1 : 0;
    if (currentStreak > longestStreak) longestStreak = currentStreak;
    
    // tiles after first round
    totalTiles += game.tilesAfterFirstRound;
    if (game.tilesAfterFirstRound === 25) perfectStarts++;
  }

  return {
    totalGames,
    totalWins,
    winRate,
    longestStreak,
    quickestWin,
    perfectStarts,
    averageOpening: totalTiles > 0 ? totalTiles / totalGames : null,
    averageWin: totalWins > 0 ? totalWinTurns / totalWins : null,
    averageKills: totalGames > 0 ? totalKills / totalGames : null,
    averageTurns: totalGames > 0 ? totalTurns / totalGames : null,
    averageRank: totalGames > 0 ? totalRank / totalGames : null,
    killDeathRatio: totalGames > 0 ? totalKills / totalDeaths : null,
  };
}

function getTSP(event: IEvent, player: ILeaderboardPlayer) {
  if (event.format === EventFormat.DOUBLE_ELIM) {
    const {tsp} = event as IDoubleElimEvent;

    // in the case that the TSP map is set on the event document, fetch this
    // player's total seed points value
    // note: the tsp map will only include this player's TSP if they qualify
    if (tsp !== undefined) {
      const totalSeedPoints = tsp[`PLAYER${player.name}`];
      if (totalSeedPoints >= 0) {
        return totalSeedPoints;
      }
    }
  }
  return null;
}

async function getEventWins(name: string, type: EventType): Promise<number> {
  const snapshot = await db.collection('events')
                    .where('winners', 'array-contains', name)
                    .where('type', '==', type)
                    .get();

  return snapshot.docs.filter(doc => {
    const event = doc.data() as IEvent;

    // filter out customs events and private events
    return !event.parentId && event.visibility === Visibility.PUBLIC;
  }).length;
}
