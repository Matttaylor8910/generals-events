import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {cloneDeep} from 'lodash';
import {Observable, Subject} from 'rxjs';
import {takeUntil, tap} from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, IArenaEvent, IDoubleElimEvent, IEvent, ILeaderboardPlayer, Visibility} from 'types';

import {ADMINS} from '../../../../constants';

@Component({
  selector: 'app-event',
  templateUrl: './event.page.html',
  styleUrls: ['./event.page.scss'],
})
export class EventPage implements OnDestroy {
  private destroyed$ = new Subject<void>();

  EventStatus = EventStatus;

  eventId: string;
  event: IEvent;
  parent: IEvent;

  children$: Observable<IEvent[]>;

  players: ILeaderboardPlayer[];
  players$: Observable<ILeaderboardPlayer[]>;
  selectedPlayer?: Partial<ILeaderboardPlayer>;

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
            this.children$ = this.eventService.getEvents(null, this.eventId)
                                 .pipe(tap(this.selectChild.bind(this)));
          }
        });
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
    return !!this.selectedPlayer || this.event?.endTime > 0;
  }

  get inEvent(): boolean {
    return this.players?.some(p => p.name === this.generals.name);
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
    // if this url has the url param "join=true" and the user has their
    // generals name set, join the queue
    if (location.href.includes('join=true')) {
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
          await this.eventService.addPlayer(this.eventId, name);
        }

        // only add to queue if the event is ongoing
        // and this event type is arena
        if (this.status === EventStatus.ONGOING && this.isArena) {
          this.eventService.joinQueue(this.eventId, name);
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
      if (this.selectedPlayer) {
        if (playersUpdated) {
          const updated = this.findPlayer(this.selectedPlayer.name);
          const previousGames = this.selectedPlayer.stats?.totalGames || 0;

          // if the selected player has played another game, update their stats
          if (previousGames < updated?.stats?.totalGames) {
            this.selectedPlayer = updated;
          }
        }
      }

      // if no player is selected, be smart about automatically selecting one
      else {
        if (this.inEvent) {
          // select your own player if the event is upcoming or finished
          if (this.status === EventStatus.UPCOMING ||
              this.status === EventStatus.FINISHED) {
            this.selectedPlayer = this.findPlayer(this.generals.name);
          }
        } else {
          // if you're not logged in, and the event is over, select the winner
          // of the event
          if (this.status === EventStatus.FINISHED && this.isBracket) {
            this.selectedPlayer = this.findPlayer(this.event.winners[0]);
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

  selectPlayer(player?: ILeaderboardPlayer|string) {
    if (typeof player === 'string') {
      this.selectedPlayer = this.findPlayer(player);
      if (this.selectedPlayer === undefined) {
        this.utilService.showToast(`${player} hasn't joined this event!`);
        this.selectedPlayer = {name: player};
      }
    } else {
      this.selectedPlayer = player;
    }
  }

  determineDisqualified() {
    if (this.generals.name) {
      const me = this.findPlayer(this.generals.name);
      const disqualified = me?.dq || false

      // leave the queue
      if (disqualified) {
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

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
