import {Component, Input} from '@angular/core';
import {EventStatus, EventType, IEvent} from 'types';

@Component({
  selector: 'app-rules',
  templateUrl: './rules.component.html',
  styleUrls: ['./rules.component.scss'],
})
export class RulesComponent {
  @Input() event: IEvent;
  @Input() status: EventStatus;

  private _showRules = false;

  constructor() {}

  get showRules() {
    return this._showRules || this.status === EventStatus.UPCOMING;
  }

  get hasStreaks(): boolean {
    return this.event && this.event.type !== EventType.FFA;
  }

  get firstPlaceBonus(): boolean {
    return this.event?.type === EventType.FFA;
  }

  toggleShowRules() {
    this._showRules = !this._showRules;
  }
}
