import type {AuthoritativeGameService} from './service.js';
import type {IdTokenVerifier} from '../services/enta/server/src/identity.js';
import {localVerifiedHost,LocalRoomCreationError} from './local-owned-room-creation.js';
export async function localOwnerRoomAccess(service:AuthoritativeGameService,authorization:string|undefined,roomId:string,verify?:IdTokenVerifier){
 const principal=await localVerifiedHost(authorization,verify);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(roomId))throw new LocalRoomCreationError(400,'LOCAL_ROOM_ID_INVALID');
 try{return service.localOwnerAccess(principal.uid,roomId);}catch(error){if(error instanceof Error&&error.message==='LOCAL_OWNED_ROOM_NOT_FOUND')throw new LocalRoomCreationError(404,error.message);throw new LocalRoomCreationError(503,'LOCAL_OWNER_ACCESS_UNAVAILABLE');}
}
