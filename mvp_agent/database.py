import logging
import os

from dotenv import load_dotenv
from sqlmodel import SQLModel, Session, create_engine

load_dotenv()
db_connection_string = str(os.getenv("DB_CONN_STRING"))
if not db_connection_string:
    logging.error("DB_CONN_STRING not set")

DATABASE_URL = db_connection_string

engine = create_engine(DATABASE_URL, echo=True)

def get_db_session():
    with Session(engine) as session:
        yield session