window.startLocalHub = function startLocalHub() {
  const { createApp } = window.Vue;

  const FIELD_ORDER = [
    'contentid', 'contenttypeid', 'title', 'addr1', 'addr2', 'zipcode', 'tel',
    'mapx', 'mapy', 'mlevel', 'areacode', 'sigungucode',
    'lDongRegnCd', 'lDongSignguCd',
    'cat1', 'cat2', 'cat3',
    'lclsSystm1', 'lclsSystm2', 'lclsSystm3',
    'firstimage', 'firstimage2', 'cpyrhtDivCd',
    'createdtime', 'modifiedtime'
  ];

  const CATEGORY_CLASS = {
    '관광지': 'category-attraction',
    '문화시설': 'category-culture',
    '축제공연행사': 'category-event',
    '여행코스': 'category-course',
    '레포츠': 'category-leisure',
    '숙박': 'category-stay',
    '쇼핑': 'category-shopping'
  };

  createApp({
    data() {
      return {
        theme: 'light',
        ready: false,
        busy: false,
        error: '',
        stats: null,
        health: null,
        filters: {
          q: '',
          category: '전체',
          district: '전체',
          completeness: '전체',
          sort: 'title',
          pageSize: 24
        },
        appliedFilters: {},
        result: {
          items: [],
          total: 0,
          page: 1,
          totalPages: 1,
          pageSize: 24
        },
        activeView: 'list',
        mapPoints: [],
        mapMessage: '',
        selected: null,
        detailBusy: false,
        weather: null,
        weatherError: '',
        weatherBusy: false,
        fontSize: 'normal',
        bookmarks: [],
        savedItems: [],
        savedBusy: false,
        comments: [],
        commentsBusy: false,
        commentSaving: false,
        commentError: '',
        commentEditingId: null,
        showCommentPassword: false,
        commentForm: { author: '', text: '', password: '' },
        fieldOrder: FIELD_ORDER,
        categoryClassMap: CATEGORY_CLASS,
        imageFailures: {},
        mobileFiltersOpen: false,
        chatOpen: false,
        chatInput: '',
        chatBusy: false,
        chatError: '',
        chatMessages: [
          { role: 'assistant', content: '안녕하세요! 원하는 지역, 취향, 일정이나 날씨 걱정을 말씀해 주세요. LocalHub 데이터에서 어울리는 서울 관광지를 찾아드릴게요.', places: [], mode: 'welcome' }
        ],
        chatSuggestions: ['비 오는 날 실내 추천', '부모님과 편한 여행', '아이와 문화 체험']
      };
    },

    computed: {
      categories() {
        return this.stats?.categories || [];
      },
      districts() {
        return this.stats?.districts || [];
      },
      fieldLabels() {
        return this.stats?.fieldLabels || {};
      },
      resultSummary() {
        if (!this.result.total) return '검색 결과가 없습니다.';
        const start = (this.result.page - 1) * this.result.pageSize + 1;
        const end = Math.min(this.result.page * this.result.pageSize, this.result.total);
        return `전체 ${this.formatNumber(this.result.total)}곳 중 ${this.formatNumber(start)}–${this.formatNumber(end)}곳`;
      },
      visiblePages() {
        const total = this.result.totalPages;
        const current = this.result.page;
        const start = Math.max(1, current - 2);
        const end = Math.min(total, current + 2);
        const pages = [];
        for (let page = start; page <= end; page += 1) pages.push(page);
        return pages;
      },
      savedCount() {
        return this.bookmarks.length;
      },
      detailRows() {
        if (!this.selected) return [];
        return this.fieldOrder.map(key => ({
          key,
          label: this.fieldLabels[key] || key,
          value: this.selected[key] === '' || this.selected[key] == null
            ? '정보 미제공'
            : this.selected[key]
        }));
      }
    },

    methods: {
      async api(path) {
        const response = await fetch(path, {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          throw new Error(`서버 응답을 읽지 못했습니다. HTTP ${response.status}`);
        }
        if (!response.ok) {
          throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
        }
        return payload;
      },

      async sendChat() {
        const message = this.chatInput.trim();
        if (!message || this.chatBusy) return;
        this.chatInput = '';
        this.chatError = '';
        this.chatMessages.push({ role: 'user', content: message, places: [] });
        this.chatBusy = true;
        await this.$nextTick();
        this.scrollChat();
        try {
          const history = this.chatMessages.slice(-7, -1).map(row => ({
            role: row.role,
            content: row.content
          }));
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ message, history })
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          const ids = new Set(Array.from(payload.answer.matchAll(/\[장소ID:([^\]]+)\]/g), match => match[1]));
          const availablePlaces = payload.places || [];
          const places = (ids.size
            ? availablePlaces.filter(place => ids.has(String(place.contentid)))
            : availablePlaces).slice(0, 3);
          this.chatMessages.push({
            role: 'assistant',
            content: payload.answer,
            places,
            mode: payload.mode,
            fallbackReason: payload.fallbackReason || ''
          });
        } catch (error) {
          this.chatError = error.message;
        } finally {
          this.chatBusy = false;
          await this.$nextTick();
          this.scrollChat();
        }
      },

      askSuggestion(text) {
        this.chatInput = text;
        this.sendChat();
      },

      chatDisplayText(text) {
        return String(text || '').replace(/\s*\[장소ID:[^\]]+\]/g, '');
      },

      scrollChat() {
        const panel = this.$refs.chatMessages;
        if (panel) panel.scrollTop = panel.scrollHeight;
      },

      async initialize() {
        try {
          this.restorePreferences();
          const [stats, health] = await Promise.all([
            this.api('/api/stats'),
            this.api('/api/health')
          ]);
          this.stats = stats;
          this.health = health;
          await this.search(1);
          this.ready = true;
        } catch (error) {
          this.error = error.message;
          this.ready = true;
        }
      },

      restorePreferences() {
        try {
          const savedFont = localStorage.getItem('localhub-font-size');
          if (savedFont === 'normal' || savedFont === 'large') {
            this.fontSize = savedFont;
          }
          const savedBookmarks = JSON.parse(localStorage.getItem('localhub-bookmarks') || '[]');
          if (Array.isArray(savedBookmarks)) {
            this.bookmarks = savedBookmarks.map(String);
          }
        } catch {
          this.bookmarks = [];
        }
        document.documentElement.dataset.fontSize = this.fontSize;
        const savedTheme = localStorage.getItem('localhub-theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
          this.theme = savedTheme;
        }
        document.documentElement.dataset.theme = this.theme;
      },

      setFontSize(size) {
        this.fontSize = size;
        document.documentElement.dataset.fontSize = size;
        try {
          localStorage.setItem('localhub-font-size', size);
        } catch {
          // The setting still applies during the current session.
        }
      },

      setTheme(mode) {
        this.theme = mode === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = this.theme;
        try {
          localStorage.setItem('localhub-theme', this.theme);
        } catch {
          // Apply for current session only if storage fails.
        }
      },

      async search(page = 1) {
        this.busy = true;
        this.error = '';
        this.activeView = 'list';
        this.appliedFilters = { ...this.filters };

        const params = new URLSearchParams({
          q: this.filters.q,
          category: this.filters.category,
          district: this.filters.district,
          completeness: this.filters.completeness,
          sort: this.filters.sort,
          page: String(page),
          pageSize: String(this.filters.pageSize)
        });

        try {
          this.result = await this.api(`/api/search?${params.toString()}`);
          this.mobileFiltersOpen = false;
          window.scrollTo({ top: document.querySelector('#results-section')?.offsetTop - 20 || 0 });
        } catch (error) {
          this.error = error.message;
        } finally {
          this.busy = false;
        }
      },

      async quickCategory(category) {
        this.filters.category = category;
        await this.search(1);
      },

      resetFilters() {
        this.filters = {
          q: '',
          category: '전체',
          district: '전체',
          completeness: '전체',
          sort: 'title',
          pageSize: 24
        };
        this.search(1);
      },

      async changeView(view) {
        this.activeView = view;
        this.error = '';

        if (view === 'map') {
          await this.loadMap();
        } else if (view === 'saved') {
          await this.loadSavedItems();
        }
      },

      async loadMap() {
        this.mapMessage = '';
        const params = new URLSearchParams({
          q: this.filters.q,
          category: this.filters.category,
          district: this.filters.district,
          limit: '300'
        });

        try {
          const data = await this.api(`/api/map?${params.toString()}`);
          this.mapPoints = data.points;
          this.mapMessage = data.totalShown >= data.limit
            ? `성능을 위해 조건에 맞는 장소 중 앞의 ${data.limit}곳을 지도에 표시합니다.`
            : `${data.totalShown}곳을 지도에 표시합니다.`;
          await this.$nextTick();
          this.renderMap();
        } catch (error) {
          this.error = error.message;
        }
      },

      renderMap() {
        const container = document.getElementById('map');
        if (!container || !window.L) {
          this.mapMessage = '지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.';
          return;
        }

        if (!this._map) {
          this._map = L.map(container, {
            zoomControl: true,
            preferCanvas: true
          }).setView([37.5665, 126.9780], 11);

          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
          }).addTo(this._map);

          this._markerLayer = L.layerGroup().addTo(this._map);
        } else {
          this._map.invalidateSize();
          this._markerLayer.clearLayers();
        }

        const bounds = [];
        for (const point of this.mapPoints) {
          const className = this.categoryClass(point.contentType);
          const icon = L.divIcon({
            className: 'localhub-map-icon',
            html: `<span class="${className}" aria-hidden="true"></span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });
          const marker = L.marker([point.latitude, point.longitude], { icon });
          marker.bindTooltip(point.title, { direction: 'top', offset: [0, -10] });
          marker.bindPopup(`
            <div class="map-popup">
              <strong>${this.escapeHtml(point.title)}</strong>
              <span>${this.escapeHtml(point.contentType)} · ${this.escapeHtml(point.district)}</span>
              <small>${this.escapeHtml(point.address || '주소 정보 미제공')}</small>
            </div>
          `);
          marker.on('click', () => this.openDetail(point.contentid));
          marker.addTo(this._markerLayer);
          bounds.push([point.latitude, point.longitude]);
        }

        if (bounds.length === 1) {
          this._map.setView(bounds[0], 15);
        } else if (bounds.length > 1) {
          this._map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
        } else {
          this._map.setView([37.5665, 126.9780], 11);
        }

        setTimeout(() => this._map?.invalidateSize(), 80);
      },

      async showOnMap(item) {
        this.filters.q = item.title;
        this.filters.category = '전체';
        this.filters.district = '전체';
        this.activeView = 'map';
        await this.loadMap();
      },

      async openDetail(contentId) {
        this.detailBusy = true;
        this.weather = null;
        this.weatherError = '';
        this.selected = null;

        try {
          this.selected = await this.api(`/api/items/${encodeURIComponent(contentId)}`);
          if (this.selected?.hasCoordinates) void this.loadWeather();
          void this.loadComments();
        } catch (error) {
          this.error = error.message;
        } finally {
          this.detailBusy = false;
        }
      },

      closeDetail() {
        this.selected = null;
        this.weather = null;
        this.weatherError = '';
        this.comments = [];
        this.commentError = '';
        this.cancelCommentEdit();
      },

      async loadWeather() {
        if (!this.selected?.hasCoordinates) {
          this.weatherError = '이 장소에는 날씨 조회에 필요한 좌표가 없습니다.';
          return;
        }

        this.weatherBusy = true;
        this.weatherError = '';
        this.weather = null;

        const params = new URLSearchParams({
          lat: String(this.selected.latitude),
          lon: String(this.selected.longitude)
        });

        try {
          this.weather = await this.api(`/api/weather?${params.toString()}`);
        } catch (error) {
          this.weatherError = error.message;
        } finally {
          this.weatherBusy = false;
        }
      },

      async loadComments() {
        if (!this.selected?.contentid) return;
        this.commentsBusy = true;
        this.commentError = '';
        try {
          const data = await this.api(`/api/comments?contentid=${encodeURIComponent(this.selected.contentid)}`);
          this.comments = data.items || [];
        } catch (error) {
          this.commentError = error.message;
        } finally {
          this.commentsBusy = false;
        }
      },

      async saveComment() {
        if (!this.selected?.contentid || this.commentSaving) return;
        this.commentSaving = true;
        this.commentError = '';
        const editing = Boolean(this.commentEditingId);
        const path = editing ? `/api/comments/${encodeURIComponent(this.commentEditingId)}` : '/api/comments';
        try {
          const response = await fetch(path, {
            method: editing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ contentid: this.selected.contentid, ...this.commentForm })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          this.commentForm = { author: '', text: '', password: '' };
          this.commentEditingId = null;
          this.showCommentPassword = false;
          await this.loadComments();
        } catch (error) {
          this.commentError = error.message;
        } finally {
          this.commentSaving = false;
        }
      },

      startCommentEdit(comment) {
        this.commentEditingId = comment.id;
        this.commentForm = { author: comment.author, text: comment.text, password: '' };
        this.commentError = '';
      },

      cancelCommentEdit() {
        this.commentEditingId = null;
        this.commentForm = { author: '', text: '', password: '' };
        this.showCommentPassword = false;
      },

      async deleteComment(comment) {
        const password = window.prompt('댓글을 삭제하려면 작성할 때 사용한 비밀번호를 입력하세요.');
        if (password === null) return;
        if (password.length < 4) {
          this.commentError = '비밀번호는 4자 이상 입력해 주세요.';
          return;
        }
        this.commentError = '';
        try {
          const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ contentid: this.selected.contentid, password })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
          await this.loadComments();
        } catch (error) {
          this.commentError = error.message;
        }
      },

      formatCommentDate(value) {
        if (!value) return '';
        return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
      },

      toggleBookmark(contentId) {
        const id = String(contentId);
        if (this.bookmarks.includes(id)) {
          this.bookmarks = this.bookmarks.filter(value => value !== id);
        } else {
          this.bookmarks = [id, ...this.bookmarks];
        }

        try {
          localStorage.setItem('localhub-bookmarks', JSON.stringify(this.bookmarks));
        } catch {
          // Bookmark remains available during the current session.
        }

        if (this.activeView === 'saved') this.loadSavedItems();
      },

      isBookmarked(contentId) {
        return this.bookmarks.includes(String(contentId));
      },

      async loadSavedItems() {
        this.savedBusy = true;
        try {
          if (!this.bookmarks.length) {
            this.savedItems = [];
            return;
          }
          const ids = this.bookmarks.join(',');
          const data = await this.api(`/api/bookmarks?ids=${encodeURIComponent(ids)}`);
          const order = new Map(this.bookmarks.map((id, index) => [id, index]));
          this.savedItems = data.items.sort(
            (a, b) => (order.get(a.contentid) ?? 9999) - (order.get(b.contentid) ?? 9999)
          );
        } catch (error) {
          this.error = error.message;
        } finally {
          this.savedBusy = false;
        }
      },

      externalMapUrl(item) {
        return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(item.latitude)}&mlon=${encodeURIComponent(item.longitude)}#map=17/${encodeURIComponent(item.latitude)}/${encodeURIComponent(item.longitude)}`;
      },

      categoryClass(category) {
        return this.categoryClassMap[category] || 'category-default';
      },

      formatNumber(value) {
        return Number(value || 0).toLocaleString('ko-KR');
      },

      formatValue(value, suffix = '') {
        if (value === null || value === undefined || value === '') return '정보 없음';
        return `${value}${suffix}`;
      },

      weatherIcon(description) {
        if (!description) return '🌤️';
        if (description.includes('눈')) return '🌨️';
        if (description.includes('비')) return '🌧️';
        if (description.includes('흐림')) return '☁️';
        if (description.includes('구름')) return '⛅';
        return '☀️';
      },

      imageFailed(id, type = 'card') {
        return Boolean(this.imageFailures[`${id}-${type}`]);
      },

      markImageFailed(id, type = 'card') {
        this.imageFailures[`${id}-${type}`] = true;
      },

      escapeHtml(value) {
        return String(value || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      },

      copyText(value) {
        navigator.clipboard?.writeText(String(value || ''));
      }
    },

    mounted() {
      this.initialize();
    },

    beforeUnmount() {
      this._map?.remove();
    },

    template: `
      <div class="app-shell">
        <header class="site-header">
          <div class="header-inner">
            <a class="brand" href="/" aria-label="LocalHub 서울안내 홈">
              <span class="brand-mark">LH</span>
              <span>
                <strong>LocalHub</strong>
                <small>서울안내</small>
              </span>
            </a>

            <div class="header-actions" aria-label="화면 설정">
              <span class="data-status" v-if="stats">
                한국관광공사 데이터 {{ formatNumber(stats.total) }}건
              </span>
              <div class="font-switch" role="group" aria-label="글자 크기">
                <button
                  type="button"
                  :class="{ active: fontSize === 'normal' }"
                  @click="setFontSize('normal')"
                  :aria-pressed="fontSize === 'normal'"
                >보통 글씨</button>
                <button
                  type="button"
                  :class="{ active: fontSize === 'large' }"
                  @click="setFontSize('large')"
                  :aria-pressed="fontSize === 'large'"
                >큰 글씨</button>
              </div>
                <div class="theme-switch" role="group" aria-label="테마">
                  <button
                    type="button"
                    :class="{ active: theme === 'light' }"
                    @click="setTheme('light')"
                    :aria-pressed="theme === 'light'"
                  >라이트</button>
                  <button
                    type="button"
                    :class="{ active: theme === 'dark' }"
                    @click="setTheme('dark')"
                    :aria-pressed="theme === 'dark'"
                  >다크</button>
                </div>
            </div>
          </div>
        </header>

        <main id="main-content">
          <section class="hero">
            <div class="hero-inner">
              <div class="hero-copy">
                <p class="eyebrow">지방에 계신 부모님을 위한 서울 통합 안내</p>
                <h1>낯선 서울에서도<br><em>찾고, 보고, 날씨까지</em> 한 번에</h1>
                <p class="hero-description">
                  관광지·문화시설·축제·여행코스·레포츠·숙박·쇼핑 정보를
                  큰 글씨와 쉬운 버튼으로 확인할 수 있습니다.
                </p>
                <div class="hero-trust">
                  <span>✓ 한국관광공사 TourAPI 원본</span>
                  <span>✓ 기상청 실시간 관측</span>
                  <span>✓ OpenStreetMap 지도</span>
                </div>
              </div>

              <aside class="hero-guide" aria-label="이용 방법">
                <div class="hero-postcard" aria-hidden="true">
                  <span class="hero-sun"></span>
                  <span class="hero-hill hill-back"></span>
                  <span class="hero-hill hill-front"></span>
                  <span class="hero-city city-one"></span>
                  <span class="hero-city city-two"></span>
                  <span class="hero-route"></span>
                </div>
                <h2>이용 방법</h2>
                <ol>
                  <li><strong>1</strong><span>장소나 지역을 입력하세요.</span></li>
                  <li><strong>2</strong><span>검색 결과에서 상세정보를 누르세요.</span></li>
                  <li><strong>3</strong><span>지도와 현재 날씨를 확인하세요.</span></li>
                </ol>
              </aside>
            </div>
          </section>

          <div v-if="!ready" class="page-loading">
            <span class="spinner"></span>
            관광 데이터를 불러오는 중입니다.
          </div>

          <div v-else class="page-content">
            <section v-if="stats" class="stats-grid" aria-label="데이터 현황">
              <article>
                <span>전체 데이터</span>
                <strong>{{ formatNumber(stats.total) }}</strong>
                <small>업로드된 7개 유형</small>
              </article>
              <article>
                <span>사진 제공</span>
                <strong>{{ formatNumber(stats.withImage) }}</strong>
                <small>원본 이미지 URL</small>
              </article>
              <article>
                <span>지도 좌표</span>
                <strong>{{ formatNumber(stats.withCoordinates) }}</strong>
                <small>WGS84 좌표</small>
              </article>
              <article>
                <span>찜한 장소</span>
                <strong>{{ formatNumber(savedCount) }}</strong>
                <small>이 브라우저에 저장</small>
              </article>
            </section>

            <section class="search-section" aria-labelledby="search-heading">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">서울 장소 검색</p>
                  <h2 id="search-heading">어디를 찾아볼까요?</h2>
                  <p>장소명, 주소, 우편번호, 분류코드 등 원본 데이터의 모든 필드에서 검색합니다.</p>
                </div>
                <button class="mobile-filter-button" type="button" @click="mobileFiltersOpen = !mobileFiltersOpen">
                  검색 조건 {{ mobileFiltersOpen ? '닫기' : '열기' }}
                </button>
              </div>

              <div class="category-chips" aria-label="빠른 유형 선택">
                <button
                  type="button"
                  :class="{ active: filters.category === '전체' }"
                  @click="quickCategory('전체')"
                >전체</button>
                <button
                  v-for="category in categories"
                  :key="category.name"
                  type="button"
                  :class="{ active: filters.category === category.name }"
                  @click="quickCategory(category.name)"
                >
                  {{ category.name }}
                  <span>{{ formatNumber(category.count) }}</span>
                </button>
              </div>

              <form
                class="search-form"
                :class="{ open: mobileFiltersOpen }"
                @submit.prevent="search(1)"
              >
                <div class="field field-query">
                  <label for="query">장소명 또는 검색어</label>
                  <input
                    id="query"
                    v-model.trim="filters.q"
                    type="search"
                    maxlength="100"
                    placeholder="예: 한강공원, 종로구, 박물관"
                  >
                </div>

                <div class="field">
                  <label for="category">유형</label>
                  <select id="category" v-model="filters.category">
                    <option>전체</option>
                    <option v-for="category in categories" :key="category.name">
                      {{ category.name }}
                    </option>
                  </select>
                </div>

                <div class="field">
                  <label for="district">자치구</label>
                  <select id="district" v-model="filters.district">
                    <option>전체</option>
                    <option v-for="district in districts" :key="district.name">
                      {{ district.name }} ({{ formatNumber(district.count) }})
                    </option>
                  </select>
                </div>

                <div class="field">
                  <label for="completeness">정보 조건</label>
                  <select id="completeness" v-model="filters.completeness">
                    <option>전체</option>
                    <option>이미지 있음</option>
                    <option>좌표 있음</option>
                    <option>전화번호 있음</option>
                  </select>
                </div>

                <div class="field">
                  <label for="sort">정렬</label>
                  <select id="sort" v-model="filters.sort">
                    <option value="title">가나다순</option>
                    <option value="modified_desc">최근 수정순</option>
                    <option value="created_desc">최근 등록순</option>
                    <option value="category">유형순</option>
                  </select>
                </div>

                <div class="search-buttons">
                  <button class="button button-primary" type="submit" :disabled="busy">
                    {{ busy ? '검색 중…' : '검색하기' }}
                  </button>
                  <button class="button button-secondary" type="button" @click="resetFilters">
                    초기화
                  </button>
                </div>
              </form>
            </section>

            <div v-if="error" class="alert alert-error" role="alert">
              <strong>문제가 발생했습니다.</strong>
              <span>{{ error }}</span>
              <button type="button" @click="error = ''">닫기</button>
            </div>

            <section id="results-section" class="results-section">
              <div class="view-toolbar">
                <div class="view-tabs" role="tablist" aria-label="결과 보기 방식">
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="activeView === 'list'"
                    :class="{ active: activeView === 'list' }"
                    @click="changeView('list')"
                  >목록 보기</button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="activeView === 'map'"
                    :class="{ active: activeView === 'map' }"
                    @click="changeView('map')"
                  >지도 보기</button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="activeView === 'saved'"
                    :class="{ active: activeView === 'saved' }"
                    @click="changeView('saved')"
                  >찜한 장소 <span>{{ savedCount }}</span></button>
                </div>

                <p v-if="activeView === 'list'" class="result-count">{{ resultSummary }}</p>
              </div>

              <div v-if="busy" class="page-loading compact">
                <span class="spinner"></span> 검색 결과를 불러오는 중입니다.
              </div>

              <template v-else-if="activeView === 'list'">
                <div v-if="result.items.length" class="result-grid">
                  <article v-for="item in result.items" :key="item.contentid" class="place-card">
                    <div class="card-image">
                      <img
                        v-if="item.firstimage && !imageFailed(item.contentid)"
                        :src="item.firstimage"
                        :alt="item.title"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        @error="markImageFailed(item.contentid)"
                      >
                      <div v-else class="image-placeholder" aria-label="제공된 이미지 없음">
                        <span>{{ item.contentType.slice(0, 1) }}</span>
                        <small>이미지 미제공</small>
                      </div>
                      <span class="category-badge" :class="categoryClass(item.contentType)">
                        {{ item.contentType }}
                      </span>
                      <button
                        class="bookmark-button"
                        type="button"
                        :aria-label="isBookmarked(item.contentid) ? '찜 해제' : '찜하기'"
                        :class="{ active: isBookmarked(item.contentid) }"
                        @click="toggleBookmark(item.contentid)"
                      >{{ isBookmarked(item.contentid) ? '★' : '☆' }}</button>
                    </div>

                    <div class="card-body">
                      <div class="card-meta">
                        <span>{{ item.district }}</span>
                        <span v-if="item.zipcode">우편번호 {{ item.zipcode }}</span>
                      </div>
                      <h3>{{ item.title }}</h3>
                      <p class="card-address">{{ item.fullAddress || '주소 정보가 제공되지 않았습니다.' }}</p>

                      <dl class="card-facts">
                        <div>
                          <dt>콘텐츠 ID</dt>
                          <dd>{{ item.contentid }}</dd>
                        </div>
                        <div>
                          <dt>수정일</dt>
                          <dd>{{ item.modifiedtimeFormatted || '정보 없음' }}</dd>
                        </div>
                        <div>
                          <dt>지도</dt>
                          <dd>{{ item.hasCoordinates ? '좌표 있음' : '좌표 없음' }}</dd>
                        </div>
                        <div>
                          <dt>이미지 권리</dt>
                          <dd>{{ item.cpyrhtDivCd || '미표기' }}</dd>
                        </div>
                      </dl>

                      <div class="card-actions">
                        <button class="button button-primary" type="button" @click="openDetail(item.contentid)">
                          상세정보
                        </button>
                        <button
                          class="button button-secondary"
                          type="button"
                          :disabled="!item.hasCoordinates"
                          @click="showOnMap(item)"
                        >지도에서 보기</button>
                      </div>
                    </div>
                  </article>
                </div>

                <div v-else class="empty-state">
                  <strong>검색 결과가 없습니다.</strong>
                  <p>검색어를 줄이거나 유형과 자치구를 ‘전체’로 바꿔보세요.</p>
                  <button class="button button-primary" type="button" @click="resetFilters">전체 장소 보기</button>
                </div>

                <nav v-if="result.totalPages > 1" class="pagination" aria-label="검색 결과 페이지">
                  <button type="button" :disabled="result.page <= 1" @click="search(result.page - 1)">이전</button>
                  <button
                    v-for="page in visiblePages"
                    :key="page"
                    type="button"
                    :class="{ active: page === result.page }"
                    :aria-current="page === result.page ? 'page' : undefined"
                    @click="search(page)"
                  >{{ page }}</button>
                  <button type="button" :disabled="result.page >= result.totalPages" @click="search(result.page + 1)">다음</button>
                </nav>
              </template>

              <template v-else-if="activeView === 'map'">
                <div class="map-panel">
                  <div class="map-notice">
                    <strong>지도 안내</strong>
                    <span>{{ mapMessage || '검색 조건에 맞는 장소를 지도에 표시합니다.' }}</span>
                  </div>
                  <div id="map" class="map-container" aria-label="서울 관광 장소 지도"></div>
                  <p class="map-attribution">
                    지도 데이터 © OpenStreetMap contributors. 관광지 좌표는 한국관광공사 원본 데이터입니다.
                  </p>
                </div>
              </template>

              <template v-else>
                <div v-if="savedBusy" class="page-loading compact">
                  <span class="spinner"></span> 찜한 장소를 불러오는 중입니다.
                </div>
                <div v-else-if="savedItems.length" class="saved-list">
                  <article v-for="item in savedItems" :key="item.contentid" class="saved-card">
                    <div>
                      <span class="category-badge" :class="categoryClass(item.contentType)">{{ item.contentType }}</span>
                      <h3>{{ item.title }}</h3>
                      <p>{{ item.fullAddress || '주소 정보 미제공' }}</p>
                    </div>
                    <div class="saved-actions">
                      <button class="button button-primary" type="button" @click="openDetail(item.contentid)">상세정보</button>
                      <button class="button button-secondary" type="button" @click="toggleBookmark(item.contentid)">찜 해제</button>
                    </div>
                  </article>
                </div>
                <div v-else class="empty-state">
                  <strong>아직 찜한 장소가 없습니다.</strong>
                  <p>관심 있는 장소 카드에서 별표 버튼을 눌러 저장하세요.</p>
                  <button class="button button-primary" type="button" @click="changeView('list')">장소 둘러보기</button>
                </div>
              </template>
            </section>
          </div>
        </main>

        <button class="chat-launcher" type="button" :class="{ open: chatOpen }" :aria-expanded="chatOpen" aria-controls="tour-chat" @click="chatOpen = !chatOpen">
          <span class="dog-avatar" aria-hidden="true">
            <svg viewBox="0 0 96 96" role="img">
              <path class="dog-ear" d="M26 34C10 17 7 43 17 55l13-8z"/>
              <path class="dog-ear" d="M70 34c16-17 19 9 9 21l-13-8z"/>
              <circle class="dog-face" cx="48" cy="49" r="32"/>
              <circle class="dog-eye" cx="36" cy="45" r="4"/><circle class="dog-eye" cx="60" cy="45" r="4"/>
              <ellipse class="dog-muzzle" cx="48" cy="60" rx="15" ry="11"/>
              <path class="dog-nose" d="M43 56q5-5 10 0-1 7-5 7t-5-7z"/>
              <path class="dog-mouth" d="M48 63q-1 8-9 5m9-5q1 8 9 5"/>
              <path class="dog-tongue" d="M43 68h10q0 11-5 11t-5-11z"/>
            </svg>
            <span class="chat-online-dot"></span>
          </span>
          <span class="chat-launcher-label"><strong>스마트 안내견</strong><small>무엇이든 물어보세요</small></span>
        </button>

        <section v-if="chatOpen" id="tour-chat" class="chat-panel" aria-label="스마트 관광 안내 챗봇">
          <header class="chat-header">
            <span class="chat-header-dog" aria-hidden="true">🐶</span>
            <div><strong>LocalHub 스마트 안내견</strong><small>무료 · 관광지 원본 · 실제 날씨 기반</small></div>
            <button type="button" aria-label="챗봇 닫기" @click="chatOpen = false">×</button>
          </header>
          <div ref="chatMessages" class="chat-messages" aria-live="polite">
            <article v-for="(row, index) in chatMessages" :key="index" class="chat-message" :class="row.role">
              <span>{{ row.role === 'assistant' ? '스마트 안내견' : '나' }}</span>
              <p>{{ chatDisplayText(row.content) }}</p>
              <small v-if="row.fallbackReason" class="chat-mode-notice">{{ row.fallbackReason }}</small>
              <div v-if="row.places?.length" class="chat-place-links">
                <button v-for="place in row.places" :key="place.contentid" type="button" @click="openDetail(place.contentid)">
                  {{ place.이름 }} 상세보기
                </button>
              </div>
            </article>
            <article v-if="chatBusy" class="chat-message assistant"><span>스마트 안내견</span><p>멍! 알맞은 장소를 찾고 있어요…</p></article>
          </div>
          <div v-if="chatMessages.length === 1" class="chat-suggestions">
            <button v-for="suggestion in chatSuggestions" :key="suggestion" type="button" @click="askSuggestion(suggestion)">{{ suggestion }}</button>
          </div>
          <p v-if="chatError" class="chat-error" role="alert">{{ chatError }}</p>
          <form class="chat-form" @submit.prevent="sendChat">
            <label class="sr-only" for="chat-input">관광 안내 질문</label>
            <input id="chat-input" v-model="chatInput" maxlength="1000" placeholder="예: 비 오는 날 종로 실내 여행지 추천" :disabled="chatBusy">
            <button type="submit" :disabled="chatBusy || !chatInput.trim()">보내기</button>
          </form>
          <small class="chat-disclaimer">원본 데이터에 없는 운영시간·요금은 방문 전 확인하세요.</small>
        </section>

        <footer class="site-footer">
          <div class="footer-inner">
            <div>
              <strong>LocalHub 서울안내</strong>
              <p>지방에 계신 부모님도 편안하게 서울을 둘러보실 수 있도록 돕는 정보 서비스입니다.</p>
            </div>
            <div class="source-list">
              <span>관광정보: 한국관광공사 TourAPI 4.0 · 공공누리 제3유형</span>
              <span>날씨: 기상청 단기예보 조회서비스 · 공공누리 제1유형</span>
              <span>지도: © OpenStreetMap contributors</span>
            </div>
          </div>
        </footer>

        <div v-if="detailBusy" class="modal-backdrop" role="status">
          <div class="modal-loading"><span class="spinner"></span> 상세정보를 불러오는 중입니다.</div>
        </div>

        <div v-if="selected" class="modal-backdrop" @click.self="closeDetail">
          <article class="detail-modal" role="dialog" aria-modal="true" :aria-labelledby="'detail-' + selected.contentid">
            <header class="modal-header">
              <div>
                <span class="category-badge" :class="categoryClass(selected.contentType)">{{ selected.contentType }}</span>
                <h2 :id="'detail-' + selected.contentid">{{ selected.title }}</h2>
                <p>{{ selected.fullAddress || '주소 정보 미제공' }}</p>
              </div>
              <button class="modal-close" type="button" aria-label="상세정보 닫기" @click="closeDetail">×</button>
            </header>

            <div class="detail-body">
              <section class="detail-visual">
                <div class="detail-image">
                  <img
                    v-if="selected.firstimage && !imageFailed(selected.contentid, 'detail')"
                    :src="selected.firstimage"
                    :alt="selected.title"
                    referrerpolicy="no-referrer"
                    @error="markImageFailed(selected.contentid, 'detail')"
                  >
                  <div v-else class="image-placeholder">
                    <span>{{ selected.contentType.slice(0, 1) }}</span>
                    <small>원본 이미지 미제공</small>
                  </div>
                </div>

                <div class="detail-action-grid">
                  <button class="button button-primary" type="button" @click="loadWeather" :disabled="weatherBusy || !selected.hasCoordinates">
                    {{ weatherBusy ? '날씨 조회 중…' : '현재 날씨 확인' }}
                  </button>
                  <a
                    v-if="selected.hasCoordinates"
                    class="button button-secondary"
                    :href="externalMapUrl(selected)"
                    target="_blank"
                    rel="noopener noreferrer"
                  >큰 지도 열기</a>
                  <button class="button button-secondary" type="button" @click="toggleBookmark(selected.contentid)">
                    {{ isBookmarked(selected.contentid) ? '찜 해제' : '찜하기' }}
                  </button>
                </div>

                <div v-if="weatherError" class="weather-error" role="alert">
                  <strong>기상청 날씨를 불러오지 못했습니다.</strong>
                  <p>{{ weatherError }}</p>
                  <small>시연용 값으로 대체하지 않고 실제 오류를 표시합니다.</small>
                </div>

                <section v-if="weather" class="weather-panel" aria-labelledby="weather-heading">
                  <div class="weather-heading">
                    <div>
                      <p class="eyebrow">기상청 실시간 관측</p>
                      <h3 id="weather-heading">{{ selected.title }} 날씨</h3>
                      <span>{{ weather.observedAt }} 발표 · 격자 {{ weather.grid.nx }}, {{ weather.grid.ny }}</span>
                    </div>
                    <span class="weather-icon">{{ weatherIcon(weather.current.description) }}</span>
                  </div>

                  <div class="current-weather">
                    <strong>{{ formatValue(weather.current.temperature, '℃') }}</strong>
                    <span>{{ weather.current.description }}</span>
                  </div>

                  <dl class="weather-facts">
                    <div><dt>습도</dt><dd>{{ formatValue(weather.current.humidity, '%') }}</dd></div>
                    <div><dt>1시간 강수</dt><dd>{{ formatValue(weather.current.rain1h, 'mm') }}</dd></div>
                    <div><dt>풍속</dt><dd>{{ formatValue(weather.current.windSpeed, 'm/s') }}</dd></div>
                    <div><dt>풍향</dt><dd>{{ weather.current.windDirectionLabel }}</dd></div>
                  </dl>

                  <p class="weather-advice"><strong>외출 도움말</strong>{{ weather.advice }}</p>

                  <div v-if="weather.forecast?.length" class="forecast-strip">
                    <article v-for="forecast in weather.forecast" :key="forecast.date + forecast.time">
                      <time>{{ forecast.displayTime }}</time>
                      <span>{{ weatherIcon(forecast.description) }}</span>
                      <strong>{{ formatValue(forecast.temperature, '℃') }}</strong>
                      <small>{{ forecast.description }}</small>
                    </article>
                  </div>
                </section>
              </section>

              <section class="community-section" aria-labelledby="community-heading">
                <div class="community-heading">
                  <div>
                    <p class="eyebrow">장소 이야기</p>
                    <h3 id="community-heading">이 장소에 대한 의견을 나눠보세요</h3>
                    <p>방문 경험이나 부모님께 도움이 될 정보를 남길 수 있습니다.</p>
                  </div>
                  <div class="community-summary">
                    <span>댓글 {{ comments.length }}개</span>
                    <button class="button button-secondary" type="button" @click="toggleBookmark(selected.contentid)">
                      {{ isBookmarked(selected.contentid) ? '★ 찜한 장소' : '☆ 찜하기' }}
                    </button>
                  </div>
                </div>

                <div v-if="commentsBusy" class="comment-status" role="status">
                  <span class="spinner"></span> 댓글을 불러오는 중입니다.
                </div>
                <div v-else-if="comments.length" class="comment-list">
                  <article v-for="comment in comments" :key="comment.id" class="comment-card">
                    <header>
                      <strong>{{ comment.author }}</strong>
                      <time :datetime="comment.updatedAt || comment.createdAt">
                        {{ formatCommentDate(comment.updatedAt || comment.createdAt) }}{{ comment.updatedAt ? ' · 수정됨' : '' }}
                      </time>
                    </header>
                    <p>{{ comment.text }}</p>
                    <div class="comment-actions">
                      <button type="button" @click="startCommentEdit(comment)">수정</button>
                      <button type="button" @click="deleteComment(comment)">삭제</button>
                    </div>
                  </article>
                </div>
                <div v-else class="comment-empty">
                  <strong>아직 등록된 댓글이 없습니다.</strong>
                  <span>첫 번째 장소 이야기를 남겨보세요.</span>
                </div>

                <p v-if="commentError" class="comment-error" role="alert">{{ commentError }}</p>
                <form class="comment-form" @submit.prevent="saveComment">
                  <div class="comment-form-heading">
                    <strong>{{ commentEditingId ? '댓글 수정' : '댓글 작성' }}</strong>
                    <button v-if="commentEditingId" type="button" @click="cancelCommentEdit">수정 취소</button>
                  </div>
                  <label>
                    <span>작성자</span>
                    <input v-model.trim="commentForm.author" maxlength="30" required :disabled="Boolean(commentEditingId)" placeholder="이름 또는 별명">
                  </label>
                  <label>
                    <span>댓글</span>
                    <textarea v-model.trim="commentForm.text" minlength="2" maxlength="500" required placeholder="이 장소에 대한 경험이나 도움이 될 정보를 남겨주세요."></textarea>
                    <small>{{ commentForm.text.length }} / 500자</small>
                  </label>
                  <label>
                    <span>비밀번호</span>
                    <div class="comment-password-row">
                      <input v-model="commentForm.password" :type="showCommentPassword ? 'text' : 'password'" minlength="4" maxlength="50" required autocomplete="new-password" placeholder="수정·삭제할 때 사용합니다">
                      <button type="button" :aria-pressed="showCommentPassword" @click="showCommentPassword = !showCommentPassword">
                        {{ showCommentPassword ? '숨기기' : '보기' }}
                      </button>
                    </div>
                  </label>
                  <div class="comment-form-footer">
                    <small>비밀번호는 암호화해 저장하며 화면에 표시하지 않습니다.</small>
                    <button class="button button-primary" type="submit" :disabled="commentSaving">
                      {{ commentSaving ? '저장 중…' : (commentEditingId ? '수정 저장' : '댓글 등록') }}
                    </button>
                  </div>
                </form>
              </section>

              <section class="raw-data-section" aria-labelledby="raw-data-heading">
                <div class="raw-data-heading">
                  <div>
                    <p class="eyebrow">TourAPI 원본 필드</p>
                    <h3 id="raw-data-heading">제공된 모든 데이터 정보</h3>
                  </div>
                  <span>내용을 변경하지 않고 표시합니다.</span>
                </div>

                <dl class="raw-data-list">
                  <div v-for="row in detailRows" :key="row.key">
                    <dt>
                      {{ row.label }}
                      <code>{{ row.key }}</code>
                    </dt>
                    <dd>
                      <a
                        v-if="String(row.value).startsWith('http')"
                        :href="row.value"
                        target="_blank"
                        rel="noopener noreferrer"
                      >{{ row.value }}</a>
                      <span v-else>{{ row.value }}</span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </article>
        </div>
      </div>
    `
  }).mount('#app');
};
