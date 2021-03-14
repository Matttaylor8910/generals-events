import {Component, Input} from '@angular/core';
import {IDoubleEliminationBracket} from 'types';

@Component({
  selector: 'app-double-elimination-bracket',
  templateUrl: './double-elimination-bracket.component.html',
  styleUrls: ['./double-elimination-bracket.component.scss'],
})
export class DoubleEliminationBracketComponent {
  @Input() bracket: IDoubleEliminationBracket;
  @Input() hideCompletedRounds: boolean = true;
  @Input() minRoundsToShow: number = 4;

  showToggle = false;

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
  }
}
