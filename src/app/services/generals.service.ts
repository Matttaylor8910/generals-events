import {EventEmitter, Injectable} from '@angular/core';
import {GeneralsServer, SITE_URLS} from 'servers';

const GENERALS_NAME = 'generals-name';
@Injectable({providedIn: 'root'})
export class GeneralsService {
  name = localStorage.getItem(GENERALS_NAME);
  nameChanged$ = new EventEmitter();

  constructor() {}

  goToProfile(name: string, server = GeneralsServer.NA) {
    window.open(
        `${SITE_URLS[server]}/profiles/${encodeURIComponent(name)}`, '_blank');
  }

  goToReplay(replayId: string, server = GeneralsServer.NA) {
    window.open(`${SITE_URLS[server]}/replays/${replayId}`, '_blank');
  }

  joinLobby(name: string, server = GeneralsServer.NA) {
    location.href = `${SITE_URLS[server]}/games/${name}`, '_blank';
  }

  setName(name: string) {
    localStorage.setItem(GENERALS_NAME, name);
    this.name = name;
    this.nameChanged$.emit();
  }

  logout() {
    localStorage.removeItem(GENERALS_NAME);
    delete this.name;
    this.nameChanged$.emit();
  }
}
