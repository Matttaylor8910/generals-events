import {Injectable} from '@angular/core';

@Injectable({providedIn: 'root'})
export class GeneralsService {
  constructor() {}

  goToProfile(name: string) {
    window.open(`http://generals.io/profiles/${encodeURIComponent(name)}`);
  }
}
