type CategoryIdentity = {key:string;label:string};

const arabicNumber = (value: number) => value.toLocaleString('ar');

/**
 * Equal labels may refer to different original collections. Keep them distinguishable with a
 * stable, readable ordinal (ordered by their IDs) rather than showing the raw internal ID.
 */
export function CategorySourceContext({category,categories}:{category:CategoryIdentity;categories:readonly CategoryIdentity[]}) {
  const same = categories.filter(row => row.label === category.label).map(row => row.key);
  const keys = [...new Set(same)].sort();
  if (keys.length < 2) return null;
  const position = keys.indexOf(category.key) + 1;
  return <small className="enta-category-source" title={category.key}>المجموعة {arabicNumber(position)} من {arabicNumber(keys.length)}</small>;
}
