import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {UtilService} from 'src/app/services/util.service';
import {ITournament} from 'types';

@Component({
  selector: 'app-tournament-overview',
  templateUrl: './tournament-overview.component.html',
  styleUrls: ['./tournament-overview.component.scss'],
})
export class TournamentOverviewComponent {
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
