param([ValidateSet('web','huroof','auth','enta','admin')][string]$Service = 'web')
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$dataRoot = 'D:\projects\huroof_wa_oloof\local\almaidan'
$hostedMarkers = @('VERCEL','VERCEL_ENV','VERCEL_URL','AWS_LAMBDA_FUNCTION_NAME','K_SERVICE','FUNCTIONS_WORKER_RUNTIME','WEBSITE_SITE_NAME','FLY_APP_NAME','RENDER','RAILWAY_ENVIRONMENT','DYNO','NETLIFY')
if ($env:NODE_ENV -eq 'production' -or ($hostedMarkers | Where-Object { [Environment]::GetEnvironmentVariable($_) })) { throw 'Local startup is unavailable in hosted/production environments' }
Get-ChildItem Env: | Where-Object { $_.Name -match '^(VITE_|FIREBASE_|GOOGLE_|GCLOUD_|DATABASE_URL$|DIRECT_URL$|PAYMENT_|TAP_|MYFATOORAH_|ENTA_|LOCAL_DB_|LOCAL_CHALLENGE_|VERCEL|NETLIFY|RENDER|AWS_|K_SERVICE|DYNO)' } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
Remove-Item Env:ALMAIDAN_LOCAL_BUILD -ErrorAction SilentlyContinue
$env:NODE_ENV = 'development'
$env:FIREBASE_PROJECT_ID = 'demo-almaidan-local'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099'
$env:GCLOUD_PROJECT = 'demo-almaidan-local'
Set-Location -LiteralPath $appRoot
switch ($Service) {
  'web' {
    $env:VITE_GAME_RUNTIME='local'
    $env:VITE_USE_FIREBASE_EMULATORS='true'
    $env:VITE_FIREBASE_PROJECT_ID='demo-almaidan-local'
    $env:VITE_FIREBASE_AUTH_DOMAIN='demo-almaidan-local.firebaseapp.com'
    $env:VITE_FIREBASE_API_KEY='local-emulator-key'
    $env:VITE_FIREBASE_APP_ID='demo-almaidan-local'
    $env:VITE_FIREBASE_AUTH_EMULATOR_PORT='19099'
    $env:VITE_FIREBASE_FIRESTORE_EMULATOR_PORT='18080'
    $env:VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT='15001'
    $env:VITE_FIREBASE_STORAGE_EMULATOR_PORT='19199'
    $env:VITE_STATIC_PREVIEW='false'
    $env:VITE_ALLOW_LAN='false'
    $env:VITE_ALMAIDAN_LOCAL_ONLY='true'
    $env:VITE_ALMAIDAN_REAL_CONTENT='true'
    $env:LOCAL_GAME_SERVER_PORT='18787'
    $env:ENTA_API_PORT='14001'
    node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
  }
  'auth' {
    $authArgs=@('node_modules/firebase-tools/lib/bin/firebase.js','emulators:start','--only','auth','--project','demo-almaidan-local','--config',"$dataRoot\firebase.local.json",'--export-on-exit',"$dataRoot\auth-export")
    if (Test-Path -LiteralPath "$dataRoot\auth-export\firebase-export-metadata.json") { $authArgs+=@('--import',"$dataRoot\auth-export") }
    & node @authArgs
  }
  'huroof' {
    $env:ALMAIDAN_LOCAL_ONLY='true'
    $env:GAME_DB_PATH="$dataRoot\huroof.sqlite"
    $env:LOCAL_DB_QUESTION_SOURCE='saved-release'
    $env:LOCAL_CHALLENGE_ENABLED_MECHANICS='memory,missing_tile,navigation,word_search'
    $env:LOCAL_DB_TRUSTED_ORIGINS='http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:18787'
    $env:PORT='18787'
    $env:GAME_HOST='127.0.0.1'
    Set-Location -LiteralPath 'D:\projects\huroof_wa_oloof'
    node --import tsx "$appRoot\server\index.ts"
  }
  'admin' {
    $env:ALMAIDAN_LOCAL_ONLY='true'
    $env:ENTA_RUNTIME_MODE='local'
    $env:DATABASE_URL=(Get-Content -Raw -LiteralPath "$dataRoot\connection.private.json" | ConvertFrom-Json).databaseUrl
    node --import tsx --input-type=module -e "import { provisionLocalContentAdmin } from './services/enta/server/src/local-development/content-admin-identity.ts'; await provisionLocalContentAdmin();"
  }
  'enta' {
    $env:ALMAIDAN_LOCAL_ONLY='true'
    $env:ENTA_RUNTIME_MODE='local'
    $env:ALMAIDAN_REAL_CONTENT_PATH="$dataRoot\real-content.json"
    $env:DATABASE_URL=(Get-Content -Raw -LiteralPath "$dataRoot\connection.private.json" | ConvertFrom-Json).databaseUrl
    node --import tsx services/enta/server/src/local-development/main.ts
  }
}
exit $LASTEXITCODE
