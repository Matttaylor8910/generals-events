import {Component, EventEmitter, Input, Output} from '@angular/core';
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
  selector: 'app-event-trophy-player',
  templateUrl: './event-trophy-player.component.html',
  styleUrls: ['./event-trophy-player.component.scss'],
}) export class EventTrophyPlayerComponent {
  @Input() isArena: boolean;
  @Input() player: ILeaderboardPlayer;
  @Input() place: Place;

  @Output() playersClicked = new EventEmitter<void>();

  constructor() {}

  get rank(): string {
    return RANKS[this.place];
  }
}
