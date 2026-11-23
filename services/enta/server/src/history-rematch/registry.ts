import { deny, type Format, type Mode, type Profile as RulesProfile } from './core';

export interface Profile { readonly physicalProtocol: 2 | 3 | 4 | 5; readonly format: Format; readonly retainedRules: RulesProfile; readonly mode: Mode }
const profiles: readonly Profile[] = Object.freeze(([
 { physicalProtocol: 2, format: 'TIER_BOARD', retainedRules: 'enta-classic-2', mode: 'CLASSIC' },
 { physicalProtocol: 3, format: 'TIER_BOARD', retainedRules: 'enta-classic-3', mode: 'CLASSIC' },
 { physicalProtocol: 3, format: 'TIER_BOARD', retainedRules: 'enta-kids-3', mode: 'KIDS' },
 { physicalProtocol: 4, format: 'MIXED_BOARD', retainedRules: 'enta-format-1', mode: 'CLASSIC' },
 { physicalProtocol: 4, format: 'STANDALONE_LIST', retainedRules: 'enta-format-1', mode: 'LIST' },
 { physicalProtocol: 4, format: 'STANDALONE_ACTING', retainedRules: 'enta-format-1', mode: 'ACTING' },
 { physicalProtocol: 5, format: 'TIER_BOARD', retainedRules: 'enta-competitive-1', mode: 'CLASSIC' },
 { physicalProtocol: 5, format: 'MIXED_BOARD', retainedRules: 'enta-competitive-1', mode: 'CLASSIC' },
 { physicalProtocol: 5, format: 'STANDALONE_LIST', retainedRules: 'enta-competitive-1', mode: 'LIST' },
 { physicalProtocol: 5, format: 'STANDALONE_ACTING', retainedRules: 'enta-competitive-1', mode: 'ACTING' },
] satisfies Profile[]).map(p => Object.freeze(p)));

export function resolvePersistedProfile(value: unknown): Profile {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return deny('E3_PROFILE_INVALID');
 const p = value as Record<string, unknown>;
 if (Object.keys(p).sort().join('|') !== 'format|mode|physicalProtocol|retainedRules') return deny('E3_PROFILE_INVALID');
 const found = profiles.find(x => x.physicalProtocol === p.physicalProtocol && x.format === p.format && x.retainedRules === p.retainedRules && x.mode === p.mode);
 if (!found) return deny('E3_PROFILE_INVALID');
 return found;
}
export function assertProfileMatch(actual: Profile, requested: Profile): void {
 if (actual.physicalProtocol !== requested.physicalProtocol || actual.format !== requested.format || actual.retainedRules !== requested.retainedRules || actual.mode !== requested.mode) deny('E3_PROFILE_MISMATCH', 409);
}
