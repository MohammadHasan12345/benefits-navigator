# Main root agent - orchestrates the full Benefits Navigator pipeline
import os
import asyncio
from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Load API key from .env file
load_dotenv()

# Import our three agents
from agents.intake_agent import intake_agent
from agents.research_agent import research_agent
from agents.eligibility_agent import eligibility_agent

# Root navigator agent that orchestrates the others
root_agent = Agent(
    name="benefits_navigator",
    model="gemini-2.5-flash",
    instruction="""
    You are the Benefits Navigator - a friendly assistant that helps New Jersey residents 
    find assistance programs they may qualify for.
    
    When a user describes their situation:
    1. Pass their message to the intake_agent to build a profile
    2. Pass that profile to the research_agent to find matching programs
    3. Pass the programs to the eligibility_agent to create an action checklist
    4. Present the final checklist to the user in a clear, encouraging way
    
    Always be warm, supportive and remind users that help is available.
    Start by greeting the user and asking them to describe their situation in their own words.
    """,
    sub_agents=[intake_agent, research_agent, eligibility_agent]
)

async def main():
    # Set up session and runner
    session_service = InMemorySessionService()
    
    runner = Runner(
        agent=root_agent,
        app_name="benefits_navigator",
        session_service=session_service
    )

    session_id = "user_session_1"
    user_id = "user_1"

    # Create session with await
    await session_service.create_session(
        app_name="benefits_navigator",
        user_id=user_id,
        session_id=session_id
    )

    print("Benefits Navigator is running...")
    print("Type your situation and press Enter. Type 'quit' to exit.\n")

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() == "quit":
            break
        if not user_input:
            continue

        content = types.Content(role="user", parts=[types.Part(text=user_input)])

        import time
        time.sleep(5)
        
        response_text = ""
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content
        ):
            if event.is_final_response():
                response_text = event.content.parts[0].text if event.content and event.content.parts else ""

        print(f"\nNavigator: {response_text}\n")

if __name__ == "__main__":
    asyncio.run(main())
