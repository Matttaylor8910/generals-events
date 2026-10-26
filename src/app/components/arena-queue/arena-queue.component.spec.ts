import {Component, Input} from '@angular/core';
import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {Subject} from 'rxjs';

import {ArenaQueueComponent} from './arena-queue.component';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {TeamArenaService} from 'src/app/services/team-arena.service';
import {UtilService} from 'src/app/services/util.service';
import {
  DoublesPairingStrategy, EventFormat, EventStatus, EventType,
} from 'types';

// DOM coverage for the team-arena readiness flow. Requires the Angular
// test toolchain (npm install); the offline Node suite exercises the same
// class logic without TestBed.

// lightweight stand-in for the countdown timer element the template
// renders while the event is upcoming
@Component({selector: 'app-timer', template: ''})
class TimerStubComponent {
  @Input() stopAt: number;
}

function teamArenaEvent(overrides: any = {}) {
  return {
    id: 'evt-q',
    name: 'Arena',
    type: EventType.BIG_TEAM,
    format: EventFormat.ARENA,
    doublesPairingStrategy: DoublesPairingStrategy.BRING_YOUR_PARTNER,
    teamSize: 2,
    playersPerGame: 4,
    arenaTeams: [],
    arenaReady: {alice: Date.now()},
    arenaPlaying: [],
    arenaParticipants: [],
    arenaQueueAt: {alice: Date.now()},
    ...overrides,
  };
}

describe('ArenaQueueComponent (team arena)', () => {
  let component: ArenaQueueComponent;
  let fixture: ComponentFixture<ArenaQueueComponent>;
  let generals: any;
  let teamArena: any;
  let eventService: any;

  const queueButton = () =>
      fixture.nativeElement.querySelector('ion-button');

  beforeEach(async(() => {
    generals = {
      name: 'alice',
      nameChanged$: new Subject<void>(),
      loginFromEvent: jasmine.createSpy('loginFromEvent'),
      joinLobby: jasmine.createSpy('joinLobby'),
    };
    teamArena = {
      setReady: jasmine.createSpy('setReady').and.returnValue(
          Promise.resolve()),
    };
    eventService = {
      addPlayer: jasmine.createSpy('addPlayer').and.returnValue(
          Promise.resolve()),
      joinQueue: jasmine.createSpy('joinQueue'),
      leaveQueue: jasmine.createSpy('leaveQueue'),
      getRedirect: jasmine.createSpy('getRedirect').and.returnValue(
          new Subject<any>()),
      clearRedirect: jasmine.createSpy('clearRedirect').and.returnValue(
          Promise.resolve()),
    };

    TestBed.configureTestingModule({
      imports: [FormsModule, IonicModule.forRoot()],
      declarations: [ArenaQueueComponent, TimerStubComponent],
      providers: [
        {provide: GeneralsService, useValue: generals},
        {provide: EventService, useValue: eventService},
        {provide: TeamArenaService, useValue: teamArena},
        {provide: UtilService, useValue: {showToast: () => {}}},
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ArenaQueueComponent);
    component = fixture.componentInstance;
    component.event = teamArenaEvent() as any;
    component.inEvent = true;
    component.status = EventStatus.ONGOING;
    fixture.detectChanges();
  });

  it('labels the button Ready/Unready for team arenas', () => {
    expect(queueButton().textContent).toContain('Unready');
    component.event = teamArenaEvent({arenaReady: {}}) as any;
    fixture.detectChanges();
    expect(queueButton().textContent).toContain('Ready');
    expect(queueButton().textContent).not.toContain('Join Queue');
  });

  it('toggles personal readiness instead of the legacy queue', async () => {
    component.event = teamArenaEvent({arenaReady: {}}) as any;
    fixture.detectChanges();
    queueButton().dispatchEvent(new Event('click'));
    await fixture.whenStable();
    expect(teamArena.setReady).toHaveBeenCalledWith('evt-q', true);
    expect(eventService.joinQueue).not.toHaveBeenCalled();
  });

  it('is disabled while the caller is in a game', () => {
    component.event = teamArenaEvent({arenaPlaying: ['alice']}) as any;
    fixture.detectChanges();
    expect(queueButton().disabled).toBeTrue();
    expect(component.queueLabel).toBe('Game in progress');
  });
});
