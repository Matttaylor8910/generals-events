import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {ArenaQueueComponent} from './arena-queue.component';

describe('ArenaQueueComponent', () => {
  let component: ArenaQueueComponent;
  let fixture: ComponentFixture<ArenaQueueComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [ArenaQueueComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(ArenaQueueComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
