import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IBracketMatch, IBracketRound, IDynamicDYPEvent, IDynamicDYPMatch, IGeneralsGameOptions, ILeaderboardPlayer, MatchStatus, MatchTeamStatus} from 'types';

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
  @Input() finals: boolean;

  currentSubscription: string;
  redirect$: Subscription;

  inEvent = false;
  checkedIn = false;

  readyStatus: {
    partner: null|string; opponents: null | string,
                          match: null|IDynamicDYPMatch,
  };
  noMoreMatches = false;

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

  get showFinalsMatch(): boolean {
    return this.event?.finals?.bracket !== undefined && !this.event?.endTime;
  }

  get showStatusBar(): boolean {
    return !this.event?.rounds || this.inEvent || this.event?.endTime > 0;
  }

  get message(): string {
    if (this.disqualified) {
      return 'You have been disqualified for ruining the experience for others! Reach out to matt on discord if you feel this is in error.';
    }

    if (this.event?.winners?.length > 0) {
      return `The winners are ${this.event.winners.join(' and ')}!`;
    }

    // status for after the rounds have been set, and thus the event has started
    if (this.event?.rounds) {
      if (this.event.finals) {
        const {currentlyChoosing, teams, bracket} = this.event.finals;
        if (bracket !== undefined) {
          return 'All finals matches will be in the same lobby! Good luck!';
        }
        if (teams.length === 4) {
          return 'Teams are set, the event organizer will generate a bracket.'
        }
        if (currentlyChoosing === this.generals.name) {
          return 'It\'s your turn to pick your partner!';
        } else {
          return `${
              currentlyChoosing} is choosing their partner, the finals matches will start soon!`;
        }
      }
      if (this.finals) {
        return 'All prelims are done, finals time!';
      }
      if (this.noMoreMatches) {
        return 'You have no matches right now, spectate the other matches while you wait!';
      }
      if (this.readyStatus.match) {
        const {partner, opponents} = this.readyStatus;
        return `You are paired up with ${partner} playing against ${
            opponents}!`;
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
    const {match} = this.readyStatus;
    const lobby = match.lobby ?? match.number;
    const options: IGeneralsGameOptions = {};

    // set the team or spectator params if you're in this match
    const teamIndex = match.teams?.findIndex(
        team => team.players?.includes(this.generals.name));

    if (teamIndex >= 0) {
      options.team = teamIndex + 1;
    } else {
      options.spectate = true;
    }

    this.generals.joinLobby(`match_${lobby}`, this.event, true, options);
  }

  joinFinals() {
    this.generals.joinLobby('match_finals', this.event, true);
  }

  findNextMatch() {
    let foundReady = false;

    if (this.inEvent && this.event?.rounds) {
      const match = this.getNextMatchForPlayer();
      if (match === null) {
        this.noMoreMatches = true;
      } else {
        foundReady = true;
        this.noMoreMatches = false;
        this.setMatchReadyStatus(match);
      }
    }

    // reset statuses when we don't find matches to talk about
    if (!foundReady) this.resetReadyStatus();
  }

  setMatchReadyStatus(match: IDynamicDYPMatch) {
    this.readyStatus.match = match;

    let us = match.teams[0].players;
    let them = match.teams[1].players;

    if (!us.includes(this.generals.name)) {
      let temp = us;
      us = them;
      them = temp;
    }

    this.readyStatus.opponents = them.join(' and ');
    this.readyStatus.partner = us.find(p => p !== this.generals.name);
  }

  resetReadyStatus() {
    this.readyStatus = {
      partner: null,
      opponents: null,
      match: null,
    };
  }

  private getNextMatchForPlayer(): IDynamicDYPMatch|null {
    for (const round of this.event.rounds) {
      if (!round.complete) {
        for (const match of round.matches) {
          if (match.status === MatchStatus.READY) {
            if (match.ready.includes(this.generals.name)) {
              return match;
            }
          }
        }
      }
    }
    return null;
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
