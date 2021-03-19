import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IBracketMatch, IBracketRound, IDoubleElimEvent, ILeaderboardPlayer, MatchStatus, MatchTeamStatus} from 'types';

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
  spectateStatus:
      {player1: null|string, player2: null|string, match: null|number};
  eliminated = false;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {
    this.resetReadyStatus();
    this.resetSpectateStatus();
    this.generals.nameChanged$.subscribe(this.determineInEvent.bind(this));
  }

  ngOnChanges() {
    this.determineInEvent();
  }

  get showTimer(): boolean {
    return this.status === EventStatus.UPCOMING && !this.checkInOpen;
  }

  get checkInOpen(): boolean {
    return this.event?.checkInTime < Date.now() && !this.event?.bracket;
  }

  get showCheckIn(): boolean {
    return this.inEvent && !this.checkedIn && this.checkInOpen;
  }

  get showJoinMatch(): boolean {
    return this.readyStatus.match !== null;
  }

  get showSpectateMatch(): boolean {
    return this.spectateStatus.match !== null;
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
      if (this.readyStatus.match) {
        const {opponent, sets} = this.readyStatus;
        return `You are up against ${opponent}! As a reminder it's best ${
            sets} of ${sets * 2 - 1}`;
      }
      if (this.spectateStatus.match) {
        const {player1, player2} = this.spectateStatus;
        return `You will play the winner between ${player1} and ${player2}!`;
      }
      if (this.eliminated) {
        return `You have been eliminated, better luck next time. Stick around and spectate other matches!`;
      }

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

  spectateMatch() {
    this.generals.joinLobby(
        `match_${this.spectateStatus.match}`, this.event.server, true, true);
  }

  findNextMatch() {
    let foundReady = false;
    let foundSpectate = false;
    let foundEliminated = false;

    if (this.inEvent) {
      const {winners = [], losers = []} = this.event?.bracket || {};
      const combined = winners.concat(losers);

      // iterate through all matches looking for the next one with your name
      for (let r = 0; r < combined.length; r++) {
        const round = combined[r];
        for (let m = 0; m < round.matches.length; m++) {
          const match = round.matches[m];
          const players = match.teams.map(t => t.name);
          const t = players.indexOf(this.generals.name);

          if (t >= 0) {
            if (match.status === MatchStatus.READY) {
              this.setMatchReadyStatus(players, match, round.winningSets);
              foundReady = true;
            } else if (match.status === MatchStatus.COMPLETE) {
              this.eliminated = foundEliminated ||
                  match.teams[t].status === MatchTeamStatus.ELIMINATED;
              if (this.eliminated) {
                foundEliminated = true;
              }
            } else {
              if (this.setSpectateStatus(r, m, t, winners, losers)) {
                foundSpectate = true;
              }
            }
          }
        }
      }
    }

    // reset statuses when we don't find matches to talk about
    if (!foundReady) this.resetReadyStatus();
    if (!foundSpectate) this.resetSpectateStatus();
  }

  setMatchReadyStatus(players: string[], match: IBracketMatch, sets: number) {
    this.readyStatus.match = match.number;
    this.readyStatus.opponent = players.find(p => p !== this.generals.name);
    this.readyStatus.sets = sets;
    console.log(`Ready to play against ${this.readyStatus.opponent} in match ${
        match.number}`);
  }

  setSpectateStatus(
      round: number,
      match: number,
      team: number,
      winners: IBracketRound[],
      losers: IBracketRound[],
  ) {
    // because we were iterating through all rounds combined, indexes beyond the
    // winners rounds are losers rounds
    if (round < winners.length) {
      // winners bracket is easy, just look back one round
      const offset = team === 0 ? 1 : 0;
      const waitingOn = winners[round - 1].matches[match * 2 + offset];
      this.spectateStatus.player1 = waitingOn.teams[0].name;
      this.spectateStatus.player2 = waitingOn.teams[1].name;
      this.spectateStatus.match = waitingOn.number;
      return true;
    }

    // TODO: handle finding the match you're waiting on while sitting in the
    // loser's bracket

    return false;
  }

  resetReadyStatus() {
    this.readyStatus = {opponent: null, match: null, sets: null};
  }

  resetSpectateStatus() {
    this.spectateStatus = {player1: null, player2: null, match: null};
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
