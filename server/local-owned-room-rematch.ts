import {createHash} from 'node:crypto';
import {LocalRoomPreparationError,type AuthoritativeGameService} from './service.js';
import {localVerifiedHost,LocalRoomCreationError} from './local-owned-room-creation.js';
import type {IdTokenVerifier} from '../services/enta/server/src/identity.js';
export async function createLocalOwnedRematch(service:AuthoritativeGameService,authorization:string|undefined,hostCapability:string|undefined,predecessorRoomId:string,input:unknown,verify?:IdTokenVerifier){
 const principal=await localVerifiedHost(authorization,verify);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(predecessorRoomId)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'requestKey'))throw new LocalRoomCreationError(400,'LOCAL_CREATE_REQUEST_INVALID');
 const key=(input as {requestKey:unknown}).requestKey;if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(key))throw new LocalRoomCreationError(400,'LOCAL_CREATE_REQUEST_INVALID');
 if(!hostCapability||hostCapability.length>4096)throw new LocalRoomCreationError(403,'LOCAL_REMATCH_HOST_REQUIRED');
 const hash=createHash('sha256').update(JSON.stringify({operation:'LOCAL_REMATCH',predecessorRoomId,requestKey:key})).digest('hex');
 try{return service.createLocalRematch(principal.uid,key,hash,predecessorRoomId,hostCapability);}
 catch(error){if(error instanceof Error&&error.message==='LOCAL_REMATCH_HOST_REQUIRED')throw new LocalRoomCreationError(403,error.message);if(error instanceof Error&&error.message==='LOCAL_CREATE_KEY_CONFLICT')throw new LocalRoomCreationError(409,error.message);if(error instanceof LocalRoomPreparationError&&error.reason==='LOCAL_REMATCH_NOT_FINISHED')throw new LocalRoomCreationError(409,error.reason);if(error instanceof LocalRoomPreparationError)throw new LocalRoomCreationError(422,'LOCAL_CREATE_SETUP_UNAVAILABLE');throw new LocalRoomCreationError(503,'LOCAL_CREATE_UNAVAILABLE');}
}
