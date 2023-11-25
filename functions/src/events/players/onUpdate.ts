import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {EventFormat, EventType, IArenaEvent, IDoubleElimEvent, IEvent, ILeaderboardPlayer, ILeaderboardPlayerStats, IPlayerHistoryRecord, Visibility} from '../../../../types';
import {getCurrentStars} from '../../util/generals';

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
          const eventSnap = await doc.after.ref.parent.parent!.get();
          const event = (eventSnap.data() || {}) as IArenaEvent;

          const updates: Partial<ILeaderboardPlayer> =
              recordSanityCheck(player.record, event, player.dq);

          const currentStars =
              await getCurrentStars(player.name, event.type, event.server);
          const eventWins = await getEventWins(player.name, event.type);

          const totalSeedPoints = getTSP(event, player);
          console.log(`${player.name} has ${totalSeedPoints} TSP`);

          // generate some stats from the current record
          updates.stats = {
            eventWins,
            currentStars,
            totalSeedPoints,
            ...getStats(updates.record!),
          } as ILeaderboardPlayerStats;

          // if this player just got disqualied, update their doc and send a
          // message to the chat to let people know
          if (updates.dq && !player.dq) {
            // TODO: support dq for multiple reasons
            const reason = 'playing in multiple games at once';

            // support dq for Multi-Stage Events
            const eventRef = db.collection('events').doc(event.parentId || context.params.eventId);
            await eventRef.collection('messages').add({
              sender: 'Automated Message',
              text: `${player.name} has been disqualified for ${reason}.`,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              color: 'red',
            });
          }

          return doc.after.ref.update(updates);
        });

export function recordSanityCheck(
    record: IPlayerHistoryRecord[],
    event: IArenaEvent,
    currentDq = false,
    ): Partial<ILeaderboardPlayer> {
  record.sort((a, b) => a.finished - b.finished);
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

    // FFA doesn't do streaks right now
    if (event.type === EventType.FFA) {
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

    // this player played in two games at the same time, disqualify them
    if (nextGame?.started < game.finished) {
      console.log(`${game.replayId} overlaps with ${nextGame.replayId}`);
      dq = true;
    }

    // finally increment to check the next record
    i++;
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