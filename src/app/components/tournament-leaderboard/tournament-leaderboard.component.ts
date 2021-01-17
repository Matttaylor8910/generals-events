import {Component, Input, SimpleChanges} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {ILeaderboardPlayer, ITournament, TournamentStatus} from 'types';

@Component({
  selector: 'app-tournament-leaderboard',
  templateUrl: './tournament-leaderboard.component.html',
  styleUrls: ['./tournament-leaderboard.component.scss'],
})
export class TournamentLeaderboardComponent {
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;
  @Input() players: ILeaderboardPlayer[];

  visible: ILeaderboardPlayer[];
  offset = 0;
  size = 10;

  tracking: boolean;
  trackingTooltip = 'Automatically change pages to show my username';

  inTournament = false;
  recentlyJoined = false;

  constructor(
      public readonly generals: GeneralsService,
      private readonly tournamentService: TournamentService,
  ) {
    this.toggleTracking();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.players) {
      this.determineInTournament();
      this.setVisible();
    }
  }

  get showTracker(): boolean {
    return this.inTournament && this.players?.length > this.size;
  }

  get showTimer(): boolean {
    return this.status === TournamentStatus.ONGOING;
  }

  get showQueue(): boolean {
    return [TournamentStatus.UPCOMING, TournamentStatus.ONGOING].includes(
        this.status);
  }

  get pageControlText(): string {
    const players = this.players?.length || 0;
    const first = players ? this.offset + 1 : 0;
    let last = first + this.size - 1;
    if (last > players) {
      last = players;
    }
    const range = last ? `${first}-${last}` : first
    return `${range} / ${players}`;
  }

  get canPrev(): boolean {
    return this.offset > 0;
  }

  get canNext(): boolean {
    return this.offset + this.size < this.players?.length;
  }

  get canJoin() {
    return !this.inTournament && this.status === TournamentStatus.UPCOMING;
  }

  get canLeave() {
    return this.inTournament && this.generals.name &&
        this.status === TournamentStatus.UPCOMING;
  }

  prev() {
    if (this.canPrev) {
      this.offset -= this.size;
      this.toggleTracking(false);
      this.setVisible();
    }
  }

  next() {
    if (this.canNext) {
      this.offset += this.size;
      this.toggleTracking(false);
      this.setVisible();
    }
  }

  setVisible() {
    // short circuit
    if (!this.players?.length) {
      return this.visible = [];
    }

    if (this.tracking && this.inTournament) {
      const index = this.players.findIndex(p => p.name === this.generals.name);
      const page = Math.floor(index / this.size);
      this.offset = page * this.size;
    }
    this.visible = this.players.slice(this.offset, this.offset + this.size);
  }

  async join() {
    if (this.generals.name) {
      this.tournamentService.addPlayer(this.tournament.id, this.generals.name);
    } else {
      this.generals.login(this.tournament.id, true);
    }
    this.setRecentlyJoined();
  }

  async leave() {
    this.tournamentService.removePlayer(this.tournament.id, this.generals.name);
    this.setRecentlyJoined();
  }

  /**
   * Don't allow players to rapidly join and withdraw, make them wait 5 seconds
   */
  setRecentlyJoined() {
    this.recentlyJoined = true;
    setTimeout(() => {
      this.recentlyJoined = false;
    }, 5000);
  }

  determineInTournament() {
    this.inTournament =
        this.players && !!this.players.find(p => p.name === this.generals.name);
  }

  toggleTracking(setTo?: boolean) {
    this.tracking = setTo === undefined ? !this.tracking : setTo;
    this.setVisible();
  }
}
