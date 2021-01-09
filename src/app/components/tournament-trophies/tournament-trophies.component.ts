import {Component, Input, OnInit} from '@angular/core';
import {ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-trophies',
  templateUrl: './tournament-trophies.component.html',
  styleUrls: ['./tournament-trophies.component.scss'],
})
export class TournamentTrophiesComponent implements OnInit {
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;

  constructor() {}

  ngOnInit() {}

  get showTrophies() {
    return this.status === TournamentStatus.FINISHED;
  }

  get winnerString(): string {
    return 'No one won?';
  }
}
