import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {Observable} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {IArenaEvent} from 'types';

import {ADMINS} from '../../../../constants';

import {CreateEventPage} from './create-event/create-event.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  unfinishedEvents$: Observable<IArenaEvent[]>;
  finishedEvents$: Observable<IArenaEvent[]>;

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
      cssClass: 'my-custom-class',
      componentProps: {
        'firstName': 'Douglas',
        'lastName': 'Adams',
        'middleInitial': 'N',
      },
    });
    return await modal.present();
  }
}
