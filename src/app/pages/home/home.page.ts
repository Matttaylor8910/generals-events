import {Component} from '@angular/core';
import {TournamentService} from 'src/app/services/tournament.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  constructor(
      private readonly tournamentService: TournamentService,
  ) {}

  createTournament() {
    // TODO: make modal
    this.tournamentService.createTournament({
      durationMinutes: 60,
      playersPerGame: 8,
    });
  }
}
