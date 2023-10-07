import {EventEmitter, Injectable} from '@angular/core';
import {AngularFireFunctions} from '@angular/fire/functions';
import {Router} from '@angular/router';
import {GameSpeed, IEvent, IGeneralsGameOptions, IGeneralsReplay} from 'types';
import {GeneralsServer, SITE_URLS} from '../../../constants';
import {UtilService} from './util.service';

const DEFAULT_GAME_OPTIONS: IGeneralsGameOptions = {
  spectate_chat: true,
}

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

  joinLobby(
      name: string,
      event: IEvent,
      newTab = false,
      options: IGeneralsGameOptions = {},
  ) {
    const {
      server = GeneralsServer.NA,
      options: lobbyOptions,
    } = event;

    // override any default game options with those provided
    const queryParams = this.utilService.getParamString({
      ...DEFAULT_GAME_OPTIONS,
      ...lobbyOptions,
      ...options,
      eventId: event.id,
    });

    // append the query params to the game lobby url
    const url = `${SITE_URLS[server]}/games/${name}${queryParams}`;

    if (newTab) {
      window.open(url, '_blank');
    } else {
      location.href = url;
    }
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

  async loginFromEvent(event: IEvent, join: boolean) {
    const eventId = event?.parentId ?? event?.id;
    this.login(eventId, join, event.server);
  }

  async login(eventId: string, join: boolean, server = GeneralsServer.NA) {
    if (eventId) {
      localStorage.setItem('generals-last-event', eventId);
      localStorage.setItem('generals-join', String(join || false));
    }

    if (location.href.includes('localhost')) {
      const name = await this.utilService.promptForText(
          'Enter your generals.io username',
          'Your username must exactly match or your games won\'t count!',
          'generals.io username',
          'Join',
          'Cancel',
      );
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
   * Set the given name to be the logged in user. A eventId can be passed
   * as the event to redirect to after logging in.
   *
   * Hitting a URL like the following will login as only_human and join the Jan
   * 2021 FFA event for example:
   * https://generals-tournaments.web.app/FFA-Jan-2021?encryptedUser=U2FsdGVkX18mHNxXmZ1WzCEtYugx86GG7AS7jLEBD1Y%3D&join=true
   *
   * @param name
   * @param currentEvent
   */
  handleDidLogin(name: string, eventId?: string) {
    this.setName(name);

    console.log(`set name to ${name}`);

    // support redirecting to a provided event, or the last one saved to
    // localStorage before redirecting to generals.io
    // also support auto-joining the event when you get there
    eventId = eventId || localStorage.getItem('generals-last-event');
    const join = localStorage.getItem('generals-join') ||
        location.href.includes('join=true');
    localStorage.removeItem('generals-last-event');
    localStorage.removeItem('generals-join');

    console.log(`eventId: ${eventId}, join? ${join}`);

    // redirect to either the event or home
    if (eventId) {
      const queryParams = join ? {join} : undefined;
      this.router.navigate(['/', eventId], {queryParams});
      console.log(`redirecting to event: ${eventId}`, queryParams);
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

  async getReplaysForUser(encryptedString: string): Promise<IGeneralsReplay[]> {
    const getReplaysForUser =
        this.aff.httpsCallable<string, IGeneralsReplay[]>('getReplaysForUser');
    return getReplaysForUser(encryptedString).toPromise();
  }
}
