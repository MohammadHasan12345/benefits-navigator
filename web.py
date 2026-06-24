# Web server - serves the Benefits Navigator UI and bridges the browser to the agent pipeline
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Reuse the exact same orchestrator agent that powers the CLI
from main import root_agent

load_dotenv()

APP_NAME = "benefits_navigator"
STATIC_DIR = Path(__file__).parent / "static"

# Shared services live for the lifetime of the server process
session_service = InMemorySessionService()
runner = Runner(agent=root_agent, app_name=APP_NAME, session_service=session_service)

# Track which browser sessions we've already created on the ADK side
_known_sessions: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Benefits Navigator", lifespan=lifespan)


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str


async def _ensure_session(session_id: str) -> None:
    if session_id in _known_sessions:
        return
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=session_id,
        session_id=session_id,
    )
    _known_sessions.add(session_id)


@app.post("/api/chat")
async def chat(req: ChatRequest):
    session_id = req.session_id or uuid.uuid4().hex
    message = (req.message or "").strip()
    if not message:
        return JSONResponse({"error": "Please enter a message."}, status_code=400)

    try:
        await _ensure_session(session_id)
        content = types.Content(role="user", parts=[types.Part(text=message)])

        response_text = ""
        async for event in runner.run_async(
            user_id=session_id,
            session_id=session_id,
            new_message=content,
        ):
            if event.is_final_response() and event.content and event.content.parts:
                response_text = event.content.parts[0].text or ""

        return {"session_id": session_id, "reply": response_text}
    except Exception as exc:  # surface a friendly error to the UI
        return JSONResponse(
            {
                "session_id": session_id,
                "error": "The navigator hit a snag reaching the model. "
                "Please check your API key / quota and try again.",
                "detail": str(exc),
            },
            status_code=500,
        )


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


# Serve assets (the single-page app keeps everything inline, but this is here for growth)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("web:app", host="127.0.0.1", port=8000, reload=False)
