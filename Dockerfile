FROM python:3.11.4-slim

WORKDIR /app

# Backend
COPY mvp_agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mvp_agent/. .

# Angular build
COPY frontend/dist/frontend ./frontend

ENV PORT=8080

CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8080"]