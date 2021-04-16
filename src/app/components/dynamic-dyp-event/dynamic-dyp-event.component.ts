import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDynamicDYPEvent, IDynamicDYPRound, ILeaderboardPlayer} from 'types';
import {ADMINS} from '../../../../constants';

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

  rounds: IDynamicDYPRound[];
  selectedTab = 'Registration';

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.event?.rounds) {
      this.rounds = this.event.rounds;

      if (this.selectedTab === 'Registration') {
        this.selectedTab = 'Rounds';
      }
    }
  }

  get registrationOpen(): boolean {
    return this.event?.rounds === undefined;
  }

  get showRegistration(): boolean {
    return this.selectedTab === 'Registration' && this.registrationOpen;
  }

  get showRounds(): boolean {
    return this.selectedTab === 'Rounds';
  }

  get showAdmin(): boolean {
    return this.selectedTab === 'Admin';
  }

  get showRules(): boolean {
    return this.selectedTab === 'Rules';
  }

  get tabs(): string[] {
    const tabs = [];

    // before the event starts
    if (this.registrationOpen) {
      tabs.push('Registration');
    }

    // during the event
    else {
      tabs.push('Rounds');
    }

    // admin tab
    if (this.isAdmin) {
      tabs.push('Admin');
    }

    // Always show a rules tab
    tabs.push('Rules');

    return tabs;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }
}
