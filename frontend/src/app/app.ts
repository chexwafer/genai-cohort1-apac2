import { Component, inject, signal, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './chat/chat.component';
import { session } from './services/session.service';
import { OAuthService } from 'angular-oauth2-oidc';
import { authCodeFlowConfig } from './auth-config';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, ChatComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('frontend');
  public readonly session = session;
  public readonly auth = signal(false);
  @ViewChild('chat') private chat?: ChatComponent;

  constructor(private oAuthService: OAuthService) {
    this.configure();
  }

  public login() {
    console.log('Initiating login flow');
    console.log(this.oAuthService.getAccessToken());
    this.oAuthService.initLoginFlow();
  }

  public logout() {
    this.oAuthService.revokeTokenAndLogout();
  }

  public generateIds() {
    this.session.generate();
    // clear chat for the new session
    this.chat?.clear();
  }

  public isAuthenticated(): boolean {
    try {
      return !!this.oAuthService.getAccessToken?.();
    } catch {
      return false;
    }
  }

  private configure() {
    this.oAuthService.configure(authCodeFlowConfig);
    this.oAuthService.setupAutomaticSilentRefresh();
    this.oAuthService.loadDiscoveryDocumentAndTryLogin();
    // initialise auth signal and update on OAuth events
    try {
      this.auth.set(!!this.oAuthService.getAccessToken?.());
      // `events` emits on token changes / login/logout
      // subscribe to keep `auth` signal in sync with OAuthService
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this.oAuthService.events?.subscribe(() => {
        try {
          this.auth.set(!!this.oAuthService.getAccessToken?.());
        } catch {
          this.auth.set(false);
        }
      });
    } catch {
      this.auth.set(false);
    }
  }
}
