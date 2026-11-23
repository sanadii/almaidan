import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strictJSON } from '../src/history-rematch/strict-json';

test('valid JSON, scalar roots and depth boundary retain JSON.parse semantics',()=>{
 for(const text of ['null','-0','1.25e-3','"\\ud800"',' {"a":[true,false,null,"x\\n"]} ','[[[[[[[[0]]]]]]]]'])
  assert.deepEqual(strictJSON(text,4096),JSON.parse(text));
});

test('rejects malformed grammar, trailing data and decoded duplicate keys',()=>{
 for(const text of ['{"a":1,"\\u0061":2}','{"x":{"a":1,"\\u0061":2}}','{"a":1,}','[1,]','{"a" 1}','[01]','1e','1.','truex','true false','"\\x20"','"\\u12x4"','"\n"','\u00a0null','{"x":'])
  assert.throws(()=>strictJSON(text,4096),SyntaxError,text);
});

test('requires a finite nonnegative integer byte bound',()=>{
 for(const limit of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>strictJSON('0',limit),SyntaxError);
 assert.equal(strictJSON('"é"',4),'é');assert.throws(()=>strictJSON('"é"',3),SyntaxError);
});

test('overdepth and duplicate keys are rejected before whole-document parsing',()=>{
 const original=JSON.parse;const calls:string[]=[];
 JSON.parse=((text:string,...args:unknown[])=>{calls.push(text);return original(text,...args as []);}) as typeof JSON.parse;
 try {
  for(const text of ['[[[[[[[[[0]]]]]]]]]','{"a":1,"\\u0061":2}']) {
   calls.length=0;assert.throws(()=>strictJSON(text,4096),SyntaxError);assert.ok(!calls.includes(text));
  }
 } finally { JSON.parse=original; }
});
