import {Component, OnDestroy} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {Observable, Subject} from 'rxjs';
import {takeUntil, tap} from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventStatus, IArenaEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-event',
  templateUrl: './event.page.html',
  styleUrls: ['./event.page.scss'],
})
export class EventPage implements OnDestroy {
  private destroyed$ = new Subject<void>();

  EventStatus = EventStatus;

  eventId: string;
  event: IArenaEvent;
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
    this.players$ =
        this.eventService.getPlayers(this.eventId).pipe(tap(players => {
          this.players = players;
          this.checkJoinQueue(players);
          this.determineSelectPlayer(true);
          this.determineDisqualified();
        }));

    this.eventService.getEvent(this.eventId)
        .pipe(takeUntil(this.destroyed$))
        .subscribe(event => {
          this.event = event;
          this.determineSelectPlayer();
        });
  }

  get status(): EventStatus {
    if (this.event) {
      const now = Date.now();
      const {startTime, endTime} = this.event;

      if (endTime < now) {
        return EventStatus.FINISHED;
      } else {
        if (startTime > now) {
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

  async checkJoinQueue(players: ILeaderboardPlayer[]) {
    // if this url has the url param "join=true" and the user has their
    // generals name set, join the queue
    if (location.href.includes('join=true')) {
      const {name} = this.generals;
      if (name && this.status !== EventStatus.FINISHED) {
        // join the event if you haven't already
        if (!players.some(p => p.name === name)) {
          await this.eventService.addPlayer(this.eventId, name);
        }

        // only add to queue if the event is ongoing
        if (this.status === EventStatus.ONGOING) {
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
      } else {
        // before the event starts, if there is no selected player show the
        // player summary for the logged in player
        if (this.status === EventStatus.UPCOMING && this.generals.name) {
          this.selectedPlayer = this.findPlayer(this.generals.name);
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

  goHome() {
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
