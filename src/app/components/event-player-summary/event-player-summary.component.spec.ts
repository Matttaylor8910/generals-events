import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventPlayerSummaryComponent} from './event-player-summary.component';

describe('EventPlayerSummaryComponent', () => {
  let component: EventPlayerSummaryComponent;
  let fixture: ComponentFixture<EventPlayerSummaryComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventPlayerSummaryComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventPlayerSummaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
