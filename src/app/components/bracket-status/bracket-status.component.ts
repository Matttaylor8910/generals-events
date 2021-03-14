import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDoubleElimEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-bracket-status',
  templateUrl: './bracket-status.component.html',
  styleUrls: ['./bracket-status.component.scss'],
})
export class BracketStatusComponent implements OnDestroy {
  @Input() event: IDoubleElimEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  currentSubscription: string;
  redirect$: Subscription;

  inEvent = false;
  checkedIn = false;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {
    this.generals.nameChanged$.subscribe(this.determineInEvent.bind(this));
  }

  ngOnChanges() {
    this.determineInEvent();
  }

  get showTimer(): boolean {
    return this.status === EventStatus.UPCOMING && !this.checkInOpen;
  }

  get checkInOpen(): boolean {
    return this.event?.checkInTime < Date.now();
  }

  get showCheckIn(): boolean {
    return this.inEvent && !this.checkedIn && this.checkInOpen;
  }

  get showJoinMatch(): boolean {
    // TODO: show join match button when you are up
    return this.inEvent && false;
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to googleman on discord if you feel this is in error.';
    }

    if (this.status === EventStatus.UPCOMING) {
      if (this.checkedIn) {
        return 'You are checked in! The event organizers will generate the bracket shortly, hang tight.';
      }
      if (this.showCheckIn) {
        return 'Thanks for being on time! Please check in to confirm you can play in the event.';
      }
      if (this.inEvent) {
        return 'You are registered for this event! Check in starts 15 minutes before the event start time.';
      }
      return 'Register for the event below!';
    }

    // TODO: states for:
    // 1) You are up against ______, JOIN MATCH
    // 2) You are waiting for other players to finish for your next match.
    // 3) You have been eliminated. Feel free to spectate the rest of the
    // matches.

    return '';
  }

  determineInEvent() {
    const me = this.players.find(p => p.name === this.generals.name);
    this.inEvent = this.players && !!me;
    this.checkedIn =
        this.inEvent && this.event.checkedInPlayers?.includes(me.name);
  }

  checkIn() {
    console.log('TODO: check in');
    this.checkedIn = true;
  }

  joinMatch() {
    console.log('TODO: open up the match this player can join in a new tab');
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
