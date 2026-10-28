import {EventEmitter, Injectable} from '@angular/core';
import {AngularFireAuth} from '@angular/fire/auth';
import {AngularFireFunctions} from '@angular/fire/functions';
import {Router} from '@angular/router';
import {isValidTeamSize} from 'teams';
import {normalizeEventGameOptions} from 'game-options';
import {isTeamArena, normalizeEventTeam} from 'team-arena';
import {EventFormat, EventType, GameSpeed, IEvent, IGeneralsGameOptions, IGeneralsReplay} from 'types';
import {GeneralsServer, SITE_URLS} from '../../../constants';
import {environment} from 'src/environments/environment';
import {UtilService} from './util.service';

const DEFAULT_GAME_OPTIONS: IGeneralsGameOptions = {
  spectate_chat: true,
};

const GENERALS_NAME = 'generals-name';
const LAST_EVENT = 'generals-last-event';
const JOIN = 'generals-join';

// generals.io will only redirect a login back to localhost on these ports
const DEV_PORTS = [8100, 4200];

/**
 * Logging in works like this:
 *  1. We send the player to generals.io with ?eventGetUsername=true
 *  2. generals.io asks its own server for a Firebase custom token for the
 *     logged in player (signed by a service account of this Firebase project,
 *     valid for two minutes) and redirects back here with ?handoffToken=...
 *  3. We sign in to Firebase Auth with that token. No Cloud Function runs, so
 *     there is no cold start. The Firebase uid is the generals.io username,
 *     which is what the security rules check.
 *
 * `name` is only a cached copy of the signed in uid so the UI can render
 * synchronously. Firebase Auth is the source of truth and the database only
 * trusts the auth token, never this value.
 */
@Injectable({providedIn: 'root'})
export class GeneralsService {
  name = localStorage.getItem(GENERALS_NAME);
  nameChanged$ = new EventEmitter();

  constructor(
      private readonly aff: AngularFireFunctions,
      private readonly afAuth: AngularFireAuth,
      private readonly router: Router,
      private readonly utilService: UtilService,
  ) {
    // keep the cached name in sync with the real auth state, this also logs
    // out anyone with a stale name from before logins went through Firebase
    this.afAuth.authState.subscribe(user => {
      const name = user?.uid ?? null;
      if (name !== this.name) {
        if (name) {
          this.setName(name);
        } else {
          this.clearName();
        }
      }
    });
  }

  // the generals.io origin used for login/lobby/profile/replay links: the
  // local dev server when running against the emulator suite, otherwise the
  // per-server production URL
  private gioOrigin(server: GeneralsServer): string {
    // local-firebase.ts already validated SITE_URLS[LOCAL] as a
    // credential-free loopback origin before the app booted
    return (environment as any).localEmulators ?
        SITE_URLS[GeneralsServer.LOCAL] : SITE_URLS[server];
  }

  goToProfile(name: string, server = GeneralsServer.NA) {
    window.open(
        `${this.gioOrigin(server)}/profiles/${encodeURIComponent(name)}`,
        '_blank');
  }

  goToReplay(replayId: string, server = GeneralsServer.NA) {
    window.open(`${this.gioOrigin(server)}/replays/${replayId}`, '_blank');
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

    let lobbyName = name;
    if (name.startsWith('match_')) {
      // match lobbies must be namespaced to this event (the event's own id,
      // not a parent's) or simultaneous events would share the same lobby
      if (!event?.id) {
        throw new Error('Cannot join a match lobby without an event id');
      }
      lobbyName = `match_${event.id}_${name.slice('match_'.length)}`;
    }

    // tell the lobby how many players a Big Team game holds so max_players
    // matches the event configuration; a persisted malformed setting is
    // rejected rather than trusted or silently replaced
    const eventOptions: IGeneralsGameOptions = {};
    if (isTeamArena(event)) {
      // team arenas carry the nominal playersPerGame plus the normalized
      // roster contract; teams are dispatched whole, never via an
      // individual team= parameter. Field-level validation (not
      // validateTeamArenaConfig) keeps older docs that predate the pairing
      // strategy field joinable.
      const teamSize = event.teamSize;
      const players = event.playersPerGame;
      if (!isValidTeamSize(teamSize) || !Number.isInteger(players) ||
          players % teamSize !== 0 || players < 2 * teamSize ||
          players > 16) {
        throw new Error('Cannot join a team arena lobby with an invalid ' +
            'team configuration');
      }
      eventOptions.players = players;
      if (options.event_team !== undefined) {
        eventOptions.event_team = normalizeEventTeam(options.event_team);
      }
    } else if (event?.type === EventType.BIG_TEAM) {
      const teamSize = event.teamSize;
      if (!isValidTeamSize(teamSize)) {
        throw new Error('Cannot join a Big Team lobby with an invalid ' +
            'team size');
      }
      let players = event.playersPerGame;
      if (players === undefined || players === null) {
        // when unset, the lobby defaults to the two-team minimum
        players = 2 * teamSize;
      }
      if (!Number.isInteger(players) || players % teamSize !== 0 ||
          players < 2 * teamSize || players > 16 ||
          // a double elimination match must resolve to exactly two teams
          (event.format === EventFormat.DOUBLE_ELIM &&
           players !== 2 * teamSize)) {
        throw new Error('Cannot join a Big Team lobby with an invalid ' +
            'players per game');
      }
      eventOptions.players = players;
    }

    // normalize stored and override options the same way the form does; a
    // malformed modifier config throws rather than generating a silently
    // wrong lobby URL
    const urlOptions: IGeneralsGameOptions = {
      ...DEFAULT_GAME_OPTIONS,
      ...normalizeEventGameOptions(lobbyOptions),
      ...normalizeEventGameOptions(options),
      ...eventOptions,
      eventId: event.id,
    };

    // serialize modifiers back to the comma-delimited query grammar the main
    // client parses, and modifier_options as JSON so it never degrades to
    // "[object Object]"
    const serializedOptions: {[key: string]: any} = {...urlOptions};
    const devPort = this.getDevPort();
    if (devPort) {
      serializedOptions.eventDevPort = devPort;
    }
    if (urlOptions.modifiers !== undefined) {
      serializedOptions.modifiers =
          (urlOptions.modifiers as number[]).join(',');
    }
    if (urlOptions.modifier_options !== undefined) {
      serializedOptions.modifier_options =
          JSON.stringify(urlOptions.modifier_options);
    }
    if (urlOptions.event_team !== undefined) {
      serializedOptions.event_team = JSON.stringify(urlOptions.event_team);
    }

    // override any default game options with those provided
    const queryParams = this.utilService.getParamString(serializedOptions);

    // append the query params to the game lobby url
    const url = `${this.gioOrigin(server)}/games/${
        encodeURIComponent(lobbyName)}${queryParams}`;

    if (newTab) {
      window.open(url, '_blank');
    } else {
      location.href = url;
    }
  }

  async loginFromEvent(event: IEvent, join: boolean) {
    const eventId = event?.parentId ?? event?.id;
    this.login(eventId, join, event.server);
  }

  /**
   * Send the player to generals.io to prove who they are. generals.io sends
   * them back with a handoff token, see loginWithHandoffToken.
   */
  async login(eventId: string, join: boolean, server = GeneralsServer.NA) {
    if (eventId) {
      localStorage.setItem(LAST_EVENT, eventId);
      localStorage.setItem(JOIN, String(join || false));
    }

    const params = new URLSearchParams({eventGetUsername: 'true'});

    // when developing locally, ask generals.io to send the token back to the
    // local dev server instead of events.generals.io
    const devPort = this.getDevPort();
    if (devPort) {
      params.set('eventDevPort', String(devPort));
    }

    location.href = `${this.gioOrigin(server)}/?${params.toString()}`;
  }

  /**
   * Sign in with the Firebase custom token generals.io sent us back with.
   * Resolves to true if the login succeeded.
   */
  async loginWithHandoffToken(token: string, eventId?: string):
      Promise<boolean> {
    try {
      const {user} = await this.afAuth.signInWithCustomToken(token);
      this.handleDidLogin(user.uid, eventId);
      return true;
    } catch (error) {
      console.error('login failed', error);
      this.utilService.showToast(
          'Login failed, please try logging in again from generals.io');
      return false;
    }
  }

  /**
   * Set the given name to be the logged in user. A eventId can be passed
   * as the event to redirect to after logging in.
   *
   * Hitting a URL like the following will login and join the Jan 2021 FFA
   * event for example:
   * https://events.generals.io/FFA-Jan-2021?handoffToken=...&join=true
   *
   */
  handleDidLogin(name: string, eventId?: string) {
    this.setName(name);

    console.log(`set name to ${name}`);

    // support redirecting to a provided event, or the last one saved to
    // localStorage before redirecting to generals.io
    // also support auto-joining the event when you get there
    eventId = eventId || localStorage.getItem(LAST_EVENT);
    const join = localStorage.getItem(JOIN) === 'true' ||
        location.href.includes('join=true');
    localStorage.removeItem(LAST_EVENT);
    localStorage.removeItem(JOIN);

    console.log(`eventId: ${eventId}, join? ${join}`);

    // redirect to either the event or home, this also drops the token from
    // the url
    if (eventId) {
      const queryParams = join ? {join} : undefined;
      this.router.navigate(['/', eventId], {queryParams, replaceUrl: true});
      console.log(`redirecting to event: ${eventId}`, queryParams);
    } else {
      this.router.navigate(['/'], {replaceUrl: true});
      console.log(`going home`);
    }
  }

  async logout() {
    this.clearName();
    await this.afAuth.signOut();
  }

  async getReplaysForUser(name: string): Promise<IGeneralsReplay[]> {
    const getReplaysForUser =
        this.aff.httpsCallable<string, IGeneralsReplay[]>('getReplaysForUser');
    return getReplaysForUser(name).toPromise();
  }

  private setName(name: string) {
    localStorage.setItem(GENERALS_NAME, name);
    this.name = name;
    this.nameChanged$.emit();
  }

  private clearName() {
    localStorage.removeItem(GENERALS_NAME);
    this.name = null;
    this.nameChanged$.emit();
  }

  private getDevPort(): number|null {
    const port = Number(location.port);
    if (['localhost', '127.0.0.1'].includes(location.hostname) &&
        DEV_PORTS.includes(port)) {
      return port;
    }
    return null;
  }
}
