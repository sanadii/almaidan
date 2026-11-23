import { createHash, randomInt } from 'node:crypto';
import { PACK_VERSION, type Room, type Word } from '../../../src/features/imposter/contracts.js';
import { normalizeGuess } from '../../../src/features/imposter/engine.js';
// Editorial candidate pack: no external IDs are sent to participants.
const entries: Record<string,string> = {
'الفواكه':'تفاح،موز،برتقال،عنب،مانجو،فراولة،بطيخ،شمام،أناناس،كيوي،رمان،تين،تمر،خوخ،مشمش،كمثرى،كرز،توت،ليمون،يوسفي،جوافة،بابايا،جوز الهند،أفوكادو،برقوق،سفرجل،نكتارين،باشن فروت،كاكا،تين شوكي',
'الخضار':'طماطم،خيار،جزر،بطاطس،بصل،ثوم،خس،ملفوف،قرنبيط،بروكلي،فلفل،باذنجان،كوسة،بامية،سبانخ،جرجير،فجل،شمندر،ذرة،بازلاء،فاصوليا،قرع،كراث،كرفس،بقدونس،كزبرة،نعناع،شبت،زنجبيل،بطاطا حلوة',
'الحيوانات':'أسد،نمر،فيل،زرافة،قرد،حصان،جمل،خروف،ماعز،بقرة،أرنب،قطة،كلب،دب،ثعلب،ذئب،غزال،حمار،كنغر،باندا،سلحفاة،تمساح،ضفدع،سنجاب،قنفذ،وحيد القرن،فرس النهر،حمار وحشي،فهد،دلفين',
'الطيور':'عصفور،حمامة،نسر،صقر،ببغاء،بطريق،نعامة،بطة،دجاجة،ديك،بومة،غراب،هدهد،بلبل،طاووس،بجعة،نورس،لقلق،سنونو،كناري،فلامنجو،إوزة،عقاب،ديك رومي،سمان،حسون،وقواق،نقار الخشب،كروان،مالك الحزين',
'الطعام':'أرز،خبز،جبن،بيض،عسل،طحينة،زبادي،شوربة،سلطة،معكرونة،بيتزا،برجر،فلافل،حمص،فول،مسخن،مجبوس،هريس،جريش،مندي،سمبوسة،شاورما،كباب،كفتة،محشي،كشري،مقلوبة،منسف،فتوش،تبولة',
'الحلويات':'كعك،بسكويت،شوكولاتة،آيس كريم،كنافة،بقلاوة،لقيمات،مهلبية،كاسترد،جيلي،دونات،تارت،تشيز كيك،براوني،بسبوسة،معمول،قطايف،كيك،وافل،بان كيك،حلاوة،غريبة،تمرية،عصيدة،رز بالحليب،كريم كراميل،أم علي،مارشميلو،مصاصة،غزل البنات',
'المشروبات':'ماء،حليب،شاي،قهوة،عصير برتقال،عصير تفاح،شراب ورد،شاي كرك،حليب فراولة،ميلك شيك،عصير مانجو،عصير رمان،عصير عنب،عصير جزر،عصير أناناس،عصير بطيخ،شاي نعناع،شاي أخضر،قهوة عربية،قهوة تركية،قهوة مثلجة،شوكولاتة ساخنة،عصير ليمون،عصير جوافة،عصير موز،عصير توت،عصير خوخ،عصير مشمش،عصير كوكتيل،لبن عيران',
'البيت':'سرير،أريكة،طاولة،كرسي،نافذة،باب،سجادة،ستارة،مصباح،مرآة،خزانة،وسادة،بطانية،ساعة حائط،رف،مكتب،ثلاجة،فرن،غسالة،مكيف،مروحة،تلفاز،هاتف،مفتاح،قفل،مقبس،سلم،شرفة،مطبخ،حمام',
'المدرسة':'قلم،دفتر،كتاب،ممحاة،مسطرة،حقيبة،سبورة،طباشير،مقص،غراء،ألوان،فرشاة،ورقة،مبراة،آلة حاسبة،مقلمة،واجب،فصل،معلم،طالب،مدير،مختبر،امتحان،جرس،خريطة،كرة أرضية،حاسوب،طابعة،لوحة،مجلد',
'الملابس':'قميص،بنطال،فستان،عباءة،ثوب،جاكيت،معطف،قبعة،حذاء،جورب،وشاح،قفاز،حزام،تنورة،كنزة،بيجاما،صندل،نظارة،ساعة يد،خاتم،سوار،قلادة،قرط،شماغ،غترة،عقال،بشت،حذاء رياضي،حقيبة يد،مظلة',
'المواصلات':'سيارة،حافلة،قطار،طائرة،سفينة،قارب،دراجة،دراجة نارية،شاحنة،سيارة إسعاف،سيارة إطفاء،سيارة شرطة،مترو،ترام،مروحية،منطاد،صاروخ،غواصة،عبارة،جرار،رافعة،تاكسي،حافلة مدرسية،عربة،توك توك،سكوتر،تلفريك،يخت،قطار سريع،عربة قطار',
'الأماكن':'مدرسة،مستشفى،حديقة،مكتبة،مسجد،متحف،شاطئ،مطار،محطة،سوق،مطعم،مخبز،صيدلية،ملعب،مسبح،سينما،مسرح،مزرعة،صحراء،جبل،غابة،جزيرة،بحر،نهر،بحيرة،فندق،جامعة،بنك،مكتب بريد،حديقة حيوانات'
};
export const catalog = Object.keys(entries);
const aliases: Record<string,string[]> = { 'غزل البنات':['حلوى قطن'], 'مجبوس':['مكبوس'], 'آيس كريم':['مثلجات','ايسكريم'], 'برجر':['برغر'], 'بنطال':['بنطلون'], 'معكرونة':['مكرونة'], 'تلفاز':['تلفزيون'], 'قرنبيط':['زهرة'], 'بطاطس':['بطاط'], 'قطة':['قط','بسة'], 'أريكة':['كنبة'], 'طماطم':['بندورة'], 'شمندر':['بنجر'], 'حافلة':['باص'], 'دراجة':['بسكليت','سيكل'], 'ثوب':['دشداشة'], 'قارب':['زورق'], 'لقيمات':['لقمة القاضي'], 'حاسوب':['كمبيوتر'], 'جيلي':['جلي'], 'باذنجان':['بيديان'] };
export type PackEntry = Word & { id: string; packVersion: typeof PACK_VERSION; reviewStatus: 'agent-reviewed-local' };
const entryId = (category: string, word: string, wordAliases: string[]) => `imposter-v1-${createHash('sha256').update(JSON.stringify([PACK_VERSION,category,word,wordAliases])).digest('hex').slice(0,24)}`;
export const pack: PackEntry[] = Object.entries(entries).flatMap(([category, words])=>words.split('،').map(word=>{ const wordAliases=aliases[word] ?? []; return {id:entryId(category,word,wordAliases),packVersion:PACK_VERSION,reviewStatus:'agent-reviewed-local' as const,category,word,aliases:wordAliases}; }));
export function validatePack(): void { if (catalog.length!==12 || catalog.some(c=>pack.filter(w=>w.category===c).length!==30) || pack.some(w=>!w.word.trim() || !Array.isArray(w.aliases) || w.packVersion!==PACK_VERSION || w.reviewStatus!=='agent-reviewed-local' || w.id!==entryId(w.category,w.word,w.aliases)) || new Set(pack.map(w=>w.id)).size!==pack.length || new Set(pack.flatMap(w=>[w.word,...w.aliases].map(normalizeGuess))).size !== pack.flatMap(w=>[w.word,...w.aliases]).length) throw new Error('INVALID_IMPOSTER_PACK'); }
validatePack();
export function contentExhausted(room: Room): boolean { return !pack.some(w=>room.settings.categories.includes(w.category) && !room.used.some(u=>[w.word,...w.aliases].some(a=>normalizeGuess(a)===u))); }
export function select(room: Room) { if (room.packVersion !== PACK_VERSION) throw new Error('UNSUPPORTED_PACK_VERSION'); const allowed=room.settings.categories.length ? room.settings.categories : catalog; if (allowed.some(c=>!catalog.includes(c))) throw new Error('INVALID_CATEGORY'); const options=pack.filter(w=>allowed.includes(w.category) && !room.used.some(u=>[w.word,...w.aliases].some(a=>normalizeGuess(a)===u))); if (!options.length) throw new Error('CONTENT_EXHAUSTED'); const eligibleCategories=[...new Set(options.map(w=>w.category))]; const category=eligibleCategories[randomInt(eligibleCategories.length)]; const categoryOptions=options.filter(w=>w.category===category); const players=room.players.filter(p=>!p.left).map(p=>p.uid); const order=players.slice(); for (let i=order.length-1;i>0;i--) { const j=randomInt(i+1); [order[i],order[j]]=[order[j],order[i]]; } return {word:categoryOptions[randomInt(categoryOptions.length)],imposter:players[randomInt(players.length)],order}; }





