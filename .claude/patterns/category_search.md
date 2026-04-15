# Category Search Pattern
Find marketplace category by PIM category name.

1. Extract leaf from path: "A -> B -> C" → "C"
2. Tokenize + prefix(4 chars): "Чайники электрические" → ["чайн", "элек"]
3. For each MP category:
   - Get leaf from path
   - Tokenize leaf + full path
   - Score: leaf_recall * priority > full_recall
4. Best score > 0.5 → use that category ID

Used in: marketplace-attributes endpoint, syndication push
