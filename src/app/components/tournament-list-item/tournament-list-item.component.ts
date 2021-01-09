import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {UtilService} from 'src/app/services/util.service';
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
      private readonly utilService: UtilService,
  ) {}

  get duration(): string {
    return this.utilService.durationString(this.tournament?.durationMinutes);
  }

  navToTournament() {
    this.router.navigate(['/', this.tournament.id]);
  }
}
