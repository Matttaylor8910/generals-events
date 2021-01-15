import {Component, Input} from '@angular/core';
import {GeneralsServer} from 'constants';
import {GeneralsService} from 'src/app/services/generals.service';
import {IGame} from 'types';

@Component({
  selector: 'app-game-summary',
  templateUrl: './game-summary.component.html',
  styleUrls: ['./game-summary.component.scss'],
})
export class GameSummaryComponent {
  @Input() server = GeneralsServer.NA;
  @Input() game: IGame;

  expanded = false;

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  toggleExpanded() {
    this.expanded = !this.expanded;
  }
}
