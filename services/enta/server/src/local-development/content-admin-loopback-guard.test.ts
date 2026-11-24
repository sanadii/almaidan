import test from 'node:test';
import assert from 'node:assert/strict';
import {isLocalAdminPath,mustRestrictLocalAdmin} from '../../../../../server/local-admin-guard';

const pathname=(value:string)=>new URL(value,'http://local.test').pathname;

// The Vite dev proxy forwards /api/v1/* to the Enta local API. With VITE_ALLOW_LAN the content admin
// must still be loopback-only, including the case/encoding variants Express routes would accept.
test('loopback guard covers the proxied local content admin API',()=>{
 for(const value of ['/api/v1/local-admin/session','/api/v1/local-admin/revisions/r1/activate','/api//v1/local-admin/drafts','/api/v1/LOCAL-ADMIN/session','/API/V1/Local-Admin/questions','/api/v1/local%2Dadmin/session','/api/rooms/../v1/local-admin/session']){
  assert.equal(isLocalAdminPath(pathname(value)),true,value);
  assert.equal(mustRestrictLocalAdmin(pathname(value),'192.168.8.22'),true,value);
  assert.equal(mustRestrictLocalAdmin(pathname(value),'127.0.0.1'),false,value);
 }
});

test('loopback guard leaves player-facing v1 routes and malformed escapes alone',()=>{
 for(const value of ['/api/v1/health','/api/v1/rooms/join','/api/v1/local-admins','/api/v1/history','/api/v1/%E0%A4%A']){
  assert.equal(isLocalAdminPath(pathname(value)),false,value);
 }
});
