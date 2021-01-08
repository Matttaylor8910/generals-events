import {Component, Input} from '@angular/core';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {ILeaderboardPlayer, ITournament} from 'types';

@Component({
  selector: 'app-tournament-leaderboard',
  templateUrl: './tournament-leaderboard.component.html',
  styleUrls: ['./tournament-leaderboard.component.scss'],
})
export class TournamentLeaderboardComponent {
  private destroyed$ = new Subject<void>();

  @Input() tournament: ITournament;

  players: ILeaderboardPlayer[];
  visible: ILeaderboardPlayer[];
  offset = 0;
  size = 10;

  inTournament = false;

  constructor(
      public readonly generals: GeneralsService,
      private readonly tournamentService: TournamentService,
  ) {}

  ngOnInit() {
    this.tournamentService.getPlayers(this.tournament.id)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(players => {
          this.players = players;
          this.setVisible();
          this.determineInTournament();
        });
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
    return !this.inTournament && this.generals.name;
  }

  get canLeave() {
    return this.inTournament && this.generals.name;
  }

  prev() {
    this.offset -= this.size;
    this.setVisible();
  }

  next() {
    this.offset += this.size;
    this.setVisible();
  }

  setVisible() {
    this.visible = this.players.slice(this.offset, this.offset + this.size);
  }

  async join() {
    this.tournamentService.addPlayer(this.tournament.id, this.generals.name);
  }

  async leave() {
    this.tournamentService.removePlayer(this.tournament.id, this.generals.name);
  }

  determineInTournament() {
    this.inTournament = !!this.players.find(p => p.name === this.generals.name);
  }
}
