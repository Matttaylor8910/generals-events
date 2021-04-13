import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventStatus, IDynamicDYPEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-dynamic-dyp-event',
  templateUrl: './dynamic-dyp-event.component.html',
  styleUrls: ['./dynamic-dyp-event.component.scss'],
})
export class DynamicDYPEventComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  constructor() {}

  get showRegistration(): boolean {
    // TODO: we have some work to do
    return true;
  }

  get registrationOpen(): boolean {
    // TODO: we have some work to do
    return true;
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }
}
