import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
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
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly router: Router,
      private readonly tournamentService: TournamentService,
  ) {
    this.tournamentId = this.route.snapshot.params.id;

    this.tournamentService.getTournament(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(tournament => {
          this.tournament = tournament;
        });

    // if this url has the url param "join=true" and the user has their
    // generals name set, join the queue
    if (location.href.includes('join=true')) {
      if (this.generals.name) {
        this.tournamentService.joinQueue(this.tournamentId, this.generals.name);
      }
    }
    // remove the join url param
    if (location.href.includes('join=')) {
      this.router.navigate(['/', this.tournamentId]);
    }
  }

  get finished(): boolean {
    return this.tournament && this.tournament.endTime !== null;
  }

  goHome() {
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
