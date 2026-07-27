/**
 * Splash lines for the dashboard greeting, in the spirit of Minecraft's title
 * screen. These are written for this app rather than borrowed: Mojang's list is
 * their creative work, and half of it ("Also try Terraria!") means nothing to
 * someone deciding whether to buy rice.
 *
 * House style, kept deliberately narrow so they read as one voice:
 *   - short enough for one line on a phone
 *   - exclamatory, absurd, or quietly ominous
 *   - occasionally self-aware about being an app
 *   - never instructional -- the rest of the interface does that job
 */
const SPLASHES = [
  "Now with 100% more lentils!",
  "Rice is a renewable resource!",
  "The onions are watching.",
  "Don't forget the coriander!",
  "Powered by hunger!",
  "No microtransactions!",
  "Statistically, you need rice.",
  "Buy low, eat well!",
  "The pantry remembers.",
  "Two humans, one list!",
  "Milk expires. Love doesn't.",
  "Sponsored by the fridge!",
  "Garlic never goes bad enough!",
  "Achievement unlocked: bought salt",
  "40% fewer forgotten eggs!",
  "As seen in your kitchen!",
  "Bulk buying is not a personality!",
  "Ctrl+S your groceries!",
  "Now in delicious 2D!",
  "The lentils know what you did.",
  "Made with real ingredients!",
  "Certified pantry-adjacent!",
  "Your future self says thanks!",
  "Salt: still cheap!",
  "Crunchy where applicable!",
  "It's a list. It's an app. It's both!",
  "Shelf-stable since 2026!",
  "The spice rack is judging you.",
  "Approximately edible!",
  "Contains no actual pantry!",
  "Buy the good tea!",
  "Somebody has to remember.",
  "Groceries: they're back!",
  "Now fortified with reminders!",
  "The eggs were a mistake.",
  "Ambient turmeric detected!",
  "Try turning it off and on again!",
  "Zero calories, all vibes!",
  "Not a meal planner!",
  "You're out of something.",
  "Free with purchase of nothing!",
  "This line was chosen at random!",
  "Compatible with most kitchens!",
  "Chickpeas: underrated!",
  "Warning: may cause shopping.",
  "The fridge is not your friend.",
  "Hand-picked by an algorithm!",
  "One tap closer to dinner!",
] as const;

/** Lines shown only on the days they belong to, checked before the random pool. */
function seasonal(now: Date): string | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (month === 1 && day === 1) return "New year, same grocery list!";
  if (month === 12 && day >= 24 && day <= 26) return "Happy holidays!";
  if (month === 2 && day === 14) return "Buy them the good chocolate!";
  return null;
}

/**
 * Picks a line. Randomised per app open, the way Minecraft rerolls per launch --
 * a stable daily line would be read once and then stop being noticed.
 */
export function pickSplash(now: Date = new Date()): string {
  return seasonal(now) ?? SPLASHES[Math.floor(Math.random() * SPLASHES.length)]!;
}

/** Greeting keyed to the hour, in the reader's own local time. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}
