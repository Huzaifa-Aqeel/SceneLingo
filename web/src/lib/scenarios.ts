// Real-world situations for the "Talk it out" conversation. The code picks the setting, so conversations stay
// varied and never repeat the scene a card came from; the model only fills in the details.

export type Tone = "casual" | "neutral" | "formal";
export interface Seed { key: string; setting: string; tone: Tone }

export const SEEDS: readonly Seed[] = [
  // work
  { key: "job-interview", setting: "a job interview with a hiring manager", tone: "formal" },
  { key: "performance-review", setting: "a yearly review with your manager", tone: "formal" },
  { key: "client-call", setting: "a phone call with a client about a delayed project", tone: "formal" },
  { key: "standup", setting: "a quick team meeting where a teammate is behind on their work", tone: "neutral" },
  { key: "shift-cover", setting: "asking a colleague to cover your shift", tone: "neutral" },
  { key: "coffee-machine", setting: "a chat with a coworker at the office coffee machine", tone: "casual" },
  { key: "team-lunch", setting: "lunch with your teammates after a stressful week", tone: "casual" },
  // service
  { key: "restaurant-mixup", setting: "a restaurant where your order came out wrong", tone: "neutral" },
  { key: "hotel-desk", setting: "the front desk of a hotel when your room is not ready", tone: "neutral" },
  { key: "faulty-item", setting: "a shop where you are returning a broken item", tone: "neutral" },
  { key: "phone-support", setting: "a call to your internet company about a problem", tone: "neutral" },
  { key: "airport", setting: "an airport desk after your flight was cancelled", tone: "neutral" },
  { key: "hair-salon", setting: "a hair salon where you want something different this time", tone: "casual" },
  { key: "rideshare", setting: "the back seat of a taxi, talking with the driver", tone: "casual" },
  // health
  { key: "doctor", setting: "a doctor's appointment about feeling worn out", tone: "neutral" },
  { key: "pharmacy", setting: "a pharmacy counter, asking about a medicine", tone: "neutral" },
  // home
  { key: "roommate", setting: "your kitchen, talking with a roommate about chores", tone: "casual" },
  { key: "landlord", setting: "a call with your landlord about a repair", tone: "neutral" },
  { key: "neighbour-noise", setting: "your front door, talking with a neighbour about noise", tone: "neutral" },
  { key: "family-dinner", setting: "a family dinner where your parent asks about your plans", tone: "casual" },
  { key: "sibling-party", setting: "planning a surprise birthday party with your sibling", tone: "casual" },
  // social
  { key: "weekend-trip", setting: "a group chat voice call planning a weekend trip with friends", tone: "casual" },
  { key: "meet-parents", setting: "meeting your partner's parents for the first time", tone: "neutral" },
  { key: "party", setting: "a house party where you only know the host", tone: "casual" },
  { key: "old-friend", setting: "a coffee with an old friend you have not seen in years", tone: "casual" },
  { key: "after-match", setting: "the changing room after a close football match", tone: "casual" },
  // study
  { key: "group-project", setting: "a group project meeting where one person has not done their part", tone: "neutral" },
  { key: "office-hours", setting: "a professor's office hours about a bad grade", tone: "formal" },
  { key: "study-group", setting: "a study group the night before an exam", tone: "casual" },
  // travel and community
  { key: "tourist", setting: "a street in a new city where you are lost", tone: "neutral" },
  { key: "hostel", setting: "a hostel common room, meeting other travellers", tone: "casual" },
  { key: "train-delay", setting: "a train platform during a long delay, talking with a stranger", tone: "casual" },
  { key: "volunteering", setting: "a volunteer day where the coordinator is short of people", tone: "neutral" },
  { key: "gym", setting: "a gym, talking with a trainer about your goals", tone: "casual" },
];

export const RECENT_KEY = "sceneLingo.talk.recent";
const KEEP = 6;

// Slang belongs among friends; everything else can happen anywhere. Settings used recently are skipped.
// Several are offered so the model can choose the one where the expression fits most naturally.
export function pickSeeds(category: string, recent: readonly string[] = [], count = 3, rng: () => number = Math.random): Seed[] {
  const tones: Tone[] = category === "slang" ? ["casual"] : ["casual", "neutral", "formal"];
  const fresh = SEEDS.filter((s) => tones.includes(s.tone) && !recent.includes(s.key));
  const all = SEEDS.filter((s) => tones.includes(s.tone));
  const pool = [...(fresh.length >= count ? fresh : all)];
  const out: Seed[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out;
}

export const readRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
};
export const rememberSeed = (key: string): void => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...readRecent().filter((k) => k !== key)].slice(0, KEEP))); } catch { /* the scene may repeat sooner, which is harmless */ }
};
