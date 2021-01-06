import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
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

  actions: IPopoverAction[] = [
    {label: 'Logout', onClick: () => localStorage.removeItem('generals-name')}
  ];

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly router: Router,
      private readonly tournamentService: TournamentService,
  ) {
    this.tournamentId = this.route.snapshot.paramMap.get('id');
    this.tournamentService.getTournament(this.tournamentId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(tournament => {
          this.tournament = tournament;
        });
  }

  get name() {
    return localStorage.getItem('generals-name');
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
