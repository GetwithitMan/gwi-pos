/**
 * GWI POS — Embeddable Reservation Widget
 *
 * Usage:
 *   <script src="https://yourpos.thepasspos.com/widget/reserve.js?v=1"
 *           data-slug="venue-slug"
 *           data-location-id="location-id">
 *   </script>
 *
 * Creates an iframe inside a Shadow DOM container for style isolation.
 * Communicates with the booking page via postMessage for auto-resize.
 */
(function () {
  'use strict';

  // Find current script tag to read data attributes
  var script = document.currentScript;
  if (!script) return;

  var slug = script.getAttribute('data-slug');
  var locationId = script.getAttribute('data-location-id');
  if (!slug || !locationId) {
    console.error('[GWI Reserve Widget] Missing data-slug or data-location-id attribute');
    return;
  }

  // Determine base URL from script src
  var baseUrl = '';
  try {
    var scriptUrl = new URL(script.src);
    baseUrl = scriptUrl.origin;
  } catch (e) {
    // Fallback: assume same origin
    baseUrl = window.location.origin;
  }

  var iframeSrc = baseUrl + '/reserve/' + encodeURIComponent(slug) + '?locationId=' + encodeURIComponent(locationId);

  // Create host container
  var host = document.createElement('div');
  host.id = 'gwi-reserve-widget';
  script.parentNode.insertBefore(host, script.nextSibling);

  // Shadow DOM for style isolation
  var shadow = host.attachShadow({ mode: 'open' });

  // Styles
  var style = document.createElement('style');
  style.textContent = [
    ':host { display: block; width: 100%; }',
    'iframe { width: 100%; border: none; min-height: 600px; border-radius: 12px; transition: height 0.2s ease; }',
  ].join('\n');
  shadow.appendChild(style);

  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.title = 'Make a Reservation';
  iframe.loading = 'lazy';
  iframe.allow = 'payment';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation');
  shadow.appendChild(iframe);

  // Listen for resize messages from the booking page
  window.addEventListener('message', function (event) {
    if (event.origin !== baseUrl) return;

    var data = event.data;
    if (data && data.type === 'gwi-reserve-resize' && typeof data.height === 'number') {
      iframe.style.height = data.height + 'px';
    }
  });
})();
