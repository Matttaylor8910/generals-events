import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { DoubleEliminationBracketComponent } from './double-elimination-bracket.component';

describe('DoubleEliminationBracketComponent', () => {
  let component: DoubleEliminationBracketComponent;
  let fixture: ComponentFixture<DoubleEliminationBracketComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DoubleEliminationBracketComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(DoubleEliminationBracketComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
