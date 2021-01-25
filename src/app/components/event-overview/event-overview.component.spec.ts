import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventOverviewComponent} from './event-overview.component';

describe('EventOverviewComponent', () => {
  let component: EventOverviewComponent;
  let fixture: ComponentFixture<EventOverviewComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventOverviewComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
