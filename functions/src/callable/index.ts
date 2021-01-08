import * as crypto from 'crypto-js';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}

// firebase functions:config:set generals.encryption="secret-key"
const ENCRYPTION_KEY = functions.config().generals.encryption;

export const decryptUsername = functions.https.onCall((encryptedString) => {
  return crypto.AES.decrypt(encryptedString, ENCRYPTION_KEY);
});
