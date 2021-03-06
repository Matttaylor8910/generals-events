import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild} from '@angular/core';
import {Observable} from 'rxjs';
import {GeneralsService} from 'src/app/services/generals.service';
import {MessageService} from 'src/app/services/message.service';

import {ADMINS} from '../../../../constants';
import {IArenaEvent, IChatMessage} from '../../../../types';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  @ViewChild('chatBox', {read: ElementRef, static: false}) chatBox: ElementRef;

  @Input() event: IArenaEvent;
  @Input() disqualified: boolean;

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

  get disableChat(): boolean {
    return !this.generals.name || this.disqualified;
  }

  get placeholder(): string {
    if (this.disqualified) {
      return 'You have been disqualified';
    } else if (this.generals.name) {
      return 'Please be nice in chat!'
    }
    return 'You must login to chat';
  }

  ngOnInit() {
    if (this.event?.id) {
      this.messages$ = this.messageService.getEventMessages(this.event.id);
    }
  }

  isAdmin(sender: string): boolean {
    return ADMINS.includes(sender);
  }

  submit() {
    if (this.text) {
      this.messageService.addEventMessage(this.event.id, this.text);
      delete this.text;
    }
  }
}
