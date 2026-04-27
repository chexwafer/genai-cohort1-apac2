from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlmodel import Field, Session, SQLModel, create_engine, select, Relationship


class Project(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    description: str = Field(max_length=255)
    tasks: list["Task"] = Relationship(back_populates="project")



class Task(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    description: str = Field(max_length=255)
    duration: int
    isCompleted: bool
    sequence: int
    project_id: int = Field(foreign_key="project.id")
    project: Project = Relationship(back_populates="tasks")