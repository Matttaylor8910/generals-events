import {Component, Input, OnInit} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {cloneDeep} from 'lodash';
import {EventService} from 'src/app/services/event.service';
import {IBracketMatch, IDoubleElimEvent, IEvent, MatchStatus} from 'types';

@Component({
  selector: 'app-update-match',
  templateUrl: './update-match.page.html',
  styleUrls: ['./update-match.page.scss'],
})
export class UpdateMatchPage implements OnInit {
  @Input() match: IBracketMatch;
  @Input() event: IDoubleElimEvent;
  @Input() bracketName: string;
  @Input() roundIdx: number;
  @Input() matchIdx: number;

  scores = [0, 1, 2, 3, 4];
  newMatch: IBracketMatch;

  constructor(
      private readonly eventService: EventService,
      private readonly modalController: ModalController,
  ) {}

  ngOnInit() {
    this.newMatch = cloneDeep(this.match);
  }

  get canSave(): boolean {
    return this.match?.teams.every(t => !!t.name);
  }

  save() {
    // retrieve scores
    const team1Score = Number(this.newMatch.teams[0]?.score || 0);
    const team2Score = Number(this.newMatch.teams[1]?.score || 0);

    // update this match in the bracket to ready so it can advance
    const bracket = this.event.bracket[this.bracketName];
    bracket[this.roundIdx].matches[this.matchIdx].status = MatchStatus.READY;

    // save and dismiss
    this.eventService.updateEvent(this.event.id, {
      [`bracket.results.${this.match.number}`]: {team1Score, team2Score},
      [`bracket.${this.bracketName}`]: bracket,
    });
    this.modalController.dismiss();
  }
}
