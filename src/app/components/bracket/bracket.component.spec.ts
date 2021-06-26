import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { BracketComponent } from './bracket.component';

describe('BracketComponent', () => {
  let component: BracketComponent;
  let fixture: ComponentFixture<BracketComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ BracketComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(BracketComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
