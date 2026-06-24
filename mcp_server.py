# MCP Server - searches NJ programs from our local data file
import json
import os
from pathlib import Path

def search_programs(category: str = "", keywords: str = "") -> str:
    """
    Search NJ assistance programs by category or keywords.
    
    Args:
        category: Type of help needed (food, housing, healthcare, utilities, childcare, legal, employment)
        keywords: Any additional keywords to search for
    
    Returns:
        JSON string of matching programs
    """
    # Load the programs data file
    data_path = Path(__file__).parent / "data" / "nj_programs.json"
    with open(data_path, "r") as f:
        programs = json.load(f)
    
    matches = []
    
    for program in programs:
        # Check if category matches
        category_match = category.lower() in program["category"].lower() if category else False
        
        # Check if any keywords match name, description, or eligibility
        keyword_match = False
        if keywords:
            search_text = f"{program['name']} {program['description']} {program['eligibility']}".lower()
            keyword_match = any(word.lower() in search_text for word in keywords.split())
        
        if category_match or keyword_match or (not category and not keywords):
            matches.append(program)
    
    if not matches:
        return json.dumps({"results": [], "message": "No programs found for this search"})
    
    return json.dumps({"results": matches, "count": len(matches)})