import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';

import {GeneralsServer} from '../../../../constants';
import {ILeaderboardPlayer, TournamentStatus} from '../../../../types';

@Component({
  selector: 'app-tournament-trophies',
  templateUrl: './tournament-trophies.component.html',
  styleUrls: ['./tournament-trophies.component.scss'],
})
export class TournamentTrophiesComponent {
  @Input() server = GeneralsServer.NA;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: TournamentStatus;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  get showTrophies() {
    return this.status === TournamentStatus.FINISHED;
  }

  get first(): ILeaderboardPlayer|null {
    return this.players?.length > 0 ? this.players[0] : null;
  }

  get second(): ILeaderboardPlayer|null {
    return this.players?.length > 1 ? this.players[1] : null;
  }

  get third(): ILeaderboardPlayer|null {
    return this.players?.length > 2 ? this.players[2] : null;
  }

  get showOtherPlaces(): boolean {
    return !!this.second && !!this.third;
  }
}
