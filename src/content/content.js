const RRS_ENTRY_ID = "rrs-entry-container";
const RRS_MODAL_ID = "rrs-modal-root";
const RRS_PAGE_BRIDGE_ID = "rrs-page-bridge";
const RRS_JOIN_REQUEST_EVENT = "RRS_JOIN_REQUEST";
const RRS_JOIN_RESPONSE_EVENT = "RRS_JOIN_RESPONSE";
const LOG_PREFIX = "[ServerBrowser]";
const THUMBNAIL_BATCH_SIZE = 12;
const COPY_FEEDBACK_DURATION_MS = 1700;
const BACKGROUND_MESSAGE_TIMEOUT_MS = 12000;
const REGION_FETCH_MAX_PAGES = 5;
const MODAL_TITLE_BASE = "RoBrowser";

const CATEGORY_SHELL = [
  { categoryKey: "excellent", categoryLabel: "Excellent (< 60ms)", pingBand: "good" },
  { categoryKey: "good", categoryLabel: "Good (60 - 120ms)", pingBand: "warn" },
  { categoryKey: "fair", categoryLabel: "Fair (120 - 200ms)", pingBand: "bad" },
  { categoryKey: "bad", categoryLabel: "Poor (> 200ms)", pingBand: "bad" },
  { categoryKey: "no-data", categoryLabel: "Unknown", pingBand: "unknown" }
];

const PLAY_CONTAINER_SELECTORS = [
  "#game-details-play-button-container",
  ".game-buttons-container",
  "[data-testid='game-details-play-button-container']",
  "[data-testid='play-button-container']"
];

const PLAY_BUTTON_SELECTORS = [
  "[data-testid='play-button']",
  ".btn-common-play-game-lg",
  ".btn-common-play-game",
  "button[data-testid*='play-button']"
];

const state = {
  initialized: false,
  placeId: null,
  currentUrl: window.location.href,
  mountTimer: null,
  dataset: null,
  datasetPlaceId: null,
  selectedCategoryKey: null,
  activeRequestId: null,
  serverSearchQuery: "",
  hideFullServers: true,
  isDescending: true,
  modalOpen: false,
  modalNodes: null,
  thumbnailQueue: [],
  thumbnailQueueTimer: null,
  handlers: {
    onJoinResponse: null,
    onPartialUpdate: null
  }
};

bootstrap();

function bootstrap() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;
  installPageJoinBridge();
  patchHistoryEvents();
  installPartialUpdateListener();
  window.addEventListener("popstate", onRouteMaybeChanged, true);

  const observer = new MutationObserver(() => {
    scheduleMount();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-selected"]
  });

  ensureModalRoot();
  onRouteMaybeChanged();
}

function patchHistoryEvents() {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  window.history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    onRouteMaybeChanged();
    return result;
  };

  window.history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    onRouteMaybeChanged();
    return result;
  };
}

function onRouteMaybeChanged() {
  const nextPlaceId = extractPlaceIdFromUrl();
  const urlChanged = state.currentUrl !== window.location.href;
  const placeChanged = state.placeId !== nextPlaceId;

  if (!urlChanged && !placeChanged) {
    scheduleMount();
    return;
  }

  state.currentUrl = window.location.href;
  state.placeId = nextPlaceId;
  state.selectedCategoryKey = null;

  if (placeChanged) {
    state.dataset = null;
    state.datasetPlaceId = null;
    state.activeRequestId = null;
    state.serverSearchQuery = "";
    state.hideFullServers = true;
    state.isDescending = true;
    closeModal();
  }

  removeEntryButton();
  scheduleMount();
}

function scheduleMount() {
  if (state.mountTimer) {
    clearTimeout(state.mountTimer);
  }

  state.mountTimer = window.setTimeout(() => {
    attemptMountAbovePlayButton();
  }, 180);
}

function attemptMountAbovePlayButton() {
  const placeId = extractPlaceIdFromUrl();
  if (!placeId) {
    removeEntryButton();
    return;
  }

  state.placeId = placeId;

  const target = findPlayInjectionTarget();
  if (!target || !target.container) {
    return;
  }

  const { container, playButton } = target;

  const existing = document.getElementById(RRS_ENTRY_ID);
  if (existing && existing.isConnected) {
    if (existing.parentElement === container) {
      return;
    }

    existing.remove();
  }

  const entryContainer = document.createElement("div");
  entryContainer.id = RRS_ENTRY_ID;
  entryContainer.className = "rrs-entry-container";
  entryContainer.style.width = "100%";
  entryContainer.style.marginBottom = "10px";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "rrs-entry-button";
  button.classList.add("btn-secondary-md", "btn-control-md");
  button.textContent = "Open Connection Quality";
  button.style.width = "100%";

  button.addEventListener("click", async () => {
    await openModalAndLoad();
  });

  entryContainer.appendChild(button);

  const insertionAnchor = resolveInjectionAnchor(container, playButton);
  container.insertBefore(entryContainer, insertionAnchor);
}

function findPlayInjectionTarget() {
  for (const selector of PLAY_CONTAINER_SELECTORS) {
    const container = document.querySelector(selector);
    if (!container || !isElementVisible(container)) {
      continue;
    }

    const playButton = findPlayButtonInContainer(container);
    if (playButton) {
      return { container, playButton };
    }

    if (container.firstElementChild) {
      return { container, playButton: container.firstElementChild };
    }
  }

  for (const selector of PLAY_BUTTON_SELECTORS) {
    const playButton = document.querySelector(selector);
    if (!playButton || !isElementVisible(playButton)) {
      continue;
    }

    const container = playButton.closest(
      "#game-details-play-button-container, .game-buttons-container, [data-testid='game-details-play-button-container'], [data-testid='play-button-container'], [class*='game-buttons']"
    );

    if (container && isElementVisible(container)) {
      return { container, playButton };
    }

    if (playButton.parentElement) {
      return { container: playButton.parentElement, playButton };
    }
  }

  return null;
}

function findPlayButtonInContainer(container) {
  if (!container) {
    return null;
  }

  for (const selector of PLAY_BUTTON_SELECTORS) {
    const playButton = container.querySelector(selector);
    if (playButton && isElementVisible(playButton)) {
      return playButton;
    }
  }

  const fallbackButton = container.querySelector("button, a[role='button'], a");
  if (fallbackButton && isElementVisible(fallbackButton)) {
    return fallbackButton;
  }

  return null;
}

function resolveInjectionAnchor(container, playButton) {
  if (!container) {
    return null;
  }

  if (!playButton || !playButton.isConnected) {
    return container.firstChild;
  }

  let anchor = playButton;
  while (anchor.parentElement && anchor.parentElement !== container) {
    anchor = anchor.parentElement;
  }

  if (anchor.parentElement === container) {
    return anchor;
  }

  return container.firstChild;
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function ensureModalRoot() {
  let root = document.getElementById(RRS_MODAL_ID);
  if (root) {
    state.modalNodes = collectModalNodes(root);
    return;
  }

  root = document.createElement("div");
  root.id = RRS_MODAL_ID;
  root.className = "rrs-modal-root rrs-hidden";

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "rrs-modal-backdrop";
  backdrop.setAttribute("aria-label", "Close modal");

  const dialog = document.createElement("section");
  dialog.className = "rrs-modal-dialog";

  const header = document.createElement("header");
  header.className = "rrs-modal-header";

  const title = document.createElement("h3");
  title.className = "rrs-modal-title";
  title.textContent = MODAL_TITLE_BASE;

  const actions = document.createElement("div");
  actions.className = "rrs-modal-actions";

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "rrs-refresh-button";
  refreshButton.textContent = "Refresh";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "rrs-close-button";
  closeButton.textContent = "Close";

  actions.appendChild(refreshButton);
  actions.appendChild(closeButton);

  header.appendChild(title);
  header.appendChild(actions);

  const status = document.createElement("p");
  status.className = "rrs-status";
  status.textContent = "Select a ping category to view servers.";

  const categoriesView = document.createElement("div");
  categoriesView.className = "rrs-view rrs-categories-view";

  const serversView = document.createElement("div");
  serversView.className = "rrs-view rrs-servers-view rrs-hidden";

  dialog.appendChild(header);
  dialog.appendChild(status);
  dialog.appendChild(categoriesView);
  dialog.appendChild(serversView);

  root.appendChild(backdrop);
  root.appendChild(dialog);

  document.body.appendChild(root);

  backdrop.addEventListener("click", () => {
    closeModal();
  });

  closeButton.addEventListener("click", () => {
    closeModal();
  });

  refreshButton.addEventListener("click", async () => {
    await refreshModalData(refreshButton);
  });

  state.modalNodes = collectModalNodes(root);
}

function collectModalNodes(root) {
  return {
    root,
    title: root.querySelector(".rrs-modal-title"),
    status: root.querySelector(".rrs-status"),
    categoriesView: root.querySelector(".rrs-categories-view"),
    serversView: root.querySelector(".rrs-servers-view"),
    refreshButton: root.querySelector(".rrs-refresh-button")
  };
}

async function openModalAndLoad() {
  ensureModalRoot();
  const modal = state.modalNodes;
  if (!modal) {
    return;
  }

  modal.root.classList.remove("rrs-hidden");
  state.modalOpen = true;
  state.selectedCategoryKey = null;
  state.serverSearchQuery = "";
  state.hideFullServers = true;
  state.isDescending = true;

  clearContainer(modal.categoriesView);
  clearContainer(modal.serversView);
  modal.serversView.classList.add("rrs-hidden");
  modal.categoriesView.classList.remove("rrs-hidden");

  const emptyDataset = createEmptyDataset(state.placeId);
  renderCategories(emptyDataset);
  setModalFetchingIndicator(true);

  try {
    await loadDatasetAndRender({ forceRefresh: false, keepSelection: false });
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to open modal:`, error);
    setModalFetchingIndicator(false);
    modal.status.textContent = "Failed to load server data.";
  }
}

async function refreshModalData(refreshButton) {
  const modal = state.modalNodes;
  if (!modal || !state.modalOpen) {
    return;
  }

  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing...";
  setModalFetchingIndicator(true);

  try {
    await loadDatasetAndRender({ forceRefresh: true, keepSelection: true });
  } catch (error) {
    console.error(`${LOG_PREFIX} Data refresh failed:`, error);
    setModalFetchingIndicator(false);
    modal.status.textContent = "Failed to refresh API data.";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

async function loadDatasetAndRender({ forceRefresh, keepSelection }) {
  const dataset = await getDatasetForCurrentPlace(forceRefresh);
  if (!dataset) {
    return;
  }

  renderCurrentView(dataset, keepSelection);
}

function closeModal() {
  if (!state.modalNodes) {
    return;
  }

  state.modalNodes.root.classList.add("rrs-hidden");
  state.modalOpen = false;
  state.selectedCategoryKey = null;
  setModalFetchingIndicator(false);
}

async function getDatasetForCurrentPlace(forceRefresh = false) {
  if (!state.placeId) {
    throw new Error("Missing placeId for data loading.");
  }

  const requestId = createStreamRequestId();

  const response = await sendMessageToBackground({
    type: "GET_REGION_SERVERS",
    placeId: state.placeId,
    limit: 100,
    maxPages: REGION_FETCH_MAX_PAGES,
    apiSortOrder: getCurrentApiSortOrder(),
    forceRefresh,
    requestId
  });

  console.log("[ServerBrowser] Received dataset:", response);

  if (response && response.ok === true && response.status === "fetching_started") {
    state.activeRequestId = normalizeText(response.requestId, requestId);
    setModalFetchingIndicator(true);
    return null;
  }

  if (!response || response.ok !== true || !response.data) {
    const message = response && response.error ? response.error : "Failed to load connection quality servers.";
    throw new Error(message);
  }

  state.activeRequestId = null;
  setModalFetchingIndicator(false);
  state.dataset = applySortOrderToDataset(response.data, state.isDescending);
  state.datasetPlaceId = state.placeId;
  return state.dataset;
}

function createStreamRequestId() {
  return `rrs-stream-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getCurrentApiSortOrder() {
  return state.isDescending ? "Desc" : "Asc";
}

function createEmptyDataset(placeId) {
  const categories = CATEGORY_SHELL.map((category) => ({
    categoryKey: category.categoryKey,
    categoryLabel: category.categoryLabel,
    pingBand: category.pingBand,
    serverCount: 0,
    medianPingMs: null
  }));

  const serversByCategory = {};
  for (const category of CATEGORY_SHELL) {
    serversByCategory[category.categoryKey] = [];
  }

  return {
    placeId: Number.isInteger(Number(placeId)) ? Number(placeId) : null,
    fetchedPages: 0,
    fetchedCount: 0,
    nextCursor: null,
    categories,
    serversByCategory,
    servers: []
  };
}

function setModalFetchingIndicator(isFetching) {
  const modal = state.modalNodes;
  if (!modal || !modal.title) {
    return;
  }

  modal.title.textContent = MODAL_TITLE_BASE;

  if (isFetching) {
    modal.title.classList.add("rrs-modal-title-loading");
    return;
  }

  modal.title.classList.remove("rrs-modal-title-loading");
}

function installPartialUpdateListener() {
  if (state.handlers.onPartialUpdate) {
    return;
  }

  state.handlers.onPartialUpdate = (message) => {
    if (!message || message.type !== "PARTIAL_UPDATE") {
      return;
    }

    handlePartialUpdateMessage(message);
  };

  chrome.runtime.onMessage.addListener(state.handlers.onPartialUpdate);
}

function handlePartialUpdateMessage(message) {
  if (!state.placeId) {
    return;
  }

  const messageRequestId = normalizeText(message.requestId, "");
  if (state.activeRequestId && messageRequestId && messageRequestId !== state.activeRequestId) {
    return;
  }

  if (message.error) {
    console.error(`${LOG_PREFIX} Streaming update failed:`, message.error);
    if (state.modalOpen && state.modalNodes) {
      state.modalNodes.status.textContent = "Failed to load server data.";
    }

    state.activeRequestId = null;
    setModalFetchingIndicator(false);
    return;
  }

  const payload = message.payload && typeof message.payload === "object"
    ? message.payload
    : null;

  if (payload) {
    const payloadPlaceId = Number(payload.placeId);
    if (state.placeId && Number.isInteger(payloadPlaceId) && payloadPlaceId !== state.placeId) {
      return;
    }

    const sortedPayload = applySortOrderToDataset(payload, state.isDescending);

    state.dataset = sortedPayload;
    state.datasetPlaceId = Number.isInteger(payloadPlaceId) ? payloadPlaceId : state.placeId;

    if (state.modalOpen) {
      renderCurrentView(sortedPayload, true);
    }
  }

  if (message.isComplete) {
    state.activeRequestId = null;
    setModalFetchingIndicator(false);
    return;
  }

  setModalFetchingIndicator(true);
}

function renderCurrentView(dataset, keepSelection = true) {
  if (keepSelection && state.selectedCategoryKey) {
    const categories = Array.isArray(dataset.categories) ? dataset.categories : [];
    const selected = categories.find((category) => category.categoryKey === state.selectedCategoryKey);
    if (selected) {
      renderServers(dataset, selected);
      return;
    }
  }

  renderCategories(dataset);
}

function applySortOrderToDataset(dataset, isDescending) {
  if (!dataset || typeof dataset !== "object") {
    return dataset;
  }

  const sourceByCategory = dataset.serversByCategory && typeof dataset.serversByCategory === "object"
    ? dataset.serversByCategory
    : {};

  const sortedByCategory = {};
  for (const [categoryKey, categoryServers] of Object.entries(sourceByCategory)) {
    sortedByCategory[categoryKey] = sortServersByOccupancy(categoryServers, isDescending);
  }

  const sortedServers = sortServersByOccupancy(dataset.servers, isDescending);

  return {
    ...dataset,
    serversByCategory: sortedByCategory,
    servers: sortedServers
  };
}

function sortServersByOccupancy(servers, isDescending) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return [];
  }

  const sorted = [...servers];
  sorted.sort((serverA, serverB) => compareServersByOccupancy(serverA, serverB, isDescending));
  return sorted;
}

function compareServersByOccupancy(serverA, serverB, isDescending) {
  const playingA = normalizeDisplayInt(serverA && serverA.playing);
  const playingB = normalizeDisplayInt(serverB && serverB.playing);

  if (playingA !== playingB) {
    return isDescending ? playingB - playingA : playingA - playingB;
  }

  const pingA = Number.isFinite(serverA && serverA.pingMs) ? Math.round(serverA.pingMs) : null;
  const pingB = Number.isFinite(serverB && serverB.pingMs) ? Math.round(serverB.pingMs) : null;

  if (pingA === null && pingB === null) {
    return getServerJobId(serverA).localeCompare(getServerJobId(serverB));
  }

  if (pingA === null) {
    return 1;
  }

  if (pingB === null) {
    return -1;
  }

  if (pingA !== pingB) {
    return pingA - pingB;
  }

  return getServerJobId(serverA).localeCompare(getServerJobId(serverB));
}

function getCategoryByKey(dataset, categoryKey) {
  const categories = Array.isArray(dataset && dataset.categories) ? dataset.categories : [];
  return categories.find((category) => category.categoryKey === categoryKey) || null;
}

function renderLoadingServersForCategory(categoryKey, fallbackCategory) {
  if (!state.modalOpen) {
    return;
  }

  const loadingDataset = applySortOrderToDataset(createEmptyDataset(state.placeId), state.isDescending);
  state.dataset = loadingDataset;
  state.datasetPlaceId = state.placeId;

  const loadingCategory = getCategoryByKey(loadingDataset, categoryKey) || fallbackCategory;
  if (loadingCategory) {
    renderServers(loadingDataset, loadingCategory);
    return;
  }

  renderCategories(loadingDataset);
}

function updateSortToggleLabel(button) {
  if (!button) {
    return;
  }

  if (state.isDescending) {
    button.textContent = "Sort: Fullest First (DESC)";
    button.setAttribute("aria-label", "Sort order: fullest servers first");
    button.dataset.sortOrder = "desc";
    return;
  }

  button.textContent = "Sort: Emptiest First (ASC)";
  button.setAttribute("aria-label", "Sort order: emptiest servers first");
  button.dataset.sortOrder = "asc";
}

function renderCategories(dataset) {
  const modal = state.modalNodes;
  if (!modal) {
    return;
  }

  state.selectedCategoryKey = null;

  clearContainer(modal.categoriesView);
  clearContainer(modal.serversView);
  modal.serversView.classList.add("rrs-hidden");
  modal.categoriesView.classList.remove("rrs-hidden");

  const categories = Array.isArray(dataset.categories) ? dataset.categories : [];
  if (categories.length === 0) {
    modal.status.textContent = "No ping categories available right now.";
    return;
  }

  modal.status.textContent = `Ping Categories: ${categories.length}`;

  const grid = document.createElement("div");
  grid.className = "rrs-category-grid";

  for (const category of categories) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "rrs-category-card";

    const title = document.createElement("h4");
    title.className = "rrs-category-title";
    title.textContent = category.categoryLabel || "Unknown";

    const count = document.createElement("p");
    count.className = "rrs-category-count";
    count.textContent = `${category.serverCount || 0} servers`;

    const ping = document.createElement("span");
    ping.className = `rrs-pill rrs-pill-${category.pingBand || "unknown"}`;
    ping.textContent = formatPing(category.medianPingMs);

    card.appendChild(title);
    card.appendChild(count);
    card.appendChild(ping);

    card.addEventListener("click", () => {
      state.selectedCategoryKey = category.categoryKey;
      state.serverSearchQuery = "";
      state.hideFullServers = true;
      renderServers(dataset, category);
    });

    grid.appendChild(card);
  }

  modal.categoriesView.appendChild(grid);
}

function renderServers(dataset, category) {
  const modal = state.modalNodes;
  if (!modal) {
    return;
  }

  clearContainer(modal.serversView);
  modal.categoriesView.classList.add("rrs-hidden");
  modal.serversView.classList.remove("rrs-hidden");

  const header = document.createElement("div");
  header.className = "rrs-servers-header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "rrs-back-button";
  backButton.textContent = "Back";

  const title = document.createElement("h4");
  title.className = "rrs-servers-title";
  title.textContent = category.categoryLabel || "Unknown";

  header.appendChild(backButton);
  header.appendChild(title);

  backButton.addEventListener("click", () => {
    state.selectedCategoryKey = null;
    renderCategories(dataset);
  });

  const disclaimer = document.createElement("p");
  disclaimer.className = "rrs-disclaimer";
  disclaimer.textContent = "Note: Ping is based on API data and can differ in-game.";

  modal.serversView.appendChild(header);
  modal.serversView.appendChild(disclaimer);

  const byCategory = dataset.serversByCategory && typeof dataset.serversByCategory === "object"
    ? dataset.serversByCategory
    : {};
  const baseServers = Array.isArray(byCategory[category.categoryKey]) ? byCategory[category.categoryKey] : [];
  const servers = sortServersByOccupancy(baseServers, state.isDescending);

  const totalServers = servers.length;

  const serverGrid = document.createElement("div");
  serverGrid.className = "rrs-server-grid";

  const searchContainer = document.createElement("div");
  searchContainer.className = "rrs-search-container";

  const searchInput = document.createElement("input");
  searchInput.className = "rrs-search-input";
  searchInput.type = "text";
  searchInput.placeholder = "Search by Server ID...";
  searchInput.setAttribute("aria-label", "Search servers by Server ID");
  searchInput.value = state.serverSearchQuery;

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "rrs-search-clear";
  clearButton.textContent = "X";
  clearButton.setAttribute("aria-label", "Clear search");
  clearButton.title = "Clear search";

  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearButton);

  modal.serversView.appendChild(searchContainer);

  const filterRow = document.createElement("div");
  filterRow.className = "rrs-filter-row";

  const hideFullLabel = document.createElement("label");
  hideFullLabel.className = "rrs-hide-full-toggle";

  const hideFullInput = document.createElement("input");
  hideFullInput.type = "checkbox";
  hideFullInput.className = "rrs-hide-full-input";
  hideFullInput.checked = state.hideFullServers;
  hideFullInput.setAttribute("aria-label", "Hide full servers");

  const hideFullText = document.createElement("span");
  hideFullText.className = "rrs-hide-full-text";
  hideFullText.textContent = "Hide Full Servers";

  hideFullLabel.appendChild(hideFullInput);
  hideFullLabel.appendChild(hideFullText);
  filterRow.appendChild(hideFullLabel);

  const sortToggleButton = document.createElement("button");
  sortToggleButton.type = "button";
  sortToggleButton.className = "rrs-sort-toggle";
  updateSortToggleLabel(sortToggleButton);

  sortToggleButton.addEventListener("click", async () => {
    state.isDescending = !state.isDescending;
    renderLoadingServersForCategory(category.categoryKey, category);
    setModalFetchingIndicator(true);

    try {
      await loadDatasetAndRender({ forceRefresh: true, keepSelection: true });
    } catch (error) {
      console.error(`${LOG_PREFIX} Sort refresh failed:`, error);
      setModalFetchingIndicator(false);

      const modal = state.modalNodes;
      if (modal) {
        modal.status.textContent = "Failed to refresh server order.";
      }
    }
  });

  filterRow.appendChild(sortToggleButton);

  modal.serversView.appendChild(filterRow);

  modal.serversView.appendChild(serverGrid);

  const cardEntries = [];
  for (const server of servers) {
    const card = createServerCard(server);
    const normalizedJobId = getServerJobId(server).toLowerCase();
    cardEntries.push({ card, normalizedJobId, server });
    serverGrid.appendChild(card);
  }

  const empty = document.createElement("p");
  empty.className = "rrs-status rrs-search-empty";
  empty.style.display = "none";
  serverGrid.appendChild(empty);

  const ghostCard = createForceJoinGhostCard();
  ghostCard.card.style.display = "none";
  serverGrid.appendChild(ghostCard.card);

  const applySearchFilter = () => {
    const rawQuery = normalizeText(searchInput.value, "").trim();
    const normalizedQuery = rawQuery.toLowerCase();
    const hideFullServers = Boolean(hideFullInput.checked);
    state.serverSearchQuery = rawQuery;
    state.hideFullServers = hideFullServers;
    let visibleCount = 0;
    let searchMatchCount = 0;

    for (const entry of cardEntries) {
      const matchesSearch = normalizedQuery.length === 0 || entry.normalizedJobId.includes(normalizedQuery);
      if (matchesSearch) {
        searchMatchCount += 1;
      }

      const hiddenByFullFilter = hideFullServers && isServerFull(entry.server);
      const isVisible = matchesSearch && !hiddenByFullFilter;

      entry.card.style.display = isVisible ? "" : "none";
      if (isVisible) {
        visibleCount += 1;
      }
    }

    const showGhostForceJoin = normalizedQuery.length > 0 && searchMatchCount === 0 && looksLikeValidJobId(rawQuery);

    if (showGhostForceJoin) {
      ghostCard.setJobId(rawQuery);
      ghostCard.card.style.display = "";
      empty.style.display = "none";
    } else {
      ghostCard.card.style.display = "none";

      if (visibleCount === 0) {
        empty.style.display = "block";
        if (normalizedQuery.length > 0 && searchMatchCount > 0 && hideFullServers) {
          empty.textContent = "Matching servers are full. Disable Hide Full Servers to view them.";
        } else {
          empty.textContent = normalizedQuery.length > 0
            ? "No servers found for this JobID."
            : "No servers found for this category.";
        }
      } else {
        empty.style.display = "none";
      }
    }

    if (showGhostForceJoin) {
      modal.status.textContent = `Servers in ${category.categoryLabel || "Unknown"}: 0/${totalServers} (not in current batch)`;
      return;
    }

    if (normalizedQuery.length > 0) {
      modal.status.textContent = `Servers in ${category.categoryLabel || "Unknown"}: ${visibleCount}/${totalServers} (filters active)`;
      return;
    }

    modal.status.textContent = `Servers in ${category.categoryLabel || "Unknown"}: ${visibleCount}/${totalServers}`;
  };

  searchInput.addEventListener("input", () => {
    applySearchFilter();
  });

  clearButton.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.focus();
    applySearchFilter();
  });

  hideFullInput.addEventListener("change", () => {
    applySearchFilter();
  });

  if (totalServers === 0) {
    searchInput.disabled = true;
    clearButton.disabled = true;
    hideFullInput.disabled = true;
    ghostCard.card.style.display = "none";
    empty.style.display = "block";
    empty.textContent = "No servers found for this category.";
    modal.status.textContent = `Servers in ${category.categoryLabel || "Unknown"}: 0`;
  } else {
    applySearchFilter();
  }
}

function createServerCard(server) {
  const card = document.createElement("article");
  card.className = "rrs-server-card";

  const avatarStrip = createAvatarStrip(server);

  const details = document.createElement("div");
  details.className = "rrs-server-details";

  const occupancyLine = document.createElement("p");
  occupancyLine.className = "rrs-server-line";
  occupancyLine.textContent = `Players: ${normalizeDisplayInt(server && server.playing)}/${normalizeDisplayInt(server && server.maxPlayers)}`;

  const pingLine = document.createElement("p");
  pingLine.className = "rrs-server-line";
  pingLine.textContent = `Ping (API): ${formatPing(server && server.pingMs)}`;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "rrs-copy-id-button";
  copyButton.textContent = "Copy ID";

  copyButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await copyServerId(server, copyButton);
  });

  const metaRow = document.createElement("div");
  metaRow.className = "rrs-server-meta";

  metaRow.appendChild(occupancyLine);
  metaRow.appendChild(copyButton);

  details.appendChild(metaRow);
  details.appendChild(pingLine);

  const footer = document.createElement("div");
  footer.className = "rrs-server-footer";

  const pingBadge = document.createElement("span");
  pingBadge.className = `rrs-pill rrs-pill-${normalizeText(server && server.pingBand, "unknown")}`;
  pingBadge.textContent = formatPing(server && server.pingMs);

  const joinButton = document.createElement("button");
  joinButton.type = "button";
  joinButton.className = "rrs-join-button rrs-join-button-compact";
  joinButton.textContent = "Join";

  joinButton.addEventListener("click", async () => {
    await joinServer(server, joinButton);
  });

  footer.appendChild(pingBadge);
  footer.appendChild(joinButton);

  card.appendChild(avatarStrip);
  card.appendChild(details);
  card.appendChild(footer);

  return card;
}

function createForceJoinGhostCard() {
  const card = document.createElement("article");
  card.className = "rrs-server-card rrs-server-card-ghost";

  const avatarStrip = document.createElement("div");
  avatarStrip.className = "rrs-avatar-strip";

  for (let index = 0; index < 3; index += 1) {
    const slot = document.createElement("div");
    slot.className = "rrs-avatar-slot";

    const image = document.createElement("img");
    image.className = "rrs-avatar-img rrs-avatar-placeholder";
    image.alt = "Avatar";

    slot.appendChild(image);
    avatarStrip.appendChild(slot);
  }

  const details = document.createElement("div");
  details.className = "rrs-server-details";

  const titleLine = document.createElement("p");
  titleLine.className = "rrs-server-line rrs-server-ghost-title";
  titleLine.textContent = "Server not found in current batch.";

  const idLine = document.createElement("p");
  idLine.className = "rrs-server-line rrs-server-ghost-id";
  idLine.textContent = "Requested ID: -";

  const playersLine = document.createElement("p");
  playersLine.className = "rrs-server-line";
  playersLine.textContent = "Players: ???/???";

  const pingLine = document.createElement("p");
  pingLine.className = "rrs-server-line";
  pingLine.textContent = "Ping (API): Unknown";

  details.appendChild(titleLine);
  details.appendChild(idLine);
  details.appendChild(playersLine);
  details.appendChild(pingLine);

  const footer = document.createElement("div");
  footer.className = "rrs-server-footer";

  const pingBadge = document.createElement("span");
  pingBadge.className = "rrs-pill rrs-pill-unknown";
  pingBadge.textContent = "Unknown";

  const joinButton = document.createElement("button");
  joinButton.type = "button";
  joinButton.className = "rrs-join-button rrs-join-button-compact";
  joinButton.textContent = "Force Join";
  joinButton.setAttribute("aria-label", "Force join by entered server ID");

  joinButton.addEventListener("click", async () => {
    const jobId = normalizeText(joinButton.dataset.jobId, "").trim();
    if (!jobId) {
      return;
    }

    await forceJoinByJobId(jobId, joinButton, "Force Join");
  });

  footer.appendChild(pingBadge);
  footer.appendChild(joinButton);

  card.appendChild(avatarStrip);
  card.appendChild(details);
  card.appendChild(footer);

  return {
    card,
    setJobId(jobId) {
      const normalizedJobId = normalizeText(jobId, "").trim();
      idLine.textContent = normalizedJobId ? `Requested ID: ${normalizedJobId}` : "Requested ID: -";
      joinButton.dataset.jobId = normalizedJobId;
    }
  };
}

function createAvatarStrip(server) {
  const container = document.createElement("div");
  container.className = "rrs-avatar-strip";

  const maxPlayers = normalizeDisplayInt(server && server.maxPlayers);
  const playing = normalizeDisplayInt(server && server.playing);
  const clampedPlaying = maxPlayers > 0 ? Math.min(playing, maxPlayers) : playing;
  const slotCount = Math.max(0, clampedPlaying);

  const headshots = Array.isArray(server && server.avatarHeadshots)
    ? server.avatarHeadshots
    : [];

  for (let index = 0; index < slotCount; index += 1) {
    const slot = document.createElement("div");
    slot.className = "rrs-avatar-slot";

    const image = document.createElement("img");
    image.className = "rrs-avatar-img rrs-avatar-placeholder";
    image.alt = "Avatar";
    image.loading = "lazy";
    image.decoding = "async";

    image.addEventListener("error", () => {
      image.classList.add("rrs-avatar-placeholder");
      image.removeAttribute("src");
    });

    image.addEventListener("load", () => {
      image.classList.remove("rrs-avatar-placeholder");
    });

    const url = normalizeText(headshots[index], "");
    if (url) {
      enqueueThumbnailLoad(image, url);
    }

    slot.appendChild(image);
    container.appendChild(slot);
  }

  return container;
}

function enqueueThumbnailLoad(imageElement, url) {
  if (!imageElement || !url) {
    return;
  }

  state.thumbnailQueue.push({ imageElement, url });
  scheduleThumbnailQueueFlush();
}

function scheduleThumbnailQueueFlush() {
  if (state.thumbnailQueueTimer) {
    return;
  }

  state.thumbnailQueueTimer = window.setTimeout(() => {
    flushThumbnailQueue();
  }, 0);
}

function flushThumbnailQueue() {
  state.thumbnailQueueTimer = null;
  let processed = 0;

  while (state.thumbnailQueue.length > 0 && processed < THUMBNAIL_BATCH_SIZE) {
    const next = state.thumbnailQueue.shift();
    if (!next || !next.imageElement || !next.url) {
      continue;
    }

    if (!next.imageElement.isConnected) {
      continue;
    }

    next.imageElement.src = next.url;
    processed += 1;
  }

  if (state.thumbnailQueue.length > 0) {
    scheduleThumbnailQueueFlush();
  }
}

async function joinServer(server, button) {
  if (!button) {
    return;
  }

  const jobId = getServerJobId(server);

  if (!jobId) {
    const modal = state.modalNodes;
    if (modal) {
      modal.status.textContent = "Missing data to join this server.";
    }
    return;
  }

  button.disabled = true;
  button.textContent = "Joining...";

  try {
    await attemptJoinByJobId(jobId);
  } finally {
    button.disabled = false;
    button.textContent = "Join";
  }
}

async function forceJoinByJobId(jobId, button, idleLabel = "Force Join by ID") {
  if (!button) {
    return;
  }

  const normalizedJobId = normalizeText(jobId, "").trim();
  if (!normalizedJobId) {
    return;
  }

  button.disabled = true;
  button.textContent = "Joining...";

  try {
    await attemptJoinByJobId(normalizedJobId);
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

async function attemptJoinByJobId(jobId) {
  const modal = state.modalNodes;
  if (!modal) {
    return;
  }

  if (!state.placeId || !jobId) {
    modal.status.textContent = "Missing data to join this server.";
    return;
  }

  try {
    // Try the native launcher first to preserve the default Roblox flow.
    const nativeResult = await requestNativeJoin(state.placeId, jobId);
    if (nativeResult.ok) {
      modal.status.textContent = "Opening via native launcher...";
      return;
    }

    const fallbackUrl = `roblox://placeId=${state.placeId}&gameInstanceId=${jobId}`;
    window.location.href = fallbackUrl;
    console.info("[ServerBrowser] Used roblox:// fallback");
  } catch (error) {
    console.error(`${LOG_PREFIX} Join action failed:`, error);
    modal.status.textContent = "Failed to start server join.";
  }
}

async function copyServerId(server, button) {
  if (!button) {
    return;
  }

  const jobId = getServerJobId(server);
  if (!jobId) {
    setCopyButtonState(button, "ID unavailable", "rrs-copy-id-error");
    return;
  }

  const copied = await copyTextToClipboard(jobId);
  if (copied) {
    setCopyButtonState(button, "Copied!", "rrs-copy-id-success");
    return;
  }

  setCopyButtonState(button, "Copy failed", "rrs-copy-id-error");
}

function setCopyButtonState(button, message, stateClassName) {
  if (!button) {
    return;
  }

  if (button.dataset.rrsResetTimer) {
    clearTimeout(Number(button.dataset.rrsResetTimer));
  }

  button.textContent = message;
  button.classList.remove("rrs-copy-id-success", "rrs-copy-id-error");
  if (stateClassName) {
    button.classList.add(stateClassName);
  }

  const timeoutId = window.setTimeout(() => {
    button.textContent = "Copy ID";
    button.classList.remove("rrs-copy-id-success", "rrs-copy-id-error");
    button.dataset.rrsResetTimer = "";
  }, COPY_FEEDBACK_DURATION_MS);

  button.dataset.rrsResetTimer = String(timeoutId);
}

function getServerJobId(server) {
  const joinJobId = server && server.join && typeof server.join.jobId === "string"
    ? server.join.jobId
    : "";

  if (joinJobId) {
    return joinJobId;
  }

  return server && typeof server.id === "string" ? server.id : "";
}

function isServerFull(server) {
  const playing = normalizeDisplayInt(server && server.playing);
  const maxPlayers = normalizeDisplayInt(server && server.maxPlayers);

  if (maxPlayers <= 0) {
    return false;
  }

  return playing >= maxPlayers;
}

function looksLikeValidJobId(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length < 12 || trimmed.length > 64) {
    return false;
  }

  return /^[a-z0-9-]+$/i.test(trimmed);
}

async function copyTextToClipboard(text) {
  if (!text) {
    return false;
  }

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_error) {
    copied = false;
  }

  if (textarea.parentElement) {
    textarea.parentElement.removeChild(textarea);
  }

  return copied;
}

function requestNativeJoin(placeId, jobId) {
  return new Promise((resolve) => {
    const requestId = `rrs-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const timeoutId = window.setTimeout(() => {
      removeJoinResponseHandler();
      resolve({ ok: false, method: "timeout" });
    }, 1200);

    const onJoinResponse = (event) => {
      const detail = event && event.detail ? event.detail : null;
      if (!detail || detail.requestId !== requestId) {
        return;
      }

      clearTimeout(timeoutId);
      removeJoinResponseHandler();
      resolve({
        ok: Boolean(detail.ok),
        method: detail.method || "unknown",
        error: detail.error || ""
      });
    };

    removeJoinResponseHandler();
    state.handlers.onJoinResponse = onJoinResponse;
    window.addEventListener(RRS_JOIN_RESPONSE_EVENT, onJoinResponse, true);

    window.dispatchEvent(new CustomEvent(RRS_JOIN_REQUEST_EVENT, {
      detail: {
        requestId,
        placeId,
        jobId
      }
    }));
  });
}

function removeJoinResponseHandler() {
  if (!state.handlers.onJoinResponse) {
    return;
  }

  window.removeEventListener(RRS_JOIN_RESPONSE_EVENT, state.handlers.onJoinResponse, true);
  state.handlers.onJoinResponse = null;
}

function installPageJoinBridge() {
  if (document.getElementById(RRS_PAGE_BRIDGE_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = RRS_PAGE_BRIDGE_ID;
  script.type = "text/javascript";
  script.textContent = `(() => {
    const REQUEST_EVENT = "${RRS_JOIN_REQUEST_EVENT}";
    const RESPONSE_EVENT = "${RRS_JOIN_RESPONSE_EVENT}";

    window.addEventListener(REQUEST_EVENT, (event) => {
      const detail = event && event.detail ? event.detail : {};
      const requestId = detail.requestId;
      const placeId = detail.placeId;
      const jobId = detail.jobId;

      let ok = false;
      let method = "none";
      let error = "";

      try {
        const launcher = window.Roblox && window.Roblox.GameLauncher;
        if (launcher && typeof launcher.joinGameInstance === "function") {
          try {
            launcher.joinGameInstance(placeId, jobId);
            ok = true;
            method = "gameLauncher";
          } catch (firstError) {
            try {
              launcher.joinGameInstance(jobId, placeId);
              ok = true;
              method = "gameLauncher-swapped";
            } catch (secondError) {
              error = secondError instanceof Error ? secondError.message : "joinGameInstance failed";
            }
          }
        } else {
          error = "Roblox.GameLauncher.joinGameInstance unavailable";
        }
      } catch (bridgeError) {
        error = bridgeError instanceof Error ? bridgeError.message : "Bridge error";
      }

      window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
        detail: { requestId, ok, method, error }
      }));
    }, true);
  })();`;

  (document.documentElement || document.head || document.body).appendChild(script);
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error("Background request timed out."));
    }, BACKGROUND_MESSAGE_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

function extractPlaceIdFromUrl() {
  const match = window.location.pathname.match(/^\/games\/(\d+)/);
  if (!match) {
    return null;
  }

  const placeId = Number(match[1]);
  if (!Number.isInteger(placeId) || placeId <= 0) {
    return null;
  }

  return placeId;
}

function normalizeDisplayInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizeText(value, fallback) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
}

function formatPing(pingMs) {
  if (!Number.isFinite(pingMs)) {
    return "Unknown";
  }

  return `${Math.round(pingMs)}ms`;
}

function clearContainer(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function removeEntryButton() {
  const entry = document.getElementById(RRS_ENTRY_ID);
  if (entry && entry.parentElement) {
    entry.parentElement.removeChild(entry);
  }
}
