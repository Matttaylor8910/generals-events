import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {EventType, IEvent, ILeaderboardPlayer} from '../../../types';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onUpdateEvent = functions.firestore.document('events/{eventId}')
                                 .onUpdate(async (eventDoc, context) => {
                                   const eventId = context.params.eventId;
                                   await checkQueue(eventDoc.after, eventId);
                                   return 'Done';
                                 });

async function checkQueue(snapshot: DocumentSnapshot, eventId: string) {
  const event = snapshot.data() as IEvent;
  const {endTime, queue, playersPerGame} = event;

  // if the event isn't over, start a new game if there are enough players
  // in the queue to do so
  if (endTime > Date.now() && queue.length >= playersPerGame) {
    const players = await getNextPlayers(event, snapshot.ref);

    if (players.length) {
      players.sort((a, b) => a.localeCompare(b));
      const started = Date.now();

      const id = `${players.join('_vs_')}`;

      const batch = db.batch();
      batch.update(snapshot.ref, {
        queue: admin.firestore.FieldValue.arrayRemove(...players),
      });
      batch.create(snapshot.ref.collection('redirect').doc(id), {
        lobby: `event_${eventId}_${started}`,
        started,
        players,
      });
      await batch.commit();
    }
  }
}

async function getNextPlayers(
    event: IEvent,
    eventRef: admin.firestore.DocumentReference,
    ): Promise<string[]> {
  if (event.type === EventType.FFA) {
    return event.queue.slice(0, event.playersPerGame);
  } else {
    return duelMatchmaking(event, eventRef);
  }
}

async function duelMatchmaking(
    event: IEvent,
    eventRef: admin.firestore.DocumentReference,
    ): Promise<string[]> {
  // try to find a game that can be played, starting with the first player in
  // the queue, but move on if that first player doesn't have a valid match
  for (const name of event.queue) {
    console.log(`trying to find a match for ${name}`);
    const snapshot = await eventRef.collection('players').doc(name).get();
    let {lastThreeOpponents: recent} = snapshot.data() as ILeaderboardPlayer;

    // in the case of an event with fewer than 6 players, don't match them
    // with the last N - 3 people they have played with. Starting at 4
    // players, you shouldn't be matched with the player you just played.
    if (event.playerCount < 6) {
      const playersToAvoid = event.playerCount >= 3 ? event.playerCount - 3 : 0;
      recent = recent?.slice(0, playersToAvoid);
      console.log(`less than 6 players, avoid the last ${
          playersToAvoid} players, avoid: ${recent?.join(',') || []}`);
    }

    // if we find an enemy that is not in the recent opponents, queue them
    // up to play this player
    const enemy = event.queue.find(p => p !== name && !recent?.includes(p));
    if (enemy) {
      console.log(`${name} can play ${enemy}, go!`);
      const players = [name, enemy];
      await setLastOpponents(players, eventRef);
      return players;
    }
  }

  // no matches :(
  return [];
}

async function setLastOpponents(
    players: string[],
    eventRef: admin.firestore.DocumentReference,
) {
  for (const name of players) {
    let opponents: string[] = [];
    const playerDoc = await eventRef.collection('players').doc(name).get();
    const {lastThreeOpponents = []} = playerDoc.data() as ILeaderboardPlayer;
    const opponent = players.find(p => p !== name)!;
    opponents = [opponent, ...lastThreeOpponents.slice(0, 2)];
    await eventRef.collection('players').doc(name).update({
      lastThreeOpponents: opponents,
    });
  }
}