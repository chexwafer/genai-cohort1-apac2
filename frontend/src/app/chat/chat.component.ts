import { Component, signal, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdkService } from '../services/adk.service';
import { session } from '../services/session.service';
import { OAuthService } from 'angular-oauth2-oidc';

@Component({
  selector: 'app-chat',
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent {
  private readonly adk = new AdkService();
  private readonly oauth = inject(OAuthService);
  @ViewChild('messagesRef') private messagesContainer?: ElementRef<HTMLElement>;

  public readonly messages = signal<Array<{ from: 'user' | 'agent'; text?: string; id?: string; pending?: boolean; tasks?: Array<any> }>>([]);
  public messageText = signal('');
  public isLoading = signal(false);

  public async send() {
    if (this.isLoading()) return;

    const text = this.messageText();
    if (!text || !text.trim()) return;
    // add user message
    this.messages.update((m) => [...m, { from: 'user', text }]);
    this.messageText.set('');
    this.scrollToBottom();

    // add placeholder agent message which we'll replace when reply arrives
    const placeholderId = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    this.messages.update((m) => [...m, { from: 'agent', text: 'Thinking…', pending: true, id: placeholderId }]);
    this.scrollToBottom();

    // retrieve access token if available and pass to ADK
    const token = this.oauth?.getAccessToken?.() || undefined;
    const userId = session.userId();
    const sessionId = session.sessionId();

    this.isLoading.set(true);
    try {
      const data = await this.adk.sendMessage(text, token, userId, sessionId);
      const replyText = data?.response ?? data?.output ?? (typeof data === 'string' ? data : JSON.stringify(data));
      // replace placeholder with actual reply text
      this.messages.update((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, text: replyText, pending: false } : msg)));
      // if tasks are present, append them as a separate agent message
      if (data?.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
        this.messages.update((m) => [...m, { from: 'agent', tasks: data.tasks }]);
      }
      this.scrollToBottom();
    } catch (err) {
      this.messages.update((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, text: 'Error: ' + (err?.message ?? err), pending: false } : msg)));
      this.scrollToBottom();
    } finally {
      this.isLoading.set(false);
    }
  }

  public clear() {
    this.messages.set([]);
  }
  private scrollToBottom() {
    try {
      setTimeout(() => {
        const el = this.messagesContainer?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }, 50);
    } catch {}
  }
}
