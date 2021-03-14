import {Component, Input} from '@angular/core';
import {cloneDeep} from 'lodash';
import {IBracketRound} from 'types';

@Component({
  selector: 'app-bracket',
  templateUrl: './bracket.component.html',
  styleUrls: ['./bracket.component.scss'],
})
export class BracketComponent {
  @Input() bracketRounds: IBracketRound[];
  @Input() hideCompletedRounds: boolean;
  @Input() minRoundsToShow: number;

  rounds: IBracketRound[];

  constructor() {}

  ngOnChanges() {
    if (this.hideCompletedRounds) {
      const nonCompleted = this.bracketRounds.filter(round => !round.complete);

      if (this.minRoundsToShow && nonCompleted.length < this.minRoundsToShow) {
        const end = this.bracketRounds.length;
        const start = this.bracketRounds.length > this.minRoundsToShow ?
            this.bracketRounds.length - this.minRoundsToShow :
            0;
        this.rounds = this.bracketRounds.slice(start, end);
      } else {
        this.rounds = nonCompleted;
      }
    } else {
      this.rounds = cloneDeep(this.bracketRounds);
    }
  }
}
