import {Component, Input} from '@angular/core';
import {isTeamArena} from 'team-arena';
import {DoublesPairingStrategy, EventFormat, EventStatus, EventType, IArenaEvent, IDoubleElimEvent} from 'types';

@Component({
  selector: 'app-rules',
  templateUrl: './rules.component.html',
  styleUrls: ['./rules.component.scss'],
})
export class RulesComponent {
  @Input() event: IDoubleElimEvent;
  @Input() status: EventStatus;

  private rulesExpanded = false;

  constructor() {}

  get showRules(): boolean {
    return this.rulesExpanded || this.status === EventStatus.UPCOMING ||
        this.isBracket || this.isDynamicDYP;
  }

  get isFFA(): boolean {
    return this.event?.type === EventType.FFA;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get isTeamArena(): boolean {
    return isTeamArena(this.event);
  }

  get randomPartners(): boolean {
    return this.isTeamArena && this.event?.doublesPairingStrategy ===
        DoublesPairingStrategy.RANDOM_PARTNERS;
  }

  get isBracket(): boolean {
    return this.event?.format === EventFormat.DOUBLE_ELIM;
  }

  get isDynamicDYP(): boolean {
    return this.event?.format === EventFormat.DYNAMIC_DYP;
  }

  get showQualified(): boolean {
    return this.event?.qualified?.length > 0;
  }

  getPlayers(week: number): string {
    const amount = 25;
    const offset = (week - 1) * amount;
    return this.event.qualified.slice(offset, offset + amount).join(', ') || '(25 spots open)';
  }

  bestOf(winningSets: number): string {
    return `best ${winningSets} of ${winningSets * 2 - 1}`;
  }

  toggleShowRules() {
    this.rulesExpanded = !this.rulesExpanded;
  }
}
