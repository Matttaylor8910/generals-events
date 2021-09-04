import {Component, EventEmitter, Input, Output} from '@angular/core';
import {flatten} from 'lodash';
import {GeneralsService} from 'src/app/services/generals.service';
import {IDynamicDYPEvent, IDynamicDYPMatch, IDynamicDYPRound, IGeneralsGameOptions, MatchStatus} from 'types';
import {HIDE_COMPLETED} from '../../../../constants';

@Component({
  selector: 'app-dynamic-dyp-rounds',
  templateUrl: './dynamic-dyp-rounds.component.html',
  styleUrls: ['./dynamic-dyp-rounds.component.scss'],
})
export class DynamicDYPRoundsComponent {
  @Input() event: IDynamicDYPEvent;
  @Input() rounds: IDynamicDYPRound[];
  @Input() finals: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  hideCompletedRounds: boolean;
  showToggle = false;

  constructor(
      private readonly generals: GeneralsService,
  ) {
    this.hideCompletedRounds = localStorage.getItem(HIDE_COMPLETED) !== 'false';
  }

  ngOnChanges() {
    this.showToggle = this.shouldShowToggle();
    if (this.hideCompletedRounds && this.finals) {
      this.toggleHideCompleted();
    }
  }

  get toggleText() {
    return `${this.hideCompletedRounds ? 'Show' : 'Hide'} Completed Rounds`;
  }

  clickPlayer(name: string, $event: Event) {
    $event.stopPropagation();
    this.playersClicked.emit(name);
  }

  handleClickMatch(match: IDynamicDYPMatch) {
    if (match.status !== MatchStatus.COMPLETE) {
      const lobby = match.lobby ?? match.number;
      const options: IGeneralsGameOptions = {};

      // set the team or spectator params if you're in this match
      const teamIndex = match.teams?.findIndex(
          team => team.players?.includes(this.generals.name));

      if (teamIndex >= 0) {
        options.team = teamIndex + 1;
      } else {
        options.spectate = true;
      }

      this.generals.joinLobby(`match_${lobby}`, this.event, true, options);
    }
  }

  isMe(player: string): boolean {
    return this.generals.name === player;
  }

  isAfk(player: string): boolean {
    return this.event?.afks?.includes(player);
  }

  showReady(match: IDynamicDYPMatch, player: string): boolean {
    return !this.isAfk(player) && match.status === MatchStatus.NOT_STARTED &&
        match.ready.includes(player);
  }

  showAfk(match: IDynamicDYPMatch, player: string): boolean {
    return this.isAfk(player) && match.status !== MatchStatus.COMPLETE;
  }

  shouldShowToggle(): boolean {
    if (this.finals) {
      return false;
    }
    if (this.rounds) {
      const roundsCompleted =
          this.rounds.filter(round => round.complete).length;

      return roundsCompleted > 0;
    }
    return false;
  }

  toggleHideCompleted() {
    this.hideCompletedRounds = !this.hideCompletedRounds;
    localStorage.setItem(HIDE_COMPLETED, String(this.hideCompletedRounds));
  }
}
