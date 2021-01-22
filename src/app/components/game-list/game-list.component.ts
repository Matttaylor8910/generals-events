import {Component, EventEmitter, Input, Output} from '@angular/core';
import {Observable} from 'rxjs';
import {TournamentService} from 'src/app/services/tournament.service';
import {IGame, ITournament} from 'types';

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
})
export class GameListComponent {
  @Input() tournament: ITournament;

  @Output() nameClicked = new EventEmitter<string>();

  games$: Observable<IGame[]>;

  constructor(
      private readonly tournamentService: TournamentService,
  ) {}

  ngOnInit() {
    this.games$ = this.tournamentService.getGames(this.tournament.id, 15);
  }
}
