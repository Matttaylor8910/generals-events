import {DatePipe} from '@angular/common';
import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {EventService} from 'src/app/services/event.service';
import {EventType, Visibility} from 'types';

const eventTypes = {
  [EventType.FFA]: {
    playersPerGame: 8,
  },
  [EventType.ONE_VS_ONE]: {
    playersPerGame: 2,
  },
}

const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
  'Dec'
];

@Component({
  selector: 'app-create-event',
  templateUrl: './create-event.page.html',
  styleUrls: ['./create-event.page.scss'],
})
export class CreateEventPage {
  visibilities = Object.values(Visibility);
  visibility = this.visibilities[0];

  types = Object.values(EventType);
  type = this.types[0];

  date = new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd');
  time = '12:00:00';

  duration: number;
  name: string;

  saving = false;

  constructor(
      private readonly eventService: EventService,
      private readonly modalController: ModalController,
  ) {}

  get namePlaceholder(): string {
    const date = new Date(this.date);
    const year = date.getFullYear();
    const month = months[date.getMonth()];
    return `${this.type}-${month}-${year}`;
  }

  get invalidDate(): boolean {
    const date = this.getDate();
    return date.getTime() !== date.getTime();
  }

  get invalid(): boolean {
    return this.invalidDate || !this.duration || this.saving;
  }

  getDate(): Date {
    return new Date(`${this.date}T${this.time}`);
  }

  async create() {
    this.saving = true;

    // determine the endDate from the event duration
    const duration = Number(this.duration);
    const startTime = this.getDate().getTime();
    const endDate = new Date(startTime + (duration * 60 * 1000));

    await this.eventService.createEvent({
      name: this.name || this.namePlaceholder,
      type: this.type,
      visibility: this.visibility,
      startTime: startTime,
      endTime: endDate.getTime(),
      playersPerGame: eventTypes[this.type].playersPerGame,
    });
    this.modalController.dismiss();
  }
}
