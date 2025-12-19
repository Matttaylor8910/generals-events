import {DatePipe} from '@angular/common';
import {Component, OnInit} from '@angular/core';
import {ModalController, NavParams} from '@ionic/angular';
import {extend} from 'lodash';
import {takeUntil} from 'rxjs/operators';
import {Subject} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {DoublesPairingStrategy, EventFormat, EventType, GameSpeed, IDoubleElimEvent, IArenaEvent, IEvent, Visibility} from 'types';

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
export class CreateEventPage implements OnInit {
  private destroyed$ = new Subject<void>();
  eventId: string;
  event: IEvent;
  isEditMode = false;

  EventFormat = EventFormat;
  Visibility = Visibility;

  visibilities = Object.values(Visibility);
  visibility: Visibility;

  types = Object.values(EventType);
  type: EventType;

  formats: EventFormat[];
  format: EventFormat;

  pairingStrategies = Object.values(DoublesPairingStrategy);
  pairingStrategy: DoublesPairingStrategy;

  date: string;
  time: string;

  speeds = Object.values(GameSpeed);
  speed: GameSpeed;
  mapURL = '';
  width = .75;
  height = .75;
  cities = .5;
  mountains = .5;
  city_fairness = 0.0;
  spawn_fairness = 0.0;
  swamps = 0.0;
  deserts = 0.0;
  observatories = 0.0;
  lookouts = 0.0;
  modifiers = null;

  name: string;
  duration: number;
  parentId: string;

  checkInOptions = Object.values(CheckInTimes);
  checkIn: CheckInTimes;

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
      private readonly navParams: NavParams,
  ) {}

  ngOnInit() {
    this.eventId = this.navParams.get('eventId');
    if (this.eventId) {
      this.isEditMode = true;
      this.eventService.getEvent(this.eventId)
          .pipe(takeUntil(this.destroyed$))
          .subscribe(event => {
            this.event = event;
            this.loadEventData();
          });
    } else {
      // Initialize defaults for create mode
      this.visibility = this.visibilities[0];
      this.type = this.types[0];
      this.formats = typeFormats[this.type];
      this.format = this.formats[0];
      this.pairingStrategy = this.pairingStrategies[0];
      this.date = new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd');
      this.time = '12:00:00';
      this.speed = GameSpeed.SPEED_1X;
      this.checkIn = this.checkInOptions[0];
    }
  }

  loadEventData() {
    if (!this.event) return;

    // Basic fields
    this.name = this.event.name;
    this.type = this.event.type;
    this.format = this.event.format;
    this.visibility = this.event.visibility;
    this.parentId = this.event.parentId;

    // Date and time
    const startDate = new Date(this.event.startTime);
    this.date = new DatePipe('en-US').transform(startDate, 'yyyy-MM-dd');
    this.time = new DatePipe('en-US').transform(startDate, 'HH:mm:ss');

    // Arena-specific fields
    if (this.format === EventFormat.ARENA) {
      const arenaEvent = this.event as IArenaEvent;
      if (arenaEvent.endTime && this.event.startTime) {
        const durationMs = arenaEvent.endTime - this.event.startTime;
        this.duration = Math.round(durationMs / (60 * 1000)); // Convert to minutes
      }
    }

    // Double elim or Dynamic DYP check-in time
    if (this.format === EventFormat.DOUBLE_ELIM || this.format === EventFormat.DYNAMIC_DYP) {
      const eventWithCheckIn = this.event as IDoubleElimEvent;
      if (eventWithCheckIn.checkInTime && this.event.startTime) {
        const checkInDiffMs = this.event.startTime - eventWithCheckIn.checkInTime;
        const checkInDiffMinutes = Math.round(checkInDiffMs / (60 * 1000));
        
        // Find the closest matching check-in option
        if (checkInDiffMinutes <= 15) {
          this.checkIn = CheckInTimes.CHECKIN_15;
        } else if (checkInDiffMinutes <= 30) {
          this.checkIn = CheckInTimes.CHECKIN_30;
        } else if (checkInDiffMinutes <= 45) {
          this.checkIn = CheckInTimes.CHECKIN_45;
        } else {
          this.checkIn = CheckInTimes.CHECKIN_60;
        }
      } else {
        this.checkIn = this.checkInOptions[0];
      }
    }

    // Double elim winning sets
    if (this.format === EventFormat.DOUBLE_ELIM) {
      const doubleElimEvent = this.event as IDoubleElimEvent;
      if (doubleElimEvent.winningSets) {
        // Reverse lookup from number to WinningSets enum
        const reverseWinningSets = Object.entries(winningSets).find(([_, value]) => value === doubleElimEvent.winningSets.winners);
        if (reverseWinningSets) {
          this.winningSets.winners = reverseWinningSets[0] as WinningSets;
        }
        
        const reverseLosers = Object.entries(winningSets).find(([_, value]) => value === doubleElimEvent.winningSets.losers);
        if (reverseLosers) {
          this.winningSets.losers = reverseLosers[0] as WinningSets;
        }
        
        const reverseSemis = Object.entries(winningSets).find(([_, value]) => value === doubleElimEvent.winningSets.semifinals);
        if (reverseSemis) {
          this.winningSets.semifinals = reverseSemis[0] as WinningSets;
        }
        
        const reverseFinals = Object.entries(winningSets).find(([_, value]) => value === doubleElimEvent.winningSets.finals);
        if (reverseFinals) {
          this.winningSets.finals = reverseFinals[0] as WinningSets;
        }
      }

      // Pairing strategy
      if (this.type === EventType.TWO_VS_TWO && doubleElimEvent.doublesPairingStrategy) {
        this.pairingStrategy = doubleElimEvent.doublesPairingStrategy;
      }
    }

    // Game options
    if (this.event.options) {
      const options = this.event.options;
      this.speed = options.speed || GameSpeed.SPEED_1X;
      this.mapURL = options.map ? `/maps/${options.map}` : '';
      this.width = options.width ?? .75;
      this.height = options.height ?? .75;
      this.cities = options.cities ?? .5;
      this.mountains = options.mountains ?? .5;
      this.city_fairness = options.city_fairness ?? 0.0;
      this.spawn_fairness = options.spawn_fairness ?? 0.0;
      this.swamps = options.swamps ?? 0.0;
      this.deserts = options.deserts ?? 0.0;
      this.observatories = options.observatories ?? 0.0;
      this.lookouts = options.lookouts ?? 0.0;
      this.modifiers = options.modifiers || null;
    }

    // Set formats based on type
    this.formats = typeFormats[this.type];
  }

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

    const eventData: Partial<IEvent> = {
      name: this.name || this.namePlaceholder,
      format: this.format,
      type: this.type,
      visibility: this.visibility,
      startTime: this.getDate().getTime(),

      // custom options for the lobby
      options: {
        width: this.width,
        height: this.height,
        cities: this.cities,
        mountains: this.mountains,
        city_fairness: this.city_fairness,
        spawn_fairness: this.spawn_fairness,
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
      eventData.parentId = this.parentId;
    } else {
      // Remove parentId if visibility changed away from multi-stage
      eventData.parentId = null;
    }

    if (this.format === EventFormat.ARENA) {
      extend(eventData, this.getArenaEventFields(eventData.startTime));
    } else if (this.format === EventFormat.DOUBLE_ELIM) {
      extend(eventData, this.getDoubleElimEventFields(eventData.startTime));
    } else if (this.format === EventFormat.DYNAMIC_DYP) {
      extend(eventData, {checkInTime: this.getCheckInTime(eventData.startTime)});
    }

    if (this.isEditMode && this.eventId) {
      await this.eventService.updateEvent(this.eventId, eventData);
    } else {
      eventData.checkedInPlayers = [];
      await this.eventService.createEvent(eventData);
    }
    
    this.modalController.dismiss();
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }

  private getArenaEventFields(startTime: number) {
    // determine the endDate from the event duration
    const duration = Number(this.duration);
    const endDate = new Date(startTime + (duration * 60 * 1000));

    const fields: any = {
      endTime: endDate.getTime(),
      playersPerGame: arenaEventTypes[this.type].playersPerGame,
    };

    // Only set queue for new events
    if (!this.isEditMode) {
      fields.queue = [];
    }

    return fields;
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
