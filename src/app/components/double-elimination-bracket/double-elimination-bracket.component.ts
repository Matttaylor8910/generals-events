import {Component, EventEmitter, Input, Output} from '@angular/core';
import {IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer} from 'types';

const HIDE_COMPLETED = 'generals-hide-completed';
@Component({
  selector: 'app-double-elimination-bracket',
  templateUrl: './double-elimination-bracket.component.html',
  styleUrls: ['./double-elimination-bracket.component.scss'],
})
export class DoubleEliminationBracketComponent {
  @Input() event: IDoubleElimEvent;
  @Input() bracket: IDoubleEliminationBracket;
  @Input() minRoundsToShow = 4;

  @Output() playerClicked = new EventEmitter<string>();

  showToggle = false;
  hideCompletedRounds: boolean;

  constructor() {
    this.hideCompletedRounds = localStorage.getItem(HIDE_COMPLETED) !== 'false';
  }

  ngOnChanges() {
    this.showToggle = this.shouldShowToggle();
  }

  get toggleText() {
    return `${this.hideCompletedRounds ? 'Show' : 'Hide'} Completed Rounds`;
  }

  shouldShowToggle(): boolean {
    if (this.bracket) {
      const {winners, losers} = this.bracket;
      const winnersCompleted = winners.filter(round => round.complete).length;
      const losersCompleted = losers.filter(round => round.complete).length;

      if (winnersCompleted || losersCompleted) {
        return winners.length > this.minRoundsToShow ||
            losers.length > this.minRoundsToShow;
      }
    }
    return false;
  }

  toggleHideCompleted() {
    this.hideCompletedRounds = !this.hideCompletedRounds;
    localStorage.setItem(HIDE_COMPLETED, String(this.hideCompletedRounds));
  }
}
