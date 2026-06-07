import subprocess

git = r"C:\Program Files\Git\cmd\git.exe"
repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"

def run(args):
    result = subprocess.run([git] + args, cwd=repo, capture_output=True, text=True)
    print(result.stdout.strip())
    if result.stderr.strip():
        print("STDERR:", result.stderr.strip())
    return result.returncode

run(["add", "README.md", "USER_GUIDE.md", "DEVELOPER_GUIDE.md"])
rc = run(["commit", "-m",
    "docs: update README, USER_GUIDE, DEVELOPER_GUIDE to Build 33\n\n"
    "README.md:\n"
    "- Add Investor Relations to features table\n"
    "- Update Approvals description (now executes on approve)\n"
    "- Update Settings description (re-index, health monitoring)\n\n"
    "USER_GUIDE.md:\n"
    "- Bump header to Build 33\n"
    "- Add Investor Relations to features table + ToC\n"
    "- Add Investor Relations section\n"
    "- Update Settings > AI Engine section (Re-index, live health indicators)\n"
    "- Update System Health description\n\n"
    "DEVELOPER_GUIDE.md:\n"
    "- Bump header to Build 33\n"
    "- Infrastructure table: vector dims now provider-native (not hardcoded 768)\n"
    "- Repository structure: add services/agent/v2/ directory tree\n"
    "- LLM Router: remove silent Ollama fallback note (raises RuntimeError now)\n"
    "- Embedding Architecture: update to native dims; remove 768 hardcoded claim\n"
    "- Add full LangGraph v2 section (supervisor, 7 agents, BaseAgent, lc_tools)\n"
    "- WebSocket protocol: add agent_selected frame type\n"
    "- Database: document_chunks embedding column note updated\n"
    "- Settings Keys: correct defaults (anthropic/claude-sonnet-4-6/voyage/voyage-3) + new keys\n"
    "- Backend Routers table: add meetings, regulatory, briefings, updated endpoints\n"
    "- Migrations note: Vector(dim) not Vector(768)\n"
    "- Build Conventions: update example build number to 34\n"
    "- Known Issues: mark items 1 and 3 as resolved"
])
if rc == 0:
    push_rc = run(["push", "origin", "master"])
    print("Pushed" if push_rc == 0 else "Push failed")
else:
    print("Commit failed")
