import {Component, EventEmitter, Input, Output} from '@angular/core';
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

  constructor() {}

  get showRegistration(): boolean {
    // TODO, show the registration component up until the bracket has been
    // completed, the start time isn't a hard start by any means
    // we should show some sort of messaging to players though that they are
    // waiting for the event organizers to start the tournament
    const bracketCreated = false;
    return this.status === EventStatus.UPCOMING || !bracketCreated;
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
