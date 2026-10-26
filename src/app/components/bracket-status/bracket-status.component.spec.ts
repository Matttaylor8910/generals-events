import {BracketStatusComponent} from './bracket-status.component';
import {EventType, ILeaderboardPlayer} from '../../../../types';

// Class-isolated tests: constructed with stub collaborators, no TestBed DI.

describe('BracketStatusComponent', () => {
  function player(name: string, extra: Partial<ILeaderboardPlayer> = {}) {
    return {name, dq: false, record: [], ...extra} as ILeaderboardPlayer;
  }

  function makeComponent(
      players: ILeaderboardPlayer[], me: string, checkedIn: string[]) {
    const comp = new BracketStatusComponent(
        {name: me, nameChanged$: {subscribe: () => {}}} as any, {} as any);
    comp.event = {
      id: 'e1',
      type: EventType.BIG_TEAM,
      teamSize: 3,
      checkedInPlayers: checkedIn,
    } as any;
    comp.players = players;
    comp.determineInEvent();
    return comp;
  }

  it('should create', () => {
    expect(makeComponent([], 'amy', [])).toBeTruthy();
  });

  it('confirms membership only in a fully consistent roster', () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('cat', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
    ];
    const comp = makeComponent(players, 'amy', ['amy', 'bob', 'cat']);
    expect(comp.teamConfirmed).toBeTrue();
  });

  it('does not confirm a stale or inconsistent roster claim', () => {
    const players = [
      player('amy', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('bob', {teamCaptain: 'amy', teamMembers: ['amy', 'bob', 'cat']}),
      player('cat', {teamCaptain: 'amy', teamMembers: ['cat', 'zed']}),
    ];
    const comp = makeComponent(players, 'cat', ['amy', 'bob', 'cat']);
    expect(comp.teamConfirmed).toBeFalse();
  });
});
