import {createHash} from 'node:crypto';
import {firebaseAdminVerifier} from '../services/enta/server/src/firebase-verifier.js';
import {principalFromClaims,type IdTokenVerifier} from '../services/enta/server/src/identity.js';
import {assertLocalRealContent} from './local-release-question-source.js';
import {LocalRoomPreparationError,type AuthoritativeGameService} from './service.js';
import type {CreateRoomRequest} from '../src/features/game/runtime/contracts.js';
export class LocalRoomCreationError extends Error{constructor(public status:number,code:string){super(code);}}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
export async function localVerifiedHost(authorization:string|undefined,verify?:IdTokenVerifier){
 assertLocalRealContent();if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:19099')throw new LocalRoomCreationError(503,'LOCAL_AUTH_EMULATOR_REQUIRED');
 if(!authorization?.startsWith('Bearer ')||authorization.length>16384)throw new LocalRoomCreationError(401,'LOCAL_HOST_AUTHENTICATION_REQUIRED');
 let principal;try{principal=principalFromClaims(await (verify??firebaseAdminVerifier('demo-almaidan-local'))(authorization.slice(7)),'demo-almaidan-local');}catch{throw new LocalRoomCreationError(401,'LOCAL_HOST_AUTHENTICATION_REQUIRED');}
 if(!principal.verifiedAccount||principal.anonymous)throw new LocalRoomCreationError(403,'LOCAL_VERIFIED_HOST_REQUIRED');
 return principal;
}
export async function createLocalOwnedRoom(service:AuthoritativeGameService,authorization:string|undefined,input:unknown,verify?:IdTokenVerifier){
 const principal=await localVerifiedHost(authorization,verify);
 const allowed=['requestKey','displayName','demo','bestOf','questionSeconds','opponentSeconds','teams','categories','modality','gameKind','difficulty','mode','showQuestionOnAudience','labelledColours','mapPresentation','challenge'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||Buffer.byteLength(JSON.stringify(input))>32768)throw new LocalRoomCreationError(400,'LOCAL_CREATE_REQUEST_INVALID');
 const body=input as CreateRoomRequest;
 if(typeof body.requestKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestKey)||body.demo!==true||body.displayName!==undefined&&(typeof body.displayName!=='string'||!body.displayName.trim()||body.displayName.length>60||/[<>\x00-\x1f\x7f]/.test(body.displayName)))throw new LocalRoomCreationError(400,'LOCAL_CREATE_REQUEST_INVALID');
 const hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
 try{return service.createLocalOwned(principal.uid,body.requestKey,hash,body.displayName?.trim()??'المضيف',body);}
 catch(error){if(error instanceof Error&&error.message==='LOCAL_CREATE_KEY_CONFLICT')throw new LocalRoomCreationError(409,error.message);if(error instanceof LocalRoomPreparationError)throw new LocalRoomCreationError(422,error.reason);throw new LocalRoomCreationError(503,'LOCAL_CREATE_UNAVAILABLE');}
}
