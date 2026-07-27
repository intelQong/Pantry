/**
 * A starter vocabulary of grocery items, in English, used to autocomplete the
 * name field when adding something.
 *
 * It exists because an empty pantry is the hardest moment in the app: you have
 * to type twenty item names from memory before it does anything useful.
 * Suggestions turn that into tapping. The list leans towards a Bangladeshi
 * kitchen because that is whose kitchen this is — a generic Western grocery
 * list would suggest "kale" and miss "masoor dal".
 *
 * Categories are matched by name against the household's own categories, so a
 * suggestion can prefill the category too. A miss is harmless: the field just
 * stays empty.
 */

export interface Suggestion {
  name: string;
  /** Matched loosely against category names; see `matchCategory`. */
  category: string;
  /** Typical restock interval in days — a starting guess the engine refines. */
  days: number;
}

export const CATALOG: Suggestion[] = [
  // Grains & staples
  { name: "Rice", category: "Grains", days: 21 },
  { name: "Atta (Wheat Flour)", category: "Grains", days: 21 },
  { name: "Maida (Plain Flour)", category: "Grains", days: 30 },
  { name: "Semolina (Suji)", category: "Grains", days: 45 },
  { name: "Masoor Dal (Red Lentils)", category: "Grains", days: 21 },
  { name: "Moong Dal", category: "Grains", days: 30 },
  { name: "Chana Dal", category: "Grains", days: 30 },
  { name: "Chickpeas", category: "Grains", days: 30 },
  { name: "Pasta", category: "Grains", days: 30 },
  { name: "Noodles", category: "Grains", days: 21 },
  { name: "Oats", category: "Grains", days: 30 },
  { name: "Poha (Flattened Rice)", category: "Grains", days: 45 },

  // Dairy & eggs
  { name: "Milk", category: "Dairy", days: 4 },
  { name: "Eggs", category: "Dairy", days: 7 },
  { name: "Yogurt", category: "Dairy", days: 7 },
  { name: "Butter", category: "Dairy", days: 21 },
  { name: "Cheese", category: "Dairy", days: 14 },
  { name: "Condensed Milk", category: "Dairy", days: 45 },
  { name: "Powdered Milk", category: "Dairy", days: 45 },

  // Meat & fish
  { name: "Chicken", category: "Meat", days: 7 },
  { name: "Beef", category: "Meat", days: 14 },
  { name: "Mutton", category: "Meat", days: 21 },
  { name: "Fish", category: "Meat", days: 5 },
  { name: "Hilsa", category: "Meat", days: 21 },
  { name: "Prawns", category: "Meat", days: 14 },

  // Produce
  { name: "Onions", category: "Produce", days: 10 },
  { name: "Potatoes", category: "Produce", days: 12 },
  { name: "Tomatoes", category: "Produce", days: 6 },
  { name: "Garlic", category: "Produce", days: 21 },
  { name: "Ginger", category: "Produce", days: 14 },
  { name: "Green Chilli", category: "Produce", days: 6 },
  { name: "Coriander", category: "Produce", days: 5 },
  { name: "Spinach", category: "Produce", days: 5 },
  { name: "Cauliflower", category: "Produce", days: 7 },
  { name: "Cabbage", category: "Produce", days: 10 },
  { name: "Carrots", category: "Produce", days: 10 },
  { name: "Cucumber", category: "Produce", days: 6 },
  { name: "Aubergine (Brinjal)", category: "Produce", days: 7 },
  { name: "Okra (Lady's Finger)", category: "Produce", days: 6 },
  { name: "Pumpkin", category: "Produce", days: 14 },
  { name: "Bananas", category: "Produce", days: 5 },
  { name: "Apples", category: "Produce", days: 10 },
  { name: "Oranges", category: "Produce", days: 10 },
  { name: "Mangoes", category: "Produce", days: 7 },
  { name: "Lemons", category: "Produce", days: 12 },
  { name: "Papaya", category: "Produce", days: 10 },

  // Spices & condiments
  { name: "Salt", category: "Spices", days: 60 },
  { name: "Sugar", category: "Spices", days: 30 },
  { name: "Turmeric Powder", category: "Spices", days: 60 },
  { name: "Chilli Powder", category: "Spices", days: 60 },
  { name: "Cumin", category: "Spices", days: 60 },
  { name: "Coriander Powder", category: "Spices", days: 60 },
  { name: "Garam Masala", category: "Spices", days: 90 },
  { name: "Bay Leaves", category: "Spices", days: 120 },
  { name: "Cardamom", category: "Spices", days: 90 },
  { name: "Cinnamon", category: "Spices", days: 90 },
  { name: "Black Pepper", category: "Spices", days: 90 },
  { name: "Mustard Oil", category: "Spices", days: 30 },
  { name: "Soybean Oil", category: "Spices", days: 21 },
  { name: "Olive Oil", category: "Spices", days: 60 },
  { name: "Ghee", category: "Spices", days: 45 },
  { name: "Vinegar", category: "Spices", days: 90 },
  { name: "Soy Sauce", category: "Spices", days: 90 },
  { name: "Tomato Ketchup", category: "Spices", days: 45 },
  { name: "Honey", category: "Spices", days: 90 },

  // Snacks & drinks
  { name: "Tea", category: "Snacks", days: 30 },
  { name: "Coffee", category: "Snacks", days: 30 },
  { name: "Biscuits", category: "Snacks", days: 10 },
  { name: "Bread", category: "Snacks", days: 4 },
  { name: "Chips", category: "Snacks", days: 14 },
  { name: "Nuts", category: "Snacks", days: 30 },
  { name: "Juice", category: "Snacks", days: 10 },
  { name: "Soft Drinks", category: "Snacks", days: 14 },

  // Household & cleaning
  { name: "Dish Soap", category: "Household", days: 30 },
  { name: "Laundry Detergent", category: "Household", days: 30 },
  { name: "Floor Cleaner", category: "Household", days: 45 },
  { name: "Toilet Cleaner", category: "Household", days: 45 },
  { name: "Bin Bags", category: "Household", days: 30 },
  { name: "Kitchen Towels", category: "Household", days: 30 },
  { name: "Aluminium Foil", category: "Household", days: 90 },
  { name: "Matches", category: "Household", days: 60 },

  // Personal care
  { name: "Toothpaste", category: "Personal", days: 30 },
  { name: "Shampoo", category: "Personal", days: 45 },
  { name: "Soap", category: "Personal", days: 21 },
  { name: "Toilet Paper", category: "Personal", days: 21 },
  { name: "Razor Blades", category: "Personal", days: 30 },
  { name: "Deodorant", category: "Personal", days: 60 },
  { name: "Hand Wash", category: "Personal", days: 30 },
];

/**
 * Ranks suggestions for a query. Prefix matches come first because that is what
 * someone typing three letters is almost always reaching for; substring matches
 * follow so "dal" still surfaces "Masoor Dal".
 */
export function suggest(query: string, exclude: Set<string>, limit = 6): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const prefix: Suggestion[] = [];
  const contains: Suggestion[] = [];

  for (const entry of CATALOG) {
    const name = entry.name.toLowerCase();
    if (exclude.has(name)) continue;
    if (name.startsWith(q)) prefix.push(entry);
    else if (name.includes(q)) contains.push(entry);
  }

  return [...prefix, ...contains].slice(0, limit);
}

/** Finds the household category whose name best matches a suggestion's tag. */
export function matchCategory<T extends { id: string; name: string }>(
  categories: T[],
  tag: string,
): T | undefined {
  const t = tag.toLowerCase();
  return categories.find((c) => c.name.toLowerCase().includes(t));
}
