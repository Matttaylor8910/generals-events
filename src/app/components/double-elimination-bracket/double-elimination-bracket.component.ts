import {Component, Input} from '@angular/core';
import {IDoubleEliminationBracket} from 'types';

@Component({
  selector: 'app-double-elimination-bracket',
  templateUrl: './double-elimination-bracket.component.html',
  styleUrls: ['./double-elimination-bracket.component.scss'],
})
export class DoubleEliminationBracketComponent {
  @Input() bracket: IDoubleEliminationBracket;
  @Input() hideCompletedRounds: boolean;
  @Input() minRoundsToShow: number;
}
