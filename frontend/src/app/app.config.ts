import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { provideOAuthClient } from 'angular-oauth2-oidc';
import { routes } from './app.routes';
import { TaskService } from './services/task';
import { ProjectService } from './services/project';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    provideOAuthClient(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    TaskService,
    ProjectService
  ]
};
