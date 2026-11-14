# Bucharest price map: design

Date: 2026-11-14

## Intent

Cosmin and his spouse are buying an apartment in Bucharest. They want one place to see where prices per m² are high or low, which areas fit their life (metro, parks, everyday facilities, traffic), and which actual apartments on sale are good value, with a link to the original post.

It is a personal tool. It will be hosted as a private website so the spouse, and later a few friends, can use it.

## Goals

- A map of Bucharest you can pan and zoom, coloured by asking price per m², computed from real sale listings.
- A list of real apartments beside the map, sorted by best value, each linking to the original post.
- Filters that hide the parts of the city that don't fit: price, walking time to metro, a park nearby, other facilities nearby.
- A traffic layer in the style of Google Maps (streets in green, amber, red) with a morning / midday switch.
- It looks and feels good. Cosmin is a product designer and will judge it on that.

## Non-goals

- Rentals. This is for buying.
- A public product: no accounts, sign-up, SEO, or handling of heavy traffic.
- Facebook Marketplace as a source. It needs a logged-in account, automated collection risks that account, and posts rarely state m² or an exact location.
- Price history and price-drop alerts. The data model should not block them, but they are not built now.
- Contacting sellers or saving favourites. Possible later.

## Anti-goals

- Showing a heatmap that looks precise but is built on thin or duplicated data. A cell with too few listings must say so instead of showing a confident colour.
- Getting the user's home IP or accounts blocked by collecting aggressively.
- Monthly costs. Everything should fit in free tiers.

## Constraints

- Cosmin is not a developer. He cannot review code, so every milestone must end in something he can open and judge, and the project needs simple run commands.
- Collection runs against the sites' terms of use. It stays private, low volume (one polite sweep a day, one request at a time about 1.2 seconds apart), and always links back to the original post.
- No paid services without asking first.

## Approaches considered

For where prices come from:

1. **Neighbourhood averages.** Colour about 80 cartiere using published average prices. Free and quick, but coarse, and no listings.
2. **Listings first (chosen).** A small daily collector gathers sale listings; the heatmap is computed from them and the listings are shown with links. Free and fine-grained. The cost is upkeep when a site changes, and the terms-of-use point above.
3. **Paid data feed.** A third-party service delivers listings. Low upkeep, about €30 to €100 a month.

Cosmin picked 2. For an apartment hunt the listings are the real value, and the heatmap comes from the same data.

For how filters behave, three were mocked up: Mask (failing areas fade out), Overlay (metro and parks drawn on top), Score (one colour for overall fit). The chosen screen uses Mask.

For the screen, four prototypes were compared (Atlas, Night, Listings, Blend). Cosmin picked **Blend**.

## What was decided, as decided

### The screen: Blend

The reference is `prototypes/map-versions.html`, fourth version. It is a throwaway prototype on sample data: copy its layout and behaviour, not its code.

- **Left panel.** Title, a line saying how many apartments match, the filters, then the list of matching apartments sorted by best value.
- **Map.** Light base map. Price cells (a honeycomb grid) coloured from teal (cheap) through sand to plum (expensive), with a legend. Metro lines and stations, parks and water are visible on top.
- **Mask.** Cells that fail the filters fade to almost nothing.
- **Pins.** Each matching apartment is a small white tag with its price in thousands of euros, outlined green, grey or red for under, near or over its area's median price per m². Non-matching apartments are small grey dots.
- **Card and pin are linked.** Hovering a card highlights its pin. Clicking a pin scrolls the list to its card.
- **Click an area to narrow.** Clicking a cell lists only that neighbourhood and dims the others. A "Show all areas" button clears it.
- **Hover a cell** to see its price per m², number of listings, and walking time to the nearest metro and park.
- **Apartment card.** Total price, value against the area median ("12% under the Titan median"), rooms, m², floor, year built, price per m², walking times, and "Open on Storia" (or the relevant site).
- **Traffic.** A toggle that draws major streets in green, amber or red, with a morning / midday switch.
- **States.** Empty (nothing matches: say what to loosen), loading, collection failed or data is stale (say when data was last updated), long titles and odd values in listings.

The colours and typefaces in the prototype (Bricolage Grotesque for display, Instrument Sans for text) are a first proposal that Cosmin has seen and not objected to. Treat them as the starting point, open to his feedback.

### Filters, area, devices, language (Cosmin's answers, 2026-11-14)

- **Filters:** besides max price per m², walk to metro and park nearby, the panel has total budget, number of rooms, minimum size in m², and year built.
- **Area:** Bucharest only, the six sectors. No Ilfov edge towns.
- **Devices:** designed for desktop first, and usable on a phone: a list / map switch and taps in place of hover, without special polish.
- **Language:** the whole interface is in Romanian. (The prototype's English labels are not the final copy.)

Claude's call on how the new filters meet the map: rooms, size and year change which listings a cell's colour is computed from, so the heatmap answers "price per m² for the kind of apartment we want". Total budget does not recolour cells; a cell fades when no listing in it fits the budget. With seven filters the panel in the prototype is too tight, so the filter area needs a fresh layout that Cosmin sees before it is built in.

### Sources

In this order, one at a time. The map must be fully useful with the first one alone.

1. Storia / OLX (one platform)
2. Imobiliare.ro
3. Anuntul.ro (assumed to be what Cosmin meant by "anunțuri imobiliare"; he did not correct it)

The same apartment appears on several sites and through several agencies. Duplicates are merged so they don't distort prices, and one card shows a link to each original post.

### What we know about Storia (checked 2026-11-14)

The public search page for apartments for sale in Bucharest returns its results as structured data embedded in the page, without logging in. One page holds 36 listings; there were 24,481 listings across 681 pages. Each listing carries total price, price per m², area, rooms, floor, street name, neighbourhood, whether it is a private owner or an agency, dates, and a link.

The search results give a street name and neighbourhood, not exact coordinates. Where each apartment sits on the map therefore has to come from the listing's own page or from looking up the street. This is the main open technical point.

## Calls made by Claude (not decisions Cosmin made)

- **Website type:** a static site. The collector produces data files; the website just reads them. No server to run, free to host.
- **Language:** TypeScript for both the collector and the website, so there is one toolchain.
- **Map engine:** MapLibre (open source) with free OpenStreetMap-based map tiles and a custom style. No per-view fees.
- **Price cells:** H3 hexagons, the standard honeycomb grid for maps. Cell size chosen so most cells in built-up areas have enough listings.
- **Storage:** one SQLite file on the machine that runs the collector, keeping every sweep so history is available later.
- **Metro, parks, facilities:** OpenStreetMap data. Walking times start as straight-line distance converted to minutes; real walking routes can replace it later if it proves misleading.
- **"Other facilities"** start as schools, kindergartens, supermarkets and hospitals or clinics, each as an optional filter.
- **Thin data:** a cell with fewer than a minimum number of listings (start with 5) is drawn hatched or pale and labelled "too few listings", and borrows nothing from neighbours.
- **Value against the median** uses the median price per m² of the apartment's neighbourhood.
- **Houses:** apartments first. Houses are a separate property type added after, because price per m² for houses with land is not comparable.
- **Where the collector runs:** on Cosmin's Mac to start, since home connections are far less likely to be blocked than cloud servers. Scheduling it daily comes in milestone 3.
- **Sharing:** the hosted site sits behind a login gate from the hosting provider's free tier (for example Cloudflare Pages with Access), with access granted by email address.
- **What a "neighbourhood" is:** the neighbourhood name the source site gives each listing (Storia provides one). No boundary map is needed. A cell belongs to the neighbourhood most of its listings name. When a neighbourhood has too few listings for a trustworthy median (start with 15), the card compares against the sector median instead and says so.
- **Thousands of matches:** the list shows apartments inside the visible part of the map that pass the filters, best value first, loaded in batches of 50. Price tags are drawn for the apartments currently in the list's first batch; the rest are dots until you zoom in or scroll. No clustering bubbles.
- **Storia only in milestone 1.** OLX property ads are largely cross-posted to Storia. Whether olx.ro adds enough extra private-owner ads to be worth its own collector is checked in milestone 4.
- **Positions, acceptance bar:** a listing counts as precisely placed when its position comes from the listing itself, or from a street lookup on a street shorter than about 500 m. Imprecisely placed listings still appear in the list (marked "approximate location") and count toward neighbourhood medians, but are left out of the price cells. If precise positions need one request per listing, the first full collection may be spread over several days; the map shows how much of the city is covered so far.
- **New developments:** kept, and marked "new development" on the card. Posts with a "from" price or covering many units are left out of cell colours and medians. A filter hides them. VAT is not normalised; the card repeats what the post says.
- **Not a git repository yet.** The folder should become one when building starts, so work can be undone.

## Milestones

Each ends in something Cosmin can open and judge.

1. **Real prices on the Blend screen, on his Mac.** Storia collector, storage, positions on the map, price cells, the apartment list and pins, the price / metro / park filters. Traffic and extra facilities are not in this milestone.
2. **Facilities and traffic.** Schools, kindergartens, supermarkets, clinics as filters. Traffic layer with the morning / midday switch.
3. **Online and automatic.** Hosted privately behind a login, collector running daily, "last updated" shown.
4. **More sources.** Imobiliare.ro, then Anuntul.ro, with duplicates merged.

The implementation plan covers milestone 1 first. Later milestones get their own plans.

## Risks and open points

- **Positions.** Described above. Milestone 1 starts with a short test of both routes (listing pages, street lookup) and picks the one that gives good positions at a polite request volume. If only street-level precision is achievable, pins sit on the street and the cards say "approximate location".
- **Pins placed loosely by agents (Cosmin, 2026-11-14).** Agents often don't put the pin on the building, but the street or neighbourhood they state is usually right. So the stated street and neighbourhood are trusted over the pin. A pin the site marks as approximate, or a spot shared by several different listings, is treated as approximate: the apartment stays in the list and in its neighbourhood's median, marked "poziție aproximativă", and is left out of the price cells. Cell colours use the median of at least 5 listings, so a single misplaced pin cannot swing a cell.
- **Blocking and site changes.** The collector must fail loudly and keep the last good data. The site shows the date of the last successful update.
- **Traffic at fixed times.** Live traffic is available on free tiers. "Typical 8:30 traffic" is normally a paid product. The idea is to record our own readings at 8:30 and 13:00 for a couple of weeks. Whether a provider's terms allow storing those readings must be checked in milestone 2. If not, the layer is live only, and Cosmin is asked before anything paid is considered.
- **Asking prices, not sale prices.** The map shows what sellers ask. The legend says "asking price".
- **Duplicates within one source.** Agencies repost the same apartment. Milestone 1 needs a basic same-source merge (same street, area, floor, rooms, close price) or the heatmap will be skewed by reposts.

## Left to the builder

- Project layout, framework for the website, test setup.
- How the collector paces and retries requests.
- The exact H3 cell size and the minimum-listings threshold, tuned against real data.
- The exact rule for merging duplicates.
- Data file format between collector and website.

## Additions after the first build (2026-11-14)

- **Second source:** Imobiliare.ro and OLX refuse automated requests (bot protection) and are not collected. Anuntul.ro is collected as the second source (about 2,400 Bucharest apartments).
- **Approximate pins:** Storia pins with a privacy radius colour the cells (cells are about 0.74 km²); their cards say "poziție aproximativă". Anuntul's automatically placed pins and any spot shared by four or more listings do not.
- **Unusual prices (Cosmin):** an apartment 40% or more under its area's median is labelled "Preț neobișnuit, verifică anunțul" and sorted to the end of the list.
- **Sector filter (Cosmin):** choosing one sector fades every other sector's cells and recolours the chosen sector's cells relative to each other, from its cheapest cell to its dearest; the legend shows that range.
- **Filter panel:** layout with all filters visible (Cosmin's choice), in three groups: price, apartment, area.

## Carried over from milestone 1's final review

Small improvements judged safe to leave, to pick up in the next milestone:

- Re-check a listing that was marked gone when it reappears in a later collection.
- Refuse to accept a collection that read implausibly few listings.
- Retry Anuntul.ro listings that were missing from its map page.
- Measure the walk to a park to its nearest edge, not its nearest corner point.
- Store how large each Storia privacy radius is, and keep pins with a very large radius (over about 500 m) out of the price cells.
- Prevent two collections from running at the same time.
- Report a site format change as such, instead of as a connection problem.
- Retry a page whose download stalls halfway.
- Show on screen when the last collection failed, not only when data is more than three days old.
- Keyboard access to map cells; stronger borders on controls; less screen-reader chatter while dragging sliders.
- Map performance with many price tags; walking times in the cell tooltip.
- Clean the agents' names out of git history before the project is uploaded anywhere.
