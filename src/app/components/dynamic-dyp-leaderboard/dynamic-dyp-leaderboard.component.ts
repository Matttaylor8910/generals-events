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

  @Output() playersClicked = new EventEmitter<string|string[]>();

  constructor() {}

  get leaderboard(): ILeaderboardPlayer[] {
    return this.players
        ?.sort((a, b) => {
          return b.stats?.winRate - a.stats?.winRate;
        })
        .filter(player => {
          return this.event?.checkedInPlayers?.includes(player.name);
        });
  }

  get showLeaderboard(): boolean {
    return this.event?.rounds !== undefined;
  }

  trackByFn(player: ILeaderboardPlayer) {
    return player.name;
  }
}
