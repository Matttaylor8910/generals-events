import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer, IMatchTeam, MatchTeamStatus} from 'types';

import {ADMINS} from '../../../../constants';

import {getShuffledBracket} from './bracket-creator';

@Component({
  selector: 'app-bracket-event',
  templateUrl: './bracket-event.component.html',
  styleUrls: ['./bracket-event.component.scss'],
})
export class BracketEventComponent {
  @Input() event: IDoubleElimEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;

  @Output() playerClicked = new EventEmitter<ILeaderboardPlayer>();

  bracket: IDoubleEliminationBracket;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.event?.bracket) {
      this.bracket = this.event.bracket;

      if (this.selectedTab = 'Registration') {
        this.selectedTab = 'Bracket';
      }
    }
  }

  selectedTab = 'Registration';

  get registrationOpen(): boolean {
    return !this.eventStarted;
  }

  get showRegistration(): boolean {
    return this.selectedTab === 'Registration' && this.registrationOpen;
  }

  get showBracket(): boolean {
    return this.selectedTab === 'Bracket';
  }

  get showStream(): boolean {
    return this.selectedTab === 'Stream';
  }

  get eventStarted(): boolean {
    return this.event?.bracket && this.status === EventStatus.ONGOING;
  }

  get tabs(): string[] {
    const tabs = [];

    // before the event starts
    if (this.registrationOpen) {
      tabs.push('Registration');

      if (ADMINS.includes(this.generals.name)) {
        tabs.push('Bracket');
      }
    }

    // during the event
    else {
      tabs.push('Bracket');
      tabs.push('Stream');
    }

    return tabs;
  }

  createBracket() {
    const teams: IMatchTeam[] = this.event.checkedInPlayers.map(name => {
      return {name, score: 0, status: MatchTeamStatus.UNDECIDED, dq: false};
    });
    this.bracket = getShuffledBracket(teams);
  }

  // TODO: likely remove
  checkInAll() {
    for (const player of this.players) {
      this.eventService.checkInPlayer(this.event.id, player.name);
    }
  }

  startEvent() {
    this.eventService.setBracket(this.event.id, this.bracket);
  }
}
