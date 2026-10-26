import {BracketEventComponent} from './bracket-event.component';
import {EventStatus, EventType} from '../../../../types';

// Class-isolated tests: constructed with stub collaborators, no TestBed DI.

describe('BracketEventComponent', () => {
  function makeComponent() {
    const toasts: string[] = [];
    const updates: any[] = [];
    const eventService = {
      updateEvent: (id: string, data: any) => {
        updates.push(data);
        return Promise.resolve();
      },
      checkInPlayer: () => Promise.resolve(),
      addPlayer: () => Promise.resolve(),
      removePlayer: () => Promise.resolve(),
    };
    const util = {
      showToast: (m: string) => toasts.push(m),
      selectTab$: {pipe: () => ({subscribe: () => {}})},
      confirm: async () => true,
    };
    const comp = new BracketEventComponent(
        {name: 'matt'} as any, eventService as any, util as any);
    comp.event = {id: 'e1', type: EventType.ONE_VS_ONE} as any;
    comp.status = EventStatus.UPCOMING;
    return {comp, toasts, updates};
  }

  it('should create', () => {
    expect(makeComponent().comp).toBeTruthy();
  });

  it('refuses to start an event without a generated bracket', () => {
    const {comp, toasts, updates} = makeComponent();
    comp.startEvent();
    expect(updates.length).toBe(0);
    expect(toasts.some(t => t.includes('Create a bracket'))).toBeTrue();
  });

  it('does not include a bracket in the update when none was generated', () => {
    const {comp, updates} = makeComponent();
    comp.startEvent();
    expect(updates.every(update => !update.bracket)).toBeTrue();
  });
});
