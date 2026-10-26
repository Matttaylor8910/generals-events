import {Injectable} from '@angular/core';
import {AngularFireFunctions} from '@angular/fire/functions';

/**
 * Thin facade over the `teamBracketAction` callable: all Big Team
 * (non-arena) roster mutations run server-side against the authenticated
 * caller. Nothing here fabricates identity or rosters.
 */
@Injectable({providedIn: 'root'})
export class TeamBracketService {
  constructor(private readonly functions: AngularFireFunctions) {}

  private call(action: string, eventId: string,
      payload: {[key: string]: unknown} = {}): Promise<void> {
    return this.functions.httpsCallable('teamBracketAction')(
        {eventId, action, payload}).toPromise().then(() => undefined);
  }

  sendInvite(eventId: string, target: string): Promise<void> {
    return this.call('sendInvite', eventId, {target});
  }

  acceptInvite(eventId: string, captain: string): Promise<void> {
    return this.call('acceptInvite', eventId, {captain});
  }

  declineInvite(eventId: string, captain: string): Promise<void> {
    return this.call('declineInvite', eventId, {captain});
  }

  cancelInvite(eventId: string, target: string): Promise<void> {
    return this.call('cancelInvite', eventId, {target});
  }

  leaveTeam(eventId: string): Promise<void> {
    return this.call('leaveTeam', eventId);
  }

  renameTeam(eventId: string, name: string): Promise<void> {
    return this.call('renameTeam', eventId, {name});
  }

  withdrawPlayer(eventId: string, name?: string): Promise<void> {
    return this.call('withdrawPlayer', eventId,
        name === undefined ? {} : {name});
  }
}
