import {Component, EventEmitter, Input, Output} from '@angular/core';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, GameSpeed, IArenaEvent, IDoubleElimEvent} from 'types';

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
  
  get speedText(): string {
    return `Playing at ${this.event?.options?.speed || GameSpeed.SPEED_1X} speed`;
  }

  goToRules() {
    this.utilService.selectTab('Rules');
  }
}
