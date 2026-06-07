import subprocess, os
git = r"C:\Program Files\Git\cmd\git.exe"
repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"
# Remove this script before committing
script = os.path.join(repo, "_finish.py")

r1 = subprocess.run([git, "-C", repo, "status", "--short"], capture_output=True, text=True)
print("Status:", r1.stdout)

if r1.stdout.strip():
    r2 = subprocess.run([git, "-C", repo, "add", "-A"], capture_output=True, text=True)
    r3 = subprocess.run([git, "-C", repo, "commit", "-m", "chore: clean up temp scripts"], capture_output=True, text=True)
    r4 = subprocess.run([git, "-C", repo, "push"], capture_output=True, text=True)
    print(r3.stdout.strip() or r3.stderr.strip())
    print(r4.stdout.strip() or r4.stderr.strip())
else:
    print("Nothing to commit")
