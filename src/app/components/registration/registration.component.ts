import {Component, EventEmitter, Input, Output, SimpleChanges} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {EventStatus, IDoubleElimEvent, ILeaderboardPlayer, PartnerStatus} from '../../../../types';

@Component({
  selector: 'app-registration',
  templateUrl: './registration.component.html',
  styleUrls: ['./registration.component.scss'],
})
export class RegistrationComponent {
  @Input() event: IDoubleElimEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayers?: ILeaderboardPlayer[];
  @Input() disqualified: boolean;
  @Input() registrationOpen: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

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
    let registeredText =
        `${players} ${players === 1 ? 'player' : 'players'} registered`;

    // for events you must qualify for, show a count of qualified
    if (this.showQualified) {
      const qualified =
          this.players?.filter(p => this.event?.qualified?.includes(p.name))
              ?.length ??
          0;

      // only show the number of qualifiers if it's less than the total number
      // of players registered. "28 players registered (28 players qualify)"
      // would be quite redundant
      if (qualified < players) {
        registeredText += ` (${qualified} ${
            qualified === 1 ? 'player qualifies' : 'players qualify'})`;
      }
    }

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

  get showQualified(): boolean {
    return this.event?.qualified?.length > 0;
  }

  eventWins(player: ILeaderboardPlayer): string[] {
    if (player?.stats?.eventWins) {
      return new Array(player.stats.eventWins);
    }
    return [];
  }

  isSelected(name: string): boolean {
    return this.selectedPlayers?.some(p => p.name === name);
  }

  isQualified(player: ILeaderboardPlayer): boolean {
    return !this.showQualified || this.event?.qualified?.includes(player.name) || player.stats?.eventWins > 0;
  }

  isCheckedIn(name: string): boolean {
    return this.event?.checkedInPlayers?.includes(name);
  }

  async join() {
    if (this.generals.name) {
      this.eventService.addPlayer(this.event.id, this.generals.name);
    } else {
      this.generals.loginFromEvent(this.event, true);
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

  showPartner(player: ILeaderboardPlayer): boolean {
    return player.partnerStatus === PartnerStatus.CONFIRMED && !!player.partner;
  }

  trackByFn(player: ILeaderboardPlayer) {
    return player.name;
  }
}
