import {Component, Input, OnInit} from '@angular/core';
import {ILeaderboardPlayer} from 'types';

enum Place {
  FIRST = 'first',
  SECOND = 'second',
  THIRD = 'third',
}

const RANKS = {
  [Place.FIRST]: '1st',
  [Place.SECOND]: '2nd',
  [Place.THIRD]: '3rd',
}

@Component({
  selector: 'app-tournament-trophy-player',
  templateUrl: './tournament-trophy-player.component.html',
  styleUrls: ['./tournament-trophy-player.component.scss'],
}) export class TournamentTrophyPlayerComponent implements OnInit {
  @Input() player: ILeaderboardPlayer;
  @Input() place: Place;

  constructor() {}

  ngOnInit() {}

  get rank(): string {
    return RANKS[this.place];
  }
}
