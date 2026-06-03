; ============================================================
;  Little Gerry — Windows Installer
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
#define AppVersion    "1.0.0"
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

; Install directory — per-user to avoid UAC friction
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
DisableProgramGroupPage=yes

; Output
OutputDir=Output
OutputBaseFilename=LittleGerry_Setup
SetupIconFile=
Compression=lzma2/ultra64
SolidCompression=yes
InternalCompressLevel=ultra64

; Appearance
WizardStyle=modern
WizardResizable=no
WizardSizePercent=120

; Privileges — request admin so Docker/winget installs work
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Misc
ShowLanguageDialog=no
LanguageDetectionMethod=locale
UninstallDisplayIcon={app}\installer\uninstall_icon.ico
CloseApplications=yes
RestartIfNeededByRun=yes
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";    Description: "Create a &desktop shortcut";      GroupDescription: "Additional icons:"; Flags: checked
Name: "startmenuicon";  Description: "Create a &Start Menu entry";       GroupDescription: "Additional icons:"; Flags: checked
Name: "runonstartup";   Description: "Launch Little Gerry on &Windows startup"; GroupDescription: "Startup:"; Flags: unchecked

; ── Files to install ────────────────────────────────────────────────────────
; NOTE: The source paths below are relative to this .iss file (installer\).
;       Adjust if you move the .iss or build from a different working directory.
[Files]
; Root scripts and launchers
Source: "..\Install Little Gerry.bat";  DestDir: "{app}"; Flags: ignoreversion
Source: "..\Start Little Gerry.bat";    DestDir: "{app}"; Flags: ignoreversion
Source: "..\Stop Little Gerry.bat";     DestDir: "{app}"; Flags: ignoreversion
Source: "..\docker-compose.yml";        DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md";                 DestDir: "{app}"; Flags: ignoreversion
Source: "..\.gitignore";               DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Backend
Source: "..\backend\*"; DestDir: "{app}\backend"; \
    Excludes: "*.pyc,__pycache__,*.egg-info,.venv,*.log"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; Frontend source (without node_modules — npm install runs during setup)
Source: "..\frontend\*"; DestDir: "{app}\frontend"; \
    Excludes: "node_modules,dist,src-tauri\target"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

; Scripts
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Shortcuts ───────────────────────────────────────────────────────────────
[Icons]
; Desktop shortcut
Name: "{autodesktop}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    Comment: "{#AppDescription}"; \
    Tasks: desktopicon

; Start Menu
Name: "{autoprograms}\{#AppName}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    Comment: "{#AppDescription}"; \
    Tasks: startmenuicon

Name: "{autoprograms}\{#AppName}\Stop {#AppName}"; \
    Filename: "{app}\Stop Little Gerry.bat"; \
    WorkingDir: "{app}"; \
    Comment: "Stop all Little Gerry services"; \
    Tasks: startmenuicon

Name: "{autoprograms}\{#AppName}\Uninstall {#AppName}"; \
    Filename: "{uninstallexe}"; \
    Tasks: startmenuicon

; Startup entry (optional)
Name: "{autostartup}\{#AppName}"; \
    Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    Tasks: runonstartup

; ── Run setup script after install ──────────────────────────────────────────
[Run]
; Run the PowerShell install script to set up all dependencies
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install.ps1"" -ProjectRoot ""{app}"""; \
    WorkingDir: "{app}"; \
    Flags: runhidden waituntilterminated; \
    StatusMsg: "Installing dependencies and configuring Little Gerry (this may take 10-20 minutes)..."; \
    Description: "Run setup (installs Docker, Ollama, Python deps, DB migrations, AI models)"

; Offer to launch immediately after install
Filename: "{app}\{#AppExeName}"; \
    WorkingDir: "{app}"; \
    Flags: nowait postinstall skipifsilent; \
    Description: "Launch {#AppName} now"

; ── Uninstall cleanup ────────────────────────────────────────────────────────
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

; ── Custom wizard pages ──────────────────────────────────────────────────────
[Code]
// Display a pre-install info page summarising what will be downloaded/installed.
procedure InitializeWizard;
begin
  // Nothing custom needed — standard Inno wizard is sufficient.
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Warn the user on the final confirmation page that the setup takes time
  if CurPageID = wpReady then begin
    if MsgBox(
      'The installer will now download and configure:' + Chr(13)+Chr(10) +
      '  - Docker Desktop (~500 MB)' + Chr(13)+Chr(10) +
      '  - Ollama + AI models (~2.5 GB)' + Chr(13)+Chr(10) +
      '  - Python, Node.js, and app dependencies (~500 MB)' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'Internet access is required. Estimated time: 10-30 minutes.' + Chr(13)+Chr(10) +
      Chr(13)+Chr(10) +
      'Continue?',
      mbConfirmation, MB_YESNO) = IDNO
    then
      Result := False;
  end;
end;
