'use strict';

// a permissive no-op module for browser/backend-only packages whose value
// imports are never exercised by the tests (firebase-functions,
// firebase-admin, @angular/fire, @ionic/angular, @angular/router). Any
// property access returns the same callable proxy, so arbitrary chains
// like functions.firestore.document('x').onWrite(fn) load harmlessly.
const anyFn = new Proxy(function() {}, {
  get: (target, prop) => {
    return typeof prop === 'symbol' ? undefined : anyFn;
  },
  apply: () => anyFn,
});

module.exports = anyFn;
