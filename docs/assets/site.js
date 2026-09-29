const toggle = document.querySelector('.mobile-toggle')
const sidebar = document.querySelector('.sidebar')
toggle?.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open')
  toggle.setAttribute('aria-expanded', String(open))
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    sidebar?.classList.remove('open')
    toggle?.setAttribute('aria-expanded', 'false')
    document.querySelector('#search')?.blur()
  }
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    const search = document.querySelector('#search')
    if (search) {
      event.preventDefault()
      sidebar?.classList.add('open')
      toggle?.setAttribute('aria-expanded', 'true')
      search.focus()
    }
  }
})
for (const block of document.querySelectorAll('pre, .install')) {
  const button = document.createElement('button')
  button.className = 'copy'
  button.type = 'button'
  button.textContent = 'Copy'
  button.setAttribute('aria-label', 'Copy code')
  const content = block.querySelector('code')?.textContent || block.textContent
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content.trim())
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select to copy'
    }
    setTimeout(() => { button.textContent = 'Copy' }, 1800)
  })
  block.append(button)
}
const search = document.querySelector('#search')
const results = document.querySelector('.search-results')
const links = [...document.querySelectorAll('.sidebar nav a')]
search?.addEventListener('input', () => {
  results.replaceChildren()
  const query = search.value.trim().toLowerCase()
  if (!query) return
  const matches = links.filter(link => `${link.textContent} ${link.dataset.keywords}`.toLowerCase().includes(query))
  for (const link of matches) {
    const item = link.cloneNode(true)
    item.removeAttribute('aria-current')
    results.append(item)
  }
  if (!matches.length) {
    const empty = document.createElement('p')
    empty.className = 'search-empty'
    empty.textContent = 'No matching pages. Try types, install, model, or replay.'
    results.append(empty)
  }
})
for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => {
    for (const sibling of document.querySelectorAll('[role=tab]')) sibling.setAttribute('aria-selected', String(sibling === tab))
    for (const panel of document.querySelectorAll('[role=tabpanel]')) panel.hidden = panel.id !== tab.getAttribute('aria-controls')
  })
}
