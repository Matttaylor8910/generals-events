import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { CreateTournamentPage } from './create-tournament.page';

describe('CreateTournamentPage', () => {
  let component: CreateTournamentPage;
  let fixture: ComponentFixture<CreateTournamentPage>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ CreateTournamentPage ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(CreateTournamentPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
