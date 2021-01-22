import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';

import {GeneralsServer} from '../../../../constants';
import {IGame} from '../../../../types';

@Component({
  selector: 'app-game-summary',
  templateUrl: './game-summary.component.html',
  styleUrls: ['./game-summary.component.scss'],
})
export class GameSummaryComponent {
  @Input() server = GeneralsServer.NA;
  @Input() game: IGame;

  @Output() nameClicked = new EventEmitter<string>();

  expanded = false;

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  toggleExpanded() {
    this.expanded = !this.expanded;
  }
}
