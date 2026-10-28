import {Component, Input, OnChanges, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {normalizeEventGameOptions} from 'game-options';
import {isTeamArena, normalizeEventTeam} from 'team-arena';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {TeamArenaService} from 'src/app/services/team-arena.service';
import {UtilService} from 'src/app/services/util.service';
import {DoublesPairingStrategy, EventStatus, EventType, IArenaEvent} from 'types';

// readiness confirmations expire after 90 seconds server-side; renew well
// inside that window while the player stays opted in
const READY_RENEW_MS = 30 * 1000;
const READY_TTL_MS = 90 * 1000;

@Component({
  selector: 'app-arena-queue',
  templateUrl: './arena-queue.component.html',
  styleUrls: ['./arena-queue.component.scss'],
})
export class ArenaQueueComponent implements OnChanges, OnDestroy {
  @Input() event: IArenaEvent;
  @Input() inEvent: boolean;
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  currentSubscription: string;
  redirect$: Subscription;
  nameChanged$: Subscription;
  readyTimer: any;
  readyContext: string;
  readyFailed: string;
  renewing = false;
  busy = false;
  error: string;
  destroyed = false;

  // redirects currently being consumed, by redirect id: a snapshot pair or
  // a re-fired event must not make the same lobby open twice
  private processingRedirect = new Set<string>();

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly teamArenaService: TeamArenaService,
      private readonly utilService: UtilService,
  ) {
    this.nameChanged$ = this.generals.nameChanged$.subscribe(
        this.onContextChanged.bind(this));
  }

  ngOnChanges() {
    this.onContextChanged();
  }

  private onContextChanged() {
    // the renewal timer only ever renews the identity/context it was
    // started under; a genuine context change stops it before the new
    // context evaluates, while unrelated input changes leave it alone
    const context = `${this.event?.id}_${this.generals.name}`;
    if (this.readyContext !== context) {
      this.stopReadyRenewal();
    }
    this.checkRedirect();
    this.syncReadyRenewal();
  }

  get isTeamArena(): boolean {
    return isTeamArena(this.event);
  }

  get showTimer(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get showQueueButton(): boolean {
    return this.status === EventStatus.ONGOING;
  }

  get canJoinQueue(): boolean {
    return !this.event?.disableJoin || this.inEvent;
  }

  get playing(): boolean {
    return !!this.event?.arenaPlaying?.includes(this.generals.name);
  }

  // the button is inert while a mutation is in flight, the caller is in a
  // game, or the caller is disqualified
  get queueDisabled(): boolean {
    return this.busy || this.disqualified ||
        (this.isTeamArena && this.playing);
  }

  get queueLabel(): string {
    if (this.isTeamArena) {
      if (this.playing) { return 'Game in progress'; }
      return this.inQueue ? 'Unready' : 'Ready';
    }
    return this.inQueue ? 'Leave Queue' : 'Join Queue';
  }

  // team arenas gate on the caller's own readiness timestamp, not the
  // legacy queue array; an expired confirmation does not count
  get inQueue(): boolean {
    if (this.isTeamArena) {
      const ready = this.event?.arenaReady?.[this.generals.name];
      return this.status !== EventStatus.ALMOST_DONE &&
          Number.isFinite(ready) && ready <= Date.now() &&
          Date.now() - ready < READY_TTL_MS;
    }
    return this.status !== EventStatus.ALMOST_DONE &&
        this.event?.queue?.includes(this.generals.name);
  }

  get message(): string {
    if (this.error) {
      return this.error;
    }
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to matt on discord if you feel this is in error.';
    }

    if (this.status === EventStatus.UPCOMING) {
      if (!this.inEvent) {
        return 'Join the event!';
      }
      return 'Welcome! This event has not started yet.';
    }
    if (this.status === EventStatus.ALMOST_DONE) {
      return 'This event is almost over, so no more games will be started. The winner will be announced soon!';
    }

    if (this.isTeamArena) {
      if (this.playing) {
        return 'Your game is live, get in there!';
      }
      if (this.inQueue) {
        const needed = this.event.doublesPairingStrategy ===
            DoublesPairingStrategy.BRING_YOUR_PARTNER ?
            `games start when every member of ${
                this.event.playersPerGame / this.event.teamSize
            } teams is ready` :
            `a game starts once ${this.event.playersPerGame} players are ready`;
        return `You are ready! ${needed}. You will have to confirm ` +
            `again for each game.`;
      }
      return this.event.doublesPairingStrategy ===
          DoublesPairingStrategy.BRING_YOUR_PARTNER ?
          'Ready up! Your team plays when everyone has confirmed.' :
          'Ready up! You will be teamed randomly once a full game is queued.';
    }

    if (this.inQueue) {
      if (this.event?.type === EventType.FFA) {
        const count = this.event.queue.length;
        const max = this.event.playersPerGame;

        const current = ((count - 1) % max) + 1;
        const myPlace = this.event.queue.indexOf(this.generals.name);

        if (count >= max && myPlace < max) {
          return 'Creating lobby to join!';
        } else {
          return `Waiting for players, ${current} of ${max}. Get ready!`;
        }
      } else {
        return `Stand by ${this.generals.name}, pairing players, get ready!`;
      }
    }
    return 'Join the queue to get your next game going!';
  }

  async toggleQueue() {
    if (this.busy) {
      return;
    }
    this.error = null;

    if (this.isTeamArena) {
      if (!this.generals.name) {
        this.generals.loginFromEvent(this.event, true);
        return;
      }
      this.busy = true;
      try {
        if (!this.inEvent) {
          await this.eventService.addPlayer(this.event.id,
              this.generals.name);
        }
        await this.teamArenaService.setReady(this.event.id, !this.inQueue);
      } catch (e) {
        this.error = e?.message || 'Something went wrong';
        this.utilService.showToast(this.error);
      } finally {
        this.busy = false;
        // an explicit ready/unready click is the user's retry: any latched
        // renewal failure for the current context is cleared
        this.readyFailed = null;
        this.syncReadyRenewal();
      }
      return;
    }

    if (this.inQueue) {
      this.eventService.leaveQueue(this.event.id, this.generals.name);
    } else {
      if (this.generals.name) {
        this.busy = true;
        try {
          if (!this.inEvent) {
            await this.eventService.addPlayer(this.event.id, this.generals.name);
          }
          this.eventService.joinQueue(this.event.id, this.generals.name);
        } catch (e) {
          this.error = e?.message || 'Something went wrong';
          this.utilService.showToast(this.error);
        } finally {
          this.busy = false;
        }
      } else {
        this.generals.loginFromEvent(this.event, true);
      }
    }
  }

  /**
   * While the caller is opted into readiness, renew the timestamp so the
   * server's 90-second freshness window never expires. Stops on unready,
   * logout, context changes, renewal failure, and component destroy; it
   * only ever renews the caller's own confirmation, and only one renewal
   * can be in flight for a given context.
   */
  private syncReadyRenewal() {
    const context = `${this.event?.id}_${this.generals.name}`;
    const want = this.isTeamArena && this.inQueue && !this.destroyed;

    if (!want) {
      this.stopReadyRenewal();
      this.readyContext = null;
      this.readyFailed = null;
      return;
    }
    // a live timer for this exact context keeps running; the context is
    // identity strings, never the snapshot object Firestore replaces on
    // every update
    if (this.readyTimer && this.readyContext === context) {
      return;
    }
    // a renewal that already failed for this context stays latched off
    // until the user explicitly retries, unreadies, or the context changes
    if (this.readyFailed === context) {
      return;
    }
    this.readyFailed = null;
    this.stopReadyRenewal();
    this.readyContext = context;

    // capture the context this timer belongs to; a late tick or promise
    // settling after the event or identity changed must not touch the new
    // context
    const eventId = this.event.id;
    const name = this.generals.name;
    this.readyTimer = setInterval(() => {
      // a genuinely stale tick stops the timer; an in-flight renewal just
      // skips a beat so confirmations can never overlap
      if (this.destroyed || this.readyContext !== context ||
          this.event?.id !== eventId || this.generals.name !== name ||
          !this.isTeamArena || !this.inQueue) {
        this.stopReadyRenewal();
        return;
      }
      if (this.renewing) {
        return;
      }
      this.renewing = true;
      this.teamArenaService
          .setReady(eventId, true)
          .catch(e => {
            // only the context that made this call records its failure; a
            // stale promise settling under a new context is dropped
            if (this.readyContext === context &&
                this.event?.id === eventId &&
                this.generals.name === name) {
              this.error = e?.message || 'Could not renew readiness';
              this.readyFailed = context;
              this.stopReadyRenewal();
            }
          })
          .finally(() => {
            this.renewing = false;
          });
    }, READY_RENEW_MS);
  }

  private stopReadyRenewal() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      delete this.readyTimer;
    }
  }

  /**
   * Determine if this logged in player is ready to play in a game (there is a
   * doc in the /redirect collection)
   * Redirect the player to that lobby
   */
  checkRedirect() {
    const subscription = `${this.event?.id}_${this.generals.name}`;

    if (subscription !== this.currentSubscription) {
      this.unsubscribe();
      this.currentSubscription = subscription;

      if (this.event && this.generals.name) {
        // capture the context this subscription belongs to; a snapshot
        // arriving after the event or identity changed must not open a
        // lobby under the new context
        const event = this.event;
        const name = this.generals.name;
        this.redirect$ =
            this.eventService.getRedirect(event.id, name)
                .subscribe(async redirect => {
                  if (!redirect) {
                    return;
                  }
                  if (this.destroyed ||
                      this.currentSubscription !== `${event.id}_${name}` ||
                      this.processingRedirect.has(redirect.id)) {
                    return;
                  }
                  this.processingRedirect.add(redirect.id);
                  try {
                    // validate the team contract before acknowledging: a
                    // malformed redirect is left for diagnosis rather than
                    // consumed into a broken lobby join
                    if (redirect.eventTeam) {
                      const contract =
                          normalizeEventTeam(redirect.eventTeam);
                      // the dispatched contract must match this event's
                      // nominal team configuration; a stale or malformed
                      // dispatch is never acknowledged
                      if (contract.teamSize !== event.teamSize ||
                          contract.gameSize !== event.playersPerGame) {
                        throw new Error(
                            'The dispatched team roster does not match ' +
                            'this event');
                      }
                    }
                    if (redirect.options) {
                      normalizeEventGameOptions(redirect.options);
                    }
                    await this.eventService.clearRedirect(
                        event.id, redirect.id, name);
                    if (this.destroyed ||
                        this.currentSubscription !==
                            `${event.id}_${name}`) {
                      return;
                    }
                    // the immutable roster and dispatched lobby options ride
                    // into the lobby so the game can verify the whole team
                    this.generals.joinLobby(redirect.lobby, {
                      ...event,
                      options: redirect.options || event.options,
                      server: redirect.server || event.server,
                    }, false, redirect.eventTeam ?
                        {event_team: redirect.eventTeam} : {});
                  } catch (e) {
                    this.error = e?.message || 'Could not join the game';
                    this.utilService.showToast(this.error);
                  } finally {
                    this.processingRedirect.delete(redirect.id);
                  }
                });
      }
    }
  }

  private unsubscribe() {
    if (this.redirect$) {
      this.redirect$.unsubscribe();
      delete this.redirect$;
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.unsubscribe();
    this.stopReadyRenewal();
    if (this.nameChanged$) {
      this.nameChanged$.unsubscribe();
      delete this.nameChanged$;
    }
  }
}
