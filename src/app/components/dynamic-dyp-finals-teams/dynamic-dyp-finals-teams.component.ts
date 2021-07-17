import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {IBracketMatch, IBracketRound, IDynamicDYPEvent, IDynamicDYPFinals, ILeaderboardPlayer, MatchStatus, MatchTeamStatus} from 'types';

import {ADMINS} from '../../../../constants';

@Component({
  selector: 'app-dynamic-dyp-finals-teams',
  templateUrl: './dynamic-dyp-finals-teams.component.html',
  styleUrls: ['./dynamic-dyp-finals-teams.component.scss'],
})
export class DynamicDYPFinalsTeamsComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() players: ILeaderboardPlayer[];

  finals: IDynamicDYPFinals;
  bracket: IBracketRound[];

  @Output() playersClicked = new EventEmitter<string|string[]>();

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.event?.finals) {
      this.finals = this.event.finals

      if (this.finals.bracket) {
        this.bracket = this.finals.bracket;
      }
    } else {
      this.finals = {
        teams: this.getFinalists().map(finalist => {
          return {players: [finalist]};
        }),
        currentlyChoosing: '',
      };
    }
  }

  get showTeams(): boolean {
    return this.event?.finals?.bracket === undefined;
  }

  get currentlyChoosing(): boolean {
    return this.generals.name &&
        this.event?.finals?.currentlyChoosing === this.generals.name;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get showStartPicking(): boolean {
    return this.isAdmin && this.event?.finals === undefined;
  }

  get showFinalizeTeams(): boolean {
    // TODO: un-hardcode 4 teams (8 finalists)
    return this.isAdmin && this.event?.finals?.teams.length === 4 &&
        this.showTeams;
  }

  getFinalists(): string[] {
    return this.players
        ?.sort((a, b) => {
          return b.stats?.winRate - a.stats?.winRate;
        })
        .map(player => player.name)
        // TODO: should we always hardcode to choosing top 8?
        .slice(0, 8);
  }

  startPicking() {
    this.eventService.updateEvent(this.event.id, {
      finals: {
        ...this.finals,
        // set the first picker
        currentlyChoosing: this.finals.teams[0].players[0],
      },
    });
  }

  pickTeammate(index: number) {
    if (this.currentlyChoosing) {
      // find partner, remove them from their current place
      const partner = this.event.finals.teams.splice(index, 1);
      const name = partner[0].players[0];

      // add them to my team
      const myIndex = this.event.finals.teams.findIndex(
          t => t.players.includes(this.generals.name));
      this.event.finals.teams[myIndex].players.push(name);

      // set next chooser
      if (myIndex < this.event.finals.teams.length - 1) {
        this.event.finals.currentlyChoosing =
            this.event.finals.teams[myIndex + 1].players[0];
      }

      // all done picking
      else {
      }

      // save changes
      this.eventService.updateEvent(this.event.id, {
        finals: this.event.finals,
      });
    }
  }

  generateBracket() {
    const {teams} = this.event.finals;
    const rounds = [];

    const match1: IBracketMatch = {
      teams: [
        {
          name: teams[0].players.join(' and '),
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        },
        {
          name: teams[3].players.join(' and '),
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        }
      ],
      number: 1,
      final: false,
      bye: false,
      status: MatchStatus.READY,
      noRightBorder: false,
      lobby: 'finals',
    };

    const match2: IBracketMatch = {
      teams: [
        {
          name: teams[1].players.join(' and '),
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        },
        {
          name: teams[2].players.join(' and '),
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        }
      ],
      number: 2,
      final: false,
      bye: false,
      status: MatchStatus.NOT_STARTED,
      noRightBorder: false,
      lobby: 'finals',
    };

    // push semifinals matches
    rounds.push({
      name: 'Semifinals',
      complete: false,
      matches: [match1, match2],
      winningSets: 3,
    });

    const finalsMatch: IBracketMatch = {
      teams: [
        {
          placeholder: 'Winner of match 1',
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        },
        {
          placeholder: 'Winner of match 2',
          score: 0,
          status: MatchTeamStatus.UNDECIDED,
        }
      ],
      number: 3,
      final: false,
      bye: false,
      status: MatchStatus.NOT_STARTED,
      noRightBorder: false,
      lobby: 'finals',
    };

    rounds.push({
      name: 'Finals',
      complete: false,
      matches: [finalsMatch],
      winningSets: 4,
    });

    this.bracket = rounds;
  }

  startFinals() {
    this.event.finals.bracket = this.bracket;
    this.eventService.updateEvent(this.event.id, {
      finals: this.finals,
    });
  }
}
