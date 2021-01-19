import {Component, ElementRef, Input, OnInit, ViewChild} from '@angular/core';
import {uniqueId} from 'lodash';
import {Observable} from 'rxjs';
import {GeneralsService} from 'src/app/services/generals.service';
import {MessageService} from 'src/app/services/message.service';
import {IChatMessage, ITournament} from 'types';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  @ViewChild('chatBox', {read: ElementRef, static: false}) chatBox: ElementRef;

  @Input() tournament: ITournament;

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
    return !this.generals.name;
  }

  get placeholder(): string {
    return this.generals.name ? 'Please be nice in chat!' :
                                'You must login to chat';
  }

  ngOnInit() {
    if (this.tournament?.id) {
      this.messages$ =
          this.messageService.getTournamentMessages(this.tournament.id);
    }
  }

  submit() {
    if (this.text) {
      this.messageService.addTournamentMessage(this.tournament.id, this.text);
      delete this.text;
    }
  }
}
