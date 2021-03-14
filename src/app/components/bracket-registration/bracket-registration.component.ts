import {Component, EventEmitter, Input, Output, SimpleChanges} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {EventStatus, IArenaEvent, ILeaderboardPlayer} from '../../../../types';

@Component({
  selector: 'app-bracket-registration',
  templateUrl: './bracket-registration.component.html',
  styleUrls: ['./bracket-registration.component.scss'],
})
export class BracketRegistrationComponent {
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;
  @Input() registrationOpen: boolean;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  inEvent = false;
  recentlyJoined = false;

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes.players) {
      this.determineInEvent();
    }
  }

  // before the event starts, show the stars for the players
  get showStars(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get pageControlText(): string {
    const players = this.players?.length || 0;
    return `${players} ${players === 1 ? 'player' : 'players'} registered`;
  }

  get canJoin() {
    return !this.inEvent && this.registrationOpen;
  }

  get canLeave() {
    return this.inEvent && this.generals.name &&
        this.status === EventStatus.UPCOMING;
  }

  async join() {
    if (this.generals.name) {
      this.eventService.addPlayer(this.event.id, this.generals.name);
    } else {
      this.generals.login(this.event.id, true);
    }
    this.setRecentlyJoined();
  }

  async leave() {
    this.eventService.removePlayer(this.event.id, this.generals.name);
    this.setRecentlyJoined();
  }

  /**
   * Don't allow players to rapidly join and withdraw, make them wait 5 seconds
   */
  setRecentlyJoined() {
    this.recentlyJoined = true;
    setTimeout(() => {
      this.recentlyJoined = false;
    }, 5000);
  }

  determineInEvent() {
    this.inEvent =
        this.players && !!this.players.find(p => p.name === this.generals.name);
  }
}
