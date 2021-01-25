import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventQueueComponent} from './event-queue.component';

describe('EventQueueComponent', () => {
  let component: EventQueueComponent;
  let fixture: ComponentFixture<EventQueueComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventQueueComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventQueueComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
