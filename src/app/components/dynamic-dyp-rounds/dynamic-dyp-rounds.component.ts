import {Component, EventEmitter, Input, Output} from '@angular/core';
import {flatten} from 'lodash';
import {GeneralsService} from 'src/app/services/generals.service';
import {IDynamicDYPEvent, IDynamicDYPMatch, IDynamicDYPRound, MatchStatus} from 'types';

@Component({
  selector: 'app-dynamic-dyp-rounds',
  templateUrl: './dynamic-dyp-rounds.component.html',
  styleUrls: ['./dynamic-dyp-rounds.component.scss'],
})
export class DynamicDYPRoundsComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() rounds: IDynamicDYPRound[];

  @Output() playerClicked = new EventEmitter<string>();

  constructor(
      private readonly generals: GeneralsService,
  ) {}

  clickPlayer(name: string, $event: Event) {
    $event.stopPropagation();
    this.playerClicked.emit(name);
  }

  handleClickMatch(match: IDynamicDYPMatch) {
    if (match.status !== MatchStatus.COMPLETE) {
      const players = flatten(match.teams.map(team => team.players));
      const inMatch = players.includes(this.generals.name);

      this.generals.joinLobby(
          `match_${match.number}`, this.event.server, true, !inMatch);
    }
  }

  isMe(player: string): boolean {
    return this.generals.name === player;
  }

  showReady(match: IDynamicDYPMatch, player: string): boolean {
    return match.status === MatchStatus.NOT_STARTED &&
        match.ready.includes(player);
  }
}
