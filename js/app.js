'use strict';

/* ============================================================
   Constants
   ============================================================ */
const REST_URL = 'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,ccn3,flags,capital,population,region,subregion,area,borders,currencies,languages,timezones,gini,idd,tld,landlocked,continents,latlng';
const FALLBACK_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const FLAG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'%3E%3Crect width='60' height='40' fill='%23374151'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='20' fill='%236b7280'%3E%F0%9F%8F%B3%3C/text%3E%3C/svg%3E";

/* ============================================================
   Application State
   ============================================================ */
const AppState = {
  countries: [],
  countryMap: {},        // { ccn3: country }
  countryByCca3: {},     // { cca3: country } for border lookups
  countryByCca2: {},     // { cca2: country } for quick access
  areaRanks: {},         // { ccn3: rank }
  topoData: null,
  activeContinent: 'all',
  searchQuery: '',
  selectedCountry: null,
  currentView: 'map',
  svg: null,
  zoom: null,
  mapProjection: null,
  mapPath: null,
  mapGroup: null,
};

/* ============================================================
   Utilities
   ============================================================ */
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function fmtNumber(n) {
  if (!n && n !== 0) return 'N/A';
  return new Intl.NumberFormat().format(n);
}

function fmtArea(km2) {
  if (!km2 && km2 !== 0) return 'N/A';
  return new Intl.NumberFormat().format(Math.round(km2)) + ' km²';
}

function regionClass(region) {
  const map = {
    Africa: 'region-Africa',
    Americas: 'region-Americas',
    Asia: 'region-Asia',
    Europe: 'region-Europe',
    Oceania: 'region-Oceania',
    Antarctic: 'region-Antarctic',
  };
  return map[region] || '';
}

function getFlagUrl(cca2, size = 80) {
  if (!cca2) return FLAG_PLACEHOLDER;
  return `https://flagcdn.com/w${size}/${cca2.toLowerCase()}.png`;
}

/* ============================================================
   Data Loading
   ============================================================ */
async function loadData() {
  showLoading(true);
  hideError();

  try {
    let [countries, topo] = await Promise.all([
      fetchCountries(),
      fetch(TOPO_URL).then(r => { if (!r.ok) throw new Error('TopoJSON fetch failed'); return r.json(); }),
    ]);

    // Normalise REST Countries v3.1 response
    if (!Array.isArray(countries)) throw new Error('Invalid countries data');

    AppState.countries = countries;
    AppState.topoData = topo;

    // Build lookup maps
    countries.forEach(c => {
      if (c.ccn3) AppState.countryMap[c.ccn3] = c;
      if (c.cca3) AppState.countryByCca3[c.cca3] = c;
      if (c.cca2) AppState.countryByCca2[c.cca2] = c;
    });

    // Compute area ranks (1 = largest)
    const sorted = [...countries]
      .filter(c => c.area > 0)
      .sort((a, b) => b.area - a.area);
    sorted.forEach((c, i) => {
      if (c.ccn3) AppState.areaRanks[c.ccn3] = i + 1;
    });

    showLoading(false);
    initGrid();
    initMap();
    setupFilters();
    setupViewToggle();
    setupPanelClose();

  } catch (err) {
    showLoading(false);
    showError('Failed to load world data. ' + err.message);
    document.getElementById('btn-retry').addEventListener('click', loadData, { once: true });
  }
}

async function fetchCountries() {
  try {
    const r = await fetch(REST_URL);
    if (!r.ok) throw new Error('REST Countries returned ' + r.status);
    const data = await r.json();
    if (!Array.isArray(data) || data.length < 100) throw new Error('Unexpected response');
    return data;
  } catch {
    // Fallback to mledoze dataset
    const r = await fetch(FALLBACK_URL);
    if (!r.ok) throw new Error('Both country data sources failed');
    return r.json();
  }
}

/* ============================================================
   Loading / Error UI
   ============================================================ */
function showLoading(show) {
  const el = document.getElementById('loading-overlay');
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-message').textContent = msg;
  banner.classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}

/* ============================================================
   D3 Map
   ============================================================ */
function initMap() {
  const container = document.getElementById('map-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  // Choose best available projection
  const proj = typeof d3.geoNaturalEarth2 === 'function'
    ? d3.geoNaturalEarth2()
    : d3.geoNaturalEarth1();

  proj.scale(W / 6.3).translate([W / 2, H / 2]);

  const path = d3.geoPath().projection(proj);
  AppState.mapProjection = proj;
  AppState.mapPath = path;

  const svg = d3.select('#world-map')
    .attr('width', W)
    .attr('height', H)
    .attr('viewBox', `0 0 ${W} ${H}`);

  AppState.svg = svg;

  // Ocean background via SVG defs gradient
  const defs = svg.append('defs');
  const radGrad = defs.append('radialGradient')
    .attr('id', 'oceanGrad')
    .attr('cx', '50%').attr('cy', '50%')
    .attr('r', '70%');
  radGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0a1628');
  radGrad.append('stop').attr('offset', '100%').attr('stop-color', '#030810');

  svg.append('rect')
    .attr('width', W).attr('height', H)
    .attr('fill', 'url(#oceanGrad)');

  const g = svg.append('g').attr('id', 'map-group');
  AppState.mapGroup = g;

  // Land background
  const land = topojson.feature(AppState.topoData, AppState.topoData.objects.land);
  g.append('path')
    .datum(land)
    .attr('class', 'land-bg')
    .attr('d', path)
    .attr('fill', '#0a1e36');

  // Country paths
  const features = topojson.feature(
    AppState.topoData,
    AppState.topoData.objects.countries
  ).features;

  g.selectAll('.country')
    .data(features)
    .join('path')
    .attr('class', d => {
      if (d.id === 10 || d.id === '010') return 'country antarctica';
      if (d.id == null) return 'country disputed';
      return 'country interactive';
    })
    .attr('d', path)
    .attr('data-id', d => String(d.id).padStart(3, '0'))
    .on('mouseenter', onCountryEnter)
    .on('mousemove', onTooltipMove)
    .on('mouseleave', onCountryLeave)
    .on('click', onCountryClick);

  // Borders mesh
  g.append('path')
    .datum(topojson.mesh(
      AppState.topoData,
      AppState.topoData.objects.countries,
      (a, b) => a !== b
    ))
    .attr('class', 'borders-mesh')
    .attr('d', path);

  // Graticule (subtle grid lines)
  const graticule = d3.geoGraticule()();
  g.insert('path', '.land-bg + *')
    .datum(graticule)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(255,255,255,0.03)')
    .attr('stroke-width', 0.5)
    .attr('d', path)
    .attr('pointer-events', 'none');

  setupZoom(svg, g, W, H);
  window.addEventListener('resize', debounce(handleMapResize, 250));
}

function setupZoom(svg, g, W, H) {
  const zoom = d3.zoom()
    .scaleExtent([0.6, 12])
    .translateExtent([[-W * 0.5, -H * 0.5], [W * 1.5, H * 1.5]])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom).on('dblclick.zoom', null);
  AppState.zoom = zoom;

  document.getElementById('zoom-in').onclick = () =>
    svg.transition().duration(350).call(zoom.scaleBy, 1.6);
  document.getElementById('zoom-out').onclick = () =>
    svg.transition().duration(350).call(zoom.scaleBy, 0.65);
  document.getElementById('zoom-reset').onclick = () =>
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
}

function handleMapResize() {
  if (AppState.currentView !== 'map') return;
  const container = document.getElementById('map-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  AppState.svg.attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  AppState.mapProjection.scale(W / 6.3).translate([W / 2, H / 2]);
  AppState.mapPath = d3.geoPath().projection(AppState.mapProjection);

  AppState.mapGroup.selectAll('path').attr('d', AppState.mapPath);
}

/* ============================================================
   Map Interaction
   ============================================================ */
function getCountryFromFeature(d) {
  const idStr = d.id != null ? String(d.id).padStart(3, '0') : null;
  return idStr ? AppState.countryMap[idStr] : null;
}

function onCountryEnter(event, d) {
  if (d.id === 10 || d.id === '010' || d.id == null) {
    if (d.id == null) {
      showTooltip(event, d.properties?.name || 'Disputed territory', null);
    }
    return;
  }
  const country = getCountryFromFeature(d);
  if (!country) return;

  d3.select(event.currentTarget).classed('hovered', true);

  const flagUrl = getFlagUrl(country.cca2, 40);
  showTooltip(event, country.name?.common || 'Unknown', flagUrl);
}

function onTooltipMove(event) {
  positionTooltip(event);
}

function onCountryLeave(event, d) {
  d3.select(event.currentTarget).classed('hovered', false);
  document.getElementById('map-tooltip').classList.add('hidden');
}

function onCountryClick(event, d) {
  if (d.id === 10 || d.id === '010' || d.id == null) return;
  const country = getCountryFromFeature(d);
  if (!country) return;
  openDetailPanel(country);
}

function showTooltip(event, name, flagUrl) {
  const tooltip = document.getElementById('map-tooltip');
  const img = document.getElementById('tooltip-flag');
  const nameEl = document.getElementById('tooltip-name');

  nameEl.textContent = name;
  if (flagUrl) {
    img.src = flagUrl;
    img.onerror = () => { img.style.display = 'none'; };
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
  tooltip.classList.remove('hidden');
  positionTooltip(event);
}

function positionTooltip(event) {
  const tooltip = document.getElementById('map-tooltip');
  const container = document.getElementById('map-container');
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left + 14;
  const y = event.clientY - rect.top - 10;
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  const maxX = rect.width - tw - 4;
  const maxY = rect.height - th - 4;
  tooltip.style.left = Math.min(x, maxX) + 'px';
  tooltip.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
}

/* ============================================================
   Continent Map Highlight
   ============================================================ */
function updateMapContinentHighlight() {
  const continent = AppState.activeContinent;
  d3.selectAll('.country.interactive').each(function(d) {
    const country = getCountryFromFeature(d);
    if (continent === 'all') {
      d3.select(this)
        .classed('continent-dimmed', false)
        .classed('continent-highlighted', false);
    } else {
      const matches = country && (
        country.region === continent ||
        (country.continents && country.continents.includes(continent))
      );
      d3.select(this)
        .classed('continent-dimmed', !matches)
        .classed('continent-highlighted', !!matches);
    }
  });
}

/* ============================================================
   Grid View
   ============================================================ */
function initGrid() {
  const container = document.getElementById('grid-container');
  const sorted = [...AppState.countries].sort((a, b) =>
    (a.name?.common || '').localeCompare(b.name?.common || '')
  );

  container.innerHTML = sorted.map(c => {
    const name = c.name?.common || 'Unknown';
    const region = c.region || '';
    const capital = (c.capital && c.capital[0]) || 'N/A';
    const pop = c.population ? fmtNumber(c.population) : 'N/A';
    const flagUrl = getFlagUrl(c.cca2, 80);
    const badgeClass = regionClass(region);

    return `
      <div class="country-card"
           role="listitem"
           data-ccn3="${c.ccn3 || ''}"
           data-cca2="${(c.cca2 || '').toLowerCase()}"
           data-region="${region}"
           data-name="${name.toLowerCase()}"
           data-official="${(c.name?.official || '').toLowerCase()}"
           tabindex="0"
           aria-label="${name}">
        <div class="card-flag">
          <img src="${flagUrl}"
               loading="lazy"
               alt="${name} flag"
               onerror="this.src='${FLAG_PLACEHOLDER}'">
        </div>
        <div class="card-body">
          <h3 class="card-name">${name}</h3>
          <div class="card-meta">
            <div class="card-meta-row">
              <span class="card-meta-label">Capital</span>
              <span>${capital}</span>
            </div>
            <div class="card-meta-row">
              <span class="card-meta-label">Pop.</span>
              <span>${pop}</span>
            </div>
          </div>
          <span class="card-region-badge ${badgeClass}">${region || 'N/A'}</span>
        </div>
      </div>
    `;
  }).join('');

  // Delegated click + keyboard handler
  container.addEventListener('click', handleGridClick);
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') handleGridClick(e);
  });

  updateGridCount(sorted.length);
}

function handleGridClick(e) {
  const card = e.target.closest('.country-card');
  if (!card) return;
  const ccn3 = card.dataset.ccn3;
  const country = ccn3
    ? AppState.countryMap[ccn3]
    : AppState.countries.find(c => (c.name?.common || '').toLowerCase() === card.dataset.name);
  if (country) openDetailPanel(country);
}

function updateGridCount(n) {
  document.getElementById('grid-count').textContent = `${n} countr${n === 1 ? 'y' : 'ies'}`;
}

/* ============================================================
   Filters & Search
   ============================================================ */
function setupFilters() {
  document.getElementById('continent-filter').addEventListener('change', (e) => {
    AppState.activeContinent = e.target.value;
    applyFilters();
  });

  const debouncedSearch = debounce((query) => {
    AppState.searchQuery = query;
    applyFilters();
  }, 200);

  document.getElementById('search-box').addEventListener('input', (e) => {
    debouncedSearch(e.target.value.toLowerCase().trim());
  });
}

function applyFilters() {
  const continent = AppState.activeContinent;
  const query = AppState.searchQuery;
  let visible = 0;

  document.querySelectorAll('.country-card').forEach(card => {
    const matchesContinent = continent === 'all' || card.dataset.region === continent;
    const matchesSearch = !query ||
      card.dataset.name.includes(query) ||
      card.dataset.official.includes(query);
    const show = matchesContinent && matchesSearch;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  updateGridCount(visible);

  const noResults = document.getElementById('no-results');
  if (visible === 0) {
    noResults.classList.remove('hidden');
  } else {
    noResults.classList.add('hidden');
  }

  if (AppState.currentView === 'map') {
    updateMapContinentHighlight();
  }
}

/* ============================================================
   View Switching
   ============================================================ */
function setupViewToggle() {
  document.getElementById('btn-map-view').addEventListener('click', () => switchView('map'));
  document.getElementById('btn-grid-view').addEventListener('click', () => switchView('grid'));
}

function switchView(view) {
  AppState.currentView = view;

  const mapSection = document.getElementById('map-view');
  const gridSection = document.getElementById('grid-view');
  const btnMap = document.getElementById('btn-map-view');
  const btnGrid = document.getElementById('btn-grid-view');

  const isMap = view === 'map';
  mapSection.classList.toggle('active', isMap);
  mapSection.classList.toggle('hidden', !isMap);
  gridSection.classList.toggle('active', !isMap);
  gridSection.classList.toggle('hidden', isMap);

  btnMap.classList.toggle('active', isMap);
  btnMap.setAttribute('aria-selected', String(isMap));
  btnGrid.classList.toggle('active', !isMap);
  btnGrid.setAttribute('aria-selected', String(!isMap));

  if (isMap) {
    handleMapResize();
    updateMapContinentHighlight();
  }
}

/* ============================================================
   Detail Side Panel
   ============================================================ */
function setupPanelClose() {
  document.getElementById('panel-close').addEventListener('click', closeDetailPanel);
  document.getElementById('panel-backdrop').addEventListener('click', closeDetailPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && AppState.selectedCountry) closeDetailPanel();
  });
}

function openDetailPanel(country) {
  AppState.selectedCountry = country;

  // Update selected highlight on map
  if (AppState.mapGroup) {
    AppState.mapGroup.selectAll('.country.interactive')
      .classed('selected', d => {
        if (d.id == null) return false;
        return String(d.id).padStart(3, '0') === country.ccn3;
      });
  }

  populatePanel(country);

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('closed');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  panel.classList.add('closed');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');

  if (AppState.mapGroup) {
    AppState.mapGroup.selectAll('.country.interactive').classed('selected', false);
  }
  AppState.selectedCountry = null;
}

/* ============================================================
   Panel Content
   ============================================================ */
function populatePanel(c) {
  const body = document.getElementById('panel-body');
  const name = c.name?.common || 'Unknown';
  const official = c.name?.official || '';
  const region = c.region || '';
  const capital = (c.capital && c.capital[0]) || 'N/A';
  const pop = fmtNumber(c.population);
  const area = fmtArea(c.area);
  const callingCode = buildCallingCode(c);
  const flagUrl = getFlagUrl(c.cca2, 320);
  const badgeClass = regionClass(region);

  // Languages
  const languages = c.languages ? Object.values(c.languages) : [];

  // Currencies
  const currencies = c.currencies
    ? Object.entries(c.currencies).map(([code, cur]) =>
        `${cur.name || code}${cur.symbol ? ' (' + cur.symbol + ')' : ''}`)
    : [];

  // Borders
  const borders = (c.borders || []).map(cca3 => {
    const neighbour = AppState.countryByCca3[cca3];
    return { cca3, name: neighbour?.name?.common || cca3, ccn3: neighbour?.ccn3 || '' };
  });

  // Facts
  const facts = buildFacts(c);

  body.innerHTML = `
    <div class="panel-hero">
      <div class="panel-flag-container">
        <img class="panel-flag-img"
             src="${flagUrl}"
             alt="${name} flag"
             onerror="this.src='${FLAG_PLACEHOLDER}'">
      </div>
      <div class="panel-hero-overlay">
        <h2 class="panel-country-name">${name}</h2>
        ${official !== name ? `<p class="panel-official-name">${official}</p>` : ''}
        ${region ? `<span class="panel-region-badge ${badgeClass}">${region}</span>` : ''}
      </div>
    </div>

    <div class="panel-stats-grid">
      <div class="stat-card">
        <label>Capital</label>
        <span>${capital}</span>
      </div>
      <div class="stat-card">
        <label>Population</label>
        <span>${pop}</span>
      </div>
      <div class="stat-card">
        <label>Area</label>
        <span>${area}</span>
      </div>
      <div class="stat-card">
        <label>Calling Code</label>
        <span>${callingCode}</span>
      </div>
    </div>

    <div class="panel-divider"></div>

    <div class="panel-section">
      <div class="panel-section-title">Interesting Facts</div>
      <div class="facts-grid">
        ${facts.map(f => `
          <div class="fact-chip">
            <span class="fact-icon">${f.icon}</span>
            <div class="fact-text">
              <span class="fact-label">${f.label}</span>
              <span class="fact-value" title="${f.value}">${f.value}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    ${languages.length ? `
    <div class="panel-divider"></div>
    <div class="panel-section">
      <div class="panel-section-title">Languages</div>
      <div class="tag-list">
        ${languages.map(l => `<span class="tag">${l}</span>`).join('')}
      </div>
    </div>` : ''}

    ${currencies.length ? `
    <div class="panel-divider"></div>
    <div class="panel-section">
      <div class="panel-section-title">Currencies</div>
      <div class="tag-list">
        ${currencies.map(cur => `<span class="tag">${cur}</span>`).join('')}
      </div>
    </div>` : ''}

    ${borders.length ? `
    <div class="panel-divider"></div>
    <div class="panel-section">
      <div class="panel-section-title">Borders (${borders.length})</div>
      <div class="tag-list" id="borders-list">
        ${borders.map(b => `
          <span class="tag clickable" data-ccn3="${b.ccn3}" data-cca3="${b.cca3}" tabindex="0" role="button">
            ${b.name}
          </span>
        `).join('')}
      </div>
    </div>` : ''}

    <div style="height:24px"></div>
  `;

  // Border tag click handler
  const bordersList = document.getElementById('borders-list');
  if (bordersList) {
    bordersList.addEventListener('click', (e) => {
      const tag = e.target.closest('.tag.clickable');
      if (!tag) return;
      const ccn3 = tag.dataset.ccn3;
      const cca3 = tag.dataset.cca3;
      const neighbour = ccn3
        ? AppState.countryMap[ccn3]
        : AppState.countryByCca3[cca3];
      if (neighbour) openDetailPanel(neighbour);
    });
    bordersList.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') bordersList.click();
    });
  }
}

function buildCallingCode(c) {
  if (!c.idd?.root) return 'N/A';
  const suffixes = c.idd.suffixes || [];
  if (suffixes.length === 1) return c.idd.root + suffixes[0];
  return c.idd.root;
}

function buildFacts(c) {
  const facts = [];

  // Landlocked
  if (c.landlocked === true) {
    facts.push({ icon: '🏔', label: 'Geography', value: 'Landlocked' });
  } else if (c.landlocked === false) {
    facts.push({ icon: '🌊', label: 'Geography', value: 'Coastal' });
  }

  // Area rank
  if (c.ccn3 && AppState.areaRanks[c.ccn3]) {
    facts.push({ icon: '📐', label: 'Area rank', value: '#' + AppState.areaRanks[c.ccn3] + ' in world' });
  }

  // Neighbour count
  if (c.borders && c.borders.length > 0) {
    facts.push({ icon: '🤝', label: 'Neighbors', value: c.borders.length + ' countr' + (c.borders.length === 1 ? 'y' : 'ies') });
  } else if (c.borders && c.borders.length === 0) {
    facts.push({ icon: '🏝', label: 'Borders', value: 'Island nation' });
  }

  // Language count
  const langCount = c.languages ? Object.keys(c.languages).length : 0;
  if (langCount > 0) {
    facts.push({ icon: '💬', label: 'Languages', value: langCount + ' official' });
  }

  // Timezone
  if (c.timezones && c.timezones.length > 0) {
    const tz = c.timezones.length === 1
      ? c.timezones[0]
      : c.timezones[0] + ' …+' + (c.timezones.length - 1);
    facts.push({ icon: '🕐', label: 'Timezone', value: tz });
  }

  // Internet TLD
  if (c.tld && c.tld.length > 0) {
    facts.push({ icon: '🌐', label: 'Internet TLD', value: c.tld[0] });
  }

  // Subregion
  if (c.subregion) {
    facts.push({ icon: '📍', label: 'Subregion', value: c.subregion });
  }

  // Coordinates
  if (c.latlng && c.latlng.length === 2) {
    const lat = Math.abs(Math.round(c.latlng[0])) + '°' + (c.latlng[0] >= 0 ? 'N' : 'S');
    const lng = Math.abs(Math.round(c.latlng[1])) + '°' + (c.latlng[1] >= 0 ? 'E' : 'W');
    facts.push({ icon: '🧭', label: 'Coordinates', value: lat + ', ' + lng });
  }

  // Gini inequality index
  if (c.gini) {
    const year = Object.keys(c.gini).sort().pop();
    if (year) facts.push({ icon: '📊', label: 'Gini ' + year, value: c.gini[year].toFixed(1) });
  }

  return facts;
}

/* ============================================================
   Bootstrap
   ============================================================ */
document.addEventListener('DOMContentLoaded', loadData);
