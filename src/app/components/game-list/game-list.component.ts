import {Component, EventEmitter, Input, Output} from '@angular/core';
import {Observable} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {IArenaEvent, IGame} from 'types';

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
})
export class GameListComponent {
  @Input() event: IArenaEvent;

  @Output() nameClicked = new EventEmitter<string>();

  eventId: string;
  games$: Observable<IGame[]>;

  constructor(
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.eventId !== this.event?.id) {
      this.eventId = this.event?.id;
      this.games$ = this.eventService.getGames(this.eventId, 15);
    }
  }

  trackByFn(game: IGame) {
    return game.id;
  }
}
