import {Component, Input} from '@angular/core';
import {PopoverController} from '@ionic/angular';
import {ActionsPopoverPageComponent} from './actions-popover-page.component';

export interface PopoverAction {
  label: string;
  icon?: string;
  onClick(): void;
}

@Component({
  selector: 'app-actions-popover',
  templateUrl: './actions-popover.component.html',
  styleUrls: ['./actions-popover.component.scss'],
})
export class ActionsPopoverComponent {
  @Input() actions: PopoverAction[];

  constructor(
      private readonly popoverController: PopoverController,
  ) {}

  async showOptions($event: Event) {
    // prevent the original click handler and spawn a popover with some options
    $event.stopPropagation();
    const popover = await this.popoverController.create({
      component: ActionsPopoverPageComponent,
      componentProps: {actions: this.actions},
      event: $event,
      translucent: true,
    });
    await popover.present();

    // when the popover is dismissed, handle any action clicked
    popover.onDidDismiss().then(detail => {
      const action = detail.data as PopoverAction;
      if (action && typeof action.onClick === 'function') {
        action.onClick();
      }
    });
  }
}
