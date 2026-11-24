import test from 'node:test';
import assert from 'node:assert/strict';
import {disabledCategoryKeys,enabledCategories,isCategoryDisabled,replaceDisabledCategories,setCategoryDisabledInMemory} from './category-availability';
import {currentLocalCategories,selectedLocalCategories} from './catalogue';

test('disabled categories leave new-setup catalogues and come back when re-enabled',()=>{
 // Works for practice content and, under the local launcher env, the saved real release.
 const before=currentLocalCategories().map(c=>c.key),target=selectedLocalCategories()[0].key;
 try{
  setCategoryDisabledInMemory(target,true);
  assert.equal(isCategoryDisabled(target),true);
  assert.deepEqual(currentLocalCategories().map(c=>c.key),before.filter(key=>key!==target));
  assert.equal(selectedLocalCategories().some(c=>c.key===target),false);
  setCategoryDisabledInMemory(target,false);
  assert.deepEqual(currentLocalCategories().map(c=>c.key),before);
 }finally{replaceDisabledCategories([]);}
});

test('the availability set is replaced atomically and filters any keyed rows',()=>{
 try{
  replaceDisabledCategories(['b','a']);
  assert.deepEqual(disabledCategoryKeys(),['a','b']);
  assert.deepEqual(enabledCategories([{key:'a'},{key:'c'}]),[{key:'c'}]);
  replaceDisabledCategories([]);
  assert.deepEqual(enabledCategories([{key:'a'}]),[{key:'a'}]);
 }finally{replaceDisabledCategories([]);}
});
