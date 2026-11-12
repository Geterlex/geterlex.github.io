(() => {
  'use strict';
  const page = document.documentElement;
  page.classList.add('js');

  const pagePath = document.body.dataset.page;
  if (pagePath?.endsWith('/') && location.pathname === `${pagePath}index.html`) {
    history.replaceState(history.state, '', `${pagePath}${location.search}${location.hash}`);
  }

  // These events stay in the browser. A separate analytics integration can subscribe to them.
  const goal = (name) => document.dispatchEvent(new CustomEvent('gitstart:goal', { detail: { name } }));
  document.addEventListener('click', (event) => {
    if (event.target.closest('.article-aside [data-next-lesson]')) goal('next_lesson');
  });

  const themeButton = document.querySelector('[data-theme-toggle]');
  const prefersLight = matchMedia('(prefers-color-scheme: light)');
  let theme = null;
  try { theme = localStorage.getItem('gitstart-theme'); } catch { /* Storage can be disabled. */ }
  if (theme !== 'light' && theme !== 'dark') theme = null;
  const displayTheme = () => {
    const selected = theme || (prefersLight.matches ? 'light' : 'dark');
    page.dataset.theme = selected;
    themeButton?.setAttribute('aria-pressed', String(selected === 'dark'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'dark' ? '#11141c' : '#f6f7fb');
  };
  displayTheme();
  prefersLight.addEventListener?.('change', displayTheme);
  themeButton?.addEventListener('click', () => {
    theme = page.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('gitstart-theme', theme); } catch { /* Theme still works for this page. */ }
    displayTheme();
  });

  const nav = document.getElementById('main-nav');
  const menuButton = document.querySelector('.menu-toggle');
  const narrowScreen = matchMedia('(max-width: 1170px)');
  const setMenu = (open, restoreFocus = false) => {
    nav.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (restoreFocus) menuButton.focus();
  };
  menuButton.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a') && narrowScreen.matches) setMenu(false);
  });
  document.addEventListener('click', (event) => {
    if (nav.classList.contains('open') && !event.target.closest('.site-header')) setMenu(false);
  });
  narrowScreen.addEventListener?.('change', () => setMenu(false));

  const copyTimers = new WeakMap();
  async function copy(text, button) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* Try the local fallback. */ }
    }
    const field = document.createElement('textarea');
    field.className = 'clipboard-fallback';
    field.value = text;
    field.setAttribute('readonly', '');
    field.tabIndex = -1;
    document.body.append(field);
    field.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { field.remove(); button.focus({ preventScroll: true }); }
  }
  document.querySelectorAll('.copy-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const block = button.closest('.code-wrap');
      const code = block.querySelector('code');
      const status = block.querySelector('.copy-status');
      clearTimeout(copyTimers.get(button));
      const copied = await copy(code.textContent, button);
      button.textContent = copied ? 'Скопировано' : 'Копировать';
      status.textContent = copied ? 'Команда скопирована.' : 'Не удалось скопировать. Выделите команду и скопируйте вручную.';
      if (copied) goal('copy_command');
      copyTimers.set(button, setTimeout(() => {
        button.textContent = 'Копировать';
        if (copied) status.textContent = '';
      }, 2500));
    });
  });

  const translit = new Map([['гит', 'git'], ['гитхаб', 'github'], ['виндовс', 'windows']]);
  const normalize = (text) => text.normalize('NFKC').toLowerCase().replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
    .split(' ').map((word) => translit.get(word) || word).join(' ');
  const stopwords = new Set(['как', 'ли', 'мне', 'на', 'в', 'по', 'к', 'и', 'от', 'с', 'для']);
  function key(word) {
    if (word.startsWith('ветк') || word === 'веток') return 'ветк';
    if (word.startsWith('созда')) return 'созда';
    if (word.startsWith('репозитор')) return 'репозитор';
    if (word.startsWith('коммит')) return 'коммит';
    if (word.startsWith('установ')) return 'установ';
    if (word.startsWith('команд')) return 'команд';
    if (word.startsWith('удаленн')) return 'удаленн';
    if (word.startsWith('конфликт')) return 'конфликт';
    if (word.startsWith('слиян') || word.startsWith('слить')) return 'слиян';
    return word;
  }
  const tokens = (text) => normalize(text).split(' ').filter((word) => word && !stopwords.has(word)).map(key);

  const dialog = document.getElementById('site-search');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchStatus = document.getElementById('search-status');
  const searchButton = document.querySelector('[data-search-open]');
  const searchRetry = document.querySelector('[data-search-retry]');
  let searchIndex;
  let loading;
  let searchOpener;
  let searchError = false;

  function score(entry, query, terms) {
    if (entry.aliases.includes(query)) return 120;
    if (entry.title === query) return 115;
    if (entry.command === query) return 110;
    if (entry.title.startsWith(query)) return 95;
    if (entry.aliases.some((alias) => alias.startsWith(query))) return 80;
    if (entry.title.includes(query)) return 75;
    if (!terms.length || !terms.every((term) => entry.words.has(term))) return 0;
    return 28 + terms.filter((term) => entry.primary.has(term)).length * 8;
  }

  function showResults() {
    const query = normalize(searchInput.value);
    searchResults.replaceChildren();
    searchRetry.hidden = !searchError;
    if (searchError) {
      searchStatus.textContent = 'Поиск временно недоступен. Откройте карту сайта ниже или повторите попытку.';
      return;
    }
    if (!searchIndex) {
      searchStatus.textContent = 'Загружаем список материалов…';
      return;
    }
    if (!query) {
      searchStatus.textContent = 'Например: создать ветку git, первый коммит, git pull.';
      return;
    }
    const terms = [...new Set(tokens(query))];
    const matches = searchIndex.map((entry) => ({ entry, score: score(entry, query, terms) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
    searchStatus.textContent = matches.length ? `Подходящие материалы: ${matches.length}.` : 'Ничего не найдено. Попробуйте название команды или более короткую фразу.';
    for (const { entry } of matches) {
      const link = document.createElement('a');
      const title = document.createElement('strong');
      const description = document.createElement('span');
      link.className = 'search-item';
      link.href = entry.url;
      title.textContent = entry.label;
      description.textContent = entry.desc;
      link.append(title, description);
      searchResults.append(link);
    }
  }

  function ensureSearchIndex() {
    if (searchIndex || loading) return;
    searchError = false;
    showResults();
    loading = fetch('/assets/search-index.json')
      .then((response) => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      })
      .then((records) => {
        if (!Array.isArray(records)) throw new Error('Invalid search index');
        searchIndex = records.filter((record) => typeof record.title === 'string' && typeof record.desc === 'string' && /^\/(?:[a-z0-9.-]+\/)*[a-z0-9.-]*$/.test(record.url))
          .map((record) => {
            const aliases = (record.aliases || []).map(normalize);
            const primary = new Set(tokens(`${record.title} ${aliases.join(' ')}`));
            return {
              url: record.url, label: record.title, desc: record.desc, title: normalize(record.title), aliases,
              command: normalize(record.command || ''), primary,
              words: new Set([...primary, ...tokens(`${record.desc} ${record.headings || ''}`)]),
            };
          });
      }).catch(() => { searchError = true; }).finally(() => { loading = null; showResults(); });
  }

  function openSearch() {
    if (dialog.open) return;
    if (typeof dialog.showModal !== 'function') { location.assign('/sitemap.html'); return; }
    searchOpener = document.activeElement;
    setMenu(false);
    dialog.showModal();
    searchInput.focus();
    searchInput.select();
    ensureSearchIndex();
    showResults();
  }
  searchButton.addEventListener('click', openSearch);
  document.querySelector('[data-search-close]').addEventListener('click', () => dialog.close());
  searchRetry.addEventListener('click', () => {
    if (searchError) ensureSearchIndex();
    searchInput.focus();
  });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    if (searchOpener instanceof HTMLElement && searchOpener !== document.body && searchOpener.getClientRects().length) {
      searchOpener.focus();
    } else searchButton.focus();
  });
  searchInput.addEventListener('input', showResults);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      const first = searchResults.querySelector('a');
      if (first) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    } else if (event.key === 'Escape' && !dialog.open && nav.classList.contains('open')) {
      setMenu(false, true);
    }
  });

  const filter = document.querySelector('[data-command-filter]');
  if (filter) {
    const rows = [...document.querySelectorAll('[data-command-row]')];
    const status = document.getElementById('filter-status');
    const clear = document.querySelector('[data-filter-clear]');
    const table = document.querySelector('.command-table');
    const words = rows.map((row) => new Set(tokens(row.textContent)));
    const update = () => {
      const query = tokens(filter.value);
      let visible = 0;
      rows.forEach((row, index) => {
        row.hidden = !query.every((term) => words[index].has(term));
        if (!row.hidden) visible++;
      });
      table.hidden = visible === 0;
      clear.disabled = !filter.value;
      status.textContent = visible ? `Показано ${visible} из ${rows.length}.` : 'Ничего не найдено. Измените запрос или сбросьте фильтр.';
    };
    filter.addEventListener('input', update);
    clear.addEventListener('click', () => { filter.value = ''; update(); filter.focus(); });
    update();
  }
})();

(() => {
  'use strict';
  const id = 114223000;
  if (location.hostname !== 'geterlex.github.io' || !Number.isSafeInteger(id) || id <= 0) return;
  const tagUrl = `https://mc.yandex.ru/metrika/tag.js?id=${id}`;
  if (Array.from(document.scripts).some((script) => script.src === tagUrl)) return;
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = window.ym.l || Date.now();
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = tagUrl;
  document.head.appendChild(tag);
  window.ym(id, 'init', {
    ssr: true, referrer: document.referrer, url: location.href,
    clickmap: false, trackLinks: false, accurateTrackBounce: true, webvisor: false
  });
  document.addEventListener('gitstart:goal', ({ detail }) => {
    const name = detail && detail.name;
    if (name === 'copy_command' || name === 'next_lesson') window.ym(id, 'reachGoal', name);
  });
})();
