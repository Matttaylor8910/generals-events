import {default as http} from 'axios';

import {GeneralsServer, SITE_URLS} from '../../../constants';
import {EventType, IGeneralsReplay} from '../../../types';

import {timeoutAfter} from './util';

export function getLastReplayForUsername(
    name: string,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay> {
  return getReplaysForUsername(name, 0, 1, server).then(games => games[0]);
}

export function getReplaysForUsername(
    name: string,
    offset = 0,
    count = 200,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay[]> {
  const url = `${SITE_URLS[server]}/api/replaysForUsername?u=${
      encodeURIComponent(name)}&offset=${offset}&count=${count}`;
  return http.get(url).then((response: {data: IGeneralsReplay[]}) => {
    return response.data;
  });
}

const typesMap = {
  [EventType.FFA]: 'ffa',
  [EventType.ONE_VS_ONE]: 'duel',
  [EventType.TWO_VS_TWO]: '2v2',

  // multi stage events themselves can be composed of several different events
  // with different formats, but for the purpose of showing stars during
  // registration, just use their duel (1v1) rating
  [EventType.MULTI_STAGE_EVENT]: 'duel',
};
export function getCurrentStars(
    name: string,
    type: EventType,
    server = GeneralsServer.NA,
    ): Promise<number> {
  const url =
      `${SITE_URLS[server]}/api/starsAndRanks?u=${encodeURIComponent(name)}`;
  const generalsStars = http.get(url).then((response) => {
    const stars = Number(response.data.stars[typesMap[type]]);
    return stars > 0 ? stars : 0;
  });

  return Promise.race([generalsStars, timeoutAfter(1000, 0)]);
}
