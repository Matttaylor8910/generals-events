import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { DynamicDYPFinalsTeamsComponent } from './dynamic-dyp-finals-teams.component';

describe('DynamicDYPFinalsTeamsComponent', () => {
  let component: DynamicDYPFinalsTeamsComponent;
  let fixture: ComponentFixture<DynamicDYPFinalsTeamsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DynamicDYPFinalsTeamsComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicDYPFinalsTeamsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
