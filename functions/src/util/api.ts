import {default as http} from 'axios';

import {IGeneralsReplay} from '../../../types';

export function getLastReplayForUsername(name: string):
    Promise<IGeneralsReplay> {
  return getReplaysForUsername(name, 0, 1).then(games => games[0]);
}

export function getReplaysForUsername(
    name: string,
    offset: number,
    count: number,
    ): Promise<IGeneralsReplay[]> {
  const url = `http://generals.io/api/replaysForUsername?u=${name}&offset=${
      offset}&count=${count}`;
  return http.get(url).then((response: {data: IGeneralsReplay[]}) => {
    return response.data;
  });
}