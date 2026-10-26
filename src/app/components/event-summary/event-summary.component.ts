import {Component, EventEmitter, Input, Output} from '@angular/core';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, EventType, GameSpeed, IArenaEvent, IDoubleElimEvent} from 'types';

@Component({
  selector: 'app-event-summary',
  templateUrl: './event-summary.component.html',
  styleUrls: ['./event-summary.component.scss'],
})
export class EventSummaryComponent {
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;

  constructor(
      private readonly utilService: UtilService,
  ) {}

  get capy(): boolean {
    return [this.event?.id, this.event?.parentId].some(id => id?.includes('Capy-Cup'));
  }

  get isArena(): boolean {
    return this.event.format === EventFormat.ARENA;
  }

  get duration(): string {
    return this.utilService.getDurationString(
        this.event?.startTime, this.event?.endTime);
  }

  get completed(): number {
    return this.event?.completedGameCount || 0;
  }

  get ongoing(): number {
    return this.event?.ongoingGameCount || 0;
  }

  get showGames(): boolean {
    return this.ongoing > 0 || this.completed > 0;
  }

  get boldText(): string {
    if (this.status === EventStatus.FINISHED) {
      return `${this.completed} ${
          this.completed === 1 ? 'game' : 'games'} completed`;
    } else {
      return `${this.ongoing} ${
          this.ongoing === 1 ? 'game' : 'games'} in progress`;
    }
  }

  get extraText(): string {
    if (this.status === EventStatus.FINISHED) {
      return '';
    } else {
      return `${this.completed} ${
          this.completed === 1 ? 'game' : 'games'} completed`;
    }
  }

  get needToQualify(): boolean {
    const {qualified = []} = this.event as unknown as IDoubleElimEvent;
    return qualified.length > 0;
  }

  get mapName(): string {
    return decodeURI(this.event?.options?.map);
  }

  get showTeamDetails(): boolean {
    return this.event?.type === EventType.BIG_TEAM ||
        this.event?.type === EventType.TWO_VS_TWO;
  }

  get teamDetailsText(): string {
    const teamSize = this.event?.teamSize || (this.event?.type === EventType.ONE_VS_ONE ? 1 : 2);
    const playersPerGame = this.event?.playersPerGame || teamSize * 2;
    const teamCount = Math.max(1, Math.floor(playersPerGame / Math.max(teamSize, 1)));
    return `${teamCount} ${teamCount === 1 ? 'team' : 'teams'} of ${teamSize}`;
  }

  get speedText(): string {
    return `Playing at ${this.event?.options?.speed || GameSpeed.SPEED_1X} speed`;
  }

  goToRules() {
    this.utilService.selectTab('Rules');
  }
}
