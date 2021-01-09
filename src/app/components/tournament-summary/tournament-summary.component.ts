import {Component, Input, OnInit} from '@angular/core';
import {UtilService} from 'src/app/services/util.service';
import {ITournament} from 'types';

@Component({
  selector: 'app-tournament-summary',
  templateUrl: './tournament-summary.component.html',
  styleUrls: ['./tournament-summary.component.scss'],
})
export class TournamentSummaryComponent implements OnInit {
  @Input() tournament: ITournament;

  constructor(
      private readonly utilService: UtilService,
  ) {}

  ngOnInit() {}

  get duration(): string {
    return this.utilService.getDurationString(this.tournament?.durationMinutes);
  }
}
