// Isolated local development: the events app runs against the test-owned
// emulator suite (auth 9199 / firestore 8189 / functions 5101) and the
// test-owned generals.io server on 8180 — never the user's ports.
import {environment as base} from './environment.local';

export const environment = {
  ...base,
  localServices: {
    gioUrl: 'http://localhost:8180',
    authPort: 9199,
    firestorePort: 8189,
    functionsPort: 5101,
  },
};
