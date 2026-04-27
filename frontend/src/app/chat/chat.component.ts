import { Component, signal, inject, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  private readonly sanitizer = inject(DomSanitizer);
  @ViewChild('messagesRef') private messagesContainer?: ElementRef<HTMLElement>;

  // controller for the currently active request so it can be aborted
  private currentAbortController?: AbortController | null = null;
  private currentPlaceholderId?: string | null = null;

  public readonly messages = signal<Array<{ from: 'user' | 'agent'; text?: string; id?: string; pending?: boolean; tasks?: Array<any> }>>([]);
  public messageText = signal('');
  public isLoading = signal(false);
  @Output() public refreshProjects = new EventEmitter<void>();

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

    // create a controller so we can cancel this request if needed
    const controller = new AbortController();
    this.currentAbortController = controller;
    this.currentPlaceholderId = placeholderId;

    this.isLoading.set(true);
    try {
      const data = await this.adk.sendMessage(text, token, userId, sessionId, controller.signal);
      const replyText = data?.response ?? data?.output ?? (typeof data === 'string' ? data : JSON.stringify(data));
      // honor ADK post-call actions
      if (data?.post_call_action === 'refresh_projects') {
        try {
          this.refreshProjects.emit();
        } catch {}
      }
      // replace placeholder with actual reply text
      this.messages.update((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, text: replyText, pending: false } : msg)));
      // if tasks are present, append them as a separate agent message
      if (data?.tasks && Array.isArray(data.tasks) && data.tasks.length > 0) {
        this.messages.update((m) => [...m, { from: 'agent', tasks: data.tasks }]);
      }
      this.scrollToBottom();
    } catch (err) {
      // If the request was aborted, show a cancelled message, otherwise show the error
      if ((err as any)?.name === 'AbortError') {
        this.messages.update((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, text: 'Canceled by user', pending: false } : msg)));
      } else {
        this.messages.update((m) => m.map((msg) => (msg.id === placeholderId ? { ...msg, text: 'Error: ' + (err?.message ?? err), pending: false } : msg)));
      }
      this.scrollToBottom();
    } finally {
      this.isLoading.set(false);
      // clear controller and placeholder tracking
      this.currentAbortController = null;
      this.currentPlaceholderId = null;
    }
  }

  // Cancel the in-flight request (if any) and allow the user to send again
  public cancel() {
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {}
      // proactively update the placeholder so UI becomes responsive immediately
      if (this.currentPlaceholderId) {
        const id = this.currentPlaceholderId;
        this.messages.update((m) => m.map((msg) => (msg.id === id ? { ...msg, text: 'Canceled by user', pending: false } : msg)));
        this.scrollToBottom();
      }
      this.isLoading.set(false);
      this.currentAbortController = null;
      this.currentPlaceholderId = null;
    }
  }

  public clear() {
    this.messages.set([]);
  }

  // Render Markdown to sanitized HTML (supports headings, lists, links, bold, italics, code)
  public renderMarkdown(text?: string): SafeHtml {
    if (!text) return '' as any;
    const html = this.markdownToHtml(text);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private markdownToHtml(md: string): string {
    // Protect code blocks first
    const codeBlocks: string[] = [];
    md = md.replace(/```[\r\n]?([\s\S]*?)```/g, (_m, p1) => {
      codeBlocks.push(this.escapeHtml(p1));
      return `@@CODE_BLOCK_${codeBlocks.length - 1}@@`;
    });

    // Escape remaining HTML
    md = this.escapeHtml(md);

    // Inline code
    md = md.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headings
    md = md.replace(/^###\s*(.+)$/gm, '<h3>$1</h3>');
    md = md.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
    md = md.replace(/^#\s*(.+)$/gm, '<h1>$1</h1>');

    // Bold and italics
    md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Links
    md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Lists and paragraphs
    const lines = md.split(/\r?\n/);
    let out = '';
    let inUl = false;
    let inOl = false;
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (line.match(/^[-*]\s+(.+)/)) {
        if (!inUl) { out += '<ul>'; inUl = true; }
        out += '<li>' + line.replace(/^[-*]\s+/, '') + '</li>';
        continue;
      }
      const olMatch = line.match(/^\d+\.\s+(.+)/);
      if (olMatch) {
        if (!inOl) { out += '<ol>'; inOl = true; }
        out += '<li>' + olMatch[1] + '</li>';
        continue;
      }
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
      if (line === '') {
        out += ''; // skip extra blank lines
      } else {
        out += '<p>' + line + '</p>';
      }
    }
    if (inUl) out += '</ul>';
    if (inOl) out += '</ol>';

    // Restore code blocks
    out = out.replace(/@@CODE_BLOCK_(\d+)@@/g, (_m, idx) => {
      const i = Number(idx);
      const content = codeBlocks[i] ?? '';
      return `<pre><code>${content}</code></pre>`;
    });

    return out;
  }

  // Format a duration given in seconds into "X minutes Y seconds" or "Z seconds"
  public formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0 seconds';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
      const minLabel = mins === 1 ? 'minute' : 'minutes';
      if (secs > 0) {
        const secLabel = secs === 1 ? 'second' : 'seconds';
        return `${mins} ${minLabel} ${secs} ${secLabel}`;
      }
      return `${mins} ${minLabel}`;
    }
    const secLabel = secs === 1 ? 'second' : 'seconds';
    return `${secs} ${secLabel}`;
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
