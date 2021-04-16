import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {DynamicDYPStatusComponent} from './dynamic-dyp-status.component';

describe('DynamicDYPStatusComponent', () => {
  let component: DynamicDYPStatusComponent;
  let fixture: ComponentFixture<DynamicDYPStatusComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [DynamicDYPStatusComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(DynamicDYPStatusComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
