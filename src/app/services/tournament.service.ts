import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

import {ADMINS} from '../../../constants';
import {GameStatus, IGame, ILeaderboardPlayer, ITournament, Visibility} from '../../../types';
import {GeneralsService} from './generals.service';

@Injectable({providedIn: 'root'})
export class TournamentService {
  private db: firebase.default.firestore.Firestore;
  constructor(
      private readonly afs: AngularFirestore,
      private readonly generals: GeneralsService,
  ) {
    this.db = firebase.default.firestore();
  }

  async createTournament(tournament: Partial<ITournament>) {
    tournament = {
      queue: [],
      replays: [],
      playerCount: 0,
      visibility: Visibility.PUBLIC,
      ...tournament,
    };

    // assign this tournament a human readable id that doesn't clash with an
    // existing tournament
    let counter;
    let value;
    while (!value) {
      let id = this.getId(tournament.name, counter);
      const doc = await this.db.collection('tournaments').doc(id).get();

      if (doc.exists) {
        counter = (counter || 0) + 1;
      } else {
        value = this.afs.collection('tournaments').doc(id).set(tournament);
      }
    }

    return value;
  }

  getTournaments(finished: boolean): Observable<ITournament[]> {
    // admins can see private tournaments too
    const visibilities = [Visibility.PUBLIC];
    if (ADMINS.includes(this.generals.name)) {
      visibilities.push(Visibility.PRIVATE);
    }

    return this.afs
        .collection<ITournament>(
            'tournaments',
            ref => {
              return ref.where('endTime', finished ? '<' : '>=', Date.now())
                  .where('visibility', 'in', visibilities)
                  .limit(10);
            })
        .snapshotChanges()
        .pipe(map(actions => {
          return actions
              .map(action => {
                const {doc} = action.payload;
                return {...doc.data(), id: doc.id, exists: doc.exists};
              })
              .sort((a, b) => {
                return finished ? b.endTime - a.endTime :
                                  a.startTime - b.startTime;
              });
        }));
  }

  getTournament(tournamentId: string): Observable<ITournament> {
    return this.afs.collection('tournaments')
        .doc<ITournament>(tournamentId)
        .snapshotChanges()
        .pipe(map(tournament => {
          return {
            ...tournament.payload.data(),
            id: tournament.payload.id,
            exists: tournament.payload.exists,
          };
        }));
  }

  addPlayer(tournamentId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .set({name, rank: 0, points: 0, currentStreak: 0, record: []});
  }

  removePlayer(tournamentId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .delete();
  }

  getPlayers(tournamentId: string): Observable<ILeaderboardPlayer[]> {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
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
            if (this.equal(a.points, b.points)) {
              if (this.equal(a.stats?.winRate, b.stats?.winRate)) {
                if (this.equal(a.stats?.totalGames, b.stats?.totalGames)) {
                  if (this.equal(a.stats?.quickestWin, b.stats?.quickestWin)) {
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
          });

          let rank = 1;
          for (const player of players) {
            // sort the records in reverse for the leaderboard UI
            player.record.sort((a, b) => b.finished - a.finished);
            player.rank = rank++;
          }

          return players;
        }));
  }

  joinQueue(tournamentId: string, name: string) {
    return this.afs.collection('tournaments').doc(tournamentId).update({
      queue: firebase.default.firestore.FieldValue.arrayUnion(name)
    });
  }

  leaveQueue(tournamentId: string, name: string) {
    return this.afs.collection('tournaments').doc(tournamentId).update({
      queue: firebase.default.firestore.FieldValue.arrayRemove(name)
    });
  }

  getRedirect(tournamentId: string, name: string):
      Observable<{lobby: string, id: string}> {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
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

  clearRedirect(tournamentId: string, redirectId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection('redirect')
        .doc(redirectId)
        .update({
          players: firebase.default.firestore.FieldValue.arrayRemove(name),
        });
  }

  getGames(tournamentId: string, limit?: number): Observable<IGame[]> {
    return this.afs.collection<ITournament>('tournaments')
        .doc(tournamentId)
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
  private equal(a?: number|null, b?: number|null): boolean {
    return a === b || (!a && !b);
  }
}
