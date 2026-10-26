import * as admin from 'firebase-admin';

import {isTeamArena, rankArenaTeams, validateTeamArenaConfig} from '../../../team-arena';
import {DoublesPairingStrategy, IArenaEvent, IArenaTeam, ILeaderboardPlayer} from '../../../types';

const MAX_TEAM_NAME = 20;
const READY_TTL_MS = 90 * 1000;

/**
 * Backend team arena operations. Identical transaction logic to the
 * retired client service, but the caller is the authenticated username
 * and organizer authority comes from the Firestore admins document,
 * never client claims or constants.
 */
export class TeamArenaOperations {
  private db: admin.firestore.Firestore;
  constructor(
      db: admin.firestore.Firestore,
      private readonly caller: string,
      private readonly organizer: boolean,
  ) {
    this.db = db;
  }

  /**
   * Register the caller for a team arena. Idempotent create/reactivate: a
   * missing registration is created, a withdrawn one rejoins with all
   * stored stats intact, an active one is a no-op. New and rejoining
   * players respect disableJoin and a finished/finalized event; DQ is
   * never reset by registering again.
   */
  register(eventId: string): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const playerRef = eventRef.collection('players').doc(this.caller);
    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      if (!eventDoc.exists || !isTeamArena(event)) {
        throw new Error('Not a team arena event');
      }
      if (Date.now() >= event.endTime || event.winners?.length) {
        throw new Error('This event has ended');
      }
      const playerDoc = await tx.get(playerRef);
      if (!playerDoc.exists) {
        if (event.disableJoin) {
          throw new Error('New players cannot join this event');
        }
        tx.set(playerRef, {
          name: this.caller,
          rank: 0,
          points: 0,
          currentStreak: 0,
          dq: false,
          withdrawn: false,
          record: [],
        });
      } else {
        const player = playerDoc.data() as ILeaderboardPlayer | undefined;
        if (!player || player.name !== this.caller) {
          throw new Error('Malformed registration');
        }
        if (player.dq) {
          throw new Error('Disqualified players cannot register');
        }
        if (player.withdrawn) {
          if (event.disableJoin) {
            throw new Error('New players cannot join this event');
          }
          tx.update(playerRef, {withdrawn: false});
        }
      }
      // an already-active registration is a no-op; DQ is never cleared
    });
  }

  /**
   * Create a bring-your-partner team captained by the caller. Team ids come
   * from the event's monotonically increasing arenaTeamNumber, so a founder
   * who transfers captaincy can still create a new team later.
   */
  createTeam(eventId: string, teamName: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      context.assertCallerIdle();

      if (context.teamOf(context.caller)) {
        throw new Error('You are already on a team');
      }

      const number = (context.event.arenaTeamNumber || 0) + 1;
      const team: IArenaTeam = {
        id: `team_${number}`,
        name: (teamName || `${context.caller}'s Team`).slice(0,
            MAX_TEAM_NAME),
        captain: context.caller,
        members: [context.caller],
        requests: [],
        noShows: [],
        acceptFill: false,
        allowShortHanded: false,
        points: 0,
        games: 0,
        wins: 0,
        participants: [],
      };
      if (context.teams.some(existing => existing.id === team.id)) {
        throw new Error('Your team already exists');
      }
      context.removeFromRequests(context.caller);
      return {teams: [...context.teams, team], arenaTeamNumber: number};
    });
  }

  /** Voluntarily request to join a specific team; the captain must accept. */
  requestTeam(eventId: string, teamId: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      context.assertCallerIdle();

      const team = context.requireTeam(teamId);
      if (context.teamOf(context.caller)) {
        throw new Error('You are already on a team');
      }
      if (team.members.includes(context.caller) ||
          team.requests.includes(context.caller)) {
        throw new Error('You have already requested this team');
      }
      if (team.members.length >= context.event.teamSize!) {
        throw new Error('That team is already full');
      }
      context.assertTeamNotBusy(team);

      team.requests = [...team.requests, context.caller];
      return {teams: context.teams};
    });
  }

  /**
   * Captain accepts a player who requested to join. The player keeps
   * agency: only requested names can be added, so nobody is conscripted,
   * and a request made before the player joined another team can never be
   * used to pull them off it.
   */
  acceptPlayer(eventId: string, playerName: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      const team = context.requireCaptainTeam();

      if (!team.requests.includes(playerName)) {
        throw new Error(`${playerName} has not requested to join`);
      }
      if (team.members.length >= context.event.teamSize!) {
        throw new Error('That team is already full');
      }
      if (context.teamOf(playerName)) {
        throw new Error(`${playerName} is already on a team`);
      }

      const playerDoc = await context.playerDoc(playerName);
      context.assertEligible(playerDoc, playerName);
      context.assertIdle(playerName);

      team.requests = team.requests.filter(name => name !== playerName);
      team.members = [...team.members, playerName];
      context.removeFromRequests(playerName);
      context.clearTeamReadiness(team);
      return {teams: context.teams};
    });
  }

  /**
   * Captain updates the team name, the voluntary random-fill opt-in, or
   * the explicit short-handed opt-in. Roster-affecting changes clear team
   * readiness so every member re-confirms under the new configuration.
   */
  setTeamOptions(eventId: string, options: {
    acceptFill?: boolean,
    allowShortHanded?: boolean,
    name?: string,
  }): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      const team = context.requireCaptainTeam();

      if (options.name !== undefined) {
        team.name = (options.name || '').slice(0, MAX_TEAM_NAME) ||
            `${team.captain}'s Team`;
      }
      if (options.acceptFill !== undefined) {
        team.acceptFill = !!options.acceptFill;
      }
      if (options.allowShortHanded !== undefined) {
        team.allowShortHanded = !!options.allowShortHanded;
      }
      if (options.acceptFill !== undefined ||
          options.allowShortHanded !== undefined) {
        context.clearTeamReadiness(team);
      }
      return {teams: context.teams};
    });
  }

  /**
   * Voluntarily fill a missing slot: join a random incomplete team that
   * explicitly opted into accepting fill. A team that is queued or has a
   * member in a live game is not a fill target. Random-partner events have
   * no standing teams, so this only applies to bring-your-partner events.
   */
  joinRandomTeam(eventId: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      context.assertCallerIdle();

      if (context.teamOf(context.caller)) {
        throw new Error('You are already on a team');
      }

      // only idle, incomplete, opt-in teams are eligible; candidates are
      // revalidated against the state read inside this transaction
      const candidates = context.teams.filter(team =>
          team.acceptFill &&
          team.members.length < context.event.teamSize! &&
          !context.teamIsBusy(team));
      if (!candidates.length) {
        throw new Error('No teams are accepting fill players right now');
      }
      const team =
          candidates[Math.floor(Math.random() * candidates.length)];
      team.members = [...team.members, context.caller];
      context.removeFromRequests(context.caller);
      context.clearTeamReadiness(team);
      return {teams: context.teams};
    });
  }

  /**
   * Captain marks a member who never showed up. The name moves from
   * members to noShows; the team can then accept a voluntary fill player
   * or explicitly opt into playing short-handed. Captains cannot mark
   * themselves; transfer by leaving instead. The removed member's own
   * readiness is revoked along with the whole team's.
   */
  markNoShow(eventId: string, memberName: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      context.assertBringYourPartner();
      context.assertEventActive();
      const team = context.requireCaptainTeam();

      if (memberName === context.caller) {
        throw new Error(
            'The captain cannot be a no-show; leave or rename the team');
      }
      if (!team.members.includes(memberName)) {
        throw new Error(`${memberName} is not on your team`);
      }

      // clear readiness for the roster BEFORE the removal, so the departing
      // member's own fresh confirmation cannot leak into the next dispatch
      context.clearTeamReadiness(team);
      team.members = team.members.filter(name => name !== memberName);
      if (!team.noShows.includes(memberName)) {
        team.noShows = [...team.noShows, memberName];
      }
      return {teams: context.teams};
    });
  }

  /**
   * Caller leaves their own team. An emptied team that never played is
   * removed; a team with history stays as an archived record of its
   * points/games/participants. A departing captain passes the role to the
   * first remaining member deterministically.
   */
  leaveTeam(eventId: string): Promise<void> {
    return this.runTeamMutation(eventId, async context => {
      const team = context.teamOf(context.caller);
      if (!team) {
        return {teams: context.teams};  // not on a team, nothing to do
      }
      context.assertEventActive();
      context.assertTeamNotBusy(team);
      return {teams: this.removeMembership(context, context.caller)};
    }, true);
  }

  /**
   * Withdraw a player from the event entirely: remove them from any arena
   * team and readiness state in one transaction. A player with scored
   * history keeps their registration doc flagged withdrawn so event
   * points and records survive; only never-scored docs are deleted.
   * Caller must be the player or an admin (matches removePlayer's policy).
   */
  withdrawPlayer(eventId: string, name: string): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const caller = this.caller;
    if (!caller) {
      return Promise.reject(new Error('You must be logged in'));
    }
    if (caller !== name && !this.organizer) {
      return Promise.reject(
          new Error('You can only remove yourself from an event'));
    }

    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      const context = new TeamMutationContext(eventDoc, event, caller, tx);
      context.assertTeamArena();

      const playerRef = eventRef.collection('players').doc(name);
      const playerDoc = await tx.get(playerRef);
      if (!playerDoc.exists) {
        return;  // already withdrawn
      }
      context.assertNotPlaying(name);

      const teams = this.removeMembership(context, name);
      const update: {[key: string]: any} = {
        arenaTeams: teams,
        arenaReady: context.arenaReady,
        arenaQueueAt: context.arenaQueueAt,
      };

      // a scored registration is flagged withdrawn rather than deleted so
      // its points/records and the team's history are never erased
      const player = playerDoc.data() as ILeaderboardPlayer;
      if ((player.record || []).length || player.points) {
        tx.update(playerRef, {withdrawn: true});
      } else {
        tx.delete(playerRef);
      }
      tx.update(eventRef, update);
    });
  }

  /**
   * Shared roster removal used by leaveTeam and withdrawPlayer: drop the
   * name from members/requests/readiness, transfer the captain
   * deterministically, remove emptied never-played teams, and archive
   * emptied teams that have game history. Returns the new arenaTeams.
   */
  private removeMembership(
      context: TeamMutationContext, name: string): IArenaTeam[] {
    const team = context.teamOf(name);
    context.removeFromRequests(name);
    delete context.arenaReady[name];
    delete context.arenaQueueAt[name];

    if (!team) {
      return context.teams;
    }
    team.members = (team.members || []).filter(member => member !== name);
    context.clearTeamReadiness(team);
    if (!team.members.length) {
      // never-played empty teams disappear entirely; teams with history
      // keep their totals visible even with no members left
      if (!(team.games > 0)) {
        return context.teams.filter(existing => existing.id !== team.id);
      }
      return context.teams;
    }
    if (team.captain === name) {
      team.captain = team.members[0];
    }
    return context.teams;
  }

  /**
   * Personally confirm readiness for the next game (or withdraw it). Every
   * active member must ready themselves; readiness is a fresh timestamp and
   * expires server-side, so a stale confirmation can never queue a team.
   * The first confirmation also stamps arenaQueueAt; heartbeat renewals
   * update arenaReady only, preserving the team's queue position.
   */
  setReady(eventId: string, ready: boolean): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const caller = this.caller;
    if (!caller) {
      return Promise.reject(new Error('You must be logged in'));
    }

    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      const context = new TeamMutationContext(eventDoc, event, caller, tx);
      context.assertTeamArena();
      const playerDoc = await context.playerDoc(caller);
      context.assertEligible(playerDoc, caller);

      const arenaReady = {...(event.arenaReady || {})};
      const arenaQueueAt = {...(event.arenaQueueAt || {})};
      const playing = event.arenaPlaying || [];

      if (ready) {
        // no queueing before the event starts or at/after it ends
        const now = Date.now();
        if (!(event.startTime <= now && now < event.endTime)) {
          throw new Error('The event is not running right now');
        }
        if (event.winners?.length) {
          throw new Error('The event is already finalized');
        }
        if (playing.includes(caller)) {
          // test/team-arena.test.js 'heartbeat while already playing':
          // an authenticated ready:true renewal from a caller who was
          // dispatched between the client's last event snapshot and this
          // call is an idempotent no-op — never a queue slot, never an
          // error that kills the caller's heartbeat loop
          return;
        }
        // in bring-your-partner mode the caller must be an active member of
        // a team; random partners just need to be registered
        if (context.event.doublesPairingStrategy ===
            DoublesPairingStrategy.BRING_YOUR_PARTNER) {
          const team = context.teamOf(caller);
          if (!team) {
            throw new Error('Join or create a team first');
          }
          if (team.members.length < event.teamSize! &&
              !team.allowShortHanded) {
            throw new Error(
                'Your team is not full; opt into fill or short-handed play');
          }
        }
        // only a first confirmation claims a queue slot; a renewal while
        // still fresh keeps the original position
        const hadFresh =
            context.fresh((event.arenaReady || {})[caller]);
        arenaReady[caller] = now;
        if (!hadFresh || !Number.isFinite(arenaQueueAt[caller])) {
          arenaQueueAt[caller] = now;
        }
      } else {
        // stepping out unqueues the caller's whole BYP team and revokes the
        // team's confirmations so every member must re-confirm; allowed
        // even after the event ends so stale state can always be cleared
        delete arenaReady[caller];
        delete arenaQueueAt[caller];
        const team = context.teamOf(caller);
        if (team) {
          for (const member of team.members) {
            delete arenaReady[member];
            delete arenaQueueAt[member];
          }
        }
      }

      tx.update(eventRef, {arenaReady, arenaQueueAt});
    });
  }

  /**
   * Compute the winners once the event is over. Refuses while any
   * dispatched game is still in flight; an event nobody played gets no
   * winner. BYP ranks the standing teams, skipping any team whose
   * participating members include a DQ'd player; its winners are the
   * registered, non-DQ members who actually earned a record for that team.
   * Random partners name one individual winner from the same ordering.
   */
  finalize(eventId: string): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const caller = this.caller;
    if (!caller) {
      return Promise.reject(new Error('You must be logged in'));
    }

    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      const context = new TeamMutationContext(eventDoc, event, caller, tx);
      context.assertTeamArena();

      // organizers only; backend rules remain the real enforcement
      if (!this.organizer) {
        throw new Error('Only the event organizer can finalize');
      }
      if (event.winners?.length) {
        return;  // already finalized
      }
      const now = Date.now();
      if (now < event.endTime) {
        throw new Error('The event is still running');
      }
      if ((event.ongoingGameCount || 0) > 0) {
        throw new Error('Games are still in progress');
      }

      const playerDocOf = async (name: string) =>
          tx.get(eventRef.collection('players').doc(name));
      // a real earned participant: registered, not DQ'd, and holding a
      // record played for this team specifically
      const earned = (doc: admin.firestore.DocumentSnapshot,
          teamId?: string) => {
        const player = doc.data() as ILeaderboardPlayer;
        return doc.exists && player?.name === doc.id && !player.dq &&
            (player.record || []).some(r =>
                teamId === undefined || r.teamId === teamId);
      };

      let winners: string[] = [];
      if (event.doublesPairingStrategy ===
          DoublesPairingStrategy.BRING_YOUR_PARTNER) {
        const ranked = rankArenaTeams(
            (event.arenaTeams || []).filter(team => (team.games || 0) > 0));
        // all candidate reads happen before any write below
        const docsByTeam = new Map<string,
            admin.firestore.DocumentSnapshot[]>();
        for (const team of ranked) {
          const candidates = Array.from(new Set([
            ...(team.members || []), ...(team.participants || []),
          ]));
          docsByTeam.set(team.id, await Promise.all(
              candidates.map(name => playerDocOf(name))));
        }
        for (const team of ranked) {
          const candidates = Array.from(new Set([
            ...(team.members || []), ...(team.participants || []),
          ]));
          const docs = docsByTeam.get(team.id)!;
          // a team whose roster includes a DQ'd participant is skipped
          // entirely; the next ranked eligible team wins instead
          const anyDq = docs.some(doc => {
            const player = doc.data() as ILeaderboardPlayer;
            return doc.exists && !!player?.dq;
          });
          if (anyDq) continue;
          winners = candidates.filter((name, index) =>
              earned(docs[index], team.id));
          // a team with no eligible earners at all is skipped too: the win
          // passes down the ranking rather than producing empty winners
          if (!winners.length) continue;
          break;
        }
      } else {
        // random partners: rank individual players by points, then win
        // rate, then games, then name; exactly one individual wins
        const names = event.arenaParticipants || [];
        const docs = await Promise.all(names.map(name => playerDocOf(name)));
        const projections = docs
            .filter(doc => earned(doc))
            .map(doc => {
              const player = doc.data() as ILeaderboardPlayer;
              return {
                id: player.name,
                points: player.points || 0,
                wins: (player.record || []).filter(r => r.rank === 1).length,
                games: (player.record || []).length,
              };
            });
        const ranked = rankArenaTeams(projections as any);
        winners = ranked.length ? [ranked[0].id] : [];
      }

      tx.update(eventRef, {winners});
    });
  }

  /**
   * Shared transaction wrapper for BYP team mutations: validates the event
   * and the caller's registration, then applies the callback's new
   * arenaTeams array atomically with any readiness cleanup.
   */
  private runTeamMutation(
      eventId: string,
      apply: (context: TeamMutationContext) =>
          Promise<{teams: IArenaTeam[], arenaTeamNumber?: number}>|
          {teams: IArenaTeam[], arenaTeamNumber?: number},
      allowRandomMode = false,
      ): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const caller = this.caller;
    if (!caller) {
      return Promise.reject(new Error('You must be logged in'));
    }

    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      const playerDoc =
          await tx.get(eventRef.collection('players').doc(caller));
      const context = new TeamMutationContext(eventDoc, event, caller, tx);
      context.assertTeamArena();
      context.assertEligible(playerDoc, caller);
      if (!allowRandomMode) {
        context.assertBringYourPartner();
      }

      const result = await apply(context);
      // arenaReady/arenaQueueAt are always written from the maps read in
      // this same transaction, so membership changes and readiness cleanup
      // commit atomically and can never strand a stale queue confirmation
      const update: {[key: string]: any} = {
        arenaTeams: result.teams,
        arenaReady: context.arenaReady,
        arenaQueueAt: context.arenaQueueAt,
      };
      if (result.arenaTeamNumber !== undefined) {
        update.arenaTeamNumber = result.arenaTeamNumber;
      }
      tx.update(eventRef, update);
    });
  }
}

/**
 * Per-transaction helper bundling the event snapshot, its team list, and
 * the guards every team-arena mutation applies. Client-side consistency
 * only; the Firestore rules remain the real authorization boundary.
 */
class TeamMutationContext {
  readonly caller: string;
  readonly event: IArenaEvent;
  readonly arenaReady: {[username: string]: number};
  readonly arenaQueueAt: {[username: string]: number};
  readonly now = Date.now();

  constructor(
      private readonly eventDoc: admin.firestore.DocumentSnapshot,
      event: IArenaEvent,
      caller: string,
      private readonly tx: admin.firestore.Transaction,
  ) {
    this.event = event;
    this.caller = caller;
    this.arenaReady = {...(event?.arenaReady || {})};
    this.arenaQueueAt = {...(event?.arenaQueueAt || {})};
  }

  get teams(): IArenaTeam[] {
    return this.event.arenaTeams || [];
  }

  // a ready timestamp only counts while inside the freshness window;
  // clock-skewed future timestamps are rejected like missing ones
  fresh(timestamp: number|undefined): boolean {
    return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp <= this.now &&
        this.now - timestamp < READY_TTL_MS;
  }

  assertTeamArena() {
    if (!this.eventDoc.exists || !this.event) {
      throw new Error('Event not found');
    }
    if (!isTeamArena(this.event)) {
      throw new Error('This is not a team arena event');
    }
    validateTeamArenaConfig(this.event);
  }

  assertEventActive() {
    if (this.event.winners?.length) {
      throw new Error('The event is already finalized');
    }
    if (this.now >= this.event.endTime) {
      throw new Error('The event has ended');
    }
  }

  assertBringYourPartner() {
    if (this.event.doublesPairingStrategy !==
        DoublesPairingStrategy.BRING_YOUR_PARTNER) {
      throw new Error(
          'This event forms teams randomly; just ready up to play');
    }
  }

  assertEligible(
      doc: admin.firestore.DocumentSnapshot|undefined,
      name: string) {
    const player = doc?.data() as ILeaderboardPlayer;
    if (!doc || !doc.exists || player?.name !== name || player.withdrawn) {
      throw new Error(`${name} is not registered for this event`);
    }
    if (player.dq) {
      throw new Error(`${player.name} is disqualified`);
    }
  }

  playerDoc(name: string):
      Promise<admin.firestore.DocumentSnapshot> {
    return this.tx.get(this.playerRef(name));
  }

  playerRef(name: string) {
    return this.eventDoc.ref.collection('players').doc(name);
  }

  teamOf(name: string): IArenaTeam|undefined {
    return this.teams.find(team => (team.members || []).includes(name));
  }

  requireTeam(teamId: string): IArenaTeam {
    const team = this.teams.find(existing => existing.id === teamId);
    if (!team) {
      throw new Error('That team does not exist');
    }
    return team;
  }

  requireCaptainTeam(): IArenaTeam {
    const team = this.teamOf(this.caller);
    if (!team || team.captain !== this.caller) {
      throw new Error('Only the team captain can do that');
    }
    this.assertTeamNotBusy(team);
    return team;
  }

  // a team is busy if any member is in a live game or the whole roster is
  // currently queued (every member still inside the readiness window)
  teamIsBusy(team: IArenaTeam): boolean {
    return this.teamHasPlayingMember(team) || this.teamIsQueued(team);
  }

  teamHasPlayingMember(team: IArenaTeam): boolean {
    return (team.members || []).some(member =>
        (this.event.arenaPlaying || []).includes(member));
  }

  teamIsQueued(team: IArenaTeam): boolean {
    const ready = this.event.arenaReady || {};
    return (team.members || []).length > 0 &&
        team.members.every(member => this.fresh(ready[member]));
  }

  assertTeamNotBusy(team: IArenaTeam) {
    if (this.teamHasPlayingMember(team)) {
      throw new Error('Your team is in a game right now');
    }
    if (this.teamIsQueued(team)) {
      throw new Error('Your team is queued; unready first');
    }
  }

  assertIdle(name: string) {
    this.assertNotPlaying(name);
    if (this.fresh((this.event.arenaReady || {})[name])) {
      throw new Error('Leave the queue first');
    }
  }

  assertCallerIdle() {
    this.assertIdle(this.caller);
  }

  assertNotPlaying(name: string) {
    if ((this.event.arenaPlaying || []).includes(name)) {
      throw new Error(`${name} is in a game right now`);
    }
  }

  removeFromRequests(name: string) {
    for (const team of this.teams) {
      if ((team.requests || []).includes(name)) {
        team.requests = team.requests.filter(request => request !== name);
      }
    }
  }

  clearTeamReadiness(team: IArenaTeam) {
    for (const member of team.members || []) {
      delete this.arenaReady[member];
      delete this.arenaQueueAt[member];
    }
  }
}
