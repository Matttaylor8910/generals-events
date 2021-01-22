import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {UtilService} from 'src/app/services/util.service';
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
  players: ILeaderboardPlayer[];
  selectedPlayer?: Partial<ILeaderboardPlayer>;

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly router: Router,
      private readonly tournamentService: TournamentService,
      private readonly utilService: UtilService,
  ) {
    this.tournamentId = this.route.snapshot.params.id;
    this.tournamentService.getPlayers(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(players => {
          this.players = players;
          this.checkJoinQueue(players);
          this.determineSelectPlayer(true);
        });

    this.tournamentService.getTournament(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(tournament => {
          this.tournament = tournament;
          this.determineSelectPlayer();
        });
  }

  get status(): TournamentStatus {
    if (this.tournament) {
      const now = Date.now();
      const {startTime, endTime} = this.tournament;

      if (endTime < now) {
        return TournamentStatus.FINISHED;
      } else {
        if (startTime > now) {
          return TournamentStatus.UPCOMING;
        } else {
          const THIRTY_SECONDS = 1000 * 30;
          if (endTime - Date.now() < THIRTY_SECONDS) {
            return TournamentStatus.ALMOST_DONE;
          } else {
            return TournamentStatus.ONGOING;
          }
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

  determineSelectPlayer(playersUpdated = false) {
    if (this.players?.length && this.tournament) {
      if (this.selectedPlayer) {
        if (playersUpdated) {
          this.selectedPlayer = this.findPlayer(this.selectedPlayer.name);
        }
      } else {
        if (this.status === TournamentStatus.UPCOMING && this.generals.name) {
          this.selectedPlayer = this.findPlayer(this.generals.name);
        }
      }
    }
  }

  findPlayer(name: string): ILeaderboardPlayer|undefined {
    return this.players?.length ?
        this.players.find(player => player.name === name) :
        undefined;
  }

  selectPlayer(player?: ILeaderboardPlayer|string) {
    if (typeof player === 'string') {
      this.selectedPlayer = this.findPlayer(player);
      if (this.selectedPlayer === undefined) {
        this.utilService.showToast(`${player} hasn't joined this event!`);
        this.selectedPlayer = {name: player};
      }
    } else {
      this.selectedPlayer = player;
    }
  }

  goHome() {
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
