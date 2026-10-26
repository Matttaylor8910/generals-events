import firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/functions';

import {environment} from './environments/environment';
import {GeneralsServer, SITE_URLS} from '../constants';

/**
 * Point the real Firebase SDK at the local emulator suite before any
 * AngularFire service can materialize a connection. This module must be
 * imported before AngularFireModule.initializeApp runs (app.module does so)
 * so that auth/firestore/functions all bind to loopback emulators instead
 * of any real Google backend. No-op unless environment.localEmulators.
 */
interface LocalServices {
  gioUrl: string;
  authPort: number;
  firestorePort: number;
  functionsPort: number;
}

const localEnvironment = environment as typeof environment & {
  localEmulators?: boolean;
  localServices?: LocalServices;
};

function validPort(port: number, name: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
        `localEmulators ${name} must be an integer port between 1-65535`);
  }
  return port;
}

function loopbackGioOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password) {
    throw new Error('localEmulators gioUrl must not carry credentials');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('localEmulators gioUrl must be http(s)');
  }
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
        'localEmulators gioUrl must be a loopback origin (127.0.0.1)');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
        'localEmulators gioUrl must be a bare origin (no path/query)');
  }
  return url.origin;
}

export function setupLocalEmulators() {
  if (!localEnvironment.localEmulators) {
    return;
  }
  const projectId = (environment.firebase || {}).projectId;
  if (projectId !== 'demo-generals-local') {
    throw new Error(
        'localEmulators requires the demo-generals-local Firebase project');
  }
  const host = (window.location.hostname || '').toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
        'localEmulators only runs against a loopback browser origin');
  }
  const services = localEnvironment.localServices;
  if (!services) {
    throw new Error(
        'localEmulators requires environment.localServices ports/URLs');
  }
  const authPort = validPort(services.authPort, 'authPort');
  const firestorePort = validPort(services.firestorePort, 'firestorePort');
  const functionsPort = validPort(services.functionsPort, 'functionsPort');
  const gioOrigin = loopbackGioOrigin(services.gioUrl);
  const app = firebase.apps.length ?
      firebase.app() : firebase.initializeApp(environment.firebase);
  // a pre-existing app pointing at a different project must never fall
  // through into emulator bindings
  if ((app.options as {projectId?: string}).projectId !== projectId) {
    throw new Error(
        'localEmulators found an app bound to a different Firebase project');
  }
  // bind the SDK to the configured emulator ports before AngularFire boots
  app.auth().useEmulator(`http://127.0.0.1:${authPort}`);
  app.firestore().settings({host: `127.0.0.1:${firestorePort}`, ssl: false});
  app.functions().useEmulator('127.0.0.1', functionsPort);
  // the local generals.io backend lives on the configured isolated port;
  // mutating SITE_URLS here is safe because this module only runs before
  // the Angular app boots — backend code never imports the frontend env
  SITE_URLS[GeneralsServer.LOCAL] = gioOrigin;
}
