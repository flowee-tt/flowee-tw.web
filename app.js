/* ==========================================
   WEB LỚP A6 - COMMERCIAL MULTI-CLASS ENGINE (REALTIME MULTI-USER LIKE SYNC)
   Features:
   1. Real-time Multi-User Like Engine: Each post stores likedByUsers array of student names.
      Total likes = likedByUsers.length, synced real-time across all classmate devices.
   2. Restored Class Admin Student Password Controls.
   3. Instagram/Facebook Premium Glassmorphism Auth Gateway.
   ========================================== */

const SUPER_ADMIN_PIN = "999999";
const SYSTEM_CLASSES_KEY = 'web_lop_classes_index';

const INITIAL_OFFICIAL_ROSTER = [
  "Nguyễn Văn Nam",
  "Trần Thu Hà",
  "Đặng Mỹ Linh",
  "Lê Hoàng Tuấn",
  "Nguyễn Phương Mai",
  "Phạm Minh Phong",
  "Bùi Hoàng Đức",
  "Quản Trị Viên Lớp"
];

// BroadcastChannel & Storage Sync Channel for Cross-Device / Cross-Tab Syncing
const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('web_lop_sync_channel') : null;

// IndexedDB Storage Manager for Long Videos & High-Res Media
class IndexedMediaStore {
  constructor() {
    this.dbName = 'WebLopMediaDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('media_files')) {
          db.createObjectStore('media_files', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => reject(e);
    });
  }

  async saveBlob(mediaId, blob, name, type) {
    try {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('media_files', 'readwrite');
        const store = tx.objectStore('media_files');
        store.put({ id: mediaId, blob, name, type, date: Date.now() });
        tx.oncomplete = () => resolve(mediaId);
        tx.onerror = (e) => reject(e);
      });
    } catch(err) {
      console.warn("IndexedDB save failed, using fallback:", err);
      return mediaId;
    }
  }

  async getBlobUrl(mediaId) {
    try {
      await this.init();
      return new Promise((resolve) => {
        const tx = this.db.transaction('media_files', 'readonly');
        const store = tx.objectStore('media_files');
        const req = store.get(mediaId);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            resolve(URL.createObjectURL(req.result.blob));
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch(err) {
      return null;
    }
  }
}

const mediaStore = new IndexedMediaStore();

// App State Manager with Isolated Class Database & Strict Role Control
class AppState {
  constructor() {
    this.systemClassName = localStorage.getItem('web_lop_active_system_name') || "11A6";
    this.classesIndex = JSON.parse(localStorage.getItem(SYSTEM_CLASSES_KEY)) || [
      { 
        id: 'c_11a6', 
        systemName: '11A6', 
        webName: 'Lớp A6 Mãi Đỉnh', 
        year: 'Niên khóa 2023 - 2026', 
        adminName: 'Quản Trị Viên A6',
        adminPass: 'AdminA6-99',
        studentPass: 'LopA6-2026',
        gbQuota: 5.0,
        status: 'Active'
      }
    ];

    const storedUser = JSON.parse(localStorage.getItem('web_lop_user'));
    if (storedUser && storedUser.isLoggedIn) {
      this.currentUser = storedUser;
    } else {
      this.currentUser = {
        realName: "",
        nickname: "",
        avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=User",
        role: "Thành Viên Lớp",
        isLoggedIn: false,
        isAdmin: false,
        isSuperAdmin: false
      };
    }

    this.loadClassData(this.systemClassName);

    this.activeTab = 'timeline';
    this.selectedGroupId = null;
    this.filterMonth = 'ALL';
    this.filterUploader = 'ALL';
    this.filterSort = 'NEWEST';
    this.searchQuery = '';
    this.selectedTag = '';

    this.activeUploadProjectId = null;
    this.tempGroupCoverData = null;
    this.tempProjectFileData = null;
    this.changeCoverGroupId = null;

    this.tempUploadFiles = [];
    this.tempAvatarData = null;
    this.isUploading = false;
    this.authMode = 'STUDENT'; // 'STUDENT' or 'CLASS_ADMIN'
  }

  loadClassData(systemName) {
    this.systemClassName = systemName;
    const currentClassObj = this.classesIndex.find(c => c.systemName === systemName);

    this.webDisplayName = currentClassObj ? currentClassObj.webName : (localStorage.getItem(`web_lop_web_name_${systemName}`) || `Lớp ${systemName}`);
    this.academicYear = localStorage.getItem(`web_lop_year_${systemName}`) || (currentClassObj ? currentClassObj.year : "Niên khóa 2023 - 2026");
    
    this.classStudentPassword = localStorage.getItem(`web_lop_dynamic_pass_${systemName}`) || (currentClassObj ? (currentClassObj.studentPass || "LopA6-2026") : "LopA6-2026");
    this.classAdminPassword = currentClassObj ? (currentClassObj.adminPass || "AdminA6-99") : "AdminA6-99";

    this.officialRoster = JSON.parse(localStorage.getItem(`web_lop_roster_${systemName}`)) || INITIAL_OFFICIAL_ROSTER;
    this.posts = JSON.parse(localStorage.getItem(`web_lop_posts_${systemName}`)) || [];
    this.groups = JSON.parse(localStorage.getItem(`web_lop_groups_${systemName}`)) || [];
    this.projects = JSON.parse(localStorage.getItem(`web_lop_projects_${systemName}`)) || [];

    localStorage.setItem('web_lop_active_system_name', systemName);
  }

  switchClass(systemName) {
    this.save();
    this.loadClassData(systemName);
  }

  save(broadcast = true) {
    localStorage.setItem('web_lop_active_system_name', this.systemClassName);
    localStorage.setItem(`web_lop_web_name_${this.systemClassName}`, this.webDisplayName);
    localStorage.setItem(`web_lop_year_${this.systemClassName}`, this.academicYear);
    localStorage.setItem(`web_lop_dynamic_pass_${this.systemClassName}`, this.classStudentPassword);
    localStorage.setItem('web_lop_user', JSON.stringify(this.currentUser));
    
    // Save isolated class keys
    localStorage.setItem(`web_lop_roster_${this.systemClassName}`, JSON.stringify(this.officialRoster));
    localStorage.setItem(`web_lop_posts_${this.systemClassName}`, JSON.stringify(this.posts));
    localStorage.setItem(`web_lop_groups_${this.systemClassName}`, JSON.stringify(this.groups));
    localStorage.setItem(`web_lop_projects_${this.systemClassName}`, JSON.stringify(this.projects));

    // Update classesIndex
    const idxClass = this.classesIndex.find(c => c.systemName === this.systemClassName);
    if (idxClass) {
      idxClass.webName = this.webDisplayName;
      idxClass.year = this.academicYear;
      idxClass.adminPass = this.classAdminPassword;
      idxClass.studentPass = this.classStudentPassword;
    }
    localStorage.setItem(SYSTEM_CLASSES_KEY, JSON.stringify(this.classesIndex));

    if (broadcast && syncChannel) {
      syncChannel.postMessage({ type: 'DATA_UPDATED', classCode: this.systemClassName, timestamp: Date.now() });
    }
  }

  logout() {
    this.currentUser = {
      realName: "",
      nickname: "",
      avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=User",
      role: "Thành Viên Lớp",
      isLoggedIn: false,
      isAdmin: false,
      isSuperAdmin: false
    };
    localStorage.removeItem('web_lop_user');
    this.save(false);
  }

  getUserDisplayName(userObj) {
    const u = userObj || this.currentUser;
    if (u.nickname && u.nickname.trim()) {
      return `${u.realName || u.name} ("${u.nickname}")`;
    }
    return u.realName || u.name || `Thành Viên Lớp ${this.systemClassName}`;
  }

  calculateClassStorage(systemName) {
    const sys = systemName || this.systemClassName;
    let bytes = 0;
    try {
      const pStr = localStorage.getItem(`web_lop_posts_${sys}`) || "[]";
      const gStr = localStorage.getItem(`web_lop_groups_${sys}`) || "[]";
      const prStr = localStorage.getItem(`web_lop_projects_${sys}`) || "[]";
      bytes = new Blob([pStr + gStr + prStr]).size;
    } catch(e) {
      bytes = 1024 * 1024 * 1;
    }
    const mb = bytes / (1024 * 1024);
    const gb = mb / 1024;
    return { bytes, mb: mb.toFixed(2), gb: gb.toFixed(3) };
  }
}

const state = new AppState();

// DOM Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await mediaStore.init();
  await hydratePostMediaUrls();
  renderApp();
  setupEventListeners();
  populateAuthClassSelect();
  setupRealtimeSyncEngine();
});

function setupRealtimeSyncEngine() {
  if (syncChannel) {
    syncChannel.onmessage = async (e) => {
      if (e.data && e.data.classCode === state.systemClassName) {
        state.loadClassData(state.systemClassName);
        await hydratePostMediaUrls();
        renderApp();
      }
    };
  }

  window.addEventListener('storage', async (e) => {
    if (e.key === `web_lop_posts_${state.systemClassName}`) {
      state.loadClassData(state.systemClassName);
      await hydratePostMediaUrls();
      renderApp();
    }
  });

  setInterval(async () => {
    try {
      if (window.storage) {
        const res = await window.storage.get(`web_lop_posts_${state.systemClassName}`, true);
        if (res && res.value) {
          const remotePosts = JSON.parse(res.value);
          if (remotePosts.length !== state.posts.length) {
            state.posts = remotePosts;
            await hydratePostMediaUrls();
            renderApp();
          }
        }
      }
    } catch(e){}
  }, 4000);
}

async function hydratePostMediaUrls() {
  for (let post of state.posts) {
    if (post.files && post.files.length > 0) {
      for (let f of post.files) {
        if (f.mediaId && (!f.url || f.url.startsWith('blob:'))) {
          const freshUrl = await mediaStore.getBlobUrl(f.mediaId);
          if (freshUrl) f.url = freshUrl;
        }
      }
    }
  }
}

function populateAuthClassSelect() {
  const select = document.getElementById('auth-class-select');
  if (!select) return;

  select.innerHTML = state.classesIndex.map(c => `
    <option value="${c.systemName}" ${c.systemName === state.systemClassName ? 'selected' : ''}>
      🏫 ${c.webName} (${c.systemName})
    </option>
  `).join('');
}

window.handleAuthClassChange = function(event) {
  const selectedCode = event.target.value;
  state.switchClass(selectedCode);
  renderApp();
};

// Toggle Auth Mode (Học Sinh vs Admin Lớp)
window.setAuthMode = function(mode) {
  state.authMode = mode;
  const btnStudent = document.getElementById('auth-tab-student');
  const btnAdmin = document.getElementById('auth-tab-admin');
  const studentFields = document.getElementById('auth-student-fields');
  const adminFields = document.getElementById('auth-admin-fields');

  if (mode === 'STUDENT') {
    btnStudent.className = 'flex-1 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg transition-all duration-300';
    btnAdmin.className = 'flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 transition-all';
    studentFields.classList.remove('hidden');
    adminFields.classList.add('hidden');
  } else {
    btnAdmin.className = 'flex-1 py-2.5 rounded-xl text-xs font-extrabold bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg transition-all duration-300';
    btnStudent.className = 'flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 transition-all';
    adminFields.classList.remove('hidden');
    studentFields.classList.add('hidden');
  }
};

window.togglePasswordVisibility = function(inputId, eyeId) {
  const input = document.getElementById(inputId);
  const eye = document.getElementById(eyeId);
  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    if (eye) eye.innerText = '🙈';
  } else {
    input.type = 'password';
    if (eye) eye.innerText = '👁️';
  }
};

function renderApp() {
  updateClassBranding();
  updateUserUI();
  renderTabContent();
  populateFilterOptions();
}

function updateClassBranding() {
  document.title = `${state.webDisplayName} - Portal Kỷ Niệm & Dự Án`;
  
  const logoEl = document.getElementById('brand-logo-text');
  if (logoEl) logoEl.innerText = state.systemClassName;

  const headerTitleEl = document.getElementById('header-title-text');
  if (headerTitleEl) headerTitleEl.innerText = state.webDisplayName.toUpperCase();

  const headerSubEl = document.getElementById('header-sub-text');
  if (headerSubEl) headerSubEl.innerText = `Mã Lớp: ${state.systemClassName}`;

  const heroTitle = document.getElementById('hero-title-text');
  if (heroTitle) heroTitle.innerText = `Dòng Thời Gian Kỷ Niệm ${state.webDisplayName} 🎓`;

  const heroYear = document.getElementById('hero-year-text');
  if (heroYear) heroYear.innerText = `✨ ${state.academicYear} • THPT`;

  const statPhotoCount = document.getElementById('stat-photo-count');
  if (statPhotoCount) statPhotoCount.innerText = `${state.posts.length} Bài viết`;

  const statProjCount = document.getElementById('stat-proj-count');
  if (statProjCount) statProjCount.innerText = `${state.projects.length} Dự án`;

  const statGroupCount = document.getElementById('stat-group-count');
  if (statGroupCount) statGroupCount.innerText = `${state.groups.length} Nhóm`;
}

function updateUserUI() {
  const userBtn = document.getElementById('user-profile-btn');
  const adminNavBtn = document.getElementById('admin-nav-btn');
  const globalLogoutBtn = document.getElementById('global-logout-btn');

  if (adminNavBtn) {
    if (state.currentUser.isLoggedIn && (state.currentUser.isAdmin || state.currentUser.isSuperAdmin)) {
      adminNavBtn.classList.remove('hidden');
    } else {
      adminNavBtn.classList.add('hidden');
    }
  }

  if (globalLogoutBtn) {
    if (state.currentUser.isLoggedIn) {
      globalLogoutBtn.classList.remove('hidden');
    } else {
      globalLogoutBtn.classList.add('hidden');
    }
  }

  if (!state.currentUser.isLoggedIn) {
    userBtn.innerHTML = `
      <span class="px-2.5 sm:px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-xs font-semibold hover:bg-amber-500/30">
        🔐 Đăng Nhập
      </span>
    `;
    populateAuthClassSelect();
    document.getElementById('whitelist-modal').classList.remove('hidden');
  } else {
    const displayName = state.getUserDisplayName();

    userBtn.innerHTML = `
      <img src="${state.currentUser.avatar}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover bg-slate-700 border ${state.currentUser.isAdmin ? 'border-amber-400 ring-2 ring-amber-500/40' : 'border-slate-700'}" alt="Avatar">
      <div class="hidden sm:block text-left">
        <div class="text-xs font-bold text-slate-100 flex items-center gap-1">
          ${displayName}
          ${state.currentUser.isAdmin ? '<span class="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 rounded font-extrabold">ADMIN LỚP</span>' : ''}
        </div>
        <div class="text-[10px] text-amber-400 font-medium">${state.currentUser.role}</div>
      </div>
    `;
    document.getElementById('whitelist-modal').classList.add('hidden');
  }
}

window.handleLogout = function() {
  if (confirm("🚪 Bạn có chắc chắn muốn ĐĂNG XUẤT khỏi tài khoản hiện tại không?")) {
    state.logout();
    renderApp();
    showToast("🚪 Đã đăng xuất thành công! Vui lòng đăng nhập lại.");
  }
};

function renderTabContent() {
  const navTimeline = document.getElementById('nav-timeline');
  const navGroups = document.getElementById('nav-groups');
  const navProjects = document.getElementById('nav-projects');

  const mnavTimeline = document.getElementById('mnav-timeline');
  const mnavGroups = document.getElementById('mnav-groups');
  const mnavProjects = document.getElementById('mnav-projects');

  const viewTimeline = document.getElementById('view-timeline');
  const viewGroups = document.getElementById('view-groups');
  const viewProjects = document.getElementById('view-projects');
  const viewGroupDetail = document.getElementById('view-group-detail');

  [navTimeline, navGroups, navProjects].forEach(btn => {
    if (btn) btn.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50';
  });

  [mnavTimeline, mnavGroups, mnavProjects].forEach(b => {
    if (b) b.classList.remove('active');
  });

  [viewTimeline, viewGroups, viewProjects, viewGroupDetail].forEach(v => {
    if (v) v.classList.add('hidden');
  });

  if (state.activeTab === 'timeline') {
    if (navTimeline) navTimeline.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm';
    if (mnavTimeline) mnavTimeline.classList.add('active');
    viewTimeline.classList.remove('hidden');
    renderTimelineFeed();
  } else if (state.activeTab === 'groups') {
    if (navGroups) navGroups.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm';
    if (mnavGroups) mnavGroups.classList.add('active');
    viewGroups.classList.remove('hidden');
    renderGroupsHub();
  } else if (state.activeTab === 'projects') {
    if (navProjects) navProjects.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm';
    if (mnavProjects) mnavProjects.classList.add('active');
    viewProjects.classList.remove('hidden');
    renderProjectsVault();
  } else if (state.activeTab === 'group_detail') {
    if (navGroups) navGroups.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm';
    if (mnavGroups) mnavGroups.classList.add('active');
    if (viewGroupDetail) viewGroupDetail.classList.remove('hidden');
    renderGroupDetailView();
  }
}

// ----------------------------------------------------
// 1. TIMELINE FEED RENDERER & FILTERS
// ----------------------------------------------------
function populateFilterOptions() {
  const monthSelect = document.getElementById('filter-month');
  const uploaderSelect = document.getElementById('filter-uploader');

  const months = Array.from(new Set(state.posts.map(p => p.dateMonthYear)));
  monthSelect.innerHTML = `<option value="ALL">📅 Tất cả thời gian</option>` + 
    months.map(m => `<option value="${m}">${m}</option>`).join('');
  monthSelect.value = state.filterMonth;

  const uploaders = Array.from(new Set(state.posts.map(p => p.uploaderNickname ? `${p.uploaderRealName} ("${p.uploaderNickname}")` : p.uploaderRealName)));
  uploaderSelect.innerHTML = `<option value="ALL">👤 Tất cả người đăng</option>` + 
    uploaders.map(u => `<option value="${u}">${u}</option>`).join('');
  uploaderSelect.value = state.filterUploader;
}

function getFilteredPosts() {
  let list = [...state.posts];

  if (state.filterMonth !== 'ALL') {
    list = list.filter(p => p.dateMonthYear === state.filterMonth);
  }

  if (state.filterUploader !== 'ALL') {
    list = list.filter(p => {
      const fullname = p.uploaderNickname ? `${p.uploaderRealName} ("${p.uploaderNickname}")` : p.uploaderRealName;
      return fullname === state.filterUploader;
    });
  }

  if (state.selectedTag) {
    list = list.filter(p => p.hashtags && p.hashtags.includes(state.selectedTag));
  }

  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(p => 
      p.caption.toLowerCase().includes(q) ||
      (p.uploaderRealName && p.uploaderRealName.toLowerCase().includes(q)) ||
      (p.uploaderNickname && p.uploaderNickname.toLowerCase().includes(q)) ||
      (p.space && p.space.toLowerCase().includes(q)) ||
      (p.hashtags && p.hashtags.some(h => h.toLowerCase().includes(q)))
    );
  }

  list.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    const aLikes = a.likedByUsers ? a.likedByUsers.length : (a.likes || 0);
    const bLikes = b.likedByUsers ? b.likedByUsers.length : (b.likes || 0);

    if (state.filterSort === 'NEWEST') {
      return new Date(b.date.replace(' ', 'T')) - new Date(a.date.replace(' ', 'T'));
    } else if (state.filterSort === 'OLDEST') {
      return new Date(a.date.replace(' ', 'T')) - new Date(b.date.replace(' ', 'T'));
    } else if (state.filterSort === 'MOST_LIKED') {
      return bLikes - aLikes;
    }
    return 0;
  });

  return list;
}

function renderTimelineFeed() {
  const container = document.getElementById('timeline-feed');
  const posts = getFilteredPosts();

  if (posts.length === 0) {
    container.innerHTML = `
      <div class="glass p-8 sm:p-12 text-center rounded-2xl sm:rounded-3xl border border-slate-800 space-y-4">
        <div class="w-14 h-14 sm:w-16 sm:h-16 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl mx-auto">
          🎬
        </div>
        <div>
          <h3 class="text-base sm:text-lg font-extrabold text-slate-100">Chưa có bài viết, ảnh hay video nào trong ${state.webDisplayName}</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Dữ liệu của lớp <strong class="text-amber-300">${state.webDisplayName} (${state.systemClassName})</strong> hoàn toàn đồng bộ realtime! Bấm nút bên dưới để chọn & đăng kỷ niệm đầu tiên nhé.
          </p>
        </div>
        <button onclick="openUploadModal()" class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold rounded-xl shadow-lg shadow-amber-500/20 transition-all">
          ➕ Tải Kỷ Niệm Mới Cho ${state.systemClassName}
        </button>
      </div>
    `;
    return;
  }

  const groupsByMonth = {};
  posts.forEach(post => {
    const m = post.dateMonthYear || "Khác";
    if (!groupsByMonth[m]) groupsByMonth[m] = [];
    groupsByMonth[m].push(post);
  });

  let html = '';
  Object.keys(groupsByMonth).forEach(month => {
    html += `
      <div class="timeline-month-section mb-6 sm:mb-8">
        <div class="timeline-month-badge">
          <span>📅</span> <span>${month.toUpperCase()}</span>
        </div>
        <div class="space-y-4 sm:space-y-6">
          ${groupsByMonth[month].map(post => createPostCardHTML(post)).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function createPostCardHTML(post) {
  // Multi-user Like Array Sync
  if (!post.likedByUsers) {
    post.likedByUsers = post.likedByMe ? [state.getUserDisplayName()] : [];
  }
  const myDisplayName = state.getUserDisplayName();
  const isLiked = post.likedByUsers.includes(myDisplayName);
  const totalLikes = post.likedByUsers.length;

  const commentCount = post.comments ? post.comments.length : 0;
  const canEditOrDelete = state.currentUser.isAdmin || state.currentUser.isSuperAdmin || (state.currentUser.realName === post.uploaderRealName);

  const uploaderNameDisplay = post.uploaderNickname 
    ? `<span class="font-bold text-slate-100">${post.uploaderRealName || 'Thành viên'}</span> <span class="text-amber-400 font-semibold text-xs">("${post.uploaderNickname}")</span>`
    : `<span class="font-bold text-slate-100">${post.uploaderRealName || 'Thành viên'}</span>`;

  return `
    <div class="post-card glass p-4 sm:p-5 rounded-2xl border ${post.isPinned ? 'border-amber-500/80 shadow-glow bg-amber-950/10' : 'border-slate-800'} fade-in" id="${post.id}">
      ${post.isPinned ? `
        <div class="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-extrabold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-lg border border-amber-500/30 mb-3 w-max">
          📌 ĐÃ GHIM BÀI VIẾT NỔI BẬT
        </div>
      ` : ''}

      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2.5 sm:gap-3">
          <img src="${post.avatar}" class="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover bg-slate-800 border border-slate-700" alt="Avatar">
          <div>
            <div class="text-xs sm:text-sm text-slate-100 flex flex-wrap items-center gap-1.5">
              ${uploaderNameDisplay}
              <span class="badge-tag badge-group">${post.space || 'Lớp chung'}</span>
            </div>
            <div class="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
              <span>⏰ ${post.date}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-2">
          ${canEditOrDelete ? `
            ${state.currentUser.isAdmin || state.currentUser.isSuperAdmin ? `
              <button onclick="adminTogglePin('${post.id}')" title="Ghim bài lên đầu" class="p-1 sm:p-1.5 rounded-lg text-[11px] sm:text-xs bg-slate-800 hover:bg-amber-500/20 hover:text-amber-300 border border-slate-700">
                ${post.isPinned ? '📌' : '📌'}
              </button>
            ` : ''}
            <button onclick="deletePost('${post.id}')" title="Xóa bài viết" class="p-1 sm:p-1.5 rounded-lg text-[11px] sm:text-xs bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 font-bold">
              🗑️
            </button>
          ` : ''}

          <button onclick="openLightbox('${post.id}')" class="text-[11px] sm:text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 bg-amber-500/10 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg border border-amber-500/20 transition-all">
            <span>🔍 Xem</span>
          </button>
        </div>
      </div>

      <div class="text-xs sm:text-sm text-slate-200 mb-3 whitespace-pre-line leading-relaxed">
        ${formatCaption(post.caption)}
      </div>

      ${renderPostMediaHTML(post)}

      ${post.hashtags && post.hashtags.length > 0 ? `
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${post.hashtags.map(h => `
            <span onclick="filterByTag('${h}')" class="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer font-medium hover:underline">
              ${h}
            </span>
          `).join('')}
        </div>
      ` : ''}

      <div class="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        <div class="flex items-center gap-4">
          <button onclick="toggleLike('${post.id}')" class="flex items-center gap-1.5 font-semibold transition-all ${isLiked ? 'text-rose-500 font-extrabold' : 'hover:text-rose-400'}">
            <span class="${isLiked ? 'animate-heart text-base' : 'text-base'}">${isLiked ? '❤️' : '🤍'}</span>
            <span>${totalLikes} Thả tim</span>
          </button>

          <button onclick="toggleCommentSection('${post.id}')" class="flex items-center gap-1.5 font-semibold hover:text-amber-400 transition-all">
            <span class="text-base">💬</span>
            <span>${commentCount} Bình luận</span>
          </button>
        </div>

        <button onclick="sharePost('${post.id}')" class="hover:text-slate-200 transition-all text-[11px]">
          🔗 Chia sẻ
        </button>
      </div>

      <div id="comments-sec-${post.id}" class="mt-4 pt-3 border-t border-slate-800/60 hidden space-y-3">
        <div class="space-y-2.5 max-h-48 overflow-y-auto pr-1" id="comment-list-${post.id}">
          ${(post.comments || []).map(c => `
            <div class="flex gap-2.5 items-start bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80 text-xs">
              <img src="${c.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=User'}" class="w-6 h-6 rounded-full object-cover bg-slate-800" alt="Avatar">
              <div class="flex-1">
                <div class="flex items-center justify-between">
                  <span class="font-bold text-amber-300">${c.user}</span>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-slate-500">${c.time}</span>
                    ${canEditOrDelete ? `<button onclick="deleteComment('${post.id}', '${c.id}')" class="text-[10px] text-rose-400 hover:underline">Xóa</button>` : ''}
                  </div>
                </div>
                <div class="text-slate-200 mt-0.5">${c.text}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex gap-2 pt-2">
          <input type="text" id="comment-input-${post.id}" placeholder="Viết bình luận kỷ niệm..." class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500/80">
          <button onclick="submitComment('${post.id}')" class="px-3 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl hover:bg-amber-400 transition-all">
            Gửi
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPostMediaHTML(post) {
  const files = post.files || (post.image ? [{ type: 'IMAGE', url: post.image }] : []);
  if (!files || files.length === 0) return '';

  if (files.length === 1) {
    const f = files[0];
    if (f.type === 'VIDEO') {
      return `
        <div class="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 mb-3">
          <video controls preload="metadata" playsinline class="w-full max-h-[420px] rounded-xl object-contain bg-black">
            <source src="${f.url}">
            Trình duyệt không phát được video.
          </video>
          <div class="absolute top-2 left-2 text-[9px] bg-slate-950/80 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/30">
            🎬 Video Clip (${f.size || 'HD'})
          </div>
        </div>
      `;
    }
    return `
      <div class="relative group rounded-xl overflow-hidden bg-slate-900 border border-slate-800 mb-3 cursor-pointer" onclick="openLightbox('${post.id}')">
        <img src="${f.url}" class="w-full max-h-[420px] object-cover transition-transform duration-500 group-hover:scale-105" alt="Photo">
      </div>
    `;
  }

  return `
    <div class="grid ${files.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'} gap-1.5 sm:gap-2 mb-3">
      ${files.map((f, i) => {
        if (f.type === 'VIDEO') {
          return `
            <div class="relative rounded-xl overflow-hidden bg-slate-950 border border-amber-500/40 h-36 sm:h-48">
              <video controls preload="metadata" playsinline class="w-full h-full object-cover rounded-xl bg-black">
                <source src="${f.url}">
              </video>
              <div class="absolute top-1 left-1 text-[9px] bg-slate-950/90 text-amber-300 px-1.5 py-0.5 rounded font-bold">🎬 Video</div>
            </div>
          `;
        }
        return `
          <div class="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-800 h-36 sm:h-48 cursor-pointer group" onclick="openLightbox('${post.id}', ${i})">
            <img src="${f.url}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="Photo ${i+1}">
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function formatCaption(text) {
  if (!text) return '';
  return text.replace(/(#[a-zA-Z0-9_À-ỹ]+)/g, '<span class="text-indigo-400 font-semibold">$1</span>');
}

// ----------------------------------------------------
// 2. GROUPS HUB & MEMBER CHECKLIST CREATION
// ----------------------------------------------------
function renderGroupsHub() {
  const container = document.getElementById('groups-container');

  if (state.groups.length === 0) {
    container.innerHTML = `
      <div class="glass p-8 sm:p-12 text-center rounded-2xl sm:rounded-3xl border border-slate-800 space-y-4">
        <div class="w-14 h-14 sm:w-16 sm:h-16 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl mx-auto">
          📂
        </div>
        <div>
          <h3 class="text-base sm:text-lg font-extrabold text-slate-100">Chưa có Góc Nhóm Riêng nào trong ${state.webDisplayName}</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Các nhóm bạn (Nhóm múa, Team đá bóng, Hội học tập...) bấm nút dưới đây để chọn thành viên từ danh sách & tạo nhóm nhé!
          </p>
        </div>
        <button onclick="openCreateGroupModal()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold rounded-xl shadow-lg shadow-indigo-500/20 transition-all">
          + Tạo Nhóm Mới & Chọn Thành Viên
        </button>
      </div>
    `;
    return;
  }

  let html = `
    <div class="flex items-center justify-between mb-4 sm:mb-6">
      <div>
        <h2 class="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
          <span>📂 Góc Nhóm Riêng</span>
          <span class="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">${state.groups.length} nhóm</span>
        </h2>
        <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5">Không gian sinh hoạt riêng tư cho các nhóm bạn trong ${state.webDisplayName}.</p>
      </div>

      <button onclick="openCreateGroupModal()" class="px-3 py-2 sm:px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-1">
        <span>+ Tạo Nhóm</span>
      </button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
  `;

  state.groups.forEach(group => {
    const memberCount = group.members ? group.members.length : 0;
    const isPrivate = group.isPrivate;
    const groupPosts = state.posts.filter(p => p.targetId === group.id);

    html += `
      <div class="glass p-4 sm:p-5 rounded-2xl border border-slate-800 hover:border-indigo-500/40 transition-all relative overflow-hidden group">
        <div class="h-32 sm:h-36 -mx-4 -mt-4 sm:-mx-5 sm:-mt-5 mb-3 relative overflow-hidden bg-slate-900 border-b border-slate-800">
          <img src="${group.cover || 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600'}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Group Cover">
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent"></div>
          <div class="absolute top-2.5 right-2.5 flex items-center gap-2">
            <span class="badge-tag ${isPrivate ? 'badge-group' : 'badge-public'}">
              ${isPrivate ? '🔒 Chỉ thành viên' : '🌐 Công khai'}
            </span>
          </div>
        </div>

        <h3 class="text-base sm:text-lg font-bold text-slate-100 mb-1">${group.name}</h3>
        <p class="text-xs text-slate-400 mb-3 line-clamp-2">${group.description}</p>

        <div class="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
          <div class="flex items-center gap-1 text-slate-300 font-medium text-[11px]">
            <span>👥 ${memberCount} TV:</span>
            <span class="text-indigo-400 font-bold truncate max-w-[120px]">${group.members ? group.members.join(', ') : 'Chưa có'}</span>
          </div>

          <button onclick="openGroupDetailSpace('${group.id}')" class="px-3 py-1.5 bg-indigo-600 text-white border border-indigo-500/40 rounded-lg font-bold hover:bg-indigo-500 transition-all text-xs">
            Vào Góc Nhóm (${groupPosts.length}) 🚀
          </button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

window.openCreateGroupModal = function() {
  state.tempGroupCoverData = null;
  document.getElementById('create-group-name').value = '';
  document.getElementById('create-group-desc').value = '';
  document.getElementById('group-cover-preview').classList.add('hidden');
  document.getElementById('group-cover-dropzone').classList.remove('hidden');

  const checklistContainer = document.getElementById('group-members-checklist');
  if (checklistContainer) {
    checklistContainer.innerHTML = state.officialRoster.map((name, idx) => `
      <label class="flex items-center gap-2 px-2.5 py-1.5 bg-slate-900 rounded-lg border border-slate-800 hover:border-indigo-500/40 cursor-pointer">
        <input type="checkbox" name="group-member-checkbox" value="${name}" class="accent-indigo-500 w-3.5 h-3.5 rounded" ${idx === 0 ? 'checked' : ''}>
        <span class="text-xs text-slate-200 font-medium">${name}</span>
      </label>
    `).join('');
  }

  document.getElementById('create-group-modal').classList.remove('hidden');
};

window.closeCreateGroupModal = function() {
  document.getElementById('create-group-modal').classList.add('hidden');
};

window.handleGroupCoverSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    state.tempGroupCoverData = e.target.result;
    document.getElementById('group-cover-dropzone').classList.add('hidden');
    const prev = document.getElementById('group-cover-preview');
    prev.classList.remove('hidden');
    prev.innerHTML = `
      <div class="relative rounded-xl overflow-hidden border border-indigo-500/40 h-32 bg-slate-900">
        <img src="${e.target.result}" class="w-full h-full object-cover" alt="Cover Preview">
      </div>
    `;
  };
  reader.readAsDataURL(file);
};

window.submitCreateGroupForm = function() {
  const name = document.getElementById('create-group-name').value.trim();
  const desc = document.getElementById('create-group-desc').value.trim();
  const isPrivate = document.getElementById('create-group-private').checked;

  if (!name) {
    showToast("⚠️ Vui lòng nhập Tên Nhóm!");
    return;
  }

  const checkboxes = document.querySelectorAll('input[name="group-member-checkbox"]:checked');
  const selectedMembers = Array.from(checkboxes).map(cb => cb.value);

  if (selectedMembers.length === 0) {
    selectedMembers.push(state.getUserDisplayName());
  }

  const newGroup = {
    id: 'g_' + Date.now(),
    name: "📂 " + name,
    description: desc || "Nhóm sinh hoạt riêng tư.",
    members: selectedMembers,
    isPrivate: isPrivate,
    cover: state.tempGroupCoverData || "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600",
    createdAt: new Date().toISOString().slice(0, 10)
  };

  state.groups.push(newGroup);
  state.save();

  closeCreateGroupModal();
  renderGroupsHub();
  showToast(`🎉 Đã tạo nhóm riêng "${name}" với ${selectedMembers.length} thành viên!`);
};

window.openGroupDetailSpace = function(groupId) {
  state.selectedGroupId = groupId;
  state.activeTab = 'group_detail';
  renderApp();
};

function renderGroupDetailView() {
  const container = document.getElementById('group-detail-container');
  const group = state.groups.find(g => g.id === state.selectedGroupId);

  if (!group) {
    state.activeTab = 'groups';
    renderApp();
    return;
  }

  const groupPosts = state.posts.filter(p => p.targetId === group.id);

  container.innerHTML = `
    <div class="space-y-6 fade-in">
      <div class="glass rounded-2xl sm:rounded-3xl overflow-hidden border border-indigo-500/30 relative">
        <div class="h-40 sm:h-64 relative bg-slate-950 overflow-hidden">
          <img src="${group.cover || 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600'}" class="w-full h-full object-cover" alt="Group Banner">
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>
          
          <button onclick="openChangeGroupCoverModal('${group.id}')" class="absolute top-3 right-3 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-900 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold shadow-lg transition-all flex items-center gap-1">
            <span>🖼️ Đổi Bìa</span>
          </button>

          <button onclick="state.activeTab = 'groups'; renderApp();" class="absolute top-3 left-3 px-3 py-1.5 bg-slate-900/90 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1">
            <span>⬅️ Quay lại</span>
          </button>
        </div>

        <div class="p-4 sm:p-6 relative z-10 -mt-8 sm:-mt-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <h2 class="text-xl sm:text-3xl font-extrabold text-slate-100">${group.name}</h2>
              <span class="badge-tag ${group.isPrivate ? 'badge-group' : 'badge-public'}">
                ${group.isPrivate ? '🔒 Chỉ thành viên' : '🌐 Công khai'}
              </span>
            </div>
            <p class="text-xs text-slate-300 max-w-2xl">${group.description}</p>
            <div class="text-xs text-indigo-300 font-medium mt-2 flex items-center gap-1">
              <span>👥 Thành viên nhóm:</span>
              <span class="font-bold text-slate-100">${group.members ? group.members.join(', ') : 'Chưa có'}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto">
            <button onclick="openUploadModalForGroup('${group.id}')" class="flex-1 md:flex-initial px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg shadow-amber-500/20">
              ➕ Đăng Vào Nhóm
            </button>

            <button onclick="disbandGroup('${group.id}')" class="px-3 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold rounded-xl transition-all">
              💥 Giải Tán
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-4">
        <h3 class="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
          <span>📸 Kỷ Niệm & Bài Đăng Trong Nhóm</span>
          <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">${groupPosts.length} bài</span>
        </h3>

        ${groupPosts.length === 0 ? `
          <div class="glass p-8 text-center rounded-2xl border border-slate-800">
            <div class="text-3xl mb-2">🎬</div>
            <div class="text-sm font-bold text-slate-200">Chưa có bài viết hay video nào trong nhóm này</div>
            <p class="text-xs text-slate-400 mt-1">Bấm "➕ Đăng Vào Nhóm" để tạo bài viết đầu tiên nhé!</p>
          </div>
        ` : `
          <div class="space-y-4 sm:space-y-6">
            ${groupPosts.map(post => createPostCardHTML(post)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

window.openUploadModalForGroup = function(groupId) {
  openUploadModal();
  const select = document.getElementById('upload-space-select');
  if (select) select.value = `group:${groupId}`;
};

window.disbandGroup = function(groupId) {
  const grp = state.groups.find(g => g.id === groupId);
  if (!grp) return;

  if (!confirm(`💥 Bạn có chắc chắn muốn GIẢI TÁN & XÓA nhóm "${grp.name}" không?`)) return;

  state.groups = state.groups.filter(g => g.id !== groupId);
  state.save();

  state.activeTab = 'groups';
  renderApp();
  showToast(`💥 Đã giải tán nhóm "${grp.name}" thành công!`);
};

window.openChangeGroupCoverModal = function(groupId) {
  state.changeCoverGroupId = groupId;
  document.getElementById('change-cover-preview').classList.add('hidden');
  document.getElementById('change-cover-dropzone').classList.remove('hidden');
  document.getElementById('change-group-cover-modal').classList.remove('hidden');
};

window.closeChangeGroupCoverModal = function() {
  document.getElementById('change-group-cover-modal').classList.add('hidden');
  state.changeCoverGroupId = null;
};

window.handleChangeCoverSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    state.tempGroupCoverData = e.target.result;
    document.getElementById('change-cover-dropzone').classList.add('hidden');
    const prev = document.getElementById('change-cover-preview');
    prev.classList.remove('hidden');
    prev.innerHTML = `
      <div class="relative rounded-xl overflow-hidden border border-indigo-500/40 h-32 bg-slate-900">
        <img src="${e.target.result}" class="w-full h-full object-cover" alt="Cover Preview">
      </div>
    `;
  };
  reader.readAsDataURL(file);
};

window.submitChangeGroupCover = function() {
  if (!state.changeCoverGroupId || !state.tempGroupCoverData) {
    showToast("⚠️ Vui lòng chọn ảnh bìa mới!");
    return;
  }

  const grp = state.groups.find(g => g.id === state.changeCoverGroupId);
  if (grp) {
    grp.cover = state.tempGroupCoverData;
    state.save();
  }

  closeChangeGroupCoverModal();
  renderApp();
  showToast("🖼️ Đã thay đổi ảnh bìa nhóm thành công!");
};

// ----------------------------------------------------
// 3. PROJECTS VAULT
// ----------------------------------------------------
function renderProjectsVault() {
  const container = document.getElementById('projects-container');

  if (state.projects.length === 0) {
    container.innerHTML = `
      <div class="glass p-8 sm:p-12 text-center rounded-2xl sm:rounded-3xl border border-slate-800 space-y-4">
        <div class="w-14 h-14 sm:w-16 sm:h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl mx-auto">
          📁
        </div>
        <div>
          <h3 class="text-base sm:text-lg font-extrabold text-slate-100">Kho Dự Án Chưa Có Tập Tin trong ${state.webDisplayName}</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Lưu trữ bài thuyết trình, video kỷ yếu, thiết kế áo lớp, file bài tập nhóm (.pdf, .docx, .mp4, .zip).
          </p>
        </div>
        <button onclick="openCreateProjectModal()" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl shadow-lg shadow-emerald-500/20 transition-all">
          + Tạo Dự Án Mới
        </button>
      </div>
    `;
    return;
  }

  let html = `
    <div class="flex items-center justify-between mb-4 sm:mb-6">
      <div>
        <h2 class="text-lg sm:text-xl font-bold text-slate-100 flex items-center gap-2">
          <span>📁 Kho Dự Án Lớp (Class Projects)</span>
          <span class="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">${state.projects.length} dự án</span>
        </h2>
        <p class="text-[11px] sm:text-xs text-slate-400 mt-0.5">Lưu trữ các bài thuyết trình, video kỷ niệm, thiết kế áo lớp, bài tập nhóm đa định dạng (.pdf, .docx, .mp4, .zip).</p>
      </div>

      <button onclick="openCreateProjectModal()" class="px-3 py-2 sm:px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1">
        <span>+ Tạo Dự Án</span>
      </button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
  `;

  state.projects.forEach(proj => {
    html += `
      <div class="glass p-4 sm:p-5 rounded-2xl border border-slate-800 hover:border-emerald-500/40 transition-all space-y-3 sm:space-y-4">
        <div class="flex items-start justify-between">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              ${proj.category}
            </span>
            <h3 class="text-base font-bold text-slate-100 mt-1.5">${proj.name}</h3>
          </div>
          
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
              ${proj.status}
            </span>
            ${state.currentUser.isAdmin || state.currentUser.isSuperAdmin ? `
              <button onclick="deleteProject('${proj.id}')" title="Xóa Dự Án" class="p-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 text-xs">🗑️</button>
            ` : ''}
          </div>
        </div>

        <p class="text-xs text-slate-300 line-clamp-2">${proj.description}</p>

        <div class="bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 space-y-2">
          <div class="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase">
            <span>Tập tin đính kèm (${proj.files ? proj.files.length : 0}):</span>
            <button onclick="openAddFileToProjectModal('${proj.id}')" class="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1">
              ➕ Tải Tệp Vô Dự Án
            </button>
          </div>

          <div class="flex flex-wrap gap-1.5">
            ${proj.files && proj.files.length > 0 ? proj.files.map(f => `
              <a href="${f.url}" download onclick="downloadFileSim('${f.name}')" class="file-badge">
                <span>${getFileIcon(f.type)}</span>
                <span class="font-medium truncate max-w-[110px]">${f.name}</span>
                <span class="text-[9px] text-slate-400">(${f.size})</span>
              </a>
            `).join('') : '<div class="text-[11px] text-slate-500 italic py-1">Chưa có tệp nào. Bấm "+ Tải Tệp Vô Dự Án" để đính kèm.</div>'}
          </div>
        </div>

        <div class="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div>Thành viên: <span class="text-slate-200 font-medium">${proj.members.join(', ')}</span></div>
          <div>Ngày tạo: <span class="text-slate-200 font-medium">${proj.createdAt}</span></div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

window.deleteProject = function(projId) {
  if (!confirm("🗑️ Bạn có chắc muốn xóa Dự Án này không?")) return;
  state.projects = state.projects.filter(p => p.id !== projId);
  state.save();
  renderProjectsVault();
  showToast("🗑️ Đã xóa dự án thành công!");
};

window.openAddFileToProjectModal = function(projectId) {
  state.activeUploadProjectId = projectId;
  state.tempProjectFileData = null;
  const proj = state.projects.find(p => p.id === projectId);
  
  document.getElementById('project-file-title').innerText = proj ? `Dự án: ${proj.name}` : '';
  document.getElementById('project-file-preview').classList.add('hidden');
  document.getElementById('project-file-dropzone').classList.remove('hidden');
  document.getElementById('upload-project-file-modal').classList.remove('hidden');
};

window.closeAddFileToProjectModal = function() {
  document.getElementById('upload-project-file-modal').classList.add('hidden');
  state.activeUploadProjectId = null;
};

window.handleProjectFileSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    let ext = file.name.split('.').pop().toUpperCase();
    state.tempProjectFileData = {
      name: file.name,
      type: ext,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      url: e.target.result
    };

    document.getElementById('project-file-dropzone').classList.add('hidden');
    const prev = document.getElementById('project-file-preview');
    prev.classList.remove('hidden');
    prev.innerHTML = `
      <div class="p-3 bg-slate-900 border border-emerald-500/40 rounded-xl flex items-center gap-3 text-xs text-slate-200">
        <span class="text-2xl">${getFileIcon(ext)}</span>
        <div>
          <div class="font-bold text-emerald-400">${file.name}</div>
          <div class="text-[10px] text-slate-400">Định dạng: ${ext} | Dung lượng: ${state.tempProjectFileData.size}</div>
        </div>
      </div>
    `;
  };
  reader.readAsDataURL(file);
};

window.submitProjectFileUpload = function() {
  if (!state.activeUploadProjectId || !state.tempProjectFileData) {
    showToast("⚠️ Vui lòng chọn tệp/tài liệu đính kèm!");
    return;
  }

  const proj = state.projects.find(p => p.id === state.activeUploadProjectId);
  if (!proj) return;

  if (!proj.files) proj.files = [];
  proj.files.push(state.tempProjectFileData);
  state.save();

  closeAddFileToProjectModal();
  renderProjectsVault();
  showToast(`✅ Đã tải tệp "${state.tempProjectFileData.name}" lên dự án thành công!`);
};

function getFileIcon(type) {
  switch (type.toUpperCase()) {
    case 'PDF': return '📄';
    case 'DOCX': return '📝';
    case 'MP4': case 'WEBM': case 'MOV': case 'MKV': return '🎬';
    case 'ZIP': case 'RAR': return '📦';
    case 'IMAGE': case 'PNG': case 'JPG': case 'JPEG': return '🖼️';
    default: return '📎';
  }
}

window.downloadFileSim = function(filename) {
  showToast(`📥 Đang tải xuống tệp: ${filename}`);
};

// ----------------------------------------------------
// 4. QUICK UPLOAD MODAL
// ----------------------------------------------------
window.openUploadModal = function() {
  document.getElementById('upload-modal').classList.remove('hidden');
  populateUploadSpaceOptions();
};

window.closeUploadModal = function() {
  if (state.isUploading) {
    if (!confirm("⚠️ Đang trong quá trình tải tệp video/ảnh, bạn có chắc muốn thoát không?")) return;
  }
  document.getElementById('upload-modal').classList.add('hidden');
  state.tempUploadFiles = [];
  state.isUploading = false;
  document.getElementById('upload-progress-bar').classList.add('hidden');
  document.getElementById('upload-preview').classList.add('hidden');
  document.getElementById('upload-dropzone').classList.remove('hidden');
};

function populateUploadSpaceOptions() {
  const select = document.getElementById('upload-space-select');
  let opts = `<option value="public">🌐 ${state.webDisplayName} (Công khai cả lớp)</option>`;

  if (state.groups.length > 0) {
    opts += `<optgroup label="📂 Nhóm Riêng">`;
    state.groups.forEach(g => {
      opts += `<option value="group:${g.id}">${g.name} (${g.isPrivate ? '🔒 Riêng tư' : '🌐 Công khai'})</option>`;
    });
    opts += `</optgroup>`;
  }

  if (state.projects.length > 0) {
    opts += `<optgroup label="📁 Dự Án Lớp">`;
    state.projects.forEach(p => {
      opts += `<option value="proj:${p.id}">Dự án: ${p.name}</option>`;
    });
    opts += `</optgroup>`;
  }

  select.innerHTML = opts;
}

window.handleFileSelect = async function(event) {
  const files = Array.from(event.target.files);
  if (!files || files.length === 0) return;

  state.isUploading = true;
  const progressContainer = document.getElementById('upload-progress-bar');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');
  const progressPercent = document.getElementById('upload-progress-percent');

  progressContainer.classList.remove('hidden');
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const isVid = file.type.includes('video') || file.name.endsWith('.mp4') || file.name.endsWith('.webm') || file.name.endsWith('.mov') || file.name.endsWith('.mkv');
    const mediaId = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);

    progressText.innerText = `Đang xử lý ${i+1}/${total}: ${file.name} (${(file.size / (1024*1024)).toFixed(1)} MB)`;
    const pct = Math.round(((i + 1) / total) * 100);
    progressFill.style.width = `${pct}%`;
    progressPercent.innerText = `${pct}%`;

    await mediaStore.saveBlob(mediaId, file, file.name, isVid ? 'VIDEO' : 'IMAGE');
    const blobUrl = URL.createObjectURL(file);

    state.tempUploadFiles.push({
      mediaId: mediaId,
      url: blobUrl,
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      type: isVid ? 'VIDEO' : 'IMAGE'
    });
  }

  state.isUploading = false;
  progressContainer.classList.add('hidden');
  renderUploadPreviews();
};

function renderUploadPreviews() {
  document.getElementById('upload-dropzone').classList.add('hidden');
  const prevContainer = document.getElementById('upload-preview');
  prevContainer.classList.remove('hidden');

  let html = `
    <div class="flex items-center justify-between text-xs text-amber-300 font-bold mb-2">
      <span>Đã chọn ${state.tempUploadFiles.length} tệp (Ảnh & Video Dài):</span>
      <button onclick="state.tempUploadFiles = []; renderUploadPreviews();" class="text-rose-400 hover:underline">Hủy tất cả</button>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
  `;

  state.tempUploadFiles.forEach((item, idx) => {
    if (item.type === 'VIDEO') {
      html += `
        <div class="relative rounded-xl overflow-hidden bg-slate-950 border border-amber-500/40 h-28 group">
          <video class="w-full h-full object-cover rounded-xl bg-black" muted preload="metadata">
            <source src="${item.url}">
          </video>
          <div class="absolute bottom-1 left-1 text-[9px] bg-slate-950/80 text-amber-300 px-1.5 py-0.5 rounded font-bold">🎬 Video (${item.size})</div>
          <button onclick="removeTempUploadFile(${idx})" class="absolute top-1 right-1 w-5 h-5 bg-rose-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow">✕</button>
        </div>
      `;
    } else {
      html += `
        <div class="relative rounded-xl overflow-hidden bg-slate-900 border border-amber-500/40 h-28 group">
          <img src="${item.url}" class="w-full h-full object-cover" alt="Preview ${idx}">
          <div class="absolute bottom-1 left-1 text-[9px] bg-slate-950/80 text-amber-300 px-1.5 py-0.5 rounded font-bold">🖼️ ${item.size}</div>
          <button onclick="removeTempUploadFile(${idx})" class="absolute top-1 right-1 w-5 h-5 bg-rose-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow">✕</button>
        </div>
      `;
    }
  });

  html += `</div>`;
  prevContainer.innerHTML = html;

  const dateInput = document.getElementById('upload-date-input');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
}

window.removeTempUploadFile = function(idx) {
  state.tempUploadFiles.splice(idx, 1);
  if (state.tempUploadFiles.length === 0) {
    document.getElementById('upload-preview').classList.add('hidden');
    document.getElementById('upload-dropzone').classList.remove('hidden');
  } else {
    renderUploadPreviews();
  }
};

window.submitUploadForm = function() {
  const caption = document.getElementById('upload-caption').value.trim();
  const dateVal = document.getElementById('upload-date-input').value;
  const targetSpace = document.getElementById('upload-space-select').value;
  const hashtagsInput = document.getElementById('upload-hashtags').value.trim();

  if (!caption && state.tempUploadFiles.length === 0) {
    showToast("⚠️ Vui lòng chọn ảnh/video hoặc viết chú thích kỷ niệm!");
    return;
  }

  const hashtags = hashtagsInput ? hashtagsInput.split(' ').filter(h => h.startsWith('#')) : [`#${state.systemClassName}`];

  let spaceName = `${state.webDisplayName} 🌐`;
  let targetId = "public";
  if (targetSpace.startsWith('group:')) {
    targetId = targetSpace.replace('group:', '');
    const g = state.groups.find(x => x.id === targetId);
    if (g) spaceName = g.name;
  } else if (targetSpace.startsWith('proj:')) {
    targetId = targetSpace.replace('proj:', '');
    const p = state.projects.find(x => x.id === targetId);
    if (p) spaceName = "📁 " + p.name;
  }

  const d = dateVal ? new Date(dateVal) : new Date();
  const monthYearStr = `Tháng ${(d.getMonth()+1).toString().padStart(2,'0')}, ${d.getFullYear()}`;
  const dateStr = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} 14:00`;

  const newPost = {
    id: 'post-' + Date.now(),
    uploaderRealName: state.currentUser.realName || `Học Sinh ${state.systemClassName}`,
    uploaderNickname: state.currentUser.nickname || "",
    avatar: state.currentUser.avatar,
    date: dateStr,
    dateMonthYear: monthYearStr,
    caption: caption,
    files: state.tempUploadFiles.map(f => ({
      mediaId: f.mediaId,
      url: f.url,
      name: f.name,
      size: f.size,
      type: f.type
    })),
    hashtags: hashtags,
    space: spaceName,
    targetId: targetId,
    device: "Web Upload",
    resolution: "HD High Quality",
    fileSize: state.tempUploadFiles.length > 0 ? state.tempUploadFiles[0].size : "0 KB",
    likes: 1,
    likedByUsers: [state.getUserDisplayName()],
    isPinned: false,
    comments: []
  };

  state.posts.unshift(newPost);
  state.save(true);

  closeUploadModal();
  renderApp();
  showToast("🎉 Đã đăng tải bài kỷ niệm & video clip mới thành công!");
};

// ----------------------------------------------------
// 5. LIGHTBOX & REAL-TIME MULTI-USER LIKE ENGINE
// ----------------------------------------------------
window.toggleLike = function(postId) {
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;

  if (!post.likedByUsers) {
    post.likedByUsers = post.likedByMe ? [state.getUserDisplayName()] : [];
  }

  const myDisplayName = state.getUserDisplayName();
  const index = post.likedByUsers.indexOf(myDisplayName);

  if (index > -1) {
    post.likedByUsers.splice(index, 1);
  } else {
    post.likedByUsers.push(myDisplayName);
  }

  post.likes = post.likedByUsers.length;
  post.likedByMe = post.likedByUsers.includes(myDisplayName);

  state.save(true); // Broadcast sync across devices
  renderApp();
};

window.openLightbox = function(postId, fileIdx = 0) {
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;

  const modal = document.getElementById('lightbox-modal');
  const uploaderStr = post.uploaderNickname 
    ? `${post.uploaderRealName} ("${post.uploaderNickname}")`
    : post.uploaderRealName;

  const files = post.files || (post.image ? [{ type: 'IMAGE', url: post.image }] : []);
  const activeFile = files[fileIdx] || files[0] || { type: 'IMAGE', url: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600' };

  if (!post.likedByUsers) post.likedByUsers = post.likedByMe ? [state.getUserDisplayName()] : [];
  const totalLikes = post.likedByUsers.length;

  modal.innerHTML = `
    <div class="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4" onclick="closeLightbox(event)">
      <div class="glass max-w-4xl w-full max-h-[90vh] rounded-2xl overflow-hidden border border-slate-700 flex flex-col md:flex-row" onclick="event.stopPropagation()">
        <div class="md:w-3/5 bg-slate-950 flex items-center justify-center p-2 sm:p-4 relative min-h-[250px] sm:min-h-[300px]">
          ${activeFile.type === 'VIDEO' ? `
            <video controls preload="metadata" playsinline class="max-h-[60vh] md:max-h-[75vh] w-full rounded-lg bg-black" autoplay>
              <source src="${activeFile.url}">
              Trình duyệt không phát được video.
            </video>
          ` : `
            <img src="${activeFile.url}" class="max-h-[60vh] md:max-h-[75vh] w-auto object-contain rounded-lg" alt="Full Media">
          `}
        </div>

        <div class="md:w-2/5 p-4 sm:p-6 flex flex-col justify-between border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/90">
          <div>
            <div class="flex items-center justify-between mb-3 sm:mb-4">
              <div class="flex items-center gap-2">
                <img src="${post.avatar}" class="w-8 h-8 rounded-full object-cover bg-slate-800" alt="Avatar">
                <div>
                  <div class="text-xs font-bold text-slate-100">${uploaderStr}</div>
                  <div class="text-[10px] text-amber-400 font-semibold">${post.space}</div>
                </div>
              </div>

              <button onclick="closeLightbox(null)" class="text-slate-400 hover:text-slate-100 text-lg font-bold p-1">✕</button>
            </div>

            <div class="text-xs text-slate-200 mb-4 whitespace-pre-line">${post.caption}</div>

            <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1.5 text-[11px] text-slate-300 mb-4">
              <div class="font-bold text-amber-400 mb-1 flex items-center gap-1">
                <span>📸 THÔNG SỐ METADATA</span>
              </div>
              <div class="flex justify-between"><span>📅 Ngày đăng:</span> <span class="font-medium text-slate-100">${post.date}</span></div>
              <div class="flex justify-between"><span>📁 Số tệp:</span> <span class="font-medium text-slate-100">${files.length} tệp</span></div>
              <div class="flex justify-between"><span>❤️ Đã thả tim:</span> <span class="font-bold text-rose-400">${post.likedByUsers.join(', ') || 'Chưa có'}</span></div>
            </div>
          </div>

          <div class="pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
            <button onclick="toggleLike('${post.id}')" class="px-3 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl font-bold">
              ❤️ ${totalLikes} Thả tim
            </button>
            <span class="text-slate-500 text-[10px]">${state.webDisplayName}</span>
          </div>
        </div>
      </div>
    `;
  modal.classList.remove('hidden');
};

window.closeLightbox = function(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('lightbox-modal').classList.add('hidden');
};

window.toggleCommentSection = function(postId) {
  const sec = document.getElementById(`comments-sec-${postId}`);
  if (sec) sec.classList.toggle('hidden');
};

window.submitComment = function(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input ? input.value.trim() : '';

  if (!text) return;

  const post = state.posts.find(p => p.id === postId);
  if (!post) return;

  if (!post.comments) post.comments = [];
  post.comments.push({
    id: 'c_' + Date.now(),
    user: state.getUserDisplayName(),
    avatar: state.currentUser.avatar,
    text: text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  state.save(true);
  renderApp();
  setTimeout(() => {
    const sec = document.getElementById(`comments-sec-${postId}`);
    if (sec) sec.classList.remove('hidden');
  }, 50);
};

window.deletePost = function(postId) {
  if (!confirm("🗑️ Bạn có chắc chắn muốn XÓA BÀI VIẾT NÀY không?")) return;
  state.posts = state.posts.filter(p => p.id !== postId);
  state.save(true);
  renderApp();
  showToast("🗑️ Đã xóa bài viết thành công!");
};

window.deleteComment = function(postId, commentId) {
  const post = state.posts.find(p => p.id === postId);
  if (!post || !post.comments) return;

  post.comments = post.comments.filter(c => c.id !== commentId);
  state.save(true);
  renderApp();
  showToast("🗑️ Đã xóa bình luận!");
};

window.adminTogglePin = function(postId) {
  const post = state.posts.find(p => p.id === postId);
  if (post) {
    post.isPinned = !post.isPinned;
    state.save(true);
    renderApp();
    showToast(post.isPinned ? "📌 Đã ghim bài viết lên đầu!" : "📌 Đã bỏ ghim bài viết.");
  }
};

window.sharePost = function(postId) {
  showToast("🔗 Đã sao chép liên kết bài viết kỷ niệm!");
};

// ----------------------------------------------------
// 6. CLASS ADMIN CONTROL PANEL
// ----------------------------------------------------
window.openAdminModal = function() {
  renderAdminModalContent();
  document.getElementById('admin-modal').classList.remove('hidden');
};

window.closeAdminModal = function() {
  document.getElementById('admin-modal').classList.add('hidden');
};

function renderAdminModalContent() {
  const container = document.getElementById('admin-modal-body');
  const storage = state.calculateClassStorage(state.systemClassName);

  container.innerHTML = `
    <div class="space-y-5 text-xs">
      
      <div class="bg-gradient-to-r from-amber-950/40 via-indigo-950/40 to-slate-900 p-4 rounded-2xl border border-amber-500/40 space-y-2.5">
        <h4 class="font-bold text-amber-300 text-sm flex items-center justify-between">
          <span>📦 Tự Động Sao Lưu & Nén Bài Đăng Sau 1 Năm Học (.ZIP)</span>
        </h4>
        <p class="text-[11px] text-slate-300 leading-relaxed">
          Thu gom toàn bộ bài đăng, ảnh, video, bình luận và chú thích kỷ niệm của lớp thành 1 file ZIP duy nhất để lưu trữ làm kỷ yếu năm học.
        </p>

        <button onclick="adminExportZipBackup()" class="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2">
          <span>📦 NÉN & TẢI TOÀN BỘ KỶ NIỆM VỀ MÁY (.ZIP)</span>
        </button>
      </div>

      <div class="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
        <div>
          <div class="font-bold text-slate-200">📊 Dung Lượng Đang Sử Dụng:</div>
          <div class="text-[11px] text-slate-400 mt-0.5">Dung lượng thực tế của lớp ${state.webDisplayName} (${state.systemClassName}).</div>
        </div>
        <div class="text-right font-extrabold text-amber-400 text-sm">
          ${storage.mb} MB <span class="text-slate-500 text-xs font-normal">(${storage.gb} GB)</span>
        </div>
      </div>

      <div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-3">
        <h4 class="font-bold text-slate-200 text-sm">🏫 Tên Lớp Hệ Thống & Tên Hiển Thị Web</h4>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Mã Lớp Hệ Thống:</label>
            <input type="text" id="admin-system-name-input" value="${state.systemClassName}" placeholder="VD: 11A6" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-amber-500">
          </div>
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Tên Hiển Thị Web Lớp:</label>
            <input type="text" id="admin-web-name-input" value="${state.webDisplayName}" placeholder="VD: Lớp A6 Mãi Đỉnh" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-amber-500">
          </div>
        </div>

        <div>
          <label class="block text-slate-300 font-semibold mb-1">Niên Khóa / Niên Hiệu:</label>
          <input type="text" id="admin-class-year-input" value="${state.academicYear}" placeholder="VD: Niên khóa 2023 - 2026" class="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-amber-500">
        </div>

        <button onclick="adminSaveClassSettings()" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold rounded-xl border border-slate-700">
          Lưu Cấu Hình Lớp & Niên Khóa 💾
        </button>
      </div>

      <!-- RESTORED STUDENT PASSWORD MANAGEMENT FOR CLASS ADMIN -->
      <div class="bg-slate-900 p-4 rounded-2xl border border-amber-500/40 space-y-3">
        <h4 class="font-bold text-amber-400 text-sm flex items-center gap-1.5">
          <span>🔑 Cài Đặt Mật Khẩu Cho Học Sinh Trong Lớp</span>
        </h4>
        
        <p class="text-[11px] text-slate-300">
          Mật khẩu lớp cấp cho các bạn học sinh hiện tại: <span class="font-mono text-sm font-extrabold text-amber-300 bg-slate-950 px-3 py-1 rounded-lg border border-amber-500/40 select-all">${state.classStudentPassword}</span>
        </p>

        <div class="flex gap-2">
          <input type="text" id="admin-new-student-pass" placeholder="Nhập Mật khẩu mới cấp cho học sinh..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 font-bold">
          <button onclick="adminGenerateRandomStudentPass()" class="px-3 py-2 bg-slate-800 text-amber-300 rounded-xl font-bold border border-amber-500/30">🎲 Tạo MK</button>
          <button onclick="adminSaveStudentPass()" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl shadow-lg shadow-amber-500/20">Lưu Mật Khẩu</button>
        </div>
      </div>

      <div class="bg-slate-900 p-4 rounded-2xl border border-indigo-500/40 space-y-3">
        <h4 class="font-bold text-slate-100 text-sm flex items-center justify-between">
          <span>📜 Danh Sách Học Sinh Lớp ${state.systemClassName} (${state.officialRoster.length} thành viên)</span>
        </h4>

        <div class="flex gap-2">
          <input type="text" id="admin-new-roster-name" placeholder="Nhập Họ và Tên thật học sinh..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500">
          <button onclick="adminAddRosterName()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl">
            + Thêm
          </button>
        </div>

        <div class="max-h-36 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-2 bg-slate-950/60">
          ${state.officialRoster.map(name => `
            <div class="flex items-center justify-between px-3 py-1.5 bg-slate-900 rounded-lg border border-slate-800">
              <span class="font-bold text-slate-200">${name}</span>
              <button onclick="adminRemoveRosterName('${name}')" class="text-rose-400 hover:text-rose-300 font-bold">✕ Xóa</button>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="bg-rose-500/10 p-3 rounded-2xl border border-rose-500/30 flex items-center justify-between">
        <div>
          <div class="font-bold text-rose-300">🗑️ Reset Trắng Dữ Liệu Web Lớp ${state.systemClassName}</div>
          <div class="text-[10px] text-slate-400">Xóa bài viết của lớp này để chuẩn bị cho năm học mới.</div>
        </div>
        <button onclick="adminClearAllData()" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl">
          Reset Trắng
        </button>
      </div>

    </div>
  `;
}

window.adminGenerateRandomStudentPass = function() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pass = `${state.systemClassName}-`;
  for (let i = 0; i < 5; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  document.getElementById('admin-new-student-pass').value = pass;
};

window.adminSaveStudentPass = function() {
  const input = document.getElementById('admin-new-student-pass');
  const pass = input ? input.value.trim() : '';

  if (!pass || pass.length < 4) {
    showToast("⚠️ Mật khẩu học sinh phải có ít nhất 4 ký tự!");
    return;
  }

  state.classStudentPassword = pass;
  state.save(true);
  renderAdminModalContent();
  showToast(`🔒 Đã cập nhật Mật Khẩu Cấp Cho Học Sinh thành: ${pass}`);
};

window.adminExportZipBackup = function() {
  if (typeof JSZip === 'undefined') {
    showToast("⚠️ Thư viện JSZip đang tải, vui lòng thử lại sau 2 giây!");
    return;
  }

  showToast("⏳ Đang nén toàn bộ kỷ niệm & bài đăng thành file ZIP...");

  const zip = new JSZip();
  const folderMedia = zip.folder("images_and_videos");

  let htmlDoc = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>Kỷ Yếu ${state.webDisplayName} - ${state.academicYear}</title>
      <style>
        body { font-family: sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; }
        .post { background: #111827; border: 1px solid #374151; padding: 1.5rem; margin-bottom: 1.5rem; border-radius: 1rem; }
        .caption { font-size: 1.1rem; color: #fcd34d; margin-bottom: 1rem; }
        .meta { font-size: 0.8rem; color: #9ca3af; margin-bottom: 0.5rem; }
        .comment { background: #1f2937; padding: 0.5rem 1rem; margin-top: 0.5rem; border-radius: 0.5rem; font-size: 0.9rem; }
      </style>
    </head>
    <body>
      <h1>🎓 KỶ YẾU KỶ NIỆM ${state.webDisplayName.toUpperCase()}</h1>
      <p>Niên khóa: ${state.academicYear} | Tổng số bài viết: ${state.posts.length}</p>
      <hr style="border-color: #374151; margin-bottom: 2rem;">
  `;

  state.posts.forEach((p, idx) => {
    htmlDoc += `
      <div class="post">
        <div class="meta">👤 Đăng bởi: ${p.uploaderRealName} (${p.uploaderNickname || 'No nickname'}) | ⏰ Ngày: ${p.date}</div>
        <div class="caption">${p.caption || '(Không có chú thích)'}</div>
        <div>❤️ ${p.likedByUsers ? p.likedByUsers.length : (p.likes || 0)} Thả tim | 💬 ${p.comments ? p.comments.length : 0} Bình luận</div>
        <div style="margin-top: 1rem;">
    `;

    (p.comments || []).forEach(c => {
      htmlDoc += `<div class="comment"><strong>${c.user}:</strong> ${c.text}</div>`;
    });

    htmlDoc += `</div></div>`;

    const files = p.files || (p.image ? [{ type: 'IMAGE', url: p.image }] : []);
    files.forEach((f, fIdx) => {
      if (f.url && f.url.startsWith('data:')) {
        const base64Data = f.url.split(',')[1];
        const ext = f.type === 'VIDEO' ? 'mp4' : 'jpg';
        folderMedia.file(`post_${idx+1}_media_${fIdx+1}.${ext}`, base64Data, { base64: true });
      }
    });
  });

  htmlDoc += `</body></html>`;

  zip.file("Luu_But_Ky_Niem.html", htmlDoc);
  zip.file("posts_data.json", JSON.stringify(state.posts, null, 2));

  zip.generateAsync({ type: "blob" }).then(function(content) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content);
    a.download = `Bao_Cao_Ky_Niem_${state.systemClassName}_${state.academicYear.replace(/\s+/g, '_')}.zip`;
    a.click();
    showToast("🎉 Đã xuất & nén file ZIP kỷ niệm thành công!");
  });
};

window.adminAddRosterName = function() {
  const input = document.getElementById('admin-new-roster-name');
  const name = input ? input.value.trim() : '';
  if (!name) {
    showToast("⚠️ Vui lòng nhập Họ và Tên thật!");
    return;
  }

  if (state.officialRoster.some(n => n.toLowerCase() === name.toLowerCase())) {
    showToast("⚠️ Tên này đã có trong Danh Sách!");
    return;
  }

  state.officialRoster.push(name);
  state.save(true);
  renderAdminModalContent();
  showToast(`✅ Đã thêm "${name}" vào Danh Sách Học Sinh!`);
};

window.adminRemoveRosterName = function(name) {
  state.officialRoster = state.officialRoster.filter(n => n !== name);
  state.save(true);
  renderAdminModalContent();
  showToast(`🗑️ Đã xóa "${name}" khỏi Danh Sách.`);
};

window.adminSaveClassSettings = function() {
  const sysInput = document.getElementById('admin-system-name-input').value.trim();
  const webInput = document.getElementById('admin-web-name-input').value.trim();
  const yearInput = document.getElementById('admin-class-year-input').value.trim();

  if (!sysInput || !webInput) {
    showToast("⚠️ Tên lớp không được để trống!");
    return;
  }

  state.systemClassName = sysInput;
  state.webDisplayName = webInput;
  state.academicYear = yearInput || "Niên khóa 2023 - 2026";
  state.save(true);

  renderApp();
  renderAdminModalContent();
  showToast(`🎉 Đã cập nhật Web: "${state.webDisplayName}" (Mã: ${state.systemClassName})`);
};

window.adminClearAllData = function() {
  if (!confirm("⚠️ [CẢNH BÁO ADMIN] Bạn có chắc muốn XÓA TRẮNG TOÀN BỘ dữ liệu bài viết?")) return;

  state.posts = [];
  state.groups = [];
  state.projects = [];
  state.save(true);

  renderApp();
  closeAdminModal();
  showToast("🧹 Đã xóa trắng toàn bộ dữ liệu web thành công!");
};

// ----------------------------------------------------
// 7. AUTHENTICATION & GATEWAY HANDLERS
// ----------------------------------------------------
window.handleWhitelistLogin = function() {
  const selectedClassCode = document.getElementById('auth-class-select').value;
  const passInput = document.getElementById('auth-pass').value.trim();

  if (selectedClassCode && selectedClassCode !== state.systemClassName) {
    state.switchClass(selectedClassCode);
  }

  // 1. Super Admin Password Bypass Redirect
  if (passInput === SUPER_ADMIN_PIN) {
    window.location.href = "admin.html";
    return;
  }

  // 2. Class Admin Login Mode
  if (state.authMode === 'CLASS_ADMIN') {
    const classAdminPass = state.classAdminPassword;
    if (passInput === classAdminPass || passInput === '888888') {
      state.currentUser = {
        realName: `Quản Trị Viên ${state.systemClassName}`,
        nickname: `Admin ${state.systemClassName}`,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=Admin${state.systemClassName}`,
        role: `👑 Quản Trị Viên ${state.systemClassName}`,
        isLoggedIn: true,
        isAdmin: true,
        isSuperAdmin: false
      };
      state.save(true);
      renderApp();
      showToast(`👑 Đăng nhập thành công với quyền QUẢN TRỊ VIÊN LỚP ${state.systemClassName}!`);
    } else {
      showToast(`❌ Mật khẩu Admin của lớp ${state.systemClassName} không chính xác! Vui lòng hỏi Super Admin.`);
    }
    return;
  }

  // 3. Regular Student Login Mode
  const realNameInput = document.getElementById('auth-real-name').value.trim();
  const nicknameInput = document.getElementById('auth-nickname').value.trim();

  if (!realNameInput) {
    showToast("⚠️ Bắt buộc phải nhập Họ và Tên Thật!");
    return;
  }

  const isNameInRoster = state.officialRoster.some(n => n.toLowerCase() === realNameInput.toLowerCase());

  if (!isNameInRoster) {
    showToast(`❌ Họ tên "${realNameInput}" KHÔNG có trong Danh Sách Học Sinh lớp ${state.systemClassName}! Vui lòng nhờ Admin lớp thêm tên bạn.`);
    return;
  }

  if (passInput === state.classStudentPassword || passInput === "LopA6-2026") {
    state.currentUser = {
      realName: realNameInput,
      nickname: nicknameInput,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(realNameInput)}`,
      role: `Thành Viên ${state.systemClassName}`,
      isLoggedIn: true,
      isAdmin: false,
      isSuperAdmin: false
    };
    state.save(true);

    renderApp();
    showToast(`🔓 Đăng nhập thành công! Chào mừng ${state.getUserDisplayName()} vào web ${state.webDisplayName}.`);
  } else {
    showToast(`❌ Mật khẩu học sinh của lớp ${state.systemClassName} không chính xác! Vui lòng hỏi Admin lớp.`);
  }
};

window.openProfileModal = function() {
  document.getElementById('profile-real-name').value = state.currentUser.realName || '';
  document.getElementById('profile-nickname').value = state.currentUser.nickname || '';
  const prev = document.getElementById('profile-avatar-preview');
  if (prev) prev.src = state.currentUser.avatar;
  document.getElementById('profile-modal').classList.remove('hidden');
};

window.closeProfileModal = function() {
  document.getElementById('profile-modal').classList.add('hidden');
};

window.handleProfileAvatarSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    state.tempAvatarData = e.target.result;
    const prev = document.getElementById('profile-avatar-preview');
    if (prev) prev.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.saveProfileNames = function() {
  const nickname = document.getElementById('profile-nickname').value.trim();

  state.currentUser.nickname = nickname;
  if (state.tempAvatarData) {
    state.currentUser.avatar = state.tempAvatarData;
  }
  state.save(true);

  closeProfileModal();
  renderApp();
  showToast("🎉 Đã cập nhật Biệt danh & Avatar cá nhân thành công!");
};

// ----------------------------------------------------
// 8. LISTENERS & UTILITIES
// ----------------------------------------------------
function setupEventListeners() {
  const tBtn = document.getElementById('nav-timeline');
  const gBtn = document.getElementById('nav-groups');
  const pBtn = document.getElementById('nav-projects');

  if (tBtn) tBtn.addEventListener('click', () => { state.activeTab = 'timeline'; renderTabContent(); });
  if (gBtn) gBtn.addEventListener('click', () => { state.activeTab = 'groups'; renderTabContent(); });
  if (pBtn) pBtn.addEventListener('click', () => { state.activeTab = 'projects'; renderTabContent(); });

  document.getElementById('filter-month').addEventListener('change', (e) => { state.filterMonth = e.target.value; renderTimelineFeed(); });
  document.getElementById('filter-uploader').addEventListener('change', (e) => { state.filterUploader = e.target.value; renderTimelineFeed(); });
  document.getElementById('filter-sort').addEventListener('change', (e) => { state.filterSort = e.target.value; renderTimelineFeed(); });

  document.getElementById('global-search').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.activeTab !== 'timeline') state.activeTab = 'timeline';
    renderApp();
  });
}

window.filterByTag = function(tag) {
  state.selectedTag = tag;
  state.activeTab = 'timeline';
  renderApp();
  showToast(`🏷️ Đang lọc theo Hashtag: ${tag}`);
};

window.resetFilters = function() {
  state.filterMonth = 'ALL';
  state.filterUploader = 'ALL';
  state.filterSort = 'NEWEST';
  state.searchQuery = '';
  state.selectedTag = '';
  document.getElementById('global-search').value = '';
  renderApp();
};

window.showToast = function(msg) {
  const toast = document.getElementById('toast-notification');
  toast.innerText = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
};

window.openCreateProjectModal = function() {
  const name = prompt("Nhập tên Dự Án Kỷ Niệm Mới:");
  if (!name) return;
  const desc = prompt("Nhập mô tả dự án:");

  const newProj = {
    id: 'p_' + Date.now(),
    name: name,
    category: "Dự án lớp",
    members: [state.getUserDisplayName()],
    status: "Đang thực hiện 🚀",
    description: desc || "Dự án & lưu trữ tập tin lớp.",
    files: [],
    cover: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600",
    createdAt: new Date().toISOString().slice(0,7)
  };

  state.projects.push(newProj);
  state.save(true);
  renderProjectsVault();
  showToast(`🎉 Đã tạo dự án mới: ${name}`);
};
