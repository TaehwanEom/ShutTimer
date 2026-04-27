// v1.6 Phase 4: 루틴 카테고리 — 고정 10개 + 사용자 커스텀.
// category 는 Routine.category (string id)로 저장. 표시 이름은 i18n 조회 (고정) 또는 저장된 label (커스텀).

import AsyncStorage from '@react-native-async-storage/async-storage';

export type CategoryIcon = string; // MaterialIcons 이름

export type CategoryDef = {
  id: string;
  /** i18n 키 (고정 카테고리만). 커스텀은 null → label 직접 사용 */
  labelKey: string | null;
  /** 커스텀만 사용. 고정은 labelKey 로 번역 */
  label?: string;
  icon: CategoryIcon;
};

// ─── 고정 카테고리 — 표시 5개 (chores/work/bedtime/meal/growth 는 hide) ───

export const FIXED_CATEGORIES: readonly CategoryDef[] = [
  { id: 'morning',   labelKey: 'routine.category.morning',   icon: 'wb-sunny' },
  { id: 'evening',   labelKey: 'routine.category.evening',   icon: 'nights-stay' },
  { id: 'exercise',  labelKey: 'routine.category.exercise',  icon: 'fitness-center' },
  { id: 'study',     labelKey: 'routine.category.study',     icon: 'menu-book' },
  { id: 'medicine',  labelKey: 'routine.category.medicine',  icon: 'medication' },
  { id: 'etc',       labelKey: 'routine.category.etc',       icon: 'category' },
] as const;

// ─── 커스텀 제약 ─────────────────────────────────────────────

export const CUSTOM_CATEGORY_NAME_MAX = 10;

// ─── 커스텀 CRUD ─────────────────────────────────────────────

const CUSTOM_KEY = 'shuttimer_custom_categories';

export async function loadCustomCategories(): Promise<CategoryDef[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: any): c is CategoryDef =>
        c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.icon === 'string'
    );
  } catch {
    return [];
  }
}

async function saveCustomCategories(list: CategoryDef[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}

export type AddCustomResult =
  | { ok: true; list: CategoryDef[] }
  | { ok: false; reason: 'duplicate' | 'empty' | 'too_long' };

export async function addCustomCategory(rawName: string): Promise<AddCustomResult> {
  const name = rawName.trim();
  if (name.length === 0) return { ok: false, reason: 'empty' };
  if (name.length > CUSTOM_CATEGORY_NAME_MAX) return { ok: false, reason: 'too_long' };

  const list = await loadCustomCategories();

  const exists = FIXED_CATEGORIES.some(c => c.id === `custom_${name}`) ||
    list.some(c => c.label === name);
  if (exists) return { ok: false, reason: 'duplicate' };

  const next: CategoryDef = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    labelKey: null,
    label: name,
    icon: 'label',
  };
  const updated = [...list, next];
  await saveCustomCategories(updated);
  return { ok: true, list: updated };
}

export async function deleteCustomCategory(id: string): Promise<CategoryDef[]> {
  const list = await loadCustomCategories();
  const filtered = list.filter(c => c.id !== id);
  await saveCustomCategories(filtered);
  return filtered;
}

// ─── 조회 헬퍼 ───────────────────────────────────────────────

/** id로 카테고리 정의 조회. 고정/커스텀 모두. 없으면 null. */
export async function findCategoryById(id: string): Promise<CategoryDef | null> {
  const fixed = FIXED_CATEGORIES.find(c => c.id === id);
  if (fixed) return fixed;
  const custom = await loadCustomCategories();
  return custom.find(c => c.id === id) ?? null;
}
