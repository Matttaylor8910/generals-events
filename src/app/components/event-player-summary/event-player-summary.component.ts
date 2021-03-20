import {Component, EventEmitter, Input, Output} from '@angular/core';
import {kill} from 'process';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, IArenaEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-event-player-summary',
  templateUrl: './event-player-summary.component.html',
  styleUrls: ['./event-player-summary.component.scss'],
})
export class EventPlayerSummaryComponent {
  @Input() player: ILeaderboardPlayer;
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;
  @Input() showRank: boolean;

  @Output() close = new EventEmitter<void>();

  constructor(
      public readonly generals: GeneralsService,
      private readonly utilService: UtilService,
  ) {}

  get upcoming(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get notFinished(): boolean {
    return this.status !== EventStatus.FINISHED;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get isBracket(): boolean {
    return this.event?.format === EventFormat.DOUBLE_ELIM;
  }

  /**
   * Only show KDR if it differs from average kills and only after this player
   * has died at least once
   */
  get showKDR(): boolean {
    const {averageKills, killDeathRatio, totalGames, totalWins} =
        this.player?.stats || {};
    return averageKills !== killDeathRatio && totalGames > totalWins;
  }

  getDurationString(prevFinished: number, started: number): string {
    if (prevFinished > started) {
      const overlap = this.utilService.getDurationString(started, prevFinished);
      return `Overlap of ${overlap}!`
    } else {
      return this.utilService.getDurationString(prevFinished, started);
    }
  }
}
