import {Component, EventEmitter, Input, Output, SimpleChanges} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {EventStatus, IDoubleElimEvent, ILeaderboardPlayer} from '../../../../types';

@Component({
  selector: 'app-bracket-registration',
  templateUrl: './bracket-registration.component.html',
  styleUrls: ['./bracket-registration.component.scss'],
})
export class BracketRegistrationComponent {
  @Input() event: IDoubleElimEvent;
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
      console.log(this.players, this.registrationOpen);
    }
  }

  // before the event starts, show the stars for the players
  get showStars(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get pageControlText(): string {
    const players = this.players?.length || 0;
    const registeredText =
        `${players} ${players === 1 ? 'player' : 'players'} registered`;

    const checkedIn = this.event?.checkedInPlayers?.length || 0;
    const checkedInText =
        `${checkedIn} ${checkedIn === 1 ? 'player' : 'players'} checked in`;

    return this.canCheckIn ? checkedInText : registeredText;
  }

  get canJoin(): boolean {
    return !this.inEvent && this.registrationOpen;
  }

  get canLeave(): boolean {
    return this.inEvent && this.generals.name && this.registrationOpen;
  }

  get canCheckIn(): boolean {
    return this.event.checkInTime < Date.now();
  }

  isCheckedIn(name: string) {
    return this.event?.checkedInPlayers?.includes(name);
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

  checkIn() {
    this.eventService.checkInPlayer(this.event.id, this.generals.name);
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

  trackByFn(player: ILeaderboardPlayer) {
    return player.name;
  }
}
