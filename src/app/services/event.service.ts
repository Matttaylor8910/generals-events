import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

import {ADMINS} from '../../../constants';
import {GameStatus, IEvent, IEventInfo, IGame, ILeaderboardPlayer, PartnerStatus, Visibility} from '../../../types';

import {GeneralsService} from './generals.service';

@Injectable({providedIn: 'root'})
export class EventService {
  private db: firebase.default.firestore.Firestore;
  constructor(
      private readonly afs: AngularFirestore,
      private readonly generals: GeneralsService,
  ) {
    this.db = firebase.default.firestore();
  }

  async createEvent(event: Partial<IEvent>): Promise<string> {
    const defaults = {visibility: Visibility.PUBLIC};
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
                return query.where('visibility', 'in', visibilities)
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

  addPlayer(eventId: string, name: string) {
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

  removePlayer(eventId: string, name: string) {
    return this.afs.collection('events')
        .doc(eventId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .delete();
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
            // the games that happened most recently at the beginning
            player.record.sort((a, b) => b.finished - a.finished);
            player.rank = rank++;
          }

          return players;
        }));
  }

  joinQueue(eventId: string, name: string) {
    return this.afs.collection('events').doc(eventId).update(
        {queue: firebase.default.firestore.FieldValue.arrayUnion(name)});
  }

  leaveQueue(eventId: string, name: string) {
    return this.afs.collection('events').doc(eventId).update(
        {queue: firebase.default.firestore.FieldValue.arrayRemove(name)});
  }

  getRedirect(eventId: string, name: string):
      Observable<{lobby: string, id: string}> {
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
          return {
            lobby: redirects[0].payload.doc.data()?.lobby,
                id: redirects[0].payload.doc.id,
          }
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

  setTeamName(eventId: string, players: string[], teamName: string):
      Promise<void[]> {
    return Promise.all(players.map(player => {
      return this.afs.collection('events')
          .doc(eventId)
          .collection('players')
          .doc(player)
          .update({teamName});
    }));
  }

  updateEvent(eventId: string, data: Partial<IEvent>) {
    return this.afs.collection('events').doc(eventId).update(data);
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
   * @param name
   * @param counter
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
   * @param a
   * @param b
   */
  private equal(a?: number|boolean|null, b?: number|boolean|null): boolean {
    return a === b || (!a && !b);
  }
}
