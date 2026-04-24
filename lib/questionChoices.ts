import type { Choice, QuestionCore } from "../types";

const LETTERS: Choice[] = ["A", "B", "C", "D", "E"];

export type ShuffledChoiceRow = {
  rank: number;
  letter: Choice;
  text: string;
};

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function coerceToAnswerString(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  return String(raw);
}

function normalizeCompare(s: string): string {
  return coerceToAnswerString(s)
    .trim()
    .replace(/^\uFEFF+/, "")
    .normalize("NFKC");
}

function choiceTextForLetter(q: QuestionCore, letter: Choice): string {
  switch (letter) {
    case "A":
      return q.choice_a;
    case "B":
      return q.choice_b;
    case "C":
      return q.choice_c;
    case "D":
      return q.choice_d;
    case "E":
      return q.choice_e;
    default:
      return "";
  }
}

function resolveCorrectLetter(q: QuestionCore, raw: unknown): Choice | null {
  const s = normalizeCompare(coerceToAnswerString(raw));
  if (!s) return null;

  const upper = s.toUpperCase();
  if (upper === "A" || upper === "B" || upper === "C" || upper === "D" || upper === "E") {
    return upper as Choice;
  }

  if (/^[1-5]$/.test(s)) {
    return LETTERS[Number(s) - 1];
  }

  const compact = s.replace(/\s+/g, "");
  const paren = compact.match(/^\(?([A-E])\)?\.?$/i);
  if (paren) {
    const L = paren[1].toUpperCase() as Choice;
    if (LETTERS.includes(L)) return L;
  }

  for (const letter of LETTERS) {
    const ct = normalizeCompare(choiceTextForLetter(q, letter));
    if (ct.length > 0 && ct === s) return letter;
  }

  return null;
}

function sortChoicesUnique(choices: Choice[]): Choice[] {
  const order = new Map(LETTERS.map((L, i) => [L, i] as const));
  return [...new Set(choices)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export function resolveCorrectChoices(q: QuestionCore): Choice[] {
  const raw = q.answer;
  const whole = resolveCorrectLetter(q, raw);
  if (whole !== null) {
    return [whole];
  }

  const s = normalizeCompare(coerceToAnswerString(raw));
  if (!s) return [];

  const parts = s.split(/[,，、;|]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    const L = resolveCorrectLetter(q, parts[0]);
    return L ? [L] : [];
  }

  const out: Choice[] = [];
  for (const p of parts) {
    const L = resolveCorrectLetter(q, p);
    if (L) out.push(L);
  }
  return sortChoicesUnique(out);
}

export function getRequiredAnswerCount(q: QuestionCore): number {
  const n = resolveCorrectChoices(q).length;
  return n > 0 ? n : 1;
}

export function formatChoicesForLog(choices: Choice[]): string {
  return sortChoicesUnique(choices).join(",");
}

export function parseLoggedChoices(selected: string | null | undefined): Choice[] {
  if (selected == null || !String(selected).trim()) return [];
  const parts = String(selected)
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  const out: Choice[] = [];
  for (const p of parts) {
    if (LETTERS.includes(p as Choice)) out.push(p as Choice);
  }
  return sortChoicesUnique(out);
}

export function isChosenSetCorrect(q: QuestionCore, picked: Choice[]): boolean {
  const correct = resolveCorrectChoices(q);
  if (correct.length === 0) return false;
  if (picked.length !== correct.length) return false;
  return formatChoicesForLog(picked) === formatChoicesForLog(correct);
}

export function togglePickedChoice(current: Choice[], letter: Choice, max: number): Choice[] {
  const s = new Set(current);
  if (s.has(letter)) {
    s.delete(letter);
  } else {
    if (s.size >= max) return sortChoicesUnique([...s]);
    s.add(letter);
  }
  return sortChoicesUnique([...s]);
}

export function formatUserFacingCorrectAnswer(q: QuestionCore): string {
  const letters = resolveCorrectChoices(q);
  if (letters.length === 0) return coerceToAnswerString(q.answer);
  if (letters.length === 1) {
    const L = letters[0];
    const fullMatch = resolveCorrectLetter(q, q.answer);
    if (fullMatch) return choiceTextForLetter(q, L);
    return coerceToAnswerString(q.answer);
  }
  return letters.map((L) => `${L}「${choiceTextForLetter(q, L)}」`).join(" と ");
}

export function formatUserPickedDisplay(q: QuestionCore, picked: Choice[]): string {
  if (picked.length === 0) return "—";
  return picked.map((L) => `${L}「${choiceTextForLetter(q, L)}」`).join(" と ");
}

export function buildShuffledChoiceRows(q: QuestionCore): ShuffledChoiceRow[] {
  const pairs = LETTERS.map((letter) => ({
    letter,
    text: choiceTextForLetter(q, letter),
  }));
  const shuffled = fisherYates(pairs);
  return shuffled.map((p, i) => ({
    rank: i + 1,
    letter: p.letter,
    text: p.text,
  }));
}
