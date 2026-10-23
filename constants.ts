export enum GeneralsServer {
  NA = 'na',
  EU = 'eu',
  BOT = 'bot',
  EKLIPZ = 'ek',
  LOCAL = 'loc'
}

export const SITE_URLS = {
  [GeneralsServer.NA]: 'https://generals.io',
  [GeneralsServer.EU]: 'https://eu.generals.io',
  [GeneralsServer.BOT]: 'https://bot.generals.io',
  [GeneralsServer.EKLIPZ]: 'http://45.50.38.248:8080',
  [GeneralsServer.LOCAL]: 'http://localhost:8080',
};

// the sender name used for system messages in event chat, never a real login
export const SYSTEM_SENDER = 'Automated Message';

// event organizers, used for UI gating only. The database checks the names in
// the generals.io/admins document (see firestore.rules), keep the two in sync.
export const ADMINS = [
  SYSTEM_SENDER,
  'only_human',
  'googleman',
  'Lazerpent',
  'DavidC',
  'matt',
  'pasghetti',
  'Wuped',
  'Fekete',
  'mashiro',
  'EklipZ',
];

export const HIDE_COMPLETED = 'generals-hide-completed';
