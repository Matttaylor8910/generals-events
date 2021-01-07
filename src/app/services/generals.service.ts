import {EventEmitter, Injectable} from '@angular/core';

const GENERALS_NAME = 'generals-name';
@Injectable({providedIn: 'root'})
export class GeneralsService {
  name = localStorage.getItem(GENERALS_NAME);
  nameChanged$ = new EventEmitter();

  constructor() {}

  goToProfile(name: string) {
    window.open(`http://generals.io/profiles/${encodeURIComponent(name)}`);
  }

  joinLobby(name: string) {
    window.open(`http://generals.io/games/${name}`);
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
