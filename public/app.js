// ─── Blinkit Price Scraper — frontend ────────────────────────────────────────

// ── DOM refs ──────────────────────────────────────────────────────────────────
const panelSearch = document.getElementById("panel-search");
const panelBulk = document.getElementById("panel-bulk");
const panelCompare = document.getElementById("panel-compare");

const pincodeInput = document.getElementById("pincode");
const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("search-btn");

const bulkPincodeInput = document.getElementById("bulk-pincode");
const bulkQueriesInput = document.getElementById("bulk-queries");
const bulkBtn = document.getElementById("bulk-btn");

const cmpPincode1 = document.getElementById("cmp-pincode1");
const cmpPincode2 = document.getElementById("cmp-pincode2");
const cmpQuery = document.getElementById("cmp-query");
const cmpPlatPincode = document.getElementById("cmp-plat-pincode");
const cmpPlatQuery = document.getElementById("cmp-plat-query");
const cmpBtn = document.getElementById("cmp-btn");

const resultsEl = document.getElementById("results");
const skeletonsEl = document.getElementById("skeletons");
const metaEl = document.getElementById("meta");
const heroEl = document.getElementById("hero");
const errorEl = document.getElementById("error");
const errorText = document.getElementById("error-text");
const emptyEl = document.getElementById("empty");
const retryBtn = document.getElementById("retry-btn");
const sortBar = document.getElementById("sort-bar");
const compareResultsEl = document.getElementById("compare-results");
const bulkResultsEl = document.getElementById("bulk-results");
const instockCheckbox = document.getElementById("instock-only");

// ── State ──────────────────────────────────────────────────────────────────────
let mode = "search";
let compareSubMode = "pincode"; // "pincode" | "platform"
let lastAction = null;
let currentData = null;   // stores last single-search result for re-sorting
let currentSort = "default";
let currentInStockOnly = false;

const PANELS = { search: panelSearch, bulk: panelBulk, compare: panelCompare };

// ── Utilities ─────────────────────────────────────────────────────────────────
const rupee = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function hideAllStates() {
  [heroEl, errorEl, emptyEl, metaEl, sortBar, compareResultsEl, bulkResultsEl, skeletonsEl].forEach(hide);
  resultsEl.innerHTML = "";
  document.getElementById("cmp-grid1").innerHTML = "";
  document.getElementById("cmp-grid2").innerHTML = "";
  bulkResultsEl.innerHTML = "";
}

function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} hr ago`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function validPincode(v) {
  return /^\d{6}$/.test(v.trim());
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchMode(newMode) {
  mode = newMode;
  Object.entries(PANELS).forEach(([key, el]) => { el.hidden = key !== newMode; });
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.mode === newMode;
    t.classList.toggle("tab--active", active);
    t.setAttribute("aria-selected", String(active));
  });
  hideAllStates();
  show(heroEl);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

// ── Compare sub-tab switching ─────────────────────────────────────────────────
document.querySelectorAll(".sub-tab").forEach((st) => {
  st.addEventListener("click", () => {
    compareSubMode = st.dataset.compare;
    document.querySelectorAll(".sub-tab").forEach((s) => {
      s.classList.toggle("sub-tab--active", s === st);
    });
    document.getElementById("cmp-pincode-fields").hidden = compareSubMode !== "pincode";
    document.getElementById("cmp-platform-fields").hidden = compareSubMode !== "platform";
    cmpBtn.textContent = compareSubMode === "platform" ? "Compare Platforms" : "Compare";
    hideAllStates();
    show(heroEl);
  });
});

// ── Sort & filter ─────────────────────────────────────────────────────────────
function applySort(products) {
  let list = [...products];
  if (currentInStockOnly) list = list.filter((p) => p.isAvailable !== false);
  switch (currentSort) {
    case "price-asc":
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case "price-desc":
      list.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      break;
    case "discount":
      list.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0));
      break;
  }
  return list;
}

function resetSortState() {
  currentSort = "default";
  currentInStockOnly = false;
  instockCheckbox.checked = false;
  document.querySelectorAll(".sort-pill").forEach((p) => {
    p.classList.toggle("sort-pill--active", p.dataset.sort === "default");
  });
}

document.querySelectorAll(".sort-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    currentSort = pill.dataset.sort;
    document.querySelectorAll(".sort-pill").forEach((p) => {
      p.classList.toggle("sort-pill--active", p === pill);
    });
    if (currentData) {
      resultsEl.innerHTML = applySort(currentData.products).map(productCard).join("");
    }
  });
});

instockCheckbox.addEventListener("change", (e) => {
  currentInStockOnly = e.target.checked;
  if (currentData) {
    resultsEl.innerHTML = applySort(currentData.products).map(productCard).join("");
  }
});

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderSkeletons(count = 10) {
  skeletonsEl.innerHTML = Array.from({ length: count })
    .map(
      () => `
      <div class="skeleton">
        <div class="sk-block sk-media"></div>
        <div class="sk-block sk-line short"></div>
        <div class="sk-block sk-line"></div>
        <div class="sk-block sk-line short"></div>
      </div>`
    )
    .join("");
  show(skeletonsEl);
}

function productCard(p) {
  const out = p.isAvailable === false;
  const hasDiscount = p.discount > 0 && p.mrp && p.price && p.mrp > p.price;

  const media = p.image
    ? `<img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'🛒'}))" />`
    : `<div class="ph">🛒</div>`;

  const badge = hasDiscount ? `<span class="badge">${p.discount}% OFF</span>` : "";
  const oos = out ? `<div class="oos"><span>Out of stock</span></div>` : "";

  const priceBlock =
    p.price != null
      ? `<span class="now">${rupee(p.price)}</span>${
          hasDiscount ? `<span class="mrp">${rupee(p.mrp)}</span>` : ""
        }`
      : `<span class="na">Price unavailable</span>`;

  return `
    <article class="card${out ? " card--out" : ""}">
      <div class="card__media">
        ${badge}
        ${media}
        ${oos}
      </div>
      ${p.brand ? `<p class="card__brand">${escapeHtml(p.brand)}</p>` : ""}
      <h3 class="card__name">${escapeHtml(p.name)}</h3>
      ${p.quantity ? `<p class="card__qty">${escapeHtml(p.quantity)}</p>` : ""}
      <div class="card__price">${priceBlock}</div>
    </article>`;
}

// ── Single search ─────────────────────────────────────────────────────────────
function renderResults(data) {
  const products = data.products || [];
  currentData = data;

  metaEl.innerHTML = `
    <span><strong>${products.length}</strong> result${products.length === 1 ? "" : "s"}</span>
    <span class="tag">📍 ${escapeHtml(data.pincode)}</span>
    <span class="tag">🔍 ${escapeHtml(data.query)}</span>
    ${data.fromCache ? `<span class="tag tag--cache">⚡ cached</span>` : ""}
    ${data.scrapedAt ? `<span>updated ${timeAgo(data.scrapedAt)}</span>` : ""}
  `;
  show(metaEl);

  if (products.length === 0) {
    show(emptyEl);
    return;
  }

  show(sortBar);
  resultsEl.innerHTML = applySort(products).map(productCard).join("");
}

async function runSearch(pincode, query) {
  lastAction = { mode: "search", pincode, query };
  currentData = null;
  resetSortState();
  hideAllStates();
  searchBtn.disabled = true;
  searchBtn.textContent = "Searching…";
  renderSkeletons();

  try {
    const url = `/api/blinkit/search?pincode=${encodeURIComponent(pincode)}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();
    hide(skeletonsEl);

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderResults(data);
  } catch (err) {
    hide(skeletonsEl);
    errorText.textContent = err.message || "Something went wrong while scraping.";
    show(errorEl);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
}

panelSearch.addEventListener("submit", (e) => {
  e.preventDefault();
  const pincode = pincodeInput.value.trim();
  const query = queryInput.value.trim();
  if (!validPincode(pincode)) {
    pincodeInput.focus();
    hideAllStates();
    errorText.textContent = "Please enter a valid 6-digit pincode.";
    show(errorEl);
    return;
  }
  if (query.length < 2) { queryInput.focus(); return; }
  runSearch(pincode, query);
});

// ── Bulk search ───────────────────────────────────────────────────────────────
function renderBulkResults(data) {
  const groups = data.results || [];
  if (groups.length === 0) { show(emptyEl); return; }

  bulkResultsEl.innerHTML = groups
    .map((group) => {
      const products = group.products || [];

      if (!group.success) {
        return `
          <div class="bulk-group">
            <div class="bulk-group__header">
              <h2 class="bulk-group__title">${escapeHtml(group.query)}</h2>
            </div>
            <div class="bulk-group__error">Failed: ${escapeHtml(group.error || "Unknown error")}</div>
          </div>`;
      }

      const cards = products.length
        ? products.map(productCard).join("")
        : `<p style="color:var(--muted);font-size:13px;margin:0">No products found.</p>`;

      return `
        <div class="bulk-group">
          <div class="bulk-group__header" role="button" tabindex="0">
            <h2 class="bulk-group__title">${escapeHtml(group.query)}</h2>
            <span class="bulk-group__count">${products.length} result${products.length === 1 ? "" : "s"}</span>
            <button class="bulk-group__toggle" type="button" aria-label="Toggle">▼</button>
          </div>
          <div class="bulk-group__body">${cards}</div>
        </div>`;
    })
    .join("");

  show(bulkResultsEl);

  // Collapse toggle
  bulkResultsEl.querySelectorAll(".bulk-group__header[role='button']").forEach((header) => {
    const toggle = () => header.closest(".bulk-group").classList.toggle("bulk-group--collapsed");
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

async function runBulkSearch(pincode, queries) {
  lastAction = { mode: "bulk", pincode, queries };
  hideAllStates();
  bulkBtn.disabled = true;
  bulkBtn.textContent = "Searching…";

  show(bulkResultsEl);
  bulkResultsEl.innerHTML = `
    <div class="state">
      <div class="state__emoji">⏳</div>
      <p class="state__text">
        Searching ${queries.length} item${queries.length === 1 ? "" : "s"} in sequence…
        <br><span style="font-size:12px;opacity:.65">Blinkit is queried one at a time to avoid rate limits.</span>
      </p>
    </div>`;

  try {
    const res = await fetch("/api/blinkit/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pincode, queries }),
    });
    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderBulkResults(data);
  } catch (err) {
    hide(bulkResultsEl);
    errorText.textContent = err.message || "Something went wrong.";
    show(errorEl);
  } finally {
    bulkBtn.disabled = false;
    bulkBtn.textContent = "Search All";
  }
}

panelBulk.addEventListener("submit", (e) => {
  e.preventDefault();
  const pincode = bulkPincodeInput.value.trim();
  const queries = bulkQueriesInput.value
    .split("\n")
    .map((q) => q.trim())
    .filter(Boolean);

  if (!validPincode(pincode)) {
    bulkPincodeInput.focus();
    hideAllStates();
    errorText.textContent = "Please enter a valid 6-digit pincode.";
    show(errorEl);
    return;
  }
  if (queries.length === 0) { bulkQueriesInput.focus(); return; }
  if (queries.length > 10) {
    hideAllStates();
    errorText.textContent = "Maximum 10 queries per bulk search.";
    show(errorEl);
    return;
  }
  runBulkSearch(pincode, queries);
});

// ── Compare search ────────────────────────────────────────────────────────────

/**
 * Renders the two-column compare layout.
 * col1/col2: { label, platformClass? }  — platformClass is "blinkit" | "zepto" | null
 * data1/data2: API response objects (may have .error if request failed)
 */
function renderCompareResults(col1, data1, col2, data2) {
  const p1 = data1.products || [];
  const p2 = data2.products || [];

  const tag1 = document.getElementById("cmp-tag1");
  const tag2 = document.getElementById("cmp-tag2");

  tag1.textContent = col1.label;
  tag1.className = "tag" + (col1.platformClass ? ` platform-badge--${col1.platformClass}` : "");
  tag2.textContent = col2.label;
  tag2.className = "tag" + (col2.platformClass ? ` platform-badge--${col2.platformClass}` : "");

  document.getElementById("cmp-count1").textContent =
    data1.error ? "Error" : `${p1.length} result${p1.length === 1 ? "" : "s"}`;
  document.getElementById("cmp-count2").textContent =
    data2.error ? "Error" : `${p2.length} result${p2.length === 1 ? "" : "s"}`;

  const noResultMsg = (label) =>
    `<p style="color:var(--muted);font-size:13px">No results from ${escapeHtml(label)}.</p>`;

  document.getElementById("cmp-grid1").innerHTML = data1.error
    ? `<p style="color:var(--red);font-size:13px">${escapeHtml(data1.error)}</p>`
    : p1.length ? p1.map(productCard).join("") : noResultMsg(col1.label);

  document.getElementById("cmp-grid2").innerHTML = data2.error
    ? `<p style="color:var(--red);font-size:13px">${escapeHtml(data2.error)}</p>`
    : p2.length ? p2.map(productCard).join("") : noResultMsg(col2.label);

  show(compareResultsEl);
}

// By Pincode: same platform (Blinkit), two pincodes
async function runCompareSearch(pincode1, pincode2, query) {
  lastAction = { mode: "compare", compareType: "pincode", pincode1, pincode2, query };
  hideAllStates();
  cmpBtn.disabled = true;
  cmpBtn.textContent = "Comparing…";
  renderSkeletons(8);

  const fetchOne = async (pincode) => {
    try {
      const res = await fetch(
        `/api/blinkit/search?pincode=${encodeURIComponent(pincode)}&query=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      if (!res.ok || data.success === false) return { products: [], error: data.error || `Failed (${res.status})` };
      return data;
    } catch (err) {
      return { products: [], error: err.message };
    }
  };

  try {
    const [data1, data2] = await Promise.all([fetchOne(pincode1), fetchOne(pincode2)]);
    hide(skeletonsEl);
    if (data1.error && data2.error) throw new Error(`Both searches failed — ${data1.error}`);
    renderCompareResults(
      { label: `📍 ${pincode1}` }, data1,
      { label: `📍 ${pincode2}` }, data2
    );
  } catch (err) {
    hide(skeletonsEl);
    errorText.textContent = err.message || "Something went wrong.";
    show(errorEl);
  } finally {
    cmpBtn.disabled = false;
    cmpBtn.textContent = "Compare";
  }
}

// By Platform: Blinkit vs Zepto, one pincode
async function runPlatformCompare(pincode, query) {
  lastAction = { mode: "compare", compareType: "platform", pincode, query };
  hideAllStates();
  cmpBtn.disabled = true;
  cmpBtn.textContent = "Comparing…";
  renderSkeletons(8);

  const fetchPlatform = async (platform) => {
    try {
      const res = await fetch(
        `/api/${platform}/search?pincode=${encodeURIComponent(pincode)}&query=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      if (!res.ok || data.success === false) return { products: [], error: data.error || `Failed (${res.status})` };
      return data;
    } catch (err) {
      return { products: [], error: err.message };
    }
  };

  try {
    const [blinkitData, zeptoData] = await Promise.all([
      fetchPlatform("blinkit"),
      fetchPlatform("zepto"),
    ]);
    hide(skeletonsEl);
    if (blinkitData.error && zeptoData.error) {
      throw new Error(`Both platforms failed — ${blinkitData.error}`);
    }
    renderCompareResults(
      { label: "Blinkit", platformClass: "blinkit" }, blinkitData,
      { label: "Zepto", platformClass: "zepto" }, zeptoData
    );
  } catch (err) {
    hide(skeletonsEl);
    errorText.textContent = err.message || "Something went wrong.";
    show(errorEl);
  } finally {
    cmpBtn.disabled = false;
    cmpBtn.textContent = compareSubMode === "platform" ? "Compare Platforms" : "Compare";
  }
}

panelCompare.addEventListener("submit", (e) => {
  e.preventDefault();

  if (compareSubMode === "platform") {
    const pincode = cmpPlatPincode.value.trim();
    const query = cmpPlatQuery.value.trim();
    if (!validPincode(pincode)) {
      cmpPlatPincode.focus();
      hideAllStates();
      errorText.textContent = "Please enter a valid 6-digit pincode.";
      show(errorEl);
      return;
    }
    if (query.length < 2) { cmpPlatQuery.focus(); return; }
    runPlatformCompare(pincode, query);
    return;
  }

  // By pincode
  const p1 = cmpPincode1.value.trim();
  const p2 = cmpPincode2.value.trim();
  const q = cmpQuery.value.trim();

  if (!validPincode(p1)) {
    cmpPincode1.focus();
    hideAllStates();
    errorText.textContent = "Pincode 1 must be a valid 6-digit pincode.";
    show(errorEl);
    return;
  }
  if (!validPincode(p2)) {
    cmpPincode2.focus();
    hideAllStates();
    errorText.textContent = "Pincode 2 must be a valid 6-digit pincode.";
    show(errorEl);
    return;
  }
  if (p1 === p2) {
    hideAllStates();
    errorText.textContent = "Please enter two different pincodes to compare.";
    show(errorEl);
    return;
  }
  if (q.length < 2) { cmpQuery.focus(); return; }
  runCompareSearch(p1, p2, q);
});

// ── Retry ─────────────────────────────────────────────────────────────────────
retryBtn.addEventListener("click", () => {
  if (!lastAction) return;
  if (lastAction.mode === "search") runSearch(lastAction.pincode, lastAction.query);
  if (lastAction.mode === "bulk") runBulkSearch(lastAction.pincode, lastAction.queries);
  if (lastAction.mode === "compare" && lastAction.compareType === "platform") {
    runPlatformCompare(lastAction.pincode, lastAction.query);
  } else if (lastAction.mode === "compare") {
    runCompareSearch(lastAction.pincode1, lastAction.pincode2, lastAction.query);
  }
});

// ── Hero example chips ────────────────────────────────────────────────────────
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    switchMode("search");
    pincodeInput.value = chip.dataset.pincode;
    queryInput.value = chip.dataset.query;
    runSearch(chip.dataset.pincode, chip.dataset.query);
  });
});
