import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, IEvent, Visibility} from 'types';

@Component({
  selector: 'app-event-overview',
  templateUrl: './event-overview.component.html',
  styleUrls: ['./event-overview.component.scss'],
})
export class EventOverviewComponent {
  @Input() event: IEvent;

  constructor(
      private readonly router: Router,
      private readonly utilService: UtilService,
  ) {}

  get duration(): string {
    if (this.event.format === EventFormat.DOUBLE_ELIM) {
      return '';
    }

    return this.utilService.getDurationString(
        this.event?.startTime, this.event?.endTime);
  }

  get private(): boolean {
    return this.event.visibility === Visibility.PRIVATE;
  }

  navToEvent() {
    this.router.navigate(['/', this.event.id]);
  }
}
