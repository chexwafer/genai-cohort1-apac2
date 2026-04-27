import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Task } from '../models/task.model';
import { API_BASE_URL } from '../config';

@Injectable({
  providedIn: 'root',
})
export class TaskService {
  readonly baseUrl = API_BASE_URL;
  readonly taskUrl = `${this.baseUrl}/tasks`;
  readonly projectTaskUrl = `${this.baseUrl}/projects/:projectId/tasks`;

  private http = inject(HttpClient);

  getAllTasks(): Observable<Task[]> {
    return this.http.get<Task[]>(this.taskUrl);
  }

  getAllTasksByProject(projectId: number): Observable<Task[]> {
    const url = `${this.projectTaskUrl.replace(':projectId', projectId.toString())}`;
    return this.http.get<Task[]>(url);
  }

  markTaskAsCompleted(taskId: number): Observable<Task> {
    const url = `${this.taskUrl}/${taskId}/complete`;
    return this.http.post<Task>(url, {});
  }
}
