import {Injectable} from '@angular/core';
import {AngularFireFunctions} from '@angular/fire/functions';

/**
 * Thin facade over the `teamArenaAction` callable. All team arena roster
 * mutations run server-side against the authenticated caller's username;
 * this service only forwards action names and payloads, never identity.
 */
@Injectable({providedIn: 'root'})
export class TeamArenaService {
  constructor(private readonly functions: AngularFireFunctions) {}

  private call(action: string, eventId: string,
      payload: {[key: string]: unknown} = {}): Promise<void> {
    return this.functions.httpsCallable('teamArenaAction')(
        {eventId, action, payload}).toPromise().then(() => undefined);
  }

  register(eventId: string): Promise<void> {
    return this.call('register', eventId);
  }

  createTeam(eventId: string, teamName: string): Promise<void> {
    return this.call('createTeam', eventId, {teamName});
  }

  requestTeam(eventId: string, teamId: string): Promise<void> {
    return this.call('requestTeam', eventId, {teamId});
  }

  acceptPlayer(eventId: string, memberName: string): Promise<void> {
    return this.call('acceptPlayer', eventId, {memberName});
  }

  setTeamOptions(eventId: string, options: {
    acceptFill?: boolean,
    allowShortHanded?: boolean,
    name?: string,
  }): Promise<void> {
    const payload: {[key: string]: unknown} = {};
    if (options.acceptFill !== undefined) {
      payload.acceptFill = options.acceptFill;
    }
    if (options.allowShortHanded !== undefined) {
      payload.allowShortHanded = options.allowShortHanded;
    }
    if (options.name !== undefined) {
      payload.name = options.name;
    }
    return this.call('setTeamOptions', eventId, payload);
  }

  joinRandomTeam(eventId: string): Promise<void> {
    return this.call('joinRandomTeam', eventId);
  }

  markNoShow(eventId: string, memberName: string): Promise<void> {
    return this.call('markNoShow', eventId, {memberName});
  }

  leaveTeam(eventId: string): Promise<void> {
    return this.call('leaveTeam', eventId);
  }

  withdrawPlayer(eventId: string, name?: string): Promise<void> {
    return this.call('withdrawPlayer', eventId,
        name === undefined ? {} : {name});
  }

  setReady(eventId: string, ready: boolean): Promise<void> {
    return this.call('setReady', eventId, {ready});
  }

  finalize(eventId: string): Promise<void> {
    return this.call('finalize', eventId);
  }
}
