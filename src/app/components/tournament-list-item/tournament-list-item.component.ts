import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {ITournament} from 'types';

@Component({
  selector: 'app-tournament-list-item',
  templateUrl: './tournament-list-item.component.html',
  styleUrls: ['./tournament-list-item.component.scss'],
})
export class TournamentListItemComponent {
  @Input() tournament: ITournament;

  constructor(
      private readonly router: Router,
  ) {}

  get duration(): string {
    if (this.tournament) {
      const {durationMinutes: mins} = this.tournament
      const hours = Math.floor(mins / 60);
      const rem = mins % 60;
      return `${hours ? hours + 'h ' : ''}${rem ? rem + 'm' : ''}`;
    }
    return '';
  }

  navToTournament() {
    this.router.navigate(['/', this.tournament.id]);
  }
}
