import {default as http} from 'axios';

import {GeneralsServer, SITE_URLS} from '../../../servers';
import {IGeneralsReplay} from '../../../types';

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