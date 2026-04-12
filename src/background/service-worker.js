const ROBLOX_SERVERS_API_BASE_URL = "https://games.roblox.com/v1/games";
const ROBLOX_THUMBNAILS_BATCH_URL = "https://thumbnails.roblox.com/v1/batch";
const LOG_PREFIX = "[RoBrowser]";
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 5;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const THUMBNAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const THUMBNAIL_BATCH_LIMIT = 100;
const THUMBNAIL_PENDING_RETRY_DELAY_MS = 180;
const DEFAULT_API_SORT_ORDER = "Desc";
const RESPONSE_CACHE_MAX_SIZE = 50;
const THUMBNAIL_CACHE_MAX_SIZE = 2000;

const CONNECTION_CATEGORIES = [
  { key: "excellent", label: "Excellent (< 60ms)" },
  { key: "good", label: "Good (60 - 120ms)" },
  { key: "fair", label: "Fair (120 - 200ms)" },
  { key: "bad", label: "Poor (> 200ms)" },
  { key: "no-data", label: "Unknown" }
];

const responseCache = new Map();
const thumbnailCache = new Map();

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${LOG_PREFIX} Service Worker initialized.`);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid message payload." });
    return false;
  }

  // GET_PUBLIC_SERVERS: single-page fetch without quality grouping. Reserved for future use.
  if (message.type === "GET_PUBLIC_SERVERS") {
    (async () => {
      try {
        const data = await getPublicServers({
          placeId: message.placeId,
          cursor: message.cursor ?? null,
          limit: message.limit ?? DEFAULT_LIMIT,
          forceRefresh: Boolean(message.forceRefresh)
        });

        sendResponse({ ok: true, data });
      } catch (error) {
        console.error(`${LOG_PREFIX} Background error:`, error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected background error."
        });
      }
    })();

    return true;
  }

  // GET_LOW_PING_SERVERS is a legacy alias kept for backward compatibility.
  if (message.type === "GET_REGION_SERVERS" || message.type === "GET_LOW_PING_SERVERS") {
    const apiSortOrder = normalizeApiSortOrder(message.apiSortOrder);
    const senderTabId = sender && sender.tab && Number.isInteger(sender.tab.id)
      ? sender.tab.id
      : null;

    if (Number.isInteger(senderTabId)) {
      const requestId = normalizeStreamRequestId(message.requestId);

      // Acknowledge immediately so the content script can render instantly.
      sendResponse({ ok: true, status: "fetching_started", requestId });

      (async () => {
        try {
          await streamConnectionQualityServers({
            placeId: message.placeId,
            perPageLimit: message.limit ?? DEFAULT_LIMIT,
            maxPages: message.maxPages ?? DEFAULT_MAX_PAGES,
            apiSortOrder,
            forceRefresh: Boolean(message.forceRefresh),
            tabId: senderTabId,
            requestId
          });
        } catch (error) {
          console.error(`${LOG_PREFIX} Background error:`, error);
          sendPartialUpdateToTab({
            tabId: senderTabId,
            requestId,
            payload: null,
            isComplete: true,
            error: error instanceof Error ? error.message : "Unexpected background error."
          });
        }
      })();

      return true;
    }

    (async () => {
      try {
        const data = await getConnectionQualityServers({
          placeId: message.placeId,
          perPageLimit: message.limit ?? DEFAULT_LIMIT,
          maxPages: message.maxPages ?? DEFAULT_MAX_PAGES,
          apiSortOrder,
          forceRefresh: Boolean(message.forceRefresh)
        });

        sendResponse({ ok: true, data });
      } catch (error) {
        console.error(`${LOG_PREFIX} Background error:`, error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected background error."
        });
      }
    })();

    return true;
  }

  if (message.type === "HEALTH_CHECK") {
    sendResponse({ ok: true, data: { status: "ready" } });
    return false;
  }

  sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  return false;
});

async function getPublicServers({ placeId, cursor = null, limit = DEFAULT_LIMIT, forceRefresh = false }) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  const normalizedLimit = normalizeLimit(limit);
  const cacheKey = `public:${normalizedPlaceId}:${cursor ?? "first"}:${normalizedLimit}`;

  if (!forceRefresh) {
    const cachedEntry = responseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.payload;
    }
  }

  const page = await fetchPublicServersPage({
    placeId: normalizedPlaceId,
    cursor,
    limit: normalizedLimit
  });

  const payload = {
    data: page.data,
    nextCursor: page.nextCursor
  };

  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  enforceCacheLimit(responseCache, RESPONSE_CACHE_MAX_SIZE);

  return payload;
}

async function getConnectionQualityServers({
  placeId,
  perPageLimit = DEFAULT_LIMIT,
  maxPages = DEFAULT_MAX_PAGES,
  apiSortOrder = DEFAULT_API_SORT_ORDER,
  forceRefresh = false
}) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  const normalizedLimit = normalizeLimit(perPageLimit);
  const normalizedMaxPages = normalizeMaxPages(maxPages);
  const normalizedSortOrder = normalizeApiSortOrder(apiSortOrder);
  const cacheKey = `quality:${normalizedPlaceId}:${normalizedLimit}:${normalizedMaxPages}:${normalizedSortOrder}`;

  if (!forceRefresh) {
    const cachedEntry = responseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.payload;
    }
  }

  const pages = await fetchPublicServerPages({
    placeId: normalizedPlaceId,
    limit: normalizedLimit,
    maxPages: normalizedMaxPages,
    sortOrder: normalizedSortOrder
  });

  const payload = await buildConnectionQualityPayload({
    placeId: normalizedPlaceId,
    rawServers: pages.servers,
    pageCount: pages.pageCount,
    nextCursor: pages.nextCursor
  });

  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  enforceCacheLimit(responseCache, RESPONSE_CACHE_MAX_SIZE);

  return payload;
}

async function streamConnectionQualityServers({
  placeId,
  perPageLimit = DEFAULT_LIMIT,
  maxPages = DEFAULT_MAX_PAGES,
  apiSortOrder = DEFAULT_API_SORT_ORDER,
  forceRefresh = false,
  tabId,
  requestId
}) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  const normalizedLimit = normalizeLimit(perPageLimit);
  const normalizedMaxPages = normalizeMaxPages(maxPages);
  const normalizedSortOrder = normalizeApiSortOrder(apiSortOrder);
  const cacheKey = `quality:${normalizedPlaceId}:${normalizedLimit}:${normalizedMaxPages}:${normalizedSortOrder}`;

  if (!forceRefresh) {
    const cachedEntry = responseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      sendPartialUpdateToTab({
        tabId,
        requestId,
        payload: cachedEntry.payload,
        isComplete: true
      });
      return cachedEntry.payload;
    }
  }

  const servers = [];
  let pageCount = 0;
  let cursor = null;
  let finalPayload = null;

  while (pageCount < normalizedMaxPages) {
    const page = await fetchPublicServersPage({
      placeId: normalizedPlaceId,
      cursor,
      limit: normalizedLimit,
      sortOrder: normalizedSortOrder
    });

    pageCount += 1;

    if (Array.isArray(page.data) && page.data.length > 0) {
      servers.push(...page.data);
    }

    cursor = page.nextCursor;

    const currentPayload = await buildConnectionQualityPayload({
      placeId: normalizedPlaceId,
      rawServers: servers,
      pageCount,
      nextCursor: cursor
    });

    finalPayload = currentPayload;

    const hasMorePages = Boolean(cursor) && pageCount < normalizedMaxPages;
    sendPartialUpdateToTab({
      tabId,
      requestId,
      payload: currentPayload,
      isComplete: !hasMorePages
    });

    if (!hasMorePages) {
      break;
    }
  }

  if (!finalPayload) {
    finalPayload = await buildConnectionQualityPayload({
      placeId: normalizedPlaceId,
      rawServers: [],
      pageCount: 0,
      nextCursor: null
    });

    sendPartialUpdateToTab({
      tabId,
      requestId,
      payload: finalPayload,
      isComplete: true
    });
  }

  responseCache.set(cacheKey, {
    payload: finalPayload,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  enforceCacheLimit(responseCache, RESPONSE_CACHE_MAX_SIZE);

  return finalPayload;
}

async function buildConnectionQualityPayload({ placeId, rawServers, pageCount, nextCursor }) {
  const allFetchedServers = Array.isArray(rawServers) ? rawServers : [];
  const validServers = allFetchedServers.filter((server) => normalizeInt(server && server.playing, 0) > 0);

  let thumbnailMap = new Map();
  try {
    thumbnailMap = await fetchAvatarHeadshotsForServers(validServers);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Thumbnail fetch failed`, error);
    thumbnailMap = new Map();
  }

  const normalizedServers = normalizeServers(validServers, thumbnailMap);
  const grouped = groupServersByConnectionQuality(normalizedServers);

  return {
    placeId,
    fetchedPages: normalizeInt(pageCount, 0),
    fetchedCount: normalizedServers.length,
    nextCursor: nextCursor ?? null,
    categories: grouped.categories,
    serversByCategory: grouped.serversByCategory,
    servers: normalizedServers
  };
}

function sendPartialUpdateToTab({ tabId, requestId, payload, isComplete, error = "" }) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const update = {
    type: "PARTIAL_UPDATE",
    payload: payload || null,
    isComplete: Boolean(isComplete),
    requestId: normalizeStreamRequestId(requestId)
  };

  if (error) {
    update.error = error;
  }

  try {
    chrome.tabs.sendMessage(tabId, update, () => {
      // Ignore expected errors when the tab navigates or the content script is unavailable.
      void chrome.runtime.lastError;
    });
  } catch (sendError) {
    console.warn(`${LOG_PREFIX} Failed to send partial update`, sendError);
  }
}

async function fetchPublicServerPages({ placeId, limit, maxPages, sortOrder = DEFAULT_API_SORT_ORDER }) {
  const servers = [];
  let pageCount = 0;
  let cursor = null;

  while (pageCount < maxPages) {
    const page = await fetchPublicServersPage({ placeId, cursor, limit, sortOrder });
    pageCount += 1;

    if (Array.isArray(page.data) && page.data.length > 0) {
      servers.push(...page.data);
    }

    cursor = page.nextCursor;
    if (!cursor) {
      break;
    }
  }

  return {
    servers,
    pageCount,
    nextCursor: cursor
  };
}

async function fetchPublicServersPage({
  placeId,
  cursor = null,
  limit = DEFAULT_LIMIT,
  sortOrder = DEFAULT_API_SORT_ORDER
}) {
  const normalizedSortOrder = normalizeApiSortOrder(sortOrder);
  const url = new URL(`${ROBLOX_SERVERS_API_BASE_URL}/${placeId}/servers/Public`);
  url.searchParams.set("sortOrder", normalizedSortOrder);
  url.searchParams.set("limit", String(normalizeLimit(limit)));
  url.searchParams.set("excludeFullGames", "false");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const apiResponse = await fetchJsonWithRetry(url.toString(), "servers");

  return {
    data: Array.isArray(apiResponse.data) ? apiResponse.data : [],
    nextCursor: apiResponse.nextPageCursor ?? null
  };
}

async function fetchAvatarHeadshotsForServers(servers) {
  const uniquePlayerTokens = collectUniquePlayerTokens(servers);
  if (uniquePlayerTokens.length === 0) {
    return new Map();
  }

  const now = Date.now();
  const thumbnailMap = new Map();
  const pendingTokens = [];

  for (const token of uniquePlayerTokens) {
    const cached = thumbnailCache.get(token);
    if (cached && cached.expiresAt > now && typeof cached.url === "string" && cached.url.length > 0) {
      thumbnailMap.set(token, cached.url);
      continue;
    }

    pendingTokens.push(token);
  }

  if (pendingTokens.length === 0) {
    return thumbnailMap;
  }

  const chunks = chunkArray(pendingTokens, THUMBNAIL_BATCH_LIMIT);

  const results = await Promise.allSettled(
    chunks.map((chunk) => fetchAvatarHeadshotsChunkWithRetry(chunk))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const [token, imageUrl] of result.value.entries()) {
      thumbnailMap.set(token, imageUrl);
      thumbnailCache.set(token, {
        url: imageUrl,
        expiresAt: Date.now() + THUMBNAIL_CACHE_TTL_MS
      });
    }
  }

  enforceCacheLimit(thumbnailCache, THUMBNAIL_CACHE_MAX_SIZE);
  return thumbnailMap;
}

function collectUniquePlayerTokens(servers) {
  const unique = new Set();
  const result = [];

  for (const server of servers) {
    const tokens = extractPlayerTokens(server);
    for (const token of tokens) {
      if (unique.has(token)) {
        continue;
      }

      unique.add(token);
      result.push(token);
    }
  }

  return result;
}

function extractPlayerTokens(server) {
  const result = [];
  const seen = new Set();

  const registerToken = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const token = value.trim();
    if (!token || seen.has(token)) {
      return;
    }

    seen.add(token);
    result.push(token);
  };

  const candidateArrays = [server && server.playerTokens, server && server.currentPlayerTokens];

  for (const list of candidateArrays) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const token of list) {
      registerToken(token);
    }
  }

  const players = server && Array.isArray(server.players) ? server.players : [];
  for (const player of players) {
    if (player && typeof player === "object") {
      registerToken(player.token);
      registerToken(player.playerToken);
    } else {
      registerToken(player);
    }
  }

  return result;
}

async function fetchAvatarHeadshotsChunk(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return new Map();
  }

  const requestPayload = tokens.map((token) => ({
    requestId: token,
    token,
    type: "AvatarHeadshot",
    size: "48x48",
    format: "png",
    isCircular: true
  }));

  let response = null;
  try {
    response = await fetchWithTimeout(ROBLOX_THUMBNAILS_BATCH_URL, REQUEST_TIMEOUT_MS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Thumbnail fetch failed`, error);
    return new Map();
  }

  if (response.status === 429) {
    console.warn(`${LOG_PREFIX} Thumbnail fetch failed (status 429)`);
    return new Map();
  }

  if (!response.ok) {
    if (shouldSplitFailedThumbnailBatch(response.status, tokens.length)) {
      return fetchAvatarHeadshotsChunkBySplit(tokens);
    }

    console.warn(`${LOG_PREFIX} Thumbnail fetch failed (status ${response.status})`);
    return new Map();
  }

  let responsePayload = null;
  try {
    responsePayload = await response.json();
  } catch (error) {
    console.warn(`${LOG_PREFIX} Thumbnail fetch failed`, error);
    return new Map();
  }

  const data = responsePayload && Array.isArray(responsePayload.data) ? responsePayload.data : [];
  const tokenLookup = new Set(tokens);
  const result = new Map();

  for (const item of data) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const resolvedToken = resolveThumbnailTokenFromResponse(item, tokenLookup);
    const imageUrl = normalizeText(item.imageUrl, "");
    const state = normalizeText(item.state, "").toLowerCase();

    if (!resolvedToken || !imageUrl) {
      continue;
    }

    if (state === "error" || state === "blocked") {
      continue;
    }

    result.set(resolvedToken, imageUrl);
  }

  return result;
}

async function fetchAvatarHeadshotsChunkWithRetry(tokens) {
  const firstPass = await fetchAvatarHeadshotsChunk(tokens);
  if (firstPass.size >= tokens.length) {
    return firstPass;
  }

  const missingTokens = tokens.filter((token) => !firstPass.has(token));
  if (missingTokens.length === 0) {
    return firstPass;
  }

  await sleep(THUMBNAIL_PENDING_RETRY_DELAY_MS);
  const retryPass = await fetchAvatarHeadshotsChunk(missingTokens);
  for (const [token, imageUrl] of retryPass.entries()) {
    firstPass.set(token, imageUrl);
  }

  return firstPass;
}

function shouldSplitFailedThumbnailBatch(statusCode, tokenCount) {
  if (tokenCount <= 1) {
    return false;
  }

  // Client errors can be caused by one or more bad tokens in the chunk.
  return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

async function fetchAvatarHeadshotsChunkBySplit(tokens) {
  if (!Array.isArray(tokens) || tokens.length <= 1) {
    return new Map();
  }

  const middle = Math.ceil(tokens.length / 2);
  const leftTokens = tokens.slice(0, middle);
  const rightTokens = tokens.slice(middle);

  const [leftMap, rightMap] = await Promise.all([
    fetchAvatarHeadshotsChunk(leftTokens),
    fetchAvatarHeadshotsChunk(rightTokens)
  ]);

  return mergeThumbnailMaps(leftMap, rightMap);
}

function mergeThumbnailMaps(primary, secondary) {
  const merged = new Map();

  if (primary instanceof Map) {
    for (const [token, imageUrl] of primary.entries()) {
      merged.set(token, imageUrl);
    }
  }

  if (secondary instanceof Map) {
    for (const [token, imageUrl] of secondary.entries()) {
      merged.set(token, imageUrl);
    }
  }

  return merged;
}

function resolveThumbnailTokenFromResponse(item, tokenLookup) {
  const tokenFromField = normalizeText(item && item.token, "");
  if (tokenFromField && tokenLookup.has(tokenFromField)) {
    return tokenFromField;
  }

  const requestId = normalizeText(item && item.requestId, "");
  if (!requestId) {
    return "";
  }

  if (tokenLookup.has(requestId)) {
    return requestId;
  }

  for (const token of tokenLookup) {
    if (requestId.includes(token)) {
      return token;
    }
  }

  return "";
}

function normalizeServers(rawServers, thumbnailMap) {
  const servers = Array.isArray(rawServers) ? rawServers : [];
  const normalized = [];

  for (const server of servers) {
    normalized.push(normalizeOneServer(server, thumbnailMap));
  }

  return normalized;
}

function normalizeOneServer(server, thumbnailMap) {
  const serverId = normalizeText(server && server.id, "unknown");
  const playing = normalizeInt(server && server.playing, 0);
  const maxPlayers = normalizeInt(server && server.maxPlayers, 0);
  const pingMs = extractRealPing(server);
  const bucket = classifyConnectionQuality(pingMs);

  const playerTokens = extractPlayerTokens(server);
  const avatarHeadshots = playerTokens.map((token) => {
    if (!thumbnailMap || !(thumbnailMap instanceof Map)) {
      return null;
    }

    return thumbnailMap.get(token) || null;
  });

  return {
    id: serverId,
    playing,
    maxPlayers,
    pingMs,
    pingBand: classifyPingBand(pingMs),
    categoryKey: bucket.key,
    categoryLabel: bucket.label,
    playerTokens,
    avatarHeadshots,
    join: {
      jobId: serverId
    },
    raw: {
      fps: normalizeNumber(server && server.fps)
    }
  };
}

function groupServersByConnectionQuality(servers) {
  const serversByCategory = {};

  for (const category of CONNECTION_CATEGORIES) {
    serversByCategory[category.key] = [];
  }

  for (const server of servers) {
    const key = server.categoryKey || "no-data";
    if (!Object.prototype.hasOwnProperty.call(serversByCategory, key)) {
      serversByCategory[key] = [];
    }

    serversByCategory[key].push(server);
  }

  const categories = [];

  const byPlayingDescThenPing = (a, b) => {
    const aPlaying = Number.isFinite(a && a.playing) ? a.playing : 0;
    const bPlaying = Number.isFinite(b && b.playing) ? b.playing : 0;

    if (bPlaying !== aPlaying) {
      return bPlaying - aPlaying;
    }

    if (a.pingMs === null && b.pingMs === null) {
      return a.id.localeCompare(b.id);
    }

    if (a.pingMs === null) {
      return 1;
    }

    if (b.pingMs === null) {
      return -1;
    }

    if (a.pingMs !== b.pingMs) {
      return a.pingMs - b.pingMs;
    }

    return a.id.localeCompare(b.id);
  };

  for (const category of CONNECTION_CATEGORIES) {
    const items = serversByCategory[category.key] || [];

    items.sort(byPlayingDescThenPing);

    const pingValues = items
      .map((server) => server.pingMs)
      .filter((ping) => Number.isFinite(ping));

    categories.push({
      categoryKey: category.key,
      categoryLabel: category.label,
      serverCount: items.length,
      medianPingMs: pingValues.length > 0 ? median(pingValues) : null,
      pingBand: categoryToBand(category.key)
    });
  }

  return {
    categories,
    serversByCategory
  };
}

function classifyConnectionQuality(pingMs) {
  if (!Number.isFinite(pingMs)) {
    return CONNECTION_CATEGORIES[4];
  }

  if (pingMs < 60) {
    return CONNECTION_CATEGORIES[0];
  }

  if (pingMs <= 120) {
    return CONNECTION_CATEGORIES[1];
  }

  if (pingMs <= 200) {
    return CONNECTION_CATEGORIES[2];
  }

  return CONNECTION_CATEGORIES[3];
}

function categoryToBand(categoryKey) {
  if (categoryKey === "excellent") {
    return "good";
  }

  if (categoryKey === "good") {
    return "warn";
  }

  if (categoryKey === "fair" || categoryKey === "bad") {
    return "bad";
  }

  return "unknown";
}

function extractRealPing(server) {
  const candidates = [
    server && server.ping,
    server && server.latency,
    server && server.roundTripTime
  ];

  for (const value of candidates) {
    const parsed = normalizeNumber(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }

  return null;
}

async function fetchJsonWithRetry(url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);

      if (response.status === 429) {
        const retryAfterMs = getRetryAfterMs(response.headers.get("Retry-After"));
        await sleep(retryAfterMs);
        continue;
      }

      if (!response.ok) {
        const isRetryable = response.status >= 500 && response.status <= 599;
        if (isRetryable && attempt < MAX_RETRIES) {
          await sleep(getExponentialBackoff(attempt));
          continue;
        }

        throw new Error(`${label} request failed with status ${response.status}.`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(getExponentialBackoff(attempt));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch Roblox data.");
}

function fetchWithTimeout(url, timeoutMs, requestInit = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    method: "GET",
    ...requestInit,
    signal: controller.signal
  }).finally(() => {
    clearTimeout(timeoutId);
  });
}

function normalizePlaceId(placeId) {
  const parsed = Number(placeId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid placeId. A positive numeric placeId is required.");
  }

  return parsed;
}

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, 100);
}

function normalizeMaxPages(maxPages) {
  const parsed = Number(maxPages);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_PAGES;
  }

  return Math.min(parsed, 10);
}

function normalizeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeText(value, fallback) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
}

function normalizeApiSortOrder(value) {
  const normalized = normalizeText(value, DEFAULT_API_SORT_ORDER);
  if (normalized === "Asc") {
    return "Asc";
  }

  return DEFAULT_API_SORT_ORDER;
}

function normalizeStreamRequestId(value) {
  const normalized = normalizeText(value, "");
  if (normalized) {
    return normalized;
  }

  return `rrs-stream-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function classifyPingBand(pingMs) {
  if (!Number.isFinite(pingMs)) {
    return "unknown";
  }

  if (pingMs < 60) {
    return "good";
  }

  if (pingMs <= 120) {
    return "warn";
  }

  return "bad";
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  return Math.round(sorted[middle]);
}

function getRetryAfterMs(retryAfterHeader) {
  const parsedSeconds = Number(retryAfterHeader);
  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
    return parsedSeconds * 1000;
  }

  return BASE_RETRY_DELAY_MS;
}

function getExponentialBackoff(attempt) {
  return Math.min(BASE_RETRY_DELAY_MS * (2 ** (attempt - 1)), 8000);
}

function chunkArray(values, chunkSize) {
  if (!Array.isArray(values) || values.length === 0 || chunkSize <= 0) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enforceCacheLimit(cache, maxSize) {
  if (cache.size <= maxSize) {
    return;
  }

  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }

  if (cache.size <= maxSize) {
    return;
  }

  const overflow = cache.size - maxSize;
  let deleted = 0;
  for (const key of cache.keys()) {
    if (deleted >= overflow) {
      break;
    }

    cache.delete(key);
    deleted += 1;
  }
}
