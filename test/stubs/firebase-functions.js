'use strict';

// 'firebase-functions' stand-in that registers trigger handlers into
// __handlers so tests can invoke the real exported handlers directly,
// e.g. __handlers['events/{eventId}/games/{gameId}'].onWrite.

const __handlers = {};

function registrar(path) {
  __handlers[path] = __handlers[path] || {};
  return {
    onWrite: fn => { __handlers[path].onWrite = fn; return fn; },
    onCreate: fn => { __handlers[path].onCreate = fn; return fn; },
    onUpdate: fn => { __handlers[path].onUpdate = fn; return fn; },
    onDelete: fn => { __handlers[path].onDelete = fn; return fn; },
  };
}

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'HttpsError';
  }
}

const functions = {
  firestore: {document: registrar},
  https: {
    onRequest: fn => fn,
    onCall: fn => fn,
    HttpsError,
  },
  runWith: () => functions,
  region: () => functions,
  config: () => ({}),
};

module.exports = functions;
module.exports.__handlers = __handlers;
