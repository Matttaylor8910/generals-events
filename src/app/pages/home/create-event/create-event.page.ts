import {DatePipe} from '@angular/common';
import {Component, OnDestroy, OnInit} from '@angular/core';
import {ModalController, NavParams} from '@ionic/angular';
import {extend} from 'lodash';
import {takeUntil} from 'rxjs/operators';
import {Subject} from 'rxjs';
import {EventService} from 'src/app/services/event.service';
import {MODIFIER_INDEXES, MODIFIERS, normalizeEventGameOptions, normalizeModifierIds, validateEventGameOptions} from 'game-options';
import {isTeamArena} from 'team-arena';
import {DoublesPairingStrategy, EventFormat, EventType, GameSpeed, IDoubleElimEvent, IArenaEvent, IEvent, IModifierOptions, Visibility} from 'types';

const arenaEventTypes = {
  [EventType.FFA]: {
    playersPerGame: 8,
  },
  [EventType.ONE_VS_ONE]: {
    playersPerGame: 2,
  },
};

// the only valid pairing modes for a team arena event
const arenaPairingStrategies = [
  DoublesPairingStrategy.BRING_YOUR_PARTNER,
  DoublesPairingStrategy.RANDOM_PARTNERS,
];

// bracketed doubles events only support bringing your own partner; the
// arena-only random mode must never leak into the bracket selector
const bracketPairingStrategies = [
  DoublesPairingStrategy.BRING_YOUR_PARTNER,
];

const teamSizeOptions = [2, 3, 4, 5, 6, 7, 8];

const typeFormats = {
  [EventType.FFA]: [EventFormat.ARENA],
  [EventType.ONE_VS_ONE]: [EventFormat.ARENA, EventFormat.DOUBLE_ELIM],
  [EventType.TWO_VS_TWO]: [EventFormat.DOUBLE_ELIM, EventFormat.DYNAMIC_DYP,
      EventFormat.ARENA],
  [EventType.BIG_TEAM]: [EventFormat.DOUBLE_ELIM, EventFormat.DYNAMIC_DYP,
      EventFormat.ARENA],
  [EventType.MULTI_STAGE_EVENT]: [EventFormat.MULTI_STAGE_EVENT],
};

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
};

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
};

const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
  'Dec'
];

@Component({
  selector: 'app-create-event',
  templateUrl: './create-event.page.html',
  styleUrls: ['./create-event.page.scss'],
})
export class CreateEventPage implements OnInit, OnDestroy {
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

  pairingStrategies = bracketPairingStrategies;
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
  cityFairness = 0.0;
  spawnFairness = 0.0;
  swamps = 0.0;
  deserts = 0.0;
  observatories = 0.0;
  lookouts = 0.0;
  tunnels = 0;
  tunnelMin = 20;
  tunnelMax = 60;
  strongholds = 0;
  strongholdMin = 10;
  strongholdMax = 25;
  // numeric modifier ids matching the generals.io registry (0-11)
  modifiers: number[]|string[]|null = null;
  eventModifiers = MODIFIERS;
  chessClockStarting = 10;
  chessClockIncrement = 5;
  chessClockDontLimit = false;

  name: string;
  duration: number;
  parentId: string;
  teamSize = 2;
  playersPerGame = 4;

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
      this.applyTeamDefaults();
    }
  }

  loadEventData() {
    if (!this.event) { return; }

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

    if (this.type === EventType.BIG_TEAM) {
      this.teamSize = this.event.teamSize || 2;
      this.playersPerGame = this.event.playersPerGame || this.teamSize * 2;
    } else if (this.type === EventType.TWO_VS_TWO) {
      this.teamSize = 2;
      this.playersPerGame = 4;
    }

    // team arenas always carry a pairing strategy; bracket events load
    // theirs through the double elim branch below
    if (isTeamArena(this.event)) {
      this.pairingStrategy = this.event.doublesPairingStrategy ||
          DoublesPairingStrategy.BRING_YOUR_PARTNER;
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

      if (this.type === EventType.BIG_TEAM && doubleElimEvent.doublesPairingStrategy) {
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
      this.cityFairness = options.city_fairness ?? 0.0;
      this.spawnFairness = options.spawn_fairness ?? 0.0;
      this.swamps = options.swamps ?? 0.0;
      this.deserts = options.deserts ?? 0.0;
      this.observatories = options.observatories ?? 0.0;
      this.lookouts = options.lookouts ?? 0.0;
      this.tunnels = options.tunnels ?? 0;
      this.tunnelMin = options.tunnel_min ?? 20;
      this.tunnelMax = options.tunnel_max ?? 60;
      this.strongholds = options.strongholds ?? 0;
      this.strongholdMin = options.stronghold_min ?? 10;
      this.strongholdMax = options.stronghold_max ?? 25;
      // stored modifiers may be in the legacy comma-string form; normalize to
      // numeric ids so the select can match them; a malformed stored value is
      // kept raw so the form shows it as invalid instead of crashing
      try {
        this.modifiers = options.modifiers != null ?
            normalizeModifierIds(options.modifiers) : null;
      } catch (e) {
        this.modifiers = options.modifiers as number[];
      }
      const clock = options.modifier_options?.ChessClock;
      this.chessClockStarting = clock?.StartingClock ?? 10;
      this.chessClockIncrement = clock?.ClockIncrement ?? 5;
      this.chessClockDontLimit = clock?.DontLimitMoveSpeed ?? false;
    }

    // Set formats based on type
    this.formats = typeFormats[this.type];
    this.applyTeamDefaults();
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

  // arena is valid if it has a finite positive duration or it's not the
  // format
  get arenaValid(): boolean {
    if (this.format !== EventFormat.ARENA) {
      return true;
    }
    const duration = Number(this.duration);
    return Number.isFinite(duration) && duration > 0;
  }

  get parentValid(): boolean {
    return this.visibility !== Visibility.MULTI_STAGE_EVENT || !!this.parentId;
  }

  get invalid(): boolean {
    return this.invalidDate || !this.arenaValid || !this.parentValid ||
        !this.teamConfigValid || !this.gameOptionsValid ||
        this.saving;
  }

  get chessClockSelected(): boolean {
    try {
      return normalizeModifierIds(this.modifiers)
          .includes(MODIFIER_INDEXES.ChessClock);
    } catch (e) {
      return false;
    }
  }

  // map generation bounds mirror the lobby's GameQueue validation: integer
  // limits in range, min <= max, densities between 0 and 1
  get mapGenerationValid(): boolean {
    const tunnelMin = Number(this.tunnelMin);
    const tunnelMax = Number(this.tunnelMax);
    const strongholdMin = Number(this.strongholdMin);
    const strongholdMax = Number(this.strongholdMax);
    if (!Number.isInteger(tunnelMin) || !Number.isInteger(tunnelMax) ||
        !Number.isInteger(strongholdMin) || !Number.isInteger(strongholdMax)) {
      return false;
    }
    if (tunnelMin < 5 || tunnelMin > 400 ||
        tunnelMax < 5 || tunnelMax > 500 || tunnelMin > tunnelMax) {
      return false;
    }
    if (strongholdMin < 5 || strongholdMin > 100 ||
        strongholdMax < 5 || strongholdMax > 100 ||
        strongholdMin > strongholdMax) {
      return false;
    }
    return [this.tunnels, this.strongholds].every(density =>
        Number.isFinite(Number(density)) && Number(density) >= 0 &&
        Number(density) <= 1);
  }

  // the modifier selection and its options must normalize cleanly; an
  // invalid combination disables saving and makes create() refuse
  get gameOptionsValid(): boolean {
    if (!this.mapGenerationValid) {
      return false;
    }
    return validateEventGameOptions(this.buildGameOptions()).valid;
  }

  // the game options to persist; existing unrelated configuration survives
  // an edit because the stored options are merged in first
  private buildGameOptions() {
    const options = {
      ...(this.event?.options || {}),
      width: this.width,
      height: this.height,
      cities: this.cities,
      mountains: this.mountains,
      city_fairness: this.cityFairness,
      spawn_fairness: this.spawnFairness,
      swamps: this.swamps,
      deserts: this.deserts,
      observatories: this.observatories,
      lookouts: this.lookouts,
      tunnels: Number(this.tunnels),
      tunnel_min: Number(this.tunnelMin),
      tunnel_max: Number(this.tunnelMax),
      strongholds: Number(this.strongholds),
      stronghold_min: Number(this.strongholdMin),
      stronghold_max: Number(this.strongholdMax),
      modifiers: this.modifiers,
      speed: this.speed,
      map: this.mapURL?.split('/maps/')[1] ?? '',
    };

    const modifierOptions: IModifierOptions =
        {...(this.event?.options?.modifier_options || {})};
    if (this.chessClockSelected) {
      modifierOptions.ChessClock = {
          StartingClock: Number(this.chessClockStarting),
          ClockIncrement: Number(this.chessClockIncrement),
        // pass the actual property so a malformed value fails validation
        // instead of being silently coerced to false
          DontLimitMoveSpeed: this.chessClockDontLimit,
      };
    } else {
      delete modifierOptions.ChessClock;
    }
    if (Object.keys(modifierOptions).length) {
      options.modifier_options = modifierOptions;
    } else {
      delete options.modifier_options;
    }

    return options;
  }

  get isTeamEvent(): boolean {
    return this.type === EventType.TWO_VS_TWO || this.type === EventType.BIG_TEAM;
  }

  // a team arena: 2v2 or Big Team played in the arena format; the roster
  // and dispatch rules live in functions/src/util/TeamArena.js
  get isTeamArena(): boolean {
    return this.format === EventFormat.ARENA && this.isTeamEvent;
  }

  // 2v2 team arenas always play two teams of two; the form shows a summary
  // instead of editable controls
  get fixedTwoVsTwo(): boolean {
    return this.isTeamArena && this.type === EventType.TWO_VS_TWO;
  }

  get showTeamSettings(): boolean {
    return this.type === EventType.BIG_TEAM &&
        this.format !== EventFormat.MULTI_STAGE_EVENT;
  }

  get showPlayersPerGame(): boolean {
    return this.showTeamSettings && this.format === EventFormat.DYNAMIC_DYP;
  }

  // team arena Big Team events pick a game size from the legal whole
  // multiples of the team size, so an invalid count is unrepresentable
  get showGameSizeSelect(): boolean {
    return this.isTeamArena && this.type === EventType.BIG_TEAM;
  }

  get teamSizeOptions(): number[] {
    return teamSizeOptions;
  }

  get gameSizeOptions(): number[] {
    const teamSize = Number(this.teamSize);
    // an invalid team size has no legal game sizes; the loop bound would
    // otherwise never be reached
    if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 8) {
      return [];
    }
    const options: number[] = [];
    for (let size = teamSize * 2; size <= 16; size += teamSize) {
      options.push(size);
    }
    return options;
  }

  // once any team, readiness entry, or game exists, the team configuration
  // is locked: changing it would invalidate live roster and lobby contracts
  get teamConfigLocked(): boolean {
    if (!this.isEditMode || !isTeamArena(this.event)) {
      return false;
    }
    const event = this.event as IArenaEvent;
    return !!(event.arenaTeams?.length ||
        Object.keys(event.arenaReady || {}).length ||
        event.arenaPlaying?.length ||
        event.completedGameCount || event.ongoingGameCount ||
        event.arenaMatchNumber);
  }

  get teamConfigValid(): boolean {
    // team arenas validate on every boundary, including 2v2 which has no
    // editable team controls
    if (this.isTeamArena) {
      const arenaTeamSize = this.type === EventType.TWO_VS_TWO
          ? 2
          : Number(this.teamSize);
      const arenaPlayersPerGame = this.type === EventType.TWO_VS_TWO
          ? 4
          : Number(this.playersPerGame);
      return arenaPairingStrategies.includes(this.pairingStrategy)
          && Number.isInteger(arenaTeamSize) && arenaTeamSize >= 2 && arenaTeamSize <= 8
          && Number.isInteger(arenaPlayersPerGame)
          && arenaPlayersPerGame >= 2 * arenaTeamSize && arenaPlayersPerGame <= 16
          && arenaPlayersPerGame % arenaTeamSize === 0;
    }

    if (!this.showTeamSettings) {
      return true;
    }

    // team size must be a finite integer between 2 and 8 (a lobby fits 16
    // players, i.e. two teams of 8)
    const teamSize = Number(this.teamSize);
    if (!Number.isFinite(teamSize) || !Number.isInteger(teamSize) ||
        teamSize < 2 || teamSize > 8) {
      return false;
    }

    // double elimination always resolves to exactly two teams per game
    if (this.format === EventFormat.DOUBLE_ELIM) {
      return true;
    }

    // players per game must be a whole number of teams, at least two, and
    // within the 16 player lobby cap
    const playersPerGame = Number(this.playersPerGame);
    return Number.isFinite(playersPerGame) &&
        Number.isInteger(playersPerGame) && playersPerGame <= 16 &&
        playersPerGame >= teamSize * 2 &&
        playersPerGame % teamSize === 0;
  }

  get teamCount(): number {
    const teamSize = Number(this.teamSize) || 1;
    const playersPerGame = this.resolvedPlayersPerGame;
    return Math.floor(playersPerGame / teamSize);
  }

  get resolvedPlayersPerGame(): number {
    const teamSize = Number(this.teamSize) || 2;
    if (this.format === EventFormat.DOUBLE_ELIM) {
      return teamSize * 2;
    }
    return Number(this.playersPerGame) || teamSize * 2;
  }

  /**
   * When we do a team double elimination bracket, we need to determine how to
   * pair teams, so show that control
   */
  get showPairingStrategies(): boolean {
    return this.format === EventFormat.DOUBLE_ELIM &&
        this.isTeamEvent;
  }

  /**
   * Team arenas offer the arena-specific pairing modes separately from the
   * bracket strategies
   */
  get showArenaPairing(): boolean {
    return this.isTeamArena;
  }

  get arenaPairingStrategies(): DoublesPairingStrategy[] {
    return arenaPairingStrategies;
  }

  getDate(): Date {
    return new Date(`${this.date}T${this.time}`);
  }

  typeChanged($event: {target: {value: string}}) {
    const type = $event.target.value as EventType;
    this.formats = typeFormats[type];
    this.type = type;

    // if the current selected format is not compatible with the newly selected
    // type, switch to the first supported format for this event type
    if (!this.formats.includes(this.format)) {
      this.format = this.formats[0];
    }

    // an arena-only pairing mode left over on a non-arena event normalizes
    // back to the bracket's bring-your-partner default
    if (!this.isTeamArena &&
        !bracketPairingStrategies.includes(this.pairingStrategy)) {
      this.pairingStrategy = DoublesPairingStrategy.BRING_YOUR_PARTNER;
    }

    this.applyTeamDefaults();
  }

  formatChanged() {
    // switching into a team arena needs an arena pairing strategy; bracket
    // strategies like DYP are invalid there. Switching back out of an arena
    // normalizes the arena-only random mode to the bracket's only option.
    if (this.isTeamArena &&
        !arenaPairingStrategies.includes(this.pairingStrategy)) {
      this.pairingStrategy = DoublesPairingStrategy.BRING_YOUR_PARTNER;
    } else if (!this.isTeamArena &&
        !bracketPairingStrategies.includes(this.pairingStrategy)) {
      this.pairingStrategy = DoublesPairingStrategy.BRING_YOUR_PARTNER;
    }
    this.applyTeamDefaults();
  }

  teamSizeChanged() {
    if (this.type === EventType.TWO_VS_TWO) {
      this.teamSize = 2;
      this.playersPerGame = 4;
      return;
    }

    const teamSize = Number(this.teamSize);
    const playersPerGame = Number(this.playersPerGame);
    const minimumPlayers = (teamSize || 2) * 2;
    if (this.format === EventFormat.DOUBLE_ELIM || !playersPerGame ||
        playersPerGame < minimumPlayers ||
        !this.gameSizeOptions.includes(playersPerGame)) {
      this.playersPerGame = minimumPlayers;
    } else if (teamSize && playersPerGame % teamSize !== 0) {
      this.playersPerGame =
          Math.ceil(playersPerGame / teamSize) * teamSize;
    }
  }

  async create() {
    // refuse to persist an invalid config even when called directly, not
    // just through the disabled save button
    if (this.invalid) {
      return;
    }

    this.saving = true;

    const defeatSpectate = this.type === EventType.ONE_VS_ONE;

    const eventData: Partial<IEvent> = {
      name: this.name || this.namePlaceholder,
      format: this.format,
      type: this.type,
      visibility: this.visibility,
      startTime: this.getDate().getTime(),

      // custom options for the lobby; the whole options object (modifiers
      // and nested modifier_options) is normalized before persistence
      options: {
        ...normalizeEventGameOptions(this.buildGameOptions()),
        defeat_spectate: defeatSpectate,
      }
    };

    if (this.isTeamEvent) {
      // persist numbers, not ion-input strings
      eventData.teamSize = Number(this.teamSize);
      eventData.playersPerGame = Number(this.resolvedPlayersPerGame);
    }

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
      extend(eventData, this.getDynamicDYPEventFields(eventData.startTime));
    }

    if (this.isEditMode && this.eventId) {
      await this.eventService.updateEvent(this.eventId, eventData);
    } else {
      // Only set checkedInPlayers for events that support it (not Arena events)
      if (this.format !== EventFormat.ARENA) {
        (eventData as any).checkedInPlayers = [];
      }
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
    };

    if (this.isTeamArena) {
      // the team configuration is locked once the event has live state;
      // an edit can never invalidate existing rosters or dispatched games
      if (this.teamConfigLocked) {
        fields.teamSize = this.event.teamSize;
        fields.playersPerGame = this.event.playersPerGame;
        fields.doublesPairingStrategy = this.event.doublesPairingStrategy;
      } else {
        fields.teamSize = this.type === EventType.TWO_VS_TWO ?
            2 : Number(this.teamSize);
        fields.playersPerGame = this.type === EventType.TWO_VS_TWO ?
            4 : Number(this.playersPerGame);
        fields.doublesPairingStrategy = this.pairingStrategy;
      }

      // initialize runtime state on creation only; editing must preserve
      // existing teams, readiness, and match counters
      if (!this.isEditMode) {
        fields.arenaTeams = [];
        fields.arenaReady = {};
        fields.arenaPlaying = [];
        fields.arenaParticipants = [];
        fields.arenaMatchNumber = 0;
        fields.ongoingGameCount = 0;
        fields.completedGameCount = 0;
      }
      return fields;
    }

    // legacy arena types look up a fixed game size; an unlisted type must
    // not silently produce undefined
    fields.playersPerGame = arenaEventTypes[this.type]?.playersPerGame;

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

    if (this.isTeamEvent) {
      eventFields.playersPerGame = Number(this.resolvedPlayersPerGame);
      eventFields.teamSize = Number(this.teamSize);
    }

    // if this is a 2v2 double elim event, show the pairing strategies
    if (this.showPairingStrategies) {
      eventFields.doublesPairingStrategy = this.pairingStrategy;
    }

    return eventFields;
  }

  private getDynamicDYPEventFields(startTime: number) {
    return {
      checkInTime: this.getCheckInTime(startTime),
      playersPerGame: Number(this.resolvedPlayersPerGame),
      teamSize: Number(this.teamSize),
    };
  }

  private applyTeamDefaults() {
    if (this.type === EventType.TWO_VS_TWO) {
      this.teamSize = 2;
      this.playersPerGame = 4;
      return;
    }

    if (this.type !== EventType.BIG_TEAM) {
      return;
    }

    this.teamSize = Number(this.teamSize) || 2;
    if (this.teamSize < 2) {
      this.teamSize = 2;
    }

    const minimumPlayers = this.teamSize * 2;
    if (this.format === EventFormat.DOUBLE_ELIM) {
      this.playersPerGame = minimumPlayers;
    } else if (!this.playersPerGame || this.playersPerGame < minimumPlayers) {
      this.playersPerGame = minimumPlayers;
    } else if (this.playersPerGame % this.teamSize !== 0) {
      this.playersPerGame =
          Math.ceil(this.playersPerGame / this.teamSize) * this.teamSize;
    }
  }

  /**
   * Return a unix timestamp that is the number of minutes away specified
   */
  private getCheckInTime(startTime: number) {
    return startTime - checkInTimes[this.checkIn] * 60 * 1000;
  }
}
