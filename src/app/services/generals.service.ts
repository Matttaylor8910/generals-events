import {EventEmitter, Injectable} from '@angular/core';
import {AngularFireFunctions} from '@angular/fire/functions';
import {Router} from '@angular/router';
import {GeneralsServer, SITE_URLS} from '../../../constants';
import {UtilService} from './util.service';

const GENERALS_NAME = 'generals-name';
@Injectable({providedIn: 'root'})
export class GeneralsService {
  name = localStorage.getItem(GENERALS_NAME);
  nameChanged$ = new EventEmitter();

  constructor(
      private readonly aff: AngularFireFunctions,
      private readonly router: Router,
      private readonly utilService: UtilService,
  ) {}

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

  async decryptUsername(encryptedString: string): Promise<string> {
    const decryptUsername =
        this.aff.httpsCallable<string, string>('decryptUsername');
    return await decryptUsername(encryptedString).toPromise();
  }

  async login(tournamentId: string, join: boolean, server = GeneralsServer.NA) {
    if (tournamentId) {
      localStorage.setItem('generals-last-tournament', tournamentId);
      localStorage.setItem('generals-join', String(join || false));
    }

    if (location.href.includes('localhost')) {
      const name = await this.utilService.promptForText();
      if (name) {
        this.handleDidLogin(name);
        setTimeout(() => {
          location.reload();  // reload for dev to mimick the redirect
        });
      }
    } else {
      location.href = `${SITE_URLS[server]}/?eventGetUsername=true`;
    }
  }

  /**
   * Set the given name to be the logged in user. A tournamentId can be passed
   * as the tournament to redirect to after logging in.
   *
   * Hitting a URL like the following will login as only_human and join the Jan
   * 2021 FFA tournament for example:
   * https://generals-tournaments.web.app/FFA-Jan-2021?encryptedUser=U2FsdGVkX18mHNxXmZ1WzCEtYugx86GG7AS7jLEBD1Y%3D&join=true
   *
   * @param name
   * @param currentTournament
   */
  handleDidLogin(name: string, tournamentId?: string) {
    this.setName(name);

    console.log(`set name to ${name}`);

    // support redirecting to a provided tournament, or the last one saved to
    // localStorage before redirecting to generals.io
    // also support auto-joining the tournament when you get there
    tournamentId =
        tournamentId || localStorage.getItem('generals-last-tournament');
    const join = localStorage.getItem('generals-join') ||
        location.href.includes('join=true');
    localStorage.removeItem('generals-last-tournament');
    localStorage.removeItem('generals-join');

    console.log(`tournamentId: ${tournamentId}, join? ${join}`);

    // redirect to either the tournament or home
    if (tournamentId) {
      const queryParams = join ? {join} : undefined;
      this.router.navigate(['/', tournamentId], {queryParams});
      console.log(`redirecting to tournament: ${tournamentId}`, queryParams);
    } else {
      this.router.navigate(['/']);
      console.log(`going home`);
    }
  }

  logout() {
    localStorage.removeItem(GENERALS_NAME);
    delete this.name;
    this.nameChanged$.emit();
  }
}
