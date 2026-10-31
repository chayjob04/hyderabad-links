# Category images

Pictures for category and subcategory pages, carried over from the original Hyderabad Links site.

**This folder is empty on purpose.** The images exist in the original project under
`WebZyte.HL.WebApp/wwwroot/DataMedia/PC` and `/SC`, but they are named by that site's numeric
category ids (`pc1-06-05-140.jpg`, `sc14bg-07-05-439.jpg`) and nothing in the files says which
category each one belongs to. The mapping lives only in two database columns.

## Getting the mapping

Run this against the original site's database (`Hyderab3_dev_hl_v1_db` on the shared host — the
connection string is in the original project's `appsettings.json`). It only reads:

```sql
SELECT PrimaryCategoryURL AS slug, PrimaryCategoryIcon AS icon, PrimaryCategoryBanner AS banner
FROM PrimaryCategory
WHERE IsActive = 1 AND (PrimaryCategoryIcon IS NOT NULL OR PrimaryCategoryBanner IS NOT NULL)
ORDER BY DisplayOrder;

SELECT SubCategoryURL AS slug, SubCategoryIcon AS icon, SubCategoryBanner AS banner
FROM SubCategory
WHERE IsActive = 1 AND (SubCategoryIcon IS NOT NULL OR SubCategoryBanner IS NOT NULL)
ORDER BY DisplayOrder;
```

The same tables exist in `hyderab3_workingmodel` but hold **no rows** — they are empty leftovers,
so querying the database this project uses will not produce the mapping.

## Then

1. Copy the named files into this folder.
2. Add one `slug: "filename.jpg"` line per category to
   `apps/main-website/src/lib/category-images.ts`, using **this** project's slugs.

`CategoryThumb` picks them up with no further change: a slug with no entry keeps the drawn icon it
uses today, so the map can be filled in a few categories at a time.

## One rule

Never assign an image to a category it does not depict. A photograph of a café on the Plumbers page
is a claim about businesses that are not there, and is worse than no photograph.
