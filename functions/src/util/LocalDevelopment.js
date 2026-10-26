// Node-only local-development URL resolution for the emulator suite.
// Every local override is guarded: it only applies when the functions
// emulator is running under the demo-generals-local project against a
// loopback Firestore emulator, and every supplied URL must itself be
// loopback http(s) with no userinfo, query, or fragment. Anything else
// fails closed — never a real cloud call for a "loc" server.

const LOCAL_PROJECT = 'demo-generals-local';
const DEFAULT_GIO_URL = 'http://localhost:8080';
const DEFAULT_REPLAY_URL = 'http://127.0.0.1:9000/generalsio-replays-dev';

function isLoopback(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password || parsed.search ||
        parsed.hash) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' ||
        host === '::1' || host === '[::1]';
  } catch (e) {
    return false;
  }
}

function localEnvActive() {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    return false;
  }
  const project = process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== LOCAL_PROJECT) {
    return false;
  }
  // FIRESTORE_EMULATOR_HOST is a bare host:port — validate it as one, not
  // as a URL (paths/userinfo must never slip through)
  const firestore = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^[a-z0-9.\-[\]:]+$/i.test(firestore)) {
    return false;
  }
  return isLoopback('http://' + firestore);
}

function guardedUrl(envValue, fallback, label) {
  if (!localEnvActive()) {
    return null;
  }
  if (!envValue) {
    return fallback;
  }
  if (!isLoopback(envValue)) {
    throw new Error(`${label} must be a loopback http(s) URL`);
  }
  return envValue.replace(/\/+$/, '');
}

function localGioBaseUrl() {
  return guardedUrl(process.env.EVENTS_LOCAL_GIO_URL,
      DEFAULT_GIO_URL, 'EVENTS_LOCAL_GIO_URL');
}

function localReplayBaseUrl() {
  return guardedUrl(process.env.EVENTS_LOCAL_REPLAY_BASE_URL,
      DEFAULT_REPLAY_URL, 'EVENTS_LOCAL_REPLAY_BASE_URL');
}

module.exports = {localGioBaseUrl, localReplayBaseUrl, localEnvActive};
