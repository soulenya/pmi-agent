import subprocess
git = r"C:\Program Files\Git\cmd\git.exe"
repo = r"c:\Users\Morgan\Documents\VS Code\PMI Agent"
r1 = subprocess.run([git, "-C", repo, "add", "-A"], capture_output=True, text=True)
r2 = subprocess.run([git, "-C", repo, "commit", "-m", "chore: remove temp helper scripts"], capture_output=True, text=True)
r3 = subprocess.run([git, "-C", repo, "push"], capture_output=True, text=True)
print(r2.stdout.strip() or r2.stderr.strip())
print(r3.stdout.strip() or r3.stderr.strip())
