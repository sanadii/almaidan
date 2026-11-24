import { useMemo, useState } from 'react';
import { categoryTopicIdForCategory, categoryTopics, type CategoryTopicId } from '../../data/category-filters';
import { CategoryArt } from './CategoryArt';
import { CategorySourceContext } from './CategorySourceContext';

type PickerCategory = { key: string; label: string };
type Props = {
  categories: readonly PickerCategory[];
  selected: readonly string[];
  count: number;
  disabled: boolean;
  search: string;
  onSearch: (value: string) => void;
  onChange: (next: string[]) => void;
};

const arabicDigits = (value: number) => value.toLocaleString('ar-KW');

/**
 * Picture-first category chooser: topic chips, grouped sections, search and a random fill.
 * Selection rules stay exactly those of the caller (`count`, keys only).
 */
export function CategoryPicker({ categories, selected, count, disabled, search, onSearch, onChange }: Props) {
  const [topic, setTopic] = useState<CategoryTopicId | 'all'>('all');
  const withTopics = useMemo(() => categories.map(category => ({ ...category, topic: categoryTopicIdForCategory({ id: category.key, displayNameAr: category.label }) })), [categories]);
  const presentTopics = useMemo(() => categoryTopics.filter(row => withTopics.some(category => category.topic === row.id)), [withTopics]);
  const query = search.trim();
  const visible = withTopics.filter(category => (topic === 'all' || category.topic === topic) && category.label.includes(query));
  const full = selected.length >= count;
  const labelOf = (key: string) => categories.find(category => category.key === key)?.label ?? 'فئة محفوظة';
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key]);
  const fillRandomly = () => {
    const pool = visible.filter(category => !selected.includes(category.key)).map(category => category.key);
    for (let index = pool.length - 1; index > 0; index--) { const swap = Math.floor(Math.random() * (index + 1)); [pool[index], pool[swap]] = [pool[swap], pool[index]]; }
    onChange([...selected, ...pool.slice(0, Math.max(0, count - selected.length))]);
  };
  const card = (category: PickerCategory) => {
    const order = selected.indexOf(category.key);
    return <button className="enta-category" type="button" key={category.key} aria-pressed={order >= 0} disabled={disabled || (order < 0 && full)} onClick={() => toggle(category.key)}>
      <CategoryArt categoryKey={category.key} label={category.label} />
      {order >= 0 ? <span className="enta-category__badge" aria-hidden="true">{arabicDigits(order + 1)}</span> : null}
      <span className="enta-category__label">{category.label}<CategorySourceContext category={category} categories={categories} /></span>
    </button>;
  };
  const grouped = topic === 'all' && !query;
  return <div className="enta-picker">
    <div className="enta-picker__tools">
      <label className="enta-picker__search">البحث في الفئات<input type="search" value={search} disabled={disabled} placeholder="مثلاً: عواصم، كرة، أنمي…" onChange={event => onSearch(event.target.value)} /></label>
      <button className="button enta-picker__random" type="button" disabled={disabled || full || !visible.some(category => !selected.includes(category.key))} onClick={fillRandomly}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.25" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" /></svg>
        {selected.length ? 'كمّلوها عشوائياً' : 'اختاروا لنا عشوائياً'}
      </button>
    </div>
    {presentTopics.length > 1 ? <div className="enta-topic-chips" role="group" aria-label="تصفية حسب الموضوع">
      <button type="button" aria-pressed={topic === 'all'} onClick={() => setTopic('all')}>الكل</button>
      {presentTopics.map(row => <button type="button" key={row.id} aria-pressed={topic === row.id} onClick={() => setTopic(row.id)}>{row.labelAr}</button>)}
    </div> : null}
    {selected.length ? <div className="enta-picker__tray" aria-label="الفئات المختارة">
      {selected.map((key, index) => <button type="button" className="enta-picker__chip" key={key} disabled={disabled} onClick={() => toggle(key)} aria-label={`إزالة ${labelOf(key)}`}><span aria-hidden="true">{arabicDigits(index + 1)}</span>{labelOf(key)}<span aria-hidden="true">×</span></button>)}
    </div> : null}
    <div className="enta-picker__results" tabIndex={0} aria-label="الفئات المتاحة">
    {grouped
      ? presentTopics.map(row => { const rows = visible.filter(category => category.topic === row.id); return rows.length ? <section className="enta-topic-section" key={row.id} aria-labelledby={`enta-topic-${row.id}`}><h3 id={`enta-topic-${row.id}`}><span>{row.labelAr}</span></h3><div className="enta-category-grid">{rows.map(card)}</div></section> : null; })
      : <div className="enta-category-grid">{visible.map(card)}</div>}
    </div>
    {!visible.length ? <p role="status">لا توجد فئات تطابق البحث. جرّبوا كلمة ثانية أو اختاروا «الكل».</p> : null}
  </div>;
}
