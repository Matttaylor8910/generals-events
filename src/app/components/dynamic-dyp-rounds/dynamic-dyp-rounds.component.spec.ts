import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { DynamicDYPRoundsComponent } from './dynamic-dyp-rounds.component';

describe('DynamicDYPRoundsComponent', () => {
  let component: DynamicDYPRoundsComponent;
  let fixture: ComponentFixture<DynamicDYPRoundsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DynamicDYPRoundsComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicDYPRoundsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
