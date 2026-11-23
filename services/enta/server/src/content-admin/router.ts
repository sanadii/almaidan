import { Router, raw, type Request, type Response } from "express";
import { authenticateAdmin, type AdminClaimsDependencies } from "./claims";
import { readPublishedSnapshot, publishedQuestions, publishedCategories, getPublishedQuestion, getPublishedCategory, correctionBaseline, saveCorrection, inspectionBaseline, markInspection, settingsMutation, validateQuestionDraft, validateCategoryPatch, mutationFor, lookupAdminUser, type LookupAuthIo } from "./service";
import { deliverPublishedPreview, type MaterialAuthority } from "./media";
import { sqlContext, chargeRate, withRequestRate, type ContentAdminRepository } from "./repository";
import { requireAdmin, capabilitiesFor, type AdminRegistry } from "./authorization";
const id=(value:unknown):string=>{if(typeof value!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new Error("INVALID_REQUEST"); return value;};
const payload=(v:unknown,allowed:string[]):Record<string,unknown>=>{if(!v || typeof v!=="object" || Array.isArray(v) || Buffer.byteLength(JSON.stringify(v),"utf8")>65536 || Object.keys(v).some(k=>!allowed.includes(k))) throw new Error("INVALID_REQUEST"); return v as Record<string,unknown>;};
/** HTTP commands use integers only. Check mathematical value before IEEE-754 conversion. */
function exactSafeIntegerToken(token:string):boolean {
 const match=/^-?([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
 if(!match) return false;
 let digits=(match[1]+(match[2]??"")).replace(/^0+/,"");
 if(!digits) return true;
 const exponentText=match[3]??"0", magnitude=exponentText.replace(/^[+-]?0*/,"");
 if(magnitude.length>6) return false;
 const exponent=Number(exponentText), scale=exponent-(match[2]?.length??0);
 if(scale<0){const places=-scale;if(places>digits.length || !digits.endsWith("0".repeat(places))) return false;digits=digits.slice(0,digits.length-places);}
 else {if(digits.length+scale>16) return false;digits+="0".repeat(scale);}
 digits=digits.replace(/^0+/,"")||"0";
 return digits.length<16 || (digits.length===16 && digits<="9007199254740991");
}
/** Reject duplicate decoded keys at every depth before JSON.parse discards them. */
export function parseAdminJson(bytes:Uint8Array):unknown {
 if(!(bytes instanceof Uint8Array) || bytes.byteLength<1 || bytes.byteLength>65536) throw new Error("INVALID_REQUEST");
 let source:string; try {source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);} catch {throw new Error("INVALID_REQUEST");}
 let i=0; const ws=()=>{while(i<source.length && /[\x20\t\r\n]/.test(source[i])) i++;};
 const string=():string=>{const start=i; if(source[i++]!=="\"") throw new Error("INVALID_REQUEST"); let escaped=false; while(i<source.length){const ch=source[i++]; if(!escaped && ch==="\"") {try{return JSON.parse(source.slice(start,i)) as string;}catch{throw new Error("INVALID_REQUEST");}} if(!escaped && ch==="\\") escaped=true;else escaped=false;} throw new Error("INVALID_REQUEST");};
 const value=(depth:number):void=>{if(depth>64) throw new Error("INVALID_REQUEST"); ws(); const ch=source[i];
  if(ch==="{"){i++;ws();const keys=new Set<string>();if(source[i]==="}"){i++;return;}for(;;){ws();const key=string();if(keys.has(key)) throw new Error("DUPLICATE_JSON_KEY");keys.add(key);ws();if(source[i++]!==":") throw new Error("INVALID_REQUEST");value(depth+1);ws();const sep=source[i++];if(sep==="}") return;if(sep!==",") throw new Error("INVALID_REQUEST");}}
  if(ch==="["){i++;ws();if(source[i]==="]"){i++;return;}for(;;){value(depth+1);ws();const sep=source[i++];if(sep==="]") return;if(sep!==",") throw new Error("INVALID_REQUEST");}}
  if(ch==="\""){string();return;} const rest=source.slice(i); const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest);if(!match || (match[0]!=="true" && match[0]!=="false" && match[0]!=="null" && !exactSafeIntegerToken(match[0]))) throw new Error("INVALID_REQUEST");i+=match[0].length;
 };
 value(0);ws();if(i!==source.length) throw new Error("INVALID_REQUEST");let result:unknown;try{result=JSON.parse(source);}catch{throw new Error("INVALID_REQUEST");} const stack=[result]; while(stack.length){const item=stack.pop();if(typeof item==="number" && !Number.isFinite(item)) throw new Error("INVALID_REQUEST");if(Array.isArray(item)) stack.push(...item);else if(item && typeof item==="object") stack.push(...Object.values(item));} if(!result || typeof result!=="object" || Array.isArray(result) || Object.getPrototypeOf(result)!==Object.prototype) throw new Error("INVALID_REQUEST"); return result;
}
export interface RegistryService {change(token:string,request:{targetUid:string;operationId:string;expectedRevision:number;mode:"role"|"status"|"revoke";payload:Record<string,unknown>}):Promise<unknown>}
/** Explicitly returned router; never mounted or initialized at import. */
export function createContentAdminRouter(auth:AdminClaimsDependencies,repo:ContentAdminRepository,registryService?:RegistryService,lookup?:LookupAuthIo,material?:MaterialAuthority):Router {
 const router=Router();
 router.use((req,res,next)=>{const type=req.get("content-type")??"", encoding=req.get("content-encoding");if(!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(type) || (encoding!==undefined && encoding.trim().toLowerCase()!=="identity")){res.status(415).json({error:"INVALID_REQUEST"});return;}next();});
 router.use(raw({type:"application/json",limit:65536,inflate:false}));
 router.use((_error:unknown,_req:Request,res:Response,_next:import("express").NextFunction)=>{res.status(400).json({error:"INVALID_REQUEST"});});
 router.use((req,res,next)=>{try {const length=req.get("content-length"), transfer=req.get("transfer-encoding");if(length!==undefined && (!/^(0|[1-9][0-9]{0,5})$/.test(length) || Number(length)>65536 || !(req.body instanceof Uint8Array) || Number(length)!==req.body.byteLength || transfer!==undefined)) throw new Error("INVALID_REQUEST");req.body=parseAdminJson(req.body);next();} catch {res.status(400).json({error:"INVALID_REQUEST"});}});
 const wrap=(action:(req:Request,res:Response,claims:Awaited<ReturnType<typeof authenticateAdmin>>)=>Promise<void>)=>async(req:Request,res:Response)=>{
  try {const h=req.get("authorization"); if(!h?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED"); const claims=await authenticateAdmin(auth,h.slice(7)); res.setHeader("cache-control","no-store"); await withRequestRate(repo,claims,()=>action(req,res,claims));}
  catch {if(res.headersSent || res.destroyed) {if(!res.destroyed) res.destroy();return;} res.status(403).json({error:"ADMIN_UNAVAILABLE"});}
 };
 router.post("/adminListPublishedQuestions",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","categoryId","limit","cursor"]); const scope=id(p.profileScope), release=id(p.releaseId), category=id(p.categoryId); const limit=p.limit===undefined?50:p.limit; if(typeof limit!=="number") throw new Error("INVALID_REQUEST"); const {snapshot,registry}=await readPublishedSnapshot(repo,claims,scope,release); const page=publishedQuestions(claims,registry,snapshot,category,limit,p.cursor as never); res.json({releaseId:release,...page});}));
 router.post("/adminGetPublishedQuestion",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","id"]); const scope=id(p.profileScope), release=id(p.releaseId), question=id(p.id); const prepared=await readPublishedSnapshot(repo,claims,scope,release), {snapshot,registry}=prepared, dto=getPublishedQuestion(claims,registry,snapshot,question), category=String(dto.categoryId), label=getPublishedCategory(claims,registry,snapshot,category).labelAr; if(typeof label!=="string" || !label.trim()) throw new Error("CONTENT_UNAVAILABLE"); const {baseline}=await inspectionBaseline(repo,claims,scope,release,question,prepared); const ids=[...snapshot.questions].filter(([,q])=>q.categoryId===category).map(([id])=>id).sort(),index=ids.indexOf(question);res.json({releaseId:release,...dto,categoryLabelAr:label.trim(),inspection:{reviewed:baseline.reviewed,reviewedAt:baseline.reviewedAt??null,digestKind:baseline.digestKind,questionDocumentDigest:baseline.questionDocumentDigest},previousQuestionId:index>0?ids[index-1]:null,nextQuestionId:index>=0 && index+1<ids.length?ids[index+1]:null});}));
 router.post("/adminGetPublishedCategory",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","id"]); const scope=id(p.profileScope), release=id(p.releaseId), category=id(p.id); const {snapshot,registry}=await readPublishedSnapshot(repo,claims,scope,release); res.json({releaseId:release,...getPublishedCategory(claims,registry,snapshot,category)});}));
 router.post("/adminGetPublishedQuestionMedia",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","id","variant"]); const variant=p.variant; if(variant!=="question" && variant!=="answer") throw new Error("INVALID_REQUEST"); await deliverPublishedPreview(res,repo,claims,{mode:"published-preview",profileScope:id(p.profileScope),releaseId:id(p.releaseId),questionId:id(p.id),variant},material);}));
 router.post("/adminGetSettings",wrap(async(req,res,claims)=>{payload(req.body,[]); const c=sqlContext(claims); await chargeRate(repo,claims); res.json(await repo.settingsGet(c));}));
 router.post("/adminUpdateSettings",wrap(async(req,res,claims)=>{const p=payload(req.body,["operationId","expectedRevision","settings"]); if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST"); const command=settingsMutation(id(p.operationId),p.expectedRevision,p.settings); const c=sqlContext(claims); await chargeRate(repo,claims); res.json(await repo.settingsUpdate(c,command.mutation,command.patch));}));
 const change=async(req:Request,res:Response,claims:Awaited<ReturnType<typeof authenticateAdmin>>,mode:"role"|"status"|"revoke")=>{
  const allowed=mode==="role"?["uid","operationId","expectedRevision","enabled","roles","categoryScopes","reviewerScopes"]:mode==="status"?["uid","operationId","expectedRevision","disabled"]:["uid","operationId","expectedRevision"];
  const p=payload(req.body,allowed); if(typeof p.uid!=="string" || typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");
  const patch=mode==="role"?{enabled:p.enabled,roles:p.roles,categoryScopes:p.categoryScopes??[],reviewerScopes:p.reviewerScopes??[]}:mode==="status"?{disabled:p.disabled}:{};
  if(!registryService) throw new Error("REGISTRY_SERVICE_UNAVAILABLE");
  const header=req.get("authorization");if(!header?.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");res.json(await registryService.change(header.slice(7),{targetUid:p.uid,operationId:id(p.operationId),expectedRevision:p.expectedRevision,mode,payload:patch}));
 };
 router.post("/adminUpdateUserRole",wrap((req,res,claims)=>change(req,res,claims,"role")));
 router.post("/adminSetUserStatus",wrap((req,res,claims)=>change(req,res,claims,"status")));
 router.post("/adminRevokeUserSessions",wrap((req,res,claims)=>change(req,res,claims,"revoke")));
 router.post("/adminListQuestions",wrap(async(req,res,claims)=>{const p=payload(req.body,["categoryId","limit","status","cursor"]);const categoryId=id(p.categoryId), limit=p.limit??25,status=p.status??null,cursor=p.cursor??null; if(typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>100 || (status!==null && typeof status!=="string")) throw new Error("INVALID_REQUEST");const c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.draftList(c,{categoryId,limit,status,cursor}));}));
 router.post("/adminGetQuestion",wrap(async(req,res,claims)=>{const p=payload(req.body,["id"]), c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.draftGet(c,id(p.id)));}));
 router.post("/adminSaveQuestion",wrap(async(req,res,claims)=>{const p=payload(req.body,["id","operationId","expectedRevision","draft"]);if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");const q=id(p.id), draft=validateQuestionDraft(p.draft),m=mutationFor("question.save",q,id(p.operationId),p.expectedRevision,draft),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.draftSave(c,m,q,draft));}));
 router.post("/adminArchiveQuestion",wrap(async(req,res,claims)=>{const p=payload(req.body,["id","operationId","expectedRevision"]);if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");const q=id(p.id),m=mutationFor("question.archive",q,id(p.operationId),p.expectedRevision,{}),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.draftArchive(c,m,q));}));
 router.post("/adminSubmitQuestionReview",wrap(async(req,res,claims)=>{const p=payload(req.body,["id","operationId","expectedRevision"]);if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");const q=id(p.id),m=mutationFor("question.submit-review",q,id(p.operationId),p.expectedRevision,{}),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.reviewSubmit(c,m,q));}));
 router.post("/adminDecideReview",wrap(async(req,res,claims)=>{const p=payload(req.body,["id","operationId","expectedRevision","decision","reason"]);if(typeof p.expectedRevision!=="number" || p.decision!=="changes_requested" || typeof p.reason!=="string" || !p.reason.trim() || p.reason.length>2000) throw new Error("INVALID_REQUEST");const q=id(p.id),m=mutationFor("review.decide",q,id(p.operationId),p.expectedRevision,{decision:p.decision,reason:p.reason}),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.reviewDecide(c,m,q,p.decision,p.reason));}));
 router.post("/adminListReviews",wrap(async(req,res,claims)=>{const p=payload(req.body,["categoryId","limit","status","cursor"]);const categoryId=id(p.categoryId), limit=p.limit??25,status=p.status??null,cursor=p.cursor??null; if(typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>100 || (status!==null && typeof status!=="string")) throw new Error("INVALID_REQUEST");const c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.reviewList(c,{categoryId,limit,status,cursor}));}));
 router.post("/adminGetReview",wrap(async(req,res,claims)=>{const p=payload(req.body,["id"]), c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.reviewGet(c,id(p.id)));}));
 router.post("/adminListRooms",wrap(async(req,res,claims)=>{const p=payload(req.body,["limit","cursor"]),limit=p.limit??25,cursor=p.cursor??null; if(typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error("INVALID_REQUEST"); const c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.roomList(c,{limit,cursor}));}));
 router.post("/adminGetRoom",wrap(async(req,res,claims)=>{const p=payload(req.body,["id"]),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.roomGet(c,id(p.id)));}));
 router.post("/adminListCategories",wrap(async(req,res,claims)=>{const p=payload(req.body,["categoryId","limit","cursor"]),limit=p.limit??25,cursor=p.cursor??null,categoryId=p.categoryId===undefined?null:id(p.categoryId);if(typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error("INVALID_REQUEST"); const c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.categoryList(c,{limit,cursor,categoryId}));}));
 router.post("/adminGetCategory",wrap(async(req,res,claims)=>{const p=payload(req.body,["id"]),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.categoryGet(c,id(p.id)));}));
 router.post("/adminUpdateCategory",wrap(async(req,res,claims)=>{const p=payload(req.body,["id","operationId","expectedRevision","metadata"]);if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");const category=id(p.id),patch=validateCategoryPatch(p.metadata),m=mutationFor("category.update",category,id(p.operationId),p.expectedRevision,patch),c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.categoryUpdate(c,m,category,patch));}));
 router.post("/adminListAudit",wrap(async(req,res,claims)=>{const p=payload(req.body,["limit","cursor"]),limit=p.limit??25,cursor=p.cursor??null; if(typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>100) throw new Error("INVALID_REQUEST"); const c=sqlContext(claims);await chargeRate(repo,claims);res.json(await repo.auditList(c,{limit,cursor}));}));
 router.post("/adminLookupUser",wrap(async(req,res,claims)=>{const p=payload(req.body,["uid","email"]);if((p.uid!==undefined && typeof p.uid!=="string") || (p.email!==undefined && typeof p.email!=="string")) throw new Error("INVALID_REQUEST");res.json(await lookupAdminUser(repo,claims,auth.resolveIdentity,lookup,{uid:p.uid as string|undefined,email:p.email as string|undefined}));}));
 router.post("/adminGetCategoryCorrection",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","categoryId","releaseId"]);const result=await correctionBaseline(repo,claims,id(p.profileScope),id(p.categoryId),id(p.releaseId));res.json(result.base);}));
 router.post("/adminSaveCategoryCorrection",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","categoryId","releaseId","operationId","expectedRevision","draft"]);if(typeof p.expectedRevision!=="number") throw new Error("INVALID_REQUEST");res.json(await saveCorrection(repo,claims,id(p.profileScope),id(p.categoryId),id(p.releaseId),id(p.operationId),p.expectedRevision,p.draft));}));
 router.post("/adminMarkPublishedQuestionInspected",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","id","operationId"]);res.json(await markInspection(repo,claims,id(p.profileScope),id(p.releaseId),id(p.id),id(p.operationId)));}));
 router.post("/adminListPublishedCategories",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","categoryId","limit","cursor"]),scope=id(p.profileScope),release=id(p.releaseId),category=p.categoryId===undefined?null:id(p.categoryId),limit=p.limit??50;if(typeof limit!=="number") throw new Error("INVALID_REQUEST");const {snapshot,registry}=await readPublishedSnapshot(repo,claims,scope,release);res.json({releaseId:release,...publishedCategories(claims,registry,snapshot,category,limit,p.cursor as never)});}));
 router.post("/adminGetSession",wrap(async(req,res,claims)=>{payload(req.body,[]);const c=sqlContext(claims);await chargeRate(repo,claims);const row=await repo.principal(c) as AdminRegistry;requireAdmin(claims,row,"session");res.json({uid:claims.uid,roles:row.roles,authzVersion:row.authzVersion,capabilities:capabilitiesFor(row.roles)});}));
 router.post("/adminValidateQuestion",wrap(async(req,res,claims)=>{const p=payload(req.body,["id"]),q=id(p.id),c=sqlContext(claims);await chargeRate(repo,claims);const value=await repo.draftGet(c,q);if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("CONTENT_UNAVAILABLE");const d=value as Record<string,unknown>;const errors=["headerAr","promptAr","canonicalAnswer","specialistRoles"].filter(field=>!d[field] || (Array.isArray(d[field]) && (d[field] as unknown[]).length===0));res.json({id:q,valid:errors.length===0,errors,state:d.status});}));
 router.post("/adminGetOverview",wrap(async(req,res,claims)=>{const p=payload(req.body,["profileScope","releaseId","categoryId"]),scope=id(p.profileScope),release=id(p.releaseId),category=id(p.categoryId);const {snapshot,registry}=await readPublishedSnapshot(repo,claims,scope,release);requireAdmin(claims,registry,"questions.read",[category]);if(!snapshot.categories.has(category)) throw new Error("CONTENT_UNAVAILABLE");res.json({releaseId:release,categoryId:category,publishedQuestionCount:snapshot.inventory.get(category)??0});}));
 return router;
}
























