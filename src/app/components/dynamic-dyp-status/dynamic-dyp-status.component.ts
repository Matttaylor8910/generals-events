import {Component, Input, OnDestroy} from '@angular/core';
import {flatten} from 'lodash';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IBracketMatch, IBracketRound, IDynamicDYPEvent, ILeaderboardPlayer, MatchStatus, MatchTeamStatus} from 'types';

@Component({
  selector: 'app-dynamic-dyp-status',
  templateUrl: './dynamic-dyp-status.component.html',
  styleUrls: ['./dynamic-dyp-status.component.scss'],
})
export class DynamicDYPStatusComponent implements OnDestroy {
  @Input() event: IDynamicDYPEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  currentSubscription: string;
  redirect$: Subscription;

  inEvent = false;
  checkedIn = false;

  readyStatus: {
    opponent: null|string,
    match: null|number,
    sets: null|number,
  };

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {
    this.resetReadyStatus();
    this.generals.nameChanged$.subscribe(this.determineInEvent.bind(this));
  }

  ngOnChanges() {
    this.determineInEvent();
  }

  get showTimer(): boolean {
    return this.status === EventStatus.UPCOMING && !this.checkInOpen;
  }

  get checkInOpen(): boolean {
    return this.event?.checkInTime < Date.now() && !this.event?.rounds;
  }

  get showCheckIn(): boolean {
    return this.inEvent && !this.checkedIn && this.checkInOpen;
  }

  get showJoinMatch(): boolean {
    return this.readyStatus.match !== null;
  }

  get showStatusBar(): boolean {
    return !this.event?.rounds || this.inEvent;
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to googleman on discord if you feel this is in error.';
    }

    // status for after the rounds have been set, and thus the event has started
    if (this.event.rounds) {
      if (this.readyStatus.match) {
        // TODO: fix up the verbiage around the next match!
        const {opponent, sets} = this.readyStatus;
        return `You are up against ${opponent}! As a reminder it's best ${
            sets} of ${sets * 2 - 1}`;
      }

      return 'Waiting for next match, feel free to spectate other matches while you wait!';
    }

    // statuses before the event starts
    if (this.checkedIn) {
      return 'You are checked in! The event organizers will generate the matches shortly, hang tight.';
    }
    if (this.showCheckIn) {
      return 'Thanks for being on time! Please check in to confirm you can play in the event.';
    }
    if (this.inEvent) {
      return 'You are registered for this event! Check in starts 15 minutes before the event start time.';
    }
    return 'Register for the event below!';
  }

  determineInEvent() {
    const me = this.players.find(p => p.name === this.generals.name);
    this.inEvent = this.players && !!me;
    this.checkedIn =
        this.inEvent && this.event.checkedInPlayers?.includes(me.name);
    this.findNextMatch();
  }

  checkIn() {
    this.eventService.checkInPlayer(this.event.id, this.generals.name);
  }

  joinMatch() {
    this.generals.joinLobby(
        `match_${this.readyStatus.match}`, this.event.server, true, false);
  }

  findNextMatch() {
    let foundReady = false;

    if (this.inEvent) {
      // TODO: find next match!
    }

    // reset statuses when we don't find matches to talk about
    if (!foundReady) this.resetReadyStatus();
  }

  setMatchReadyStatus(players: string[], match: IBracketMatch, sets: number) {
    this.readyStatus.match = match.number;
    this.readyStatus.opponent = players.find(p => p !== this.generals.name);
    this.readyStatus.sets = sets;
  }

  resetReadyStatus() {
    this.readyStatus = {
      opponent: null,
      match: null,
      sets: null,
    };
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
