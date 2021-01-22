import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';
import {ILeaderboardPlayer, ITournament} from 'types';

@Component({
  selector: 'app-tournament-player-summary',
  templateUrl: './tournament-player-summary.component.html',
  styleUrls: ['./tournament-player-summary.component.scss'],
})
export class TournamentPlayerSummaryComponent {
  @Input() player: ILeaderboardPlayer;
  @Input() tournament: ITournament;

  @Output() close = new EventEmitter<void>();

  constructor(
      public readonly generals: GeneralsService,
  ) {}
}
