<#
.SYNOPSIS
    Create the hub's company brain (GBrain) again, keeping its pages in the
    database alone, and reconnect the hub's API to it.

.DESCRIPTION
    A brain created by an image older than 0.60.734.0-2 also writes each page
    to a folder in its container's volume and will not start without it, and
    it cannot be converted. Storing conversations needs a database-only brain
    (docs/GBRAIN.md, "Conversations in the brain"), so that one has to be
    created again. This does it, one checked step at a time, and stops with
    the reason at the first thing that is not as it should be:

      look -> build and push the image -> point the VM at it -> back up ->
      remove the old brain (container, volume, database) -> bring-up ->
      check it is database-only -> new token into the gbrain-mcp-token
      secret -> bring-up -> check the API reaches the brain

    Everything in the old brain is discarded, tokens included, so it refuses
    to touch a brain that holds anything unless -DiscardContents is given.
    A step already done is skipped, so it can be run again after a stop.

    Coordinates come from brand/brand.json, as in deploy-hub.ps1. Requires a
    signed-in gcloud, and Docker running when the image is not yet pushed.

.PARAMETER Tag
    Tag for the GBrain image, e.g. 0.60.734.0-2. Built from gbrain/ and pushed
    unless the registry already has it.

.PARAMETER CheckOnly
    Say what the brain is like and what would be done. Changes nothing.

.PARAMETER DiscardContents
    Go ahead even though the brain holds facts or pages. They are lost.

.EXAMPLE
    .\scripts\hub\recreate-gbrain.ps1 -Tag 0.60.734.0-2 -CheckOnly
    .\scripts\hub\recreate-gbrain.ps1 -Tag 0.60.734.0-2
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [switch]$CheckOnly,
    [switch]$DiscardContents,
    [string]$BrandFile = ""
)

$ErrorActionPreference = "Stop"

function Stop-Run([string]$Message) {
    Write-Host ""
    Write-Host "  [STOP] $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Find-Tool([string]$Name, [string[]]$Fallbacks = @()) {
    # -CommandType Application skips the SDK's gcloud.ps1, which turns stderr
    # notices into terminating errors.
    $cmd = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    foreach ($p in $Fallbacks) { if (Test-Path $p) { return $p } }
    Stop-Run "$Name was not found. Install it or put it on PATH."
}

function Pick($Value, [string]$Default) {
    if ($null -ne $Value -and "$Value" -ne "") { "$Value" } else { $Default }
}

function Step([string]$Text) { Write-Host "  $Text" -ForegroundColor Cyan }

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $BrandFile) { $BrandFile = Join-Path $root "brand\brand.json" }
$b = if (Test-Path $BrandFile) { Get-Content $BrandFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$project   = Pick $b.gcp.project "pmi-littlegerry-hub"
$zone      = Pick $b.gcp.zone "us-central1-a"
$vm        = Pick $b.gcp.hub_vm "hub"
$region    = Pick $b.gcp.region "us-central1"
$registry  = Pick $b.gcp.registry "$region-docker.pkg.dev"
$imageRepo = Pick $b.gcp.image_repo "littlegerry"
$dbSuper   = Pick $b.db.superuser "pmi"
$apiCtr    = Pick $b.db.api_container "pmi_api"
$pgCtr     = Pick $b.db.postgres_container "pmi_postgres"
$imageBase = "$registry/$project/$imageRepo/gbrain"
$image     = "${imageBase}:$Tag"
$secret    = "gbrain-mcp-token"
$tokenName = "littlegerry-hub"

if ($Tag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { Stop-Run "'$Tag' is not a valid image tag." }

$gcloud = Find-Tool "gcloud" @((Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"))

function Remote([string]$Script) {
    # Base64 keeps quoting out of the way; the VM decodes and runs as root.
    # Returns what the script printed. Lines starting "TOKEN " are never shown.
    $body = $Script.Replace('{pg}', $pgCtr).Replace('{su}', $dbSuper).Replace('{api}', $apiCtr).Replace('{name}', $tokenName)
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($body.Replace("`r`n", "`n")))
    $lines = @(& $gcloud compute ssh $vm --project $project --zone $zone --quiet --command="echo $b64 | base64 -d | sudo bash" |
        ForEach-Object { "$_".TrimEnd() })
    $code = $LASTEXITCODE
    $lines | Where-Object { $_ -and $_ -notmatch '^(STATE|TOKEN) ' } | ForEach-Object { Write-Host "    $_" }
    if ($code -ne 0) { Stop-Run "A step on the VM failed (exit $code). Nothing after it was done; see the lines above." }
    return $lines
}

function Read-State($Lines) {
    $state = @{}
    foreach ($line in $Lines) {
        if ($line -match '^STATE (\w+)=(.*)$') { $state[$Matches[1]] = $Matches[2].Trim() }
    }
    return $state
}

function Test-Quiet([scriptblock]$Command) {
    # A "not found" answer arrives on stderr; under "Stop" Windows PowerShell
    # would turn that redirected line into a terminating error.
    $ErrorActionPreference = "Continue"
    & $Command *> $null
    return ($LASTEXITCODE -eq 0)
}

# What the brain is like now. Reads only.
$look = @'
if docker inspect gbrain >/dev/null 2>&1; then
  echo "STATE container=$(docker inspect gbrain --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  echo "STATE image=$(docker inspect gbrain --format '{{.Config.Image}}')"
  if src=$(docker exec gbrain gbrain sources list --json 2>/dev/null) && echo "$src" | grep -q '"sources"'; then
    echo "STATE folders=$(echo "$src" | grep -cE '"local_path": *"')"
  else
    echo "STATE folders=unknown"
  fi
else
  echo "STATE container=absent"
  echo "STATE folders=unknown"
fi
if [ "$(docker exec {pg} psql -U {su} -d postgres -tAc "select 1 from pg_database where datname = 'gbrain'")" = 1 ]; then
  if c=$(docker exec {pg} psql -U {su} -d gbrain -tAc "select (select count(*) from facts) || '|' || (select count(*) from pages where deleted_at is null)" 2>/dev/null) && [ -n "$c" ]; then
    echo "STATE contents=$c"
  else
    echo "STATE contents=unknown"
  fi
else
  echo "STATE contents=none"
fi
if docker exec {api} python -c "import asyncio; from services import company_brain as b; assert b.configured(); asyncio.run(b.recall('anything'))" >/dev/null 2>&1; then
  echo "STATE api=ok"
else
  echo "STATE api=no"
fi
'@

# The first start creates the whole schema before the brain answers.
$wait = @'
for i in $(seq 1 100); do
  s=$(docker inspect gbrain --format '{{.State.Health.Status}}' 2>/dev/null || true)
  [ "$s" = healthy ] && break
  sleep 3
done
if [ "$s" != healthy ]; then
  echo "gbrain is '${s:-absent}', not healthy. Its last lines:"
  docker logs --tail 15 gbrain 2>&1 || true
  exit 1
fi
echo "gbrain: healthy"
'@

# The VM's own bring-up, exactly as a reboot runs it, then wait for the brain.
$bringUp = @'
echo "== bring-up (a few minutes)"
google_metadata_script_runner startup >/dev/null 2>&1 || true
grep -E "gbrain" /var/log/hub-startup.log | tail -2
'@ + "`n" + $wait

$remove = @'
set -e
echo "== backup"
bash /opt/littlegerry/scripts/backup.sh 2>&1 | tail -1
echo "== remove the old brain"
docker rm -f gbrain >/dev/null 2>&1 || true
for v in $(docker volume ls -q --filter label=com.docker.compose.volume=gbrain_data); do
  docker volume rm "$v" >/dev/null
  echo "removed volume $v"
done
docker exec {pg} psql -q -U {su} -d postgres -c "DROP DATABASE IF EXISTS gbrain WITH (FORCE)"
echo "removed database gbrain"
'@

$mint = @'
docker exec gbrain gbrain auth revoke {name} >/dev/null 2>&1 || true
t=$(docker exec gbrain gbrain auth create {name} --scopes read,write 2>&1 | grep -oE 'gbrain_[a-f0-9]{32,}' | head -1)
if [ -z "$t" ]; then echo "GBrain did not print a token"; exit 1; fi
echo "TOKEN $t"
'@

function Format-Contents([string]$Contents) {
    switch ($Contents) {
        "none"    { "no database" }
        "unknown" { "something that could not be counted" }
        default   { $n = $Contents -split '\|'; "$($n[0]) fact(s), $($n[1]) page(s)" }
    }
}

function Show-State($State) {
    $storage = switch ($State.folders) {
        "0"       { "database only" }
        "unknown" { "unknown (the brain is not answering)" }
        default   { "database and a folder in its volume" }
    }
    Write-Host "    container : $($State.container)$(if ($State.image) { "  ($($State.image -replace '^.*/', ''))" })"
    Write-Host "    storage   : $storage"
    Write-Host "    holds     : $(Format-Contents $State.contents)"
    Write-Host "    API       : $(if ($State.api -eq 'ok') { 'reaches the brain' } else { 'does not reach the brain' })"
}

Write-Host ""
Step "Company brain on $vm ($project/$zone)"
$state = Read-State (Remote $look)
Show-State $state

# A brain that answers with no folder is the one wanted, even while it is
# still starting; anything else is created again.
$isDbOnly  = ($state.folders -eq "0")
$isEmpty   = ($state.contents -in @("none", "0|0"))
$hasImage  = Test-Quiet { & $gcloud artifacts docker images describe $image --project $project }
$pointedAt = "$(& $gcloud compute instances describe $vm --project $project --zone $zone '--format=value(metadata.items.gbrain-image)')".Trim()
$hasSecret = Test-Quiet { & $gcloud secrets describe $secret --project $project }

if (-not $hasSecret) {
    Stop-Run "The secret $secret does not exist. This brain was never connected; follow 'Connect Little Gerry' in docs\GBRAIN.md instead."
}
if (-not $isDbOnly) {
    if ($state.image -eq $image) {
        Stop-Run "The brain that keeps a folder was created by $Tag itself. Give a new -Tag so an image with the current entrypoint is built."
    }
    if (-not $isEmpty -and -not $DiscardContents) {
        $hint = if ($state.container -eq "absent") {
            " Its container is not there: if it was database-only already, the VM's bring-up (step 4 of 'Turn it on' in docs\GBRAIN.md) brings it back with everything in it."
        } else { "" }
        Stop-Run "The brain holds $(Format-Contents $state.contents), and creating it again discards that. Nothing was changed.$hint To discard it, add -DiscardContents."
    }
}

$plan = @()
if (-not $isDbOnly) {
    if (-not $hasImage) { $plan += "build and push $image" }
    if ($pointedAt -ne $image) { $plan += "point the VM at $Tag" }
    $plan += "back up, then remove the brain's container, volume and database"
    $plan += "bring-up; check the new brain is database-only"
}
if (-not $isDbOnly -or $state.api -ne "ok") {
    $plan += "mint a token, store it as a new version of $secret, bring-up"
    $plan += "check the API reaches the brain"
}

Write-Host ""
if (-not $plan) {
    Step "Nothing to do: the brain is database-only and the API reaches it."
    Write-Host ""
    exit 0
}
Step "To do:"
$plan | ForEach-Object { Write-Host "    - $_" }
if ($CheckOnly) {
    Write-Host ""
    Step "-CheckOnly: nothing was changed."
    Write-Host ""
    exit 0
}

if (-not $isDbOnly) {
    if (-not $hasImage) {
        Write-Host ""
        Step "Building and pushing $image"
        $docker = Find-Tool "docker"
        & $docker buildx build --platform linux/amd64 -t $image --push (Join-Path $root "gbrain")
        if ($LASTEXITCODE -ne 0) { Stop-Run "The image did not build or push. Nothing on the hub was changed." }
        if (-not (Test-Quiet { & $gcloud artifacts docker images describe $image --project $project })) {
            Stop-Run "The push reported success but $image is not in the registry. Nothing on the hub was changed."
        }
    }
    if ($pointedAt -ne $image) {
        Write-Host ""
        Step "Pointing the VM at $Tag"
        & $gcloud compute instances add-metadata $vm --project $project --zone $zone "--metadata=gbrain-image=$image" | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-Run "Could not set gbrain-image on the VM. Nothing else was changed." }
    }

    Write-Host ""
    Step "Removing the old brain"
    # Looked at again on the VM, in case something was recorded since.
    $again = Read-State (Remote $look)
    if ($again.contents -notin @("none", "0|0") -and -not $DiscardContents) {
        Stop-Run "The brain now holds $(Format-Contents $again.contents). Nothing was removed."
    }
    Remote $remove | Out-Null

    Write-Host ""
    Step "Starting the new one"
    Remote $bringUp | Out-Null
    $state = Read-State (Remote $look)
    if ($state.folders -ne "0") {
        Show-State $state
        Stop-Run "The new brain is not database-only. It is empty and running; check that gbrain\entrypoint.sh in this checkout runs 'gbrain init' with --db-only, then run this again with a new -Tag."
    }
    Write-Host "    database-only: yes"
}

if ($state.api -ne "ok") {
    Write-Host ""
    Step "Reconnecting the API"
    Remote $wait | Out-Null
    $token = Remote $mint | Where-Object { $_ -match '^TOKEN ' } | ForEach-Object { $_.Substring(6).Trim() } | Select-Object -First 1
    if (-not $token) { Stop-Run "No token came back from the VM. Run this again; it picks up from here." }
    $tmp = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($tmp, $token)
        & $gcloud secrets versions add $secret --project $project "--data-file=$tmp" | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-Run "Could not store the token in $secret. Run this again; it mints a fresh one." }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        $token = $null
    }
    Write-Host "    token stored as a new version of $secret"
    Remote $bringUp | Out-Null
    # The API container is replaced by the bring-up; give it time to answer.
    for ($i = 0; $i -lt 6; $i++) {
        $state = Read-State (Remote $look)
        if ($state.api -eq "ok") { break }
        Start-Sleep -Seconds 10
    }
}

Write-Host ""
Step "Now"
Show-State $state
if ($state.folders -ne "0" -or $state.api -ne "ok") {
    Stop-Run "Not finished: see the lines above. It is safe to run this again."
}
Write-Host ""
Write-Host "  Done. The brain keeps its pages in the database alone and the API reaches it." -ForegroundColor Green
Write-Host ""
