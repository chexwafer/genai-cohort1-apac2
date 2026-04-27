import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Project } from '../models/project.model';
import { API_BASE_URL } from '../config';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  readonly baseUrl = API_BASE_URL;
  readonly projectUrl = `${this.baseUrl}/projects`;

  private http = inject(HttpClient);

  getAllProjects(): Observable<Project[]> {
    return this.http.get<Project[]>(this.projectUrl);
  }
}
