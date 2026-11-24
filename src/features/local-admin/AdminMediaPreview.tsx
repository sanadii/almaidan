import {useEffect,useState} from 'react';
import {isYouTubeMediaDescriptor,youtubeEmbedUrl} from '../game/runtime/youtube-media';

type Media={type?:string;mediaId?:string;assetSha256?:string;altAr?:string;youtube?:unknown};

/**
 * Shows the question or answer media the way players will see it. Local files are fetched
 * through the authenticated admin API and shown from a short-lived blob URL.
 */
export function AdminMediaPreview({label,media,load}:{label:string;media:Media|null|undefined;load:(media:Media)=>Promise<string>}){
 const [url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
 const youtube=media&&isYouTubeMediaDescriptor(media.youtube)?media.youtube:null;
 const key=media?`${media.mediaId}:${media.assetSha256}`:'';
 useEffect(()=>{
  setUrl(null);setFailed(false);
  if(!media||youtube||!media.mediaId)return;
  let active=true,created:string|null=null;
  load(media).then(value=>{created=value;if(active)setUrl(value);else URL.revokeObjectURL(value);}).catch(()=>{if(active)setFailed(true);});
  return()=>{active=false;if(created)URL.revokeObjectURL(created);};
  // The descriptor identity (id + hash) is the dependency; the object itself may be re-created.
 },[key]);
 if(!media)return null;
 return <figure className="local-admin-media">
  <figcaption>{label}{media.altAr?` · ${media.altAr}`:''}</figcaption>
  {youtube?<iframe src={youtubeEmbedUrl(youtube)} title={`${label}: فيديو يوتيوب`} loading="lazy" allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"/>
   :failed?<p className="local-admin-media__missing">تعذر تحميل الملف المحلي لهذه الوسائط.</p>
   :!url?<p className="local-admin-media__loading" role="status">جارٍ تحميل المعاينة…</p>
   :media.type==='video'?<video src={url} controls preload="metadata"/>
   :<img src={url} alt={media.altAr||label}/>}
 </figure>;
}
