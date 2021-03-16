import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

import {ADMINS} from '../../../constants';
import {GameStatus, IEvent, IGame, ILeaderboardPlayer, Visibility} from '../../../types';

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

  getEvents(finished: boolean): Observable<IEvent[]> {
    // admins can see private events too
    const visibilities = [Visibility.PUBLIC];
    if (ADMINS.includes(this.generals.name)) {
      visibilities.push(Visibility.PRIVATE);
    }

    return this.afs
        .collection<IEvent>(
            'events',
            ref => {
              return ref.where('visibility', 'in', visibilities).limit(10);
            })
        .snapshotChanges()
        .pipe(map(actions => {
          return actions
              .map(action => {
                const {doc} = action.payload;
                return {...doc.data(), id: doc.id, exists: doc.exists};
              })
              .filter(event => {
                return finished ? event.endTime < Date.now() :
                                  event.endTime > Date.now() || !event.endTime;
              })
              .sort((a, b) => {
                return finished ? b.endTime - a.endTime :
                                  a.startTime - b.startTime;
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

          // sort players by points, then win rate, then total games, then
          // quickest win, then stars, then fallback to name
          players.sort((a, b) => {
            if (this.equal(a.dq, b.dq)) {
              if (this.equal(a.points, b.points)) {
                if (this.equal(a.stats?.winRate, b.stats?.winRate)) {
                  if (this.equal(a.stats?.totalGames, b.stats?.totalGames)) {
                    if (this.equal(
                            a.stats?.quickestWin, b.stats?.quickestWin)) {
                      if (this.equal(
                              a.stats?.currentStars, b.stats?.currentStars)) {
                        // fallback to name
                        return a.name.localeCompare(b.name);
                      } else {
                        // current stars descending (b - a)
                        return (b.stats?.currentStars || 0) -
                            (a.stats?.currentStars || 0);
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
        .snapshotChanges()
        .pipe(map(actions => {
          return actions.map(action => {
            const {doc} = action.payload;
            return {...doc.data(), id: doc.id};
          });
        }));
  }

  checkInPlayer(eventId: string, name: string) {
    return this.afs.collection('events').doc(eventId).update({
      checkedInPlayers: firebase.default.firestore.FieldValue.arrayUnion(name)
    });
  }

  updateEvent(eventId: string, data: Partial<IEvent>) {
    return this.afs.collection('events').doc(eventId).update(data);
  }

  deleteEvent(eventId: string) {
    return this.afs.collection('events').doc(eventId).delete();
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
