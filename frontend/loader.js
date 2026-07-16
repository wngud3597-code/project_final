(() => {
  const help = document.getElementById('boot-help');

  function showError(message) {
    const boot = document.getElementById('boot-screen');
    if (!boot) return;
    boot.classList.add('boot-error');
    boot.innerHTML = `
      <div class="boot-logo">!</div>
      <h1>화면을 불러오지 못했습니다</h1>
      <p>${String(message || '알 수 없는 오류')}</p>
      <p class="boot-help">
        인터넷 연결을 확인하고 주소창에
        <strong>http://127.0.0.1:8000</strong>을 입력한 뒤 Ctrl + F5를 눌러 주세요.
      </p>
    `;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`${url} 로드 실패`));
      document.head.appendChild(script);
    });
  }

  function loadStyle(url) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`${url} 스타일 로드 실패`));
      document.head.appendChild(link);
    });
  }

  async function loadFirst(urls, check, type = 'script') {
    let lastError = null;
    for (const url of urls) {
      try {
        if (type === 'style') {
          await loadStyle(url);
        } else {
          await loadScript(url);
        }
        if (!check || check()) return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('외부 라이브러리를 불러오지 못했습니다.');
  }

  async function boot() {
    try {
      if (help) help.textContent = 'Vue 3를 불러오는 중입니다.';
      await loadFirst(
        [
          'https://cdn.jsdelivr.net/npm/vue@3.5.17/dist/vue.global.prod.js',
          'https://unpkg.com/vue@3.5.17/dist/vue.global.prod.js'
        ],
        () => Boolean(window.Vue)
      );

      if (help) help.textContent = '지도 라이브러리를 불러오는 중입니다.';
      await Promise.all([
        loadFirst(
          [
            'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
          ],
          null,
          'style'
        ),
        loadFirst(
          [
            'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
          ],
          () => Boolean(window.L)
        )
      ]);

      if (help) help.textContent = 'LocalHub 화면을 시작하는 중입니다.';
      await loadScript('/app.js?v=20260716-warm-journey-2');

      if (typeof window.startLocalHub !== 'function') {
        throw new Error('Vue 3 앱 시작 함수를 찾을 수 없습니다.');
      }
      window.startLocalHub();
    } catch (error) {
      console.error(error);
      showError(error.message);
    }
  }

  window.addEventListener('error', event => {
    if (document.getElementById('boot-screen')) {
      showError(event.message);
    }
  });

  boot();
})();
