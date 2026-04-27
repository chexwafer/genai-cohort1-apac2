import { Component, signal, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './chat/chat.component';
import { session } from './services/session.service';
import { OAuthService } from 'angular-oauth2-oidc';
import { authCodeFlowConfig } from './auth-config';
import { Task } from './models/task.model';
import { timer } from 'rxjs';
import { TaskService } from './services/task';
import { Project } from './models/project.model';
import { ProjectService } from './services/project';

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
  public readonly projects = signal<Project[]>([]);
  public readonly activeTask = signal<Task | null>(null);
  public readonly taskRunState = signal<TaskRunState>(TaskRunState.NotStarted);
  public TaskRunState = TaskRunState; // expose enum to template
  public intervalId: any = null;
  public selectedProjectId = signal<number | null>(null);
  public currentView = signal<'projects' | 'chat'>('projects');
  public isLoadingData = signal(false);

  @ViewChild('chat') private chat?: ChatComponent;

  constructor(
    private oAuthService: OAuthService,
    private taskService: TaskService,
    private projectService: ProjectService,
  ) {
    this.configure();
  }

  //Function to greet user based on their time i.e Good morning, good afternoon, good evening
  public get greeting(): string {
    const currentHour = new Date().getHours();

    if (currentHour < 12) {
      return 'Good morning!';
    } else if (currentHour < 18) {
      return 'Good afternoon!';
    } else {
      return 'Good evening!';
    }
  }

  public ngOnInit() {
    // ensure we have a user/session id persisted — generate new ones if missing
    if (!this.session.userId() || !this.session.sessionId()) {
      this.generateIds();
    }

    this.getTasks();
    this.getProjects();
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
    this.chat?.isLoading.set(false);
  }

  public isAuthenticated(): boolean {
    try {
      return !!this.oAuthService.getAccessToken?.();
    } catch {
      return false;
    }
  }

  public onSelectProject(projectId: number) {
    if (this.selectedProjectId() !== projectId) {
      this.stopTask();
    }
    this.selectedProjectId.set(projectId);
    this.currentView.set('projects');
    this.getTasks();
  }

  onClickAIAgent() {
    console.log('AI Agent button clicked');
    this.currentView.set('chat');
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
    let endTime = new Date(startTime.getTime() + taskToStart.duration * 1000);

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
      this.taskService.markTaskAsCompleted(activeTask.id).subscribe(() => {
        activeTask.isCompleted = true;
        this.tasks.update((tasks) => tasks.map((t) => (t === activeTask ? activeTask : t)));
      });
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

  public getProjects(): Project[] {
    this.isLoadingData.set(true);
    this.projectService.getAllProjects().subscribe({
      next: (fetchedProjects) => {
        console.log('Fetched projects from API:', fetchedProjects);
        this.projects.set(fetchedProjects);
        this.isLoadingData.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch projects', err);
        this.isLoadingData.set(false);
      },
    });

    return this.projects();
  }

  public getTasks(): Task[] {
    if (!this.selectedProjectId()) {
      return [];
    }

    this.isLoadingData.set(true);
    this.taskService.getAllTasksByProject(this.selectedProjectId()).subscribe({
      next: (fetchedTasks) => {
        console.log('Fetched tasks from API:', fetchedTasks);
        this.tasks.set(fetchedTasks);
        this.isLoadingData.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch tasks', err);
        this.isLoadingData.set(false);
      },
    });

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
