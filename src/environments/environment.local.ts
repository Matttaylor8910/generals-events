// Local development environment for running the events app entirely against
// the Firebase emulator suite. The API key/appId below are public dummy
// values — the Auth/Firestore/Functions emulators do not verify them.
export const environment = {
  production: false,
  localEmulators: true,
  firebase: {
    apiKey: 'demo-generals-local-api-key',
    authDomain: 'demo-generals-local.firebaseapp.com',
    projectId: 'demo-generals-local',
    storageBucket: 'demo-generals-local.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
    measurementId: 'G-LOCAL00000'
  },
  localServices: {
    gioUrl: 'http://localhost:8080',
    authPort: 9099,
    firestorePort: 8089,
    functionsPort: 5001,
  },
};
