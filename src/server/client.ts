/**
 * Client-side JavaScript for dev hot reload.
 *
 * Injected into dashboard pages during dev mode. Handles:
 * - WebSocket connection to dev server
 * - Error overlay display/dismiss
 * - Dashboard reload on file change
 */

export const ORRERY_CLIENT_JS = /* js */ `
(function() {
  'use strict';

  // --- WebSocket connection ---
  var ws = null;
  var reconnectTimer = null;
  var overlayEl = null;

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws');

    ws.onopen = function() {
      console.log('[orrery] Connected to dev server');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = function(event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch(e) { return; }
      handleMessage(msg);
    };

    ws.onclose = function() {
      console.log('[orrery] Disconnected, reconnecting...');
      scheduleReconnect();
    };

    ws.onerror = function() {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(function() {
        reconnectTimer = null;
        connect();
      }, 1000);
    }
  }

  // --- Message handling ---
  function handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        break;
      case 'reload':
        location.reload();
        break;
      case 'update':
        // For now, reload the page. Granular component updates can come later.
        location.reload();
        break;
      case 'error':
        showErrorOverlay(msg.error);
        break;
      case 'error-clear':
        hideErrorOverlay();
        break;
    }
  }

  // --- Error overlay ---
  function showErrorOverlay(error) {
    hideErrorOverlay();

    overlayEl = document.createElement('div');
    overlayEl.id = 'orrery-error-overlay';
    overlayEl.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.85)', 'color:#fff',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
      'font-size:14px', 'padding:2rem', 'overflow:auto',
      'display:flex', 'flex-direction:column', 'align-items:center',
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = 'max-width:800px;width:100%;';

    var header = document.createElement('div');
    header.style.cssText = 'color:#ff6b6b;font-size:1.2rem;font-weight:bold;margin-bottom:0.5rem;';
    header.textContent = 'Parse Error';
    box.appendChild(header);

    if (error.file) {
      var loc = document.createElement('div');
      loc.style.cssText = 'color:#999;margin-bottom:1rem;';
      loc.textContent = error.file + (error.line ? ':' + error.line : '') + (error.column ? ':' + error.column : '');
      box.appendChild(loc);
    }

    var msg = document.createElement('pre');
    msg.style.cssText = 'color:#ff9999;white-space:pre-wrap;word-break:break-word;margin-bottom:1rem;line-height:1.5;';
    msg.textContent = error.message;
    box.appendChild(msg);

    if (error.source) {
      var src = document.createElement('pre');
      src.style.cssText = 'background:#1a1a2e;padding:1rem;border-radius:6px;overflow-x:auto;line-height:1.6;color:#e0e0e0;';
      src.textContent = error.source;
      box.appendChild(src);
    }

    var hint = document.createElement('div');
    hint.style.cssText = 'color:#666;margin-top:1.5rem;font-size:12px;';
    hint.textContent = 'Fix the error and save — this overlay will dismiss automatically.';
    box.appendChild(hint);

    overlayEl.appendChild(box);
    document.body.appendChild(overlayEl);
  }

  function hideErrorOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  // --- Start ---
  connect();
})();
`;
