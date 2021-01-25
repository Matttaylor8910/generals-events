import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventLeaderboardComponent} from './event-leaderboard.component';

describe('EventLeaderboardComponent', () => {
  let component: EventLeaderboardComponent;
  let fixture: ComponentFixture<EventLeaderboardComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventLeaderboardComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventLeaderboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
