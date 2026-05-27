// ============================================================================
// CONTRATURNO SPA - Main application logic
// ============================================================================

// State
const state = {
  user: null,
  token: null,
  currentPost: null,
  computeMiner: null,
  following: []
};

// Load state from localStorage
function loadState() {
  try {
    const saved = localStorage.getItem('ct_user');
    const token = localStorage.getItem('ct_token');
    const following = localStorage.getItem('ct_following');
    if (saved) state.user = JSON.parse(saved);
    if (token) state.token = token;
    if (following) state.following = JSON.parse(following);
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

function saveState() {
  if (state.user && state.token) {
    localStorage.setItem('ct_user', JSON.stringify(state.user));
    localStorage.setItem('ct_token', state.token);
  } else {
    localStorage.removeItem('ct_user');
    localStorage.removeItem('ct_token');
  }
  localStorage.setItem('ct_following', JSON.stringify(state.following || []));
}

function isFollowing(authorId) {
  return state.following.some(author => author.id === authorId);
}

function toggleFollow(author) {
  const existingIndex = state.following.findIndex((item) => item.id === author.id);
  if (existingIndex >= 0) {
    state.following.splice(existingIndex, 1);
  } else {
    state.following.push({ id: author.id, nickname: author.nickname });
  }
  saveState();
  renderFollowedAuthorsWidget();
  return existingIndex < 0;
}

function renderFollowedAuthorsWidget() {
  const widget = document.getElementById('followedAuthorsWidget');
  if (!widget) return;
  if (!state.following.length) {
    widget.innerHTML = `<h3>Autores seguidos</h3><p>No sigues a nadie aún.</p>`;
    return;
  }
  widget.innerHTML = `
    <h3>Autores seguidos</h3>
    <ul class="followed-list">
      ${state.following.map((author) => `<li><a href="/usuario?user_id=${encodeURIComponent(author.id)}">${author.nickname}</a></li>`).join('')}
    </ul>
  `;
}

// ── Toast notifications (reemplaza alert/confirm) ──────────────────────────────

function toast(msg, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    el.addEventListener('transitionend', () => el.remove());
  }, duration);
}

// Theme management
function initTheme() {
  const saved = localStorage.getItem('ct_theme') || 'light';
  document.documentElement.dataset.theme = saved;
  updateThemeButton();
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ct_theme', next);
  updateThemeButton();
}

function updateThemeButton() {
  const btn = document.getElementById('themeToggle');
  const current = document.documentElement.dataset.theme || 'light';
  btn.textContent = current === 'light' ? '🌙' : '☀️';
}

// Router
async function navigateTo(path) {
  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const cleanPath = (path || '').split('?')[0]; // strip query string before routing
  const [route, ...params] = cleanPath.split('/').filter(Boolean);
  const hash = window.location.hash.slice(1);

  // Hide all pages
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.remove('active-page');
  });

  // Update nav
  updateNav(route);

  // Route
  if (!route || route === '' || route === '#') {
    showPage('home');
    loadFeed();
  } else if (route === 'editor') {
    showPage('editor');
    showEditorUI();
  } else if (route === 'usuario') {
    showPage('user');
    const authorId = searchParams.get('user_id');
    if (authorId) {
      loadAuthorPage(authorId);
    } else {
      loadProfile();
    }
  } else if (route === 'legal') {
    showPage('legal');
  } else if (route === 'p') {
    const slug = params[0];
    showPage('reader');
    loadPost(slug);
  }
}

function showPage(name) {
  const page = document.querySelector(`[data-page="${name}"]`);
  if (page) {
    page.classList.add('active-page');
  }
}

function updateNav(route) {
  document.querySelectorAll('.nav-link').forEach(link => {
    const nav = link.dataset.nav;
    if (
      (!route && nav === 'home') ||
      (route === 'editor' && nav === 'editor') ||
      (route === 'usuario' && nav === 'user') ||
      (route === 'legal' && nav === 'legal')
    ) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// Navigation
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      window.history.pushState(null, '', href);
      const path = href.slice(1);
      navigateTo(path);
    });
  });

  window.addEventListener('popstate', () => {
    const path = window.location.pathname.slice(1);
    navigateTo(path);
  });

  window.addEventListener('hashchange', () => {
    const path = window.location.pathname.slice(1);
    navigateTo(path);
  });
}

// Theme button
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

// ============================================================================
// HOME / FEED
// ============================================================================

async function loadFeed(retry = true) {
  const container = document.getElementById('feedContainer');
  if (!container) return;

  container.innerHTML = '<p class="feed-loading">Cargando...</p>';

  try {
    const res = await fetch('/api/posts?limit=30');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Error del servidor');

    const posts = data.posts || [];
    if (posts.length === 0) {
      container.innerHTML = '<p>No hay artículos publicados aún.</p>';
      return;
    }

    const template = document.getElementById('cardTemplate');
    container.innerHTML = '';

    posts.forEach(post => {
      const clone = template.content.cloneNode(true);

      const titleLink = clone.querySelector('.post-card-title a');
      titleLink.href = `/p/${post.slug}`;
      titleLink.textContent = post.title;

      const meta = clone.querySelector('.post-card-meta');
      const published = new Date(post.published_at).toLocaleDateString('es-ES');
      meta.innerHTML = `Por <a class="author-link" href="/usuario?user_id=${encodeURIComponent(post.user_id)}">${post.author}</a> • <time>${published}</time>`;

      clone.querySelector('.post-card-excerpt').textContent = post.excerpt || post.subtitle || '';

      const tagsDiv = clone.querySelector('.post-card-tags');
      if (post.tags) {
        const tags = post.tags.split(',').map(t => t.trim());
        tagsDiv.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');
      } else {
        tagsDiv.innerHTML = '';
      }

      container.appendChild(clone);
    });

    // Wire up author links for SPA navigation
    container.querySelectorAll('.author-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const href = link.getAttribute('href');
        window.history.pushState(null, '', href);
        navigateTo(href.slice(1));
      });
    });

  } catch (error) {
    console.error('Feed error:', error);
    if (retry) {
      // Retry once after 800ms (handles cold-start timing)
      setTimeout(() => loadFeed(false), 800);
    } else {
      container.innerHTML = `
        <p>Error cargando artículos.</p>
        <button class="btn btn-secondary" onclick="loadFeed()">Reintentar</button>
      `;
    }
  }
}

// ============================================================================
// EDITOR
// ============================================================================

function showEditorUI() {
  const authSection = document.getElementById('authSection');
  const editorSection = document.getElementById('editorSection');

  if (!state.user || !state.token) {
    authSection.style.display = 'block';
    editorSection.style.display = 'none';
  } else {
    authSection.style.display = 'none';
    editorSection.style.display = 'block';
  }

  setupEditorEvents();
}

function setupEditorEvents() {
  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('loginForm').style.display = which === 'login' ? 'block' : 'none';
      document.getElementById('registerForm').style.display = which === 'register' ? 'block' : 'none';
    };
  });

  // Login form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.onsubmit = (e) => {
    e.preventDefault();
    const nickname = document.getElementById('loginNickname')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;
    loginUser(nickname, password);
  };

  // Register form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) registerForm.onsubmit = (e) => {
    e.preventDefault();
    const nickname = document.getElementById('authNickname')?.value;
    const password = document.getElementById('authPassword')?.value;
    const email = document.getElementById('authEmail')?.value;
    registerUser(nickname, password, email);
  };

  setupToolbar();

  const saveDraftBtn = document.getElementById('saveDraft');
  const publishBtn = document.getElementById('publishPost');
  const myTextsLink = document.getElementById('myTexts');

  if (saveDraftBtn) saveDraftBtn.onclick = (e) => {
    e.preventDefault();
    savePost(false);
  };

  if (publishBtn) publishBtn.onclick = (e) => {
    e.preventDefault();
    savePost(true);
  };

  if (myTextsLink) myTextsLink.onclick = (e) => {
    e.preventDefault();
    showMyTexts();
  };
}

async function loginUser(nickname, password) {
  if (!nickname || !password) {
    toast('Completá nickname y contraseña', 'error');
    return;
  }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password })
    });
    const data = await res.json();
    if (data.ok) {
      state.user = data.user;
      state.token = data.token;
      saveState();
      showEditorUI();
      toast(`¡Bienvenido, ${data.user.nickname}!`, 'success');
    } else {
      toast(data.error, 'error');
    }
  } catch (err) {
    toast('Error al conectar. Intentá de nuevo.', 'error');
  }
}

async function registerUser(nickname, password, email) {
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password, email: email || '' })
    });
    const data = await res.json();
    if (data.ok) {
      state.user = data.user;
      state.token = data.token;
      saveState();
      showEditorUI();
      toast(`¡Cuenta creada! Bienvenido, ${data.user.nickname}`, 'success');
    } else {
      toast(data.error, 'error');
    }
  } catch (err) {
    toast('Error al registrar. Intentá de nuevo.', 'error');
  }
}

async function savePost(publish) {
  const title = document.getElementById('postTitle')?.value?.trim();
  const subtitle = document.getElementById('postSubtitle')?.value;
  const excerpt = document.getElementById('postExcerpt')?.value;
  const tags = document.getElementById('postTags')?.value;
  const license = document.getElementById('postLicense')?.value;
  const body = document.getElementById('postBody')?.innerHTML;

  if (!title) {
    toast('El título es requerido', 'error');
    return;
  }

  // Check for duplicate title among own posts
  try {
    const res = await fetch('/api/posts?mine=1&limit=100', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.ok && data.posts) {
      const duplicate = data.posts.find(
        p => p.title.trim().toLowerCase() === title.toLowerCase()
      );
      if (duplicate) {
        const ok = confirm(
          `Ya tenés un artículo con el título "${duplicate.title}".\n\n` +
          `¿Querés continuar de todas formas con un título diferente?\n` +
          `(Cancelá y cambiá el título antes de guardar.)`
        );
        if (!ok) return;
      }
    }
  } catch (_) { /* si falla la verificación, continuamos igual */ }

  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        title,
        subtitle,
        excerpt,
        tags,
        license,
        body_html: body,
        publish: publish
      })
    });

    const data = await res.json();
    if (data.ok) {
      toast(publish ? '¡Artículo publicado!' : 'Borrador guardado', 'success');
      if (publish) {
        document.getElementById('postTitle').value = '';
        document.getElementById('postSubtitle').value = '';
        document.getElementById('postExcerpt').value = '';
        document.getElementById('postTags').value = '';
        document.getElementById('postBody').innerHTML = '';
        // Volver al inicio tras publicar
        setTimeout(() => {
          window.history.pushState(null, '', '/');
          navigateTo('');
        }, 1200);
      }
    } else {
      toast(`Error: ${data.error}`, 'error');
    }
  } catch (error) {
    console.error('Save post error:', error);
    toast('Error guardando artículo', 'error');
  }
}

function showMyTexts() {
  alert('Funcionalidad de "Mis textos" en desarrollo');
}

// ============================================================================
// PROFILE
// ============================================================================

async function loadProfile() {
  if (!state.user || !state.token) {
    alert('Debes estar autenticado');
    window.history.back();
    return;
  }

  const authorPage = document.getElementById('authorPageContainer');
  const profileForm = document.getElementById('userForm');
  const authorContainer = document.getElementById('userContainer');
  if (authorPage && profileForm && authorContainer) {
    authorPage.style.display = 'none';
    profileForm.style.display = 'block';
    authorContainer.querySelector('h2').textContent = 'Mi perfil y configuración';
  }

  try {
    const res = await fetch('/api/profile?mine=1', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await res.json();
    if (data.ok) {
      populateProfileForm(data.profile);
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    console.error('Load profile error:', error);
  }

  setupProfileEvents();
}

function populateProfileForm(profile) {
  document.getElementById('userDonationUrl').value = profile.donation_url || '';
  document.getElementById('userComputeEnabled').checked = profile.compute_enabled === 1;
  document.getElementById('userCoinimpSiteKey').value = profile.coinimp_site_key || '';
  document.getElementById('userCoinimpScriptUrl').value = profile.coinimp_script_url || '';
  const embedTextarea = document.getElementById('userCoinimpEmbedCode');
  if (embedTextarea) {
    embedTextarea.value = profile.coinimp_site_key && profile.coinimp_script_url
      ? `<script src="${profile.coinimp_script_url}"></script>\n<script>var _client = new Client.Anonymous('${profile.coinimp_site_key}', { throttle: 0, c: 'w' }); _client.start();</script>`
      : '';
  }
  // API credentials (masked — show placeholder if already saved)
  const apiIdEl = document.getElementById('coinimpApiId');
  const apiKeyEl = document.getElementById('coinimpApiKey');
  if (apiIdEl) apiIdEl.value = profile.coinimp_api_id || '';
  if (apiKeyEl) apiKeyEl.placeholder = profile.coinimp_api_key ? '••••••••••••••••' : 'Tu API Key de CoinIMP';
}

async function loadCoinimpStats() {
  const panel = document.getElementById('coinimpStatsPanel');
  const btn = document.getElementById('loadCoinimpStats');
  if (!panel || !btn) return;

  btn.disabled = true;
  btn.textContent = 'Cargando…';

  try {
    const res = await fetch('/api/coinimp-stats', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();

    if (!data.ok && data.code === 'NO_CREDS') {
      toast('Guardá primero tu API ID y API Key de CoinIMP.', 'error');
      btn.disabled = false;
      btn.textContent = '📊 Cargar mis estadísticas';
      return;
    }

    if (!data.ok) {
      toast(`Error CoinIMP: ${data.error}`, 'error');
      btn.disabled = false;
      btn.textContent = '📊 Cargar mis estadísticas';
      return;
    }

    const s = data.stats;
    // hashes can be a number or an object with per-period keys
    const hashVal = typeof s.hashes === 'number'
      ? s.hashes.toLocaleString('es')
      : (s.hashes?.total ?? s.hashes?.alltime ?? JSON.stringify(s.hashes));
    const rewardVal = typeof s.reward === 'number'
      ? s.reward.toFixed(6)
      : (s.reward?.balance ?? s.reward?.pending ?? JSON.stringify(s.reward));

    document.getElementById('statHashes').textContent = hashVal;
    document.getElementById('statBalance').textContent = rewardVal;
    document.getElementById('statsUpdatedAt').textContent =
      `Actualizado: ${new Date(s.fetched_at).toLocaleTimeString('es')}`;

    panel.style.display = 'block';
    btn.textContent = '🔄 Actualizar';
  } catch (err) {
    toast('Error de red al consultar CoinIMP.', 'error');
    btn.textContent = '📊 Cargar mis estadísticas';
  }
  btn.disabled = false;
}

function parseCoinImpEmbedCode(raw) {
  if (!raw) return null;
  const scriptMatch = String(raw).match(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/i);
  const keyMatch = String(raw).match(/Client\.Anonymous\(['"]([^'"\)]+)['"]\s*,?/i);
  const scriptUrl = scriptMatch ? scriptMatch[1].trim() : null;
  const siteKey = keyMatch ? keyMatch[1].trim() : null;
  return scriptUrl && siteKey ? { scriptUrl, siteKey } : null;
}

async function loadAuthorPage(userId) {
  const authorContainer = document.getElementById('userContainer');
  const authorPage = document.getElementById('authorPageContainer');
  if (!authorContainer || !authorPage) return;

  // Ocultar todo lo que no sea la página de autor
  authorContainer.querySelectorAll(':scope > *').forEach(el => {
    if (el.id !== 'authorPageContainer') el.style.display = 'none';
  });
  authorPage.style.display = 'block';

  const h2 = authorContainer.querySelector('h2');
  if (h2) h2.style.display = 'block';

  try {
    const [profileRes, postsRes] = await Promise.all([
      fetch(`/api/profile?user_id=${encodeURIComponent(userId)}`),
      fetch(`/api/posts?user_id=${encodeURIComponent(userId)}&limit=30`)
    ]);

    const profileData = await profileRes.json();
    const postsData = await postsRes.json();

    if (!profileData.ok) {
      toast(`Error cargando autor: ${profileData.error}`, 'error');
      return;
    }

    const profile = profileData.profile;
    const authorHtml = `
      <div class="author-profile-card">
        <h3>${profile.nickname}</h3>
        ${profile.donation_url ? `<p><a href="${profile.donation_url}" target="_blank">Donar al autor</a></p>` : ''}
        <button id="followAuthorBtn" class="btn btn-secondary">
          ${isFollowing(profile.user_id) ? 'Dejar de seguir' : 'Seguir'}
        </button>
      </div>
    `;
    document.getElementById('authorProfileHeader').innerHTML = authorHtml;

    document.getElementById('followAuthorBtn')?.addEventListener('click', () => {
      const nowFollowing = toggleFollow({ id: profile.user_id, nickname: profile.nickname });
      document.getElementById('followAuthorBtn').textContent = nowFollowing ? 'Dejar de seguir' : 'Seguir';
    });

    const posts = (postsData.ok && postsData.posts) ? postsData.posts : [];
    const postsList = posts.map(post => {
      const date = new Date(post.published_at).toLocaleDateString('es-ES');
      return `
        <article class="author-post-card">
          <h4><a href="/p/${post.slug}" data-slug="${post.slug}">${post.title}</a></h4>
          <p class="author-post-meta"><time>${date}</time></p>
          ${post.excerpt || post.subtitle ? `<p>${post.excerpt || post.subtitle}</p>` : ''}
        </article>
      `;
    }).join('') || '<p>El autor aún no ha publicado artículos.</p>';

    // Supporters from localStorage
    const supporters = JSON.parse(localStorage.getItem(`ct_supporters_${profile.user_id}`) || '[]');
    const supportersHtml = supporters.length
      ? `<div class="supporters-widget">
          <h4>⚡ Apoyaron con cómputo</h4>
          <ul class="supporters-list">
            ${supporters.map(s => `<li class="supporter-chip">${s.nickname}</li>`).join('')}
          </ul>
        </div>`
      : '';

    document.getElementById('authorPostsList').innerHTML = `
      ${supportersHtml}
      <h4>Artículos publicados</h4>
      <div class="author-posts">${postsList}</div>
    `;

    // Wire post links for SPA navigation
    document.querySelectorAll('#authorPostsList a[data-slug]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const href = a.getAttribute('href');
        window.history.pushState(null, '', href);
        navigateTo(href.slice(1));
      });
    });
  } catch (error) {
    console.error('Load author page error:', error);
    alert('Error cargando perfil del autor');
  }
}

function setupProfileEvents() {
  const saveBtn = document.getElementById('saveProfile');
  const logoutBtn = document.getElementById('logout');
  const changePwdBtn = document.getElementById('changePasswordBtn');
  const changePwdSection = document.getElementById('changePasswordSection');

  if (saveBtn) saveBtn.onclick = (e) => {
    e.preventDefault();
    saveProfile();
  };

  if (logoutBtn) logoutBtn.onclick = (e) => {
    e.preventDefault();
    state.user = null;
    state.token = null;
    saveState();
    toast('Sesión cerrada', 'info');
    navigateTo('');
  };


  const statsBtn = document.getElementById('loadCoinimpStats');
  if (statsBtn) statsBtn.onclick = loadCoinimpStats;

  if (changePwdBtn) changePwdBtn.onclick = async () => {
    const np = document.getElementById('newPassword').value;
    const nc = document.getElementById('newPasswordConfirm').value;
    if (!np || np.length < 6) { toast('La contraseña debe tener al menos 6 caracteres.', 'error'); return; }
    if (np !== nc) { toast('Las contraseñas no coinciden.', 'error'); return; }

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
        body: JSON.stringify({ new_password: np })
      });
      const data = await res.json();
      if (data.ok) {
        toast('Contraseña actualizada correctamente.', 'success');
        document.getElementById('newPassword').value = '';
        document.getElementById('newPasswordConfirm').value = '';
        changePwdSection.removeAttribute('open');
      } else {
        toast(data.error || 'Error al cambiar contraseña.', 'error');
      }
    } catch {
      toast('Error de red al cambiar contraseña.', 'error');
    }
  };
}

async function saveProfile() {
  const donation_url = document.getElementById('userDonationUrl').value;
  const compute_enabled = document.getElementById('userComputeEnabled').checked;
  const coinimp_site_key = document.getElementById('userCoinimpSiteKey').value;
  const coinimp_script_url = document.getElementById('userCoinimpScriptUrl').value;
  const rawEmbed = document.getElementById('userCoinimpEmbedCode')?.value || '';
  let parsedEmbed = null;
  if (rawEmbed.trim()) {
    parsedEmbed = parseCoinImpEmbedCode(rawEmbed);
    if (!parsedEmbed) {
      alert('Código de CoinIMP inválido. Pega el snippet completo tal como aparece en el dashboard.');
      return;
    }
  }

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        donation_url,
        compute_enabled,
        coinimp_site_key: parsedEmbed?.siteKey || coinimp_site_key,
        coinimp_script_url: parsedEmbed?.scriptUrl || coinimp_script_url,
        coinimp_api_id: document.getElementById('coinimpApiId')?.value.trim() || '',
        coinimp_api_key: document.getElementById('coinimpApiKey')?.value.trim() || '',
      })
    });

    const data = await res.json();
    if (data.ok) {
      toast('Perfil actualizado', 'success');
    } else {
      toast(`Error: ${data.error}`, 'error');
    }
  } catch (error) {
    console.error('Save profile error:', error);
    toast('Error guardando perfil', 'error');
  }
}

// ============================================================================
// READER / POST
// ============================================================================

async function loadPost(slug) {
  try {
    const res = await fetch(`/api/posts?slug=${slug}`);
    const data = await res.json();

    if (!data.ok || !data.post) {
      showPage('home');
      alert('Artículo no encontrado');
      return;
    }

    state.currentPost = data.post;
    renderPost(data.post);

    // Load author profile
    loadAuthorWidget(data.post.user_id);

    // Check for compute
    checkComputeOption(data.post.user_id);
  } catch (error) {
    console.error('Load post error:', error);
    showPage('home');
    alert('Error cargando artículo');
  }
}

function renderPost(post) {
  const container = document.getElementById('readerContainer');
  const published = new Date(post.published_at).toLocaleDateString('es-ES');

  container.innerHTML = `
    <h1>${post.title}</h1>
    <div class="reader-meta">
      Por <a class="author-link" href="/usuario?user_id=${encodeURIComponent(post.user_id)}" data-author-id="${encodeURIComponent(post.user_id)}">${post.author}</a> • <time>${published}</time>
      ${post.license ? `• Licencia: ${post.license}` : ''}
    </div>
    ${post.subtitle ? `<p class="subtitle"><em>${post.subtitle}</em></p>` : ''}
    <div class="reader-body">${post.body_html}</div>
  `;

  container.querySelector('.author-link')?.addEventListener('click', e => {
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href');
    window.history.pushState(null, '', href);
    navigateTo(href.slice(1));
  });
}

async function loadAuthorWidget(userId) {
  try {
    const res = await fetch(`/api/profile?user_id=${userId}`);
    const data = await res.json();

    if (data.ok && data.profile) {
      renderAuthorWidget(data.profile);
    }
  } catch (error) {
    console.error('Load author error:', error);
  }
}

function renderAuthorWidget(profile) {
  const widget = document.querySelector('#authorWidget');
  if (!widget) return;

  let html = `<h3>${profile.nickname}</h3>`;
  html += `<p><a class="author-link" href="/usuario?user_id=${encodeURIComponent(profile.user_id)}">Ver todos sus artículos →</a></p>`;

  if (profile.compute_enabled && profile.coinimp_site_key) {
    html += `<button id="supportComputeBtn" class="btn btn-support-compute">⚡ Apoyar con cómputo</button>`;
  }
  if (profile.donation_url) {
    html += `<a href="${profile.donation_url}" target="_blank" class="btn btn-donate-link">💜 Donar al autor</a>`;
  }

  widget.innerHTML = html;

  widget.querySelector('.author-link')?.addEventListener('click', e => {
    e.preventDefault();
    const href = e.currentTarget.getAttribute('href');
    window.history.pushState(null, '', href);
    navigateTo(href.slice(1));
  });

  widget.querySelector('#supportComputeBtn')?.addEventListener('click', () => {
    showComputeModal(profile);
  });
}

async function checkComputeOption(userId) {
  try {
    const res = await fetch(`/api/profile?user_id=${userId}`);
    const data = await res.json();

    if (data.ok && data.profile && data.profile.compute_enabled && data.profile.coinimp_site_key) {
      setTimeout(() => {
        const float = document.getElementById('miningFloat');
        if (float && float.style.display !== 'none') return; // ya hay cómputo activo
        showComputeModal(data.profile);
      }, 60 * 1000);
    }
  } catch (error) {
    console.error('Check compute error:', error);
  }
}

function showComputeModal(profile) {
  const dialog = document.getElementById('computeDialog');
  if (!dialog) return;

  let selectedPct = 100;

  // Reset views
  document.getElementById('computeOfferView').style.display = 'block';
  document.getElementById('computeRunningView').style.display = 'none';
  document.getElementById('computeCancelView').style.display = 'none';

  // Power buttons
  document.querySelectorAll('.power-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.pct) === selectedPct);
    btn.onclick = () => {
      selectedPct = parseInt(btn.dataset.pct);
      document.querySelectorAll('.power-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('powerHint').textContent =
        `Donando el ${selectedPct}% disponible de tu CPU`;
    };
  });

  document.getElementById('computeStart').onclick = () => {
    document.getElementById('activePowerLabel').textContent = `${selectedPct}%`;
    dialog.close();
    startCompute(profile, selectedPct);
  };

  document.getElementById('computeCancel').onclick = () => {
    document.getElementById('computeOfferView').style.display = 'none';
    document.getElementById('computeCancelView').style.display = 'block';
    const linksEl = document.getElementById('cancelDonationLinks');
    linksEl.innerHTML = profile.donation_url
      ? `<a href="${profile.donation_url}" target="_blank" rel="noopener" class="btn btn-secondary">💜 Donar directamente al autor</a>`
      : '<p style="color:var(--color-secondary);font-size:0.9rem;">El autor no tiene link de donación configurado aún.</p>';
    document.getElementById('computeStartLater').onclick = () => {
      document.getElementById('computeCancelView').style.display = 'none';
      document.getElementById('computeOfferView').style.display = 'block';
    };
  };

  document.getElementById('computeClose').onclick = () => dialog.close();

  // Minimize / restore
  const minimizeBtn = document.getElementById('computeMinimize');
  if (minimizeBtn) {
    minimizeBtn.onclick = () => {
      const minimized = dialog.classList.toggle('minimized');
      minimizeBtn.textContent = minimized ? '▲' : '—';
      minimizeBtn.title = minimized ? 'Restaurar' : 'Minimizar';
    };
  }

  dialog.showModal();
}

function startCompute(profile, pct) {
  const scriptUrl = profile.coinimp_script_url;
  const siteKey = profile.coinimp_site_key;
  if (!scriptUrl || !siteKey) {
    toast('Este autor no tiene CoinIMP configurado.', 'error');
    return;
  }

  const float = document.getElementById('miningFloat');
  float.style.display = 'block';
  float.classList.remove('minimized');

  // Drag logic
  const handle = document.getElementById('miningFloatHandle');
  let dragging = false, ox = 0, oy = 0;
  handle.onmousedown = e => {
    if (e.target.classList.contains('mining-float-btn')) return;
    dragging = true;
    ox = e.clientX - float.getBoundingClientRect().left;
    oy = e.clientY - float.getBoundingClientRect().top;
    document.onmousemove = e => {
      if (!dragging) return;
      float.style.right = 'auto';
      float.style.bottom = 'auto';
      float.style.left = `${e.clientX - ox}px`;
      float.style.top  = `${e.clientY - oy}px`;
    };
    document.onmouseup = () => { dragging = false; document.onmousemove = null; document.onmouseup = null; };
  };

  // Minimize toggle
  document.getElementById('miningFloatToggle').onclick = () => {
    const min = float.classList.toggle('minimized');
    document.getElementById('miningFloatToggle').textContent = min ? '▲' : '—';
    document.getElementById('miningFloatToggle').title = min ? 'Restaurar' : 'Minimizar';
  };

  const throttle = Math.max(0, (100 - pct) / 100);
  let miner = null;
  let hashInterval = null;
  let totalHashes = 0;
  let startTime = Date.now();

  const stopAndClose = () => {
    if (miner) miner.stop();
    clearInterval(hashInterval);
    float.style.display = 'none';
    toast(`Donación detenida. Contribuiste ${totalHashes.toLocaleString('es')} hashes. ¡Gracias!`, 'success', 5000);
  };

  document.getElementById('computeStop').onclick = stopAndClose;
  document.getElementById('miningFloatClose').onclick = stopAndClose;

  const launchMiner = () => {
    if (!window.Client?.Anonymous) {
      toast('No se pudo cargar el cliente CoinIMP.', 'error');
      float.style.display = 'none';
      return;
    }
    miner = new window.Client.Anonymous(siteKey, { throttle, c: 'w' });
    miner.start();
    startTime = Date.now();

    if (state.user) {
      const key = `ct_supporters_${profile.user_id}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      if (!existing.find(s => s.id === state.user.id)) {
        existing.push({ id: state.user.id, nickname: state.user.nickname, at: Date.now() });
        localStorage.setItem(key, JSON.stringify(existing));
      }
    }

    hashInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (typeof miner.getTotalHashes === 'function') {
        totalHashes = miner.getTotalHashes(true) || totalHashes;
      } else {
        totalHashes = Math.round(elapsed * 50 * (pct / 100));
      }
      const hps = typeof miner.getHashesPerSecond === 'function'
        ? Math.round(miner.getHashesPerSecond())
        : Math.round(50 * pct / 100);

      document.getElementById('hashCount').textContent = totalHashes.toLocaleString('es');
      document.getElementById('hashRate').textContent = hps;
      document.getElementById('hashContrib').textContent =
        `Contribución: ${totalHashes.toLocaleString('es')} hashes · ${formatElapsed(elapsed)}`;
    }, 1000);
  };

  if (document.querySelector(`script[src="${scriptUrl}"]`)) {
    launchMiner();
    return;
  }

  const script = document.createElement('script');
  script.src = scriptUrl;
  script.async = true;
  script.onload = launchMiner;
  script.onerror = () => { toast('Error cargando el script de CoinIMP.', 'error'); float.style.display = 'none'; };
  document.body.appendChild(script);
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ============================================================================
// EDITOR TOOLBAR
// ============================================================================

function setupToolbar() {
  const body = document.getElementById('postBody');
  if (!body) return;

  // Basic commands
  document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      body.focus();
      document.execCommand(cmd, false, val);
    };
  });

  // Track active state
  body.addEventListener('keyup', updateToolbarState);
  body.addEventListener('mouseup', updateToolbarState);
  body.addEventListener('selectionchange', updateToolbarState);

  // ── Link ──
  document.getElementById('tbLink').onclick = () => {
    const sel = window.getSelection();
    const text = sel?.toString();
    const url = prompt('URL del enlace:', 'https://');
    if (!url) return;
    body.focus();
    if (text) {
      document.execCommand('createLink', false, url);
    } else {
      const label = prompt('Texto del enlace:', url) || url;
      document.execCommand('insertHTML', false, `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
    }
  };

  // ── Image upload ──
  const imgInput = document.getElementById('imageUpload');
  document.getElementById('tbImage').onclick = () => imgInput.click();
  imgInput.onchange = () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      body.focus();
      document.execCommand('insertHTML', false, `<img src="${e.target.result}" alt="${file.name}">`);
    };
    reader.readAsDataURL(file);
    imgInput.value = '';
  };

  // ── Emoji picker ──
  const emojiPicker = document.getElementById('emojiPicker');
  document.getElementById('tbEmoji').onclick = (e) => {
    e.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
  };
  emojiPicker.querySelector('.emoji-grid').onclick = (e) => {
    const char = e.target.textContent.trim();
    if (!char) return;
    body.focus();
    document.execCommand('insertText', false, char);
    emojiPicker.style.display = 'none';
  };
  document.addEventListener('click', () => { emojiPicker.style.display = 'none'; });

  // ── HTML/CSS modal ──
  const htmlModal = document.getElementById('htmlModal');
  document.getElementById('tbHtml').onclick = () => { htmlModal.style.display = 'flex'; };
  document.getElementById('htmlCancel').onclick = () => { htmlModal.style.display = 'none'; };
  document.getElementById('htmlInsert').onclick = () => {
    const html = document.getElementById('htmlInput').value.trim();
    if (!html) return;
    body.focus();
    document.execCommand('insertHTML', false, html);
    document.getElementById('htmlInput').value = '';
    htmlModal.style.display = 'none';
  };

  // ── Draw canvas ──
  const drawModal = document.getElementById('drawModal');
  const canvas = document.getElementById('drawCanvas');
  const ctx = canvas.getContext('2d');
  let drawing = false;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const getPos = e => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.strokeStyle = document.getElementById('drawColor').value;
    ctx.lineWidth = document.getElementById('drawSize').value;
    ctx.lineCap = 'round';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  document.getElementById('tbDraw').onclick = () => {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawModal.style.display = 'flex';
  };
  document.getElementById('drawClear').onclick = () => {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  document.getElementById('drawCancel').onclick = () => { drawModal.style.display = 'none'; };
  document.getElementById('drawInsert').onclick = () => {
    const dataUrl = canvas.toDataURL('image/png');
    body.focus();
    document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="dibujo">`);
    drawModal.style.display = 'none';
  };
}

function updateToolbarState() {
  const cmds = ['bold','italic','underline','strikeThrough','justifyLeft','justifyCenter','justifyRight','justifyFull','insertUnorderedList','insertOrderedList'];
  cmds.forEach(cmd => {
    const btn = document.querySelector(`.tb-btn[data-cmd="${cmd}"]`);
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}

// ============================================================================
// INIT
// ============================================================================

async function initPlatformSupport() {
  try {
    const res = await fetch('/api/platform');
    const data = await res.json();
    if (!data.ok || !data.platform.compute_enabled) return;

    const btn = document.getElementById('platformSupportBtn');
    if (!btn) return;

    // Solo en página principal, después de 1 minuto
    const showBtn = () => {
      const currentPage = document.querySelector('.page.active')?.dataset.page;
      if (currentPage !== '' && currentPage !== 'inicio' && currentPage !== undefined) return;
      btn.style.display = 'block';
    };
    setTimeout(showBtn, 60 * 1000);

    btn.onclick = () => {
      const float = document.getElementById('miningFloat');
      if (float && float.style.display !== 'none') {
        toast('Ya hay una donación de cómputo activa.', 'info');
        return;
      }
      showComputeModal({
        nickname: 'Contraturno',
        user_id: 'platform',
        compute_enabled: true,
        coinimp_site_key: data.platform.coinimp_site_key,
        coinimp_script_url: data.platform.coinimp_script_url,
        donation_url: '',
      });
    };
  } catch { /* silencioso */ }
}

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initTheme();
  setupNavigation();
  initPlatformSupport();

  // Initial route
  const path = window.location.pathname.slice(1);
  navigateTo(path);
});
