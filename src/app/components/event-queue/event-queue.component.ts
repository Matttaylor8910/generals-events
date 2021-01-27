import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, EventType, IEvent} from 'types';

@Component({
  selector: 'app-event-queue',
  templateUrl: './event-queue.component.html',
  styleUrls: ['./event-queue.component.scss'],
})
export class EventQueueComponent implements OnDestroy {
  @Input() event: IEvent;
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

  get inQueue(): boolean {
    return this.status !== EventStatus.ALMOST_DONE &&
        this.event?.queue?.includes(this.generals.name);
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to googleman on discord if you feel this is in error.';
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
        this.generals.login(this.event.id, true, this.event.server);
      }
    }
  }

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
                    this.generals.joinLobby(lobby, this.event.server);
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
