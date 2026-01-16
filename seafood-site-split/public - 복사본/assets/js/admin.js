import { doc, setDoc, deleteDoc, getDoc, updateDoc, collection, query, where, orderBy, onSnapshot, limit, startAfter, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, getPublicDataRef, getConfDoc, COLLECTIONS } from "./config.js";
import { state } from "./state.js";
import { normalizeCategory } from "./utils.js";

// =========================================
// 1. 네비게이션 & UI 컨트롤
// =========================================

window.openAdminDashboard = () => {
    document.getElementById('admin-dashboard').classList.remove('hidden');
    window.showAdminTab('home');
};

window.closeAdminDashboard = () => {
    document.getElementById('admin-dashboard').classList.add('hidden');
};

window.toggleAdminSidebar = () => {
    const sidebar = document.getElementById('admin-sidebar');
    const overlay = document.getElementById('admin-sidebar-overlay');
    sidebar.classList.toggle('-translate-x-full');
    overlay.classList.toggle('hidden');
};

window.showAdminTab = (tabId) => {
    // 1. 기존 리스너 해제 (메모리 누수 방지)
    Object.values(state.adminListeners).forEach(unsubscribe => unsubscribe());
    state.adminListeners = {};

    // 2. 메뉴 활성화 UI
    document.querySelectorAll('.admin-sidebar-item').forEach(el => el.classList.remove('active'));
    const menuEl = document.getElementById(`menu-${tabId}`);
    if (menuEl) menuEl.classList.add('active');

    // 3. 탭 컨텐츠 전환 (애니메이션 적용)
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
    const targetContent = document.getElementById(`admin-${tabId}`);
    if (targetContent) {
        targetContent.classList.remove('hidden');
        targetContent.classList.remove('reveal', 'active');
        void targetContent.offsetWidth; // 리플로우 강제 (애니메이션 재시작)
        targetContent.classList.add('reveal', 'active');
    }

    // 4. 헤더 타이틀 변경
    const titleMap = {
        'home': 'Dashboard',
        'orders': 'Order Management',
        'products': 'Product Management',
        'inquiries': 'Customer Inquiry',
        'notices': 'Notice Management',
        'blogs': 'Blog Management',
        'settings': 'Settings'
    };
    const pageTitle = document.getElementById('admin-page-title');
    if (pageTitle) pageTitle.innerText = titleMap[tabId] || 'Manager Console';

    // 모바일 사이드바 닫기
    if (window.innerWidth < 768) {
        document.getElementById('admin-sidebar').classList.add('-translate-x-full');
        document.getElementById('admin-sidebar-overlay').classList.add('hidden');
    }

    // 5. 해당 탭 데이터 로드
    if (tabId === 'home') renderAdminHome();
    if (tabId === 'orders') renderAdminOrders();
    if (tabId === 'products') renderAdminProducts();
    if (tabId === 'inquiries') renderAdminInquiries();
    if (tabId === 'notices') renderAdminNotices();
    if (tabId === 'blogs') renderAdminBlogs();
    if (tabId === 'settings') renderAdminSettings();
};

// =========================================
// 2. 대시보드 (Dashboard)
// =========================================

function renderAdminHome() {
    // 실시간 데이터 집계
    state.adminListeners.orders = onSnapshot(query(getPublicDataRef(COLLECTIONS.ORDERS), where("status", "==", "new")), (snap) => {
        document.getElementById('dash-new-orders').innerText = snap.size + "건";
    });
    state.adminListeners.products = onSnapshot(getPublicDataRef(COLLECTIONS.PRODUCTS), (snap) => {
        document.getElementById('dash-total-products').innerText = snap.size + "개";
    });
    state.adminListeners.inquiries = onSnapshot(query(getPublicDataRef(COLLECTIONS.INQUIRIES), where("answer", "==", null)), (snap) => {
        document.getElementById('dash-pending-inquiries').innerText = snap.size + "건";
    });
}

// =========================================
// 3. 주문 관리 (SaaS Style Remastered)
// =========================================

let allOrdersCache = []; // 로컬 검색/필터용 캐시

function renderOrdersToolbar() {
    const tableContainer = document.querySelector('#admin-orders .admin-table-container');
    let toolbar = document.getElementById('order-toolbar');
    
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'order-toolbar';
        toolbar.className = 'flex flex-col md:flex-row gap-3 mb-4 justify-between items-center';
        // [디자인 적용] 새로운 버튼 스타일 적용
        toolbar.innerHTML = `
            <div class="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
                <button onclick="window.filterOrders('all')" class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition order-filter-btn active text-slate-600" data-filter="all">전체</button>
                <button onclick="window.filterOrders('new')" class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition order-filter-btn text-slate-600" data-filter="new">신규</button>
                <button onclick="window.filterOrders('done')" class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition order-filter-btn text-slate-600" data-filter="done">완료</button>
            </div>
            <div class="flex gap-2 w-full md:w-auto items-center">
                <div class="relative flex-1 md:w-64">
                    <i data-lucide="search" class="absolute left-3 top-3 text-slate-400 w-4 h-4"></i>
                    <input type="text" id="order-search-input" placeholder="주문자명, 전화번호" class="w-full pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-200 text-sm outline-none focus:border-blue-500 transition" onkeyup="window.searchLocalOrders(this.value)">
                </div>
                <button onclick="window.bulkAction('delete')" class="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-100 hidden transition whitespace-nowrap" id="btn-bulk-delete"><i data-lucide="trash-2" class="inline w-3 h-3 mb-0.5"></i> 선택 삭제</button>
            </div>
        `;
        // 테이블 바로 위에 삽입
        tableContainer.parentNode.insertBefore(toolbar, tableContainer);
    }
}

// [수정됨] 주문 관리 목록 생성 (중복 해결을 위해 md:hidden 추가)
function createOrderRow(o) {
    const dateObj = new Date(o.createdAt);
    // 모바일용 날짜 포맷 (MM월 DD일 HH:mm)
    const dateMobile = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}월 ${dateObj.getDate().toString().padStart(2, '0')}일 ${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
    const datePC = dateObj.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

    const productRaw = String(o.product || '');
    const addressRaw = String(o.address || '-');
    const name = String(o.name || '-');
    const phone = String(o.phone || '');
    const initial = name ? name.substring(0, 1) : '-';
    const isNew = o.status === 'new';
    
    // 스타일 클래스
    const rowClass = isNew ? 'order-new-highlight' : '';
    const avatarClass = isNew ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500';
    const statusText = isNew ? '신규주문' : '처리완료';
    const statusBadge = isNew ? 'saas-badge-blue' : 'saas-badge-gray';

    // HTML 반환: PC용 TD들과 모바일용 카드 컨테이너를 함께 포함
    // [중요] order-mobile-card-cell에 'md:hidden' 클래스 추가하여 PC에서 확실히 숨김
    return `
        <tr class="admin-table-row ${rowClass}" id="row-${o.id}">

            <!-- [PC 전용 컬럼들] md 이상에서만 표시 (CSS desktop-only-cell로 제어됨) -->
            <td class="order-pc-col w-12 text-center desktop-only-cell" onclick="event.stopPropagation()">
                <input type="checkbox" class="order-checkbox w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" value="${o.id}" onchange="window.toggleBulkBtn()" />
            </td>

            <td class="order-pc-col w-32 font-numeric text-slate-600 font-bold text-xs desktop-only-cell">${datePC}</td>

            <td class="order-pc-col desktop-only-cell">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${avatarClass} flex items-center justify-center text-xs font-bold shrink-0">${initial}</div>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-800 leading-none mb-0.5">${name}</span>
                        <span class="text-xs text-slate-400 font-numeric">${phone}</span>
                    </div>
                </div>
            </td>

            <td class="order-pc-col desktop-only-cell">
                <div class="text-xs text-slate-600 truncate max-w-[180px]" title="${addressRaw}">${addressRaw}</div>
            </td>

            <td class="order-pc-col desktop-only-cell">
                <div class="text-xs font-bold text-slate-700 truncate max-w-[200px]" title="${productRaw}">${productRaw}</div>
            </td>

            <td class="order-pc-col text-center w-20 desktop-only-cell">
                <span class="saas-badge ${statusBadge}">${statusText}</span>
            </td>

            <td class="order-pc-col text-right desktop-only-cell" onclick="event.stopPropagation()">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="window.viewOrderDetail('${o.id}')" class="btn-saas-icon text-slate-400 hover:text-blue-600" title="상세"><i data-lucide="file-text" size="15"></i></button>
                    <button onclick="window.updateOrderStatus('${o.id}', '${isNew ? 'done' : 'new'}')" class="btn-saas-icon ${isNew ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-slate-400 hover:text-slate-600'}" title="상태변경">
                        <i data-lucide="${isNew ? 'check' : 'rotate-ccw'}" size="15"></i>
                    </button>
                    <button onclick="window.deleteOrder('${o.id}')" class="btn-saas-icon text-slate-400 hover:text-red-600" title="삭제"><i data-lucide="trash-2" size="15"></i></button>
                </div>
            </td>

            <!-- [모바일 전용 카드] md 미만에서만 표시 (md:hidden 추가로 PC 노출 차단) -->
            <td class="order-mobile-card-cell md:hidden">
                <div class="mobile-order-card">
                    <div class="card-header ${isNew ? 'bg-blue-50/50' : 'bg-slate-50/50'}">
                        <span class="date font-numeric"><i data-lucide="calendar" size="12"></i> ${dateMobile}</span>
                        <span class="saas-badge ${statusBadge}">${statusText}</span>
                    </div>
                    <div class="card-body" onclick="window.viewOrderDetail('${o.id}')">
                        <div class="info-row main-info">
                            <span class="name">${name}</span>
                            <a href="tel:${phone}" class="phone font-numeric" onclick="event.stopPropagation()">${phone}</a>
                        </div>
                        <div class="info-row address-info">
                            <i data-lucide="map-pin" size="13" class="icon"></i>
                            <span class="text">${addressRaw}</span>
                        </div>
                        <div class="info-row product-info">
                            <i data-lucide="box" size="13" class="icon"></i>
                            <span class="text">${productRaw}</span>
                        </div>
                    </div>
                    <div class="card-footer">
                        <button onclick="window.viewOrderDetail('${o.id}')" class="btn-footer">상세보기</button>
                        <div class="divider"></div>
                        <button onclick="window.updateOrderStatus('${o.id}', '${isNew ? 'done' : 'new'}')" class="btn-footer ${isNew ? 'text-blue-600 font-bold' : 'text-slate-500'}">
                            ${isNew ? '발송처리' : '미처리로 변경'}
                        </button>
                        <div class="divider"></div>
                        <button onclick="window.deleteOrder('${o.id}')" class="btn-footer text-red-500">삭제</button>
                    </div>
                </div>
            </td>
        </tr>`;
}

// 주문 상세보기 모달
window.viewOrderDetail = (orderId) => {
    const order = allOrdersCache.find(o => o.id === orderId);
    if (!order) return;

    const dateStr = new Date(order.createdAt).toLocaleString('ko-KR');

    const modalHTML = `
        <div class="modal-overlay" onclick="this.remove()">
            <div class="modal-content-saas" onclick="event.stopPropagation()">
                <div class="modal-header-saas">
                    <h3 class="modal-title-saas">주문 상세정보</h3>
                    <button onclick="this.closest('.modal-overlay').remove()" class="modal-close-saas">
                        <i data-lucide="x" size="20"></i>
                    </button>
                </div>
                <div class="modal-body-saas">
                    <div class="detail-row">
                        <span class="detail-label">주문번호</span>
                        <span class="detail-value font-numeric text-slate-500">${order.id.substring(0,8)}...</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">접수일시</span>
                        <span class="detail-value font-numeric">${dateStr}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">고객명</span>
                        <span class="detail-value">${order.name}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">연락처</span>
                        <span class="detail-value">
                            <a href="tel:${order.phone}" class="detail-link font-numeric">${order.phone}</a>
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">배송지</span>
                        <span class="detail-value leading-snug">${order.address}</span>
                    </div>
                    <div class="detail-row detail-row-full">
                        <span class="detail-label">주문내역</span>
                        <pre class="detail-product">${order.product}</pre>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">상태</span>
                        <span class="saas-badge ${order.status === 'new' ? 'saas-badge-blue' : 'saas-badge-gray'}">
                            ${order.status === 'new' ? '신규주문' : '처리완료'}
                        </span>
                    </div>
                </div>
                <div class="modal-footer-saas">
                    <button onclick="this.closest('.modal-overlay').remove()" class="btn-saas btn-saas-ghost">닫기</button>
                    <button onclick="window.updateOrderStatus('${order.id}', '${order.status === 'new' ? 'done' : 'new'}'); this.closest('.modal-overlay').remove();" class="btn-saas btn-saas-primary">
                        ${order.status === 'new' ? '발송처리' : '신규로 변경'}
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    if (window.lucide) window.lucide.createIcons();
};

function renderAdminOrders() {
    const list = document.getElementById('admin-order-list');
    renderOrdersToolbar(); 
    list.innerHTML = ''; 
    document.getElementById('admin-orders-loading').classList.remove('hidden');
    document.getElementById('btn-load-more-orders').classList.add('hidden');

    const q = query(getPublicDataRef(COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'), limit(20));
    state.adminListeners.ordersList = onSnapshot(q, (snap) => {
        document.getElementById('admin-orders-loading').classList.add('hidden');
        if (snap.empty) {
            list.innerHTML = '<tr><td colspan="7" class="p-12 text-center text-slate-400">접수된 주문 내역이 없습니다.</td></tr>';
            return;
        }
        
        state.lastOrderDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length >= 20) document.getElementById('btn-load-more-orders').classList.remove('hidden');
        
        allOrdersCache = [];
        list.innerHTML = snap.docs.map(d => {
            const data = { id: d.id, ...d.data() };
            allOrdersCache.push(data);
            return createOrderRow(data);
        }).join('');
        if(window.lucide) window.lucide.createIcons();
    });
}

// ... existing code (loadMoreOrders, filterOrders, searchLocalOrders, toggleBulkBtn, bulkAction) ...
window.loadMoreOrders = () => {
    if (!state.lastOrderDoc) return;
    const q = query(getPublicDataRef(COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'), startAfter(state.lastOrderDoc), limit(20));
    
    // 로딩 표시
    const btn = document.getElementById('btn-load-more-orders');
    const originalText = btn.innerText;
    btn.innerText = "로딩 중...";

    getDocs(q).then(snap => {
        btn.innerText = originalText;
        if (snap.empty) {
            btn.classList.add('hidden');
            return;
        }
        state.lastOrderDoc = snap.docs[snap.docs.length - 1];
        snap.forEach(d => {
            const data = {id: d.id, ...d.data()};
            allOrdersCache.push(data);
            document.getElementById('admin-order-list').insertAdjacentHTML('beforeend', createOrderRow(data));
        });
        if(window.lucide) window.lucide.createIcons();
    });
};

window.filterOrders = (type) => {
    document.querySelectorAll('.order-filter-btn').forEach(b => {
        const isActive = b.dataset.filter === type;
        b.classList.toggle('bg-blue-600', isActive);
        b.classList.toggle('text-white', isActive);
        b.classList.toggle('border-blue-600', isActive);

        b.classList.toggle('bg-white', !isActive);
        b.classList.toggle('text-slate-600', !isActive);
        b.classList.toggle('border-slate-200', !isActive);
    });
    
    const list = document.getElementById('admin-order-list');
    let filtered = allOrdersCache;
    
    if (type !== 'all') {
        const statusMap = { 'new': 'new', 'done': 'done' };
        filtered = filtered.filter(o => o.status === statusMap[type]);
    }
    
    if(filtered.length === 0) list.innerHTML = '<tr><td colspan="7" class="p-12 text-center text-slate-400">해당 상태의 주문이 없습니다.</td></tr>';
    else list.innerHTML = filtered.map(o => createOrderRow(o)).join('');
    if(window.lucide) window.lucide.createIcons();
};

window.searchLocalOrders = (val) => {
    const list = document.getElementById('admin-order-list');
    if(!val) {
        list.innerHTML = allOrdersCache.map(o => createOrderRow(o)).join('');
        return;
    }
    const term = val.toLowerCase();
    const filtered = allOrdersCache.filter(o => o.name.toLowerCase().includes(term) || o.phone.includes(term));
    
    if(filtered.length === 0) list.innerHTML = '<tr><td colspan="7" class="p-12 text-center text-slate-400">검색 결과가 없습니다.</td></tr>';
    else list.innerHTML = filtered.map(o => createOrderRow(o)).join('');
    if(window.lucide) window.lucide.createIcons();
};

window.toggleBulkBtn = () => {
    const checked = document.querySelectorAll('.order-checkbox:checked').length > 0;
    document.getElementById('btn-bulk-delete').classList.toggle('hidden', !checked);
};

window.bulkAction = async (action) => {
    if(action === 'delete') {
        const ids = Array.from(document.querySelectorAll('.order-checkbox:checked')).map(el => el.value);
        if(!confirm(`${ids.length}건의 주문을 영구 삭제하시겠습니까?`)) return;
        
        try {
            for(const id of ids) await deleteDoc(doc(getPublicDataRef(COLLECTIONS.ORDERS), id));
            window.showToast(`${ids.length}건 삭제 완료`);
            document.getElementById('btn-bulk-delete').classList.add('hidden');
        } catch(e) { window.showToast("일괄 삭제 실패", "error"); }
    }
};

// =========================================
// 4. 상품 관리 (검색/카테고리/상태 필터 + 인라인 토글 + 필터 상태 유지)
// =========================================

let allProductsCache = [];
let productFilterCategory = "all";
let productSearchTerm = "";
let productStatusFilter = "all";

// ✅ 필터 상태 sessionStorage 유지
const PRODUCT_FILTERS_STORAGE_KEY = "admin_products_filters_v1";

function loadProductFilterState() {
  try {
    const raw = sessionStorage.getItem(PRODUCT_FILTERS_STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === "object") {
      if (typeof s.status === "string") productStatusFilter = s.status;
      if (typeof s.category === "string") productFilterCategory = s.category;
      if (typeof s.search === "string") productSearchTerm = s.search;
    }
  } catch (e) {
    // ignore
  }
}

function saveProductFilterState() {
  try {
    sessionStorage.setItem(PRODUCT_FILTERS_STORAGE_KEY, JSON.stringify({
      status: productStatusFilter,
      category: productFilterCategory,
      search: productSearchTerm
    }));
  } catch (e) {
    // ignore
  }
}

// 모듈 로드시 1회 복구
loadProductFilterState();

function setActiveProductStatusBtn() {
  document.querySelectorAll('.product-status-btn').forEach(btn => {
    const v = btn.getAttribute('data-status');
    const active = v === productStatusFilter;

    btn.classList.toggle('bg-blue-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-blue-600', active);

    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-slate-600', !active);
    btn.classList.toggle('border-slate-200', !active);
  });
}

window.filterProductStatus = (status) => {
  productStatusFilter = status || "all";
  saveProductFilterState();
  setActiveProductStatusBtn();
  window.applyProductFilters();
};

function renderProductsToolbar() {
  const tableContainer = document.querySelector('#admin-products .admin-table-container');
  let toolbar = document.getElementById('product-toolbar');

  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'product-toolbar';
    toolbar.className = 'flex flex-col md:flex-row gap-3 mb-4 justify-between items-center';

    toolbar.innerHTML = `
      <div class="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 items-center">
        <button type="button"
          class="product-status-btn px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition whitespace-nowrap"
          data-status="all"
          onclick="window.filterProductStatus('all')">전체</button>

        <button type="button"
          class="product-status-btn px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition whitespace-nowrap"
          data-status="available"
          onclick="window.filterProductStatus('available')">판매중</button>

        <button type="button"
          class="product-status-btn px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold hover:bg-slate-50 transition whitespace-nowrap"
          data-status="soldout"
          onclick="window.filterProductStatus('soldout')">품절</button>
      </div>

      <div class="flex gap-2 w-full md:w-auto items-center">
        <div class="relative flex-1 md:w-56">
          <select id="product-category-select"
            class="w-full px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-bold outline-none focus:border-blue-500 transition"
            onchange="window.filterProductsByCategory(this.value)">
          </select>
        </div>

        <div class="relative flex-1 md:w-64">
          <i data-lucide="search" class="absolute left-3 top-3 text-slate-400 w-4 h-4"></i>
          <input type="text" id="product-search-input" placeholder="상품명 검색"
            class="w-full pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-200 text-sm outline-none focus:border-blue-500 transition"
            onkeyup="window.searchLocalProducts(this.value)">
        </div>
      </div>
    `;

    tableContainer.parentNode.insertBefore(toolbar, tableContainer);
  }

  // 카테고리 옵션 구성 (설정 카테고리 + 실제 상품 카테고리 합치기)
  const select = document.getElementById('product-category-select');
  if (select) {
    const fromConfig = (state.configCategories || []).map(c => String(c).trim()).filter(Boolean);
    const fromProducts = allProductsCache.map(p => normalizeCategory(p.category)).filter(Boolean);
    const cats = Array.from(new Set([...fromConfig, ...fromProducts]));

    select.innerHTML =
      `<option value="all">전체 카테고리</option>` +
      cats.map(c => `<option value="${c}">${c}</option>`).join("");

    // 현재 선택값 유지
    select.value = productFilterCategory;
  }

  // ✅ 검색어 UI 반영 (세션 복구 포함)
  const searchInput = document.getElementById("product-search-input");
  if (searchInput) searchInput.value = productSearchTerm || "";

  // ✅ 상태 버튼 활성화 표시
  setActiveProductStatusBtn();

  if (window.lucide) window.lucide.createIcons();
}

// ✅ 인라인 토글(품절/메인노출)
window.toggleProductSoldOut = async (id, current) => {
  if (!state.isAdmin) return window.showToast("권한이 없습니다.", "error");
  try {
    await updateDoc(doc(getPublicDataRef(COLLECTIONS.PRODUCTS), id), {
      soldOut: !current,
      updatedAt: Date.now()
    });
    window.showToast(!current ? "품절로 변경되었습니다." : "판매중으로 변경되었습니다.");
  } catch (e) {
    console.error(e);
    window.showToast("상태 변경 실패", "error");
  }
};

window.toggleProductFeatured = async (id, current) => {
  if (!state.isAdmin) return window.showToast("권한이 없습니다.", "error");
  try {
    await updateDoc(doc(getPublicDataRef(COLLECTIONS.PRODUCTS), id), {
      featured: !current,
      updatedAt: Date.now()
    });
    window.showToast(!current ? "메인 노출로 변경되었습니다." : "메인 노출 해제되었습니다.");
  } catch (e) {
    console.error(e);
    window.showToast("노출 변경 실패", "error");
  }
};

// [수정됨] 상품 관리 모바일 레이아웃 개선
function createProductRow(p, id) {
    const isSoldOut = !!p.soldOut;
    const isFeatured = !!p.featured;
    const priceFormatted = Number(p.price).toLocaleString();
    const salePriceFormatted = p.salePrice ? Number(p.salePrice).toLocaleString() : null;
    
    // 추천 마크 (text-[9px], 아이콘 사이즈 8)
    const featuredBadge = isFeatured ? `<span class="flex items-center gap-0.5 text-[9px] bg-yellow-50 text-yellow-600 px-1.5 py-0.5 rounded border border-yellow-100 font-bold tracking-tight shrink-0"><i data-lucide="star" size="8" class="fill-current"></i> 추천</span>` : '';

    return `
    <tr class="admin-table-row product-card group hover:bg-slate-50/80 transition-colors" id="prod-${id}">
      <td class="product-img-col p-4">
        <div class="relative w-14 h-14 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
            <img src="${p.image}" class="w-full h-full object-cover">
            ${isSoldOut ? '<div class="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-[10px] font-bold text-white tracking-widest">품절</div>' : ''}
        </div>
      </td>

      <td class="product-info-col p-4">
        <div class="flex flex-col h-full justify-center w-full">
            <!-- [모바일 Layout] 1번째 줄: 품명 + 카테고리 + 추천마크 -->
            <div class="flex items-center gap-2 mb-1.5 w-full">
                <div class="text-sm font-bold text-slate-800 leading-tight line-clamp-1 truncate max-w-[120px] md:max-w-none">${p.name}</div>
                <span class="md:hidden text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">${p.category || '미분류'}</span>
                <div class="md:hidden shrink-0">${featuredBadge}</div>
                
                <!-- PC용 추천마크 (숨김 처리) -->
                <div class="hidden md:flex shrink-0">${featuredBadge}</div>
            </div>
            
            <!-- [모바일 Layout] 2번째 줄: 가격 + 우측 정렬된 컨트롤 버튼들 -->
            <div class="flex items-center justify-between w-full">
                <div class="mobile-only-price shrink-0">
                     ${salePriceFormatted 
                        ? `<span class="text-sm font-bold text-red-600 font-numeric mr-1">${salePriceFormatted}원</span>`
                        : `<span class="text-sm font-bold text-slate-700 font-numeric">${priceFormatted}원</span>`
                    }
                </div>

                <!-- 모바일용 액션 버튼 그룹 (판매중 토글 / 수정 / 삭제) -->
                <div class="flex items-center gap-1.5 md:hidden ml-auto">
                    <button onclick="window.toggleProductSoldOut('${id}', ${isSoldOut})" class="px-2 py-1 rounded text-[10px] font-bold border transition ${isSoldOut ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}">
                        ${isSoldOut ? '품절' : '판매중'}
                    </button>
                    <button onclick="window.openProductModal('${id}')" class="p-1.5 bg-white border border-slate-200 rounded text-slate-400 hover:text-blue-600 active:bg-slate-50">
                        <i data-lucide="edit-3" size="13"></i>
                    </button>
                    <button onclick="window.deleteItem('products','${id}')" class="p-1.5 bg-white border border-slate-200 rounded text-slate-400 hover:text-red-600 active:bg-slate-50">
                        <i data-lucide="trash-2" size="13"></i>
                    </button>
                </div>
            </div>
        </div>
      </td>

      <!-- PC 전용 컬럼들 (desktop-only-cell) -->
      <td class="product-category-col desktop-only-cell text-left hidden md:table-cell">
        <span class="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">${p.category || '미분류'}</span>
      </td>

      <td class="product-price-col desktop-only-cell text-left hidden md:table-cell">
        <div class="flex flex-col">
            ${salePriceFormatted 
                ? `<span class="text-sm font-bold text-red-600 font-numeric">${salePriceFormatted}원</span>
                   <span class="text-xs text-slate-400 line-through font-numeric">${priceFormatted}원</span>`
                : `<span class="text-sm font-bold text-slate-700 font-numeric">${priceFormatted}원</span>`
            }
        </div>
      </td>

      <td class="product-status-col desktop-only-cell p-4 hidden md:table-cell">
        <div class="flex items-center gap-2">
            <button type="button" onclick="window.toggleProductSoldOut('${id}', ${isSoldOut})" class="status-toggle-btn px-2 py-1 rounded text-[10px] font-bold border transition ${isSoldOut ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}">
                ${isSoldOut ? '품절' : '판매중'}
            </button>
        </div>
      </td>

      <td class="product-actions-col desktop-only-cell p-4 text-right hidden md:table-cell">
        <div class="flex items-center justify-end gap-1">
            <button onclick="window.openProductModal('${id}')" class="btn-saas-icon text-slate-400 hover:text-blue-600"><i data-lucide="edit-3" size="15"></i></button>
            <button onclick="window.deleteItem('products','${id}')" class="btn-saas-icon text-slate-400 hover:text-red-600"><i data-lucide="trash-2" size="15"></i></button>
        </div>
      </td>
    </tr>`;
}

window.filterProductsByCategory = (cat) => {
  productFilterCategory = cat || "all";
  saveProductFilterState();
  window.applyProductFilters();
};

window.searchLocalProducts = (term) => {
  productSearchTerm = (term || "").trim().toLowerCase();
  saveProductFilterState();
  window.applyProductFilters();
};

window.applyProductFilters = () => {
  const list = document.getElementById('admin-product-list');
  if (!list) return;

  let filtered = [...allProductsCache];

  // ✅ 상태 필터
  if (productStatusFilter === "available") {
    filtered = filtered.filter(p => !p.soldOut);
  } else if (productStatusFilter === "soldout") {
    filtered = filtered.filter(p => !!p.soldOut);
  }

  if (productFilterCategory !== "all") {
    filtered = filtered.filter(p => normalizeCategory(p.category) === productFilterCategory);
  }

  if (productSearchTerm) {
    filtered = filtered.filter(p => String(p.name || "").toLowerCase().includes(productSearchTerm));
  }

  if (filtered.length === 0) {
    list.innerHTML = '<tr><td colspan="6" class="p-12 text-center text-slate-400">조건에 맞는 상품이 없습니다.</td></tr>';
    return;
  }

  list.innerHTML = filtered.map(p => createProductRow(p, p.id)).join('');
  if (window.lucide) window.lucide.createIcons();
};

function renderAdminProducts() {
  state.adminListeners.productsList = onSnapshot(
    query(getPublicDataRef(COLLECTIONS.PRODUCTS), orderBy('createdAt', 'desc')),
    (snap) => {
      const list = document.getElementById('admin-product-list');
      if (!list) return;

      allProductsCache = [];
      snap.forEach(d => allProductsCache.push({ id: d.id, ...d.data() }));

      // 툴바 먼저 세팅 (카테고리 옵션 갱신 + 세션 복구 UI 반영 포함)
      renderProductsToolbar();

      if (allProductsCache.length === 0) {
        list.innerHTML = '<tr><td colspan="6" class="p-12 text-center text-slate-400">등록된 상품이 없습니다.</td></tr>';
        return;
      }

      // 현재 필터/검색 조건으로 렌더
      window.applyProductFilters();
    }
  );
}

// =========================================
// 5. 문의 관리
// =========================================

function renderAdminInquiries() {
    state.adminListeners.inquiriesList = onSnapshot(query(getPublicDataRef(COLLECTIONS.INQUIRIES), orderBy("createdAt", "desc"), limit(50)), (snap) => {
        const list = document.getElementById("admin-inquiry-list");
        if (snap.empty) {
            list.innerHTML = '<div class="p-12 text-center text-slate-400 flex flex-col items-center gap-4"><i data-lucide="inbox" size="48" class="text-slate-200"></i><p>문의 내역이 없습니다.</p></div>';
            if(window.lucide) window.lucide.createIcons();
            return;
        }

        list.innerHTML = snap.docs.map(d => {
            const q = d.data();
            const hasAnswer = q.answer && q.answer.trim();
            return `
                <div class="group p-5 hover:bg-slate-50 transition cursor-pointer border-b border-slate-100 last:border-0 rounded-lg hover:shadow-sm" onclick="window.viewInquiryDetail('${d.id}')">
                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 rounded-full bg-gradient-to-br ${hasAnswer ? 'from-green-400 to-green-600' : 'from-blue-400 to-blue-600'} flex items-center justify-center text-white font-bold text-lg shadow-md flex-shrink-0">
                            ${q.name.substring(0,1)}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="font-bold text-base text-slate-800">${q.name}</span>
                                <span class="text-xs text-slate-400">${new Date(q.createdAt).toLocaleString('ko-KR', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</span>
                                <span class="saas-badge ${hasAnswer ? 'saas-badge-green' : 'saas-badge-blue'}">${hasAnswer ? '답변완료' : '답변대기'}</span>
                            </div>
                            <div class="text-sm text-slate-600 line-clamp-2 leading-relaxed mb-2">${q.content}</div>
                            <a href="tel:${q.phone}" class="text-xs text-slate-500 font-mono hover:text-blue-600 inline-flex items-center gap-1" onclick="event.stopPropagation();">
                                <i data-lucide="phone" size="12"></i> ${q.phone}
                            </a>
                        </div>
                        <i data-lucide="chevron-right" class="text-slate-300 group-hover:text-slate-600 group-hover:translate-x-1 transition-all" size="20"></i>
                    </div>
                </div>`;
        }).join('');
        if(window.lucide) window.lucide.createIcons();
    });
}

// =========================================
// 6. 문의 상세보기 (신규 추가)
// =========================================

window.viewInquiryDetail = async (id) => {
    const snap = await getDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id));
    if (!snap.exists()) return;
    const q = snap.data();

    const modal = document.getElementById('inquiry-detail-modal');
    const content = document.getElementById('inquiry-detail-content');

    const hasAnswer = q.answer && q.answer.trim();

    content.innerHTML = `
        <div class="space-y-4 pt-4">
            <div class="flex justify-between items-start mb-6">
                <h3 class="text-xl font-bold text-slate-800">문의 상세</h3>
                <div class="flex items-center gap-2">
                    <span class="saas-badge ${hasAnswer ? 'saas-badge-green' : 'saas-badge-blue'}">${hasAnswer ? '답변완료' : '답변대기'}</span>
                    ${state.isAdmin ? `<button onclick="window.deleteInquiry('${id}')" class="text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition"><i data-lucide="trash-2" size="14"></i></button>` : ''}
                </div>
            </div>

            <div class="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 border-2 border-white shadow-sm">${q.name.substring(0,1)}</div>
                    <div>
                        <div class="font-bold text-slate-800">${q.name}</div>
                        <a href="tel:${q.phone}" class="text-xs text-slate-500 font-mono hover:text-blue-600">${q.phone}</a>
                    </div>
                </div>
                <div class="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-white rounded-lg p-4 border border-slate-200">${q.content}</div>
                <div class="text-xs text-slate-400 mt-3">${new Date(q.createdAt).toLocaleString('ko-KR')}</div>
            </div>

            <div class="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <div class="flex items-center justify-between mb-3">
                    <div class="font-bold text-sm text-blue-800">관리자 답변</div>
                    ${state.isAdmin ? `<button onclick="window.registerAnswer('${id}')" class="text-xs font-bold text-blue-600 hover:text-blue-700 underline">답변 ${hasAnswer ? '수정' : '작성'}</button>` : ''}
                </div>
                <div id="inquiry-answer-text-${id}" class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-white rounded-lg p-4 border border-blue-200 min-h-[100px] flex items-center justify-center ${hasAnswer ? '' : 'text-slate-400'}">${hasAnswer ? q.answer : '답변 대기중'}</div>
                ${q.answeredAt ? `<div class="text-xs text-blue-600 mt-3">답변일: ${new Date(q.answeredAt).toLocaleString('ko-KR')}</div>` : ''}
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
    if(window.lucide) window.lucide.createIcons();
};

// =========================================
// 7. 공지사항 및 블로그 관리
// =========================================

function renderAdminNotices() {
    state.adminListeners.noticesList = onSnapshot(query(getPublicDataRef(COLLECTIONS.NOTICES), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById("admin-notice-list");
        if (snap.empty) {
            list.innerHTML = '<div class="p-12 text-center text-slate-400 flex flex-col items-center gap-4"><i data-lucide="megaphone" size="48" class="text-slate-200"></i><p>등록된 공지가 없습니다.</p></div>';
            if(window.lucide) window.lucide.createIcons();
            return;
        }

        list.innerHTML = snap.docs.map(d => {
            const n = d.data();
            const isPopup = n.showPopup;
            return `
                <div class="group p-5 hover:bg-slate-50 transition border-b border-slate-100 last:border-0 rounded-lg hover:shadow-sm cursor-pointer" onclick="window.openNoticeModal('${d.id}')">
                    <div class="flex items-start gap-4">
                        <div class="w-12 h-12 rounded-full ${isPopup ? 'bg-gradient-to-br from-red-400 to-red-600' : 'bg-gradient-to-br from-slate-300 to-slate-500'} flex items-center justify-center text-white shadow-md flex-shrink-0">
                            <i data-lucide="megaphone" size="20"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-2">
                                <span class="font-bold text-base text-slate-800 group-hover:text-blue-600 transition">${n.title}</span>
                                ${isPopup ? '<span class="saas-badge saas-badge-red">팝업노출</span>' : ''}
                            </div>
                            <div class="text-sm text-slate-600 line-clamp-2 leading-relaxed mb-2">${n.content || ''}</div>
                            <div class="text-xs text-slate-400 flex items-center gap-1">
                                <i data-lucide="calendar" size="12"></i>
                                ${new Date(n.createdAt).toLocaleDateString('ko-KR', {year: 'numeric', month: 'short', day: 'numeric'})}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="event.stopPropagation(); window.openNoticeModal('${d.id}')" class="p-2 text-slate-400 hover:text-blue-600 transition rounded-lg hover:bg-blue-50" title="수정">
                                <i data-lucide="edit-3" size="16"></i>
                            </button>
                            <button onclick="event.stopPropagation(); window.deleteNotice('${d.id}')" class="p-2 text-slate-400 hover:text-red-600 transition rounded-lg hover:bg-red-50" title="삭제">
                                <i data-lucide="trash-2" size="16"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('');
        if(window.lucide) window.lucide.createIcons();
    });
}

function renderAdminBlogs() {
    state.adminListeners.blogsList = onSnapshot(query(getPublicDataRef(COLLECTIONS.BLOGS), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById("admin-blog-list");
        if (snap.empty) { list.innerHTML = '<div class="p-12 text-center text-slate-400 col-span-full">작성된 글이 없습니다.</div>'; return; }
        
        list.innerHTML = snap.docs.map(d => {
            const b = d.data();
            return `
                <div class="admin-blog-item group">
                    <div class="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0 border border-slate-100">
                        <img src="${b.image || ''}" class="w-full h-full object-cover">
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="font-bold text-slate-800 text-sm truncate mb-1">${b.title} ${b.isHidden ? '<span class="text-red-500 text-xs">(숨김)</span>' : ''}</div>
                        <p class="text-xs text-slate-500 line-clamp-1">${b.content}</p>
                        <div class="text-[10px] text-slate-400 mt-2 font-numeric">${new Date(b.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="window.openBlogModal('${d.id}')" class="p-2 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg transition"><i data-lucide="edit-3" size="16"></i></button>
                        <button onclick="window.deleteItem('blogs','${d.id}')" class="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition"><i data-lucide="trash-2" size="16"></i></button>
                    </div>
                </div>`;
        }).join('');
        if(window.lucide) window.lucide.createIcons();
    });
}

// =========================================
// 7. 설정 및 에디터 (Advanced Editor)
// =========================================

function renderAdminSettings() {
  getDoc(getConfDoc()).then(s => {
    const d = s.data() || {};
    const form = document.getElementById('admin-settings-form');
    if (!form) return;

    // 기본 설정
    if (form.storeName) form.storeName.value = d.storeName || '';
    if (form.ownerName) form.ownerName.value = d.ownerName || '';
    if (form.bizNum) form.bizNum.value = d.bizNum || '';
    if (form.csPhone) form.csPhone.value = d.csPhone || '';

    // 계좌 정보
    if (form.bankName) form.bankName.value = d.bankName || '';
    if (form.bankNumber) form.bankNumber.value = d.bankNumber || '';
    if (form.bankOwner) form.bankOwner.value = d.bankOwner || '';

    // 주소/푸터
    if (form.address) form.address.value = d.address || '';
    if (form.footerDesc) form.footerDesc.value = d.footerDesc || '';

    // 브랜드/배너 (새로 추가)
    if (form.logoUrl) {
        form.logoUrl.value = d.logoUrl || '';
        const preview = document.getElementById('preview-logoUrl');
        if (preview && d.logoUrl) {
            preview.src = d.logoUrl;
            preview.classList.remove('hidden');
        }
    }
    if (form.mainBannerUrl) {
        form.mainBannerUrl.value = d.mainBannerUrl || '';
        const preview = document.getElementById('preview-mainBannerUrl');
        if (preview && d.mainBannerUrl) {
            preview.src = d.mainBannerUrl;
            preview.classList.remove('hidden');
        }
    }
    if (form.mainTitle) form.mainTitle.value = d.mainTitle || '';
    if (form.mainSubtitle) form.mainSubtitle.value = d.mainSubtitle || '';
    if (form.mainDesc) form.mainDesc.value = d.mainDesc || '';

    // 아이콘 재렌더링
    if (window.lucide) window.lucide.createIcons();
  });
}

window.saveAdminSettings = async () => {
    console.log('saveAdminSettings 호출됨');
    const form = document.getElementById('admin-settings-form');
    if (!form) {
        console.error('설정 폼을 찾을 수 없습니다');
        window.showToast("오류: 설정 폼을 찾을 수 없습니다");
        return;
    }

    const data = {
        // 기본 설정
        storeName: form.storeName?.value || "",
        ownerName: form.ownerName?.value || "",
        bizNum: form.bizNum?.value || "",
        csPhone: form.csPhone?.value || "",

        // 계좌 정보
        bankName: form.bankName?.value || "",
        bankNumber: form.bankNumber?.value || "",
        bankOwner: form.bankOwner?.value || "",

        // 주소/푸터
        address: form.address?.value || "",
        footerDesc: form.footerDesc?.value || "",

        // 브랜드/배너 (새로 추가)
        logoUrl: form.logoUrl?.value || "",
        mainBannerUrl: form.mainBannerUrl?.value || "",
        mainTitle: form.mainTitle?.value || "",
        mainSubtitle: form.mainSubtitle?.value || "",
        mainDesc: form.mainDesc?.value || ""
    };

    console.log('저장할 데이터:', data);

    try {
        await setDoc(getConfDoc(), data, { merge: true });
        console.log('저장 성공');
        window.showToast("설정이 저장되었습니다.");
        setTimeout(() => location.reload(), 500);
    } catch (error) {
        console.error('설정 저장 오류:', error);
        window.showToast("저장 실패: " + error.message);
    }
};

// [기능 복구] 동적 에디터 생성 로직
window.openEditor = (type, id = null, data = {}) => {
    const modal = document.getElementById("editor-modal");
    document.getElementById("editor-title").innerText = id ? `${type} 수정` : `새 ${type} 등록`;
    document.getElementById("editor-id").value = id || "";
    document.getElementById("editor-type").value = type;
    const fields = document.getElementById("editor-fields");
    
    // [디자인 적용] 모달 그리드 레이아웃 - 상품도 2열
    fields.className = "grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[62vh] overflow-y-auto pr-1";
    fields.innerHTML = "";

    const config = {
        "상품": [
            { n: "name", l: "상품명" },
            { n: "unit", l: "단위(예: 1kg)" },
            { n: "category", l: "카테고리", hidden: true },
            { n: "price", l: "정상가(원)" },
            { n: "salePrice", l: "할인가(원, 선택)" },
            { n: "image", l: "이미지", img: true, col: 2 },
            { n: "description", l: "설명", area: true, col: 2 },
            { n: "featured", l: "메인 노출(오늘의 추천)", chk: true },
            { n: "soldOut", l: "품절", chk: true }
        ],

        "공지": [{ n: "title", l: "제목", col: 2 }, { n: "content", l: "내용", area: true, col: 2 }, { n: "showPopup", l: "메인 팝업 노출", chk: true }],
        "블로그": [{ n: "title", l: "제목", col: 2 }, { n: "image", l: "대표 이미지", img: true, col: 2 }, { n: "content", l: "본문 내용", area: true, col: 2 }, { n: "isHidden", l: "숨김 처리", chk: true }]
    }[type];

    // ✅ 상품 카테고리: 드롭다운 검색 UI (당신이 적용 완료한 전제)
    if (type === "상품") {
      fields.innerHTML += `
        <div class="col-span-1 md:col-span-2 mb-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <label class="text-xs text-slate-500 font-bold block mb-2">카테고리 설정</label>

          <div class="relative">
            <input
              type="text"
              id="category-search-input"
              class="w-full p-3 border rounded-xl text-sm bg-white outline-none focus:border-blue-500"
              placeholder="카테고리 검색 또는 선택"
              autocomplete="off"
            />

            <div
              id="category-dropdown"
              class="absolute z-50 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden hidden"
            ></div>
          </div>

          <input type="hidden" id="editor-input-category" value="${data.category || ''}">
          <div class="mt-2 text-xs text-slate-500">
            선택된 카테고리: <span id="category-selected-label" class="font-bold text-slate-700"></span>
          </div>
        </div>
      `;
      setTimeout(() => initCategoryDropdownInModal(data.category || ""), 0);
    }

    config.forEach(f => {
  if (f.hidden) return;

  const span = f.col || 1; // 1,2,3 지원
  const spanClass = `col-span-1 md:col-span-${span}`;
  let html = "";

  if (f.img) {
    html = `
      <div class="flex flex-col md:flex-row gap-2 items-end">
        <div class="flex-1 w-full">
          <label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label>
          <input id="editor-input-${f.n}" value="${data[f.n] || ''}"
            class="w-full p-2.5 border rounded-lg text-sm bg-slate-50"
            placeholder="이미지 URL 직접 입력">
        </div>
        <label class="bg-slate-800 text-white px-4 py-2.5 rounded-lg cursor-pointer text-xs font-bold shrink-0 shadow-sm flex items-center justify-center w-full md:w-auto hover:bg-slate-700 transition">
          <i data-lucide="image" class="w-4 h-4 mr-1"></i> 파일 선택
          <input type="file" class="hidden" accept="image/*" onchange="window.handleImageUpload(this,'editor-input-${f.n}')">
        </label>
      </div>

      <img id="editor-preview-${f.n}" src="${data[f.n] || ''}"
        class="w-full h-32 object-cover mt-2 rounded-xl border bg-slate-50 ${data[f.n] ? '' : 'hidden'}">
    `;
  } else if (f.area) {
    html = `
      <div>
        <label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label>
        <textarea id="editor-input-${f.n}"
          class="w-full p-3 border rounded-xl text-sm h-24 resize-none bg-slate-50 focus:bg-white transition outline-none focus:border-blue-500">${data[f.n] || ''}</textarea>
      </div>
    `;
  } else if (f.chk) {
    html = `
      <label class="flex items-center gap-2 text-sm pt-4 cursor-pointer font-bold text-slate-700 h-full">
        <input type="checkbox" id="editor-input-${f.n}" ${data[f.n] ? 'checked' : ''}
          class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300">
        ${f.l}
      </label>
    `;
  } else {
    html = `
      <div>
        <label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label>
        <input id="editor-input-${f.n}" value="${data[f.n] || ''}"
          class="w-full p-3 border rounded-xl text-sm bg-slate-50 focus:bg-white transition outline-none focus:border-blue-500">
      </div>
    `;
  }

  fields.innerHTML += `<div class="${spanClass}">${html}</div>`;
});

    
    if(window.lucide) window.lucide.createIcons();
    document.getElementById("editor-delete-btn").classList.toggle("hidden", !id);
    modal.classList.remove("hidden");
};

// ✅ createdAt 덮어쓰기 방지 반영
window.saveEditor = async () => {
    const id = document.getElementById("editor-id").value;
    const type = document.getElementById("editor-type").value;

    const finalData = {};
    const colName = { "상품": COLLECTIONS.PRODUCTS, "공지": COLLECTIONS.NOTICES, "블로그": COLLECTIONS.BLOGS }[type];

    // 신규만 createdAt 설정, 수정은 유지
    if (!id) finalData.createdAt = Date.now();
    finalData.updatedAt = Date.now();

    const inputs = document.querySelectorAll(`[id^="editor-input-"]`);
    inputs.forEach(el => {
        const key = el.id.replace("editor-input-", "");
        if (el.type === 'checkbox') finalData[key] = el.checked;
        else finalData[key] = el.value;
    });

    if (type === '상품') {
        finalData.price = String(finalData.price || "").replace(/[^0-9]/g, "");
        if (finalData.salePrice) finalData.salePrice = String(finalData.salePrice).replace(/[^0-9]/g, "");
        if (!finalData.category) return window.showToast("카테고리를 선택해주세요", 'error');
    }

    try {
        if (id) await setDoc(doc(getPublicDataRef(colName), id), finalData, { merge: true });
        else await addDoc(getPublicDataRef(colName), finalData);

        document.getElementById("editor-modal").classList.add("hidden");
        window.showToast("저장되었습니다.");
        if (type === '상품') window.showAdminTab('products');
        if (type === '공지') window.showAdminTab('notices');
        if (type === '블로그') window.showAdminTab('blogs');
    } catch (e) { 
        console.error(e);
        window.showToast("저장 실패", 'error'); 
    }
};

// [기능 복구] 카테고리 칩 관리 로직 (유지: 다른 기능 누락 방지)
function renderCategoryChipsInModal(selectedCat = "") {
    const container = document.getElementById("category-chips");
    if (!container) return;
    state.isCategoryEditMode = false;
    const chips = state.configCategories.map(cat => {
        const isSelected = cat === selectedCat;
        return `<div class="relative group"><button onclick="window.selectCategory('${cat}')" class="category-chip px-3 py-1.5 rounded-lg text-xs font-bold border transition ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">${cat}</button><button onclick="window.removeCategory('${cat}')" class="cat-delete-btn hidden absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-sm"><i data-lucide="x" size="10"></i></button></div>`;
    }).join("");

    container.innerHTML = `<div class="flex flex-wrap gap-2 items-center">${chips}</div><div class="mt-3 flex gap-2 items-center"><button id="cat-edit-toggle" onclick="window.toggleCategoryEdit()" class="text-xs text-slate-500 underline font-medium hover:text-slate-800">편집</button><div id="cat-add-group" class="flex gap-1 hidden"><input id="new-cat-input" placeholder="새 카테고리" class="border rounded px-2 py-1 text-xs w-24 outline-none focus:border-blue-500"><button onclick="window.addCategory()" class="bg-slate-800 text-white px-2 py-1 rounded-xl hover:bg-slate-700">추가</button></div></div>`;
    if(window.lucide) window.lucide.createIcons();
}

// ✅ 드롭다운 검색 UI 초기화
function initCategoryDropdownInModal(selectedCat = "") {
  const input = document.getElementById("category-search-input");
  const dropdown = document.getElementById("category-dropdown");
  const hidden = document.getElementById("editor-input-category");
  const label = document.getElementById("category-selected-label");
  if (!input || !dropdown || !hidden || !label) return;

  // "실제 존재하는 카테고리만" 노출
  const cats = Array.from(new Set(
    (allProductsCache || [])
      .map(p => normalizeCategory(p.category))
      .filter(Boolean)
  ));

  const setSelected = (cat) => {
    hidden.value = cat;
    label.innerText = cat || "(미선택)";
    input.value = cat || "";
    dropdown.classList.add("hidden");
  };

  // 초기 선택값
  setSelected(selectedCat);

  const renderList = (term = "") => {
    const t = (term || "").trim().toLowerCase();
    const filtered = cats.filter(c => String(c).toLowerCase().includes(t));

    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="p-3 text-sm text-slate-400">검색 결과가 없습니다.</div>`;
      return;
    }

    dropdown.innerHTML = filtered.map(c => `
      <button type="button"
        class="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition ${c === hidden.value ? 'font-bold text-blue-600' : 'text-slate-700'}"
        data-cat="${c}"
      >${c}</button>
    `).join("");
  };

  input.addEventListener("focus", () => {
  dropdown.classList.remove("hidden");
  renderList(""); // ✅ 포커스 시 전체 목록 표시
    });

  input.addEventListener("input", () => {
    dropdown.classList.remove("hidden");
    renderList(input.value);
  });

  dropdown.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    setSelected(btn.getAttribute("data-cat"));
  });

  // 모달 외부 클릭 시 닫기 (모달 열 때마다 1회만)
  document.addEventListener("click", (e) => {
    const wrap = input.parentElement;
    if (!wrap.contains(e.target)) dropdown.classList.add("hidden");
  }, { once: true });
}

// [기능 복구] 카테고리 칩 편집 로직 (유지)
window.toggleCategoryEdit = () => {
    state.isCategoryEditMode = !state.isCategoryEditMode;
    document.querySelectorAll('.cat-delete-btn').forEach(btn => btn.classList.toggle('hidden', !state.isCategoryEditMode));
    const addGroup = document.getElementById('cat-add-group');
    if (addGroup) addGroup.classList.toggle('hidden', !state.isCategoryEditMode);
    const toggle = document.getElementById('cat-edit-toggle');
    if (toggle) toggle.innerText = state.isCategoryEditMode ? "완료" : "편집";
};

window.selectCategory = (cat) => { 
  const el = document.getElementById("editor-input-category");
  if (el) el.value = cat;
  renderCategoryChipsInModal(cat); 
};

window.addCategory = async () => {
    const val = normalizeCategory(document.getElementById("new-cat-input").value);
    if (!val) return;
    const newCats = Array.from(new Set([...state.configCategories, val]));
    await setDoc(getConfDoc(), { categories: newCats }, { merge: true });
};

window.removeCategory = async (cat) => {
    if (!confirm(`'${cat}' 카테고리를 삭제하시겠습니까?`)) return;
    const newCats = state.configCategories.filter(c => c !== cat);
    await setDoc(getConfDoc(), { categories: newCats }, { merge: true });
};

// =========================================
// 8. 공통 CRUD 동작
// =========================================

window.openProductModal = (id) => {
    if (!state.isAdmin) return window.showToast("권한이 없습니다.", "error");
    if (id && typeof id === 'string') { const p = state.productCache.find(x => x.id === id); window.openEditor("상품", id, p); } else window.openEditor("상품");
};

window.openNoticeModal = (id) => {
    if (!state.isAdmin) return window.showToast("권한이 없습니다.", "error");
    if (id && typeof id === 'string') getDoc(doc(getPublicDataRef(COLLECTIONS.NOTICES), id)).then(s => window.openEditor("공지", id, s.data())); else window.openEditor("공지");
};

window.openBlogModal = (id) => {
    if (!state.isAdmin) {
        // 일반 사용자는 블로그 상세보기 모달 열기
        if (id && typeof id === 'string') window.openBlogDetail(id);
        return;
    }
    // 관리자는 편집 모달 열기
    if (id && typeof id === 'string') getDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id)).then(s => window.openEditor("블로그", id, s.data())); else window.openEditor("블로그");
};

window.updateOrderStatus = async (id, newStatus) => {
    try { await updateDoc(doc(getPublicDataRef(COLLECTIONS.ORDERS), id), { status: newStatus }); window.showToast("주문 상태 변경 완료"); } 
    catch (e) { window.showToast("오류 발생", "error"); }
};

window.deleteOrder = async (id) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try { await deleteDoc(doc(getPublicDataRef(COLLECTIONS.ORDERS), id)); window.showToast("주문이 삭제되었습니다."); } 
    catch (e) { window.showToast("삭제 실패", "error"); }
};

window.deleteItem = async (colName, id) => {
    if(!colName && !id) {
        id = document.getElementById("editor-id").value;
        const type = document.getElementById("editor-type").value;
        colName = { "상품": COLLECTIONS.PRODUCTS, "공지": COLLECTIONS.NOTICES, "블로그": COLLECTIONS.BLOGS }[type];
    }
    if(colName === 'products') colName = COLLECTIONS.PRODUCTS;
    if(colName === 'blogs') colName = COLLECTIONS.BLOGS;

    if (!confirm("삭제하시겠습니까?")) return;
    await deleteDoc(doc(getPublicDataRef(colName), id));
    document.getElementById("editor-modal").classList.add("hidden");
    window.showToast("삭제되었습니다.");
};

window.deleteNotice = async(id) => window.deleteItem(COLLECTIONS.NOTICES, id);

window.deleteInquiry = async (id) => {
    if (!confirm("정말 이 문의를 삭제하시겠습니까?")) return;
    try {
        await deleteDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id));
        document.getElementById("inquiry-detail-modal").classList.add("hidden");
        window.showToast("문의가 삭제되었습니다.");
    } catch (e) {
        window.showToast("삭제 실패", "error");
    }
};

window.registerAnswer = async (id) => {
    const currentTextEl = document.getElementById(`inquiry-answer-text-${id}`);
    const currentText = currentTextEl ? currentTextEl.innerText.trim() : "";
    const isPlaceholder = currentText === "답변 대기중" || currentText === "아직 답변이 등록되지 않았습니다." || currentText === "";

    // [기능 복구] 프롬프트 대신 깔끔한 답변 모달 생성 (전역에 추가하되 매우 높은 z-index)
    if(!document.getElementById('answer-modal')) {
        const m = document.createElement('div');
        m.id = 'answer-modal';
        m.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 hidden';
        m.style.zIndex = '9999'; // 문의 상세 모달(z-300)보다 훨씬 높게
        m.innerHTML = `
            <div class="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl transform transition-all scale-100" onclick="event.stopPropagation()">
                <h3 class="text-lg font-bold mb-4 text-slate-800">답변 작성</h3>
                <textarea id="answer-input" class="w-full h-40 p-4 border border-slate-200 rounded-xl resize-none outline-none focus:border-blue-500 bg-slate-50 focus:bg-white transition text-sm leading-relaxed" placeholder="고객님께 전송될 답변을 입력하세요."></textarea>
                <div class="flex gap-2 mt-4 justify-end">
                    <button onclick="document.getElementById('answer-modal').classList.add('hidden')" class="px-4 py-2.5 rounded-xl text-slate-500 hover:bg-slate-100 font-bold text-sm transition">취소</button>
                    <button id="answer-submit-btn" class="px-6 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 text-sm shadow-lg transition">저장하기</button>
                </div>
            </div>`;
        // body에 직접 추가 (관리자만 사용하므로 안전)
        document.body.appendChild(m);

        // 모달 오버레이 클릭 시 닫기
        document.getElementById('answer-modal').onclick = (e) => {
            if (e.target.id === 'answer-modal') {
                document.getElementById('answer-modal').classList.add('hidden');
            }
        };
    }

    const modal = document.getElementById('answer-modal');
    const input = document.getElementById('answer-input');
    const btn = document.getElementById('answer-submit-btn');

    input.value = isPlaceholder ? "" : currentText;
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);

    btn.onclick = async () => {
        const newAnswer = input.value.trim();
        if (!newAnswer) return window.showToast("내용을 입력해주세요.", "error");

        btn.innerText = "저장 중...";
        btn.disabled = true;
        try {
            await updateDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id), { answer: newAnswer, answeredAt: Date.now() });
            window.showToast("답변이 등록되었습니다.");
            window.viewInquiryDetail(id);
            modal.classList.add('hidden');
        } catch (e) {
            console.error(e);
            window.showToast("등록 실패", "error");
        } finally {
            btn.innerText = "저장하기";
            btn.disabled = false;
        }
    };
};