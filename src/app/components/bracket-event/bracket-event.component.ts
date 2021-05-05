import {Component, EventEmitter, Input, Output} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventStatus, IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer} from 'types';

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
  selectedTab = 'Registration';

  // TODO: remove - temp thing for qualified
  qualified: string;
  tsp: string;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.event?.bracket) {
      this.bracket = this.event.bracket;

      if (this.selectedTab === 'Registration') {
        this.selectedTab = 'Bracket';
      }
    }
  }

  get registrationOpen(): boolean {
    return this.event?.bracket === undefined;
  }

  get showRegistration(): boolean {
    return this.selectedTab === 'Registration' && this.registrationOpen;
  }

  get showBracket(): boolean {
    return this.selectedTab === 'Bracket';
  }

  get showRules(): boolean {
    return this.selectedTab === 'Rules';
  }

  get showStream(): boolean {
    return this.selectedTab === 'Stream';
  }

  get showAdmin(): boolean {
    return this.selectedTab === 'Admin';
  }

  get eventStarted(): boolean {
    return this.event?.bracket && this.status === EventStatus.ONGOING;
  }

  get tabs(): string[] {
    const tabs = [];

    // before the event starts
    if (this.registrationOpen) {
      tabs.push('Registration');

      if (this.isAdmin) {
        tabs.push('Admin');
      }
    }

    // during the event
    else {
      tabs.push('Bracket');

      if (this.event?.twitchChannel) {
        tabs.push('Stream');
      }
    }

    // Always show a rules tab
    tabs.push('Rules');

    return tabs;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get showBracketButtons(): boolean {
    return this.isAdmin && !this.event?.bracket;
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  createBracket() {
    this.bracket = getShuffledBracket(this.event);
  }

  // TODO: likely remove
  checkInAll() {
    for (const player of this.players) {
      if (!this.event.qualified || this.event.qualified.includes(player.name)) {
        this.eventService.checkInPlayer(this.event.id, player.name);
      }
    }
  }

  startEvent() {
    this.eventService.updateEvent(this.event.id, {
      bracket: this.bracket,
      startTime: Date.now(),
      playerCount: this.event.checkedInPlayers.length,
    });
  }

  handlePlayerClicked(name: string) {
    const player = this.players.find(p => p.name === name);
    this.playerClicked.emit(player);
  }

  // TODO: likely remove
  setQualified() {
    const qualified = JSON.parse(this.qualified);
    this.eventService.updateEvent(this.event.id, {qualified});
    delete this.qualified;
  }

  // TODO: likely remove
  setTSP() {
    const tsp = JSON.parse(this.tsp);
    this.eventService.updateEvent(this.event.id, {tsp});
    delete this.tsp;
  }
}

// TO GET LEADERBOARD:
`
copy(Array.from(document.getElementsByTagName('tr')).slice(1).map(row => {
  const [rank, name] = row.childNodes;
  const [span] = name.childNodes;
  return span.textContent;
}));
`;

// TO GET RANKINGS:
`
var currentLeaderboard = [];
var madeIt = new Set();
var {rankings} = window.__PRELOADED_STATE__;
rankings.push({
  duel: currentLeaderboard.map(username => {
    return {username};
  })
});
for (const week of rankings.slice(1)) {
  var {duel} = week;
  var added = 0;
  var index = 0;
  while (added < 25 && duel[index]) {
    var {username} = duel[index++];
    if (username && !madeIt.has(username)) {
      madeIt.add(username);
      added++;
    }
  }
}
copy(JSON.stringify(Array.from(madeIt)));
`;

// TO GET TSP:
`
var TSP = {};
Array.from(document.getElementsByTagName('tr')).slice(1).forEach(row => {
  const [rank, name, tsp] = row.childNodes;
  const [span] = name.childNodes;
  const username = span.textContent;
  TSP[username] = Number(tsp.textContent);
});
copy(JSON.stringify(TSP));
`

    // TSP['1.e4 e5  2.Ke2!!'] = TSP['1.e4 e5 2.Ke2!!'];
