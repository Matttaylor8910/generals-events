import {DatePipe} from '@angular/common';
import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {extend} from 'lodash';
import {EventService} from 'src/app/services/event.service';
import {DoublesPairingStrategy, EventFormat, EventType, GameSpeed, IDoubleElimEvent, IEvent, Visibility} from 'types';

const arenaEventTypes = {
  [EventType.FFA]: {
    playersPerGame: 8,
  },
  [EventType.ONE_VS_ONE]: {
    playersPerGame: 2,
  },
};

const typeFormats = {
  [EventType.FFA]: [EventFormat.ARENA],
  [EventType.ONE_VS_ONE]: [EventFormat.ARENA, EventFormat.DOUBLE_ELIM],
  [EventType.TWO_VS_TWO]: [EventFormat.DOUBLE_ELIM, EventFormat.DYNAMIC_DYP],
  [EventType.MULTI_STAGE_EVENT]: [EventFormat.MULTI_STAGE_EVENT],
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
  Visibility = Visibility;

  visibilities = Object.values(Visibility);
  visibility = this.visibilities[0];

  types = Object.values(EventType);
  type = this.types[0];

  formats = typeFormats[this.type];
  format = this.formats[0];

  pairingStrategies = Object.values(DoublesPairingStrategy);
  pairingStrategy = this.pairingStrategies[0];

  date = new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd');
  time = '12:00:00';

  speeds = Object.values(GameSpeed);
  speed = GameSpeed.SPEED_1X;
  mapURL = '';
  width = .75;
  height = .75;
  cities = .5;
  mountains = .5;
  city_fairness = 0.0;
  swamps = 0.0;
  deserts = 0.0;
  observatories = 0.0;
  lookouts = 0.0;
  modifiers = null;

  name: string;
  duration: number;
  parentId: string;

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

  get parentValid(): boolean {
    return this.visibility !== Visibility.MULTI_STAGE_EVENT || !!this.parentId;
  }

  get invalid(): boolean {
    return this.invalidDate || !this.arenaValid || !this.parentValid ||
        this.saving;
  }

  /**
   * When we do a team double elimination bracket, we need to determine how to
   * pair teams, so show that control
   */
  get showPairingStrategies(): boolean {
    return this.format === EventFormat.DOUBLE_ELIM &&
        this.type === EventType.TWO_VS_TWO;
  }

  getDate(): Date {
    return new Date(`${this.date}T${this.time}`);
  }

  typeChanged($event: {target: {value: string}}) {
    const type = $event.target.value as EventType;
    this.formats = typeFormats[type];

    // if the current selected format is not compatible with the newly selected
    // type, switch to the first supported format for this event type
    if (!this.formats.includes(this.format)) {
      this.format = this.formats[0];
    }
  }

  async create() {
    this.saving = true;

    const [base, map = ''] = this.mapURL?.split('/maps/');
    const defeat_spectate = this.type === EventType.ONE_VS_ONE;

    const event: Partial<IEvent> = {
      name: this.name || this.namePlaceholder,
      format: this.format,
      type: this.type,
      visibility: this.visibility,
      startTime: this.getDate().getTime(),
      checkedInPlayers: [],

      // custom options for the lobby
      options: {
        width: this.width,
        height: this.height,
        cities: this.cities,
        mountains: this.mountains,
        city_fairness: this.city_fairness,
        swamps: this.swamps,
        deserts: this.deserts,
        observatories: this.observatories,
        lookouts: this.lookouts,
        modifiers: this.modifiers,
        speed: this.speed,
        defeat_spectate,
        map,
      }
    };

    // attach parentId for events that provide it
    if (this.visibility === Visibility.MULTI_STAGE_EVENT) {
      event.parentId = this.parentId;
    }

    if (this.format === EventFormat.ARENA) {
      extend(event, this.getArenaEventFields(event.startTime));
    } else if (this.format === EventFormat.DOUBLE_ELIM) {
      extend(event, this.getDoubleElimEventFields(event.startTime));
    } else if (this.format === EventFormat.DYNAMIC_DYP) {
      extend(event, {checkInTime: this.getCheckInTime(event.startTime)});
    }

    await this.eventService.createEvent(event);
    this.modalController.dismiss();
  }

  private getArenaEventFields(startTime: number) {
    // determine the endDate from the event duration
    const duration = Number(this.duration);
    const endDate = new Date(startTime + (duration * 60 * 1000));

    return {
      endTime: endDate.getTime(),
      playersPerGame: arenaEventTypes[this.type].playersPerGame,
      queue: [],
    };
  }

  private getDoubleElimEventFields(startTime: number) {
    const eventFields: Partial<IDoubleElimEvent> = {
      checkInTime: this.getCheckInTime(startTime),
      winningSets: {
        winners: winningSets[this.winningSets.winners],
        losers: winningSets[this.winningSets.losers],
        semifinals: winningSets[this.winningSets.semifinals],
        finals: winningSets[this.winningSets.finals],
      },
    };

    // if this is a 2v2 double elim event, show the pairing strategies
    if (this.showPairingStrategies) {
      eventFields.doublesPairingStrategy = this.pairingStrategy;
    }

    return eventFields;
  }

  /**
   * Return a unix timestamp that is the number of minutes away specified
   */
  private getCheckInTime(startTime: number) {
    return startTime - checkInTimes[this.checkIn] * 60 * 1000;
  }
}
