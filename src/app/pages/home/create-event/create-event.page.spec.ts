import {CreateEventPage} from './create-event.page';
import {DoublesPairingStrategy, EventFormat, EventType, Visibility} from '../../../../types';

// Class-isolated tests: constructed with stub collaborators, no TestBed DI.

describe('CreateEventPage', () => {
  function makePage() {
    const created: any[] = [];
    const eventService = {
      createEvent: async (data: any) => {
        created.push(data);
        return 'id';
      },
      updateEvent: async () => {},
      getEvent: () => ({pipe: () => ({subscribe: () => {}})}),
    };
    const modal = {dismiss: () => {}};
    const nav = {get: () => null};
    const page = new CreateEventPage(
        eventService as any, modal as any, nav as any);
    page.date = '2030-01-01';
    page.time = '12:00:00';
    page.visibility = Visibility.PUBLIC;
    page.type = EventType.BIG_TEAM;
    page.format = EventFormat.DOUBLE_ELIM;
    page.checkIn = '15 minutes before start' as any;
    page.pairingStrategy = DoublesPairingStrategy.BRING_YOUR_PARTNER;
    return {page, created};
  }

  it('should create', () => {
    expect(makePage().page).toBeTruthy();
  });

  it('rejects fractional and out-of-range team sizes', () => {
    const {page} = makePage();
    for (const bad of [0, 1, 9, 2.5, NaN, Infinity]) {
      page.teamSize = bad;
      expect(page.teamConfigValid).toBe(false, `teamSize ${bad}`);
    }
    for (const good of [2, 3, 8]) {
      page.teamSize = good;
      expect(page.teamConfigValid).toBe(true, `teamSize ${good}`);
    }
  });

  it('double elim resolves to exactly two teams per game', () => {
    const {page} = makePage();
    page.teamSize = 4;
    expect(page.resolvedPlayersPerGame).toBe(8);
    page.teamSize = 8;
    expect(page.resolvedPlayersPerGame).toBe(16);
  });

  it('refuses to persist an invalid configuration', async () => {
    const {page, created} = makePage();
    page.teamSize = 2.5;
    await page.create();
    expect(created.length).toBe(0);
  });

  it('persists numeric team configuration', async () => {
    const {page, created} = makePage();
    page.teamSize = '4' as any;
    await page.create();
    expect(created.length).toBe(1);
    expect(created[0].teamSize).toBe(4);
    expect(created[0].playersPerGame).toBe(8);
  });
});
