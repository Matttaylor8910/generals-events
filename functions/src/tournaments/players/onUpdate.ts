import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {cloneDeep} from 'lodash';

import {ILeaderboardPlayer, ILeaderboardPlayerStats, IPlayerHistoryRecord, ITournament, TournamentType} from '../../../../types';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}

export const onUpdatePlayer =
    functions.firestore
        .document('tournaments/{tournamentId}/players/{playerId}')
        .onUpdate(async (doc, context) => {
          const player = doc.after.data() as ILeaderboardPlayer;
          const tournamentSnap = await doc.after.ref.parent.parent!.get();
          const tournament = (tournamentSnap.data() || {}) as ITournament;

          const {updated, record, currentStreak, points} =
              recordSanityCheck(player.record, tournament);

          const updates: Partial<ILeaderboardPlayer> = {
            stats: getStats(record),
          };

          if (updated) {
            updates.record = record;
            updates.currentStreak = currentStreak;
            updates.points = points;
          }

          return doc.after.ref.update(updates);
        });

export function recordSanityCheck(
    record: IPlayerHistoryRecord[], tournament: ITournament): {
  updated: boolean,
  record: IPlayerHistoryRecord[],
  currentStreak: number,
  points: number,
} {
  const original = cloneDeep(record);
  record.sort((a, b) => a.finished - b.finished);
  let updated = false;

  // compare the original and the newly sorted games in the record to see if
  // there are any streaks/points to fix up
  let currentStreak = 0;
  for (let i = 0; i < record.length; i++) {
    // keep track of current streak
    const winner = record[i].rank === 1;
    if (winner) {
      currentStreak++;
    } else {
      currentStreak = 0;
    }

    // if the game in this position differs, mark the updated flag to true
    if (original[i].replayId !== record[i].replayId) updated = true;

    // FFA doesn't do streaks right now
    if (tournament.type === TournamentType.FFA) {
      // do nothing
    }
    // if this player should be on a streak, but their record indicates they are
    // not, fix the streak and double their points
    else if (currentStreak >= 3 && !record[i].streak) {
      record[i].streak = true;
      record[i].points *= 2;
      updated = true;
    }
    // if this player is currently not on a streak, but their record indicates
    // they are, fix the streak and halve their points
    else if (currentStreak < 3 && record[i].streak) {
      record[i].streak = false;
      record[i].points /= 2;
      updated = true;
    }
    // this player's streak and points should be correct for this game
    else {
      // do nothing
    }
  }

  return {
    updated,
    record,
    currentStreak,
    points: record.map(r => r.points).reduce((a, b) => a + b, 0),
  };
}

function getStats(record: IPlayerHistoryRecord[]): ILeaderboardPlayerStats {
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
  let longestStreak = 0;
  let currentStreak = 0;
  for (const game of record) {
    totalKills += game.kills;
    totalTurns += game.lastTurn;
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
    killDeathRatio: totalGames > 0 ? totalKills / totalDeaths : null,
  };
}