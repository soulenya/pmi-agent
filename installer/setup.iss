; ============================================================
;  Little Gerry â€” Windows Installer
;  Precisian Medical Instruments / VACTOR Program
;
;  Compile with Inno Setup 6:
;    iscc.exe installer\setup.iss
;
;  Output: installer\Output\LittleGerry_Setup.exe
;
;  The resulting .exe:
;   - Copies all application source to the install directory
;   - Runs the PowerShell setup script (install.ps1)
;   - Creates a desktop shortcut and Start Menu entry
;   - Registers an uninstaller
; ============================================================

#define AppName       "Little Gerry"
#define AppPublisher  "Precisian Medical Instruments"
#define AppVersion    "3.2.30"
#define AppURL        "https://github.com/soulenya/pmi-agent"
#define AppExeName    "Start Little Gerry.bat"
#define AppDescription "AI Executive Assistant for the VACTOR Program"

[Setup]
; Metadata
AppId={{F4A2B7C1-3D8E-4F6A-92B5-1E7D3C9A0F28}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppDescription}

; Install directory - user-writable so app can create .venv, node_modules, .env
DefaultDirName={localappdata}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
DisableProgramGroupPage=yes

; Output
OutputDir=Output
OutputBaseFilename=LittleGerry_Setup
SetupIconFile=LittleGerry.ico
Compression=lzma2/ultra64
SolidCompression=yes
InternalCompressLevel=ultra64

; Appearance
WizardStyle=modern
WizardResizable=no
WizardSizePercent=120

; Privileges - admin needed to run install.ps1 (winget/Docker), but app dir is user-writable
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Misc
ShowLanguageDialog=no
LanguageDetectionMethod=locale
UninstallDisplayIcon={app}\installer\LittleGerry.ico
CloseApplications=yes
RestartIfNeededByRun=yes
MinVersion=10.0
; Wipe app dir on reinstall (preserves .venv and node_modules which are large)
; but removes stale files that would otherwise cause MoveFile conflicts
CreateUninstallRegKey=yes
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
; Make the standard "Finished" wizard page clearly state success
FinishedHeadingLabel=Little Gerry was installed successfully
FinishedLabelNoIcons=Setup has finished installing Little Gerry on your computer. Prerequisites are configured. The first launch will finish setting things up (2-5 minutes) before the app window appears.
FinishedLabel=Setup has finished installing Little Gerry on your computer. Prerequisites are configured. The first launch will finish setting things up (2-5 minutes) before the app window appears.

[Tasks]
Name: "desktopicon";    Description: "Create a &desktop shortcut";   GroupDescription: "Additional icons:"
Name: "startmenuicon";  Description: "Create a &Start Menu entry";   GroupDescription: "Additional icons:"
Name: "runonstartup";   Description: "Launch Little Gerry on &Windows startup"; GroupDescription: "Startup:"; Flags: unchecked

; â”€â”€ Files to install â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
; NOTE: The source paths below are relative to this .iss file (installer\).
;       Adjust if you move the .iss or build from a different working directory.
[Files]
; Root scripts and launchers
Source: "..\Install Little Gerry.bat";      DestDir: "{app}"; Flags: ignoreversion
Source: "..\Start Little Gerry.bat";        DestDir: "{app}"; Flags: ignoreversion
Source: "..\Stop Little Gerry.bat";         DestDir: "{app}"; Flags: ignoreversion
Source: "..\Update Little Gerry.bat";       DestDir: "{app}"; Flags: ignoreversion
Source: "..\docker-compose.yml";            DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md";                     DestDir: "{app}"; Flags: ignoreversion
Source: "..\launcher.py";                   DestDir: "{app}"; Flags: ignoreversion
Source: "..\Spaceman on Black BG.png";      DestDir: "{app}"; Flags: ignoreversion
Source: "..\.gitignore";                   DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; google_credentials.json (OAuth client secret) is intentionally NOT bundled —
; users add it after installing (see docs/INSTALL.md "Google OAuth credentials").
Source: "..\VERSION";                       DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\update_token.txt";              DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Icon â€” used by installer .exe and all shortcuts
Source: "LittleGerry.ico";             DestDir: "{app}\installer"; Flags: ignoreversion skipifsourcedoesntexist

; Backend
Source: "..\backend\*"; DestDir: "{app}\backend"; \
    Excludes: "*.pyc,__pycache__,*.egg-info,.venv,*.log,google_token.json,google_credentials.json,google_stt_sa.json,.env"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; Frontend source (without node_modules â€” npm install runs during setup)
Source: "..\frontend\*"; DestDir: "{app}\frontend"; \
    Excludes: "node_modules,dist,src-tauri\target"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; Scripts
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs

; â”€â”€ Shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
[Icons]
; Desktop shortcut
Name: "{autodesktop}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\installer\LittleGerry.ico"; \
    Comment: "{#AppDescription}"; \
    Tasks: desktopicon

; Start Menu
Name: "{autoprograms}\{#AppName}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\installer\LittleGerry.ico"; \
    Comment: "{#AppDescription}"; \
    Tasks: startmenuicon

Name: "{autoprograms}\{#AppName}\Stop {#AppName}"; \
    Filename: "{app}\Stop Little Gerry.bat"; \
    WorkingDir: "{app}"; \
    Comment: "Stop all Little Gerry services"; \
    Tasks: startmenuicon

Name: "{autoprograms}\{#AppName}\Update {#AppName}"; \
    Filename: "{app}\Update Little Gerry.bat"; \
    WorkingDir: "{app}"; \
    Comment: "Pull latest version from GitHub"; \
    Tasks: startmenuicon

Name: "{autoprograms}\{#AppName}\Uninstall {#AppName}"; \
    Filename: "{uninstallexe}"; \
    Tasks: startmenuicon

; Startup entry (optional)
Name: "{autostartup}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\installer\LittleGerry.ico"; \
    Tasks: runonstartup

; â”€â”€ Run setup script after install â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
[Run]
; Install winget prerequisites (Docker, Ollama, Python, Node) via install.ps1
; NOTE: uv sync / npm install / migrations run on first launch via Start bat
;       because they need the user's PATH, not the elevated installer context.
; skipifsilent: the unattended auto-update (/VERYSILENT) skips this winget pass.
;       Prerequisites are already present on an existing install, and re-running
;       winget headlessly is slow and was returning a spurious exit code 1.
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -ProjectRoot ""{app}"""; \
    WorkingDir: "{app}"; \
    Flags: waituntilterminated skipifsilent; \
    StatusMsg: "Installing prerequisites (Docker, Ollama, Python, Node.js)..."; \
    Description: "Install prerequisites via winget"

; Offer to launch immediately after install
Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    Flags: nowait postinstall skipifsilent; \
    Description: "Launch {#AppName} now"

; â”€â”€ Uninstall cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
[UninstallRun]
; Stop all services before uninstalling
Filename: "{app}\Stop Little Gerry.bat"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "StopServices"

; Stop and remove the Docker PostgreSQL container
Filename: "cmd.exe"; \
    Parameters: "/c cd /d ""{app}"" && docker compose down -v"; \
    Flags: runhidden waituntilterminated; \
    RunOnceId: "DockerDown"

[UninstallDelete]
; Remove the install directory entirely after uninstall
Type: filesandordirs; Name: "{app}"

; â”€â”€ Pre-install cleanup (removes stale files before overwrite) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
[InstallDelete]
; Remove old scripts folder so installer can write fresh copies without conflict
Type: filesandordirs; Name: "{app}\scripts"
; Remove old root-level bat/py/yml files so they are replaced cleanly
Type: files; Name: "{app}\*.bat"
Type: files; Name: "{app}\*.py"
Type: files; Name: "{app}\*.yml"

; â”€â”€ Custom wizard pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
[Code]
// Display a pre-install info page summarising what will be downloaded/installed.
procedure InitializeWizard;
begin
  // Nothing custom needed â€” standard Inno wizard is sufficient.
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Warn the user on the final confirmation page that the setup takes time.
  // SuppressibleMsgBox auto-answers IDYES under /SILENT or /SUPPRESSMSGBOXES
  // (e.g. the unattended auto-update), so it never blocks a headless install.
  if CurPageID = wpReady then begin
    if SuppressibleMsgBox(
      'The installer will now download and configure:' + Chr(13)+Chr(10) +
      '  - Docker Desktop (~500 MB)' + Chr(13)+Chr(10) +
      '  - Ollama + AI models (~2.5 GB)' + Chr(13)+Chr(10) +
      '  - Python, Node.js, and app dependencies (~500 MB)' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'Internet access is required. Estimated time: 10-30 minutes.' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'Continue?',
      mbConfirmation, MB_YESNO, IDYES) = IDNO
    then
      Result := False;
  end;
end;

// Show an explicit "install succeeded" popup once files are copied and
// prerequisites have run, just before the Finished page is displayed.
// MUST be SuppressibleMsgBox: a plain MsgBox() is NOT suppressed by
// /SUPPRESSMSGBOXES and would block the detached, headless auto-update
// (apply_update.ps1 -Wait) forever, so the app would never relaunch.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    SuppressibleMsgBox(
      'Little Gerry was installed successfully!' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'When you launch it, a setup window will finish preparing the app ' +
      '(about 2-5 minutes on first run). After that it opens automatically ' +
      'and starts on its own every time from then on.' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'Use the desktop shortcut or Start Menu entry to open Little Gerry.',
      mbInformation, MB_OK, IDOK);
  end;
end;





















































































































