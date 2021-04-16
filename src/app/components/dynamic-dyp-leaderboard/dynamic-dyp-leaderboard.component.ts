import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventStatus, IDynamicDYPEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-dynamic-dyp-leaderboard',
  templateUrl: './dynamic-dyp-leaderboard.component.html',
  styleUrls: ['./dynamic-dyp-leaderboard.component.scss'],
})
export class DynamicDYPLeaderboardComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;

  @Output() playerClicked = new EventEmitter<string>();

  constructor() {}

  get leaderboard(): ILeaderboardPlayer[] {
    return this.players?.sort((a, b) => {
      return b.stats?.winRate - a.stats?.winRate;
    });
  }

  trackByFn(player: ILeaderboardPlayer) {
    return player.name;
  }
}
