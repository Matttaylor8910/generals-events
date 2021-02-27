import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {UtilService} from 'src/app/services/util.service';
import {IArenaEvent} from 'types';

@Component({
  selector: 'app-event-overview',
  templateUrl: './event-overview.component.html',
  styleUrls: ['./event-overview.component.scss'],
})
export class EventOverviewComponent {
  @Input() event: IArenaEvent;

  constructor(
      private readonly router: Router,
      private readonly utilService: UtilService,
  ) {}

  get duration(): string {
    return this.utilService.getDurationString(
        this.event?.startTime, this.event?.endTime);
  }

  navToEvent() {
    this.router.navigate(['/', this.event.id]);
  }
}
