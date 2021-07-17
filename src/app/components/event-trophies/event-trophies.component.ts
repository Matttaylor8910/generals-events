import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';

import {EventFormat, EventStatus, EventType, IEvent, ILeaderboardPlayer} from '../../../../types';

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

  get showTrophies(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  get is2v2(): boolean {
    return this.event?.type === EventType.TWO_VS_TWO;
  }

  get first(): ILeaderboardPlayer|null {
    const player = this.players?.length > 0 ? {...this.players[0]} : null;
    if (this.is2v2) {
      player.name += ` and ${this.players[1]?.name}`
    }
    return player;
  }

  get second(): ILeaderboardPlayer|null {
    const index = this.is2v2 ? 2 : 1;
    const player = this.players?.length > 1 ? {...this.players[index]} : null;
    if (this.is2v2) {
      player.name += ` and ${this.players[index + 1]?.name}`
    }
    return player;
  }

  get third(): ILeaderboardPlayer|null {
    const index = this.is2v2 ? 4 : 2;
    const player = this.players?.length > 2 ? {...this.players[index]} : null;
    if (this.is2v2) {
      player.name += ` and ${this.players[index + 1]?.name}`
    }
    return player;
  }

  get showOtherPlaces(): boolean {
    return !!this.second && !!this.third;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get dyp(): boolean {
    return this.event?.format === EventFormat.DYNAMIC_DYP;
  }
}
