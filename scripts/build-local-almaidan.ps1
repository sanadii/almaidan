param([switch]$Serve,[switch]$SkipBuild)
$ErrorActionPreference='Stop'
$appRoot=Split-Path $PSScriptRoot -Parent
$hostedMarkers=@('VERCEL','VERCEL_ENV','VERCEL_URL','AWS_LAMBDA_FUNCTION_NAME','K_SERVICE','FUNCTIONS_WORKER_RUNTIME','WEBSITE_SITE_NAME','FLY_APP_NAME','RENDER','RAILWAY_ENVIRONMENT','DYNO','NETLIFY')
if($hostedMarkers|Where-Object{[Environment]::GetEnvironmentVariable($_)}){throw 'Local builds cannot run in hosted environments'}
$savedLocalBuildEnvironment=@{}
Get-ChildItem Env: | ForEach-Object{$savedLocalBuildEnvironment[$_.Name]=$_.Value}
try {
# Local bundle configuration is explicit; no .env file or inherited client value is consumed.
Get-ChildItem Env: | Where-Object{$_.Name -match '^(VITE_|FIREBASE_|GOOGLE_|GCLOUD_|DATABASE_URL$|DIRECT_URL$|PAYMENT_|TAP_|MYFATOORAH_|ENTA_|LOCAL_DB_|LOCAL_CHALLENGE_)'} | ForEach-Object{Remove-Item -LiteralPath ('Env:'+$_.Name)}
$env:NODE_ENV='production'
$env:ALMAIDAN_LOCAL_BUILD='true'
$env:ALMAIDAN_LOCAL_ONLY='true'
$env:GAME_HOST='127.0.0.1'
$env:FIREBASE_PROJECT_ID='demo-almaidan-local'
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
$env:VITE_ALMAIDAN_LOCAL_BUILD='true'
$env:VITE_ALMAIDAN_REAL_CONTENT='true'
$env:LOCAL_GAME_SERVER_PORT='18787'
$env:ENTA_API_PORT='14001'
Set-Location -LiteralPath $appRoot
if(-not $SkipBuild){
 & node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 & node node_modules/vite/bin/vite.js build --mode almaidan-local
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}
if($Serve){
 if(-not(Test-Path -LiteralPath 'D:\projects\huroof_wa_oloof\local\almaidan\web-build\index.html')){throw 'Build the local artifact before serving'}
 & node node_modules/vite/bin/vite.js preview --mode almaidan-local --host 127.0.0.1 --port 5175 --strictPort
 exit $LASTEXITCODE
}

} finally {
 # Restore the invoking shell after build/preview exits; do not leave production or local markers behind.
 Get-ChildItem Env: | Where-Object{-not $savedLocalBuildEnvironment.ContainsKey($_.Name)} | ForEach-Object{Remove-Item -LiteralPath ('Env:'+$_.Name)}
 foreach($environmentKey in $savedLocalBuildEnvironment.Keys){[Environment]::SetEnvironmentVariable($environmentKey,$savedLocalBuildEnvironment[$environmentKey],'Process')}
}
