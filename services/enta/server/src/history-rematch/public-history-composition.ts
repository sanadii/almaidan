import {composeHistory} from './history-composition';
import type {HistoryQueryBoundary} from './postgres';
import type {Keyring} from './cursor';
import {createPgHistory,type PgHistoryKeys} from '../huroof-pg/history';
import type {IdentityDependencies} from '../huroof-pg/identity-policy';
import type {QueryBoundary} from '../huroof-pg/repository';

/** Explicit host injection only. No connection, credential or key is created here.
 * The caller must supply separately provisioned, restricted history readers.
 * Omitting this composition from the app keeps the ordinary routes unavailable.
 */
export function composePublicHistory(input:{namespace:string;projectId:string;entaDb:HistoryQueryBoundary;huroofDb:QueryBoundary;identity:IdentityDependencies;entaKeys:Keyring;huroofKeys:PgHistoryKeys;clock:()=>number}){
 const {namespace,projectId,entaDb,huroofDb,identity,entaKeys,huroofKeys,clock}=input;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(namespace)||!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)||identity.namespace!==namespace||identity.clientProjectId!==projectId||typeof entaDb?.query!=='function'||typeof huroofDb?.query!=='function'||typeof clock!=='function'||!entaKeys||!huroofKeys)throw Error('HISTORY_COMPOSITION_INVALID');
 return {historyHandlers:composeHistory(entaDb,namespace,projectId,entaKeys,clock),huroofHistory:createPgHistory(identity,huroofDb,huroofKeys,clock)};
}
