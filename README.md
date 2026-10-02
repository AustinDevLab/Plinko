# Plinko

A free, play-money Plinko game that runs entirely in your browser. Pick a risk level and number of rows, drop the ball, and watch your stats build up.

**[Play it live](https://AustinDevLab.github.io/plinko/)** <!-- update after enabling GitHub Pages -->

> **Play money only.** The currency (₡) is fictional, has no cash value, and cannot be cashed out. This is a simulation for entertainment, not a gambling service, and it is not affiliated with any casino or brand.

## Features

- Three risk levels (Low, Medium, High) and 8 to 16 rows
- Wager controls with half / double buttons and an Auto Drop mode
- Balance, stats and settings saved in your browser (`localStorage`)
- Stats panel: balls dropped, wagered, payout, net, win rate, return, best multiplier, best streak
- Drop simulator that adds up to 100 million simulated drops to your stats in the background
- Optional sound effects, a music player, and a Kick stream and chat embed

## How the math works

Each ball makes one left or right choice per row, so the landing bucket follows a binomial distribution. Bucket payouts grow exponentially toward the edges (base 1.88, 2.68 or 4.21 for Low, Medium and High), then all multipliers are scaled so the long-run return is **99%**. Payouts are rounded down to whole cents, so the effective return is slightly lower at very small bets.

Randomness comes from a seeded generator whose seed is picked with `Math.random()` in the browser. It is **not** provably fair, which is fine for play money.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `style.css` | Small custom styles (the rest is Tailwind via CDN) |
| `game.js` | Game logic, canvas rendering, balance, stats, simulator, sound |
| `kick.js` | Kick stream and chat embed and the live Streamers list |
| `music.js` | Custom music player controls |

## Known limitations

- **Streamers list:** it queries Kick directly from the browser, which Kick may block (CORS). If it shows "Couldn't reach Kick", route the requests through a small proxy such as a Cloudflare Worker.
- **Music:** audio is streamed through an embedded SoundCloud widget, driven by the page's own controls. Some tracks in a playlist may be 30-second previews, which the player skips.
- **Tailwind:** loaded from the Play CDN for simplicity. For production, build the CSS with the Tailwind CLI.

## License

[MIT](LICENSE)
