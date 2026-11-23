import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import type {Keyring} from '../favorites/cursor';
import {assertLocalDevelopment} from './guard';
/** A dedicated local cursor key: never overwrite or print an existing key. */
export async function localFavoritesKey():Promise<Keyring>{
 assertLocalDevelopment();const path='D:/projects/huroof_wa_oloof/local/almaidan/favorites-cursor.private';
 try{await writeFile(path,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
 const value=await readFile(path,'utf8');if(!/^[a-f0-9]{64}$/.test(value))throw Error('LOCAL_FAVORITES_KEY_INVALID');
 return {active:'local-v1',keys:new Map([['local-v1',{bytes:Buffer.from(value,'hex'),issueUntil:8640000000000000-930000,verifyUntil:8640000000000000}]])};
}
