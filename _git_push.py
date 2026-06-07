import subprocess
import os

# Find git
git_paths = [
    r"C:\Program Files\Git\cmd\git.exe",
    r"C:\Program Files\Git\bin\git.exe",
    r"C:\Program Files (x86)\Git\cmd\git.exe",
]

git_exe = None
for p in git_paths:
    if os.path.exists(p):
        git_exe = p
        break

if not git_exe:
    print("git not found in common paths")
    import glob
    found = glob.glob(r"C:\**\git.exe", recursive=True)
    print("Found:", found[:5])
else:
    print("git found at:", git_exe)
    repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"
    
    r = subprocess.run([git_exe, '-C', repo, 'add', '-A'], capture_output=True, text=True)
    print("add:", r.stdout, r.stderr)
    
    msg = "feat: Phase 4 -- Settings UI: model dropdowns, re-index modal, live health panel (Build 30)"
    r2 = subprocess.run([git_exe, '-C', repo, 'commit', '-m', msg], capture_output=True, text=True)
    print("commit:", r2.stdout, r2.stderr)
    
    r3 = subprocess.run([git_exe, '-C', repo, 'push'], capture_output=True, text=True)
    print("push:", r3.stdout, r3.stderr)
