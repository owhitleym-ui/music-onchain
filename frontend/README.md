# Music predictions demo

From this folder, start the local website with

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open [the demo](http://127.0.0.1:5173/). It starts with $1,000 in demo funds and five completed example purchases. New purchases stay pending. The wallet menu contains Reset demo.

Artists, view history, and crowds are sample data. Purchases, followed artists, balance, and theme are stored in this browser. The frontend runs directly as browser modules.

`data.js` supplies songs, artists, hourly rounds, chart history, and sample crowds. `store.js` handles demo purchases, validation, persistence, crowd statistics, and portfolio totals. `app.js` renders the three pages and dialogs. `chart.js` draws the historical chart, forecast controls, and saved 100-rank reward curve.

Each round accepts entries for one hour. The 24h, 48h, and one-week choices count hours 0–24, 24–48, and 144–168 from its start. Times are displayed in America/Chicago.
