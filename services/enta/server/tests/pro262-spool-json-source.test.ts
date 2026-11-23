import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('fresh spool requires unique JSON keys after bounded admission and preserves exact retries',()=>{
 const sql=readFileSync(resolve('services/enta/server/prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'),'utf8');
 const start=sql.indexOf('CREATE FUNCTION public.pro262_capacity_spool_commit('),end=sql.indexOf('END $$;',start);
 assert.ok(start>=0&&end>start);const body=sql.slice(start,end);
 const limit=body.indexOf('maxBodyBytes'),prior=body.indexOf('IF FOUND THEN IF prior."bodyDigest"'),charge=body.indexOf('Pro262CapacityControlCharge'),decode=body.indexOf("convert_from(v_body,'UTF8')"),unique=body.indexOf('IS NOT JSON OBJECT WITH UNIQUE KEYS'),cast=body.indexOf('v_request:=v_text::JSONB'),insert=body.indexOf('INSERT INTO public."Pro262CapacitySpool"');
 assert.ok(limit>=0&&limit<prior&&prior<charge&&charge<decode&&decode<unique&&unique<cast&&cast<insert);
 assert.match(sql,/PRO262_CAP_IMPLEMENTATION_INCOMPLETE/);
});
