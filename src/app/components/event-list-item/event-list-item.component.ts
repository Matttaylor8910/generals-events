import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, IEvent, Visibility} from 'types';

@Component({
  selector: 'app-event-list-item',
  templateUrl: './event-list-item.component.html',
  styleUrls: ['./event-list-item.component.scss'],
})
export class EventListItemComponent {
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

  get finished(): boolean {
    return this.event?.endTime < Date.now();
  }

  get private(): boolean {
    return this.event.visibility === Visibility.PRIVATE;
  }

  navToEvent() {
    this.router.navigate(['/', this.event.id]);
  }
}
