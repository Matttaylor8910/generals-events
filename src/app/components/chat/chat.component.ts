import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';
import {Observable} from 'rxjs';
import {GeneralsService} from 'src/app/services/generals.service';
import {MessageService} from 'src/app/services/message.service';

import {ADMINS} from '../../../../constants';
import {IChatMessage, IEvent, IMultiStageEvent} from '../../../../types';

const FIVE_MINS = 1000 * 60 * 5;

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  @ViewChild('chatBox', {read: ElementRef, static: false}) chatBox: ElementRef;

  @Input() event: IEvent;
  @Input() disqualified: boolean;
  @Input() inEvent: boolean;

  // in the case of a multi stage event, we want to use one eventId for a
  // unified chat box across events
  @Input() parentEvent: IMultiStageEvent;

  @Output() nameClicked = new EventEmitter<string>();

  // more recent messages at the beginning
  messages$: Observable<IChatMessage[]>;
  text: string;

  constructor(
      private readonly generals: GeneralsService,
      private readonly messageService: MessageService,
  ) {}

  get messagesHeight(): number {
    // 59px is the height required for other elements in the chat box
    return (this.chatBox?.nativeElement.clientHeight || 0) - 59;
  }

  get disallowNewMessages(): boolean {
    // if the disableChat flag is set to true, no new messages
    if (this.parentEvent?.disableChat) {
      return true;
    }

    // if the disableJoin flag is set to true, only players already in the event can participate
    if (this.parentEvent?.disableJoin && !this.inEvent) {
      return true;
    }

    // if there's no end time, just keep the chat open
    if (!this.parentEvent?.endTime) {
      return false;
    }

    // if there is an end time, keep the chat open for 5 mins
    const endTime = this.parentEvent?.endTime ?? this.event?.endTime;
    return endTime < Date.now() - FIVE_MINS;
  }

  get disableChat(): boolean {
    return !this.generals.name || this.disqualified || this.disallowNewMessages;
  }

  get placeholder(): string {
    if (this.disqualified) {
      return 'You have been disqualified';
    } else if (this.disallowNewMessages) {
      return 'Chat is closed, join discord!'
    } else if (this.generals.name) {
      return 'Please be nice in chat!'
    }
    return 'You must login to chat';
  }

  /**
   * The event id to use for chat messages. Use the parent's eventId in the case
   * of this event being part of a multi-stage event
   */
  get eventId(): string {
    return this.parentEvent?.id ?? this.event?.id;
  }

  ngOnInit() {
    if (this.eventId) {
      this.messages$ = this.messageService.getEventMessages(this.eventId);
    }
  }

  isAdmin(sender: string): boolean {
    return ADMINS.includes(sender);
  }

  submit() {
    if (this.text) {
      this.messageService.addEventMessage(this.eventId, this.text);
      delete this.text;
    }
  }
}
