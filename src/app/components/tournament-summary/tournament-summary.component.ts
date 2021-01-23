import {Component, Input} from '@angular/core';
import {UtilService} from 'src/app/services/util.service';
import {ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-summary',
  templateUrl: './tournament-summary.component.html',
  styleUrls: ['./tournament-summary.component.scss'],
})
export class TournamentSummaryComponent {
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;

  constructor(
      private readonly utilService: UtilService,
  ) {}

  get duration(): string {
    return this.utilService.getDurationString(
        this.tournament?.startTime, this.tournament?.endTime);
  }

  get completed(): number {
    return this.tournament?.completedGameCount || 0;
  }

  get ongoing(): number {
    return this.tournament?.ongoingGameCount || 0;
  }

  get showGames(): boolean {
    return this.ongoing > 0 || this.completed > 0;
  }

  get boldText(): string {
    if (this.status === TournamentStatus.FINISHED) {
      return `${this.completed} ${
          this.completed === 1 ? 'game' : 'games'} completed`;
    } else {
      return `${this.ongoing} ${
          this.ongoing === 1 ? 'game' : 'games'} in progress`;
    }
  }

  get extraText(): string {
    if (this.status === TournamentStatus.FINISHED) {
      return '';
    } else {
      return `${this.completed} ${
          this.completed === 1 ? 'game' : 'games'} completed`;
    }
  }
}
