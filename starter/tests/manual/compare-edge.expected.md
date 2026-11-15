## storeMissingItem: A store that does not sell one item (C has no eggs)

storeIds ["a","b","c"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":3,"b":2.5,"c":2} average 2.5 high 3 low 2 lowStoreIds ["c"] savings 0.5 savingsPct 20
  eggs (qty 1, product p-eggs): lineTotals {"a":4,"b":4.5,"c":null} average 4.25 high 4.5 low 4 lowStoreIds ["a"] savings 0.25 savingsPct 5.88235294117647
  bread (qty 1, product p-bread): lineTotals {"a":2,"b":2.2,"c":1.5} average 1.9 high 2.2 low 1.5 lowStoreIds ["c"] savings 0.4 savingsPct 21.052631578947366
storeTotals:
  a: total 9 complete true missing [] vsOptimal 1.5 (20%) vsCheapest 0 (0%)
  b: total 9.2 complete true missing [] vsOptimal 1.7 (22.666666666666664%) vsCheapest 0.2 (2.2222222222222223%)
  c: total 3.5 complete false missing ["eggs"] vsOptimal -4 (-53.333333333333336%) vsCheapest 0 (0%)
summary: {"averageTotal":9.1,"highTotal":9.7,"optimalTotal":7.5,"savings":1.6,"savingsPct":17.582417582417584,"cheapestStoreId":"a","unpricedKeys":[]}

## unmatchedItem: An item with no product (and one whose product nobody sells)

storeIds ["a","b"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":3,"b":2.5} average 2.75 high 3 low 2.5 lowStoreIds ["b"] savings 0.25 savingsPct 9.090909090909092
  mystery (qty 1, product null): lineTotals {"a":null,"b":null} average null high null low null lowStoreIds [] savings 0 savingsPct 0
  discontinued (qty 1, product p-gone): lineTotals {"a":null,"b":null} average null high null low null lowStoreIds [] savings 0 savingsPct 0
  milk-2 (qty 1, product p-milk): lineTotals {"a":3,"b":2.5} average 2.75 high 3 low 2.5 lowStoreIds ["b"] savings 0.25 savingsPct 9.090909090909092
storeTotals:
  a: total 6 complete true missing [] vsOptimal 1 (20%) vsCheapest 1 (20%)
  b: total 5 complete true missing [] vsOptimal 0 (0%) vsCheapest 0 (0%)
summary: {"averageTotal":5.5,"highTotal":6,"optimalTotal":5,"savings":0.5,"savingsPct":9.090909090909092,"cheapestStoreId":"b","unpricedKeys":["mystery","discontinued"]}

## quantities: Quantities of 3 (and 1.5, 0.333)

storeIds ["a","b"]
rows:
  milk (qty 3, product p-milk): lineTotals {"a":13.05,"b":11.97} average 12.51 high 13.05 low 11.97 lowStoreIds ["b"] savings 0.54 savingsPct 4.316546762589928
  rice (qty 1.5, product p-rice): lineTotals {"a":2.99,"b":3.15} average 3.07 high 3.15 low 2.99 lowStoreIds ["a"] savings 0.08 savingsPct 2.6058631921824107
  cheese (qty 0.333, product p-cheese): lineTotals {"a":1.07,"b":1} average 1.035 high 1.07 low 1 lowStoreIds ["b"] savings 0.035 savingsPct 3.3816425120772946
storeTotals:
  a: total 17.11 complete true missing [] vsOptimal 1.15 (7.205513784461153%) vsCheapest 0.99 (6.141439205955335%)
  b: total 16.12 complete true missing [] vsOptimal 0.16 (1.0025062656641603%) vsCheapest 0 (0%)
summary: {"averageTotal":16.615,"highTotal":17.27,"optimalTotal":15.96,"savings":0.655,"savingsPct":3.9422208847427025,"cheapestStoreId":"b","unpricedKeys":[]}

## noStores: No stores

storeIds []
rows:
  milk (qty 1, product p-milk): lineTotals {} average null high null low null lowStoreIds [] savings 0 savingsPct 0
  mystery (qty 1, product null): lineTotals {} average null high null low null lowStoreIds [] savings 0 savingsPct 0
storeTotals:
summary: {"averageTotal":0,"highTotal":0,"optimalTotal":0,"savings":0,"savingsPct":0,"cheapestStoreId":null,"unpricedKeys":["milk","mystery"]}

## noLines: No lines (an empty list)

storeIds ["a","b"]
rows:
storeTotals:
  a: total 0 complete true missing [] vsOptimal 0 (0%) vsCheapest 0 (0%)
  b: total 0 complete true missing [] vsOptimal 0 (0%) vsCheapest 0 (0%)
summary: {"averageTotal":0,"highTotal":0,"optimalTotal":0,"savings":0,"savingsPct":0,"cheapestStoreId":"a","unpricedKeys":[]}

## tiedStores: Two stores tied on price (A and B)

storeIds ["a","b","c"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":2.5,"b":2.5,"c":3} average 2.666666666666667 high 3 low 2.5 lowStoreIds ["a","b"] savings 0.16666666666666685 savingsPct 6.250000000000007
  eggs (qty 1, product p-eggs): lineTotals {"a":4.5,"b":4.5,"c":4.25} average 4.416666666666667 high 4.5 low 4.25 lowStoreIds ["c"] savings 0.16666666666666685 savingsPct 3.7735849056603814
storeTotals:
  a: total 7 complete true missing [] vsOptimal 0.25 (3.7037037037037033%) vsCheapest 0 (0%)
  b: total 7 complete true missing [] vsOptimal 0.25 (3.7037037037037033%) vsCheapest 0 (0%)
  c: total 7.25 complete true missing [] vsOptimal 0.5 (7.4074074074074066%) vsCheapest 0.25 (3.571428571428571%)
summary: {"averageTotal":7.083333333333334,"highTotal":7.5,"optimalTotal":6.75,"savings":0.3333333333333337,"savingsPct":4.705882352941181,"cheapestStoreId":"a","unpricedKeys":[]}

## unlistedStorePrices: Prices supplied for a store that is not in the list (Z)

storeIds ["a","b"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":3,"b":2.5} average 2.75 high 3 low 2.5 lowStoreIds ["b"] savings 0.25 savingsPct 9.090909090909092
  caviar (qty 1, product p-caviar): lineTotals {"a":null,"b":null} average null high null low null lowStoreIds [] savings 0 savingsPct 0
storeTotals:
  a: total 3 complete true missing [] vsOptimal 0.5 (20%) vsCheapest 0.5 (20%)
  b: total 2.5 complete true missing [] vsOptimal 0 (0%) vsCheapest 0 (0%)
summary: {"averageTotal":2.75,"highTotal":3,"optimalTotal":2.5,"savings":0.25,"savingsPct":9.090909090909092,"cheapestStoreId":"b","unpricedKeys":["caviar"]}

## noCompleteStore: No store sells everything

storeIds ["a","b"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":3,"b":null} average 3 high 3 low 3 lowStoreIds ["a"] savings 0 savingsPct 0
  eggs (qty 1, product p-eggs): lineTotals {"a":null,"b":4} average 4 high 4 low 4 lowStoreIds ["b"] savings 0 savingsPct 0
storeTotals:
  a: total 3 complete false missing ["eggs"] vsOptimal -4 (-57.14285714285714%) vsCheapest 0 (0%)
  b: total 4 complete false missing ["milk"] vsOptimal -3 (-42.857142857142854%) vsCheapest 0 (0%)
summary: {"averageTotal":3.5,"highTotal":7,"optimalTotal":7,"savings":-3.5,"savingsPct":-100,"cheapestStoreId":null,"unpricedKeys":[]}

## invalidPrice: A price that is not a finite number (NaN at A)

storeIds ["a","b"]
rows:
  milk (qty 1, product p-milk): lineTotals {"a":null,"b":2.5} average 2.5 high 2.5 low 2.5 lowStoreIds ["b"] savings 0 savingsPct 0
storeTotals:
  a: total 0 complete false missing ["milk"] vsOptimal -2.5 (-100%) vsCheapest 0 (0%)
  b: total 2.5 complete true missing [] vsOptimal 0 (0%) vsCheapest 0 (0%)
summary: {"averageTotal":2.5,"highTotal":2.5,"optimalTotal":2.5,"savings":0,"savingsPct":0,"cheapestStoreId":"b","unpricedKeys":[]}

