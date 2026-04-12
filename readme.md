# RoBrowser -- Server Finder for Roblox

<img src="assets/icons/logoServerBrowser.png" alt="RoBrowser Banner" width="100%" />

RoBrowser is a lightweight Chrome extension (Manifest V3) that replaces the native Roblox server list with a faster, data-transparent alternative. It is built to help you find the right server without relying on guesswork.

---

## Features

* **Seamless Integration:** Injected directly into the game's About page so you don't have to switch tabs.
* **Connection Quality Categories:** Servers are grouped by real-time API latency ranges:
    * Excellent (< 60ms)
    * Good (60 - 120ms)
    * Fair (120 - 200ms)
    * Poor (> 200ms)
* **Player Previews:** Displays headshot thumbnails of the players currently inside each server before you join.
* **Smart Sorting:** Automatically orders servers by player count (descending).
* **JobID Management:** * Keeps the UI clean by visually hiding long JobIDs.
    * Includes a one-click "Copy ID" button on every server card.
    * Live Search functionality: Paste a JobID to instantly filter the list and find a specific server.

---

## A Note on Ping Transparency

The ping displayed in this extension is the API snapshot latency reported by Roblox. It is not a live measurement of your computer's connection to the server.

Because of how the Roblox API caches data:
1. A server showing "30ms" might experience a lag spike right after you join.
2. Player thumbnails are a great secondary indicator. A stable server usually has a diverse set of avatars, whereas a newly spun-up or struggling server might show mostly default models.

RoBrowser prioritizes data honesty. The extension doesn't use heuristics or fake formulas to guess your ping; it strictly displays the raw data the Roblox API provides.

---

## Installation (Developer Mode)

Until the extension is published on the Chrome Web Store, you can run it locally:

1. Clone or download this repository to your machine.
2. Open your browser and go to the extensions page (`chrome://extensions/` or `edge://extensions/`).
3. Turn on **Developer Mode** (top-right corner).
4. Click **Load unpacked** and select the folder containing the `manifest.json` file.
5. Open any Roblox game page and look for the new button under the game's maturity rating.

---

## License

This project is licensed under the MIT License.