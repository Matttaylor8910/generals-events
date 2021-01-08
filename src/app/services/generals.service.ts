import {EventEmitter, Injectable} from '@angular/core';
import {AngularFireFunctions} from '@angular/fire/functions';
import {Router} from '@angular/router';
import {GeneralsServer, SITE_URLS} from '../../../servers';
import {TournamentService} from './tournament.service';

const GENERALS_NAME = 'generals-name';
@Injectable({providedIn: 'root'})
export class GeneralsService {
  name = localStorage.getItem(GENERALS_NAME);
  nameChanged$ = new EventEmitter();

  constructor(
      private readonly tournamentService: TournamentService,
      private readonly aff: AngularFireFunctions,
      private readonly router: Router,
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

    const lastTourney = localStorage.getItem('generals-last-tournament');
    if (lastTourney) {
      this.router.navigate(['/', lastTourney]);
    } else {
      this.router.navigate(['/']);
    }
    localStorage.removeItem('generals-last-tournament');
  }

  async decryptUsername(encryptedString: string): Promise<string> {
    const decryptUsername =
        this.aff.httpsCallable<string, string>('decryptUsername');
    return await decryptUsername(encryptedString).toPromise();
  }

  login(tournamentId?: string) {
    if (tournamentId) {
      localStorage.setItem('generals-last-tournament', tournamentId);
    }
    location.href = 'http://generals.io/?eventGetUsername=true';
  }

  logout(tournamentId?: string) {
    if (tournamentId && this.name) {
      this.tournamentService.removePlayer(tournamentId, this.name);
    }

    localStorage.removeItem(GENERALS_NAME);
    delete this.name;
    this.nameChanged$.emit();
  }
}
