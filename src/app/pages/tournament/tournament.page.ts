import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Observable, Subject} from 'rxjs';
import {takeUntil, tap} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {ILeaderboardPlayer, ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament',
  templateUrl: './tournament.page.html',
  styleUrls: ['./tournament.page.scss'],
})
export class TournamentPage implements OnDestroy {
  private destroyed$ = new Subject<void>();

  TournamentStatus = TournamentStatus;

  tournamentId: string;
  tournament: ITournament;
  players$: Observable<ILeaderboardPlayer[]>;

  // TODO: show the player summary when a player is selected
  selectedPlayer: ILeaderboardPlayer;

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly router: Router,
      private readonly tournamentService: TournamentService,
  ) {
    this.tournamentId = this.route.snapshot.params.id;
    this.players$ = this.tournamentService.getPlayers(this.tournamentId)
                        .pipe(tap(players => {
                          this.checkJoinQueue(players);
                        }));

    this.tournamentService.getTournament(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(tournament => {
          this.tournament = tournament;
        });
  }

  get status(): TournamentStatus {
    if (this.tournament) {
      const now = Date.now();

      if (this.tournament.finished || this.tournament.endTime < now) {
        return TournamentStatus.FINISHED;
      } else {
        if (this.tournament.startTime > now) {
          return TournamentStatus.UPCOMING;
        } else {
          return TournamentStatus.ONGOING;
        }
      }
    }
    return TournamentStatus.UNKNOWN;
  }

  async checkJoinQueue(players: ILeaderboardPlayer[]) {
    // if this url has the url param "join=true" and the user has their
    // generals name set, join the queue
    if (location.href.includes('join=true')) {
      const {name} = this.generals;
      if (name && this.status !== TournamentStatus.FINISHED) {
        if (!players.some(p => p.name === name)) {
          await this.tournamentService.addPlayer(this.tournamentId, name);
        }

        // only add to queue if the tournament is ongoing
        if (this.status === TournamentStatus.ONGOING) {
          this.tournamentService.joinQueue(this.tournamentId, name);
        }
      }
    }
    // remove the join url param
    if (location.href.includes('join=')) {
      this.router.navigate(['/', this.tournamentId]);
    }
  }

  goHome() {
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
