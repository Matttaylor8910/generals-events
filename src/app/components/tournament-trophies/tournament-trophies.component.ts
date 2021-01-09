import {Component, Input, OnInit} from '@angular/core';
import {ILeaderboardPlayer, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-trophies',
  templateUrl: './tournament-trophies.component.html',
  styleUrls: ['./tournament-trophies.component.scss'],
})
export class TournamentTrophiesComponent implements OnInit {
  @Input() players: ILeaderboardPlayer[];
  @Input() status: TournamentStatus;

  constructor() {}

  ngOnInit() {}

  get showTrophies() {
    return this.status === TournamentStatus.FINISHED;
  }

  get winnerString(): string {
    return this.players?.length ? `${this.players[0].name} wins!` :
                                  'No one won?';
  }
}
