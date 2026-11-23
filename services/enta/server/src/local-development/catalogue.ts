import {text,ID} from '../rounds/validation';
import {realContentEnabled,realCategories,selectLocalQuestions} from './real-content';
import { createHash } from 'node:crypto';
import type { PinnedQuestion } from '../gameplay/types';

// Original, deliberately simple local practice content. No production release claim.
const sources: [string, string, [string,string][]][] = [
  ['numbers','الحساب', [['كم يساوي ٢ + ٣؟','٥'],['كم يساوي ٤ + ٤؟','٨'],['كم يساوي ١٠ − ٣؟','٧'],['كم يساوي ٣ × ٤؟','١٢'],['كم يساوي ٢٠ ÷ ٤؟','٥'],['كم يساوي ٧ × ٦؟','٤٢']]],
  ['animals','الحيوانات', [['ما الحيوان الذي يموء؟','القط'],['ما الحيوان الذي يلقب بسفينة الصحراء؟','الجمل'],['كم أرجل العنكبوت؟','ثماني أرجل'],['ما أكبر حيوان يعيش على الأرض؟','الحوت الأزرق'],['ما الطائر الذي لا يطير ويعيش في القارة القطبية الجنوبية؟','البطريق'],['ما الحيوان الذي يحمل صغيره في جراب؟','الكنغر']]],
  ['space','الفضاء', [['ما النجم الأقرب إلى الأرض؟','الشمس'],['ما اسم كوكبنا؟','الأرض'],['ما الكوكب المعروف بالكوكب الأحمر؟','المريخ'],['كم كوكباً في المجموعة الشمسية؟','ثمانية'],['ما أكبر كواكب المجموعة الشمسية؟','المشتري'],['ما الكوكب المشهور بحلقاته؟','زحل']]],
  ['language','اللغة العربية', [['ما ضد كلمة كبير؟','صغير'],['ما جمع كتاب؟','كتب'],['ما أول حرف في كلمة شمس؟','ش'],['كم حرفاً في كلمة قلم؟','ثلاثة'],['ما مفرد مدارس؟','مدرسة'],['ما ضد كلمة قريب؟','بعيد']]],
  ['world','حول العالم', [['ما عاصمة الكويت؟','الكويت'],['ما عاصمة مصر؟','القاهرة'],['في أي قارة تقع اليابان؟','آسيا'],['ما أكبر محيط؟','المحيط الهادئ'],['ما عاصمة فرنسا؟','باريس'],['في أي قارة تقع البرازيل؟','أمريكا الجنوبية']]],
  ['daily','معلومات عامة', [['كم يوماً في الأسبوع؟','سبعة'],['كم شهراً في السنة؟','اثنا عشر'],['ما العضو الذي يضخ الدم؟','القلب'],['ما حالة الماء عندما يتجمد؟','صلبة'],['ما الأداة المستخدمة لقياس درجة الحرارة؟','ميزان الحرارة'],['كم دقيقة في ساعتين؟','١٢٠']]],
];
export const localCategories = sources.map(([key,label,rows]) => ({key:`local-${key}`,label:`${label} · تدريب محلي`,revisionId:`local-${key}-v1`,questions:rows.map(([prompt,answer],index) => ({revisionId:`local-${key}-${index}-v1`,sourceQuestionId:`local-${key}-${index}`,contentHash:createHash('sha256').update(JSON.stringify([prompt,answer])).digest('hex'),categoryKey:`local-${key}`,points:([200,200,400,400,600,600] as const)[index],prompt,answers:[{text:answer,isCorrect:true,isTrap:false}]} satisfies Omit<PinnedQuestion,'id'|'isOpened'|'isCorrect'|'answeredByTeamId'>))}));

export const currentLocalCategories=()=>realContentEnabled()?realCategories():localCategories;
export const selectedLocalCategories=(seen:ReadonlySet<string>=new Set())=>currentLocalCategories().map(c=>({...c,questions:realContentEnabled()?c.questions.filter(q=>{try{return ID.test(q.sourceQuestionId)&&ID.test('format-'+q.sourceQuestionId)&&text(q.prompt,1,2000)===q.prompt&&text(q.answers[0].text,1,512)===q.answers[0].text&&text(c.label,1,100)===c.label;}catch{return false;}}):c.questions})).filter(c=>[200,400,600].every(points=>c.questions.filter(q=>q.points===points).length>=2)).map(c=>({...c,questions:realContentEnabled()?selectLocalQuestions(c as ReturnType<typeof realCategories>[number],seen,true):c.questions}));


