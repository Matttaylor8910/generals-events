import {Component, EventEmitter, Input, Output, SimpleChanges} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';

import {ADMINS} from '../../../../constants';
import {ILeaderboardPlayer, ITournament, TournamentStatus, TournamentType} from '../../../../types';

@Component({
  selector: 'app-tournament-leaderboard',
  templateUrl: './tournament-leaderboard.component.html',
  styleUrls: ['./tournament-leaderboard.component.scss'],
})
export class TournamentLeaderboardComponent {
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  visible: ILeaderboardPlayer[];
  offset = 0;
  size = 10;

  tracking: boolean;
  trackingTooltip = 'Automatically change pages to show my username';

  inTournament = false;
  recentlyJoined = false;

  absentPlayers: ILeaderboardPlayer[] = [];

  constructor(
      public readonly generals: GeneralsService,
      private readonly tournamentService: TournamentService,
  ) {
    this.toggleTracking();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.players) {
      this.determineInTournament();
      this.determineAbsentPlayers();
      this.setVisible();
    }
  }

  // before the tournament starts, show the stars for the players
  get showStars(): boolean {
    return this.status === TournamentStatus.UPCOMING;
  }

  get showStreaks(): boolean {
    return this.tournament && this.tournament.type !== TournamentType.FFA;
  }

  get showTracker(): boolean {
    return this.inTournament && this.players?.length > this.size;
  }

  get showTimer(): boolean {
    return [
      TournamentStatus.ONGOING,
      TournamentStatus.ALMOST_DONE,
    ].includes(this.status);
  }

  get showQueue(): boolean {
    return [
      TournamentStatus.UPCOMING,
      TournamentStatus.ONGOING,
      TournamentStatus.ALMOST_DONE,
    ].includes(this.status);
  }

  get showPrune(): boolean {
    return ADMINS.includes(this.generals.name) &&
        this.status === TournamentStatus.FINISHED &&
        this.absentPlayers.length > 0;
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

  toggleTracking(setTo?: boolean) {
    this.tracking = setTo === undefined ? !this.tracking : setTo;
    this.setVisible();
  }

  determineInTournament() {
    this.inTournament =
        this.players && !!this.players.find(p => p.name === this.generals.name);
  }

  determineAbsentPlayers() {
    this.absentPlayers =
        this.players.filter(player => !player.stats?.totalGames);
  }

  async prunePlayers() {
    for (const player of this.absentPlayers) {
      console.log(`${player.name} didn't play, pruning...`);
      this.tournamentService.removePlayer(this.tournament.id, player.name);
    }
  }
}
