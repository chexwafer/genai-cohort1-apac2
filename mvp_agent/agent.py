import json
import logging
import os
from typing import Annotated, List

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from google.adk.agents import Agent
from google.adk.auth import AuthConfig
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions.database_session_service import DatabaseSessionService
from google.adk.tools import ToolContext
from google.adk.tools.google_api_tool import GoogleApiToolset
from google.adk.tools.mcp_tool import StreamableHTTPConnectionParams, McpToolset
from google.genai import types
from google.genai.types import FunctionCall
from sqlmodel import Session, select, delete, SQLModel
from starlette.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

from database import get_db_session, engine
from dtos import ProjectTasksDto, TaskDto
from models import Task, Project

# Load environment variables from .env file
load_dotenv()

APP_NAME = "simplitasks"
auth_request_function_call_id = ""

db_connection_string = str(os.getenv("DB_CONN_STRING_ASYNC"))
if not db_connection_string:
    logging.error("DB_CONN_STRING_ASYNC not set")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],  # Allows all headers in the request
)

SessionDep = Annotated[Session, Depends(get_db_session)]

from fastapi_mcp import FastApiMCP

mcp = FastApiMCP(app)

# Mount the MCP server directly to your FastAPI app
mcp.mount_http()

client_id = str(os.getenv("CLIENT_ID"))
if not client_id:
    logging.error("CLIENT_ID not set")
client_secret = str(os.getenv("CLIENT_SECRET"))
if not client_secret:
    logging.error("CLIENT_SECRET not set")
mcp_tools_url = str(os.getenv("MCP_TOOLS_URL"))
if not client_secret:
    logging.error("MCP_TOOLS_URL not set")
google_toolset = GoogleApiToolset(api_name="tasks", api_version="v1",
                                  client_id=client_id,
                                  client_secret=client_secret)

google_toolset.get_auth_config()
mcp_tools = McpToolset(
    connection_params=StreamableHTTPConnectionParams(
        url=mcp_tools_url
    )
)
response_prompt = """
    Return ONLY valid JSON. Do not include explanations, markdown, or extra text.
    The JSON contains few properties as below:
    1. response (plain string) - contains your human-readable and engaging response. Do not include tasks here, use tasks property instead.
    2. tasks (list) - contains your proposed or final tasks - return empty list if no tasks are being proposed or generated. Duration is in second
    3. post_call_action - for non agent-to-agent communication. Use any of the following values:
        -'refresh_projects' = use to instruct client browser to refresh the projects list, usually after create,read,update(CRUD) or delete operation on projects
        -'' = empty string if no CRUD operation was done
    Refer to example below on how the JSON is structured.
    
    Example output (with data types):
    {
        "response": -your original response/reply is written here. Do not include tasks here, use tasks property instead,
        "tasks":
        [
            {
                "title": "string",
                "description": "string"
                "duration": int,
                "isCompleted": bool,
                "sequence": int
            }
        ],
        "post_call_action": "string"
    }
    
    Then, verify if the generated JSON conforms to the above specifications, otherwise make corrections to ensure it meets the specifications above.
    ---
"""


def add_prompt_to_state(
        tool_context: ToolContext, prompt: str
) -> dict[str, str]:
    """Saves the user's initial prompt to the state."""
    tool_context.state["PROMPT"] = prompt
    logging.info(f"[State updated] Added to PROMPT: {prompt}")
    return {"status": "success"}

task_manager_agent = Agent(
    model='gemini-2.5-flash',
    name='task_manager_agent',
    description='A helpful assistant for managing tasks in the system.',
    instruction=response_prompt+'''
    You're responsible for managing tasks in the system using 'mcp_tools' tool.
    You have access to 'mcp_tools' tool, to:
     - Create project
     - Create tasks
     - Get projects
     - Get tasks
     - Delete project
     - Delete tasks
     - Create tasks into a project (this will delete existing tasks)
     - Mark task as completed
    
    Be sure to understand user intent, so that you can use the right tool to accomplish the goal.
    Take note, when creating tasks for a new project, you can use either one of the following:
    1. create_project (can include tasks in the body)
    2. create_project without tasks first, then call create_tasks_in_project to add tasks into the project
    
    To amend tasks of an existing project, you can use create_tasks_in_project. This will delete existing tasks of the project
    and create the tasks.
    
    You're free to follow what user wants, so long it is available via mcp_tools.
    ''',
    tools=[mcp_tools]
)

elaboration_agent = Agent(
    model='gemini-2.5-flash',
    name='elaboration_agent',
    description='A helpful assistant for user questions.',
    instruction=response_prompt+'''
    You're an expert task planner that can turn complex and complicated idea or work into 
    smaller tasks. Your goal is to fully answer the user's PROMPT. Each task need to meet the following characteristics:
    - manageable
    - attainable
    - structured
    - in correct sequence
    - logical
    - high success rate
    
    Before you come up with the tasks break down, ask the user their preference on how large each task should be:
    - medium - not so small yet not so big (ideal)
    - large - higher level task, that the task may take longer time to complete
    
    Once granularity level is set, you are free to ask further questions related to
    the original idea or work. Be sure you understand their intent so you can produce high quality broken down tasks.
    
    Then, you have a look at the generated tasks and adjust accordingly so that it meets the required
    characteristics described above. 
    Be aware of dependencies and prerequisites, failure in creating the steps in the correct sequence will impact the completion of overall tasks.
    Therefore, the tasks need to be in correct sequence based on the their priorities, dependencies and risks.
    
    Finally, you propose the user with the broken down tasks. At this point, user may have additional
    questions, amendments or even setting the granularity level, so follow accordingly.
    Once user is happy with the proposed tasks, ask user on the next step:
        -ask user if they want to have the tasks created in the system but need to ask:
            -create tasks into existing project? (this will replace existing tasks of the project)
            -create tasks into a new project. you need to propose project title and description based on the original idea
        -otherwise, continue discussion with the user
    
    Take note that 'task_manager_agent' agent expects response_data populated before transferring control to it, so ensure data below are populated:
    - project title
    - project description
    - tasks (optional) together with title, description, duration in seconds
    
    Populate each task details following below instruction:
        title: name of the task, keep it short and succinct
        description: brief description of the task (the WHAT and WHY) and the end goal. Not to exceed 255 characters in length
        duration: estimation of time to complete the task, expressed in seconds
        sequence: task sequence (starting from 1)
        
    PROMPT:
    { PROMPT }
    ''',
    output_key="response_data",
    sub_agents=[task_manager_agent]
)

greeter_instruction = '''
    You're an agent that will first interact with the user.
    User may greet e.g hello, hi, so please introduce yourself as an expert in task planning and also can assist adding tasks into
    the system for easy tracking and performing tasks. 
    You must greet the user even when they did not greet you.
    After user responds, use the 'add_prompt_to_state' tool to save their response
    Then, transfer control to the 'elaboration_agent' agent
'''

test_instruction = f'''
 You are an agent used for testing mcp tools that you have access to.
 The MCP tools allow you to perform the following:
 - Create project
 - Create tasks
 - Get projects
 - Get tasks
 - Delete project
 - Delete tasks
 - Create tasks into a project (this will delete existing tasks)
 - Mark task as completed
 
 Ask user for details of the task they want to add and also project name to store the tasks inside.
 {response_prompt}
'''
root_agent = Agent(
    model='gemini-2.5-flash',
    name='root_agent',
    description='A helpful assistant for user questions.',
    instruction=response_prompt+greeter_instruction,
    tools=[add_prompt_to_state],
    sub_agents=[elaboration_agent]
)

# session_service = InMemorySessionService()
session_service = DatabaseSessionService(db_connection_string)
runner = Runner(agent=root_agent, app_name=APP_NAME, session_service=session_service)


def get_auth_request_function_call(event: Event) -> FunctionCall | None:
    # Get the special auth request function call from the event
    if not event.content or not event.content.parts:
        return
    for part in event.content.parts:
        if (
                part
                and part.function_call
                and part.function_call.name == 'adk_request_credential'
                and event.long_running_tool_ids
                and part.function_call.id in event.long_running_tool_ids
        ):
            print(part.function_call)
            return part.function_call


async def get_session(user_id, session_id):
    session = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
    if not session:
        session = await session_service.create_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)

    return session


# Agent Interaction
async def call_agent_async(query, session, authorization_header: str | None):
    content = types.Content(role='user', parts=[types.Part(text=query)])
    events = runner.run_async(user_id=session.user_id, session_id=session.id, new_message=content)

    async for event in events:
        if auth_request_function_call := get_auth_request_function_call(event):
            print("--> Authentication required by agent.")
            print(auth_request_function_call)
            auth_config = auth_request_function_call.args.get('authConfig')
            auth_config = AuthConfig.model_validate(auth_config)
            if authorization_header:
                access_token = authorization_header.split(" ")[1].strip()
                auth_config.exchanged_auth_credential.oauth2.access_token = access_token
            return await resubmit_with_auth(auth_request_function_call.id, auth_config, session)
        else:
            if event.is_final_response():
                print("content parts:", event.content)
                final_response = event.content.parts[0].text
                print("Agent response: ", final_response)
                return final_response


async def resubmit_with_auth(original_function_call_id, auth_config: AuthConfig, session):
    print("\nSubmitting authentication details back to the agent...")
    auth_content = types.Content(
        role='user',  # Role can be 'user' when sending a FunctionResponse
        parts=[
            types.Part(
                function_response=types.FunctionResponse(
                    id=original_function_call_id,  # Link to the original request
                    name='adk_request_credential',  # Special framework function name
                    response=auth_config.model_dump()  # Send back the *updated* AuthConfig
                )
            ),
        ],
    )
    events_async_after_auth = runner.run(
        session_id=session.id,
        user_id=session.user_id,
        new_message=auth_content,  # Send the FunctionResponse back
    )

    print("\n--- Agent Response after Authentication ---")
    for event in events_async_after_auth:
        if event.is_final_response():
            final_response = event.content.parts[0].text
            print("Agent response: ", final_response)
            return final_response

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)  # For first-time table creation

# Projects
@app.post("/projects", response_model=Project, tags=["Projects"], operation_id="create_project")
def create_project(projectTasksDto: ProjectTasksDto, session: SessionDep):
    print("\n--- Project Creation ---")
    print(projectTasksDto)
    project = projectTasksDto.to_model()
    session.add(project)
    session.commit()
    session.refresh(project)

    return project


@app.get("/projects/{project_id}/tasks", response_model=List[Task], tags=["Tasks"],
         operation_id="read_tasks_by_project")
def read_tasks_by_project(project_id: int, session: SessionDep):
    tasks = session.exec(select(Task).where(Task.project_id == project_id).order_by(Task.sequence)).all()

    return tasks


@app.post("/projects/{project_id}/tasks", response_model={}, tags=["Tasks"], operation_id="create_tasks_in_project")
def create_tasks_in_project(project_id: int, tasks: list[TaskDto], session: SessionDep):
    statement = delete(Task).where(Task.project_id == project_id)
    session.exec(statement)
    for task in tasks:
        task.project_id = project_id
    session.add_all([task.to_model() for task in tasks])
    session.commit()

    return {'ok': True}


@app.get("/projects", response_model=List[Project], tags=["Projects"], operation_id="get_projects")
def get_projects(
        session: SessionDep,
        offset: int = 0,
):
    projects = session.exec(select(Project).order_by(Project.id.desc()).offset(offset).limit(10)).all()

    return projects


@app.get("/projects/{project_id}", response_model=Project, tags=["Projects"], operation_id="read_project_by_id")
def read_project_by_id(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project


@app.delete("/projects/{project_id}", response_model={}, tags=["Projects"], operation_id="delete_project_by_id")
def delete_project_by_id(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    delete_tasks_statement = delete(Task).where(Task.project_id == project_id)
    session.exec(delete_tasks_statement)
    session.delete(project)
    session.commit()

    return {"ok": True}


# Tasks
@app.post("/tasks", response_model=Task, tags=["Tasks"], operation_id="create_task")
def create_task(task: Task, session: SessionDep):
    session.add(task)
    session.commit()
    session.refresh(task)

    return task


@app.get("/tasks", response_model=List[Task], tags=["Tasks"], operation_id="get_tasks")
def read_tasks(
        session: SessionDep,
        offset: int = 0,
        limit: Annotated[int, Query(le=100)] = 100,
):
    tasks = session.exec(select(Task).offset(offset).limit(limit)).all()

    return tasks


@app.get("/tasks/{task_id}", response_model=Task, tags=["Tasks"], operation_id="read_task_by_id")
def read_task_by_id(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return task


@app.delete("/tasks/{task_id}", response_model={}, tags=["Tasks"], operation_id="delete_task_by_id")
def delete_task_by_id(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()

    return {"ok": True}


@app.post("/tasks/{task_id}/complete", response_model=Task, tags=["Tasks"], operation_id="complete_task_by_id")
def complete_task_by_id(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)

    task.isCompleted = True
    session.add(task)
    session.commit()
    session.refresh(task)

    return task


@app.get('/query')
async def query(
        query: str = Query(
            ..., description="The natural language query for the chart agent"
        ),
        session_id: str = Query(default=None, description="Session ID for the request", alias="sessionId"),
        user_id: str = Query(default=None, description="User ID for the session", alias="userId"),
        authorization: Annotated[str | None, Header()] = None
):
    session = await get_session(user_id, session_id)
    response = await call_agent_async(query, session, authorization)
    if response:
        response = remove_json_markdown(response)
        return json.loads(response)
    return {}


def remove_json_markdown(response: str):
    if response.startswith('```json'):
        response = response[len('```json'):]
    if response.endswith('```'):
        response = response[:-len('```')]
    return response


# Mount the 'dist' folder (or your specific build output folder)
app.mount("/", StaticFiles(directory="frontend/browser"), name="frontend")


@app.get("/")
def serve_index():
    # Manually serve the index.html for the root route
    with open("frontend/browser/index.html", "r") as f:
        return HTMLResponse(content=f.read(), status_code=200)


class StarletteHTTPException:
    pass


from fastapi import Request
from starlette.exceptions import HTTPException as StarletteHTTPException, HTTPException


@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return HTMLResponse(content=open("frontend/browser/index.html").read())
    return await request.app.default_exception_handler(request, exc)


mcp.setup_server()
