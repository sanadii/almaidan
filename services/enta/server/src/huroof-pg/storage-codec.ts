import type { CanonicalRoom } from "../../../../../functions/src/game.js";

type Operation = "award" | "continue";
type StorageBridge = {activeOccurrence:string;selectedCellId:string;appliedEncoding:"utf8-hex-v1";applied:Record<string,Operation>};
export type StoredRoom = Omit<CanonicalRoom,"challengeBridge"> & {challengeBridge?:StorageBridge};
const fail=():never=>{throw new Error("ROOM_STORAGE_UNAVAILABLE");};
const ownRecord=(value:unknown):value is Record<string,unknown>=>{
 if(!value || typeof value!=="object" || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return false;
 return Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>"value" in d && d.enumerable);
};
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>ownRecord(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
function scalar(value:unknown,max:number):value is string {
 if(typeof value!=="string" || !value.length || value.length>max || /[\u0000-\u001f\u007f]/.test(value)) return false;
 for(let i=0;i<value.length;i++) {const code=value.charCodeAt(i);if(code>=0xd800 && code<=0xdbff){if(i+1>=value.length || value.charCodeAt(i+1)<0xdc00 || value.charCodeAt(i+1)>0xdfff) return false;i++;}else if(code>=0xdc00 && code<=0xdfff) return false;}
 return true;
}
function keyParts(key:string):[string,string] {
 const at=key.indexOf("\0");if(at<1 || at!==key.lastIndexOf("\0")) return fail();
 const occurrence=key.slice(0,at),cell=key.slice(at+1);if(!scalar(occurrence,180) || !scalar(cell,128)) return fail();return [occurrence,cell];
}
function bridgeBase(value:unknown,stored:boolean):{activeOccurrence:string;selectedCellId:string;applied:Record<string,unknown>} {
 if(!exact(value,stored?["activeOccurrence","selectedCellId","appliedEncoding","applied"]:["activeOccurrence","selectedCellId","applied"]) || !scalar(value.activeOccurrence,180) || !scalar(value.selectedCellId,128) || !ownRecord(value.applied) || (stored && value.appliedEncoding!=="utf8-hex-v1")) return fail();
 return value as {activeOccurrence:string;selectedCellId:string;applied:Record<string,unknown>};
}
function validOperation(value:unknown):value is Operation {return value==="award" || value==="continue";}
function bounded(value:unknown):void {let raw:string;try {raw=JSON.stringify(value);}catch{return fail();}if(typeof raw!=="string" || Buffer.byteLength(raw,"utf8")>262144) return fail();}

/** Only the known private bridge changes representation; all caller objects are left untouched. */
export function encodeStoredRoom(room:CanonicalRoom):StoredRoom {
 if(!ownRecord(room)) return fail();
 if(!Object.hasOwn(room,"challengeBridge")) return room as StoredRoom;
 const bridge=bridgeBase(room.challengeBridge,false),applied=Object.create(null) as Record<string,Operation>;
 for(const [key,operation] of Object.entries(bridge.applied)) {keyParts(key);if(!validOperation(operation)) return fail();const encoded=Buffer.from(key,"utf8").toString("hex");if(encoded.length>1850 || Object.hasOwn(applied,encoded)) return fail();applied[encoded]=operation;}
 const output={...room,challengeBridge:{activeOccurrence:bridge.activeOccurrence,selectedCellId:bridge.selectedCellId,appliedEncoding:"utf8-hex-v1" as const,applied}};bounded(output);return output as StoredRoom;
}

/** Reads do not rewrite old empty maps; subsequent writes normalize them. */
export function decodeStoredRoom(room:unknown):CanonicalRoom {
 if(!ownRecord(room)) return fail();
 if(!Object.hasOwn(room,"challengeBridge")) return room as unknown as CanonicalRoom;
 bounded(room);
 const raw=room.challengeBridge;if(!ownRecord(raw)) return fail();
 if(!Object.hasOwn(raw,"appliedEncoding")) {const bridge=bridgeBase(raw,false);if(Object.keys(bridge.applied).length) return fail();return {...room,challengeBridge:{activeOccurrence:bridge.activeOccurrence,selectedCellId:bridge.selectedCellId,applied:Object.create(null)}} as unknown as CanonicalRoom;}
 const bridge=bridgeBase(raw,true),applied=Object.create(null) as Record<string,Operation>;
 for(const [hex,operation] of Object.entries(bridge.applied)) {
  if(hex.length<6 || hex.length>1850 || hex.length%2!==0 || !/^[0-9a-f]+$/.test(hex) || !validOperation(operation)) return fail();
  const bytes=Buffer.from(hex,"hex");let key:string;try {key=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);} catch {return fail();}
  if(Buffer.from(key,"utf8").toString("hex")!==hex) return fail();keyParts(key);if(Object.hasOwn(applied,key)) return fail();applied[key]=operation;
 }
 return {...room,challengeBridge:{activeOccurrence:bridge.activeOccurrence,selectedCellId:bridge.selectedCellId,applied}} as unknown as CanonicalRoom;
}
