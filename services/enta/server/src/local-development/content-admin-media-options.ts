import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {originalRealContent} from './real-content';
import {isYouTubeMediaDescriptor,youtubeDescriptorBytes} from '../../../../../src/features/game/runtime/youtube-media';
type Descriptor={type:string;mediaId:string;assetSha256:string;contentType:string;altAr:string};
let options:Descriptor[]|undefined;
export function localMediaOptions(sourceOverride?:ReturnType<typeof originalRealContent>){
 if(options)return options;
 const index=JSON.parse(readFileSync('D:/projects/huroof_wa_oloof/local/almaidan/media-index.json','utf8'));
 if(index.schemaVersion!==1||index.captureSha256!=='e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a'||!Array.isArray(index.entries))throw Error('LOCAL_MEDIA_INDEX_INVALID');
 const verified=new Set(index.entries.filter((e:any)=>e.verified&&e.path).map((e:any)=>`${e.mediaId}\0${e.assetSha256}\0${e.contentType}`));
 const unique=new Map<string,Descriptor>();for(const q of (sourceOverride??originalRealContent()).questions)for(const m of [q.media,q.answerMedia]){
  if(!m||!['image','video'].includes(m.type)||typeof m.altAr!=='string'||!verified.has(`${m.mediaId}\0${m.assetSha256}\0${m.contentType}`))continue;
  const value={type:m.type,mediaId:m.mediaId,assetSha256:m.assetSha256,contentType:m.contentType,altAr:m.altAr};unique.set(JSON.stringify(value),value);
 }
 return options=[...unique.values()];
}
export function checkedLocalMedia(value:unknown,type?:string,sourceOverride?:ReturnType<typeof originalRealContent>){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 if(Object.keys(value).sort().join(',')==='altAr,assetSha256,contentType,mediaId,type,youtube'){
  const m=value as Descriptor&{youtube:unknown};
  if((type&&type!=='video')||m.type!=='video'||m.contentType!=='application/vnd.huroof.youtube+json'||typeof m.mediaId!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(m.mediaId)||typeof m.altAr!=='string'||!isYouTubeMediaDescriptor(m.youtube)||createHash('sha256').update(youtubeDescriptorBytes(m.youtube)).digest('hex')!==m.assetSha256)return undefined;
  // Only exact descriptors already bound in the trusted source are selectable.
  const source=sourceOverride??originalRealContent();
  return source.questions.flatMap(q=>[q.media,q.answerMedia]).find(x=>{const candidate=x as (Descriptor&{youtube?:unknown})|undefined;return candidate&&candidate.type===m.type&&candidate.mediaId===m.mediaId&&candidate.assetSha256===m.assetSha256&&candidate.contentType===m.contentType&&candidate.altAr===m.altAr&&isYouTubeMediaDescriptor(candidate.youtube)&&youtubeDescriptorBytes(candidate.youtube)===youtubeDescriptorBytes(m.youtube as import('../../../../../src/features/game/runtime/youtube-media').YouTubeMediaDescriptor)}) as (Descriptor&{youtube:unknown})|undefined;
 }
 if(Object.keys(value).sort().join(',')!=='altAr,assetSha256,contentType,mediaId,type')return undefined;
 const m=value as Descriptor;if(type&&m.type!==type)return undefined;
 return localMediaOptions(sourceOverride).find(x=>Object.keys(x).every(k=>x[k as keyof Descriptor]===m[k as keyof Descriptor]));
}
