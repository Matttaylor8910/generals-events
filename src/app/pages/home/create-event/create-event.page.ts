import {DatePipe} from '@angular/common';
import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {EventService} from 'src/app/services/event.service';
import {EventFormat, EventType, Visibility} from 'types';

const eventTypes = {
  [EventType.FFA]: {
    playersPerGame: 8,
  },
  [EventType.ONE_VS_ONE]: {
    playersPerGame: 2,
  },
};

const formatTypes = {
  [EventFormat.DOUBLE_ELIM]: [EventType.ONE_VS_ONE],
  [EventFormat.ARENA]: [EventType.FFA, EventType.ONE_VS_ONE],
}

enum WinningSets {
  Bo1 = 'Winner of one game',
  Bo3 = 'Best 2 of 3',
  Bo5 = 'Best 3 of 5',
  Bo7 = 'Best 4 of 7',
}

const winningSets = {
  [WinningSets.Bo1]: 1,
  [WinningSets.Bo3]: 2,
  [WinningSets.Bo5]: 3,
  [WinningSets.Bo7]: 4,
}

enum CheckInTimes {
  CHECKIN_15 = '15 minutes before start',
  CHECKIN_30 = '30 minutes before start',
  CHECKIN_45 = '45 minutes before start',
  CHECKIN_60 = 'One hour before start',
}

const checkInTimes = {
  [CheckInTimes.CHECKIN_15]: 15,
  [CheckInTimes.CHECKIN_30]: 30,
  [CheckInTimes.CHECKIN_45]: 45,
  [CheckInTimes.CHECKIN_60]: 60,
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
  EventFormat = EventFormat;

  visibilities = Object.values(Visibility);
  visibility = this.visibilities[0];

  formats = Object.values(EventFormat);
  format = this.formats[0];

  types = formatTypes[this.format];
  type = this.types[0];

  date = new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd');
  time = '12:00:00';

  name: string;
  duration: number;

  checkInOptions = Object.values(CheckInTimes);
  checkIn = this.checkInOptions[0];

  setsOptions = Object.values(WinningSets);
  winningSets = {
    winners: WinningSets.Bo3,
    losers: WinningSets.Bo3,
    semifinals: WinningSets.Bo5,
    finals: WinningSets.Bo7,
  };

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

  // arena is valid if it has a duration set or it's not the format
  get arenaValid(): boolean {
    return this.format !== EventFormat.ARENA || !!this.duration;
  }

  get invalid(): boolean {
    return this.invalidDate || !this.arenaValid || this.saving;
  }

  getDate(): Date {
    return new Date(`${this.date}T${this.time}`);
  }

  formatChanged($event: {target: {value: string}}) {
    const format = $event.target.value as EventFormat;
    this.types = formatTypes[format];

    // if the current selected type is not compatible with the newly selected
    // format, switch to the first supported event type for this format
    if (!this.types.includes(this.type)) {
      this.type = this.types[0];
    }
  }

  async create() {
    this.saving = true;

    if (this.format === EventFormat.ARENA) {
      this.createArenaEvent();
    } else if (this.format === EventFormat.DOUBLE_ELIM) {
      this.createDoubleElimEvent();
    }

    this.modalController.dismiss();
  }

  private async createArenaEvent() {
    // determine the endDate from the event duration
    const duration = Number(this.duration);
    const startTime = this.getDate().getTime();
    const endDate = new Date(startTime + (duration * 60 * 1000));

    await this.eventService.createEvent({
      name: this.name || this.namePlaceholder,
      format: this.format,
      type: this.type,
      visibility: this.visibility,
      startTime: startTime,
      endTime: endDate.getTime(),
      playersPerGame: eventTypes[this.type].playersPerGame,
      queue: [],
    });
  }

  private async createDoubleElimEvent() {
    const startTime = this.getDate().getTime();
    const checkInMinutes = checkInTimes[this.checkIn] * 60 * 1000;
    const checkInTime = startTime - checkInMinutes;

    await this.eventService.createEvent({
      name: this.name || this.namePlaceholder,
      format: this.format,
      type: this.type,
      visibility: this.visibility,
      startTime,
      checkInTime,
      winningSets: {
        winners: winningSets[this.winningSets.winners],
        losers: winningSets[this.winningSets.losers],
        semifinals: winningSets[this.winningSets.semifinals],
        finals: winningSets[this.winningSets.finals],
      },
    });
  }
}
