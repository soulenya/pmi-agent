import subprocess, sys

git = r"C:\Program Files\Git\cmd\git.exe"
repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"

def run(args):
    result = subprocess.run([git] + args, cwd=repo, capture_output=True, text=True)
    print(result.stdout.strip())
    if result.stderr.strip():
        print("STDERR:", result.stderr.strip())
    return result.returncode

run(["add", "-A"])
rc = run(["commit", "-m", "Build 32: Phase 6 — LangGraph multi-agent system\n\n- Create services/agent/v2/ package with supervisor + 7 specialist agents\n- Supervisor routes via LLM classification to best specialist\n- BaseAgent: shared async tool-call streaming loop with LangChain bind_tools\n- lc_tools.py: LangChain @tool wrappers over existing dispatch_tool() — zero duplication\n- Feature flag llm.use_langgraph (default false) in system_settings\n- main.py WebSocket: if flag=true routes to LangGraphSupervisor, else v1 AgentExecutor\n- Added llm.use_langgraph to EXPOSED_KEYS + DEFAULTS in settings.py\n- Bump version.ts to Build 32; update CHANGELOG.md + ROADMAP.md"])
if rc == 0:
    push_rc = run(["push", "origin", "master"])
    if push_rc == 0:
        print("Pushed successfully")
    else:
        print("Push failed — manual push needed")
else:
    print("Commit failed")
