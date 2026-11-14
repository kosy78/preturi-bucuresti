# Unde am putea locui?

A private map of what apartments in Bucharest cost to buy. It collects the apartments for sale on Storia and Anuntul.ro, colours the city by the asking price per square metre, and lists the apartments in whatever part of the map you are looking at, the best value first. Filters cover budget, rooms, size, build year and the walk to the metro and to a park.

Everything runs on your own computer. Nothing is published.

## Commands

Run these in a terminal, from this folder.

```sh
npm run collect   # collects Storia and Anuntul.ro, then rebuilds the map data
npm run dev       # opens the site on your computer, at the address it prints
npm run deploy    # publishes the current map data to https://preturi-bucuresti.vercel.app
```

`npm run collect` does everything in one go: the Storia list, the Storia listing pages, the Anuntul.ro list and positions, and finally the map data. If the Storia list cannot be read, it stops there and the map keeps the last complete collection. If a later step stops, the others still run and the map data is still rebuilt from what was collected; the command then ends with a note that some steps did not succeed.

While it runs it keeps the Mac awake, but closing the lid still puts the Mac to sleep and stops the collection.

## How long a collection takes

The collector waits 1.2 seconds between requests on purpose, so the sites are not overloaded. A run first reads about 680 Storia search pages, which takes roughly half an hour, then opens up to 4,000 individual listing pages, which takes roughly three more hours.

Exact positions fill in gradually. Each run opens only up to 4,000 listings, so it takes several runs before most apartments sit at their real spot on the map. Until then the map says what share of apartments it can place exactly.

If a site refuses a request, the collector stops by itself and says so. Wait a while before running it again. The map keeps showing the last complete collection, and the positions found so far stay saved.

## About this public copy

The collector's parser tests read saved pages from Storia, Anuntul.ro and Imobiliare.ro (`collector/fixtures/`). Those pages are other people's content and are not published here, so those tests fail in this copy; everything else runs. The collected data (`data/`, `web/public/data/listings.json`) is not part of the repository either.
