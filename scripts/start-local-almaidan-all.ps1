param([switch]$SkipAdminRestore)
$ErrorActionPreference='Stop'
$hostedMarkers=@('VERCEL','VERCEL_ENV','VERCEL_URL','AWS_LAMBDA_FUNCTION_NAME','K_SERVICE','FUNCTIONS_WORKER_RUNTIME','WEBSITE_SITE_NAME','FLY_APP_NAME','RENDER','RAILWAY_ENVIRONMENT','DYNO','NETLIFY')
if ($env:NODE_ENV -eq 'production' -or ($hostedMarkers | Where-Object { [Environment]::GetEnvironmentVariable($_) })) { throw 'Local startup is unavailable in hosted/production environments' }
$stateRoot='D:\projects\huroof_wa_oloof\local\almaidan'
$container=docker inspect almaidan-local-20261104 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $container.Name -ne '/almaidan-local-20261104' -or $container.Config.Image -ne 'postgres:16.15-bookworm') { throw 'Expected isolated local database container is missing' }
$binding=$container.HostConfig.PortBindings.'5432/tcp'
if ($binding.HostIp -ne '127.0.0.1' -or $binding.HostPort -ne '15439') { throw 'Unexpected local database binding' }
$mount=$container.Mounts | Where-Object Destination -eq '/var/lib/postgresql/data'
$mountPath=$mount.Source.Replace('\','/').ToLowerInvariant().Replace('/run/desktop/mnt/host/d/','d:/')
if ($mount.Type -ne 'bind' -or $mountPath -ne 'd:/projects/huroof_wa_oloof/local/almaidan/postgres' -or $container.Config.Env -notcontains 'POSTGRES_DB=almaidan') { throw 'Unexpected database storage identity' }
if (-not $container.State.Running) { docker start almaidan-local-20261104 | Out-Null }
# A listening container can still be replaying WAL after an interrupted shutdown.
# Wait for PostgreSQL itself before launching APIs; never reset its saved data.
$databaseUserEntry=@($container.Config.Env | Where-Object { $_ -like 'POSTGRES_USER=*' })
if ($databaseUserEntry.Count -ne 1) { throw 'Expected local database user is missing' }
$databaseUser=$databaseUserEntry[0].Substring('POSTGRES_USER='.Length)
$databaseReady=$false
for ($attempt=0; $attempt -lt 120; $attempt++) {
  docker exec almaidan-local-20261104 pg_isready -q -U $databaseUser -d almaidan 2>$null
  if ($LASTEXITCODE -eq 0) { $databaseReady=$true; break }
  Start-Sleep -Seconds 1
}
if (-not $databaseReady) { throw 'Isolated PostgreSQL is not ready; saved data was left untouched. Inspect the existing container logs.' }
foreach($item in @(@('auth',19099),@('huroof',18787),@('enta',14001),@('web',5174))) {
  $name=$item[0]; $port=$item[1]
  $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listener) {
    $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    $expected=@{auth='firebase-tools.*emulators:start.*demo-almaidan-local';huroof='D:\\projects\\huroof_wa_oloof\\server\\index\.ts';enta='local-development.main.ts';web='vite.bin.vite.js'}[$name]
    if ($listener.LocalAddress -ne '127.0.0.1' -or $process.CommandLine -notmatch $expected) { throw "Port $port belongs to an unexpected process" }
    Write-Output "$name is already listening on $port"; continue
  }
  Start-Process pwsh -WindowStyle Hidden -ArgumentList '-NoProfile','-File',"$PSScriptRoot\start-local-almaidan.ps1",'-Service',$name -RedirectStandardOutput "$stateRoot\$name.log" -RedirectStandardError "$stateRoot\$name-error.log"
}
foreach($endpoint in @('http://127.0.0.1:19099/','http://127.0.0.1:18787/health','http://127.0.0.1:14001/api/v1/health','http://127.0.0.1:5174/')) {
  $ready=$false
  if ($endpoint -eq 'http://127.0.0.1:18787/health') {
    # Loading retained local archives has taken approximately 108 seconds.
    $timer=[System.Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 180) {
      try { $response=Invoke-WebRequest -Uri $endpoint -TimeoutSec 2; if($response.StatusCode -eq 200){$ready=$true;break} } catch {}
      if ($timer.Elapsed.TotalSeconds -lt 180) { Start-Sleep -Milliseconds 500 }
    }
  } else {
    for($attempt=0;$attempt -lt 30;$attempt++) {
      try { $response=Invoke-WebRequest -Uri $endpoint -TimeoutSec 2; if($response.StatusCode -eq 200){$ready=$true;break} } catch {}
      Start-Sleep -Milliseconds 500
    }
  }
  if(-not $ready){throw "Local service did not become ready: $endpoint. Check $stateRoot logs."}
}
# Restore only the separately saved local admin identity after emulator import.
# Existing account identity is validated; accounts and passwords are never changed.
if (-not $SkipAdminRestore) { & pwsh -NoProfile -File "$PSScriptRoot\start-local-almaidan.ps1" -Service admin
if ($LASTEXITCODE -ne 0) { throw 'Local admin identity provisioning failed; existing accounts were not reset' } }
Write-Output 'Almaidan local URL: http://127.0.0.1:5174/'
