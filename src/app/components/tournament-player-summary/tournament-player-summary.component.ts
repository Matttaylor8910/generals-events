import {Component, EventEmitter, Input, Output} from '@angular/core';
import {kill} from 'process';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {ILeaderboardPlayer, ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-player-summary',
  templateUrl: './tournament-player-summary.component.html',
  styleUrls: ['./tournament-player-summary.component.scss'],
})
export class TournamentPlayerSummaryComponent {
  @Input() player: ILeaderboardPlayer;
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;

  @Output() close = new EventEmitter<void>();

  constructor(
      public readonly generals: GeneralsService,
      private readonly utilService: UtilService,
  ) {}

  get upcoming(): boolean {
    return this.status === TournamentStatus.UPCOMING;
  }

  get notFinished(): boolean {
    return this.status !== TournamentStatus.FINISHED;
  }

  /**
   * Only show KDR if it differs from average kills and only after this player
   * has died at least once
   */
  get showKDR(): boolean {
    const {averageKills, killDeathRatio, totalGames, totalWins} =
        this.player?.stats || {};
    return averageKills !== killDeathRatio && totalGames > totalWins;
  }

  getDurationString(prevFinished: number, started: number): string {
    if (prevFinished > started) {
      const overlap = this.utilService.getDurationString(started, prevFinished);
      return `Overlap of ${overlap}!`
    } else {
      return this.utilService.getDurationString(prevFinished, started);
    }
  }
}
