import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, IEvent, ILinkEvent, Visibility} from 'types';

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
      private readonly generals: GeneralsService,
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
    const {url} = this.event as ILinkEvent;
    if (url) {
      window.open(url, '_blank');
    } else {
      this.router.navigate(['/', this.event.id]);
    }
  }

  goToProfile(name: string, $event: Event) {
    $event.stopPropagation();
    this.generals.goToProfile(name, this.event?.server);
  }
}
