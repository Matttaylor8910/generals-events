import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TournamentPage } from './tournament.page';

describe('TournamentPage', () => {
  let component: TournamentPage;
  let fixture: ComponentFixture<TournamentPage>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TournamentPage ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
