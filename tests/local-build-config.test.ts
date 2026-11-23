import test from 'node:test';
import assert from 'node:assert/strict';
import configuration from '../vite.config.js';
import {HOSTED_RUNTIME_MARKERS} from '../services/enta/server/src/config-policy.js';
test('isolated optimized local build has exact guards, no env files, fixed private output',()=>{
 const original={...process.env};
 try{
  for(const key of [...HOSTED_RUNTIME_MARKERS,'NETLIFY',...Object.keys(process.env).filter(k=>k.startsWith('VITE_'))])delete process.env[key];
  Object.assign(process.env,{NODE_ENV:'production',ALMAIDAN_LOCAL_BUILD:'true',ALMAIDAN_LOCAL_ONLY:'true',GAME_HOST:'127.0.0.1',FIREBASE_PROJECT_ID:'demo-almaidan-local',VITE_ALMAIDAN_LOCAL_ONLY:'true',VITE_FIREBASE_PROJECT_ID:'demo-almaidan-local',VITE_USE_FIREBASE_EMULATORS:'true',VITE_GAME_RUNTIME:'local',VITE_ALLOW_LAN:'false'});
  const config=()=> (configuration as Function)({command:'build',mode:'almaidan-local',isPreview:false});
  const result=config();assert.equal(result.envDir,false);assert.equal(result.build.outDir,'D:/projects/huroof_wa_oloof/local/almaidan/web-build');assert.equal(result.preview.host,'127.0.0.1');assert.equal(result.preview.port,5175);
  for(const marker of [...HOSTED_RUNTIME_MARKERS,'NETLIFY']){process.env[marker]='1';assert.throws(config,/ISOLATED_LOCAL_BUILD_CONFIGURATION_REQUIRED/);delete process.env[marker];}
  for(const [key,value] of [['GAME_HOST','0.0.0.0'],['VITE_FIREBASE_PROJECT_ID','production'],['VITE_USE_FIREBASE_EMULATORS','false'],['VITE_ALLOW_LAN','true'],['ALMAIDAN_LOCAL_BUILD','false']]){const previous=process.env[key];process.env[key]=value;assert.throws(config,/ISOLATED_LOCAL_BUILD_CONFIGURATION_REQUIRED/);process.env[key]=previous;}
  assert.throws(()=> (configuration as Function)({command:'build',mode:'production',isPreview:false}),/ISOLATED_LOCAL_BUILD_CONFIGURATION_REQUIRED/);
  delete process.env.ALMAIDAN_LOCAL_BUILD;
  assert.throws(()=> (configuration as Function)({command:'build',mode:'production',isPreview:false}),/HOSTED_MOCK_OR_EMULATOR_FORBIDDEN/);
 }finally{for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
