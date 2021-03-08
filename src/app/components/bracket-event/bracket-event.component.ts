import {Component, Input} from '@angular/core';
import {EventStatus, IArenaEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-bracket-event',
  templateUrl: './bracket-event.component.html',
  styleUrls: ['./bracket-event.component.scss'],
})
export class BracketEventComponent {
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayer?: ILeaderboardPlayer;
  @Input() disqualified: boolean;

  constructor() {}

  get showRegistration(): boolean {
    // TODO, show the registration component up until the bracket has been
    // completed, the start time isn't a hard start by any means
    // we should show some sort of messaging to players though that they are
    // waiting for the event organizers to start the tournament
    const bracketCreated = false;
    return this.status === EventStatus.UPCOMING || !bracketCreated;
  }
}
