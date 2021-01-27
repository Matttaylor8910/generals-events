import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {CreateEventPage} from './create-event.page';

describe('CreateEventPage', () => {
  let component: CreateEventPage;
  let fixture: ComponentFixture<CreateEventPage>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule(
            {declarations: [CreateEventPage], imports: [IonicModule.forRoot()]})
        .compileComponents();

    fixture = TestBed.createComponent(CreateEventPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
