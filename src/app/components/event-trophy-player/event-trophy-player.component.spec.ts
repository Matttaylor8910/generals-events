import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventTrophyPlayerComponent} from './event-trophy-player.component';

describe('EventTrophyPlayerComponent', () => {
  let component: EventTrophyPlayerComponent;
  let fixture: ComponentFixture<EventTrophyPlayerComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventTrophyPlayerComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventTrophyPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
