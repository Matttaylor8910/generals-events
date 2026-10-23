import * as crypto from 'crypto';
import * as express from 'express';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {GeneralsServer, SITE_URLS} from '../../../../constants';
import * as simulator from '../../util/simulator';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db: admin.firestore.Firestore = admin.firestore();

// Comma separated list of keys that bots must send to use the endpoints that
// change data. Set with: firebase functions:secrets:set API_KEYS
const API_KEYS_ENV = 'API_KEYS';

// Only the generals.io sites may call this API from a browser
const ALLOWED_ORIGINS = new Set<string>(Object.values(SITE_URLS));

/**
 * Minimal CORS so the game client can POST season event responses
 */
function cors(
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
) {
  const origin = request.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.set('Access-Control-Max-Age', '3600');
  }
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  next();
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Endpoints that write to the database require an API key, sent as either
 * `Authorization: Bearer <key>` or an `x-api-key` header. Without this anyone
 * could add anyone to an event or clear their lobby redirect.
 */
function requireApiKey(
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
) {
  const keys = (process.env[API_KEYS_ENV] || '')
                   .split(',')
                   .map(key => key.trim())
                   .filter(key => key.length > 0);
  if (keys.length === 0) {
    response.status(503).json({
      error: 'This API has no keys configured, writes are disabled',
    });
    return;
  }

  const authorization = request.get('authorization') || '';
  const provided = authorization.startsWith('Bearer ') ?
      authorization.slice('Bearer '.length).trim() :
      (request.get('x-api-key') || '').trim();

  if (!provided || !keys.some(key => safeEqual(key, provided))) {
    response.status(401).json({
      error: 'A valid API key is required. Ping @matt in the generals.io ' +
          'discord to get one for your bot.',
    });
    return;
  }
  next();
}

// the express server that will live inside the cloud function
const app = express();
const main = express();
main.use(express.json());
main.use(cors);
main.use('/v1', app);

// the actual cloud function
export const api =
    functions.runWith({secrets: [API_KEYS_ENV]}).https.onRequest(main);

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
app.get('/events/:eventId/lobby/:name', requireApiKey, async (request, response) => {
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
app.post('/events/:eventId/join/:name', requireApiKey, async (request, response) => {
  try {
    const {eventId, name} = request.params;
    if (!eventId) throw new Error('eventId is blank');
    if (!name) throw new Error('name is blank');

    const eventRef = db.collection('events').doc(eventId);

    // ensure the eventId exists
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
      response.json({success: false, message: 'event doesn\'t exist'});
      return;
    }

    // ensure this user doesn't already exist
    const player = await eventRef.collection('players').doc(name).get();
    if (player.exists) {
      response.json({
        success: false,
        message: `${name} is already in this event`,
      });
      return;
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
app.post('/events/:eventId/queue/:name', requireApiKey, async (request, response) => {
  try {
    const {eventId, name} = request.params;
    if (!eventId) throw new Error('eventId is blank');
    if (!name) throw new Error('name is blank');

    // ensure the event exists
    const snapshot = await db.collection('events').doc(eventId).get();
    if (!snapshot.exists) {
      response.json({success: false, message: 'event doesn\'t exist'});
      return;
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

/**
 * Record a qualified player's answer to the season championship modal shown on
 * generals.io. The generals.io SERVER calls this (never the game client) after
 * resolving the player's username from their credential, so it is a
 * server-to-server call protected by the API key like the bot endpoints.
 *
 * body: {username: string, response: 'yes' | 'maybe' | 'no'}
 */
app.post('/season-event/respond', requireApiKey, async (request, response) => {
  try {
    const {username, response: answer} = request.body || {};
    if (typeof username !== 'string' || !username.trim() ||
        username.includes('/')) {
      response.status(400).json({error: 'username is required'});
      return;
    }

    const {arrayUnion, arrayRemove} = admin.firestore.FieldValue;
    const updates: {[answer: string]: {[field: string]: unknown}} = {
      // they are registering, so they no longer need to be prompted
      yes: {'seasonEndEvent.qualified': arrayRemove(username)},
      maybe: {'seasonEndEvent.remindLater': arrayUnion(username)},
      no: {'seasonEndEvent.notInterested': arrayUnion(username)},
    };
    if (typeof answer !== 'string' || !updates[answer]) {
      response.status(400).json({error: 'response must be yes, maybe, or no'});
      return;
    }

    await db.collection('generals.io').doc('homepage').update(updates[answer]);
    response.json({success: true});
  } catch (error) {
    console.error(error);
    response.status(500).json({error: 'could not record response'});
  }
});
