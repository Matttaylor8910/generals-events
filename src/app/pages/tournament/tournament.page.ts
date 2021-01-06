import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {TournamentService} from 'src/app/services/tournament.service';
import {ILeaderboardPlayer, ITournament} from 'types';

@Component({
  selector: 'app-tournament',
  templateUrl: './tournament.page.html',
  styleUrls: ['./tournament.page.scss'],
})
export class TournamentPage implements OnDestroy {
  private destroyed$ = new Subject<void>();

  tournamentId: string;
  tournament: ITournament;

  // TODO: show the player summary when a player is selected
  selectedPlayer: ILeaderboardPlayer;

  constructor(
      private readonly route: ActivatedRoute,
      private readonly tournamentService: TournamentService,
  ) {
    this.tournamentId = this.route.snapshot.paramMap.get('id');
    this.tournamentService.getTournament(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(tournament => {
          this.tournament = tournament;
        });
  }

  get finished(): boolean {
    return this.tournament && this.tournament.endTime !== null;
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
