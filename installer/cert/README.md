# Little Gerry — Code Signing (internal trust)

This signs the Windows installer with a **self-signed certificate** so company
machines can trust Little Gerry as a known publisher. It removes the "unknown
publisher" warning and greatly reduces antivirus false positives **on machines
that have installed the public certificate**.

> This is the right approach for an **internal tool**. It does *not* make the
> installer trusted on the open internet — for that you need a paid code-signing
> certificate (e.g. Azure Trusted Signing, ~$120/yr). See `docs` for that path.

---

## One-time setup (you / the publisher)

1. **Create the certificate** (once):
   ```
   cd installer\cert
   powershell -NoProfile -ExecutionPolicy Bypass -File .\1-Create-Signing-Certificate.ps1
   ```
   This produces:
   - `LittleGerry-PublicCert.cer` — **public**, safe to share with teammates.
   - `LittleGerry-Signing.pfx` — **PRIVATE KEY. Keep secret. Never commit or email.**
     (Already gitignored.)

2. **Build the installer** as usual (`build-installer.bat`).

3. **Sign it**:
   ```
   cd installer\cert
   powershell -NoProfile -ExecutionPolicy Bypass -File .\2-Sign-LittleGerry.ps1
   ```

4. **Publish** the signed `installer\Output\LittleGerry_Setup.exe` to the GitHub release.
   Also publish the contents of `installer\cert\trust\` together with the public
   `.cer` so teammates can trust the publisher (see below).

---

## Each teammate (one-click, once per machine)

Give them a folder containing:
- `Trust Little Gerry.bat`
- `Install-Certificate.ps1`
- `LittleGerry-PublicCert.cer`   ← copy the public cert in here

They double-click **`Trust Little Gerry.bat`**, approve the admin prompt once,
and the publisher is trusted. After that, the signed installer runs normally.

> The `trust\` folder ships the batch + PowerShell. Drop the public `.cer`
> into it before zipping/sharing.

---

## Security notes

- The `.pfx` (private key) can sign software *as you*. Store it somewhere safe
  (password manager / secured share). If it ever leaks, delete the cert and
  re-issue.
- Importing into `LocalMachine\Root` means this certificate is trusted to vouch
  for software on that machine. Only distribute the `.cer` to machines you own /
  your company controls.
- The signature uses a trusted timestamp, so signed installers stay valid even
  after the 5-year certificate expires.
