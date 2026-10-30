// Runs in <head> before paint: apply a remembered theme choice, then wire the toggle.
;(function () {
  var KEY = 'theme'
  var root = document.documentElement
  try {
    var saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved)
  } catch (e) {}
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-toggle]')
    if (!btn) return
    var current = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    var next = current === 'dark' ? 'light' : 'dark'
    root.setAttribute('data-theme', next)
    try { localStorage.setItem(KEY, next) } catch (e) {}
  })
})()
