### 1. WikiLink Component (`wikilink.ts`)

* **Modal UI Redesign:** Increase the size of the modal to look more like Obsidian's clean, spacious layout.
* **Smart Positioning:** Implement smart collision detection for the modal. It should display below the target element by default, but flip to display above if there is insufficient screen space below.
* **Navigation Bug:** Fix the click behavior on existing wikilinks. It should open the existing note instead of incorrectly creating a new one.

### 2. Graph View (`graph.ts`)

* **Performance Optimization:** Optimize the graph rendering to make it snappy and responsive.
* **Zoom Controls:** Fix the `Ctrl + Mouse Wheel` shortcut, which is currently non-functional.
* **State Persistence:** Save the current zoom level (in/out) to `settings.json` so the user's zoom preference persists across sessions.

### 3. AI Brain & Indexing Logic

* **Status Text Update:** Change the loading/status message from `'AI Brain: checking'` to `'Indexing'`.
* **Redundant Indexing Fix:** Implement a check to see if files are already indexed. If they are, skip the indexing process entirely on launch instead of running it every time.
* **Progress Counter Bug:** Fix the erratic indexing counter behavior (e.g., where the count drops from 576 to 540 and then jumps back up).
