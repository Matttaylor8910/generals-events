import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {isTeamArena} from '../../../../team-arena';
import {TeamArenaOperations} from '../../util/TeamArenaOperations';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

const MAX_EVENT_ID = 100;
const MAX_NAME = 30;
const MAX_TEAM_NAME = 20;

// every ordinary user-visible error from the operations layer
const userMessage = (error: unknown) =>
    error instanceof Error ? error.message :
    'Team arena action failed';

// only the exact allowed keys for each action survive; caller identity is
// never taken from the payload
const PAYLOAD_KEYS: {[key: string]: string[]} = {
  register: [],
  createTeam: ['teamName'],
  requestTeam: ['teamId'],
  acceptPlayer: ['memberName'],
  setTeamOptions: ['acceptFill', 'allowShortHanded', 'name'],
  joinRandomTeam: [],
  markNoShow: ['memberName'],
  leaveTeam: [],
  withdrawPlayer: ['name'],
  setReady: ['ready'],
  finalize: [],
};

// public usernames and document ids: exact identity, never trimmed into
// another name
const safeName = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      value.includes('/') || value.length > MAX_NAME) {
    throw new functions.https.HttpsError(
        'invalid-argument', `Invalid ${field}`);
  }
  return value;
};

// free-form team display name: any string up to the display bound is
// legal — it is never a document path, so '/' and interior whitespace are
// fine; a blank name keeps the default naming
const safeTeamName = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > MAX_TEAM_NAME) {
    throw new functions.https.HttpsError(
        'invalid-argument', 'Invalid teamName');
  }
  return value;
};

/**
 * All client team arena mutations route through this callable. The caller
 * is context.auth.uid (the public username); organizer authority comes
 * from the generals.io/admins Firestore document only.
 */
export const teamArenaAction =
    functions.https.onCall(async (data: unknown, context) => {
      if (!context.auth || typeof context.auth.uid !== 'string' ||
          !context.auth.uid || context.auth.uid.includes('/') ||
          context.auth.uid.length > MAX_NAME ||
          context.auth.uid !== context.auth.uid.trim()) {
        throw new functions.https.HttpsError(
            'unauthenticated', 'Log in to manage a team arena');
      }
      // the exact authenticated username is the identity; never trimmed
      // or remapped
      const caller = context.auth.uid;

      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Malformed request');
      }
      for (const key of Object.keys(data as Record<string, unknown>)) {
        if (!['eventId', 'action', 'payload'].includes(key)) {
          throw new functions.https.HttpsError(
              'invalid-argument', 'Unexpected request field');
        }
      }
      const {eventId, action, payload} = data as {
        eventId?: unknown, action?: unknown, payload?: unknown};

      // exact identity: surrounding whitespace is rejected, not trimmed
      // into a different event id
      if (typeof eventId !== 'string' || !eventId ||
          eventId !== eventId.trim() || eventId.includes('/') ||
          eventId.length > MAX_EVENT_ID) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Invalid eventId');
      }
      if (typeof action !== 'string' ||
          !Object.prototype.hasOwnProperty.call(PAYLOAD_KEYS, action)) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Unknown action');
      }
      if (typeof payload !== 'undefined' &&
          (typeof payload !== 'object' || payload === null ||
              Array.isArray(payload))) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Invalid payload');
      }
      const body = (payload || {}) as {[key: string]: unknown};
      for (const key of Object.keys(body)) {
        if (!PAYLOAD_KEYS[action].includes(key)) {
          throw new functions.https.HttpsError(
              'invalid-argument', 'Unexpected payload field');
        }
      }
      // every payload field validated before any Firestore read
      for (const key of ['acceptFill', 'allowShortHanded', 'ready']) {
        if (key in body && typeof body[key] !== 'boolean') {
          throw new functions.https.HttpsError(
              'invalid-argument', `Invalid ${key}`);
        }
      }
      for (const key of ['teamId', 'memberName']) {
        if (key in body) {
          safeName(body[key], key);
        }
      }
      if ('teamName' in body) {
        safeTeamName(body.teamName);
      }
      // `name` is a target username for withdrawPlayer but a display name
      // for setTeamOptions
      if ('name' in body) {
        if (action === 'setTeamOptions') {
          safeTeamName(body.name);
        } else {
          safeName(body.name, 'name');
        }
      }
      if (action === 'setReady' && typeof body.ready !== 'boolean') {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Invalid ready');
      }
      if (action === 'requestTeam' && body.teamId === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Missing teamId');
      }
      if ((action === 'acceptPlayer' || action === 'markNoShow') &&
          body.memberName === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Missing memberName');
      }

      // the event must actually be a team arena
      const eventDoc = await db.doc(`events/${eventId}`).get();
      if (!eventDoc.exists || !isTeamArena(eventDoc.data())) {
        throw new functions.https.HttpsError(
            'not-found', 'Not a team arena event');
      }

      // organizer authority is the Firestore admins doc, fail closed
      let organizer = false;
      try {
        const admins = await db.doc('generals.io/admins').get();
        const names = admins.exists &&
            Array.isArray(admins.data()?.names) ? admins.data()!.names : [];
        organizer = names.includes(caller);
      } catch (e) {
        organizer = false;
      }

      const ops = new TeamArenaOperations(db, caller, organizer);
      try {
        switch (action) {
          case 'register':
            await ops.register(eventId);
            break;
          case 'createTeam':
            await ops.createTeam(eventId,
                body.teamName === undefined ? '' :
                safeTeamName(body.teamName));
            break;
          case 'requestTeam':
            await ops.requestTeam(eventId,
                safeName(body.teamId, 'teamId'));
            break;
          case 'acceptPlayer':
            await ops.acceptPlayer(eventId,
                safeName(body.memberName, 'memberName'));
            break;
          case 'setTeamOptions': {
            // omitted fields stay omitted so toggling one option never
            // clears another
            const options: {
              acceptFill?: boolean, allowShortHanded?: boolean,
              name?: string} = {};
            if ('acceptFill' in body) options.acceptFill = body.acceptFill as boolean;
            if ('allowShortHanded' in body) {
              options.allowShortHanded = body.allowShortHanded as boolean;
            }
            if ('name' in body) options.name = body.name as string;
            await ops.setTeamOptions(eventId, options);
            break;
          }
          case 'joinRandomTeam':
            await ops.joinRandomTeam(eventId);
            break;
          case 'markNoShow':
            await ops.markNoShow(eventId,
                safeName(body.memberName, 'memberName'));
            break;
          case 'leaveTeam':
            await ops.leaveTeam(eventId);
            break;
          case 'withdrawPlayer':
            if (body.name !== undefined && body.name !== caller &&
                !organizer) {
              throw new functions.https.HttpsError(
                  'permission-denied',
                  'You can only remove yourself from an event');
            }
            await ops.withdrawPlayer(eventId,
                body.name === undefined ? caller : body.name as string);
            break;
          case 'setReady':
            if (typeof body.ready !== 'boolean') {
              throw new functions.https.HttpsError(
                  'invalid-argument', 'Invalid ready');
            }
            await ops.setReady(eventId, body.ready);
            break;
          case 'finalize':
            if (!organizer) {
              throw new functions.https.HttpsError(
                  'permission-denied', 'Only an organizer can finalize');
            }
            await ops.finalize(eventId);
            break;
        }
      } catch (error) {
        if (error instanceof functions.https.HttpsError) {
          throw error;
        }
        throw new functions.https.HttpsError(
            'failed-precondition', userMessage(error));
      }
      return {success: true};
    });
