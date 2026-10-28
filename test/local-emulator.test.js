// Offline guards and bounded-fallback coverage for the local emulator
// plumbing: LocalDevelopment URL guards, simulator ReplayLoader
// S3 -> backup -> S3 sequencing, loc-server local-only transport, and the
// root EventApiConfig override guard. No real network calls are made.
process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');
const axios = require(require.resolve('axios', {
  paths: [path.resolve(__dirname, '../functions')],
}));

const EVENTS = path.join(__dirname, '..');
const LocalDevelopment = require(
  path.join(EVENTS, 'functions/src/util/LocalDevelopment'));
// stub the deserializer so transport behavior, not fixture bytes, is under
// test — 'corrupt' bodies decode-fail like real bad data
const deserializerPath = require.resolve(
  path.join(EVENTS, 'functions/src/util/ReplayDeserializer'));
require.cache[deserializerPath] = {
  exports: buffer => {
    if (buffer && buffer.equals(Buffer.from('corrupt'))) {
      throw new Error('undecodable replay');
    }
    return { players: [], moves: [] };
  },
};
const ReplayLoader = require(
  path.join(EVENTS, 'functions/src/util/ReplayLoader'));
const { getEventsApiUrl } = require(
  path.resolve(EVENTS, '../server/EventApiConfig'));

// Transport-only payload; decoding is stubbed above. Real compressed game
// bytes and simulation are covered in the root test/EventReplayFallback.test.js.
function replayBytes() {
  return zlib.gzipSync(Buffer.from(JSON.stringify({
    version: 1, players: [], moves: [],
  })));
}

function withAxios(fn, ...healthValues) {
  const health = healthValues.length ? healthValues[0] : true;
  const calls = [];
  const settings = [];
  const origGet = axios.get;
  const origDefaultGet = axios.default && axios.default.get;
  axios.get = url => {
    if (url.endsWith('/api/serverSettings')) {
      settings.push(url);
      return Promise.resolve({ status: 200,
        data: { aws_replay_saving_down: health } });
    }
    calls.push(url);
    return fn(url, calls.length);
  };
  if (axios.default) {
    axios.default.get = axios.get;
  }
  return { calls, settings, restore() {
    axios.get = origGet;
    if (axios.default && origDefaultGet) {
      axios.default.get = origDefaultGet;
    }
  } };
}

function ok(bytes) {
  return Promise.resolve({ status: 200, data: bytes });
}
function httpError(status) {
  const e = new Error('status ' + status);
  e.response = { status };
  return Promise.reject(e);
}

async function expectThrow(promise, part, label) {
  try {
    await promise;
  } catch (e) {
    if (part && !String(e.message).includes(part)) {
      assert.fail(`${label}: wrong error: ${e.message}`);
    }
    return;
  }
  assert.fail(`${label}: expected rejection`);
}

async function main() {
  // LocalDevelopment guards: nothing resolves outside the emulator env
  {
    delete process.env.FUNCTIONS_EMULATOR;
    assert.strictEqual(LocalDevelopment.localGioBaseUrl(), null,
      'no local URL outside emulator');
    assert.strictEqual(LocalDevelopment.localReplayBaseUrl(), null);

    // the full emulator trio is required
    process.env.FUNCTIONS_EMULATOR = 'true';
    assert.strictEqual(LocalDevelopment.localGioBaseUrl(), null,
      'project alone is not enough');
    process.env.GCLOUD_PROJECT = 'demo-generals-local';
    assert.strictEqual(LocalDevelopment.localGioBaseUrl(), null,
      'firestore host alone is not enough');
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
    assert.strictEqual(LocalDevelopment.localGioBaseUrl(),
      'http://localhost:8080', 'default GIO origin');
    assert.strictEqual(LocalDevelopment.localReplayBaseUrl(),
      'http://127.0.0.1:9000/generalsio-replays-dev',
      'default MinIO replay base');

    // override URLs must be loopback and credential-free
    process.env.EVENTS_LOCAL_GIO_URL = 'https://generals.io';
    assert.throws(() => LocalDevelopment.localGioBaseUrl(),
      /loopback/, 'non-loopback override rejected');
    process.env.EVENTS_LOCAL_GIO_URL = 'http://user@127.0.0.1:8080';
    assert.throws(() => LocalDevelopment.localGioBaseUrl(),
      /loopback/, 'userinfo override rejected');
    process.env.EVENTS_LOCAL_GIO_URL = 'http://127.0.0.1:8080?x=1';
    assert.throws(() => LocalDevelopment.localGioBaseUrl(),
      /loopback/, 'query override rejected');
    process.env.EVENTS_LOCAL_GIO_URL = 'http://127.0.0.1:8080';
    assert.strictEqual(LocalDevelopment.localGioBaseUrl(),
      'http://127.0.0.1:8080', 'valid loopback override');
    delete process.env.EVENTS_LOCAL_GIO_URL;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    console.log('  local development guards passed');
  }

  // EventApiConfig: the override is debug-local-only and loopback-only
  {
    assert.strictEqual(getEventsApiUrl(),
      'https://us-central1-generals-tournaments.cloudfunctions.net/api/v1',
      'default events API preserved');
    process.env.EVENTS_LOCAL_API_URL
        = 'http://127.0.0.1:5001/demo-generals-local/us-central1/api/v1';
    assert.throws(() => getEventsApiUrl(), /local debug/,
      'override rejected under test env');
    process.env.NODE_ENV = 'debug';
    assert.throws(() => getEventsApiUrl(), /local debug/,
      'override rejected without the demo project');
    process.env.GCLOUD_PROJECT = 'demo-generals-local';
    assert.strictEqual(getEventsApiUrl(),
      'http://127.0.0.1:5001/demo-generals-local/us-central1/api/v1',
      'loopback override accepted under debug+demo');
    process.env.EVENTS_LOCAL_API_URL = 'https://generals.io';
    assert.throws(() => getEventsApiUrl(), /loopback/,
      'non-loopback override rejected');
    delete process.env.EVENTS_LOCAL_API_URL;
    delete process.env.GCLOUD_PROJECT;
    process.env.NODE_ENV = 'test';
    console.log('  event api config guard passed');
  }

  // ReplayLoader: bounded S3 -> backup -> S3 sequence, valid bytes only
  {
    const body = replayBytes();
    let t = withAxios(() => ok(body));
    const got = await ReplayLoader.getReplay('abc1', 'na');
    // the loader resolves the DECODED replay, never the raw bytes
    assert.deepStrictEqual(got, { players: [], moves: [] });
    assert.strictEqual(t.calls.length, 1, 'S3 hit short-circuits');
    assert.ok(t.calls[0].includes('generalsio-replays-na'));
    assert.strictEqual(t.settings.length, 0, 'healthy S3 needs no settings');
    t.restore();

    for (const health of [false, undefined, null, 'true', 1]) {
      t = withAxios(() => httpError(404), health);
      await expectThrow(ReplayLoader.getReplay('abc1', 'na'), 'unavailable');
      assert.strictEqual(t.calls.length, 1, 'only boolean true permits backup');
      assert.strictEqual(t.settings.length, 1, 'fresh settings checked once');
      t.restore();
    }

    t = withAxios((url, n) => n === 1 ? httpError(404) : ok(body));
    await ReplayLoader.getReplay('abc1', 'eu');
    assert.strictEqual(t.calls.length, 2, '404 falls to backup');
    assert.ok(t.calls[1].startsWith('https://eu.generals.io/api/replay/'));
    t.restore();

    t = withAxios((url, n) => n === 1 ? httpError(500) : ok(body));
    await ReplayLoader.getReplay('abc1', 'bot');
    assert.strictEqual(t.calls.length, 2, '5xx falls to backup');
    assert.ok(t.calls[1].startsWith('https://bot.generals.io/api/replay/'));
    t.restore();

    t = withAxios((url, n) =>
        n < 3 ? httpError(404) : ok(body));
    await ReplayLoader.getReplay('abc1', 'na');
    assert.strictEqual(t.calls.length, 3, 'backup 404 retries S3 once');
    t.restore();

    t = withAxios((url, n) => n === 1
        ? Promise.reject(new Error('timeout'))
        : ok(body));
    await ReplayLoader.getReplay('abc1', 'na');
    assert.strictEqual(t.calls.length, 2, 'timeout falls to backup');
    t.restore();

    t = withAxios(() => httpError(404));
    await expectThrow(ReplayLoader.getReplay('abc1', 'na'),
      'unavailable', 'all three sources fail');
    assert.strictEqual(t.calls.length, 3, 'exactly three attempts');
    t.restore();

    // empty or undecodable bodies count as failed attempts
    t = withAxios((url, n) => n === 1 ? ok(Buffer.alloc(0)) : ok(body));
    await ReplayLoader.getReplay('abc1', 'na');
    assert.strictEqual(t.calls.length, 2, 'empty body advances');
    t.restore();
    t = withAxios((url, n) =>
        n === 1 ? ok(Buffer.from('corrupt')) : ok(body));
    await ReplayLoader.getReplay('abc1', 'na');
    assert.strictEqual(t.calls.length, 2, 'undecodable body advances');
    t.restore();

    // never validate-or-request for bad input
    t = withAxios(() => ok(body));
    await expectThrow(ReplayLoader.getReplay('bad id!', 'na'), 'Invalid');
    await expectThrow(ReplayLoader.getReplay('abc1', 'xx'), 'Unknown');
    await expectThrow(ReplayLoader.getReplay(123, 'na'), 'Invalid');
    await expectThrow(ReplayLoader.getReplay(null, 'na'), 'Invalid');
    await expectThrow(ReplayLoader.getReplay(undefined, 'na'), 'Invalid');
    assert.strictEqual(t.calls.length, 0,
      'invalid id/region make zero HTTP calls');
    t.restore();
    console.log('  replay loader fallback passed');
  }

  // loc transport: guarded local URL only, never cloud
  {
    delete process.env.FUNCTIONS_EMULATOR;
    await expectThrow(ReplayLoader.getReplay('abc1', 'loc'),
      'emulator', 'loc rejects outside the emulator suite');
    process.env.FUNCTIONS_EMULATOR = 'true';
    process.env.GCLOUD_PROJECT = 'demo-generals-local';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
    const body = replayBytes();
    let t = withAxios(() => ok(body));
    await ReplayLoader.getReplay('abc1', 'loc');
    assert.strictEqual(t.calls.length, 1, 'MinIO hit short-circuits');
    assert.ok(t.calls[0].startsWith(
      'http://127.0.0.1:9000/generalsio-replays-dev/'),
    'loc uses the guarded MinIO base');
    assert.ok(!t.calls[0].includes('amazonaws'),
      'loc never reaches S3');
    t.restore();
    // a MinIO 404 falls back to the local GIO backup route
    t = withAxios((url, n) => n === 1 ? httpError(404) : ok(body));
    await ReplayLoader.getReplay('abc1', 'loc');
    assert.strictEqual(t.calls.length, 2, 'loc falls to local backup');
    assert.ok(t.calls[1].startsWith(
      'http://localhost:8080/api/replay/'),
    'loc backup is the local GIO replay route');
    t.restore();
    // and everything failing is bounded at three attempts
    t = withAxios(() => httpError(404));
    await expectThrow(ReplayLoader.getReplay('abc1', 'loc'),
      'unavailable', 'loc all-sources-fail');
    assert.strictEqual(t.calls.length, 3, 'loc bounded at three');
    t.restore();
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    console.log('  loc replay transport passed');
  }
  console.log('All local emulator tests passed!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
