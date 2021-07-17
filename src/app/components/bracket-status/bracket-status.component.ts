import {Component, Input, OnDestroy} from '@angular/core';
import {flatten} from 'lodash';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {DoublesPairingStrategy, EventStatus, IBracketMatch, IBracketRound, IDoubleElimEvent, ILeaderboardPlayer, MatchStatus, MatchTeamStatus, PartnerStatus} from 'types';

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

  me?: ILeaderboardPlayer;
  inEvent = false;
  checkedIn = false;
  notQualified = false;

  readyStatus: {
    opponents: null|string[],
    lobby: null|string,
    sets: null|number,
    team: null|number,
  };
  spectateStatus: {
    player1: null|string,
    player2: null|string,
    lobby: null|string,
    winner: boolean,
  };
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

  get highlight(): boolean {
    // highlight if you have a match to play in
    if (this.readyStatus?.opponents?.length > 0) {
      return true;
    }

    // highlight once your partner is set
    if (this.bringYourPartner) {
      return this.me?.partnerStatus === PartnerStatus.CONFIRMED;
    }

    // otherwise highlight once you are checked in
    else {
      return this.checkedIn && this.checkInOpen;
    }
  }

  get showTimer(): boolean {
    return this.status === EventStatus.UPCOMING && !this.checkInOpen;
  }

  get checkInOpen(): boolean {
    return this.event?.checkInTime < Date.now() && !this.event?.bracket;
  }

  get showCheckIn(): boolean {
    return this.inEvent && !this.checkedIn && this.checkInOpen &&
        !this.notQualified;
  }

  get showJoinMatch(): boolean {
    return this.readyStatus.lobby !== null;
  }

  get showSpectateMatch(): boolean {
    return !!this.spectateStatus.player1 && !!this.spectateStatus.player2;
  }

  get showStatusBar(): boolean {
    return !this.event?.bracket || this.inEvent;
  }

  get bringYourPartner(): boolean {
    return this.event?.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER;
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to matt on discord if you feel this is in error.';
    }

    // status for after the bracket has been set, and thus the event has started
    if (this.event?.bracket) {
      if (this.readyStatus.lobby) {
        const {opponents, sets} = this.readyStatus;
        return `You are up against ${
            opponents.join(
                ' and ')}! As a reminder it's best ${sets} of ${sets * 2 - 1}`;
      }
      if (this.spectateStatus.lobby) {
        const {player1, player2, winner} = this.spectateStatus;
        const outcome = winner ? 'winner' : 'loser';
        if ([player1, player2].includes(undefined)) {
          return `You will play the ${outcome} of match ${
              this.spectateStatus.lobby}, but it may be a while.`
        }
        return `You will play the ${outcome} between ${player1} and ${
            player2}!`;
      }
      if (this.eliminated) {
        return `You have been eliminated, better luck next time. Stick around and spectate other matches!`;
      }

      return 'Waiting for next match, feel free to spectate other matches while you wait!';
    }

    // statuses before the event starts
    if (this.notQualified) {
      return 'You do not qualify to participate in this event';
    }
    if (this.checkedIn) {
      // doubles event statuses for bring your partner
      if (this.bringYourPartner) {
        // confirmed team, great!
        if (this.me?.partnerStatus === PartnerStatus.CONFIRMED) {
          return `You and ${this.me.partner} are set to compete in the bracket.
                  The event organizers will generate the bracket shortly, hang tight.`;
        } else if (this.me?.partner) {
          return `You have asked ${
              this.me.partner} to play with you, they have not responded yet.`;
        } else {
          return 'Choose a partner to play with below.'
        }
      }

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
    this.me = this.players.find(p => p.name === this.generals.name);
    this.inEvent = this.players && !!this.me;
    this.checkedIn =
        this.inEvent && this.event.checkedInPlayers?.includes(this.me.name);
    this.notQualified = this.generals.name &&
        this.event?.qualified?.length > 0 &&
        !this.event.qualified.includes(this.generals.name);
    this.findNextMatch();
  }

  checkIn() {
    this.eventService.checkInPlayer(this.event.id, this.generals.name);
  }

  joinMatch() {
    const {lobby, team} = this.readyStatus;
    this.generals.joinLobby(`match_${lobby}`, this.event, true, {team});
  }

  spectateMatch() {
    this.generals.joinLobby(
        `match_${this.spectateStatus.lobby}`, this.event, true, {
          spectate: true,
        });
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
          const t = match.teams.findIndex(
              team => team.players?.includes(this.generals.name));

          if (t >= 0) {
            if (match.status === MatchStatus.READY) {
              this.setMatchReadyStatus(match, round.winningSets);
              foundReady = true;
            } else if (match.status === MatchStatus.COMPLETE) {
              this.eliminated = foundEliminated ||
                  match.teams[t].status === MatchTeamStatus.ELIMINATED;
              if (this.eliminated) {
                foundEliminated = true;
              }
            } else if (r > 0) {
              // can't set the spectate status for games from the first round in
              // the winner's bracket
              this.setSpectateStatus(r, m, t, winners, losers);
              foundSpectate = true;
            }
          }
        }
      }
    }

    // reset statuses when we don't find matches to talk about
    if (!foundReady) this.resetReadyStatus();
    if (!foundSpectate) this.resetSpectateStatus();
  }

  setMatchReadyStatus(match: IBracketMatch, sets: number) {
    this.readyStatus.lobby = `${match.lobby ?? match.number}`;
    this.readyStatus.sets = sets;

    // determine which team we're on
    const teamIndex = match.teams?.findIndex(
        team => team.players?.includes(this.generals.name));
    this.readyStatus.team = teamIndex + 1;

    const opposingTeam = match.teams[teamIndex === 0 ? 1 : 0];
    this.readyStatus.opponents = opposingTeam?.players ?? [];
  }

  setSpectateStatus(
      round: number,
      match: number,
      team: number,
      winners: IBracketRound[],
      losers: IBracketRound[],
  ) {
    let waitingOn: IBracketMatch;
    let winner = true;

    // because we were iterating through all rounds combined, indexes beyond the
    // winners rounds are losers rounds
    if (round < winners.length) {
      // look at the last losers bracket match, there is only ever one match in
      // the final losers bracket round
      if (round === winners.length - 1) {
        waitingOn = losers[losers.length - 1].matches[0];
      }

      // other winners bracket matches are easy, just look back one round
      else {
        const offset = team === 0 ? 1 : 0;
        waitingOn = winners[round - 1].matches[match * 2 + offset];
      }
    }

    // find the match you're waiting on from the loser's bracket
    else {
      round = round % winners.length;
      const myMatch = losers[round].matches[match];
      const placeholderMatch =
          Number(myMatch.teams[1].placeholder?.split('Loser of ')[1]);

      // if there is a placeholder match, parse out the match number
      if (placeholderMatch) {
        waitingOn = flatten(winners.map(round => round.matches))
                        .find(match => match.number === placeholderMatch);
        winner = false;
      }

      // otherwise look for coming from the round before
      else {
        // round 2 (index 1) is even, round 3 (index 2) is odd
        const odd = round % 2 === 0;
        if (odd) {
          const offset = team === 0 ? 1 : 0;
          match = match * 2 + offset;
        }
        waitingOn = losers[round - 1].matches[match];
      }
    }
    this.spectateStatus.player1 = waitingOn.teams[0].name;
    this.spectateStatus.player2 = waitingOn.teams[1].name;
    this.spectateStatus.lobby = `${waitingOn.number}`;
    this.spectateStatus.winner = winner;
  }

  resetReadyStatus() {
    this.readyStatus = {
      opponents: null,
      lobby: null,
      sets: null,
      team: null,
    };
  }

  resetSpectateStatus() {
    this.spectateStatus = {
      player1: null,
      player2: null,
      lobby: null,
      winner: false,
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
