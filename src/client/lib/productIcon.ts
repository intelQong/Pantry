/**
 * Which icon a product gets, picked from its name.
 *
 * The icons are Microsoft's Fluent Emoji High Contrast set (MIT): monochrome,
 * drawn in currentColor, and -- unlike the usual line-icon sets -- it has the
 * kitchen in it: onion, garlic, rice, lentils, shrimp. Only the icons named
 * here are bundled; see scripts/product-icons.mjs.
 *
 * Names are free text that people type, so matching is by keyword, not by
 * exact name: "Masoor Dal (Red Lentils)", "moong dal" and "Chana Dal" all
 * reach the lentil rule.
 *
 * Rules are checked in order and the first match wins, so a specific rule
 * must sit above the general one it overlaps: "ice cream" before "cream",
 * "sweet potato" before "potato", "pineapple" before "apple".
 *
 * ponytail: a hand-kept keyword list. Covers the starter catalog and the
 * staples households actually log; anything else falls back to a letter tile.
 * Add a rule when a common item shows up as a letter.
 */
const RULES: Array<[RegExp, string]> = [
  // Utilities first: "gas" and "electric" must not reach anything below.
  [/\b(gas|cylinder|lpg)\b/, "fire"],
  [/\b(electric|electricity|recharge|prepaid meter)/, "high-voltage"],
  [/\b(wi-?fi|internet|broadband)\b/, "antenna-bars"],

  // Dairy
  [/\bice ?cream\b/, "ice-cream"],
  [/\bcondensed milk\b/, "canned-food"],
  [/\b(yog(h)?urt|youghurt|doi|curd)\b/, "bowl-with-spoon"],
  [/\b(milk|labang|buttermilk|lassi)\b/, "glass-of-milk"],
  [/\b(butter|ghee)\b/, "butter"],
  [/\b(cheese|paneer)\b/, "cheese-wedge"],
  [/\beggs?\b/, "egg"],
  [/\bcream\b/, "glass-of-milk"],

  // Grains
  [/\b(puffed rice|muri)\b/, "rice-cracker"],
  [/\b(rice|chal|poha)\b/, "cooked-rice"],
  [/\b(flour|atta|maida|besan|suji|semolina|cornflour)\b/, "sheaf-of-rice"],
  [/\b(dal|daal|lentils?|chickpeas?|chana|kidney beans|mugh|moong|masoor|mung)\b/, "beans"],
  [/\b(instant noodles|noodles|vermicelli|shemai|ramen)\b/, "steaming-bowl"],
  [/\b(pasta|spaghetti|macaroni)\b/, "spaghetti"],
  [/\b(oats|cornflakes|cereal|muesli)\b/, "bowl-with-spoon"],

  // A spice mix named after what it seasons is still a spice:
  // "Chicken masala" is a jar, not a drumstick.
  [/\b(masala|seasoning|spice mix)\b/, "jar"],

  // Meat & fish
  [/\b(nuggets?|chicken)\b/, "poultry-leg"],
  [/\bduck\b/, "duck"],
  [/\b(beef|mutton|meat|liver|lamb|keema|mince)\b/, "cut-of-meat"],
  [/\b(prawns?|shrimps?|chingri)\b/, "shrimp"],
  [/\b(fish|hilsa|ilish|rui|rohu|katla|pangash|tilapia|shutki)\b/, "fish"],

  // Vegetables
  [/\bsweet potato(es)?\b/, "roasted-sweet-potato"],
  [/\bpotato(es)?\b/, "potato"],
  [/\b(ketchup)\b/, "canned-food"],
  [/\btomato(es)?\b/, "tomato"],
  [/\bonions?\b/, "onion"],
  [/\bgarlic\b/, "garlic"],
  [/\bginger\b/, "ginger-root"],
  [/\b(chill?i|chill?ies|mor[io]ch)\b/, "hot-pepper"],
  [/\b(capsicum|bell pepper)\b/, "bell-pepper"],
  [/\b(cauliflower|broccoli)\b/, "broccoli"],
  [/\b(cabbage|spinach|lettuce|shak|lal shak)\b/, "leafy-green"],
  [/\b(coriander leaves|coriander|mint|herbs?|parsley|dhonia)\b(?! powder)/, "herb"],
  [/\bcarrots?\b/, "carrot"],
  [/\b(cucumber|gourd|lau|korola|jhinga|okra|lady'?s finger|zucchini)\b/, "cucumber"],
  [/\b(aubergine|brinjal|eggplant|begun)\b/, "eggplant"],
  [/\bpumpkin\b/, "jack-o-lantern"],
  [/\bmushrooms?\b/, "mushroom"],
  [/\b(peas|green beans|beans)\b/, "pea-pod"],
  [/\bcorn\b/, "ear-of-corn"],
  [/\bavocado\b/, "avocado"],

  // Fruit
  [/\bpineapple\b/, "pineapple"],
  [/\bwatermelon\b/, "watermelon"],
  [/\bbananas?\b/, "banana"],
  [/\bapples?\b/, "red-apple"],
  [/\b(oranges?|malta|tangerine)\b/, "tangerine"],
  [/\bmangoe?s?\b/, "mango"],
  [/\b(lemons?|limes?|lebu)\b/, "lemon"],
  [/\b(grapes|raisins)\b/, "grapes"],
  [/\b(litchis?|lychees?|cherr(y|ies))\b/, "cherries"],
  [/\b(strawberr(y|ies))\b/, "strawberry"],
  [/\b(pears?|guavas?)\b/, "pear"],
  [/\bcoconut\b/, "coconut"],
  [/\bdates\b/, "palm-tree"],
  [/\bkiwi\b/, "kiwi-fruit"],

  // Pantry
  [/\bsalt\b/, "salt"],
  [/\bhoney\b/, "honey-pot"],
  [/\b(sugar|jaggery|gur|candy)\b/, "candy"],
  [/\bolive oil\b/, "olive"],
  [/\b(oil|soybean)\b/, "pouring-liquid"],
  [/\b(soy sauce|vinegar|sauce)\b/, "sake"],
  [/\b(turmeric|cumin|jeera|masala|cardamom|cinnamon|pepper|cloves?|anise|bay leaves|fenugreek|methi|nigella|kalo ?jeera|kalojira|panch phoron|nutmeg|mustard|spices?|powder)\b/, "jar"],
  [/\b(pickle|achar|mayonnaise|mayo|jam|tamarind)\b/, "jar"],
  [/\b(baking powder|yeast|vanilla)\b/, "cupcake"],

  // Drinks & snacks
  [/\b(green tea|tea|tea leaves|cha)\b/, "teacup-without-handle"],
  [/\bcoffee\b/, "hot-beverage"],
  [/\bjuice\b/, "beverage-box"],
  [/\b(soft drinks?|cold drinks?|soda|cola|coke|pepsi|sprite|7up)\b/, "cup-with-straw"],
  [/\b(drinking water|water)\b/, "droplet"],
  [/\b(biscuits?|cookies?)\b/, "cookie"],
  [/\b(bread|buns?|loaf|toast)\b/, "bread"],
  [/\b(parath?a|roti|naan|chapati)\b/, "flatbread"],
  [/\b(singara|samosa|dumplings?|momo)\b/, "dumpling"],
  [/\bcake\b/, "shortcake"],
  [/\bchocolate\b/, "chocolate-bar"],
  [/\b(nuts|peanuts?|almonds?|cashews?|chanachur|pistachio)\b/, "peanuts"],
  [/\b(chips|crisps|popcorn)\b/, "popcorn"],

  // Household & personal care
  [/\b(toilet paper|tissues?|kitchen towels?|napkins?)\b/, "roll-of-paper"],
  [/\b(hand wash|handwash|soap)\b/, "soap"],
  [/\b(shampoo|conditioner|detergent|cleaner|lotion|deodorant|dish ?wash|bleach)\b/, "lotion-bottle"],
  [/\btooth ?(paste|brush)\b/, "toothbrush"],
  [/\b(razor|blades?)\b/, "razor"],
  [/\b(bin bags?|garbage bags?|trash bags?)\b/, "wastebasket"],
  [/\b(batter(y|ies)|aa|aaa)\b/, "battery"],
  [/\b(matches|lighter|candles?)\b/, "candle"],
  [/\b(foil|cling ?film)\b/, "fork-and-knife-with-plate"],
];

/** The icon name for this product, or null when nothing on the list matches. */
export function productIcon(name: string): string | null {
  const n = name.toLowerCase();
  for (const [pattern, icon] of RULES) {
    if (pattern.test(n)) return icon;
  }
  return null;
}
