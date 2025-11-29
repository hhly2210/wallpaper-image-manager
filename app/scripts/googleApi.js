// Google API script for client-side authentication
(function() {
  const script = document.createElement('script');
  script.src = 'https://apis.google.com/js/api.js';
  script.async = true;
  script.defer = true;

  script.onload = function() {
    console.log('Google API loaded successfully');
    // Dispatch event when Google API is ready
    window.dispatchEvent(new Event('googleApiLoaded'));
  };

  script.onerror = function() {
    console.error('Failed to load Google API');
  };

  document.head.appendChild(script);
})();