import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDynamicDYPEvent, IDynamicDYPRound, ILeaderboardPlayer} from 'types';

import {ADMINS} from '../../../../constants';

import {getRounds} from './rounds-creator';

@Component({
  selector: 'app-dynamic-dyp-event',
  templateUrl: './dynamic-dyp-event.component.html',
  styleUrls: ['./dynamic-dyp-event.component.scss'],
})
export class DynamicDYPEventComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayers?: ILeaderboardPlayer[];
  @Input() disqualified: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  rounds: IDynamicDYPRound[];
  selectedTab = 'Registration';
  finals: boolean;

  maxRounds: number = 10;

  // TODO: remove
  playersToUse: number = 100;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.event?.rounds) {
      this.rounds = this.event.rounds;
      const finals = this.rounds.every(r => r.complete);

      // finals just started, move them to that tab
      if (finals === true && this.finals === false) {
        this.selectedTab = 'Finals';
      }
      this.finals = finals;

      // move from registration to rounds when the event starts
      if (this.selectedTab === 'Registration') {
        this.selectedTab = this.finals ? 'Finals' : 'Rounds';
        this.playersClicked.emit([]);
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
    return this.selectedTab === 'Rounds' || (this.isAdmin && this.showAdmin);
  }

  get showFinals(): boolean {
    return this.selectedTab === 'Finals';
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

      if (this.finals) {
        tabs.push('Finals');
      }
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

  generateEventRounds() {
    const players = this.event.checkedInPlayers.slice(0, this.playersToUse);
    // 'matt' is the oddManOut in the case of a player getting fewer games
    this.rounds = getRounds(players, 'matt', this.maxRounds);
    console.log(this.rounds);
  }

  // TODO: likely remove
  checkInAll() {
    for (const player of this.players) {
      this.eventService.checkInPlayer(this.event.id, player.name);
    }
  }

  startEvent() {
    this.eventService.updateEvent(this.event.id, {
      rounds: this.rounds,
      results: {},
      startTime: Date.now(),
      playerCount: this.event.checkedInPlayers.length,
    });
  }
}
