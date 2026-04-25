import { Component, inject, signal, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './chat/chat.component';
import { session } from './services/session.service';
import { OAuthService } from 'angular-oauth2-oidc';
import { authCodeFlowConfig } from './auth-config';
import { createEmptyTask, Task } from './models/task.model';
import { interval, startWith, timer } from 'rxjs';

enum TaskRunState {
  NotStarted = 'Not Started',
  InProgress = 'In Progress',
  Paused = 'Paused',
  Completed = 'Completed',
}

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
  public readonly tasks = signal<Task[]>([]);
  public readonly activeTask = signal<Task | null>(null);
  public readonly taskRunState = signal<TaskRunState>(TaskRunState.NotStarted);
  public TaskRunState = TaskRunState; // expose enum to template
  public intervalId: any = null;

  @ViewChild('chat') private chat?: ChatComponent;

  constructor(private oAuthService: OAuthService) {
    this.configure();
  }

  public ngOnInit() {
    this.getTasks();
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

  public startTask(task: Task | null) {
    this.taskRunState.set(TaskRunState.InProgress);
    const taskToStart = task || this.getNextTaskToStart();
    this.activeTask.set(taskToStart);
    if (this.intervalId) {
      this.intervalId.unsubscribe();
      this.intervalId = null;
    }
    let startTime = new Date();
    let endTime = new Date(startTime.getTime() + parseInt(taskToStart.duration) * 1000);

    this.intervalId = timer(0, 1000).subscribe(() => {
      // Get today's date and time
      var now = new Date();

      // Find the distance between now and the count down date
      var distance = endTime.getTime() - now.getTime();
      document.getElementById('taskTimer')!.innerText = new Date(distance)
        .toISOString()
        .substr(11, 8);
      console.log('Task in progress...', startTime.getTime().toString(), endTime.toISOString());

      if (distance < 0) {
        this.completeTask();
      }
    });
  }

  public completeTask() {
    const activeTask = this.activeTask();
    if (activeTask) {
      activeTask.isCompleted = true;
      this.tasks.update((tasks) => tasks.map((t) => (t === activeTask ? activeTask : t)));
    }

    const nextTask = this.getNextTaskToStart();
    if (nextTask) {
      this.startTask(nextTask);
    } else {
      this.stopTask();
    }
  }

  public stopTask() {
    this.taskRunState.set(TaskRunState.NotStarted);
    this.activeTask.set(null);
    if (this.intervalId) {
      this.intervalId.unsubscribe();
      this.intervalId = null;
    }
  }

  public pauseTask() {
    this.taskRunState.set(TaskRunState.Paused);
  }

  public getTasks(): Task[] {
    let tasks: Task[] = [];
    let task1 = createEmptyTask();
    task1.title = 'Install nodejs';
    task1.description = 'Install nodejs on your machine';
    task1.duration = '5';
    task1.isCompleted = false;

    let task2 = createEmptyTask();
    task2.title = 'Create project folder';
    task2.description = 'Create a new folder for your project';
    task2.duration = '150';
    task2.isCompleted = true;

    let task3 = createEmptyTask();
    task3.title = 'Deploy to Cloud';
    task3.description = 'Deploy your application to the cloud';
    task3.duration = '3600';
    task3.isCompleted = true;

    let task4 = createEmptyTask();
    task4.title = 'Verification and testing';
    task4.description = 'Verify and test your application';
    task4.duration = '10';
    task4.isCompleted = false;
    tasks.push(task1);
    tasks.push(task2);
    tasks.push(task3);
    tasks.push(task4);

    this.tasks.set(tasks);
    return this.tasks();
  }

  public getNextTaskToStart(): Task | undefined {
    const tasks = this.tasks();
    if (this.activeTask()) {
      return tasks.find((task) => !task.isCompleted && task !== this.activeTask());
    }
    return tasks.find((task) => !task.isCompleted);
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
