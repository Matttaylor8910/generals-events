import {Component, EventEmitter, Input, Output} from '@angular/core';
import {ADMINS} from 'constants';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer, IMatchTeam, MatchTeamStatus} from 'types';
import {getShuffledBracket} from './bracket-creator';

@Component({
  selector: 'app-bracket-event',
  templateUrl: './bracket-event.component.html',
  styleUrls: ['./bracket-event.component.scss'],
})
export class BracketEventComponent {
  @Input() event: IDoubleElimEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  bracket: IDoubleEliminationBracket;

  constructor(
      private readonly generals: GeneralsService,
  ) {}

  selectedTab = 'Registration';

  get registrationOpen(): boolean {
    // TODO, show the registration component up until the bracket has been
    // completed, the start time isn't a hard start by any means
    // we should show some sort of messaging to players though that they are
    // waiting for the event organizers to start the tournament
    return this.status === EventStatus.UPCOMING;
  }

  get showRegistration(): boolean {
    return this.selectedTab === 'Registration' && this.registrationOpen;
  }

  get tabs(): string[] {
    const tabs = [];

    if (this.registrationOpen) {
      tabs.push('Registration');
    }

    if (ADMINS.includes(this.generals.name)) {
      tabs.push('Bracket');
    }

    return tabs;
  }

  selectTab(tab: string) {
    console.log(tab);
    this.selectedTab = tab;
  }

  // TODO: this will be a real flow for just admins, and it will use the checked
  // in players
  createBracket() {
    const teams: IMatchTeam[] = this.players.map(player => {
      return {
        name: player.name,
        score: 0,
        status: MatchTeamStatus.UNDECIDED,
        dq: false
      };
    });
    // Assume 50% checkin
    const bracket = getShuffledBracket(teams.slice(0, teams.length / 2));
    console.log(bracket);
    setTimeout(() => {
      this.bracket = bracket;
    });
  }
}
