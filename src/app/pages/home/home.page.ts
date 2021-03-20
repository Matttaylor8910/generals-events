import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {Observable} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {IEvent} from 'types';

import {ADMINS} from '../../../../constants';

import {CreateEventPage} from './create-event/create-event.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  unfinishedEvents$: Observable<IEvent[]>;
  finishedEvents$: Observable<IEvent[]>;

  constructor(
      private readonly eventService: EventService,
      private readonly modalController: ModalController,
      private readonly generals: GeneralsService,
  ) {
    this.unfinishedEvents$ = this.eventService.getEvents(false);
    this.finishedEvents$ = this.eventService.getEvents(true);
  }

  get canCreateEvent() {
    return ADMINS.includes(this.generals.name);
  }

  async createEvent() {
    const modal = await this.modalController.create({
      component: CreateEventPage,
    });
    return await modal.present();
  }
}
