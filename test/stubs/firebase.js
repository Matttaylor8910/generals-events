'use strict';

// 'firebase' stand-in: firebase.default.firestore() returns the fake
// Firestore instance the test installed on global.__testFirestore, and
// FieldValue produces sentinel objects the fake resolves on write
function firestore() {
  return global.__testFirestore;
}

firestore.FieldValue = {
  arrayUnion: (...values) => ({ __sentinel: 'arrayUnion', values }),
  arrayRemove: (...values) => ({ __sentinel: 'arrayRemove', values }),
  increment: value => ({ __sentinel: 'increment', value }),
  serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
  delete: () => ({ __sentinel: 'delete' }),
};

module.exports = {
  default: { firestore },
  firestore,
};
