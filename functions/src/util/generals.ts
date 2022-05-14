import {default as http} from 'axios';

import {GeneralsServer, SITE_URLS} from '../../../constants';
import {EventType, IGeneralsRankings, IGeneralsReplay} from '../../../types';

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
    console.log(`loaded ${response.data.length} replays for ${name}`);
    return response.data;
  });
}

const typesMap = {
  [EventType.FFA]: 'ffa',
  [EventType.ONE_VS_ONE]: 'duel',

  [EventType.TWO_VS_TWO]: '2v2',
  
  // Use 1v1 rankings when the 2v2 stars return null
  // [EventType.TWO_VS_TWO]: 'duel',

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

export function getRankingsForSeason(season: number):
    Promise<IGeneralsRankings|null> {
  const url = `${SITE_URLS[GeneralsServer.NA]}/api/rankings?season=${season}`;
  const rankingsPromise = http.get(url).then((response) => {
    // if there is no season on this response, the first week of the season
    // hasn't completed yet, so we should return an empty season
    const hasSeason = response.data?.season !== undefined;
    if (!hasSeason) return {season, tsp: [], weeks: []};

    // if there are rankings, split out the tsp from the rest of the weeks
    const weeks = response.data.rankings;
    const [tsp] = weeks.splice(0, 1);

    // assume the data came back in the right shape
    return {season, tsp, weeks};
  });

  // the only case where we return null is if the request times out
  return Promise.race([rankingsPromise, timeoutAfter(5000, null)]);
}