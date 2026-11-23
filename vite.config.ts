import { APPROVED_HOSTED_PROJECT, HOSTED_RUNTIME_MARKERS, assertHostedControls, isHosted, validNamespace } from './services/enta/server/src/config-policy.js';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isLocalAdminPath, isLoopbackAddress } from './server/local-admin-guard.js';

export default defineConfig(({ command, mode, isPreview }) => {
  const localBuildRequested=mode==='almaidan-local'||process.env.ALMAIDAN_LOCAL_BUILD==='true';
  const localBuild=mode==='almaidan-local'&&process.env.ALMAIDAN_LOCAL_BUILD==='true'&&process.env.ALMAIDAN_LOCAL_ONLY==='true'&&process.env.GAME_HOST==='127.0.0.1'&&process.env.VITE_ALMAIDAN_LOCAL_ONLY==='true'&&process.env.VITE_FIREBASE_PROJECT_ID==='demo-almaidan-local'&&process.env.FIREBASE_PROJECT_ID==='demo-almaidan-local'&&process.env.VITE_USE_FIREBASE_EMULATORS==='true'&&process.env.VITE_GAME_RUNTIME==='local'&&process.env.VITE_ALLOW_LAN==='false'&&!HOSTED_RUNTIME_MARKERS.some(k=>Boolean(process.env[k]))&&!process.env.NETLIFY;
  if(localBuildRequested&&!localBuild)throw Error('ISOLATED_LOCAL_BUILD_CONFIGURATION_REQUIRED');
  if(process.env.VITE_ALMAIDAN_LOCAL_BUILD==='true'&&!localBuild)throw Error('ISOLATED_LOCAL_BUILD_CONFIGURATION_REQUIRED');
  const isolatedLocal = localBuild||(command === 'serve' && process.env.VITE_ALMAIDAN_LOCAL_ONLY === 'true' && process.env.VITE_FIREBASE_PROJECT_ID === 'demo-almaidan-local' && !isHosted(process.env));
  const environment = isolatedLocal ? Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key.startsWith('VITE_') && typeof value === 'string')) as Record<string, string> : loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && isHosted(process.env) && !localBuild) {
    assertHostedControls({ ...process.env, ...environment });
    if (environment.VITE_GAME_RUNTIME !== 'firebase' || environment.VITE_USE_FIREBASE_EMULATORS !== 'false') throw new Error('Hosted builds require the live Firebase runtime');
    if (!validNamespace(process.env.ENTA_NAMESPACE_ID?.trim() ?? '')) throw new Error('Hosted builds require a valid namespace');
    const serverProjectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? '';
    const clientProjectId = environment.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
    if (!serverProjectId || !clientProjectId) {
      throw new Error('Hosted production builds require FIREBASE_PROJECT_ID and VITE_FIREBASE_PROJECT_ID');
    }
    if (serverProjectId !== APPROVED_HOSTED_PROJECT || clientProjectId !== APPROVED_HOSTED_PROJECT) {
      throw new Error('Hosted production builds require the approved Firebase project');
    }
    if (serverProjectId !== clientProjectId) {
      throw new Error('VITE_FIREBASE_PROJECT_ID must match FIREBASE_PROJECT_ID in hosted production builds');
    }
  }
  const lanEnabled = environment.VITE_ALLOW_LAN === 'true';
  const configuredRuntime =
    process.env.VITE_GAME_RUNTIME ?? environment.VITE_GAME_RUNTIME;
  const localGameServerPort = process.env.LOCAL_GAME_SERVER_PORT ?? '8787';
  const localFirestoreMode = process.env.LOCAL_DB_QUESTION_SOURCE === 'firestore-import';
  const localDevRuntime =
    command === 'serve' && mode !== 'test' && !isPreview && !configuredRuntime
      ? { 'import.meta.env.VITE_GAME_RUNTIME': JSON.stringify('local') }
      : {};
  return {
    envDir: isolatedLocal ? false : undefined,
    define: {...localDevRuntime,'import.meta.env.VITE_ALMAIDAN_LOCAL_BUILD':JSON.stringify(localBuild?'true':'false')},
    ...(localBuild?{build:{outDir:'D:/projects/huroof_wa_oloof/local/almaidan/web-build',emptyOutDir:false,sourcemap:false},preview:{host:'127.0.0.1',port:5175,strictPort:true,allowedHosts:['127.0.0.1','localhost'],proxy:{'/api/v1':{target:'http://127.0.0.1:14001',changeOrigin:true},'/api':{target:'http://127.0.0.1:18787',changeOrigin:true},'/ws':{target:'ws://127.0.0.1:18787',ws:true}}}}:{}),
    plugins: [
      react(),
      {
        name: 'local-admin-loopback-guard',
        configurePreviewServer(server){
          if(!localBuild)return;
          server.httpServer.prependListener('upgrade',(request,socket)=>{
            if(!isLoopbackAddress(request.socket.remoteAddress)||!['127.0.0.1:5175','localhost:5175'].includes(request.headers.host??'')||!['http://127.0.0.1:5175','http://localhost:5175'].includes(request.headers.origin??''))socket.destroy();
          });
          server.middlewares.use((request,response,next)=>{
            if(!isLoopbackAddress(request.socket.remoteAddress)||!['127.0.0.1:5175','localhost:5175'].includes(request.headers.host??'')||(request.headers.origin&&!['http://127.0.0.1:5175','http://localhost:5175'].includes(request.headers.origin))){response.writeHead(403);response.end('LOCAL_ONLY');return;}
            if(request.url==='/__local_health'){
              void Promise.all([fetch('http://127.0.0.1:14001/api/v1/health',{signal:AbortSignal.timeout(3000)}),fetch('http://127.0.0.1:18787/health',{signal:AbortSignal.timeout(3000)})]).then(results=>{const ready=results.every(r=>r.ok);response.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({localOnly:true,ready,build:'almaidan-local'}));}).catch(()=>{response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({localOnly:true,ready:false}));});return;
            }
            next();
          });
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname;
            const parts = pathname.split('/').filter(Boolean);
            const dbSensitivePath = pathname === '/api/question-inventory' || (parts[0] === 'api' && parts[1] === 'rooms');
            if (!isLoopbackAddress(request.socket.remoteAddress) && (isLocalAdminPath(pathname) || (localFirestoreMode && dbSensitivePath))) {
              response.writeHead(403, { 'content-type': 'application/json' });
              response.end(JSON.stringify({ error: 'LOCAL_ONLY_ADMIN' }));
              return;
            }
            next();
          });
        },
      },
    ],
    server: {
      host: lanEnabled ? true : 'localhost',
      proxy: {
        '/api/v1': { target: `http://127.0.0.1:${process.env.ENTA_API_PORT ?? '4001'}`, changeOrigin: true },
        '/api': `http://127.0.0.1:${localGameServerPort}`,
        '/ws': { target: `ws://127.0.0.1:${localGameServerPort}`, ws: true },
      },
      watch: {
        // Generated authoring evidence and browser artifacts are not application inputs.
        // Ignoring them avoids full-reload churn while other work writes those directories.
        ignored: ['**/content/question-bank-v3/staging/**', '**/local/almaidan/**', '**/output/**', '**/old_app/**'],
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/app/setup.ts'],
      include: ['tests/app/**/*.test.tsx'],
    },
  };
});
