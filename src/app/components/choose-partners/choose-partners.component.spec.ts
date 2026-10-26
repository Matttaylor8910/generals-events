import {ChoosePartnersComponent} from './choose-partners.component';
import {EventStatus, EventType, ILeaderboardPlayer} from '../../../../types';

// Class-isolated tests: the component is constructed directly with stub
// collaborators instead of TestBed so no Angular DI or Ionic modules are
// required.

describe('ChoosePartnersComponent', () => {
  function player(name: string, extra: Partial<ILeaderboardPlayer> = {}) {
    return {name, dq: false, record: [], ...extra} as ILeaderboardPlayer;
  }

  function makeComponent(
      players: ILeaderboardPlayer[], me = 'amy', status = EventStatus.UPCOMING) {
    const toasts: string[] = [];
    const calls: any[] = [];
    const eventService = {
      setBigTeam: (...args: any[]) => {
        calls.push(args);
        return Promise.resolve();
      },
      leaveBigTeam: () => Promise.resolve(),
      setTeamName: () => Promise.resolve(),
      selectPartner: () => Promise.resolve(),
      clearPartner: () => Promise.resolve(),
      confirmPartner: () => Promise.resolve(),
    };
    const util = {
      showToast: (m: string) => toasts.push(m),
      promptForText: async () => null,
      confirm: async () => true,
    };
    const comp = new ChoosePartnersComponent(
        {name: me} as any, eventService as any, util as any);
    comp.event = {
      id: 'e1',
      type: EventType.BIG_TEAM,
      teamSize: 3,
      checkedInPlayers: players.map(p => p.name),
    } as any;
    comp.players = players;
    comp.status = status;
    return {comp, toasts, calls};
  }

  it('should create', () => {
    expect(makeComponent([]).comp).toBeTruthy();
  });

  it('only confirms fully consistent big-team rosters', () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('cat', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('dan'),
    ];
    const {comp} = makeComponent(players, 'dan');
    expect(comp.confirmedTeams.length).toBe(1);
    expect(comp.confirmedTeams[0].players).toEqual(['amy', 'bob', 'cat']);
  });

  it('does not show the current-team block for a confirmed roster', () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('cat', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('dan'),
    ];
    const {comp} = makeComponent(players, 'amy');
    expect(comp.showCurrentTeam).toBeFalse();
  });

  it('shows the current-team block for an incomplete roster', () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob']}),
      player('cat'),
    ];
    const {comp} = makeComponent(players, 'amy');
    expect(comp.showCurrentTeam).toBeTrue();
  });

  it('blocks non-captain members from adding players', async () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob']}),
      player('cat'),
    ];
    const {comp, calls, toasts} = makeComponent(players, 'bob');
    await comp.chooseBigTeamPlayer(players[2]);
    expect(calls.length).toBe(0);
    expect(toasts.some(t => t.includes('captain'))).toBeTrue();
  });
});
