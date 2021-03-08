import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { BracketEventComponent } from './bracket-event.component';

describe('BracketEventComponent', () => {
  let component: BracketEventComponent;
  let fixture: ComponentFixture<BracketEventComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ BracketEventComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(BracketEventComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
