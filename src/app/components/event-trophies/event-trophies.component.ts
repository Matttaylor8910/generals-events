import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';

import {EventFormat, EventStatus, IEvent, ILeaderboardPlayer} from '../../../../types';

@Component({
  selector: 'app-event-trophies',
  templateUrl: './event-trophies.component.html',
  styleUrls: ['./event-trophies.component.scss'],
})
export class EventTrophiesComponent {
  @Input() event: IEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  get showTrophies() {
    return this.status === EventStatus.FINISHED;
  }

  get first(): ILeaderboardPlayer|null {
    return this.players?.length > 0 ? this.players[0] : null;
  }

  get second(): ILeaderboardPlayer|null {
    return this.players?.length > 1 ? this.players[1] : null;
  }

  get third(): ILeaderboardPlayer|null {
    return this.players?.length > 2 ? this.players[2] : null;
  }

  get showOtherPlaces(): boolean {
    return !!this.second && !!this.third;
  }

  get showStats(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }
}
