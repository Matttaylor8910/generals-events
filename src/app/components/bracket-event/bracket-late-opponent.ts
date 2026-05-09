import {isEqual, sortBy} from 'lodash';
import {
  IDoubleEliminationBracket,
  IBracketMatch,
  IMatchTeam,
  MatchStatus,
  MatchTeamStatus,
} from 'types';

/**
 * Where a winners bracket R1 match feeds from winners R0 (mirrors advanceWinningTeam).
 */
export function getWinnersNextSlot(
    matchIdx: number,
    round0MatchCount: number,
    round1MatchCount: number,
): {matchIdx: number; teamIdx: number} {
  if (round0MatchCount === round1MatchCount) {
    return {matchIdx, teamIdx: 0};
  }
  return {
    matchIdx: Math.floor(matchIdx / 2),
    teamIdx: matchIdx % 2,
  };
}

function sameTeamPlayers(a?: IMatchTeam, b?: IMatchTeam): boolean {
  if (!a?.players?.length || !b?.players?.length) {
    return false;
  }
  return isEqual(sortBy(a.players), sortBy(b.players));
}

export interface LateByeEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Admin-only: whether we can add a late opponent to a round-1 bye that already
 * advanced into round 2.
 */
export function getLateByeOpponentEligibility(
    bracket: IDoubleEliminationBracket|undefined,
    roundIdx: number,
    matchIdx: number,
    bracketName: string,
    match: IBracketMatch,
    eventEnded: boolean,
): LateByeEligibility {
  if (eventEnded) {
    return {eligible: false, reason: 'Event is already finished.'};
  }
  if (!bracket?.winners?.[0] || !bracket.winners[1]) {
    return {eligible: false, reason: 'Bracket is missing winners rounds.'};
  }
  if (bracketName !== 'winners' || roundIdx !== 0) {
    return {eligible: false, reason: 'Only for round 1 in the winners bracket.'};
  }
  if (match.status !== MatchStatus.COMPLETE || !match.bye) {
    return {eligible: false, reason: 'Match is not a completed bye.'};
  }
  if (match.teams.length !== 1) {
    return {eligible: false, reason: 'Expected a single-player bye match.'};
  }

  const w0len = bracket.winners[0].matches.length;
  const w1len = bracket.winners[1].matches.length;
  const slot = getWinnersNextSlot(matchIdx, w0len, w1len);
  const next = bracket.winners[1].matches[slot.matchIdx];
  if (!next) {
    return {eligible: false, reason: 'Next match not found.'};
  }
  if (next.status === MatchStatus.COMPLETE) {
    return {
      eligible: false,
      reason: 'The next winners match is already complete — cannot undo.',
    };
  }
  const results = bracket.results[String(next.number)];
  if (results && (results.team1Score > 0 || results.team2Score > 0)) {
    return {
      eligible: false,
      reason: 'The next match already has recorded games.',
    };
  }
  const fedTeam = next.teams[slot.teamIdx];
  if (!sameTeamPlayers(match.teams[0], fedTeam)) {
    return {
      eligible: false,
      reason: 'Bracket does not look like a bye feed-through (mismatch).',
    };
  }
  return {eligible: true};
}

export type LateOpponentApplyResult = {
  ok: true;
  downstreamMatchNumber: number;
}|{
  error: string;
};

/**
 * Mutates `bracket` in place. Caller should pass a deep clone of the event
 * bracket.
 */
export function applyLateOpponentToWinnersBye(
    bracket: IDoubleEliminationBracket,
    matchIdx: number,
    newPlayerName: string,
): LateOpponentApplyResult {
  const match = bracket.winners[0].matches[matchIdx];
  const elig = getLateByeOpponentEligibility(
      bracket, 0, matchIdx, 'winners', match, false);
  if (!elig.eligible) {
    return {error: elig.reason ?? 'Not eligible.'};
  }

  const w = bracket.winners;
  const slot = getWinnersNextSlot(
      matchIdx, w[0].matches.length, w[1].matches.length);
  const r0 = w[0].matches[matchIdx];
  const next = w[1].matches[slot.matchIdx];

  const existing = r0.teams[0];
  existing.status = MatchTeamStatus.UNDECIDED;
  existing.score = 0;

  r0.teams = [
    existing,
    {
      name: newPlayerName,
      players: [newPlayerName],
      score: 0,
      status: MatchTeamStatus.UNDECIDED,
      dq: false,
    },
  ];
  r0.bye = false;
  r0.status = MatchStatus.NOT_STARTED;

  next.teams[slot.teamIdx] = {};
  next.status = MatchStatus.NOT_STARTED;
  for (const t of next.teams) {
    if (t?.name) {
      t.score = 0;
      t.status = MatchTeamStatus.UNDECIDED;
    }
  }
  next.bye = false;

  w[0].complete = false;
  w[1].complete = false;

  return {ok: true, downstreamMatchNumber: next.number};
}
