import {Component, Input} from '@angular/core';
import {PopoverController} from '@ionic/angular';
import {PopoverAction} from './actions-popover.component';

@Component({
  selector: 'app-actions-popover-page',
  templateUrl: './actions-popover-page.component.html',
  styleUrls: ['./actions-popover-page.component.scss'],
})
export class ActionsPopoverPageComponent {
  @Input() actions: PopoverAction[];
  constructor(readonly popoverController: PopoverController) {}
}
