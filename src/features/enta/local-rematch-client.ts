import {isAlmaidanLocalDevelopment} from '../../lib/local-development';
import {EntaClientError} from './client';
import {exactRound,parseRoundPending,type RoundStart} from './round-client';
import {parseCompetitionPending,type CompetitionFormat,type CompetitionSetup} from './competition-client';
export type LocalRematchEngine='round'|'competitive';
export type LocalRematchSource={baseReleaseId:string;baseRoot:string;formatReleaseId:string;formatRoot:string;mediaRoot:string;competitiveReleaseId?:string;proofRoot?:string};
export type LocalRematchPending={version:6;engine:LocalRematchEngine;executionFormat:CompetitionFormat;startKind:'LOCAL_REMATCH';predecessor:{id:string;version:number};source:LocalRematchSource;endpoint:string;command:{requestKey:string;logicalMatchId:string;predecessorVersion:number}};
export type LocalRematchSetup={engine:LocalRematchEngine;executionFormat:CompetitionFormat;predecessor:LocalRematchPending['predecessor'];source:LocalRematchSource;setup:RoundStart['setup']|CompetitionSetup;categories:{key:string;label:string}[]};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const bad=():never=>{throw new EntaClientError('MALFORMED_RESPONSE');};
function identity(row:Record<string,unknown>){
 if(!isAlmaidanLocalDevelopment)throw new EntaClientError('LOCAL_REMATCH_UNAVAILABLE');
 if(!['round','competitive'].includes(row.engine as string)||!['TIER_BOARD','MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING'].includes(row.executionFormat as string)||row.engine==='round'&&row.executionFormat==='TIER_BOARD')bad();
 const predecessor=exactRound(row.predecessor,['id','version']);if(!id(predecessor.id)||!Number.isSafeInteger(predecessor.version)||(predecessor.version as number)<2)bad();
 const source=exactRound(row.source,['baseReleaseId','baseRoot','formatReleaseId','formatRoot','mediaRoot',...(row.engine==='competitive'?['competitiveReleaseId','proofRoot']:[])]);
 for(const key of ['baseReleaseId','formatReleaseId',...(row.engine==='competitive'?['competitiveReleaseId']:[])])if(!id(source[key]))bad();
 for(const key of ['baseRoot','formatRoot','mediaRoot',...(row.engine==='competitive'?['proofRoot']:[])])if(typeof source[key]!=='string'||!/^[a-f0-9]{64}$/.test(source[key] as string))bad();
}
export function parseLocalRematchPending(value:unknown):LocalRematchPending{
 const row=exactRound(value,['version','engine','executionFormat','startKind','predecessor','source','endpoint','command']);identity(row);
 const predecessor=row.predecessor as LocalRematchPending['predecessor'],command=exactRound(row.command,['requestKey','logicalMatchId','predecessorVersion']);
 if(row.version!==6||row.startKind!=='LOCAL_REMATCH'||row.endpoint!==`/local-rematches/${row.engine}/${predecessor.id}`||typeof command.requestKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(command.requestKey)||!id(command.logicalMatchId)||command.logicalMatchId===predecessor.id||command.predecessorVersion!==predecessor.version)bad();
 return row as unknown as LocalRematchPending;
}
export function parseLocalRematchSetup(value:unknown,engine:string,parentId:string):LocalRematchSetup{
 const row=exactRound(value,['engine','executionFormat','predecessor','source','setup','categories']);identity(row);
 if(row.engine!==engine||(row.predecessor as LocalRematchPending['predecessor']).id!==parentId)bad();
 const format=row.executionFormat as CompetitionFormat,path=format==='TIER_BOARD'?'classic':format==='MIXED_BOARD'?'mixed':format==='STANDALONE_LIST'?'list':'acting',operation=path==='list'?'PAID_ENTA_LIST':path==='acting'?'PAID_ENTA_ACTING':'PAID_ENTA_CLASSIC';
 const shared={executionFormat:format,operation,startKind:'START',predecessor:null,command:{requestKey:'validate-rematch',logicalMatchId:'validate-rematch',setup:row.setup}};
 if(engine==='competitive')parseCompetitionPending({...shared,version:5,endpoint:`/competition/matches/${path}`});else parseRoundPending({...shared,version:4,mode:path==='list'?'LIST':path==='acting'?'ACTING':'CLASSIC',endpoint:`/matches/${path}`});
 const setup=row.setup as LocalRematchSetup['setup'];if(!Array.isArray(row.categories)||row.categories.length!==setup.categories.length)bad();
 (row.categories as unknown[]).forEach((value,index)=>{const c=exactRound(value,['key','label']);if(c.key!==setup.categories[index].key||typeof c.label!=='string'||!c.label.trim()||c.label.length>100)bad();});
 return row as unknown as LocalRematchSetup;
}
export function verifyLocalRematchCompletion(value:unknown,intent:LocalRematchPending){
 const row=exactRound(value,['match','idempotent','predecessor','source']),predecessor=exactRound(row.predecessor,['id','version']);if(typeof row.idempotent!=='boolean'||predecessor.id!==intent.predecessor.id||predecessor.version!==intent.predecessor.version)bad();
 const source=row.source as Record<string,unknown>;if(!source||Object.keys(source).length!==Object.keys(intent.source).length||Object.entries(intent.source).some(([k,v])=>source[k]!==v))bad();
 return {match:row.match,idempotent:row.idempotent};
}
