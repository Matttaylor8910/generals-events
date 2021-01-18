import {Component, Input, OnDestroy} from '@angular/core';
import {Subscription} from 'rxjs';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-queue',
  templateUrl: './tournament-queue.component.html',
  styleUrls: ['./tournament-queue.component.scss'],
})
export class TournamentQueueComponent implements OnDestroy {
  @Input() tournament: ITournament;
  @Input() inTournament: boolean;
  @Input() status: TournamentStatus;

  currentSubscription: string;
  redirect$: Subscription;

  constructor(
      private readonly generals: GeneralsService,
      private readonly tournamentService: TournamentService,
  ) {
    this.generals.nameChanged$.subscribe(this.checkRedirect.bind(this));
  }

  ngOnChanges() {
    this.checkRedirect();
  }

  get showTimer(): boolean {
    return this.status === TournamentStatus.UPCOMING;
  }

  get showQueueButton(): boolean {
    return this.status === TournamentStatus.ONGOING;
  }

  get inQueue(): boolean {
    return this.status !== TournamentStatus.ALMOST_DONE &&
        this.tournament?.queue?.includes(this.generals.name);
  }

  get message(): string {
    if (this.status === TournamentStatus.UPCOMING) {
      if (!this.inTournament) {
        return 'Join the event!';
      }
      return 'Welcome! This event has not started yet.';
    }
    if (this.status === TournamentStatus.ALMOST_DONE) {
      return 'This event is almost over, so no more games will be started. The winner will be announced soon!';
    }

    if (this.inQueue) {
      const count = this.tournament.queue.length;
      const max = this.tournament.playersPerGame;

      const current = ((count - 1) % max) + 1;
      const myPlace = this.tournament.queue.indexOf(this.generals.name);

      if (count >= max && myPlace < max) {
        return 'Creating lobby to join!';
      } else {
        return `Waiting for players, ${current} of ${max}. Get ready!`;
      }
    }
    return 'Join the queue to get your next game going!';
  }

  async toggleQueue() {
    if (this.inQueue) {
      this.tournamentService.leaveQueue(this.tournament.id, this.generals.name);
    } else {
      if (this.generals.name) {
        if (!this.inTournament) {
          await this.tournamentService.addPlayer(
              this.tournament.id, this.generals.name);
        }
        this.tournamentService.joinQueue(
            this.tournament.id, this.generals.name);
      } else {
        this.generals.login(this.tournament.id, true, this.tournament.server);
      }
    }
  }

  checkRedirect() {
    const subscription = `${this.tournament.id}_${this.generals.name}`;

    if (subscription !== this.currentSubscription) {
      this.unsubscribe();
      this.currentSubscription = subscription;

      if (this.tournament && this.generals.name) {
        this.redirect$ =
            this.tournamentService
                .getRedirect(this.tournament.id, this.generals.name)
                .subscribe(redirect => {
                  if (redirect) {
                    const {id, lobby} = redirect;
                    this.generals.joinLobby(lobby, this.tournament.server);
                    this.tournamentService.clearRedirect(
                        this.tournament.id, id, this.generals.name);
                  }
                });
      }
    }
  }

  private unsubscribe() {
    if (this.redirect$) {
      this.redirect$.unsubscribe();
      delete this.redirect$;
    }
  }

  ngOnDestroy() {
    this.unsubscribe();
  }
}
