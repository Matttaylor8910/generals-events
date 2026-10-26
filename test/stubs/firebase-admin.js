'use strict';

// 'firebase-admin' stand-in: admin.firestore() delegates every method the
// backend handlers use to the FakeFirestore instance the test installed on
// global.__testFirestore, and FieldValue produces the sentinel objects the
// fake resolves on write. No network or real Firestore is ever touched.

// delegate lazily so each test can install a fresh FakeFirestore on
// global.__testFirestore without re-requiring the handler modules
function firestore() {
  return {
    collection: name => global.__testFirestore.collection(name),
    doc: path => global.__testFirestore.doc(path),
    batch: () => global.__testFirestore.batch(),
    runTransaction: fn => global.__testFirestore.runTransaction(fn),
  };
}

firestore.FieldValue = {
  arrayUnion: (...values) => ({__sentinel: 'arrayUnion', values}),
  arrayRemove: (...values) => ({__sentinel: 'arrayRemove', values}),
  increment: value => ({__sentinel: 'increment', value}),
  serverTimestamp: () => ({__sentinel: 'serverTimestamp'}),
  delete: () => ({__sentinel: 'delete'}),
};

firestore.Timestamp = {
  now: () => Date.now(),
  fromMillis: ms => ms,
};

module.exports = {
  initializeApp: () => ({}),
  firestore,
};
