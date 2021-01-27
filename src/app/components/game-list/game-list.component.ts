import {Component, EventEmitter, Input, Output} from '@angular/core';
import {Observable} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {IEvent, IGame} from 'types';

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
})
export class GameListComponent {
  @Input() event: IEvent;

  @Output() nameClicked = new EventEmitter<string>();

  games$: Observable<IGame[]>;

  constructor(
      private readonly eventService: EventService,
  ) {}

  ngOnInit() {
    this.games$ = this.eventService.getGames(this.event.id, 15);
  }
}
