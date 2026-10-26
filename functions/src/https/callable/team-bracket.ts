import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {EventFormat, EventType} from '../../../../types';
import {TeamBracketOperations} from '../../util/TeamBracketOperations';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

const MAX_EVENT_ID = 100;
const MAX_NAME = 30;
const MAX_TEAM_NAME = 20;

const PAYLOAD_KEYS: {[key: string]: string[]} = {
  sendInvite: ['target'],
  acceptInvite: ['captain'],
  declineInvite: ['captain'],
  cancelInvite: ['target'],
  leaveTeam: [],
  renameTeam: ['name'],
  withdrawPlayer: ['name'],
};

const safeName = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      value.includes('/') || value.length > MAX_NAME) {
    throw new functions.https.HttpsError(
        'invalid-argument', `Invalid ${field}`);
  }
  return value;
};

const safeTeamName = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > MAX_TEAM_NAME) {
    throw new functions.https.HttpsError(
        'invalid-argument', 'Invalid name');
  }
  return value;
};

/**
 * Invitation-based Big Team (non-arena) roster actions. Same auth shape
 * as teamArenaAction: caller is context.auth.uid, organizers come from
 * generals.io/admins only.
 */
export const teamBracketAction =
    functions.https.onCall(async (data: unknown, context) => {
      if (!context.auth || typeof context.auth.uid !== 'string' ||
          !context.auth.uid || context.auth.uid.includes('/') ||
          context.auth.uid.length > MAX_NAME ||
          context.auth.uid !== context.auth.uid.trim()) {
        throw new functions.https.HttpsError(
            'unauthenticated', 'Log in to manage a Big Team');
      }
      const caller = context.auth.uid;

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Malformed request');
      }
      for (const key of Object.keys(data as object)) {
        if (!['eventId', 'action', 'payload'].includes(key)) {
          throw new functions.https.HttpsError(
              'invalid-argument', 'Unexpected request field');
        }
      }
      const {eventId, action, payload} = data as {
        eventId?: unknown, action?: unknown, payload?: unknown};
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
      // every field validated before any Firestore read
      for (const key of ['target', 'captain']) {
        if (key in body) {
          safeName(body[key], key);
        }
      }
      if ('name' in body) {
        if (action === 'renameTeam') {
          safeTeamName(body.name);
        } else {
          safeName(body.name, 'name');
        }
      }
      if ((action === 'sendInvite' || action === 'cancelInvite') &&
          body.target === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Missing target');
      }
      if ((action === 'acceptInvite' || action === 'declineInvite') &&
          body.captain === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Missing captain');
      }
      if (action === 'renameTeam' && body.name === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument', 'Missing name');
      }

      const eventDoc = await db.doc(`events/${eventId}`).get();
      const event = eventDoc.data();
      if (!eventDoc.exists || !event ||
          event.type !== EventType.BIG_TEAM ||
          event.format === EventFormat.ARENA) {
        throw new functions.https.HttpsError(
            'not-found', 'Not a Big Team event');
      }

      let organizer = false;
      try {
        const admins = await db.doc('generals.io/admins').get();
        const names = admins.exists &&
            Array.isArray(admins.data()?.names) ? admins.data()!.names : [];
        organizer = names.includes(caller);
      } catch (e) {
        organizer = false;
      }

      const ops = new TeamBracketOperations(db, caller, organizer);
      try {
        switch (action) {
          case 'sendInvite':
            await ops.sendInvite(eventId, body.target as string);
            break;
          case 'acceptInvite':
            await ops.acceptInvite(eventId, body.captain as string);
            break;
          case 'declineInvite':
            await ops.declineInvite(eventId, body.captain as string);
            break;
          case 'cancelInvite':
            await ops.cancelInvite(eventId, body.target as string);
            break;
          case 'leaveTeam':
            await ops.leaveTeam(eventId);
            break;
          case 'renameTeam':
            await ops.renameTeam(
                eventId, body.name === undefined ? '' :
                body.name as string);
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
        }
      } catch (error) {
        if (error instanceof functions.https.HttpsError) {
          throw error;
        }
        throw new functions.https.HttpsError(
            'failed-precondition',
            error instanceof Error ? error.message : 'Action failed');
      }
      return {success: true};
    });
