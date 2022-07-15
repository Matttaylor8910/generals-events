import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {Observable, Subject} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {EventType, IEvent} from 'types';

import {ADMINS} from '../../../../constants';

import {CreateEventPage} from './create-event/create-event.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  private destroyed$ = new Subject<void>();

  tabs = ['All', EventType.FFA, EventType.ONE_VS_ONE, EventType.TWO_VS_TWO, 'Custom'];
  selectedTab = this.tabs[0];

  allEvents: IEvent[];
  unfinished: IEvent[];
  finished: IEvent[];

  constructor(
      private readonly eventService: EventService,
      private readonly modalController: ModalController,
      private readonly generals: GeneralsService,
  ) {
    this.eventService.getEvents()
      .pipe(takeUntil(this.destroyed$))
      .subscribe(events => {
        this.allEvents = events;
        this.setEvents(this.selectedTab);
      });
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

  setEvents(tab: string) {
    this.selectedTab = tab;   

    const unfinished = [];
    const finished = [];
    const now = Date.now();

    for (const event of this.allEvents) {
      const showAll = this.selectedTab === 'All';
      const showThis = this.selectedTab === event.type;
      const showThisCustom = event.type === EventType.MULTI_STAGE_EVENT && this.selectedTab === 'Custom';
      
      // only work with the filtered events
      if (showAll || showThis || showThisCustom) {
        if (event.endTime < now) {
          finished.push(event);
        } else {
          unfinished.push(event);
        }
      }
    }

    // sort the lists
    this.unfinished = unfinished.sort((a, b) => a.startTime - b.startTime);
    this.finished = finished.sort((a, b) => b.endTime - a.endTime);
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
