from pydantic import BaseModel

from models import Task, Project


class TaskDto(BaseModel):
    id: int | None = None
    title: str
    description: str | None = None
    duration: int
    isCompleted: bool = False
    sequence: int
    project_id: int | None = None

    def to_model(self) -> Task:
        return Task(
            id=self.id,
            title=self.title,
            description=self.description,
            duration=self.duration,
            isCompleted=self.isCompleted,
            sequence=self.sequence,
            project_id=self.project_id
        )


class ProjectDto(BaseModel):
    id: int | None = None
    title: str
    description: str


class ProjectTasksDto(ProjectDto):
    tasks: list[TaskDto] | None = None

    def to_model(self) -> Project:
        return Project(
            id=self.id,
            title=self.title,
            description=self.description,
            tasks=[task.to_model() for task in self.tasks or []],
        )
