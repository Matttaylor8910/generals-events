import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {Subject} from 'rxjs';

import {ArenaTeamsComponent} from './arena-teams.component';
import {GeneralsService} from 'src/app/services/generals.service';
import {TeamArenaService} from 'src/app/services/team-arena.service';
import {UtilService} from 'src/app/services/util.service';
import {
  DoublesPairingStrategy, EventFormat, EventStatus, EventType,
} from 'types';

// DOM coverage for BYP team management. Requires the Angular test
// toolchain (npm install); the offline Node suite exercises the service
// behavior behind these controls.

function teamArenaEvent(overrides: any = {}) {
  return {
    id: 'evt-t',
    name: 'Arena',
    type: EventType.BIG_TEAM,
    format: EventFormat.ARENA,
    doublesPairingStrategy: DoublesPairingStrategy.BRING_YOUR_PARTNER,
    teamSize: 4,
    playersPerGame: 8,
    arenaTeams: [],
    arenaReady: {},
    arenaPlaying: [],
    arenaParticipants: [],
    ...overrides,
  };
}

function team(id: string, captain: string, members: string[],
              overrides: any = {}) {
  return {
    id, name: `${captain}'s Team`, captain, members,
    requests: [], noShows: [], acceptFill: false, allowShortHanded: false,
    points: 0, games: 0, wins: 0, participants: [], ...overrides,
  };
}

describe('ArenaTeamsComponent (team arena)', () => {
  let component: ArenaTeamsComponent;
  let fixture: ComponentFixture<ArenaTeamsComponent>;
  let generals: any;
  let teamArena: any;

  beforeEach(async(() => {
    generals = {name: 'alice', nameChanged$: new Subject<void>()};
    teamArena = {
      createTeam: jasmine.createSpy('createTeam')
          .and.returnValue(Promise.resolve()),
      requestTeam: jasmine.createSpy('requestTeam')
          .and.returnValue(Promise.resolve()),
      acceptPlayer: jasmine.createSpy('acceptPlayer')
          .and.returnValue(Promise.resolve()),
      setTeamOptions: jasmine.createSpy('setTeamOptions')
          .and.returnValue(Promise.resolve()),
      joinRandomTeam: jasmine.createSpy('joinRandomTeam')
          .and.returnValue(Promise.resolve()),
      markNoShow: jasmine.createSpy('markNoShow')
          .and.returnValue(Promise.resolve()),
      leaveTeam: jasmine.createSpy('leaveTeam')
          .and.returnValue(Promise.resolve()),
    };

    TestBed.configureTestingModule({
      imports: [FormsModule, IonicModule.forRoot()],
      declarations: [ArenaTeamsComponent],
      providers: [
        {provide: GeneralsService, useValue: generals},
        {provide: TeamArenaService, useValue: teamArena},
        {provide: UtilService, useValue: {showToast: () => {}}},
      ],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ArenaTeamsComponent);
    component = fixture.componentInstance;
    component.event = teamArenaEvent({
      arenaTeams: [team('t1', 'alice', ['alice', 'bob'])],
    }) as any;
    component.players = [{name: 'alice'} as any, {name: 'bob'} as any];
    component.status = EventStatus.ONGOING;
    fixture.detectChanges();
  });

  it('shows the roster with open slots', () => {
    expect(component.missingSlots(component.event.arenaTeams[0])).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('bob');
  });

  it('captain actions reach the service', async () => {
    expect(component.isCaptain).toBeTrue();
    expect(component.controlsDisabled).toBeFalse();
    await component.leaveTeam();
    expect(teamArena.leaveTeam).toHaveBeenCalledWith('evt-t');
  });

  it('disables all roster controls while the team is queued', () => {
    component.event = teamArenaEvent({
      arenaTeams: [team('t1', 'alice', ['alice', 'bob'])],
      arenaReady: {alice: Date.now(), bob: Date.now()},
    }) as any;
    fixture.detectChanges();
    expect(component.controlsDisabled).toBeTrue();
  });

  it('disables all roster controls once finished', () => {
    component.status = EventStatus.FINISHED;
    fixture.detectChanges();
    expect(component.controlsDisabled).toBeTrue();
  });

  it('random partners mode hides team controls', () => {
    component.event = teamArenaEvent({
      doublesPairingStrategy: DoublesPairingStrategy.RANDOM_PARTNERS,
    }) as any;
    fixture.detectChanges();
    expect(component.bringYourPartner).toBeFalse();
  });
});
