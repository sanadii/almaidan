(() => {
  let saved;
  try {
    saved = localStorage.getItem('huroof-theme');
  } catch {
    // Browsers can disable storage. The device preference still applies.
  }
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
    for (const meta of document.querySelectorAll('meta[name="theme-color"][data-theme]')) {
      meta.setAttribute('media', meta.dataset.theme === saved ? 'all' : 'not all');
    }
  } else {
    document.documentElement.dataset.theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  if (window.location.pathname === '/') {
    const mobile = window.matchMedia?.('(width < 768px)').matches;
    const widths = mobile ? [800, 1280] : [800, 1280, 1672];
    const crop = mobile ? '-mobile' : '';
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.setAttribute('as', 'image');
    preload.type = 'image/avif';
    preload.setAttribute('imagesrcset', widths.map(width => `/assets/backgrounds/home-games-fantasy${crop}-v2-${width}.avif ${width}w`).join(', '));
    preload.setAttribute('imagesizes', '100vw');
    preload.setAttribute('fetchpriority', 'high');
    document.head.append(preload);
  }
})();
