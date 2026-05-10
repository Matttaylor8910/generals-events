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

/**
 * Same bracket side after a bye advance — Firestore/clients sometimes have only
 * `name` or only `players`; 1v1 should still match.
 */
export function teamsMatchByeFeed(r0: IMatchTeam, fed?: IMatchTeam): boolean {
  if (!fed || !r0) {
    return false;
  }
  if (sameTeamPlayers(r0, fed)) {
    return true;
  }
  const a = r0.name?.trim();
  const b = fed.name?.trim();
  if (a && b && a === b) {
    return true;
  }
  const rp = r0.players?.[0];
  const fp = fed.players?.[0];
  if (rp && fp && rp === fp) {
    return true;
  }
  if (a && fp && a === fp) {
    return true;
  }
  if (rp && b && rp === b) {
    return true;
  }
  return false;
}

/**
 * Locate where the bye-advanced team sits in winners round 2 (full scan —
 * formula slot can disagree with real data in edge cases).
 */
function findFedTeamPlacementInWinners1(
    bracket: IDoubleEliminationBracket,
    r0Team: IMatchTeam,
): {next: IBracketMatch; fedSlot: number}|null {
  for (const m of bracket.winners[1].matches) {
    for (let i = 0; i < m.teams.length; i++) {
      if (teamsMatchByeFeed(r0Team, m.teams[i])) {
        return {next: m, fedSlot: i};
      }
    }
  }
  return null;
}

/**
 * When round 1 is not finished but someone from this match still appears in
 * winners round 2 (stale bye feed), offer a one-click cleanup.
 */
export function hasPrematureFeedInWinners1(
    bracket: IDoubleEliminationBracket|undefined,
    match: IBracketMatch,
): boolean {
  if (!bracket?.winners?.[1] || match.status === MatchStatus.COMPLETE) {
    return false;
  }
  for (const t of match.teams) {
    if (findFedTeamPlacementInWinners1(bracket, t)) {
      return true;
    }
  }
  return false;
}

/**
 * Clear any of this match's teams that still appear in winners round 2 while
 * this match is not complete (fixes stuck bye fallout after a bad clear slot).
 */
export function repairPrematureFeedsFromWinners1(
    bracket: IDoubleEliminationBracket,
    r0MatchIdx: number,
): {ok: true; touchedMatchNumbers: number[]}|{error: string} {
  const r0 = bracket.winners[0].matches[r0MatchIdx];
  if (r0.status === MatchStatus.COMPLETE) {
    return {error: 'This round 1 match is already complete.'};
  }

  const touched = new Set<number>();

  for (const team of r0.teams) {
    const p = findFedTeamPlacementInWinners1(bracket, team);
    if (!p) {
      continue;
    }
    const results = bracket.results[String(p.next.number)];
    if (results &&
        (results.team1Score > 0 || results.team2Score > 0)) {
      return {
        error: `Match ${p.next.number} already has recorded games — stop and fix manually.`,
      };
    }
    p.next.teams[p.fedSlot] = {};
    p.next.status = MatchStatus.NOT_STARTED;
    for (const t of p.next.teams) {
      if (t?.name) {
        t.score = 0;
        t.status = MatchTeamStatus.UNDECIDED;
      }
    }
    p.next.bye = false;
    touched.add(p.next.number);
  }

  bracket.winners[0].complete = false;
  bracket.winners[1].complete = false;

  if (!touched.size) {
    return {error: 'No extra feed-through from this match was found.'};
  }
  return {ok: true, touchedMatchNumbers: [...touched]};
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

  const placement =
      findFedTeamPlacementInWinners1(bracket, match.teams[0]);
  if (!placement) {
    return {
      eligible: false,
      reason: 'Could not find this player in winners round 2 (nothing to pull back).',
    };
  }
  const next = placement.next;
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
  const r0 = w[0].matches[matchIdx];
  const place = findFedTeamPlacementInWinners1(bracket, r0.teams[0]);
  if (!place) {
    return {
      error: 'Could not find this player in winners round 2 — fix manually or retry.',
    };
  }
  const next = place.next;

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

  next.teams[place.fedSlot] = {};
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
