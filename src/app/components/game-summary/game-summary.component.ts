import {Component, Input} from '@angular/core';
import {IGame} from 'types';

@Component({
  selector: 'app-game-summary',
  templateUrl: './game-summary.component.html',
  styleUrls: ['./game-summary.component.scss'],
})
export class GameSummaryComponent {
  @Input() game: IGame;

  expanded = false;

  constructor() {}

  toggleExpanded() {
    this.expanded = !this.expanded;
  }
}
