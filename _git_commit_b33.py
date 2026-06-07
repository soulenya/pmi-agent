import subprocess

git = r"C:\Program Files\Git\cmd\git.exe"
repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"

def run(args):
    result = subprocess.run([git] + args, cwd=repo, capture_output=True, text=True)
    print(result.stdout.strip())
    if result.stderr.strip():
        print("STDERR:", result.stderr.strip())
    return result.returncode

run(["add", "-A"])
rc = run(["commit", "-m",
    "Build 33: Phase 7 — Advanced Features\n\n"
    "- Fix meetings.py _llm_summarize db bug (was NameError at runtime)\n"
    "- New InvestorPage.tsx: company snapshot, reg doc registry, AI draft, research feed, IR chat\n"
    "- Add /investor route in App.tsx\n"
    "- Add Investor Relations nav item in Sidebar.tsx (TrendingUp icon)\n"
    "- Mark all Phase 7 tasks [x] in ROADMAP.md\n"
    "- Bump version.ts to Build 33; update CHANGELOG.md"
])
if rc == 0:
    push_rc = run(["push", "origin", "master"])
    print("Pushed" if push_rc == 0 else "Push failed")
else:
    print("Commit failed")
