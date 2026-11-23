import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ChallengeDefinitionRepository} from '../server/challenge-definition-repository.js';
import type {ChallengeDefinitionEnvelope,ChallengeQuestionBinding} from '../src/features/game/challenges/integration.js';
const root='D:/projects/huroof_wa_oloof';
const files=['output/t36-premium-mechanics-20260922/m6/candidate/CHALLENGE-DEFINITION-ENVELOPES.private.json','output/t37-four-archives-20260923/t37e-clean70-challenges/DEFINITION-ENVELOPES.private.json','output/t37-four-archives-20260923/t37f-word-search/DEFINITION-ENVELOPES.private.json'];
const raw=JSON.parse(await readFile(`${root}/local/almaidan/real-content.json`,'utf8'));
const questions=raw.questions.filter((q:ChallengeQuestionBinding)=>q.challenge) as ChallengeQuestionBinding[];
const candidates=new Map<string,ChallengeDefinitionEnvelope>();const sources=[];
const key=(r:ChallengeDefinitionEnvelope|NonNullable<ChallengeQuestionBinding['challenge']>['definition'])=>JSON.stringify([r.id,r.manifestSha256,r.definitionSha256,r.schemaVersion]);
for(const file of files){const bytes=await readFile(`${root}/${file}`);sources.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});for(const e of JSON.parse(bytes.toString('utf8')) as ChallengeDefinitionEnvelope[])candidates.set(key(e),e);}
const selected=new Map<string,ChallengeDefinitionEnvelope>();const missing=[];
for(const q of questions){const e=candidates.get(key(q.challenge!.definition));if(e)selected.set(key(e),e);else missing.push(q.challenge!.definition);}
if(missing.length)throw Error(`EXACT_DEFINITIONS_MISSING:${missing.length}`);
const definitions=[...selected.values()];const repo=new ChallengeDefinitionRepository(definitions);const kinds:Record<string,number>={};
for(const q of questions){const definition=repo.resolveBound(q);kinds[definition.kind]=(kinds[definition.kind]??0)+1;}
await writeFile(`${root}/local/almaidan/real-challenge-definitions.json`,JSON.stringify(definitions),{flag:'wx'});
const report={sourceSha256:raw.source.sha256,sources,questions:questions.length,definitions:definitions.length,kinds,missing:0,exactRuntimeParserAndBinding:true};
await writeFile(`${root}/local/almaidan/real-challenge-definitions-report.json`,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report));
