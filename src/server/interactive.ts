/**
 * Client-side interactivity script.
 *
 * Handles parameter change events, partial re-queries via POST /api/query,
 * loading states, URL query string sync, and browser history navigation.
 * Injected on all dashboard pages (interactivity is a core feature).
 */

export const ORRERY_INTERACTIVE_JS = /* js */ `
(function() {
  'use strict';

  var state = window.__ORRERY__;
  if (!state) return;

  // Dashboard name from the URL path: /d/<name>
  var pathParts = location.pathname.split('/');
  var dashIdx = pathParts.indexOf('d');
  var dashboardName = dashIdx >= 0 ? pathParts[dashIdx + 1] : pathParts[pathParts.length - 1];

  // Current parameter values (mutable)
  var paramValues = Object.assign({}, state.paramValues || {});

  // Map of param name → list of component IDs that reference it
  var paramComponentMap = buildParamComponentMap();

  // Debounce timers
  var debounceTimers = {};

  // Auto-refresh timer
  var autoRefreshTimer = null;

  // Track in-flight requests to prevent stacking
  var inflightRequest = null;

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    hydrateParamControls();
    hydrateRefreshButtons();
    hydrateCharts();
    syncFromUrl();
    setupKeyboardShortcuts();
    setupAutoRefresh();
    setupPopState();
  }

  // ---------------------------------------------------------------------------
  // Build param → component map
  // ---------------------------------------------------------------------------

  function buildParamComponentMap() {
    var map = {};
    if (!state.params) return map;

    // Initialize all params
    for (var i = 0; i < state.params.length; i++) {
      map[state.params[i].name] = [];
    }

    // Walk layout to find which components reference which params
    if (state.layout && state.layout.rows) {
      for (var r = 0; r < state.layout.rows.length; r++) {
        var row = state.layout.rows[r];
        for (var c = 0; c < row.components.length; c++) {
          var comp = row.components[c];
          var compId = comp.id;

          // Check component data for SQL references
          var compData = state.data && state.data[compId];
          if (compData && compData.result && compData.result.sql) {
            var sql = compData.result.sql;
            for (var paramName in map) {
              // Check for {{param_name}} or {{param_name.subprop}} references
              var pattern = new RegExp('\\\\{\\\\{' + paramName + '(?:\\\\.[a-z_]+)?\\\\}\\\\}', 'i');
              if (pattern.test(sql)) {
                map[paramName].push(compId);
              }
            }
          }
        }
      }
    }

    // If we couldn't determine mappings (no SQL in result), assume all components
    // are affected by any param change
    var hasAnyMapping = false;
    for (var p in map) {
      if (map[p].length > 0) { hasAnyMapping = true; break; }
    }
    if (!hasAnyMapping) {
      var allIds = getAllComponentIds();
      for (var p2 in map) {
        map[p2] = allIds;
      }
    }

    return map;
  }

  function getAllComponentIds() {
    var ids = [];
    var els = document.querySelectorAll('[data-component-id]');
    for (var i = 0; i < els.length; i++) {
      ids.push(els[i].getAttribute('data-component-id'));
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Hydrate parameter controls
  // ---------------------------------------------------------------------------

  function hydrateParamControls() {
    var paramEls = document.querySelectorAll('[data-param-name]');
    for (var i = 0; i < paramEls.length; i++) {
      hydrateParam(paramEls[i]);
    }
  }

  function hydrateParam(el) {
    var name = el.getAttribute('data-param-name');
    var type = el.getAttribute('data-param-type');

    switch (type) {
      case 'daterange':
        hydrateDateRange(el, name);
        break;
      case 'select':
        hydrateSelect(el, name);
        break;
      case 'multiselect':
        hydrateMultiSelect(el, name);
        break;
      case 'text':
        hydrateText(el, name);
        break;
      case 'number':
        hydrateNumber(el, name);
        break;
      case 'toggle':
        hydrateToggle(el, name);
        break;
    }
  }

  function hydrateDateRange(el, name) {
    var presetSelect = el.querySelector('.orrery-daterange-preset');
    var customDiv = el.querySelector('.orrery-daterange-custom');
    var startInput = el.querySelector('input[name="' + name + '.start"]');
    var endInput = el.querySelector('input[name="' + name + '.end"]');

    if (presetSelect) {
      presetSelect.addEventListener('change', function() {
        var val = presetSelect.value;
        if (val === 'custom') {
          customDiv.style.display = '';
          // Use current custom dates if available
          if (startInput && startInput.value && endInput && endInput.value) {
            paramValues[name] = { start: startInput.value, end: endInput.value };
          }
        } else {
          customDiv.style.display = 'none';
          paramValues[name] = val;
        }
        onParamChange(name);
      });
    }

    if (startInput) {
      startInput.addEventListener('change', function() {
        paramValues[name] = { start: startInput.value, end: endInput ? endInput.value : '' };
        if (presetSelect) presetSelect.value = 'custom';
        onParamChange(name);
      });
    }
    if (endInput) {
      endInput.addEventListener('change', function() {
        paramValues[name] = { start: startInput ? startInput.value : '', end: endInput.value };
        if (presetSelect) presetSelect.value = 'custom';
        onParamChange(name);
      });
    }
  }

  function hydrateSelect(el, name) {
    var select = el.querySelector('select');
    if (!select) return;
    select.addEventListener('change', function() {
      paramValues[name] = select.value;
      onParamChange(name);
    });
  }

  function hydrateMultiSelect(el, name) {
    var wrapper = el.querySelector('.orrery-multiselect');
    var toggle = el.querySelector('.orrery-multiselect-toggle');
    var dropdown = el.querySelector('.orrery-multiselect-dropdown');
    if (!wrapper || !toggle || !dropdown) return;

    var checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');

    // Toggle dropdown open/close
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      wrapper.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('open');
      }
    });

    // Handle checkbox changes
    for (var i = 0; i < checkboxes.length; i++) {
      checkboxes[i].addEventListener('change', function() {
        var selected = [];
        for (var j = 0; j < checkboxes.length; j++) {
          if (checkboxes[j].checked) selected.push(checkboxes[j].value);
        }
        var val = selected.join(',');
        paramValues[name] = val;
        toggle.textContent = selected.length > 0 ? selected.join(', ') : 'All';
        onParamChange(name);
      });
    }
  }

  function hydrateText(el, name) {
    var input = el.querySelector('input');
    if (!input) return;
    var debounceMs = parseInt(input.getAttribute('data-debounce') || '300', 10);

    input.addEventListener('input', function() {
      paramValues[name] = input.value;
      clearTimeout(debounceTimers[name]);
      debounceTimers[name] = setTimeout(function() {
        onParamChange(name);
      }, debounceMs);
    });
  }

  function hydrateNumber(el, name) {
    var input = el.querySelector('input');
    if (!input) return;

    input.addEventListener('change', function() {
      paramValues[name] = input.value === '' ? null : Number(input.value);
      onParamChange(name);
    });
  }

  function hydrateToggle(el, name) {
    var btn = el.querySelector('.orrery-toggle');
    if (!btn) return;

    btn.addEventListener('click', function() {
      var isOn = btn.classList.toggle('orrery-toggle-on');
      btn.setAttribute('aria-checked', String(isOn));
      paramValues[name] = isOn;
      onParamChange(name);
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh buttons
  // ---------------------------------------------------------------------------

  function hydrateRefreshButtons() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="refresh"]');
      if (!btn) return;
      var container = btn.closest('[data-component-id]');
      if (!container) return;
      var compId = container.getAttribute('data-component-id');
      refreshComponents([compId]);
    });
  }

  // ---------------------------------------------------------------------------
  // Parameter change → partial re-query
  // ---------------------------------------------------------------------------

  function onParamChange(changedParam) {
    // Determine which components are affected
    var affected = paramComponentMap[changedParam];
    if (!affected || affected.length === 0) {
      // If no known mapping, refresh all
      affected = getAllComponentIds();
    }

    syncToUrl();
    refreshComponents(affected);
  }

  function refreshComponents(componentIds) {
    if (componentIds.length === 0) return;

    // Show loading state on affected components
    for (var i = 0; i < componentIds.length; i++) {
      showLoading(componentIds[i]);
    }

    // Serialize params for the request
    var serializedParams = {};
    for (var key in paramValues) {
      serializedParams[key] = paramValues[key];
    }

    // Abort any in-flight request
    if (inflightRequest) {
      try { inflightRequest.abort(); } catch(e) {}
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    inflightRequest = controller;

    var fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboard: dashboardName,
        params: serializedParams,
        components: componentIds,
        format: 'html'
      })
    };
    if (controller) fetchOpts.signal = controller.signal;

    fetch('/api/query', fetchOpts)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        inflightRequest = null;
        if (data.html) {
          for (var compId in data.html) {
            updateComponent(compId, data.html[compId]);
          }
        }
      })
      .catch(function(err) {
        inflightRequest = null;
        if (err.name === 'AbortError') return;
        console.error('[orrery] Refresh failed:', err);
        // Remove loading states on error
        for (var i = 0; i < componentIds.length; i++) {
          hideLoading(componentIds[i]);
        }
      });
  }

  function refreshAll() {
    refreshComponents(getAllComponentIds());
  }

  // ---------------------------------------------------------------------------
  // Loading states
  // ---------------------------------------------------------------------------

  function showLoading(compId) {
    var el = document.querySelector('[data-component-id="' + compId + '"]');
    if (!el) return;
    // Don't add duplicate loading overlays
    if (el.querySelector('.orrery-loading')) return;
    var overlay = document.createElement('div');
    overlay.className = 'orrery-loading';
    overlay.innerHTML = '<div class="orrery-spinner"></div>';
    el.appendChild(overlay);
  }

  function hideLoading(compId) {
    var el = document.querySelector('[data-component-id="' + compId + '"]');
    if (!el) return;
    var overlay = el.querySelector('.orrery-loading');
    if (overlay) overlay.remove();
  }

  // ---------------------------------------------------------------------------
  // Component update
  // ---------------------------------------------------------------------------

  function updateComponent(compId, html) {
    var el = document.querySelector('[data-component-id="' + compId + '"]');
    if (!el) return;

    // Remove loading overlay
    var overlay = el.querySelector('.orrery-loading');
    if (overlay) overlay.remove();

    // Find and replace body + footer
    var body = el.querySelector('.orrery-component-body');
    var footer = el.querySelector('.orrery-component-footer');

    // Parse the fragment to extract body and footer
    var temp = document.createElement('div');
    temp.innerHTML = html;

    var newBody = temp.querySelector('.orrery-component-body');
    var newFooter = temp.querySelector('.orrery-component-footer');

    if (body && newBody) {
      // Dispose any existing ECharts instance before replacing
      var oldCharts = body.querySelectorAll('[data-chart-instance]');
      for (var ci = 0; ci < oldCharts.length; ci++) {
        var inst = window.echarts && window.echarts.getInstanceByDom(oldCharts[ci]);
        if (inst) inst.dispose();
      }
      body.innerHTML = newBody.innerHTML;
      // Re-hydrate any charts in the updated body
      var newCharts = body.querySelectorAll('[data-chart-option]');
      for (var cj = 0; cj < newCharts.length; cj++) {
        hydrateOneChart(newCharts[cj]);
      }
    }

    if (footer && newFooter) {
      footer.innerHTML = newFooter.innerHTML;
    } else if (!footer && newFooter) {
      // Add footer if it didn't exist before
      el.appendChild(newFooter);
    } else if (footer && !newFooter) {
      footer.remove();
    }

    // Brief pulse animation to indicate update
    el.style.transition = 'box-shadow 0.3s ease';
    el.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.4)';
    setTimeout(function() {
      el.style.boxShadow = '';
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // URL state sync
  // ---------------------------------------------------------------------------

  function syncToUrl() {
    var params = new URLSearchParams();

    for (var key in paramValues) {
      var val = paramValues[key];
      if (val === null || val === undefined || val === '') continue;

      if (typeof val === 'object' && val !== null) {
        // Daterange object — serialize as start,end or preset key
        if (val.preset) {
          params.set(key, val.preset);
        } else if (val.start) {
          params.set(key + '.start', val.start);
          if (val.end) params.set(key + '.end', val.end);
        }
      } else if (typeof val === 'boolean') {
        params.set(key, val ? 'true' : 'false');
      } else {
        params.set(key, String(val));
      }
    }

    var qs = params.toString();
    var newUrl = location.pathname + (qs ? '?' + qs : '');
    if (newUrl !== location.pathname + location.search) {
      history.pushState({ paramValues: paramValues }, '', newUrl);
    }
  }

  function syncFromUrl() {
    var params = new URLSearchParams(location.search);
    if (params.toString() === '') return;

    var changed = false;

    for (var i = 0; i < state.params.length; i++) {
      var p = state.params[i];
      var name = p.name;

      if (p.type === 'daterange') {
        // Check for preset key or custom start/end
        var preset = params.get(name);
        var start = params.get(name + '.start');
        var end = params.get(name + '.end');

        if (preset && preset !== 'custom') {
          paramValues[name] = preset;
          changed = true;
          // Update preset select
          var presetSelect = document.querySelector('[data-param-name="' + name + '"] .orrery-daterange-preset');
          if (presetSelect) presetSelect.value = preset;
        } else if (start) {
          paramValues[name] = { start: start, end: end || '' };
          changed = true;
          // Update custom inputs
          var el = document.querySelector('[data-param-name="' + name + '"]');
          if (el) {
            var si = el.querySelector('input[name="' + name + '.start"]');
            var ei = el.querySelector('input[name="' + name + '.end"]');
            if (si) si.value = start;
            if (ei) ei.value = end || '';
            var ps = el.querySelector('.orrery-daterange-preset');
            if (ps) ps.value = 'custom';
            var cd = el.querySelector('.orrery-daterange-custom');
            if (cd) cd.style.display = '';
          }
        }
      } else if (p.type === 'toggle') {
        var val = params.get(name);
        if (val !== null) {
          var boolVal = val === 'true';
          paramValues[name] = boolVal;
          changed = true;
          var btn = document.querySelector('[data-param-name="' + name + '"] .orrery-toggle');
          if (btn) {
            btn.classList.toggle('orrery-toggle-on', boolVal);
            btn.setAttribute('aria-checked', String(boolVal));
          }
        }
      } else {
        var val2 = params.get(name);
        if (val2 !== null) {
          if (p.type === 'number') {
            paramValues[name] = Number(val2);
          } else {
            paramValues[name] = val2;
          }
          changed = true;
          // Update the control
          var input = document.querySelector('[data-param-name="' + name + '"] input, [data-param-name="' + name + '"] select');
          if (input) input.value = val2;
        }
      }
    }

    // If URL had params that differ from defaults, trigger a refresh
    if (changed) {
      refreshAll();
    }
  }

  function setupPopState() {
    window.addEventListener('popstate', function(e) {
      if (e.state && e.state.paramValues) {
        paramValues = Object.assign({}, e.state.paramValues);
        // Update all controls to match
        updateControlsFromState();
        refreshAll();
      } else {
        // Reset to initial state
        syncFromUrl();
      }
    });
  }

  function updateControlsFromState() {
    for (var i = 0; i < state.params.length; i++) {
      var p = state.params[i];
      var name = p.name;
      var val = paramValues[name];
      var el = document.querySelector('[data-param-name="' + name + '"]');
      if (!el) continue;

      switch (p.type) {
        case 'daterange': {
          var ps = el.querySelector('.orrery-daterange-preset');
          var cd = el.querySelector('.orrery-daterange-custom');
          var si = el.querySelector('input[name="' + name + '.start"]');
          var ei = el.querySelector('input[name="' + name + '.end"]');
          if (typeof val === 'string') {
            if (ps) ps.value = val;
            if (cd) cd.style.display = 'none';
          } else if (val && typeof val === 'object') {
            if (ps) ps.value = val.preset || 'custom';
            if (val.preset && val.preset !== 'custom') {
              if (cd) cd.style.display = 'none';
            } else {
              if (cd) cd.style.display = '';
              if (si) si.value = val.start || '';
              if (ei) ei.value = val.end || '';
            }
          }
          break;
        }
        case 'toggle': {
          var btn = el.querySelector('.orrery-toggle');
          if (btn) {
            var isOn = val === true || val === 'true';
            btn.classList.toggle('orrery-toggle-on', isOn);
            btn.setAttribute('aria-checked', String(isOn));
          }
          break;
        }
        default: {
          var input = el.querySelector('input, select');
          if (input) input.value = val != null ? String(val) : '';
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-refresh
  // ---------------------------------------------------------------------------

  function setupAutoRefresh() {
    // Check if dashboard has a refresh interval set
    // It's stored in window.__ORRERY__ as part of the serialized state
    // The server extracts it from the dashboard AST
    var refreshInterval = state.refreshInterval;
    if (!refreshInterval || refreshInterval <= 0) return;

    autoRefreshTimer = setInterval(function() {
      refreshAll();
    }, refreshInterval * 1000);
  }

  // Theme toggle disabled — needs proper dark mode implementation for ECharts
  // See deferred backlog for dark mode rework

  function _unused_hydrateThemeToggle() {
    var btn = document.querySelector('[data-action="toggle-theme"]');
    if (!btn) return;

    // Restore saved preference from localStorage
    var saved = null;
    try { saved = localStorage.getItem('orrery-theme'); } catch(e) {}
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved);
    }

    btn.addEventListener('click', function() {
      var current = document.documentElement.getAttribute('data-theme') || 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('orrery-theme', next); } catch(e) {}
    });

  }

  function applyTheme(theme) {
    var light = {
      '--ob-bg': '#f8f9fa', '--ob-surface': '#ffffff', '--ob-border': '#e2e8f0',
      '--ob-text': '#1a202c', '--ob-text-muted': '#718096', '--ob-primary': '#3b82f6',
      '--ob-error-bg': '#fef2f2', '--ob-error-border': '#fecaca', '--ob-error-text': '#991b1b',
      '--ob-shadow': '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
      '--ob-loading-overlay': 'rgba(255, 255, 255, 0.7)'
    };
    var dark = {
      '--ob-bg': '#0f172a', '--ob-surface': '#1e293b', '--ob-border': '#334155',
      '--ob-text': '#f1f5f9', '--ob-text-muted': '#94a3b8', '--ob-primary': '#60a5fa',
      '--ob-error-bg': '#451a1a', '--ob-error-border': '#7f1d1d', '--ob-error-text': '#fca5a5',
      '--ob-shadow': '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
      '--ob-loading-overlay': 'rgba(15, 23, 42, 0.7)'
    };

    var vars = theme === 'dark' ? dark : light;
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    for (var key in vars) {
      root.style.setProperty(key, vars[key]);
    }

    // Update toggle icon
    var icon = document.querySelector('.orrery-theme-icon');
    if (icon) {
      icon.innerHTML = theme === 'dark' ? '\\u2600' : '\\u263E';
    }

    // Re-apply theme colors to all live ECharts instances
    rethemeCharts();
  }

  function rethemeCharts() {
    if (!window.echarts) return;
    // Dispose all existing chart instances and re-hydrate from the stored option JSON
    // This guarantees theme colors are applied fresh
    var containers = document.querySelectorAll('[data-chart-instance]');
    for (var i = 0; i < containers.length; i++) {
      var inst = window.echarts.getInstanceByDom(containers[i]);
      if (inst) inst.dispose();
      containers[i].removeAttribute('data-chart-instance');
      containers[i].style.width = '';
      containers[i].style.height = '';
    }
    // The data-chart-option attribute is still on the original containers
    var toHydrate = document.querySelectorAll('[data-chart-option]');
    for (var j = 0; j < toHydrate.length; j++) {
      hydrateOneChart(toHydrate[j]);
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Don't trigger shortcuts when typing in inputs
      var tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case 'r':
        case 'R':
          e.preventDefault();
          refreshAll();
          break;
        case 'Escape':
          resetToDefaults();
          break;
        case '/':
          e.preventDefault();
          focusFirstTextParam();
          break;
      }
    });
  }

  function resetToDefaults() {
    paramValues = Object.assign({}, state.paramValues || {});
    updateControlsFromState();
    syncToUrl();
    refreshAll();
  }

  function focusFirstTextParam() {
    var textInput = document.querySelector('[data-param-type="text"] input');
    if (textInput) textInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Chart hydration (ECharts tooltips + resize)
  // ---------------------------------------------------------------------------

  // Module-scoped promise that resolves once window.echarts is defined.
  // Dedupes concurrent loads so only one <script> tag is ever appended.
  var echartsReady = null;
  var resizeListenerAttached = false;

  function ensureECharts() {
    if (window.echarts) return Promise.resolve();
    if (echartsReady) return echartsReady;
    echartsReady = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = '/orrery/vendor/echarts.min.js';
      script.onload = function() {
        if (window.echarts) resolve();
        else reject(new Error('echarts script loaded but window.echarts is undefined'));
      };
      script.onerror = function() {
        reject(new Error('Failed to load echarts from /orrery/vendor/echarts.min.js'));
      };
      document.head.appendChild(script);
    });
    // If loading fails, clear the cached rejected promise so a later
    // re-hydration (e.g. on nav back) gets a fresh attempt.
    echartsReady.catch(function() { echartsReady = null; });
    return echartsReady;
  }

  function attachResizeListener() {
    if (resizeListenerAttached) return;
    resizeListenerAttached = true;
    window.addEventListener('resize', function() {
      if (!window.echarts) return;
      var charts = document.querySelectorAll('[data-chart-instance]');
      for (var j = 0; j < charts.length; j++) {
        var inst = window.echarts.getInstanceByDom(charts[j]);
        if (inst) inst.resize();
      }
    });
  }

  function hydrateCharts() {
    var containers = document.querySelectorAll('[data-chart-option]');
    if (containers.length === 0) return;
    for (var i = 0; i < containers.length; i++) {
      hydrateOneChart(containers[i]);
    }
  }

  function hydrateOneChart(container) {
    var optionJson = container.getAttribute('data-chart-option');
    if (!optionJson) return;

    // Gate ALL destructive DOM work behind echarts availability.
    // If the library isn't loaded yet (or fails to load), leave the SSR SVG
    // untouched — a static chart beats a blank div.
    ensureECharts().then(function() {
      doHydrateOneChart(container);
    }).catch(function(err) {
      console.warn('[Orrery] Chart hydration skipped:', err && err.message ? err.message : err);
    });
  }

  function doHydrateOneChart(container) {
    var optionJson = container.getAttribute('data-chart-option');
    if (!optionJson) return;

    try {
      var option = JSON.parse(optionJson);
    } catch(e) {
      console.warn('[Orrery] Failed to parse chart option:', e);
      return;
    }

    attachResizeListener();

    // Clear any previous fixed dimensions so we measure the natural layout size
    container.style.width = '';
    container.style.height = '';
    container.removeAttribute('data-chart-instance');

    // Measure before clearing SVG
    var rect = container.getBoundingClientRect();
    var width = Math.round(rect.width) || 600;
    var height = Math.round(rect.height) || 350;

    // Replace static SVG with live ECharts canvas
    container.innerHTML = '';
    container.style.width = width + 'px';
    container.style.height = height + 'px';
    container.setAttribute('data-chart-instance', 'true');

    // Add dataZoom for interactivity (scroll to zoom, drag to pan)
    var xData = option.xAxis && option.xAxis.data;
    var hasEnoughData = xData && xData.length > 10;
    if (hasEnoughData) {
      option.dataZoom = [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none'
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          height: 20,
          bottom: 4,
          borderColor: 'transparent',
          backgroundColor: 'rgba(150,150,150,0.1)',
          fillerColor: 'rgba(100,100,200,0.15)',
          handleSize: '80%',
          handleStyle: { color: '#aaa', borderColor: '#999' },
          textStyle: { fontSize: 10 }
        }
      ];
      // Make room for the slider
      if (option.grid) {
        option.grid.bottom = (option.grid.bottom || 36) + 30;
      }
    }

    try {
      var chart = window.echarts.init(container, null, { renderer: 'canvas' });
      chart.setOption(option);
    } catch(e) {
      console.warn('[Orrery] Chart hydration failed:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
