// Practising one category at a time (the address carries it: ?cat=idiom). "all" is the default.
import { CATEGORIES, CATEGORY_PLURAL, type Category } from "./schemas";

export type CategoryChoice = Category | "all";

export const parseCategory = (value: string | null | undefined): CategoryChoice =>
  (CATEGORIES as readonly string[]).includes(value ?? "") ? (value as Category) : "all";

export const inCategory = <T extends { category: string }>(cards: readonly T[], cat: CategoryChoice): T[] =>
  cat === "all" ? [...cards] : cards.filter((c) => c.category === cat);

// The categories the learner actually has cards in, in the usual order.
export const categoriesPresent = (cards: readonly { category: string }[]): Category[] =>
  CATEGORIES.filter((k) => cards.some((c) => c.category === k));

export const categoryName = (cat: CategoryChoice): string => (cat === "all" ? "" : CATEGORY_PLURAL[cat]);

// "/practice/flashcards?set=all&cat=idiom": only the parts that are set.
export function practiceUrl(path: string, parts: { cat?: CategoryChoice; set?: string; dir?: string } = {}): string {
  const q = new URLSearchParams();
  if (parts.set) q.set("set", parts.set);
  if (parts.dir) q.set("dir", parts.dir);
  if (parts.cat && parts.cat !== "all") q.set("cat", parts.cat);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
