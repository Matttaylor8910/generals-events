export enum GeneralsServer {
  NA = 'na',
  EU = 'eu',
  BOT = 'bot',
}

export const SITE_URLS = {
  [GeneralsServer.NA]: 'http://generals.io',
  [GeneralsServer.EU]: 'http://eu.generals.io',
  [GeneralsServer.BOT]: 'http://bot.generals.io',
};

export const ADMINS = [
  'Automated Message',
  'only_human',
  'googleman',
  'Lazerpent',
  'DavidC',
];

export const HIDE_COMPLETED = 'generals-hide-completed';
