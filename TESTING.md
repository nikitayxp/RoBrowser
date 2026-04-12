# RoBrowser -- Testing Guide

This guide covers every user-facing feature, edge case, and accessibility check. Go through each section in order after loading the extension.

---

## 0. Setup

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer Mode**
3. Click **Load unpacked** and select the `ServerBrowser` folder
4. Verify the extension appears with the RoBrowser icon and version `1.0.0`
5. Open DevTools (F12) on any tab and keep the **Console** tab visible -- look for `[RoBrowser]` prefixed messages

---

## 1. Entry Button Injection

### 1.1 Button appears on game pages

- [ ] Navigate to any Roblox game page (e.g. `https://www.roblox.com/games/2753915549`)
- [ ] The **"Open Connection Quality"** button should appear above the Play button
- [ ] The button should be full-width, blue gradient, matching the page style

### 1.2 Button does NOT appear on non-game pages

- [ ] Navigate to `https://www.roblox.com/home`
- [ ] Navigate to `https://www.roblox.com/catalog`
- [ ] Navigate to a user profile page
- [ ] Confirm the button does NOT appear on any of these

### 1.3 SPA navigation (critical)

- [ ] From a game page, click on another game link (Roblox navigates without full page reload)
- [ ] The old button should disappear and a new button should appear for the new game
- [ ] Use browser Back/Forward buttons -- button should update for the correct game
- [ ] In console, confirm no errors like "Cannot read properties of null"

### 1.4 Button persistence

- [ ] Scroll down on a game page, then scroll back up -- button should still be there
- [ ] Open a game page, wait 30 seconds, verify button is still mounted
- [ ] Switch to another browser tab and back -- button should still be visible

---

## 2. Modal -- Open / Close

### 2.1 Opening

- [ ] Click "Open Connection Quality" button
- [ ] Modal overlay appears with dark backdrop
- [ ] Modal title shows "RoBrowser" with a loading spinner
- [ ] Status text updates as data loads
- [ ] Five ping category cards appear (Excellent, Good, Fair, Poor, Unknown)

### 2.2 Closing

- [ ] Click the **Close** button -- modal closes
- [ ] Reopen, then click the **dark backdrop** -- modal closes
- [ ] Reopen, then press **Escape** key -- modal closes
- [ ] After closing, verify focus returns to the "Open Connection Quality" button

### 2.3 Multiple open/close cycles

- [ ] Open and close the modal 5 times rapidly -- no visual glitches or console errors
- [ ] After each close, the button should still be clickable

---

## 3. Ping Categories

### 3.1 Category display

- [ ] Each category card shows: label, server count, median ping pill
- [ ] Ping pills are color-coded:
  - **Green** for Excellent
  - **Yellow** for Good
  - **Red** for Fair and Poor
  - **Grey** for Unknown
- [ ] Server counts update as data streams in (numbers should increase incrementally)

### 3.2 Category click

- [ ] Click any category with servers > 0
- [ ] View switches from categories to server list
- [ ] Header shows the category label
- [ ] "Back" button appears in the header

### 3.3 Empty category

- [ ] Click a category with 0 servers
- [ ] Should show "No servers found for this category."
- [ ] Search input and filters should be disabled

---

## 4. Server List

### 4.1 Server cards

- [ ] Each card shows: avatar strip, player count (X/Y), ping value, ping pill, "Copy ID" button, "Join" button
- [ ] Avatar images load progressively (grey placeholders first, then actual headshots)
- [ ] Broken avatar images show as invisible (no broken image icon)

### 4.2 Sort toggle

- [ ] Default sort is "Fullest First (DESC)"
- [ ] Click sort toggle -- changes to "Emptiest First (ASC)"
- [ ] Button changes color/style when ASC is active
- [ ] Server order actually reverses (verify player counts)
- [ ] Click again to return to DESC
- [ ] Verify a loading indicator appears while re-fetching

### 4.3 Hide Full Servers toggle

- [ ] Default: toggle is ON (checked)
- [ ] Full servers (X/X where X equals max) should be hidden
- [ ] Toggle OFF -- full servers appear
- [ ] Toggle ON again -- full servers disappear
- [ ] Count in status bar updates correctly (e.g. "5/12 (filters active)")

### 4.4 Search by JobID

- [ ] Type a partial server ID into the search box
- [ ] Server list filters in real-time (only matching cards visible)
- [ ] Status bar shows filtered count (e.g. "1/12 (filters active)")
- [ ] Clear search with the "X" button -- all servers return
- [ ] Clear search by selecting text and deleting -- all servers return

### 4.5 Search + Hide Full interaction

- [ ] Search for a server ID that matches both full and non-full servers
- [ ] With "Hide Full" ON, only non-full matches appear
- [ ] If all matches are full, show message: "Matching servers are full. Disable Hide Full Servers to view them."

---

## 5. Ghost Card (Force Join)

- [ ] Type a complete, valid-looking JobID (12+ chars, alphanumeric with dashes) that does NOT match any server
- [ ] A dashed-border "ghost card" should appear with:
  - "Server not found in current batch."
  - The requested ID displayed
  - "Force Join" button
- [ ] Type a short/invalid string (less than 12 chars) -- ghost card should NOT appear
- [ ] Type special characters -- ghost card should NOT appear

---

## 6. Join Server

### 6.1 Normal join

- [ ] Click "Join" on any server card
- [ ] Button text changes to "Joining..."
- [ ] Button is disabled while joining
- [ ] Roblox client should start launching (or protocol dialog appears)
- [ ] Button returns to "Join" after the attempt

### 6.2 Force join

- [ ] Use the ghost card "Force Join" button
- [ ] Same behavior as normal join (button state changes)

### 6.3 Join failure

- [ ] If Roblox client is not installed, verify:
  - No crash or unhandled error in console
  - Button returns to normal state
  - Status text shows appropriate message

---

## 7. Copy Server ID

- [ ] Click "Copy ID" on any server card
- [ ] Button text changes to "Copied!" with green styling
- [ ] After ~1.7 seconds, button returns to "Copy ID"
- [ ] Paste in a text editor -- verify it's a valid server ID (UUID format)
- [ ] Click "Copy ID" rapidly 3 times -- no visual glitches, text resets correctly each time

---

## 8. Refresh

- [ ] With modal open, click "Refresh"
- [ ] Button text changes to "Refreshing..." and is disabled
- [ ] Loading spinner appears in the title
- [ ] Data reloads (server counts may change)
- [ ] Button returns to "Refresh" when done
- [ ] If you were viewing a specific category, you should stay in that category after refresh

---

## 9. Streaming / Progressive Loading

- [ ] Open the modal on a popular game (many servers)
- [ ] Observe category server counts increasing as pages load
- [ ] Loading spinner should stay visible until all pages are fetched
- [ ] No flickering or layout jumps as data updates
- [ ] If viewing servers in a category, new servers should appear as they arrive

---

## 10. Keyboard Accessibility

### 10.1 Escape key

- [ ] Open modal, press Escape -- modal closes
- [ ] Open modal, navigate into a category, press Escape -- modal closes (not just back)
- [ ] Verify Escape does NOT propagate to the Roblox page (no unintended side effects)

### 10.2 Focus trapping

- [ ] Open modal, press Tab repeatedly
- [ ] Focus should cycle through: Refresh, Close, category cards (or server controls)
- [ ] Focus should NOT leave the modal and go to the page behind
- [ ] Press Shift+Tab -- focus should cycle backwards
- [ ] When cycling backwards from the first focusable element, focus should wrap to the last
- [ ] When cycling forwards from the last focusable element, focus should wrap to the first

### 10.3 Focus restoration

- [ ] Click "Open Connection Quality" button
- [ ] Close modal (via Escape, Close button, or backdrop)
- [ ] Verify focus returns to the "Open Connection Quality" button
- [ ] Verify you can Tab to other page elements normally after closing

### 10.4 ARIA attributes

- [ ] Open DevTools, inspect the modal dialog element
- [ ] Verify it has `role="dialog"`, `aria-modal="true"`, and `aria-label="RoBrowser"`
- [ ] The backdrop button should have `aria-label="Close modal"`

---

## 11. Visual / CSS

### 11.1 Dark theme consistency

- [ ] All modal colors should match the dark theme (no white backgrounds, no unreadable text)
- [ ] Hover states work on: category cards, buttons, sort toggle, search clear
- [ ] Disabled states work on: Refresh button (while refreshing), search input (when no servers)

### 11.2 Responsive (narrow window)

- [ ] Resize browser window to < 760px wide
- [ ] Modal should use full width (96vw)
- [ ] Server grid should switch to single column
- [ ] Header actions should wrap to a new line
- [ ] All text should remain readable, no overflow or clipping

### 11.3 Custom toggle switch

- [ ] "Hide Full Servers" toggle should look like a slider switch (not a default checkbox)
- [ ] Toggle knob should slide smoothly when checked/unchecked
- [ ] Colors change: grey when off, blue when on

### 11.4 Avatar strip

- [ ] Servers with many players should show wrapped rows of small avatars
- [ ] Avatar strip max height is enforced (scrollable if many players)
- [ ] No layout shift when avatars load

---

## 12. Error Handling

### 12.1 Network failure

- [ ] Open DevTools > Network tab, set throttling to "Offline"
- [ ] Open the modal -- should show an error message, not a blank screen
- [ ] Return to online -- click Refresh -- data should load successfully

### 12.2 Rate limiting (429)

- [ ] Open the modal rapidly on different games (trying to trigger 429)
- [ ] Extension should retry gracefully without crashing
- [ ] Console should show `[RoBrowser]` warnings, not unhandled errors

### 12.3 Invalid game page

- [ ] Navigate to a URL like `https://www.roblox.com/games/99999999999999`
- [ ] Extension should handle the error gracefully (empty categories or error message)

---

## 13. Service Worker Lifecycle

### 13.1 Worker recovery

- [ ] Open `chrome://extensions/`, find RoBrowser
- [ ] Click "Service Worker" link to open its DevTools
- [ ] In the Service Worker DevTools console, run: `chrome.runtime.reload()`
- [ ] Return to a Roblox game page
- [ ] Open the modal -- should still work after worker restart

### 13.2 Cache behavior

- [ ] Open the modal on a game, note the data
- [ ] Close the modal, reopen within 5 minutes -- data should load instantly (from cache)
- [ ] Wait 5+ minutes, reopen -- fresh data should be fetched
- [ ] Navigate to many different games (50+) -- extension should not slow down (cache eviction working)

---

## 14. Console Cleanliness

- [ ] Through all the above tests, monitor the browser console
- [ ] All extension logs should use the `[RoBrowser]` prefix (NOT `[ServerBrowser]`)
- [ ] No `console.log` debug messages should appear in normal operation (only `console.info`, `console.warn`, `console.error` for actual events)
- [ ] No unhandled promise rejections
- [ ] No "Extension context invalidated" errors during normal use

---

## Test Matrix Summary

| Area | Tests | Priority |
|------|:-----:|:--------:|
| Entry button injection | 1.1 - 1.4 | Critical |
| Modal open/close | 2.1 - 2.3 | Critical |
| Ping categories | 3.1 - 3.3 | High |
| Server list & filters | 4.1 - 4.5 | High |
| Ghost card | 5 | Medium |
| Join server | 6.1 - 6.3 | Critical |
| Copy ID | 7 | Medium |
| Refresh | 8 | High |
| Streaming | 9 | High |
| Keyboard a11y | 10.1 - 10.4 | High |
| Visual / CSS | 11.1 - 11.4 | Medium |
| Error handling | 12.1 - 12.3 | High |
| Service worker | 13.1 - 13.2 | Medium |
| Console cleanliness | 14 | Low |
