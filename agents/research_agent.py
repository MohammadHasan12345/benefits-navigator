# Research Agent - finds matching NJ programs using the MCP server
from google.adk.agents import Agent
from google.adk.tools import FunctionTool
import sys
import os

# Import our search function from the MCP server
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from mcp_server import search_programs

# Wrap it as an ADK tool
search_tool = FunctionTool(search_programs)

research_agent = Agent(
    name="research_agent",
    model="gemini-2.5-flash",
    instruction="""
    You are a research assistant that finds NJ assistance programs for people in need.
    
    You will receive a profile summary from the intake agent.
    
    Your job:
    1. Look at the needs and keywords in the profile
    2. Use the search_programs tool to find matching programs
    3. Search by each category mentioned in the profile
    4. Return all matching programs you find
    
    Always search at least once. If the profile mentions multiple needs, search for each one.
    Return the raw list of programs you found so the eligibility agent can process them.
    """,
    tools=[search_tool]
)
