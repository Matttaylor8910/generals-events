import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {EventTrophiesComponent} from './event-trophies.component';

describe('EventTrophiesComponent', () => {
  let component: EventTrophiesComponent;
  let fixture: ComponentFixture<EventTrophiesComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [EventTrophiesComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(EventTrophiesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
