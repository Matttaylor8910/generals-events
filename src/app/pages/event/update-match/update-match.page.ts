import {Component, Input, OnInit} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {cloneDeep} from 'lodash';
import {EventService} from 'src/app/services/event.service';
import {EventFormat, IBracketMatch, IDoubleElimEvent, IDynamicDYPEvent, IEvent, MatchStatus, MatchTeamStatus} from 'types';

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

  async save() {
    // retrieve scores
    const team1Score = Number(this.newMatch.teams[0]?.score || 0);
    const team2Score = Number(this.newMatch.teams[1]?.score || 0);

    // update this match in the bracket to ready so it can advance
    // HACK: shoving this shit in to make dyp finals work
    // TODO: fix this
    if (this.event.format === EventFormat.DYNAMIC_DYP) {
      // HACK
      const event = this.event as unknown as IDynamicDYPEvent;
      const bracket = event.finals.bracket;
      const bracketLocation = 'finals.bracket';
      let winners = [];

      console.log('winning sets', bracket[this.roundIdx].winningSets);

      // match done
      if (team1Score == bracket[this.roundIdx].winningSets) {
        console.log('team 1!');
        this.newMatch.status = MatchStatus.COMPLETE;
        this.newMatch.teams[0].status = MatchTeamStatus.WINNER;
        this.newMatch.teams[1].status = MatchTeamStatus.ELIMINATED;
      }
      if (team2Score == bracket[this.roundIdx].winningSets) {
        console.log('team 2!');
        this.newMatch.status = MatchStatus.COMPLETE;
        this.newMatch.teams[1].status = MatchTeamStatus.WINNER;
        this.newMatch.teams[0].status = MatchTeamStatus.ELIMINATED;
      }

      if (this.newMatch.status === MatchStatus.COMPLETE) {
        // first done
        if (this.newMatch.number === 1) {
          // set status for game 2
          bracket[this.roundIdx].matches[this.matchIdx + 1].status =
              MatchStatus.READY;
          // set team for finals
          bracket[this.roundIdx + 1].matches[0].teams[0].name =
              team1Score > team2Score ? this.newMatch.teams[0].name :
                                        this.newMatch.teams[1].name;
          bracket[this.roundIdx + 1].matches[0].teams[0].placeholder = '';
        } else if (this.newMatch.number === 2) {
          // set finals status
          bracket[this.roundIdx + 1].matches[0].status = MatchStatus.READY;
          // set team for finals
          bracket[this.roundIdx + 1].matches[0].teams[1].name =
              team1Score > team2Score ? this.newMatch.teams[0].name :
                                        this.newMatch.teams[1].name;
          bracket[this.roundIdx + 1].matches[0].teams[1].placeholder = '';
        } else if (this.newMatch.number === 3) {
          // set winners
          winners = (team1Score > team2Score ? this.newMatch.teams[0].name :
                                               this.newMatch.teams[1].name)
                        .split(' and ');
        }
      }


      // save match
      bracket[this.roundIdx].matches[this.matchIdx] = this.newMatch;

      // save and dismiss
      if (winners.length) {
        this.eventService.updateEvent(this.event.id, {
          [`${bracketLocation}`]: bracket,
          winners: winners,
          endTime: Date.now(),
        });
      } else {
        this.eventService.updateEvent(this.event.id, {
          [`${bracketLocation}`]: bracket,
        });
      }
    } else {
      const bracket = this.event.bracket[this.bracketName];
      const match = bracket[this.roundIdx].matches[this.matchIdx] as IBracketMatch;
      match.status = MatchStatus.READY;
      match.teams[0].status = MatchTeamStatus.UNDECIDED;
      match.teams[1].status = MatchTeamStatus.UNDECIDED;
      bracket[this.roundIdx].complete = false;

      // save and dismiss
      this.eventService.updateEvent(this.event.id, {
        [`bracket.results.${this.match.number}`]: {team1Score, team2Score},
        [`bracket.${this.bracketName}`]: bracket,
      });
    }
    this.modalController.dismiss();
  }
}
