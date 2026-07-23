import { CHALLENGE_CATEGORIES, ChallengeCategory } from '../types';

const challengeCategorySet = new Set<string>(CHALLENGE_CATEGORIES);

export function isChallengeCategory(value: string): value is ChallengeCategory {
  return challengeCategorySet.has(value);
}

export function normalizeChallengeCategories(
  primary: ChallengeCategory,
  additional: readonly string[] = []
): ChallengeCategory[] {
  const categories: ChallengeCategory[] = [primary];

  for (const category of additional) {
    if (isChallengeCategory(category) && !categories.includes(category)) {
      categories.push(category);
    }
  }

  return categories;
}

export function formatChallengeCategories(categories: readonly ChallengeCategory[]): string {
  return categories.map((category) => category.toUpperCase()).join(' / ');
}
