import * as express from 'express';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {GeneralsServer} from '../../../../constants';
import * as simulator from '../../util/simulator';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db: admin.firestore.Firestore = admin.firestore();

// the express server that will live inside the cloud function
const app = express();
const main = express();
main.use('/v1', app);
main.use(express.json());

// the actual cloud function
export const api = functions.https.onRequest(main);

app.get('/', async (request, response) => {
  response.send(`
    Welcome! This API is currently intended as a way for bot players to play in
    a generals.io event. Feel free to ping @matt in the generals.io
    discord for more information.
  `);
});

app.get('/replays/:replayId', async (request, response) => {
  const {replayId} = request.params;
  const server = (request.query.server || GeneralsServer.NA) as string;

  try {
    if (!replayId) throw new Error('replayId is blank');
    const replay = await simulator.getReplay(replayId, server);
    response.json(replay);
  } catch (error) {
    response.status(500).send({
      error: `could not retrieve replay (${replayId}) from ${server} server`,
    });
  }
});

app.get('/replays/:replayId/stats', async (request, response) => {
  const {replayId} = request.params;
  const server = (request.query.server || GeneralsServer.NA) as string;

  try {
    if (!replayId) throw new Error('replayId is blank');
    const {scores, summary, turns} =
        await simulator.getReplayStats(replayId, server);
    response.json({
      scores: scores.map(score => {
        const {name, kills, rank, lastTurn, killed, killedBy, tilesAfterFirstRound} = score;
        return {name, kills, rank, lastTurn, killed, killedBy, tilesAfterFirstRound};
      }),
      summary,
      turns
    });
  } catch (error) {
    response.status(500).send({
      error: `could not retrieve replay (${replayId}) from ${server} server`,
    });
  }
});

/**
 * Return a list of the upcoming events
 */
app.get('/upcomingevents', async (request, response) => {
  try {
    const snapshot = await db.collection('events').where('startTime', '>', Date.now()).orderBy('startTime', 'asc').get();
    const events = snapshot.docs.map(doc => {
      const data = doc.data();
      data.id = doc.id;
      return data;
    });
    response.json(events);
  } catch (error) {
    response.status(500).send(error);
  }
});

/**
 * Return the event matching the id provided, or return null if not found
 */
app.get('/events/:eventId', async (request, response) => {
  try {
    const {eventId} = request.params;
    if (!eventId) throw new Error('eventId is blank');

    const snapshot = await db.collection('events').doc(eventId).get();
    response.json(snapshot.data() || null);
  } catch (error) {
    response.status(500).send(error);
  }
});

/**
 * Return the lobby the user should be in, or null if no current lobby
 * Every time this endpoint returns a lobby string, that redirect gets cleared
 * Each redirect can only be read one time
 */
app.get('/events/:eventId/lobby/:name', async (request, response) => {
  try {
    const {eventId, name} = request.params;
    if (!eventId) throw new Error('eventId is blank');
    if (!name) throw new Error('name is blank');

    const redirects = await db.collection('events')
                          .doc(eventId)
                          .collection('redirect')
                          .where('players', 'array-contains', name)
                          .get();

    // find the first lobby, or null
    const {lobby} = redirects?.docs[0]?.data() || {lobby: null};

    // Each redirect can only be read one time
    if (lobby !== null) {
      await redirects.docs[0].ref.update({
        players: admin.firestore.FieldValue.arrayRemove(name),
      });
    }

    response.json({lobby});
  } catch (error) {
    response.status(500).send(error);
  }
});

/**
 * Add a given player to a given event
 */
app.post('/events/:eventId/join/:name', async (request, response) => {
  try {
    const {eventId, name} = request.params;
    if (!eventId) throw new Error('eventId is blank');
    if (!name) throw new Error('name is blank');

    const eventRef = db.collection('events').doc(eventId);

    // ensure the eventId exists
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
      response.json({success: false, message: 'event doesn\'t exist'});
    }

    // ensure this user doesn't already exist
    const player = await eventRef.collection('players').doc(name).get();
    if (player.exists) {
      response.json({
        success: false,
        message: `${name} is already in this event`,
      });
    }

    // add the player to the event
    try {
      await eventSnapshot.ref.collection('players').doc(name).create({
        name,
        rank: 0,
        points: 0,
        currentStreak: 0,
        record: [],
      });
    } catch (error) {
      // do nothing
    }

    response.json({success: true});
  } catch (error) {
    response.status(500).send(error);
  }
});

/**
 * Add a given player to the queue in a given event
 */
app.post('/events/:eventId/queue/:name', async (request, response) => {
  try {
    const {eventId, name} = request.params;
    if (!eventId) throw new Error('eventId is blank');
    if (!name) throw new Error('name is blank');

    // ensure the event exists
    const snapshot = await db.collection('events').doc(eventId).get();
    if (!snapshot.exists) {
      response.json({success: false, message: 'event doesn\'t esist'});
    }

    // add the player to the event queue
    await snapshot.ref.update({
      queue: admin.firestore.FieldValue.arrayUnion(name),
    });

    response.json({success: true});
  } catch (error) {
    response.status(500).send(error);
  }
});
