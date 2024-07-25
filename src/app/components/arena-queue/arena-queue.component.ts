import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, EventType, IArenaEvent} from 'types';

@Component({
  selector: 'app-arena-queue',
  templateUrl: './arena-queue.component.html',
  styleUrls: ['./arena-queue.component.scss'],
})
export class ArenaQueueComponent implements OnDestroy {
  @Input() event: IArenaEvent;
  @Input() inEvent: boolean;
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  currentSubscription: string;
  redirect$: Subscription;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {
    this.generals.nameChanged$.subscribe(this.checkRedirect.bind(this));
  }

  ngOnChanges() {
    this.checkRedirect();
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

  get inQueue(): boolean {
    return this.status !== EventStatus.ALMOST_DONE &&
        this.event?.queue?.includes(this.generals.name);
  }

  get message(): string {
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
    if (this.inQueue) {
      this.eventService.leaveQueue(this.event.id, this.generals.name);
    } else {
      if (this.generals.name) {
        if (!this.inEvent) {
          await this.eventService.addPlayer(this.event.id, this.generals.name);
        }
        this.eventService.joinQueue(this.event.id, this.generals.name);
      } else {
        this.generals.loginFromEvent(this.event, true);
      }
    }
  }

  /**
   * Determine if this logged in player is ready to play in a game (there is a
   * doc in the /redirect collection)
   * Redirect the player to that lobby
   */
  checkRedirect() {
    const subscription = `${this.event.id}_${this.generals.name}`;

    if (subscription !== this.currentSubscription) {
      this.unsubscribe();
      this.currentSubscription = subscription;

      if (this.event && this.generals.name) {
        this.redirect$ =
            this.eventService.getRedirect(this.event.id, this.generals.name)
                .subscribe(async redirect => {
                  if (redirect) {
                    const {id, lobby} = redirect;
                    await this.eventService.clearRedirect(
                        this.event.id, id, this.generals.name);
                    this.generals.joinLobby(lobby, this.event, false);
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
    this.unsubscribe();
  }
}
