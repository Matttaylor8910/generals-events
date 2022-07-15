import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

@Component({
  selector: 'app-event-filter',
  templateUrl: './event-filter.component.html',
  styleUrls: ['./event-filter.component.scss'],
})
export class EventFilterComponent {
  @Input() tabs: string[];
  @Input() selectedTab: string;

  @Output() tabChange = new EventEmitter<string>();
}
