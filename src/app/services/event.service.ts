import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

import {ADMINS} from '../../../constants';
import {environment} from 'src/environments/environment';
import {isTeamArena, loadEventTeam} from '../../../team-arena';

import {
  EventType, GameStatus, IArenaEvent, IArenaGameTeam, IDoubleElimEvent, IEvent,
  IEventInfo, IEventTeamLobby, IGame, ILeaderboardPlayer, IRedirect, PartnerStatus, Visibility,
} from '../../../types';

import {GeneralsService} from './generals.service';
import {TeamArenaService} from './team-arena.service';
import {TeamBracketService} from './team-bracket.service';

@Injectable({providedIn: 'root'})
export class EventService {
  private db: firebase.default.firestore.Firestore;
  constructor(
      private readonly afs: AngularFirestore,
      private readonly generals: GeneralsService,
      private readonly teamArenaService: TeamArenaService,
      private readonly teamBracketService: TeamBracketService,
  ) {
    this.db = firebase.default.firestore();
  }

  async createEvent(event: Partial<IEvent>): Promise<string> {
    const defaults = {visibility: Visibility.PUBLIC,
        // local emulator runs create events against the local GIO server
        ...((environment as any).localEmulators ?
            {server: 'loc' as any} : {})};
    const reset = {replays: [], playerCount: 0};
    event = {...defaults, ...event, ...reset};

    // assign this event a human readable id that doesn't clash with an
    // existing event
    let counter;
    let eventId;
    let id;
    while (!eventId) {
      id = this.getId(event.name, counter);
      const doc = await this.db.collection('events').doc(id).get();

      if (doc.exists) {
        counter = (counter || 0) + 1;
      } else {
        await this.afs.collection('events').doc(id).set(event);
        eventId = id;
      }
    }

    return eventId;
  }

  /**
   * Get a list of events. You can optionally just get child events for
   * a multi-stage event
   *
   * @param parentEventId optional parent event if looking for children
   *
   * @returns an observable of a list of events
   */
  getEvents(parentEventId?: string):
      Observable<IEvent[]> {
    // admins can see private events too
    const visibilities = [Visibility.PUBLIC];
    if (ADMINS.includes(this.generals.name)) {
      visibilities.push(Visibility.PRIVATE);
    }

    return this.afs
        .collection<IEvent>(
            'events',
            ref => {
              const query = ref.orderBy('startTime');

              // support looking for children with a given parent eventId, we
              // don't care about the event visibility here
              if (parentEventId) {
                return query.where('parentId', '==', parentEventId);
              }

              // otherwise, show only those with visibilities you can see
              else {
                return query.where('visibility', 'in', visibilities);
              }
            })
        .snapshotChanges()
        .pipe(map(actions => {
          return actions
              .map(action => {
                const {doc} = action.payload;
                return {...doc.data(), id: doc.id, exists: doc.exists};
              });
        }));
  }

  getEvent(eventId: string): Observable<IEvent> {
    return this.afs.collection('events')
        .doc<IEvent>(eventId)
        .snapshotChanges()
        .pipe(map(event => {
          return {
            ...event.payload.data(),
            id: event.payload.id,
            exists: event.payload.exists,
          };
        }));
  }

  async addPlayer(eventId: string, name: string) {
    // team arena registrations may be re-attempted (queue auto-join, page
    // reload); create-if-missing so a repeated join can never reset a
    // scored record or double-count the player via the onCreate trigger
    const eventRef = this.db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (isTeamArena(eventDoc.data())) {
      // team arena registration is a server-side callable operation
      // against the authenticated caller's own username
      return this.teamArenaService.register(eventId);
    }

    return this.afs.collection('events')
        .doc(eventId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .set({
          name,
          rank: 0,
          points: 0,
          currentStreak: 0,
          dq: false,
          record: [],
        });
  }

  async removePlayer(eventId: string, name: string): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);

    // client-side consistency only: players may withdraw themselves and
    // event organizers may purge a registration. This is NOT authorization;
    // real enforcement must live in the Firestore rules.
    const caller = this.generals.name;
    if (caller !== name && !ADMINS.includes(caller)) {
      throw new Error('You can only remove yourself from an event');
    }

    const eventDoc = await eventRef.get();

    // team arenas remove the arena roster membership atomically with the
    // registration so queued/playing invariants stay consistent; team
    // totals and records are preserved on the event document
    if (isTeamArena(eventDoc.data())) {
      return this.teamArenaService.withdrawPlayer(eventId, name);
    }

    // non-big-team events keep the existing single doc delete
    if (eventDoc.data()?.type !== EventType.BIG_TEAM) {
      return this.afs.collection('events')
          .doc(eventId)
          .collection<ILeaderboardPlayer>('players')
          .doc(name)
          .delete();
    }

    // big team withdrawal (roster cleanup + delete) is a backend
    // operation for the same reason: no client can orphan roster state
    return this.teamBracketService.withdrawPlayer(eventId, name);
  }

  getPlayers(eventId: string): Observable<ILeaderboardPlayer[]> {
    return this.afs.collection('events')
        .doc(eventId)
        .collection<ILeaderboardPlayer>(
            'players', ref => ref.orderBy('points', 'desc').orderBy('name'))
        .snapshotChanges()
        .pipe(map(actions => {
          const players = actions.map(action => {
            return action.payload.doc.data();
          });

          // sort players by rank, points, then win rate, then total games, then
          // quickest win, then event wins, then TSP, then stars, then fallback to name
          players.sort((a, b) => {
            if (this.equal(a.dq, b.dq)) {
              if (this.equal(a.rank, b.rank)) {
                if (this.equal(a.points, b.points)) {
                  if (this.equal(a.stats?.winRate, b.stats?.winRate)) {
                    if (this.equal(a.stats?.totalGames, b.stats?.totalGames)) {
                      if (this.equal(
                              a.stats?.quickestWin, b.stats?.quickestWin)) {
                        if (this.equal(a.stats?.eventWins, b.stats?.eventWins)) {

                          if (this.equal(
                            a.stats?.totalSeedPoints,
                            b.stats?.totalSeedPoints)) {
                            if (this.equal(
                                    a.stats?.currentStars,
                                    b.stats?.currentStars)) {
                              // fallback to name
                              return a.name.localeCompare(b.name);
                            } else {
                              // current stars descending (b - a)
                              return (b.stats?.currentStars || 0) -
                                  (a.stats?.currentStars || 0);
                            }
                          } else {
                            // current TSP descending (b - a)
                            return (b.stats?.totalSeedPoints || 0) -
                                (a.stats?.totalSeedPoints || 0);
                          }
                        } else {
                          // most event wins descending (b - a)
                          return (b.stats?.eventWins ?? 0) -
                              (a.stats?.eventWins ?? 0);
                        }
                      } else {
                        // quickest win ascending (a - b)
                        return (a.stats?.quickestWin || 999) -
                            (b.stats?.quickestWin || 999);
                      }
                    } else {
                      // total games descending (b - a)
                      return (b.stats?.totalGames || 0) -
                          (a.stats?.totalGames || 0);
                    }
                  } else {
                    // win rate descending (b - a)
                    return (b.stats?.winRate || 0) - (a.stats?.winRate || 0);
                  }
                } else {
                  // points descending (b - a)
                  return b.points - a.points;
                }
              } else {
                // rank ascending (a - b)
                const ar = a.rank || Number.MAX_SAFE_INTEGER;
                const br = b.rank || Number.MAX_SAFE_INTEGER;
                return ar - br;
              }
            } else {
              // DQ status ascending, non-DQ'd will be first
              return Number(a.dq || 0) - Number(b.dq || 0);
            }
          });

          let rank = 1;
          for (const player of players) {
            // sort the records in descending order for the leaderboard UI:
            // the games that happened most recently at the beginning;
            // records with an unknown finish (legacy clock replays) order
            // by their start time instead
            player.record.sort((a, b) =>
                (b.finished ?? b.started) - (a.finished ?? a.started));
            player.rank = rank++;
          }

          return players;
        }));
  }

  async joinQueue(eventId: string, name: string) {
    // team arenas queue whole ready teams via TeamArenaService.setReady;
    // the legacy queue array must never carry an individual arena member
    const eventDoc =
        await this.db.collection('events').doc(eventId).get();
    if (isTeamArena(eventDoc.data())) {
      throw new Error(
          'Team arena events use per-player readiness, not the queue');
    }
    return this.afs.collection('events').doc(eventId).update(
        {queue: firebase.default.firestore.FieldValue.arrayUnion(name)});
  }

  async leaveQueue(eventId: string, name: string) {
    const eventDoc =
        await this.db.collection('events').doc(eventId).get();
    if (isTeamArena(eventDoc.data())) {
      // readiness is the queue; leaving the queue means unreadying
      return this.teamArenaService.setReady(eventId, false);
    }
    return this.afs.collection('events').doc(eventId).update(
        {queue: firebase.default.firestore.FieldValue.arrayRemove(name)});
  }

  getRedirect(eventId: string, name: string):
      Observable<Pick<IRedirect,
          'lobby' | 'gameId' | 'arenaTeams' | 'options' |
          'server'> & {id: string, eventTeam?: IEventTeamLobby}> {
    return this.afs.collection('events')
        .doc(eventId)
        .collection(
            'redirect',
            ref => {
              return ref.where('players', 'array-contains', name);
            })
        .snapshotChanges()
        .pipe(map(redirects => {
          if (!redirects?.length) {
            return null;
          }
          // an acknowledged redirect drops this player from its list, so
          // anything still matching is unacknowledged; prefer the latest
          // dispatch when several are somehow pending at once
          const latest = redirects.reduce((a, b) =>
              (b.payload.doc.data()?.started || 0) >
              (a.payload.doc.data()?.started || 0) ? b : a);
          const data = latest.payload.doc.data() as IRedirect;
          return {
            lobby: data?.lobby,
            id: latest.payload.doc.id,
            gameId: data?.gameId,
            // the document holds the stored codec shape; decode to the
            // wire contract at this boundary before anything sees it
            eventTeam: data?.eventTeam ?
                loadEventTeam(data.eventTeam) : undefined,
            arenaTeams: data?.arenaTeams,
            // dispatch-time snapshots: the game can never be invalidated by
            // a later event edit
            options: data?.options,
            server: data?.server,
          };
        }));
  }

  clearRedirect(eventId: string, redirectId: string, name: string) {
    return this.afs.collection('events')
        .doc(eventId)
        .collection('redirect')
        .doc(redirectId)
        .update({
          players: firebase.default.firestore.FieldValue.arrayRemove(name),
        });
  }

  getGames(eventId: string, limit?: number): Observable<IGame[]> {
    return this.afs.collection<IEvent>('events')
        .doc(eventId)
        .collection<IGame>(
            'games',
            ref => {
              let query = ref.where('status', '==', GameStatus.FINISHED)
                              .orderBy('finished', 'desc');

              if (limit) {
                query = query.limit(limit);
              }

              return query;
            })
        .valueChanges({idField: 'id'});
  }

  checkInPlayer(eventId: string, name: string) {
    return this.afs.collection('events').doc(eventId).update({
      checkedInPlayers: firebase.default.firestore.FieldValue.arrayUnion(name)
    });
  }

  selectPartner(eventId: string, name: string, partner: string): Promise<void> {
    return this.afs.collection('events')
        .doc(eventId)
        .collection('players')
        .doc(name)
        .update({
          partner,
          partnerStatus: PartnerStatus.PENDING,
          teamName: '',
        });
  }

  confirmPartner(eventId: string, name: string, partner: string):
      Promise<void[]> {
    // for both the name of this player and the partner, set them to each
    // other's partner's and confirm the status
    return Promise.all([name, partner].map(player => {
      return this.afs.collection('events')
          .doc(eventId)
          .collection('players')
          .doc(player)
          .update({
            partner: name === player ? partner : name,
            partnerStatus: PartnerStatus.CONFIRMED,
            teamName: '',
          });
    }));
  }

  async clearPartner(eventId: string, name: string, currentPartner: string):
      Promise<void> {
    await this.afs.collection('events')
        .doc(eventId)
        .collection('players')
        .doc(name)
        .update({
          partner: '',
          partnerStatus: PartnerStatus.NONE,
          teamName: '',
        });

    return this.selectPartner(eventId, currentPartner, name);
  }

  /**
   * Atomically write a big team roster to every member's player doc. The
   * roster may be partial while the captain is still building the team, but
   * it can only ever grow: existing members must all agree on the same prior
   * roster and captain, and no prior member may be dropped.
   *
   * These are client-side consistency checks only; they are NOT a substitute
   * for authorization in the Firestore rules.
   */
  /**
   * Big Team roster mutations run on the backend via the
   * teamBracketAction callable. These thin methods only forward the
   * action; identity comes from the caller's auth token server-side.
   */
  sendBigTeamInvite(eventId: string, target: string): Promise<void> {
    return this.teamBracketService.sendInvite(eventId, target);
  }

  acceptBigTeamInvite(eventId: string, captain: string): Promise<void> {
    return this.teamBracketService.acceptInvite(eventId, captain);
  }

  declineBigTeamInvite(eventId: string, captain: string): Promise<void> {
    return this.teamBracketService.declineInvite(eventId, captain);
  }

  cancelBigTeamInvite(eventId: string, target: string): Promise<void> {
    return this.teamBracketService.cancelInvite(eventId, target);
  }

  /**
   * Remove the authenticated caller from their actual server-side roster.
   */
  leaveBigTeam(eventId: string): Promise<void> {
    // the backend reads the caller's actual roster and applies the
    // canonical captain-transfer/clear semantics server-side
    return this.teamBracketService.leaveTeam(eventId);
  }

  async setTeamName(
      eventId: string,
      players: string[],
      teamName: string,
      ): Promise<void> {
    const eventRef = this.db.collection('events').doc(eventId);
    const sliced = (teamName || '').slice(0, 20);

    // 2v2 team names keep the existing write-per-member behavior
    const eventDoc = await eventRef.get();
    if (eventDoc.data()?.type !== EventType.BIG_TEAM) {
      await Promise.all(players.map(player => {
        return this.afs.collection('events')
            .doc(eventId)
            .collection('players')
            .doc(player)
            .update({teamName: sliced});
      }));
      return;
    }

    // big team renames are captain-only mirrored writes on the backend
    return this.teamBracketService.renameTeam(eventId, sliced);
  }

  updateEvent(eventId: string, data: Partial<IEvent>) {
    // live team arenas lock their structural configuration server-side:
    // once any team, readiness entry, in-flight game, or completed match
    // exists, changing the mode/type/format/team size/game size would
    // invalidate existing rosters and dispatched lobby contracts
    const eventRef = this.db.collection('events').doc(eventId);
    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data() as IArenaEvent;
      if (eventDoc.exists && isTeamArena(event)) {
        const live = !!(
            event.arenaTeams?.length ||
            Object.keys(event.arenaReady || {}).length ||
            event.arenaPlaying?.length ||
            event.arenaMatchNumber ||
            event.ongoingGameCount || event.completedGameCount);
        const structural: (keyof IEvent)[] = [
          'format', 'type', 'doublesPairingStrategy', 'teamSize',
          'playersPerGame'];
        if (live && structural.some(field =>
            data[field] !== undefined &&
            JSON.stringify(data[field]) !== JSON.stringify(event[field]))) {
          throw new Error(
              'Team arena structure cannot change once games exist');
        }
      }
      tx.update(eventRef, data);
    });
  }

  /**
   * Create a leaderboard player doc if missing (does not overwrite existing).
   */
  async ensureLeaderboardPlayer(eventId: string, name: string): Promise<void> {
    const ref = this.db.collection('events')
                  .doc(eventId)
                  .collection('players')
                  .doc(name);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        name,
        rank: 0,
        points: 0,
        currentStreak: 0,
        dq: false,
        record: [],
      });
    }
  }

  /**
   * Single batch: event fields update plus optional deletes of match tracking
   * docs under events/{id}/matches/{matchNumber}.
   */
  commitBracketAdminBatch(
      eventId: string,
      updates: {[key: string]: unknown},
      deleteMatchDocIds: string[] = [],
  ): Promise<void> {
    const batch = this.db.batch();
    const eventRef = this.db.collection('events').doc(eventId);
    batch.update(eventRef, updates);
    for (const id of deleteMatchDocIds) {
      batch.delete(eventRef.collection('matches').doc(id));
    }
    return batch.commit();
  }

  deleteEvent(eventId: string) {
    return this.afs.collection('events').doc(eventId).delete();
  }

  promoteEvent(eventInfo: IEventInfo) {
    return this.afs.collection('generals.io').doc('homepage').update({eventInfo});
  }

  /**
   * Return an id with spaces converted to hyphens and non-alphanumeric
   * characters removed, optional counter appended to the end
   */
  private getId(name: string, counter?: number) {
    let id = name.replace(/[^a-zA-Z0-9 \-]/g, '')  // remove illegal values
                 .trim()                           // remove trailing whitespace
                 .replace(/[ ]/g, '-');            // spaces to dashes

    if (counter) {
      id += `-${counter}`;
    }
    return id;
  }

  /**
   * Return true if two values are equal or both are falsey
   */
  private equal(a?: number|boolean|null, b?: number|boolean|null): boolean {
    return a === b || (!a && !b);
  }
}
