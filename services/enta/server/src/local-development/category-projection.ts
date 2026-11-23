/** Explicit public category groups. Physical source records and old matches stay intact. */
export const CATEGORY_PROJECTION_V1 = 'category-groups-v1' as const;
export const CATEGORY_PROJECTION_V2 = 'category-groups-v2' as const;
export const CATEGORY_PROJECTION_V3 = 'category-groups-v3' as const;
export const CURRENT_CATEGORY_PROJECTION = CATEGORY_PROJECTION_V3;
export type CategoryProjectionVersion = typeof CATEGORY_PROJECTION_V1 | typeof CATEGORY_PROJECTION_V2 | typeof CATEGORY_PROJECTION_V3;
const groups: Record<string, {key:string; label:string}> = {
 'tahadani-047': {key:'tahadani-047',label:'عملات'},
 'tahadani-games-272': {key:'tahadani-047',label:'عملات'},
 'tahadani-019': {key:'tahadani-019',label:'كرتون / ولا كلمة'},
 'tahadani-games-111': {key:'tahadani-019',label:'كرتون / ولا كلمة'},
};
const roundThreeGroups: typeof groups = {...groups};
for(const [key,alias,label] of [
 ['tahadani-068','tahadani-games-046','عالم الساعات'],
 ['tahadani-004','tahadani-games-022','من أنا / مسلسلات عربية'],
 ['tahadani-005','tahadani-games-011','من أنا / ممثلين'],
 ['tahadani-028','tahadani-games-455','أفلام كلاسيك'],
 ['tahadani-029','tahadani-games-458','أفلام رعب'],
]) {roundThreeGroups[key]={key,label};roundThreeGroups[alias]={key,label};}
const roundFiveGroups: typeof groups = {...roundThreeGroups};
for(const [key,alias,label] of [
 ['tahadani-058','tahadani-games-310','مطاعم الكويت'],
 ['tahadani-043','tahadani-games-523','ألعاب الطفولة'],
 ['tahadani-011','tahadani-games-134','خمن الصورة'],
 ['tahadani-012','tahadani-games-135','شنو هذا'],
 ['tahadani-014','tahadani-games-127','الجزء المفقود'],
 ['tahadani-020','tahadani-games-107','دول - ولا كلمة'],
]) {roundFiveGroups[key]={key,label};roundFiveGroups[alias]={key,label};}
function groupsFor(version?:CategoryProjectionVersion):typeof groups {
 if(version===undefined)return {};
 if(version===CATEGORY_PROJECTION_V1)return groups;
 if(version===CATEGORY_PROJECTION_V2)return roundThreeGroups;
 if(version===CATEGORY_PROJECTION_V3)return roundFiveGroups;
 throw Error('UNKNOWN_CATEGORY_PROJECTION');
}
export function canonicalCategoryId(key:string,version?:CategoryProjectionVersion):string {
 return groupsFor(version)[key]?.key??key;
}
export function hasCategoryGroup(key:string,version?:CategoryProjectionVersion):boolean {
 return Object.hasOwn(groupsFor(version),key);
}
export function projectedCategoryLabel(key:string,label:string,version?:CategoryProjectionVersion):string {
 return groupsFor(version)[key]?.label??label;
}
