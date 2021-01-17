import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {GameStatus, IGame, ILeaderboardPlayer, ITournament} from 'types';

@Injectable({providedIn: 'root'})
export class TournamentService {
  private db: firebase.default.firestore.Firestore;
  constructor(
      private readonly afs: AngularFirestore,
  ) {
    this.db = firebase.default.firestore();
  }

  async createTournament(tournament: Partial<ITournament>) {
    const {startTime, durationMinutes} = tournament;
    if (startTime && durationMinutes) {
      const endDate = new Date(startTime + (durationMinutes * 60 * 1000));
      tournament.endTime = endDate.getTime();
    }

    tournament = {
      name: 'New Event',
      queue: [],
      replays: [],
      finished: false,
      startTime: null,
      endTime: null,
      playerCount: 0,
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
    return this.afs
        .collection<ITournament>(
            'tournaments',
            ref => {
              return ref.where('finished', '==', finished).limit(10);
            })
        .snapshotChanges()
        .pipe(map(actions => {
          return actions
              .map(action => {
                const {doc} = action.payload;
                return {...doc.data(), id: doc.id};
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
          return {...tournament.payload.data(), id: tournament.payload.id};
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

          let rank = 0;
          let gap = 1;
          let lastPoints = -1;
          for (const player of players) {
            if (lastPoints !== player.points) {
              rank += gap;
              gap = 1;
            } else {
              gap++;
            }
            player.rank = rank;
            lastPoints = player.points;

            // sort the records in reverse for the leaderboard UI
            player.record.sort((a, b) => b.finished - a.finished);
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

  private getId(name: string, counter?: number) {
    let id = name.replace(/[^a-zA-Z0-9 \-]/g, '')  // remove illegal values
                 .trim()                           // remove trailing whitespace
                 .replace(/[ ]/g, '-');            // spaces to dashes

    if (counter) {
      id += `-${counter}`;
    }
    return id;
  }
}
