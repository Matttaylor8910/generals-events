import {Component, Input, OnInit} from '@angular/core';
import {GeneralsServer} from 'constants';
import {GeneralsService} from 'src/app/services/generals.service';
import {ILeaderboardPlayer, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-trophies',
  templateUrl: './tournament-trophies.component.html',
  styleUrls: ['./tournament-trophies.component.scss'],
})
export class TournamentTrophiesComponent implements OnInit {
  @Input() server = GeneralsServer.NA;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: TournamentStatus;

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  ngOnInit() {}

  get showTrophies() {
    return this.status === TournamentStatus.FINISHED;
  }

  get winner(): string|null {
    return this.players?.length ? this.players[0].name : null;
  }
}
