import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { DynamicDYPLeaderboardComponent } from './dynamic-dyp-leaderboard.component';

describe('DynamicDYPLeaderboardComponent', () => {
  let component: DynamicDYPLeaderboardComponent;
  let fixture: ComponentFixture<DynamicDYPLeaderboardComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DynamicDYPLeaderboardComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicDYPLeaderboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
