import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IBracketMatch, IDoubleElimEvent, ILeaderboardPlayer, MatchStatus, MatchTeamStatus} from 'types';

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

  readyStatus: {opponent: null|string, match: null|number, sets: null|number};
  eliminated = false;

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
    return this.event?.checkInTime < Date.now();
  }

  get showCheckIn(): boolean {
    return this.inEvent && !this.checkedIn && this.checkInOpen;
  }

  get showJoinMatch(): boolean {
    return this.inEvent && !!this.readyStatus.opponent;
  }

  get showStatusBar(): boolean {
    return !this.event?.bracket || this.inEvent;
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to googleman on discord if you feel this is in error.';
    }

    // status for after the bracket has been set, and thus the event has started
    if (this.event.bracket) {
      if (this.readyStatus.opponent) {
        const {opponent, sets} = this.readyStatus;
        return `You are up against ${opponent}! As a reminder it's best ${
            sets} of ${sets * 2 - 1}`;
      }
      if (this.eliminated) {
        return `You have been eliminated, better luck next time. Stick around and spectate other matches!`;
      }

      // TODO:
      return 'Waiting for next match, feel free to spectate other matches while you wait!';
    }

    // statuses before the event starts
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
    let foundEliminated = false;
    const {winners = [], losers = []} = this.event?.bracket || {};
    // iterate through all matches looking for the next one with your name
    for (const round of winners.concat(losers)) {
      for (const match of round.matches) {
        const players = match.teams.map(t => t.name);
        if (players.includes(this.generals.name)) {
          if (match.status === MatchStatus.READY) {
            this.setMatchReadyStatus(players, match, round.winningSets);
            foundReady = true;
          } else if (match.status === MatchStatus.COMPLETE) {
            this.eliminated = foundEliminated ||
                match.teams.some(
                    team => team.name === this.generals.name &&
                        team.status === MatchTeamStatus.ELIMINATED);
            if (this.eliminated) foundEliminated = true;
          }
        }
      }
    }

    // didn't find a match that's ready for us
    if (!foundReady) this.resetReadyStatus();
  }

  setMatchReadyStatus(players: string[], match: IBracketMatch, sets: number) {
    this.readyStatus.match = match.number;
    this.readyStatus.opponent = players.find(p => p !== this.generals.name);
    this.readyStatus.sets = sets;
    console.log(`Ready to play against ${this.readyStatus.opponent} in match ${
        match.number}`);
  }

  resetReadyStatus() {
    this.readyStatus = {match: null, opponent: null, sets: null};
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
