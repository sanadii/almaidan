import {CURRENT_CATEGORY_PROJECTION,canonicalCategoryId,projectedCategoryLabel,hasCategoryGroup,type CategoryProjectionVersion} from './category-projection';
import {readFileSync} from 'node:fs';
import {createHash,randomInt} from 'node:crypto';
import {resolve} from 'node:path';
import type {PinnedQuestion} from '../gameplay/types';
import {assertLocalDevelopment} from './guard';
import {cleanAnswerText} from '../utils/answer-text';
// Local-only adapter shares the authority's canonical validator.
const challengeOverlay=()=>require('../../../../../server/local-challenge-overlay') as {deriveChallengeEnvelope:(question:unknown,payload:Record<string,unknown>)=>{id:string;schemaVersion:string;definitionSha256:string;manifestSha256:string}};
type Raw=Record<string,any>;
type Question=Omit<PinnedQuestion,'id'|'isOpened'|'isCorrect'|'answeredByTeamId'>&{localGroups:string[];localTierAssigned:boolean};
export type LocalCategory={key:string;label:string;revisionId:string;questions:Question[]};
type Content={schemaVersion:1;source:{path:string;sha256:string;capturedAt:string;releaseId:string};categories:Raw[];questions:Raw[];media:Raw[]};
let cached:Content|undefined;const pools=new Map<CategoryProjectionVersion,LocalCategory[]>();
export const realContentEnabled=()=>Boolean(process.env.ALMAIDAN_REAL_CONTENT_PATH);
export function originalRealContent(){if(cached)return cached;assertLocalDevelopment();const path=process.env.ALMAIDAN_REAL_CONTENT_PATH;if(!path||resolve(path).toLowerCase()!==resolve('D:/projects/huroof_wa_oloof/local/almaidan/real-content.json').toLowerCase())throw Error('LOCAL_REAL_CONTENT_PATH_REQUIRED');const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!=='7ce29d3d9e58f8ca89cb32f50bf47342f86e138d90f85b283ecefbf5eca28a54')throw Error('LOCAL_REAL_CONTENT_HASH_MISMATCH');const parsed=JSON.parse(bytes.toString('utf8')) as Content;if(parsed.schemaVersion!==1||!Array.isArray(parsed.categories)||!Array.isArray(parsed.questions)||parsed.categories.length!==530||parsed.questions.length!==115636||!Array.isArray(parsed.media)||!parsed.source||!/^[a-f0-9]{64}$/.test(parsed.source.sha256))throw Error('LOCAL_REAL_CONTENT_INVALID');cached=parsed;return parsed;}
export type Overlay={entity:'question'|'category';entityId:string;revisionId:string;payload:Record<string,unknown>};
let activeOverlays:Overlay[]=[];let derived:Content|undefined;
export function localContentOverlays():Overlay[]{return structuredClone(activeOverlays);}
export function applyLocalContentOverlays(rows:Overlay[]){assertLocalDevelopment();activeOverlays=structuredClone(rows);derived=undefined;pools.clear();}
/** Derive an immutable release without changing the active local head. Caller validates retained overlays. */
export function deriveRealContent(overlays:Overlay[]):Content {
 const original=originalRealContent();if(!overlays.length)return original;
 const questions=new Map(overlays.filter(r=>r.entity==='question').map(r=>[r.entityId,r]));
 const categories=new Map(overlays.filter(r=>r.entity==='category').map(r=>[r.entityId,r]));
 const overlayHash=createHash('sha256').update(JSON.stringify(overlays)).digest('hex');
 return {...original,source:{...original.source,releaseId:`local-overlay-${overlayHash.slice(0,32)}`,sha256:createHash('sha256').update(original.source.sha256+overlayHash).digest('hex')},categories:original.categories.map(c=>categories.has(c.id)?{...c,...categories.get(c.id)!.payload,localRevisionId:categories.get(c.id)!.revisionId}:c),questions:original.questions.map(q=>{const row=questions.get(q.id);if(!row)return q;if(q.challenge){const envelope=challengeOverlay().deriveChallengeEnvelope(q,row.payload);return {...q,promptAr:row.payload.promptAr,challenge:{...q.challenge,definition:{id:envelope.id,schemaVersion:envelope.schemaVersion,definitionSha256:envelope.definitionSha256,manifestSha256:envelope.manifestSha256}},localRevisionId:row.revisionId};}return {...q,...row.payload,localRevisionId:row.revisionId};})};
}
export function realContent(){if(!activeOverlays.length)return originalRealContent();return derived??(derived=deriveRealContent(activeOverlays));}

const digest=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function realCategories(version:CategoryProjectionVersion|undefined=CURRENT_CATEGORY_PROJECTION):LocalCategory[]{if(version===undefined)return buildRealCategories(realContent());let result=pools.get(version);if(!result){result=buildRealCategories(realContent(),version);pools.set(version,result);}return result;}
export function buildRealCategories(data:Content,version?:CategoryProjectionVersion):LocalCategory[]{const byCategory=new Map<string,Question[]>();
 for(const q of data.questions){if(q.modality!=='classic'||q.challenge||typeof q.canonicalAnswer!=='string'||!q.canonicalAnswer.trim()||q.canonicalAnswer.startsWith('challenge:')||typeof q.promptAr!=='string'||!q.promptAr.trim()||typeof q.id!=='string'||typeof q.categoryId!=='string')continue;
 const explicit=q.points??q.sourceProvenance?.points;if(explicit!==undefined&&![200,400,600].includes(explicit))continue;
 const points=(explicit??([200,400,600] as const)[parseInt(digest(q.id).slice(0,8),16)%3]) as 200|400|600;
 // Display text drops escaped spoiler markers from the saved source; identity/hashes above still use the raw record.
 const answers=[...new Set([q.canonicalAnswer,...(Array.isArray(q.acceptedAnswers)?q.acceptedAnswers:[])].filter(a=>typeof a==='string'&&a.trim()).map(a=>cleanAnswerText(a as string)))] as string[];
 const localGroups=[q.duplicateGroupId&&`duplicate:${q.duplicateGroupId}`,q.sourceBaseItem&&`base:${q.sourceBaseItem}`,q.sourceContentFamily&&`family:${q.sourceContentFamily}`,hasCategoryGroup(q.categoryId,version)&&q.sourceFamilyId&&`family:${q.sourceFamilyId}`].filter(Boolean) as string[];
 const question:Question={revisionId:`real-${digest(q).slice(0,40)}`,sourceQuestionId:q.id,contentHash:digest(q),categoryKey:canonicalCategoryId(q.categoryId,version),points,prompt:q.promptAr,answers:answers.map(text=>({text,isCorrect:true,isTrap:false})),localGroups,localTierAssigned:explicit===undefined};
 const key=canonicalCategoryId(q.categoryId,version);const rows=byCategory.get(key)??[];rows.push(question);byCategory.set(key,rows);
 }
 const categories=new Map<string,LocalCategory>();
 for(const c of data.categories){const key=canonicalCategoryId(c.id,version);if(categories.has(key))continue;const members=data.categories.filter(row=>canonicalCategoryId(row.id,version)===key);const questions=byCategory.get(key)??[];const seen=new Set<string>();const unique=hasCategoryGroup(c.id,version)?questions.filter(q=>{const identity=JSON.stringify([q.prompt.normalize('NFC').trim(),q.answers[0].text.normalize('NFC').trim()]);if(seen.has(identity))return false;seen.add(identity);return true;}):questions;categories.set(key,{key,label:projectedCategoryLabel(c.id,c.labelAr,version),revisionId:`real-${digest(hasCategoryGroup(c.id,version)?{version,members}:c).slice(0,40)}`,questions:unique});}
 return [...categories.values()].filter(c=>typeof c.key==='string'&&typeof c.label==='string'&&[200,400,600].every(p=>c.questions.filter(q=>q.points===p).length>=2));
}
/** Pins six real records without rewriting explicit source points; absent tiers are local assignments only. */
export function selectLocalQuestions(category:{questions:Question[]},seen:ReadonlySet<string>=new Set(),stable=false):Question[]{const selected:Question[]=[],groups=new Set<string>();
 for(const points of [200,400,600]){const candidates=category.questions.filter(q=>q.points===points);if(stable)candidates.sort((a,b)=>a.sourceQuestionId.localeCompare(b.sourceQuestionId));else for(let i=candidates.length-1;i>0;i--){const j=randomInt(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}candidates.sort((a,b)=>Number(seen.has(a.sourceQuestionId))-Number(seen.has(b.sourceQuestionId)));
 const chosen=candidates.filter(q=>{if(selected.filter(x=>x.points===points).length>=2||q.localGroups.some(g=>groups.has(g)))return false;selected.push(q);q.localGroups.forEach(g=>groups.add(g));return true;});if(chosen.length!==2)throw Error('LOCAL_TIER_SUPPLY_UNAVAILABLE');
 }return selected;}


