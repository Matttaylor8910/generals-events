import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {cloneDeep} from 'lodash';
import {Observable, Subject} from 'rxjs';
import {takeUntil, tap} from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, EventType, IArenaEvent, IDoubleElimEvent, IEvent, ILeaderboardPlayer, IMatchTeam, Visibility} from 'types';
import * as moment from 'moment-timezone';
import * as firebase from 'firebase';

import {ADMINS} from '../../../../constants';

@Component({
  selector: 'app-event',
  templateUrl: './event.page.html',
  styleUrls: ['./event.page.scss'],
})
export class EventPage implements OnDestroy {
  private destroyed$ = new Subject<void>();

  EventStatus = EventStatus;

  // eventId is always the id of the page, so in a multi-stage event, this will
  // be the parentId, not the id of the selected event
  eventId: string;

  event: IEvent;
  parent: IEvent;

  children$: Observable<IEvent[]>;

  players: ILeaderboardPlayer[];
  players$: Observable<ILeaderboardPlayer[]>;
  selectedPlayers = [];

  disqualified = localStorage.getItem('generals-dq') === 'true';

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly router: Router,
      private readonly eventService: EventService,
      private readonly utilService: UtilService,
  ) {
    this.eventId = this.route.snapshot.params.id;

    this.eventService.getEvent(this.eventId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(event => {
          this.parent = event;
          this.setEvent(event);
          this.determineSelectPlayer();

          // if multi-stage, load the events that are part of this event and
          // select the first one
          if (this.event.format === EventFormat.MULTI_STAGE_EVENT) {
            this.children$ = this.eventService.getEvents(this.eventId)
                                 .pipe(tap(this.selectChild.bind(this)));
          }
        });
  }

  get blocked(): boolean {
    return this.event?.chatBlocklist?.includes(this.generals.name)
  }

  get status(): EventStatus {
    if (this.event) {
      const now = Date.now();
      const {startTime, endTime} = this.event;

      if (endTime < now) {
        return EventStatus.FINISHED;
      } else {
        const {bracket} = this.event as IDoubleElimEvent;

        if (startTime > now || (this.isBracket && !bracket)) {
          return EventStatus.UPCOMING;
        } else {
          const THIRTY_SECONDS = 1000 * 30;
          if (endTime - Date.now() < THIRTY_SECONDS) {
            return EventStatus.ALMOST_DONE;
          } else {
            return EventStatus.ONGOING;
          }
        }
      }
    }
    return EventStatus.UNKNOWN;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get isBracket(): boolean {
    return this.event?.format === EventFormat.DOUBLE_ELIM;
  }

  get isDynamicDYP(): boolean {
    return this.event?.format === EventFormat.DYNAMIC_DYP;
  }

  /**
   * Base the event being multi-stage off of the parent format, because the
   * event will change as they select from the top bar
   */
  get isMultiStage(): boolean {
    return this.parent?.format === EventFormat.MULTI_STAGE_EVENT;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get showWide(): boolean {
    if (this.isBracket) {
      const event = this.event as IDoubleElimEvent;
      return !!event.bracket;
    }
    return false;
  }

  get showRightPanel(): boolean {
    return this.selectedPlayers?.length > 0 || this.event?.endTime > 0;
  }

  get inEvent(): boolean {
    return this.players?.some(p => p.name === this.generals.name);
  }

  get isOver(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  setPlayers(eventId: string) {
    this.players$ = this.eventService.getPlayers(eventId).pipe(tap(players => {
      this.players = players;
      this.checkJoinQueue();
      this.determineSelectPlayer(true);
      this.determineDisqualified();
    }));
  }

  setEvent(event: IEvent) {
    // only update the players if we have changed to a new event
    if (this.event?.id !== event.id) {
      this.setPlayers(event.id);
    }

    this.event = event;
  }

  async checkJoinQueue() {
    // skip the join param for the parent in a multi stage event
    if (this.event?.format === EventFormat.MULTI_STAGE_EVENT) {
      return;
    }

    // if this url has the url param "join=true" and the user has their
    // generals name set, join the queue
    if (location.href.includes('join=true') && this.event?.id) {
      const {name} = this.generals;

      // add the player to the event if registration is open
      // for arena: any time, so long as the tournament isn't over
      // for brackets: up until the bracket has been generated
      const registrationOpen = this.isArena ?
          this.status !== EventStatus.FINISHED :
          !(this.event as IDoubleElimEvent)?.bracket;

      if (name && registrationOpen) {
        // join the event if you haven't already
        if (!this.inEvent) {
          await this.eventService.addPlayer(this.event.id, name);
        }

        // only add to queue if the event is ongoing
        // and this event type is arena
        if (this.status === EventStatus.ONGOING && this.isArena) {
          console.log('joining queue', this.event.id);
          this.eventService.joinQueue(this.event.id, name);
        }
      }
    }
    // remove the join url param
    if (location.href.includes('join=')) {
      this.router.navigate(['/', this.eventId]);
    }
  }

  determineSelectPlayer(playersUpdated = false) {
    if (this.players?.length && this.event) {
      if (this.selectedPlayers.length > 0) {
        if (playersUpdated) {
          // allow selectedPlayer to be the first in the array, we are using
          // this player to see if the number of games played has changed, and
          // in a team they all change at the same time
          const [selectedPlayer] = this.selectedPlayers;
          const updated = this.findPlayer(selectedPlayer.name);
          const previousGames = selectedPlayer.stats?.totalGames || 0;

          // if the selected players have played another game, update their
          // stats
          if (previousGames < updated?.stats?.totalGames) {
            this.setSelectedPlayers(this.selectedPlayers.map(player => {
              return this.findPlayer(player.name);
            }));
          }
        }
      }

      // if no players are selected, be smart about automatically selecting one
      else {
        if (this.inEvent) {
          // select your own player if the event is upcoming or finished
          if (this.status === EventStatus.UPCOMING ||
              this.status === EventStatus.FINISHED) {
            this.setSelectedPlayers([this.findPlayer(this.generals.name)]);
          }
        } else {
          // if you're not logged in, and the event is over, select the winner
          // of the event
          if (this.status === EventStatus.FINISHED && this.isBracket) {
            this.setSelectedPlayers([this.findPlayer(this.event.winners[0])]);
          }
        }
      }
    }
  }

  findPlayer(name: string): ILeaderboardPlayer|undefined {
    return this.players?.length ?
        this.players.find(player => player.name === name) :
        undefined;
  }

  selectPlayers(players: string|string[] = []) {
    if (typeof players === 'string') {
      // just a single player to select
      const selectedPlayer = this.findPlayer(players);

      if (selectedPlayer === undefined) {
        this.utilService.showToast(`${players} hasn't joined this event!`);
        this.setSelectedPlayers([{name: players}]);
      } else {
        this.setSelectedPlayers([selectedPlayer]);
      }
    } else {
      // this is an array of players, select all of those players
      this.setSelectedPlayers(players.map(name => {
        return this.findPlayer(name);
      }));
    }
  }

  determineDisqualified() {
    if (this.generals.name) {
      const me = this.findPlayer(this.generals.name);
      const disqualified = me?.dq || false;

      // leave the queue
      if (disqualified || this.blocked) {
        this.eventService.leaveQueue(this.eventId, me.name);
      }

      this.disqualified = disqualified;
      localStorage.setItem('generals-dq', String(this.disqualified));
    }
  }

  selectChild(events: IEvent[] = []) {
    // only select a child if the current event is the multi stage event as this
    // means we haven't selected a child event yet
    if (this.event.format === EventFormat.MULTI_STAGE_EVENT) {
      const firstUnfinished = events.find(event => {
        return !event.endTime || event.endTime > Date.now();
      });

      this.setEvent(firstUnfinished ?? events[0]);
    }

    // if a child is already selected, update the event whenever it changes
    const selected = events.find(event => event.id === this.event?.id);
    if (selected) this.setEvent(selected);
  }

  goHome() {
    this.router.navigate(['/']);
  }

  async cloneEvent() {
    const name = await this.utilService.promptForText(
        'Event Name',
        'Enter a new name for the cloned event',
        'New Name',
        'Clone',
        'Cancel',
    );

    if (name) {
      let cloned = cloneDeep(this.event) as IEvent;
      cloned.name = name;
      cloned.visibility = Visibility.PRIVATE;

      // handle deleting special cases
      if (cloned.format === EventFormat.DOUBLE_ELIM) {
        cloned = cloned as IDoubleElimEvent;
        cloned.checkedInPlayers = [];
        delete cloned.bracket;
        delete cloned.endTime;
      } else {
        cloned = cloned as IArenaEvent;
        cloned.ongoingGameCount = 0;
        cloned.completedGameCount = 0;
      }

      // add all of the players to this event
      const eventId = await this.eventService.createEvent(cloned);
      for (const player of this.players) {
        this.eventService.addPlayer(eventId, player.name);
      }

      // nav there
      this.router.navigate(['/', eventId]);
    }
  }

  async deleteEvent() {
    const confirm = await this.utilService.confirm(
        'Delete Event',
        `Are you sure you want to delete ${
            this.event.name}? This cannot be undone.`,
        'Delete',
        'Cancel',
    );
    if (confirm) {
      this.eventService.deleteEvent(this.event.id);
      this.goHome();
    }
  }

  copyStandings() {
    let standings = '';
    const daysSupporterMap = new Map<number, string[]>();

    this.players.forEach(player => {
      if (player.stats?.totalGames > 0) {
        const wins = player.stats?.totalWins ?? 0;
        const days = wins + 7;
        standings += `${player.name} (1 week + ${wins} ${wins === 1 ? 'win' : 'wins'}) = ${days} days of supporter\n`;
        
        // group the players by 
        const entry = daysSupporterMap.get(days) ?? [];
        entry.push(player.name);
        daysSupporterMap.set(days, entry);
      }
    });

    // lastly add in the command to the standings
    console.log(daysSupporterMap);
    let command = 'node scripts/reward_player.js';
    daysSupporterMap.forEach((players, days) => {
      const playerString = players.map(p => `"${p}"`).join(' ');
      command += ` -d ${days} ${playerString}`;
    });
    standings += `\n\n${command}`;

    this.utilService.copyToClipboard(standings, 'Copied standings to clipboard');
  }

  promoteEvent() {
    // do everything within the context of New York because the timer URL expects it
    const timeToUse = this.getTimerTimeToUse();
    const timeInNewYork = moment(timeToUse).tz('America/New_York');
    const timerDateTime = timeInNewYork.format('YYYY-MM-DDThh:mm:ss');
    const eventType = this.event.type === EventType.MULTI_STAGE_EVENT ? 'Custom' : this.event.type;
    const timerIframeUrl = `https://free.timeanddate.com/countdown/i6aq85za/n43/cf12/cm0/cu4/ct0/cs0/caceee/cr0/ss0/caceee/cpceee/pct/tcfff/fs130/tat${eventType}%20Event/taceee/tpt${eventType}%20Event/tpceee/matbegins/maceee/mptbegan/mpceee/iso${timerDateTime}`;

    const eventInfo = {
      eventId: this.event.id,
      date: timeInNewYork.format('MM/DD/YYYY'),
      time: timeInNewYork.format('hh:mm a'),
      timezone: timeInNewYork.format('z'),
      timerIframeUrl,
    };

    this.eventService.promoteEvent(eventInfo);
    this.utilService.showToast('Promoted this event, it shoud show in queue now');
  }

  private getTimerTimeToUse() {
    const {checkInTime = null, startTime = null} = (this.event || {}) as IDoubleElimEvent;
    return checkInTime ?? startTime;
  }

  private setSelectedPlayers(players: Partial<ILeaderboardPlayer>[] = []) {
    this.selectedPlayers = players.filter(p => !!p);
  }

  // async fixIt() {
  //   const db = firebase.default.firestore();
  //   const matchRef = db.collection('events').doc(this.eventId).collection('matches');
  //   const snap = await matchRef.get();
  //   const docMap = new Map<string, any>();

  //   snap.docs.forEach(doc => {
  //     docMap.set(doc.id, doc.data());
  //     doc.ref.update({timesChecked: 2000});
  //   });
  //   console.log('stored all data');

  //   setTimeout(() => {
  //     console.log('5 secs');
  //     console.log(docMap.entries());
  //     for (const [key, value] of docMap.entries()) {
  //       matchRef.doc(key).set(value);
  //     }
  //   }, 15000);
  // }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
