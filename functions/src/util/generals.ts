import {default as http} from 'axios';

import {GeneralsServer, SITE_URLS} from '../../../constants';
import {IGeneralsReplay, TournamentType} from '../../../types';
import {timeoutAfter} from './util';

export function getLastReplayForUsername(
    name: string,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay> {
  return getReplaysForUsername(name, 0, 1, server).then(games => games[0]);
}

export function getReplaysForUsername(
    name: string,
    offset: number,
    count: number,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay[]> {
  const url = `${SITE_URLS[server]}/api/replaysForUsername?u=${
      encodeURIComponent(name)}&offset=${offset}&count=${count}`;
  return http.get(url).then((response: {data: IGeneralsReplay[]}) => {
    return response.data;
  });
}

const typesMap = {
  [TournamentType.FFA]: 'ffa',
  [TournamentType.ONE_VS_ONE]: 'duel',
};
export function getCurrentStars(
    name: string,
    type: TournamentType,
    server = GeneralsServer.NA,
    ): Promise<number> {
  const url =
      `${SITE_URLS[server]}/api/starsAndRanks?u=${encodeURIComponent(name)}`;
  const generalsStars = http.get(url).then((response) => {
    return Number(response.data.stars[typesMap[type]]);
  });

  return Promise.race([generalsStars, timeoutAfter(1000, 0)]);
}