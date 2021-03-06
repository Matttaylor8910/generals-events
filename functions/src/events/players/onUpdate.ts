import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {EventType, IArenaEvent, ILeaderboardPlayer, ILeaderboardPlayerStats, IPlayerHistoryRecord} from '../../../../types';
import {getCurrentStars} from '../../util/generals';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}

export const onUpdatePlayer =
    functions.firestore.document('events/{eventId}/players/{playerId}')
        .onUpdate(async (doc, context) => {
          console.log(`${doc.after.id} updated`);
          const player = doc.after.data() as ILeaderboardPlayer;
          const eventSnap = await doc.after.ref.parent.parent!.get();
          const event = (eventSnap.data() || {}) as IArenaEvent;

          const updates: Partial<ILeaderboardPlayer> =
              recordSanityCheck(player.record, event);

          const currentStars =
              await getCurrentStars(player.name, event.type, event.server);

          // generate some stats from the current record
          updates.stats = {
            currentStars,
            ...getStats(updates.record!),
          } as ILeaderboardPlayerStats;

          // if this player just got disqualied, update their doc and send a
          // message to the chat to let people know
          if (updates.dq && !player.dq) {
            // TODO: support dq for multiple reasons
            const reason = 'playing in multiple games at once';
            await eventSnap.ref.collection('messages').add({
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
    ): Partial<ILeaderboardPlayer> {
  record.sort((a, b) => a.finished - b.finished);
  let dq = false;

  // compare the original and the newly sorted games in the record to see if
  // there are any streaks/points to fix up
  let currentStreak = 0;
  let nextGame: IPlayerHistoryRecord;
  for (let i = 0; i < record.length; i++) {
    const game = record[i];
    nextGame = record[i + 1];

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
  for (const game of record) {
    totalKills += game.kills;
    totalTurns += game.lastTurn;
    totalRank += game.rank;
    currentStreak = game.rank === 1 ? currentStreak + 1 : 0;
    if (currentStreak > longestStreak) longestStreak = currentStreak;
  }

  return {
    totalGames,
    totalWins,
    winRate,
    longestStreak,
    quickestWin,
    averageWin: totalWins > 0 ? totalWinTurns / totalWins : null,
    averageKills: totalGames > 0 ? totalKills / totalGames : null,
    averageTurns: totalGames > 0 ? totalTurns / totalGames : null,
    averageRank: totalGames > 0 ? totalRank / totalGames : null,
    killDeathRatio: totalGames > 0 ? totalKills / totalDeaths : null,
  };
}