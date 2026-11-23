type CategoryIdentity = {key:string;label:string};

/** Equal labels may refer to different original collections. Keep their IDs intact. */
export function CategorySourceContext({category,categories}:{category:CategoryIdentity;categories:readonly CategoryIdentity[]}) {
  if (!categories.some(row => row.key !== category.key && row.label === category.label)) return null;
  return <small className="enta-category-source">مجموعة <bdi>{category.key}</bdi></small>;
}
