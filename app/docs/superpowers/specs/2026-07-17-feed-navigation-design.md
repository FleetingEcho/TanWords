# Scalable Feed Navigation

## Goal

Keep feed navigation usable with dozens of subscriptions without replacing the existing compact, single-row header.

## Interaction

`All` and up to five user-pinned feeds remain visible. Unpinned feeds live in a searchable `More` menu grouped into Articles and Podcasts. A selected unpinned feed appears temporarily in the top row. The menu lets users pin feeds and override their automatically detected Article/Podcast category.

## Data

Persist an optional category override, pinned state, and pin order on `rss_feeds`. Existing feeds default to automatic category detection based on audio enclosures, while the first five feeds are pinned during migration. Manual category choices are never overwritten by synchronization.

## Validation

The backend enforces valid categories and a maximum of five pinned feeds. Tests cover migration and preference updates; frontend checks cover the compact navigation and menu behavior.
