// Bounded replay download with the same fallback policy the browser uses:
// regional S3 -> fresh saving-down check -> game-server backup -> S3 retry.
// This covers the migration race where a disk copy is deleted before S3
// becomes visible. Replay payloads are always requested as binary bodies.

const axios = require('axios').default;
const ReplayDeserializer = require('./ReplayDeserializer');
const LocalDevelopment = require('./LocalDevelopment');

const REPLAY_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SERVERS = ['na', 'eu', 'bot', 'ek', 'loc'];

// public backup origins per server — fixed whitelist, never user input
const BACKUP_ORIGINS = {
  na: 'https://generals.io',
  eu: 'https://eu.generals.io',
  bot: 'https://bot.generals.io',
  ek: 'http://45.50.38.248:8080',
};

function s3Url(server, id) {
  return `https://generalsio-replays-${server}.s3.amazonaws.com/${id}.gior`;
}

function backupUrl(server, id) {
  if (server === 'loc') {
    const gio = LocalDevelopment.localGioBaseUrl();
    if (!gio) {
      throw new Error('loc replays require the local emulator suite');
    }
    return `${gio}/api/replay/${encodeURIComponent(id)}`;
  }
  return `${BACKUP_ORIGINS[server]}/api/replay/${encodeURIComponent(id)}`;
}

function isBinary(value) {
  return Buffer.isBuffer(value) || value instanceof ArrayBuffer
      || ArrayBuffer.isView(value);
}

async function fetchAndDecode(url) {
  const response = await axios.get(url,
    { responseType: 'arraybuffer', timeout: 15000, maxRedirects: 0 });
  if (response.status !== undefined
      && (response.status < 200 || response.status >= 300)) {
    throw new Error('non-2xx response');
  }
  if (!isBinary(response.data) || !response.data.byteLength) {
    throw new Error('empty replay body');
  }
  // a decode failure counts as a failed attempt — corrupted bytes fall
  // through to the next source. Return the decoded replay so callers
  // never parse the same bytes twice.
  const data = response.data;
  const bytes = ArrayBuffer.isView(data)
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(data);
  return ReplayDeserializer(bytes);
}

async function savingDown(server) {
  const origin = server === 'loc'
      ? LocalDevelopment.localGioBaseUrl()
      : BACKUP_ORIGINS[server];
  try {
    const response = await axios.get(`${origin}/api/serverSettings`,
      { timeout: 10000, maxRedirects: 0 });
    return (response.status === undefined
        || (response.status >= 200 && response.status < 300))
        && response.data && response.data.aws_replay_saving_down === true;
  } catch (error) {
    return false;
  }
}

/**
 * Download and decode a replay for a whitelisted server region. Tries the
 * bounded sequence S3 -> backup -> S3 (or the guarded local equivalent)
 * and returns the first body that decodes; every failed attempt
 * (non-2xx, timeout, empty, undecodable) advances.
 */
async function getReplay(replayId, server = 'na') {
  if (typeof replayId !== 'string' || !REPLAY_ID.test(replayId)) {
    throw new Error('Invalid replay id');
  }
  if (!SERVERS.includes(server)) {
    throw new Error('Unknown replay server region');
  }
  let urls;
  if (server === 'loc') {
    // the same bounded sequence against local transports — MinIO storage,
    // the local GIO backup route, then MinIO once more
    const replayBase = LocalDevelopment.localReplayBaseUrl();
    if (!replayBase) {
      throw new Error('loc replays require the local emulator suite');
    }
    urls = [
      `${replayBase}/${replayId}.gior`,
      backupUrl('loc', replayId),
      `${replayBase}/${replayId}.gior`,
    ];
  } else {
    urls = [
      s3Url(server, replayId),
      backupUrl(server, replayId),
      s3Url(server, replayId),
    ];
  }
  for (const [index, url] of urls.entries()) {
    try {
      return await fetchAndDecode(url);
    } catch (error) {
      // Match GIO: a missing/false/non-boolean health flag never permits
      // the backup request. A healthy S3 never needs the settings endpoint.
      if (index === 0 && !await savingDown(server)) break;
    }
  }
  throw new Error('Replay is unavailable on storage and game server');
}

module.exports = { getReplay };
