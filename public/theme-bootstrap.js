(() => {
  try {
    const saved = localStorage.getItem('huroof-theme');
    const choice = saved === 'light' || saved === 'dark' ? saved : 'dark';
    document.documentElement.dataset.theme = choice;
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
