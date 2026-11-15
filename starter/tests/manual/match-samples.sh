#!/usr/bin/env bash
# Regenerates the matching tables compared in docs/MANUAL_TESTING.md (M5.1).
cd "$(dirname "$0")/../.." || exit 2
npx tsx tests/manual/match.ts "Eggs" "dozen large eggs" "EXTRA virgin olive oil" "olive" "olives" "café" "CAFE" \
  "tomatoes" "tomato" "dish soap" "bread" "oat milk" "chicken thighs" "Creme fraiche" "cherry tomato salad" "!!!"
echo
npx tsx tests/manual/match.ts --catalog data/products.csv "Milk" "EVOO" "chicken breasts" "Nappy" "loo rolls" "OJ" \
  "Yoghurt" "Corn-flakes" "Tomato" "juice" "pasta" "oat milk" "chicken thighs" "almond milk" "dish soap" "rice cakes" "hot sauce"
