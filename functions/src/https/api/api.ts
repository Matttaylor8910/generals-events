import * as express from 'express';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db: admin.firestore.Firestore = admin.firestore();

// the express server that will live inside the cloud function
const app = express();
const main = express();
main.use('/api/v1', app);
main.use(express.json());

// the actual cloud function
export const webApi = functions.https.onRequest(main);

app.get('/', async (request, response) => {
  response.send(`
    Welcome! This API is currently intended as a way for bot players to play in
    a generals.io tournament. Feel free to ping @googleman in the generals.io
    discord for more information.
  `);
});

/**
 * Return the tournament matching the id provided, or return null if not found
 */
app.get('/tournaments/:tournamentId', async (request, response) => {
  try {
    const {tournamentId} = request.params;
    if (!tournamentId) throw new Error('tournamentId is blank');

    const snapshot = await db.collection('tournaments').doc(tournamentId).get();
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
app.get('/tournaments/:tournamentId/lobby/:name', async (request, response) => {
  try {
    const {tournamentId, name} = request.params;
    if (!tournamentId) throw new Error('tournamentId is blank');
    if (!name) throw new Error('name is blank');

    const redirects = await db.collection('tournaments')
                          .doc(tournamentId)
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
 * Add a given player to a given tournament
 */
app.post('/tournaments/:tournamentId/join/:name', async (request, response) => {
  try {
    const {tournamentId, name} = request.params;
    if (!tournamentId) throw new Error('tournamentId is blank');
    if (!name) throw new Error('name is blank');

    const tournamentRef = db.collection('tournaments').doc(tournamentId);

    // ensure the tournament exists
    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) {
      response.json({success: false, message: 'tournament doesn\'t exist'});
    }

    // ensure this user doesn't already exist
    const player = await tournamentRef.collection('players').doc(name).get();
    if (player.exists) {
      response.json({
        success: false,
        message: `${name} is already in this tournament`,
      });
    }

    // add the player to the tournament
    try {
      await tournamentSnapshot.ref.collection('players').doc(name).create({
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
 * Add a given player to the queue in a given tournament
 */
app.post(
    '/tournaments/:tournamentId/queue/:name', async (request, response) => {
      try {
        const {tournamentId, name} = request.params;
        if (!tournamentId) throw new Error('tournamentId is blank');
        if (!name) throw new Error('name is blank');

        // ensure the tournament exists
        const snapshot =
            await db.collection('tournaments').doc(tournamentId).get();
        if (!snapshot.exists) {
          response.json({success: false, message: 'tournament doesn\'t esist'});
        }

        // add the player to the tournament queue
        await snapshot.ref.update({
          queue: admin.firestore.FieldValue.arrayUnion(name),
        });

        response.json({success: true});
      } catch (error) {
        response.status(500).send(error);
      }
    });
