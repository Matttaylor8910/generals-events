import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { WupedComponent } from './wuped.component';

describe('WupedComponent', () => {
  let component: WupedComponent;
  let fixture: ComponentFixture<WupedComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ WupedComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(WupedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
