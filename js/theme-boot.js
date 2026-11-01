// Тема — до першого малювання, щоб не блимало; «Авто» — за налаштуванням телефона.
(function () {
  var pref = 'auto';
  try { pref = JSON.parse(localStorage.getItem('pustelha:theme')) || 'auto'; } catch (e) { /* приватний режим */ }
  var light = pref === 'light' || (pref === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = pref === 'night' ? 'night' : light ? 'light' : 'dark';
})();
