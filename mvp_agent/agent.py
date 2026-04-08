import json
import logging
import os
from typing import Annotated

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from google.adk.agents import Agent
from google.adk.auth import AuthConfig
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import ToolContext
from google.adk.tools.google_api_tool import GoogleApiToolset
from google.genai import types
from google.genai.types import FunctionCall
from starlette.responses import FileResponse, HTMLResponse
from starlette.staticfiles import StaticFiles

# Load environment variables from .env file
load_dotenv()

APP_NAME = "simplitasks"
auth_request_function_call_id = ""
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],  # Allows all headers in the request
)

client_id = str(os.getenv("CLIENT_ID"))
if not client_id:
    logging.error("CLIENT_ID not set")
client_secret = str(os.getenv("CLIENT_SECRET"))
if not client_secret:
    logging.error("CLIENT_SECRET not set")
google_toolset = GoogleApiToolset(api_name="tasks", api_version="v1",
                                  client_id=client_id,
                                  client_secret=client_secret)

google_toolset.get_auth_config()

response_prompt = """
    Respond to user:
    1. in valid JSON format
    2. in raw JSON format
    3. Do not wrap JSON in markdown or any other element
    4. do not include any explanations, preamble, or markdown formatting (e.g., no json blocks, just pure valid and raw JSON object)
    ---JSON schema
    {
        "response": -your own response,
        "tasks":
        [
            {
                "title": "string",
                "description": "string"
                "complexity": "string",
                "duration": "string",
                "dependency": "string",
                "risk": "string",
                "shouldTimeBlocked": bool,
            }
        ]
    }
    ---end of JSON schema
    Property details
    1. response (plain string) - contains your human-readable and engaging response
    2. tasks (list) - contains your proposed or final tasks - return empty list if no tasks generated
    Example:
    {
        "title": "string",
        "description": "string",
        "complexity": "string",
    }
    Verify if the generated JSON conforms to the above, otherwise make corrections to ensure it meets the criteria above.
"""


def add_prompt_to_state(
        tool_context: ToolContext, prompt: str
) -> dict[str, str]:
    """Saves the user's initial prompt to the state."""
    tool_context.state["PROMPT"] = prompt
    logging.info(f"[State updated] Added to PROMPT: {prompt}")
    return {"status": "success"}


task_creator_agent = Agent(
    model='gemini-2.5-flash',
    name='task_creator_agent',
    description='A helpful assistant for user questions.',
    instruction='''
    You're responsible for creating tasks in Google Tasks using 'google_toolset' tool.
    You have access to 'google_toolset' tool, for:
    1. tasks creation
    2. tasks deletion
    
    Tasks can be grabbed from ALL_TASKS data.
    To avoid issue related to missing/invalid task list ID, please first get the default task list id.
    The tool can only create a task at one time, so for each task please follow below steps:
    1. Prepare the information required before creating the task in Google Tasks:
        i. Title -  grab from task title
        ii. Details - refer DETAILS_FORMAT
    2. Create the task using the 'google_toolset' tool, into default task list
    3. Take note of the endpoint response. Refer ERROR_HANDLING
    4. Repeat the same steps for the next task
    
    Then, proceed to create all tasks, ensure that the original order/sequence is retained, into Google Tasks using 'google_toolset' tool as described above.
    In case of error when creating the tasks, refer ERROR_HANDLING.
    
    DETAILS_FORMAT:
    (Task description itself)
    Complexity: (complexity prop)
    Estimated duration: (duration prop)
    Dependency: (dependency prop)
    Risk: (risk prop)

    
    ERROR HANDLING:
    If error is general or transient, take note of them so we can collect the failed tasks and revert to user.
    If error is specific to authentication issue, immediately stop tasks creation loop and return "Error creating the tasks due to authentication issue. Please ensure you're logged in and retry".
    
    If successful:
    -If partial success, let the user knows which tasks were failed to create in google tasks.
    -Only respond with response message, do not include tasks
    -Respond back to user on the status of tasks creation, be conversational and engaging.

    ALL_TASKS:
    { response_data.tasks }
    
    When responding back to user, you need to follow below format:
    1. in valid JSON format
    2. in raw JSON format
    3. Do not wrap JSON in markdown or any other element
    4. do not include any explanations, preamble, or markdown formatting (e.g., no json blocks, just pure valid and raw JSON object)
    ---JSON schema
    {
        "response": -your own response,
        "tasks":
        [
            {
                "title": "string",
                "description": "string"
                "complexity": "string",
                "duration": "string",
                "dependency": "string",
                "risk": "string",
                "shouldTimeBlocked": bool,
            }
        ]
    }
    ---end of JSON schema
    Property details
    1. response (plain string) - contains your human-readable and engaging response
    2. tasks (list) - contains your proposed or final tasks - return empty list if no tasks generated
    Example:
    {
        "title": "string",
        "description": "string",
        "complexity": "string",
    }
    Verify if the generated JSON conforms to the above, otherwise make corrections to ensure it meets the criteria above.
    ''',
    tools=[google_toolset]
)

elaboration_agent = Agent(
    model='gemini-2.5-flash',
    name='elaboration_agent',
    description='A helpful assistant for user questions.',
    instruction='''

    You're an expert task planner that can turn complex and complicated idea or work into 
    smaller tasks. Your goal is to fully answer the user's PROMPT. Each task need to meet the following characteristics:
    - manageable
    - attainable
    - structured
    - in correct sequence
    - logical
    - high success rate
    
    Before you come up with the tasks break down, ask the user their preference on how large each task should be:
    - small - very granular task but can be too small
    - medium - not so small yet not so big (ideal)
    - large - higher level task, that the task may take longer time to complete
    
    Once granularity level is set, you are free to ask further questions related to
    the original idea or work. Be sure you understand their intent so cycle time is reduced.
    
    Then, you have a look at the generated tasks and adjust accordingly so that it meets the required
    characteristics described above. 
    Be aware of dependencies and prerequisites, failure in creating the steps in the correct order will impact the completion of overall tasks.
    Therefore, the tasks need to be in correct order based on the their priorities, dependencies and risks.
    
    Finally, you propose the user with the broken down tasks. At this point, user may have additional
    questions, amendments or even setting the granularity level, so follow accordingly. 
    Once user is happy with the proposed tasks, ask user on the next step:
        -ask if user would like to create the tasks into Google Tasks: 
            - if yes, store the response and final tasks into 'response_data', then transfer control to the 'task_creator_agent' agent
            - if no, ask user what else they want to do
    
    Populate each task details following below instruction:
        title: name of the task, keep it short and succinct
        description: brief description of the task (the WHAT and WHY) and the end goal
        complexity: (easy, medium, hard)
        duration: in minutes or days depending on granularity level
        dependency: lay out all dependencies this task depends on, separate each dependency by comm
        risk: short list of risks, separated by comma. Omit this property if there's no potential risk)
        shouldTimeBlocked: (0/1) whether the task should be time-blocked
        
    PROMPT:
    { PROMPT }
        
    When responding back to user, you need to follow below format:
    1. in valid JSON format
    2. in raw JSON format
    3. Do not wrap JSON in markdown or any other element
    4. do not include any explanations, preamble, or markdown formatting (e.g., no json blocks, just pure valid and raw JSON object)
    ---JSON schema
    {
        "response": -your own response,
        "tasks":
        [
            {
                "title": "string",
                "description": "string"
                "complexity": "string",
                "duration": "string",
                "dependency": "string",
                "risk": "string",
                "shouldTimeBlocked": bool,
            }
        ]
    }
    ---end of JSON schema
    Property details
    1. response (plain string) - contains your human-readable and engaging response
    2. tasks (list) - contains your proposed or final tasks - return empty list if no tasks generated
    Example:
    {
        "title": "string",
        "description": "string",
        "complexity": "string",
    }
    Verify if the generated JSON conforms to the above, otherwise make corrections to ensure it meets the criteria above.
    ''',
    output_key="response_data",
    sub_agents=[task_creator_agent]
)

greeter_instruction = f'''
    {response_prompt}
 
    - Greet user and tell them you''re here to help with task planning. Make it natural and engaging!
    - When the user responds, use the 'add_prompt_to_state' tool to save their response
    - After using the tool, transfer control to the 'elaboration_agent' agent
'''

root_agent = Agent(
    model='gemini-2.5-flash',
    name='root_agent',
    description='A helpful assistant for user questions.',
    instruction=greeter_instruction,
    tools=[add_prompt_to_state],
    sub_agents=[elaboration_agent]
)

session_service = InMemorySessionService()
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
        session = session_service.create_session_sync(app_name=APP_NAME, user_id=user_id, session_id=session_id)

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
                print("Agent response: ",final_response)
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
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return HTMLResponse(content=open("frontend/browser/index.html").read())
    return await request.app.default_exception_handler(request, exc)