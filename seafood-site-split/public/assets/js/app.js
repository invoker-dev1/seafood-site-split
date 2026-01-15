import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, addDoc, deleteDoc, query, orderBy, limit, startAfter, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const ADMIN_UID = "7OXzH2aIFZYH9jdJF23GuRdXMy63";
const firebaseConfig = { apiKey: "AIzaSyCPGbTBQv0-onTukNdr-KlQheMM1NEFkuA", authDomain: "dgss-58aec.firebaseapp.com", projectId: "dgss-58aec", storageBucket: "dgss-58aec.firebasestorage.app", messagingSenderId: "879356370168", appId: "1:879356370168:web:d5aab39fede28db175ef0d" };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = "seafood-store-real";

const COLLECTIONS = {
    CONFIG: 'storeConfig',
    PRODUCTS: 'products',
    ORDERS: 'orders',
    INQUIRIES: 'inquiries',
    NOTICES: 'notices',
    BLOGS: 'blogs',
    COMMENTS: 'blogComments'
};

let isAdmin = false;
let isDesignMode = false;
let currentCart = [];
let configCategories = [];
let productCache = [];
let menuFilterCategory = "all";
let currentBlogId = null;
let orderCache = [];
let isCategoryEditMode = false;
let visibleMenuCount = 20;

// Admin Listeners Memory Management
let adminListeners = {};
let lastOrderDoc = null; // For Pagination

const getPublicDataRef = (col) => collection(db, "artifacts", appId, "public", "data", col);
const getConfDoc = () => doc(db, "artifacts", appId, "public", "data", COLLECTIONS.CONFIG, "main");

// ---------- 유틸리티 & 애니메이션 ----------
window.showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (container.children.length > 2) container.removeChild(container.firstChild);

    const el = document.createElement('div');
    const color = type === 'error' ? 'bg-red-500' : (type === 'info' ? 'bg-blue-500' : 'bg-slate-800');
    el.className = `${color} text-white px-6 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-bold pointer-events-auto toast-enter backdrop-blur-md`;
    el.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle'}" size="18"></i> ${msg}`;
    container.appendChild(el);
    lucide.createIcons();
    setTimeout(() => { if (el.parentElement) el.parentElement.removeChild(el); }, 3000);
};

window.copyText = (text) => {
    const t = text.replace(/-/g, '');
    navigator.clipboard.writeText(t).then(() => window.showToast(`계좌번호가 복사되었습니다: ${t}`));
};

// 이미지 확대 (Lightbox)
window.openLightbox = (src) => {
    if (!src) return;
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox-modal').classList.remove('hidden');
};

function updateMap(address) {
    const iframe = document.getElementById("map-iframe");
    if (!iframe || !address) return;
    iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
}

window.shareSite = () => {
    if (navigator.share) {
        navigator.share({ title: '대광수산', text: '싱싱한 해산물을 만나보세요!', url: window.location.href });
    } else {
        navigator.clipboard.writeText(window.location.href);
        window.showToast("주소가 복사되었습니다.");
    }
};

window.toggleFab = () => {
    const m = document.getElementById('fab-menu');
    const b = document.getElementById('fab-main');
    m.classList.toggle('active');
    b.classList.toggle('active');
};

// 2. Scroll Reveal Observer
const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active');
    });
}, { threshold: 0.1 });

function observeElements() {
    document.querySelectorAll('.reveal').forEach(el => scrollObserver.observe(el));
}

// 1. Firebase Storage 업로드 로직
window.handleImageUpload = (input, targetId) => {
    const file = input.files[0];
    if (!file) return;

    const labelBtn = input.closest('label');
    if (labelBtn) labelBtn.innerText = "업로드 중...";

    window.showToast("이미지 최적화 및 업로드 중...", "info");

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX = 1024;
            let w = img.width;
            let h = img.height;
            if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } else { if (h > MAX) { w *= MAX / h; h = MAX; } }

            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            canvas.toBlob(async (blob) => {
                try {
                    const storagePath = `images/${Date.now()}.jpg`;
                    const storageRef = ref(storage, storagePath);
                    await uploadBytes(storageRef, blob);
                    const downloadURL = await getDownloadURL(storageRef);

                    if (targetId === 'heroImage') {
                        setDoc(getConfDoc(), { heroImage: downloadURL }, { merge: true }).then(() => window.showToast("배경 이미지가 변경되었습니다."));
                    } else {
                        const el = document.getElementById(targetId);
                        if (el) {
                            el.value = downloadURL;
                            const previewId = targetId.replace('input', 'preview');
                            const previewEl = document.getElementById(previewId);
                            if (previewEl) { previewEl.src = downloadURL; previewEl.classList.remove('hidden'); }
                            window.showToast("이미지가 업로드되었습니다.");
                        }
                    }
                } catch (error) {
                    console.error("Upload failed:", error);
                    window.showToast("이미지 업로드 실패 (Storage 설정 확인 필요)", "error");
                } finally {
                    if (labelBtn) labelBtn.innerHTML = `🖼️ 파일<input type="file" class="hidden" accept="image/*" onchange="window.handleImageUpload(this,'${targetId}')">`;
                }
            }, 'image/jpeg', 0.8);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// ---------- 2. 라우팅 (History API) & UI ----------
window.handleLogoClick = (e) => {
    if (isDesignMode) return;
    e.preventDefault();
    window.navigate('main');
};
window.handleTitleClick = (e) => {
    if (isDesignMode) { e.stopPropagation(); window.handleEdit('storeName', '상호명'); }
    else { e.preventDefault(); window.navigate('main'); }
};

const PAGE_TITLES = {
    'main': '바다의 먹거리 - 대광수산',
    'menu': '전체 메뉴 | 대광수산',
    'order': '주문하기 | 대광수산',
    'inquiry': '문의하기 | 대광수산',
    'location': '매장 오시는 길 | 대광수산',
    'blog-page': '대광 소식통 | 대광수산'
};

const PAGE_DESCRIPTIONS = {
    'main': '노량진 수산시장 대광수산. 당일 조업한 신선한 활어회, 해산물을 산지 직송으로 만나보세요. 전국 택배 가능.',
    'menu': '대광수산의 신선한 활어회, 해산물 전체 메뉴입니다. 제철 횟감을 확인해보세요.',
    'order': '간편하게 주문서를 작성하고 신선한 회를 배송받으세요. 당일 발송 원칙.',
    'inquiry': '대광수산에 궁금한 점을 남겨주세요. 친절하게 답변해 드립니다.',
    'location': '노량진 수산시장 1층 100호 대광수산 찾아오시는 길 안내.',
    'blog-page': '대광수산의 생생한 현장 소식과 제철 수산물 정보를 전해드립니다.'
};

window.navigate = (page, addToHistory = true) => {
    if (addToHistory) history.pushState({ page }, "", `#${page}`);

    const title = PAGE_TITLES[page] || '대광수산';
    const desc = PAGE_DESCRIPTIONS[page] || PAGE_DESCRIPTIONS['main'];

    document.title = title;
    document.getElementById('og-title').setAttribute('content', title);
    document.getElementById('meta-desc').setAttribute('content', desc);
    document.getElementById('og-desc').setAttribute('content', desc);
    document.getElementById('canonical-url').setAttribute('href', `https://dgss-58aec.web.app/#${page}`);
    document.getElementById('og-url').setAttribute('content', `https://dgss-58aec.web.app/#${page}`);

    document.querySelectorAll("[data-page]").forEach(s => s.classList.toggle("page-hidden", s.getAttribute("data-page") !== page));
    document.querySelectorAll("[data-page-link]").forEach(l => l.classList.toggle("page-nav-active", l.getAttribute("data-page-link") === page));
    document.querySelectorAll("[data-mobile-nav]").forEach(b => { const a = b.getAttribute("data-mobile-nav") === page; b.classList.toggle("mobile-nav-active", a); b.classList.toggle("text-gray-400", !a); });

    window.scrollTo(0, 0);

    if (page === "menu") {
        menuFilterCategory = "all";
        visibleMenuCount = 20;
        renderCategoryTabs();
        renderAllMenu();
        window.addEventListener('scroll', handleMenuScroll);
    } else {
        window.removeEventListener('scroll', handleMenuScroll);
    }

    if (page === "inquiry") {
        document.getElementById('inq-name').value = '';
        document.getElementById('inq-phone').value = '';
        document.getElementById('inq-content').value = '';
    }
    if (page === "blog-page") renderFullBlogList();
    if (page === "order") setTimeout(() => document.getElementById("order-form").scrollIntoView({ behavior: "smooth", block: "center" }), 300);

    setTimeout(observeElements, 100);
};

window.onpopstate = (event) => {
    const hash = window.location.hash.slice(1);
    const page = hash || 'main';
    window.navigate(page, false);
};

const validatePhone = (phone) => {
    const regex = /^[0-9]{2,3}-?[0-9]{3,4}-?[0-9]{4}$/;
    return regex.test(phone);
};

window.openInquirySearch = () => {
    document.getElementById('search-result-area').classList.add('hidden');
    document.getElementById('inquiry-list').innerHTML = '';
    document.getElementById('search-name').value = '';
    document.getElementById('search-phone').value = '';
    document.getElementById('inquiry-search-modal').classList.remove('hidden');
};

// Notice Functions
window.openNoticeListModal = () => {
    document.getElementById('notice-list-modal').classList.remove('hidden');
    const listContainer = document.getElementById('notice-full-list');
    listContainer.innerHTML = '<div class="text-center text-slate-400 py-4">로딩 중...</div>';

    onSnapshot(query(getPublicDataRef(COLLECTIONS.NOTICES), orderBy("createdAt", "desc")), (snap) => {
        if (snap.empty) {
            listContainer.innerHTML = '<div class="text-center text-slate-400 py-4">등록된 공지가 없습니다.</div>';
            return;
        }
        listContainer.innerHTML = snap.docs.map(d => {
            const n = d.data();
            return `
                    <div class="border-b border-gray-100 py-3 last:border-0 hover:bg-slate-50 p-2 rounded cursor-pointer" onclick="window.viewNoticeDetail('${d.id}')">
                        <div class="flex justify-between items-start mb-1">
                            <h4 class="font-bold text-sm text-slate-900 line-clamp-1">${n.title}</h4>
                            <span class="text-xs text-slate-400 whitespace-nowrap ml-2">${new Date(n.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p class="text-xs text-slate-500 line-clamp-2">${n.content}</p>
                    </div>
                `;
        }).join('');
    });
};

window.viewNoticeDetail = (id) => {
    getDoc(doc(getPublicDataRef(COLLECTIONS.NOTICES), id)).then(s => {
        const n = s.data();
        document.getElementById("notice-popup-title").innerText = n.title;
        document.getElementById("notice-popup-content").innerText = n.content;
        document.getElementById("notice-popup-modal").classList.remove("hidden");
    });
};

window.deleteNotice = async (id) => {
    if (confirm("정말 삭제하시겠습니까?")) {
        await deleteDoc(doc(getPublicDataRef(COLLECTIONS.NOTICES), id));
        window.showToast("삭제되었습니다.");
        // No tab refresh needed here as listener updates automatically
    }
};

window.openNoticeEditor = () => window.openNoticeModal();

// ---------- 상품 및 카테고리 로직 ----------
function normalizeCategory(name) { return String(name || "").trim(); }

window.toggleCategoryEdit = () => {
    isCategoryEditMode = !isCategoryEditMode;
    document.querySelectorAll('.cat-delete-btn').forEach(btn => btn.classList.toggle('hidden', !isCategoryEditMode));
    document.getElementById('cat-add-group').classList.toggle('hidden', !isCategoryEditMode);
    document.getElementById('cat-edit-toggle').innerText = isCategoryEditMode ? "완료" : "편집";
};

function renderCategoryChipsInModal(selectedCat = "") {
    const container = document.getElementById("category-chips");
    if (!container) return;
    isCategoryEditMode = false;
    const chips = configCategories.map(cat => {
        const isSelected = cat === selectedCat;
        return `
            <div class="relative group">
                <button onclick="window.selectCategory('${cat}')" class="category-chip px-3 py-1 rounded-full text-xs font-bold border ${isSelected ? 'selected' : 'bg-white text-slate-600 border-slate-200'}">${cat}</button>
                <button onclick="window.removeCategory('${cat}')" class="cat-delete-btn hidden absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"><i data-lucide="x" size="10"></i></button>
            </div>
        `;
    }).join("");

    container.innerHTML = `<div class="flex flex-wrap gap-2 items-center">${chips}</div>
        <div class="mt-2 flex gap-2 items-center">
            <button id="cat-edit-toggle" onclick="window.toggleCategoryEdit()" class="text-xs text-slate-500 underline">편집</button>
            <div id="cat-add-group" class="flex gap-1 hidden">
                <input id="new-cat-input" placeholder="새 카테고리" class="border rounded px-2 py-1 text-xs w-24">
                <button onclick="window.addCategory()" class="bg-slate-800 text-white px-2 py-1 rounded text-xs">추가</button>
            </div>
        </div>`;
    lucide.createIcons();
}

window.selectCategory = (cat) => { document.getElementById("editor-input-category").value = cat; renderCategoryChipsInModal(cat); };
window.addCategory = async () => {
    const val = normalizeCategory(document.getElementById("new-cat-input").value);
    if (!val) return;
    const newCats = Array.from(new Set([...configCategories, val]));
    await setDoc(getConfDoc(), { categories: newCats }, { merge: true });
};
window.removeCategory = async (cat) => {
    if (!confirm(`'${cat}' 삭제?`)) return;
    const newCats = configCategories.filter(c => c !== cat);
    await setDoc(getConfDoc(), { categories: newCats }, { merge: true });
};

// ---------- 메뉴 & 추천 상품 렌더링 ----------
function renderFeatured() {
    const list = document.getElementById("product-list");
    const menuFeaturedList = document.getElementById("menu-featured-list");
    const featuredItems = productCache.filter(p => p.featured).slice(0, 3);

    const html = featuredItems.length === 0
        ? `<div class="col-span-full text-center py-20 text-slate-400 bg-slate-50 rounded-xl border border-dashed flex-1">오늘의 추천 상품을 준비 중입니다.</div>`
        : featuredItems.map(p => createProductCard(p, true)).join("");

    if (list) list.innerHTML = html;
    if (menuFeaturedList) {
        menuFeaturedList.innerHTML = html;
        // 메뉴 페이지: '전체보기'일 때만 추천 노출
        const container = document.getElementById("menu-featured-container");
        if (menuFilterCategory === 'all' && featuredItems.length > 0) {
            container.classList.remove("hidden");
        } else {
            container.classList.add("hidden");
        }
    }
    lucide.createIcons();
    observeElements();
}

function createProductCard(p, isFeaturedSection = false) {
    const safeName = String(p.name ?? "").replace(/'/g, "\\'");
    const originalPrice = Number(p.price || 0);
    const salePrice = p.salePrice ? Number(p.salePrice) : 0;

    const isSale = salePrice > 0 && salePrice < originalPrice;
    const finalPrice = isSale ? salePrice : originalPrice;
    const discountRate = isSale ? Math.round((originalPrice - salePrice) / originalPrice * 100) : 0;

    const safePrice = String(finalPrice);
    const imgSrc = p.image || '';
    // Lightbox 기능 추가
    const imgTag = imgSrc
        ? `<img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-110 transition duration-500 cursor-pointer" onclick="event.stopPropagation(); window.openLightbox('${imgSrc}')">`
        : `<div class="w-full h-full img-fallback"><span>NO IMAGE</span></div>`;

    // 4. 가격 표시 디자인 개선
    const priceDisplay = isSale
        ? `<div class="flex flex-col items-end">
             <span class="text-xs text-slate-400 line-through">${originalPrice.toLocaleString()}원</span>
             <div class="flex items-center gap-1">
               <span class="text-red-500 font-bold text-sm">${discountRate}%</span>
               <span class="text-blue-600 font-extrabold text-lg">${finalPrice.toLocaleString()}원</span>
             </div>
           </div>`
        : `<span class="text-blue-600 font-bold text-lg">${originalPrice.toLocaleString()}원</span>`;

    if (isFeaturedSection) {
        // 가로 스크롤을 위한 클래스 추가 (snap-center, min-w)
        return `
            <div class="snap-center min-w-[280px] md:min-w-0 bg-white rounded-3xl shadow-sm overflow-hidden border border-slate-100 hover:shadow-xl transition group relative ${p.soldOut ? 'sold-out' : ''}">
                <div class="h-64 overflow-hidden bg-slate-100 img-container img-zoom-container">
                    ${imgTag}
                    <div class="absolute top-4 left-4 bg-yellow-400 text-xs font-bold px-3 py-1 rounded-full shadow-sm z-20">BEST</div>
                    ${isSale ? `<div class="absolute top-4 right-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm z-20">SALE ${discountRate}%</div>` : ''}
                    ${p.soldOut ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}
                </div>
                <div class="p-6">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center gap-2 flex-1 min-w-0">
                            <h3 class="font-bold text-xl text-slate-900 truncate">${p.name}</h3>
                            ${p.unit ? `<span class="text-[10px] text-slate-500 bg-slate-100 px-2 py-1 rounded shrink-0">${p.unit}</span>` : ''}
                        </div>
                    </div>
                    <p class="text-sm text-slate-500 mb-4 line-clamp-1 h-5">${p.description || ''}</p>
                    <div class="flex justify-between items-center mb-6">
                        ${priceDisplay}
                    </div>
                    <div class="pt-4 border-t border-dashed border-slate-200">
                    ${!p.soldOut ? `
                        <div class="flex items-center gap-3">
                            <div class="flex items-center bg-slate-50 rounded-xl p-1 border border-slate-100">
                                <button onclick="window.adjustQty(this, -1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">-</button>
                                <span class="text-sm font-bold w-8 text-center qty-display">1</span>
                                <button onclick="window.adjustQty(this, 1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">+</button>
                            </div>
                            <button onclick="window.addToCartWithQty(this, '${p.id}', '${safeName}', '${safePrice}')" class="flex-1 bg-theme hover:opacity-90 text-white py-2.5 rounded-xl text-sm font-bold transition shadow-md">담기</button>
                        </div>
                    ` : `<button disabled class="w-full bg-slate-200 text-slate-400 py-2.5 rounded-xl text-sm font-bold cursor-not-allowed">품절</button>`}
                    </div>
                </div>
            </div>
          `;
    }
    return "";
}

// 추가 요청 2. 무한 스크롤 (Client-side Pagination)
function renderAllMenu() {
    const list = document.getElementById("all-menu-list");
    if (!list) return;

    let filtered = [...productCache];
    if (menuFilterCategory !== "all") {
        filtered = filtered.filter(p => normalizeCategory(p.category) === menuFilterCategory);
        // 카테고리 필터 시 Best(featured)를 맨 앞으로 정렬
        filtered.sort((a, b) => (b.featured - a.featured) || a.name.localeCompare(b.name));
    } else {
        // 전체보기 시 추천상품 섹션이 있으므로 리스트에서는 제외하거나 그대로 둠.
        // 요청사항: "전체보기에서만 보이게해주고(추천섹션)..." -> 추천섹션은 renderFeatured에서 제어.
        // 리스트는 전체 다 보여주되, 추천상품이 중복되어도 상관없다면 둠.
        // 여기서는 깔끔하게 추천상품을 제외할지 여부는 사용자 선택이나, 보통 전체 리스트에도 포함됨.
        filtered.sort((a, b) => (b.featured - a.featured) || a.name.localeCompare(b.name));
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="col-span-full p-16 text-center text-slate-400 flex flex-col items-center gap-4"><i data-lucide="package-open" size="48" class="text-slate-300"></i><p>등록된 메뉴가 없습니다.</p></div>';
        lucide.createIcons();
        document.getElementById('infinite-scroll-trigger').classList.add('hidden');
        return;
    }

    // 무한 스크롤: 현재 개수만큼 자르기
    const itemsToShow = filtered.slice(0, visibleMenuCount);
    const hasMore = filtered.length > visibleMenuCount;

    list.innerHTML = itemsToShow.map(p => {
        const originalPrice = Number(p.price || 0);
        const salePrice = p.salePrice ? Number(p.salePrice) : 0;

        const isSale = salePrice > 0 && salePrice < originalPrice;
        const finalPrice = isSale ? salePrice : originalPrice;
        const discountRate = isSale ? Math.round((originalPrice - salePrice) / originalPrice * 100) : 0;

        const safeName = String(p.name ?? "").replace(/'/g, "\\'");
        const safePrice = String(finalPrice);

        const imgSrc = p.image || '';
        const imgTag = imgSrc
            ? `<img src="${imgSrc}" class="w-full h-full object-cover cursor-pointer" onclick="event.stopPropagation(); window.openLightbox('${imgSrc}')">`
            : `<div class="w-full h-full img-fallback"><span>이미지 없음</span></div>`;

        const priceDisplay = isSale
            ? `<div class="flex flex-col items-end">
                 <span class="text-[10px] text-slate-400 line-through">${originalPrice.toLocaleString()}원</span>
                 <div class="flex items-center gap-1">
                   <span class="text-red-500 font-bold text-xs">${discountRate}%</span>
                   <span class="text-blue-600 font-bold text-base">${finalPrice.toLocaleString()}원</span>
                 </div>
               </div>`
            : `<span class="font-bold text-base text-blue-600">${originalPrice.toLocaleString()}원</span>`;

        return `
                <div class="flex flex-col items-start p-4 gap-3 hover:bg-slate-50 transition bg-white border border-slate-100 rounded-2xl shadow-sm group ${p.soldOut ? 'sold-out' : ''}">
                    <div class="w-full h-48 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 img-container relative img-zoom-container">
                        ${imgTag}
                        ${p.featured ? '<span class="absolute top-0 left-0 bg-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded-br-lg z-20">BEST</span>' : ''}
                        ${isSale ? `<span class="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg z-20">SALE</span>` : ''}
                        ${p.soldOut ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}
                    </div>
                    <div class="w-full">
                        <div class="flex justify-between items-start">
                            <div class="flex items-center gap-2">
                                <h4 class="font-bold text-lg text-slate-900 leading-tight">${p.name}</h4>
                                ${p.unit ? `<span class="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">${p.unit}</span>` : ''}
                            </div>
                        </div>
                        <div class="text-xs text-slate-500 mt-1 space-y-0.5">
                            <p class="line-clamp-1">${p.description || ''}</p>
                        </div>
                        <div class="flex justify-between items-center mt-3">
                            ${priceDisplay}
                        </div>
                    </div>
                    <div class="w-full mt-auto pt-3 border-t border-dashed border-slate-100">
                        ${!p.soldOut ? `
                        <div class="flex items-center gap-3">
                            <div class="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-100">
                                <button onclick="window.adjustQty(this, -1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">-</button>
                                <span class="text-sm font-bold w-6 text-center qty-display">1</span>
                                <button onclick="window.adjustQty(this, 1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">+</button>
                            </div>
                            <button onclick="window.addToCartWithQty(this, '${p.id}', '${safeName}', '${safePrice}')" class="flex-1 bg-theme hover:opacity-90 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition">
                                담기
                            </button>
                        </div>
                        ` : `
                        <button disabled class="w-full bg-slate-200 text-slate-400 py-2 rounded-lg text-sm font-bold cursor-not-allowed">품절</button>
                        `}
                    </div>
                </div>
            `;
    }).join('');

    lucide.createIcons();

    // 더보기 트리거 제어
    const trigger = document.getElementById('infinite-scroll-trigger');
    if (hasMore) {
        trigger.classList.remove('hidden');
    } else {
        trigger.classList.add('hidden');
    }
}

// 무한 스크롤 핸들러
function handleMenuScroll() {
    const trigger = document.getElementById('infinite-scroll-trigger');
    if (trigger.classList.contains('hidden')) return;

    const rect = trigger.getBoundingClientRect();
    if (rect.top <= window.innerHeight) {
        visibleMenuCount += 20;
        renderAllMenu();
    }
}

window.adjustQty = (btn, delta) => {
    const display = btn.parentElement.querySelector('.qty-display');
    let current = parseInt(display.innerText);
    current += delta;
    if (current < 1) current = 1;
    display.innerText = current;
};

window.addToCartWithQty = (btn, id, name, price) => {
    const qty = parseInt(btn.parentElement.querySelector('.qty-display').innerText);
    window.addToCart(id, name, price, qty);
};

function renderCategoryTabs() {
    const tabEl = document.getElementById("menu-category-tabs");
    if (!tabEl) return;
    const activeCats = Array.from(new Set([...configCategories, ...productCache.map(p => normalizeCategory(p.category)).filter(Boolean)]));
    tabEl.innerHTML = `
            <button onclick="window.setMenuCategory('all')" class="px-5 py-2 rounded-full text-sm font-bold border transition-all ${menuFilterCategory === 'all' ? "bg-theme text-white border-theme shadow-md ring-2 ring-blue-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}">전체보기</button>
        ` + activeCats.map(cat => `
            <button onclick="window.setMenuCategory('${cat}')" class="px-5 py-2 rounded-full text-sm font-bold border transition-all ${menuFilterCategory === cat ? "bg-theme text-white border-theme shadow-md ring-2 ring-blue-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}">${cat}</button>
        `).join("");
}
window.setMenuCategory = (cat) => {
    menuFilterCategory = cat;
    visibleMenuCount = 20; // 카테고리 변경 시 초기화
    renderCategoryTabs();
    // 렌더 함수 내에서 추천상품 표시 여부 처리함
    renderFeatured();
    renderAllMenu();
};

// ---------- 블로그 렌더링 ----------
function renderBlogs() {
    const grid = document.getElementById("main-blog-list");
    if (!grid) return;

    onSnapshot(query(getPublicDataRef(COLLECTIONS.BLOGS), orderBy("createdAt", "desc")), (snap) => {
        let blogs = [];
        snap.forEach(d => blogs.push({ id: d.id, ...d.data() }));
        if (!isAdmin) blogs = blogs.filter(b => !b.isHidden);

        if (blogs.length === 0) {
            grid.innerHTML = "<div class='col-span-full py-16 text-center text-slate-400'>게시글이 없습니다.</div>";
            return;
        }

        const latest = blogs[0];
        const others = blogs.slice(1, 5);

        let html = `
                <div class="lg:col-span-1 cursor-pointer group" onclick="window.openBlogDetail('${latest.id}')">
                    <div class="aspect-video lg:aspect-square bg-slate-200 rounded-3xl overflow-hidden mb-5 relative shadow-md img-zoom-container">
                        <img src="${latest.image || ''}" class="w-full h-full object-cover">
                        <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent flex items-end p-8">
                            <div class="text-white">
                                <span class="bg-blue-600 text-xs px-3 py-1 rounded-full font-bold mb-3 inline-block shadow-lg">NEW</span>
                                <h3 class="text-2xl font-bold line-clamp-2 drop-shadow-lg leading-tight">${latest.title}</h3>
                            </div>
                        </div>
                    </div>
                    <p class="text-slate-600 text-sm line-clamp-3 leading-relaxed px-2">${latest.content}</p>
                </div>
                <div class="lg:col-span-2 flex flex-col gap-4">
            `;

        others.forEach(b => {
            html += `
                    <div class="flex gap-5 p-4 bg-white border border-slate-100 rounded-2xl hover:shadow-lg transition cursor-pointer items-center group" onclick="window.openBlogDetail('${b.id}')">
                        <div class="w-24 h-24 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0 img-zoom-container">
                            <img src="${b.image || ''}" class="w-full h-full object-cover">
                        </div>
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold text-slate-900 truncate text-lg group-hover:text-theme transition-colors">${b.title}</h4>
                            <p class="text-sm text-slate-500 line-clamp-2 mt-1.5 leading-relaxed">${b.content}</p>
                            <span class="text-xs text-slate-400 mt-2 block">${new Date(b.createdAt).toLocaleDateString()}</span>
                        </div>
                        <i data-lucide="chevron-right" class="text-slate-300 group-hover:translate-x-1 transition-transform" size="20"></i>
                    </div>
                `;
        });

        html += `</div>`;
        grid.innerHTML = html;
        lucide.createIcons();
        observeElements();
    });
}

function renderFullBlogList() {
    const list = document.getElementById("full-blog-list");
    if (!list) return;
    onSnapshot(query(getPublicDataRef(COLLECTIONS.BLOGS), orderBy("createdAt", "desc")), (snap) => {
        list.innerHTML = snap.docs.map(d => {
            const b = d.data();
            if (!isAdmin && b.isHidden) return '';
            return `
                    <div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden cursor-pointer hover:shadow-xl transition group" onclick="window.openBlogDetail('${d.id}')">
                        <div class="h-56 bg-slate-100 relative img-zoom-container">
                            <img src="${b.image || ''}" class="w-full h-full object-cover">
                            ${b.isHidden ? '<div class="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold backdrop-blur-sm">숨김 처리됨</div>' : ''}
                        </div>
                        <div class="p-6">
                            <h4 class="font-bold text-xl truncate mb-3 text-slate-900 group-hover:text-theme transition-colors">${b.title}</h4>
                            <p class="text-base text-slate-500 line-clamp-2 leading-relaxed">${b.content}</p>
                            <div class="mt-4 text-xs text-slate-400 font-medium">${new Date(b.createdAt).toLocaleDateString()}</div>
                        </div>
                    </div>
                `;
        }).join('');
    });
}

// ---------- 블로그 상세/댓글 ----------
window.openBlogDetail = async (id) => {
    currentBlogId = id;
    const snap = await getDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id));
    if (!snap.exists()) return;
    const b = snap.data();

    document.getElementById("blog-detail-img-container").innerHTML = `<img src="${b.image}" class="w-full h-full object-cover">`;
    document.getElementById("blog-detail-text-content").innerHTML = `
            <h3 class="text-3xl md:text-4xl font-extrabold mb-6 leading-tight text-slate-900">${b.title} ${b.isHidden ? '<span class="text-red-500 text-lg align-middle">(숨김)</span>' : ''}</h3>
            <div class="text-slate-600 leading-loose whitespace-pre-wrap text-base md:text-lg">${b.content}</div>
            ${isAdmin ? `<div class="mt-8 pt-6 border-t border-slate-100 flex gap-3">
                <button onclick="window.deleteBlog('${id}')" class="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-100">글 삭제</button>
                <button onclick="window.toggleBlogHidden('${id}', ${b.isHidden})" class="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200">${b.isHidden ? '숨김 해제' : '숨기기'}</button>
            </div>` : ''}
        `;
    renderComments(id);
    document.getElementById("blog-modal").classList.remove("hidden");
};

window.deleteBlog = async (id) => {
    if (confirm("정말 삭제하시겠습니까?")) {
        await deleteDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id));
        document.getElementById("blog-modal").classList.add("hidden");
        window.showToast("게시글이 삭제되었습니다.");
    }
};
window.toggleBlogHidden = async (id, currentStatus) => {
    await updateDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id), { isHidden: !currentStatus });
    window.openBlogDetail(id);
};

function renderComments(id) {
    onSnapshot(query(getPublicDataRef(COLLECTIONS.COMMENTS), orderBy("createdAt", "asc")), (snap) => {
        const list = document.getElementById("blog-comments");
        const count = document.getElementById("blog-comment-count");
        let cList = [];
        snap.forEach(d => { if (d.data().blogId === id) cList.push({ id: d.id, ...d.data() }); });
        count.innerText = cList.length;
        list.innerHTML = cList.map(c => `
                <div class="bg-slate-50 p-4 rounded-2xl text-sm border border-slate-100 flex justify-between items-center">
                    <div><span class="font-bold text-theme mr-2">방문자</span> <span class="text-slate-700">${c.text}</span></div>
                    ${isAdmin ? `<button onclick="window.deleteComment('${c.id}')" class="text-red-400 text-xs ml-2 hover:bg-red-50 p-1 rounded"><i data-lucide="x" size="14"></i></button>` : ''}
                </div>
            `).join("");
        lucide.createIcons();
    });
}

window.deleteComment = async (cid) => { if (confirm("댓글 삭제?")) await deleteDoc(doc(getPublicDataRef(COLLECTIONS.COMMENTS), cid)); };
window.addComment = async () => {
    const input = document.getElementById("comment-input");
    if (!input.value.trim() || !currentBlogId) return;
    await addDoc(getPublicDataRef(COLLECTIONS.COMMENTS), { blogId: currentBlogId, text: input.value, createdAt: Date.now() });
    input.value = "";
};

// ---------- 에디터 시스템 ----------
window.openEditor = (type, id = null, data = {}) => {
    const modal = document.getElementById("editor-modal");
    document.getElementById("editor-title").innerText = id ? `${type} 수정` : `새 ${type} 등록`;
    document.getElementById("editor-id").value = id || "";
    document.getElementById("editor-type").value = type;
    const fields = document.getElementById("editor-fields");
    fields.innerHTML = "";

    const config = {
        // 5. 상품 에디터에 '할인가(salePrice)' 필드 추가
        "상품": [
            { n: "name", l: "상품명", col: 2 }, { n: "price", l: "정상가(원)" }, { n: "salePrice", l: "할인가(원, 선택)" },
            { n: "unit", l: "단위(예: 1kg)", col: 2 },
            { n: "category", l: "카테고리", hidden: true },
            { n: "image", l: "이미지", img: true, col: 2 }, { n: "description", l: "설명", area: true, col: 2 },
            { n: "featured", l: "메인 노출(오늘의 추천)", chk: true }, { n: "soldOut", l: "품절", chk: true }
        ],
        "공지": [{ n: "title", l: "제목", col: 2 }, { n: "content", l: "내용", area: true, col: 2 }, { n: "showPopup", l: "메인 팝업 노출", chk: true }],
        "블로그": [{ n: "title", l: "제목", col: 2 }, { n: "image", l: "대표 이미지", img: true, col: 2 }, { n: "content", l: "본문", area: true, col: 2 }]
    }[type];

    if (type === "상품") {
        fields.innerHTML += `
                <div class="col-span-2 mb-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <label class="text-xs text-slate-500 font-bold block mb-2">카테고리 설정</label>
                    <div id="category-chips" class="flex flex-wrap gap-2 mb-2"></div>
                    <input type="hidden" id="editor-input-category" value="${data.category || ''}">
                </div>
            `;
        setTimeout(() => renderCategoryChipsInModal(data.category), 0);
    }

    config.forEach(f => {
        if (f.hidden) return;
        const spanClass = f.col === 2 ? "col-span-2" : "col-span-1";
        let html = "";
        // 1. 사진 추가 기능 개선 (미리보기 추가)
        if (f.img) {
            html = `
                    <div class="flex gap-2 items-end">
                        <div class="flex-1">
                            <label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label>
                            <input id="editor-input-${f.n}" value="${data[f.n] || ''}" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm truncate focus:border-theme outline-none" placeholder="URL 입력 또는 우측 버튼">
                        </div>
                        <label class="bg-blue-50 text-blue-600 p-2.5 rounded-lg cursor-pointer text-xs font-bold shrink-0 hover:bg-blue-100 transition border border-blue-100 h-[42px] flex items-center">
                            🖼️ 파일<input type="file" class="hidden" accept="image/*" onchange="window.handleImageUpload(this,'editor-input-${f.n}')">
                        </label>
                    </div>
                    <img id="editor-preview-${f.n}" src="${data[f.n] || ''}" class="w-full h-32 object-cover mt-2 rounded-lg border border-slate-200 bg-slate-50 ${data[f.n] ? '' : 'hidden'}">
                `;
        } else if (f.area) {
            html = `<div><label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label><textarea id="editor-input-${f.n}" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm h-24 focus:border-theme outline-none resize-none">${data[f.n] || ''}</textarea></div>`;
        } else if (f.chk) {
            html = `<label class="flex items-center gap-2 text-sm pt-4 cursor-pointer font-bold text-slate-700"><input type="checkbox" id="editor-input-${f.n}" ${data[f.n] ? 'checked' : ''} class="w-5 h-5 text-theme rounded accent-theme"> ${f.l}</label>`;
        } else {
            html = `<div><label class="text-xs text-slate-500 block font-bold mb-1">${f.l}</label><input id="editor-input-${f.n}" value="${data[f.n] || ''}" class="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:border-theme outline-none"></div>`;
        }

        fields.innerHTML += `<div class="${spanClass}">${html}</div>`;
    });

    document.getElementById("editor-delete-btn").classList.toggle("hidden", !id);
    modal.classList.remove("hidden");
};

window.saveEditor = async () => {
    const id = document.getElementById("editor-id").value;
    const type = document.getElementById("editor-type").value;
    const finalData = { createdAt: Date.now() };
    const colName = { "상품": COLLECTIONS.PRODUCTS, "공지": COLLECTIONS.NOTICES, "블로그": COLLECTIONS.BLOGS }[type];

    const inputs = document.querySelectorAll(`[id^="editor-input-"]`);
    inputs.forEach(el => {
        const key = el.id.replace("editor-input-", "");
        if (el.type === 'checkbox') finalData[key] = el.checked;
        else finalData[key] = el.value;
    });

    if (type === '상품') {
        finalData.price = finalData.price.replace(/[^0-9]/g, "");
        if (finalData.salePrice) finalData.salePrice = finalData.salePrice.replace(/[^0-9]/g, "");
        if (!finalData.category) return window.showToast("카테고리를 선택해주세요", 'error');
    }

    try {
        if (id) await setDoc(doc(getPublicDataRef(colName), id), { ...finalData, updatedAt: Date.now() }, { merge: true });
        else await addDoc(getPublicDataRef(colName), finalData);
        document.getElementById("editor-modal").classList.add("hidden");
        window.showToast("저장되었습니다.");
        // Refresh Admin Lists if open
        if (type === '상품') window.showAdminTab('products');
        if (type === '공지') window.showAdminTab('notices'); // Fixed: Changed from inquiries to notices
    } catch (e) { window.showToast("저장 실패", 'error'); }
};

window.deleteItem = async () => {
    if (!confirm("삭제하시겠습니까?")) return;
    const id = document.getElementById("editor-id").value;
    const type = document.getElementById("editor-type").value;
    const colName = { "상품": COLLECTIONS.PRODUCTS, "공지": COLLECTIONS.NOTICES, "블로그": COLLECTIONS.BLOGS }[type];
    await deleteDoc(doc(getPublicDataRef(colName), id));
    document.getElementById("editor-modal").classList.add("hidden");
    window.showToast("삭제되었습니다.");
    if (type === '상품') window.showAdminTab('products');
    if (type === '공지') window.showAdminTab('notices');
};

window.openProductModal = (id) => {
    if (id && typeof id === 'string') {
        const p = productCache.find(x => x.id === id);
        window.openEditor("상품", id, p);
    } else window.openEditor("상품");
};
window.openNoticeModal = (id) => {
    if (id && typeof id === 'string') getDoc(doc(getPublicDataRef(COLLECTIONS.NOTICES), id)).then(s => window.openEditor("공지", id, s.data()));
    else window.openEditor("공지");
};
window.openBlogModal = (id) => {
    if (id && typeof id === 'string') getDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id)).then(s => window.openEditor("블로그", id, s.data()));
    else window.openEditor("블로그");
};

// ---------- Admin Dashboard Logic (FIXED & IMPROVED) ----------
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

    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
};

// Memory Leak Fix: Clear previous listeners before adding new ones
window.showAdminTab = (tabId) => {
    // Clear all existing admin listeners
    Object.values(adminListeners).forEach(unsubscribe => unsubscribe());
    adminListeners = {}; // Reset container

    // Sidebar active state
    document.querySelectorAll('.admin-sidebar-item').forEach(el => el.classList.remove('active'));
    const menuEl = document.getElementById(`menu-${tabId}`);
    if (menuEl) menuEl.classList.add('active');

    // Tab content visibility
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`admin-${tabId}`).classList.remove('hidden');

    // Close mobile sidebar automatically
    if (window.innerWidth < 768) {
        document.getElementById('admin-sidebar').classList.add('-translate-x-full');
        document.getElementById('admin-sidebar-overlay').classList.add('hidden');
    }

    if (tabId === 'home') renderAdminHome();
    if (tabId === 'orders') renderAdminOrders();
    if (tabId === 'products') renderAdminProducts();
    if (tabId === 'inquiries') renderAdminInquiries();
    if (tabId === 'notices') renderAdminNotices(); // NEW separate handler
    if (tabId === 'settings') renderAdminSettings();
};

function renderAdminHome() {
    // Real-time listener for Home stats
    adminListeners.orders = onSnapshot(query(getPublicDataRef(COLLECTIONS.ORDERS), where("status", "==", "new")), (snap) => {
        document.getElementById('dash-new-orders').innerText = snap.size;
    });
    adminListeners.products = onSnapshot(getPublicDataRef(COLLECTIONS.PRODUCTS), (snap) => {
        document.getElementById('dash-total-products').innerText = snap.size;
    });
    adminListeners.inquiries = onSnapshot(query(getPublicDataRef(COLLECTIONS.INQUIRIES), where("answer", "==", null)), (snap) => {
        document.getElementById('dash-pending-inquiries').innerText = snap.size;
    });
}

// Pagination Logic for Orders
window.loadMoreOrders = () => {
    if (!lastOrderDoc) return;

    const q = query(getPublicDataRef(COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'), startAfter(lastOrderDoc), limit(20));

    document.getElementById('admin-orders-loading').classList.remove('hidden');

    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js").then(({ getDocs }) => {
        getDocs(q).then(snap => {
            document.getElementById('admin-orders-loading').classList.add('hidden');
            if (snap.empty) {
                document.getElementById('btn-load-more-orders').classList.add('hidden');
                return;
            }

            lastOrderDoc = snap.docs[snap.docs.length - 1];
            const list = document.getElementById('admin-order-list');

            snap.forEach(d => {
                list.innerHTML += createOrderRow({ id: d.id, ...d.data() });
            });
        });
    });
};

function createOrderRow(o) {
    return `
            <tr class="admin-table-row hover:bg-slate-50 transition group">
                <td class="admin-table-td">
                    <span class="text-slate-500 text-xs font-mono">${new Date(o.createdAt).toLocaleString()}</span>
                </td>
                <td class="admin-table-td">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 uppercase">${o.name.substring(0, 1)}</div>
                        <div>
                            <div class="font-bold text-slate-800 text-sm">${o.name}</div>
                            <div class="text-xs text-slate-400">${o.phone}</div>
                        </div>
                    </div>
                </td>
                <td class="admin-table-td">
                    <div class="text-xs text-slate-500 truncate max-w-[200px]" title="${o.address}">${o.address}</div>
                </td>
                <td class="admin-table-td">
                    <div class="text-xs text-slate-600 max-h-16 overflow-y-auto whitespace-pre-wrap leading-relaxed bg-slate-50 p-2 rounded border border-slate-100">${o.product}</div>
                </td>
                <td class="admin-table-td">
                    <span class="saas-badge ${o.status === 'new' ? 'saas-badge-blue' : 'saas-badge-green'}">${o.status === 'new' ? '신규접수' : '처리완료'}</span>
                </td>
                <td class="admin-table-td text-right mobile-card-actions">
                    <button onclick="window.updateOrderStatus('${o.id}', '${o.status === 'new' ? 'done' : 'new'}')" class="saas-action-btn hover:text-blue-600 hover:bg-blue-50" title="상태변경"><i data-lucide="refresh-cw" size="16"></i></button>
                    <button onclick="window.deleteOrder('${o.id}')" class="saas-action-btn hover:text-red-500 hover:bg-red-50" title="삭제"><i data-lucide="trash-2" size="16"></i></button>
                </td>
            </tr>
        `;
}

function renderAdminOrders() {
    const list = document.getElementById('admin-order-list');
    list.innerHTML = '';
    document.getElementById('admin-orders-loading').classList.remove('hidden');
    document.getElementById('btn-load-more-orders').classList.add('hidden');

    // Initial Load with Limit
    const q = query(getPublicDataRef(COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'), limit(20));

    adminListeners.ordersList = onSnapshot(q, (snap) => {
        document.getElementById('admin-orders-loading').classList.add('hidden');
        if (snap.empty) {
            list.innerHTML = '<tr><td colspan="6" class="p-20 text-center text-slate-400 flex flex-col items-center gap-3"><i data-lucide="inbox" size="48" class="text-slate-200"></i><span class="font-medium">접수된 주문 내역이 없습니다.</span></td></tr>';
            lucide.createIcons();
            return;
        }

        lastOrderDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length >= 20) document.getElementById('btn-load-more-orders').classList.remove('hidden');

        list.innerHTML = snap.docs.map(d => createOrderRow({ id: d.id, ...d.data() })).join('');
        lucide.createIcons();
    });
}

function renderAdminProducts() {
    const list = document.getElementById('admin-product-list');
    adminListeners.productsList = onSnapshot(query(getPublicDataRef(COLLECTIONS.PRODUCTS), orderBy('createdAt', 'desc')), (snap) => {
        if (snap.empty) {
            list.innerHTML = '<tr><td colspan="6" class="p-20 text-center text-slate-400 flex flex-col items-center gap-3"><i data-lucide="package-open" size="48" class="text-slate-200"></i><span class="font-medium">등록된 상품이 없습니다.</span></td></tr>';
            lucide.createIcons();
            return;
        }
        list.innerHTML = snap.docs.map(d => {
            const p = d.data();
            return `
                    <tr class="admin-table-row hover:bg-slate-50 transition group">
                        <td class="admin-table-td"><img src="${p.image}" class="w-12 h-12 rounded-lg object-cover bg-slate-100 border border-slate-200 shadow-sm"></td>
                        <td class="admin-table-td">
                            <div class="font-bold text-slate-800 text-sm">${p.name}</div>
                            <div class="text-xs text-slate-400 block md:hidden mt-1">${p.category}</div>
                        </td>
                        <td class="admin-table-td">
                            <span class="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded hidden md:inline-block border border-slate-200">${p.category || '미분류'}</span>
                        </td>
                        <td class="admin-table-td">
                            ${p.salePrice
                    ? `<div class="flex flex-col"><span class="text-red-500 font-bold text-sm">${Number(p.salePrice).toLocaleString()}원</span> <span class="line-through text-xs text-slate-400">${Number(p.price).toLocaleString()}원</span></div>`
                    : `<span class="font-bold text-slate-700 text-sm">${Number(p.price).toLocaleString()}원</span>`}
                        </td>
                        <td class="admin-table-td">
                            ${p.soldOut ? '<span class="saas-badge saas-badge-red">품절</span>' : '<span class="saas-badge saas-badge-green">판매중</span>'}
                        </td>
                        <td class="admin-table-td text-right mobile-card-actions">
                            <button onclick="window.openProductModal('${d.id}')" class="saas-action-btn hover:text-blue-600 hover:bg-blue-50"><i data-lucide="edit-3" size="16"></i></button>
                            <button onclick="window.deleteItem('products','${d.id}')" class="saas-action-btn hover:text-red-500 hover:bg-red-50"><i data-lucide="trash-2" size="16"></i></button>
                        </td>
                    </tr>
                `;
        }).join('');
        lucide.createIcons();
    });
}

function renderAdminInquiries() {
    adminListeners.inquiriesList = onSnapshot(query(getPublicDataRef(COLLECTIONS.INQUIRIES), orderBy("createdAt", "desc"), limit(50)), (snap) => {
        const list = document.getElementById("admin-inquiry-list");
        if (snap.empty) {
            list.innerHTML = '<div class="p-20 text-center text-slate-400 flex flex-col items-center gap-3"><i data-lucide="message-square" size="48" class="text-slate-200"></i><span class="font-medium">등록된 문의가 없습니다.</span></div>';
            lucide.createIcons();
            return;
        }
        list.innerHTML = snap.docs.map(d => {
            const q = d.data();
            return `
                    <div class="p-5 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition group border-b border-slate-50 last:border-0" onclick="window.viewInquiryDetail('${d.id}')">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-3 mb-1.5">
                                <span class="font-bold text-sm text-slate-800">${q.name}</span>
                                <span class="text-xs text-slate-400">${new Date(q.createdAt).toLocaleDateString()}</span>
                                <span class="saas-badge ${q.answer ? 'saas-badge-green' : 'saas-badge-blue'}">${q.answer ? '답변완료' : '대기중'}</span>
                            </div>
                            <div class="text-sm text-slate-600 truncate w-full group-hover:text-slate-900 transition-colors">${q.content}</div>
                        </div>
                        <i data-lucide="chevron-right" class="text-slate-300 group-hover:text-slate-600 transition-transform group-hover:translate-x-1" size="20"></i>
                    </div>
                `;
        }).join('');
        lucide.createIcons();
    });
}

function renderAdminNotices() {
    adminListeners.noticesList = onSnapshot(query(getPublicDataRef(COLLECTIONS.NOTICES), orderBy("createdAt", "desc")), (snap) => {
        const list = document.getElementById("admin-notice-list");
        if (snap.empty) {
            list.innerHTML = '<div class="p-20 text-center text-slate-400 flex flex-col items-center gap-3"><i data-lucide="megaphone" size="48" class="text-slate-200"></i><span class="font-medium">등록된 공지가 없습니다.</span></div>';
            lucide.createIcons();
            return;
        }
        list.innerHTML = snap.docs.map(d => {
            const n = d.data();
            return `
                    <div class="p-5 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition group border-b border-slate-50 last:border-0" onclick="window.openNoticeModal('${d.id}')">
                        <div class="flex-1 min-w-0 pr-4">
                            <div class="font-bold text-sm mb-1 text-slate-800 truncate group-hover:text-blue-600 transition-colors">${n.title}</div>
                            <div class="text-xs text-slate-400 flex items-center gap-1"><i data-lucide="calendar" size="12"></i> ${new Date(n.createdAt).toLocaleDateString()}</div>
                        </div>
                        <button onclick="event.stopPropagation(); window.deleteNotice('${d.id}')" class="saas-action-btn hover:text-red-500 hover:bg-red-50 p-2"><i data-lucide="trash-2" size="18"></i></button>
                    </div>
                `;
        }).join('');
        lucide.createIcons();
    });
}

function renderAdminSettings() {
    getDoc(getConfDoc()).then(s => {
        const d = s.data() || {};
        const form = document.getElementById('admin-settings-form');
        form.storeName.value = d.storeName || '';
        form.ownerName.value = d.ownerName || '';
        form.bizNum.value = d.bizNum || '';
        form.csPhone.value = d.csPhone || '';
        form.address.value = d.address || '';
        form.bankName.value = d.bankName || '';
        form.bankNumber.value = d.bankNumber || '';
        form.bankOwner.value = d.bankOwner || '';
    });
}

window.saveAdminSettings = async () => {
    const form = document.getElementById('admin-settings-form');
    const data = {
        storeName: form.storeName.value,
        ownerName: form.ownerName.value,
        bizNum: form.bizNum.value,
        csPhone: form.csPhone.value,
        address: form.address.value,
        bankName: form.bankName.value,
        bankNumber: form.bankNumber.value,
        bankOwner: form.bankOwner.value
    };
    await setDoc(getConfDoc(), data, { merge: true });
    window.showToast("설정이 저장되었습니다.");
    location.reload();
};

// ---------- 장바구니 ----------
window.addToCart = (id, name, price, qty = 1) => {
    const existing = currentCart.find(item => item.id === id);
    if (existing) existing.qty += qty;
    else currentCart.push({ id, name, price: Number(String(price).replace(/[^0-9]/g, "")) || 0, qty: qty });
    updateCartUI();
    window.showToast(`${name} ${qty}개 담았습니다.`);
};
window.removeFromCart = (id) => { currentCart = currentCart.filter(item => item.id !== id); updateCartUI(); };
window.clearCart = () => { if (confirm("장바구니를 비우시겠습니까?")) { currentCart = []; updateCartUI(); } };

// 2. 빈 화면(Empty State) 아이콘 추가
function updateCartUI() {
    localStorage.setItem('seafoodCart', JSON.stringify(currentCart));
    const countEl = document.getElementById("cart-count"), listEl = document.getElementById("cart-items"), totalEl = document.getElementById("cart-total");
    const totalQty = currentCart.reduce((s, i) => s + i.qty, 0);
    if (totalQty > 0) { countEl.innerText = totalQty; countEl.classList.remove("hidden"); countEl.classList.add("cart-bounce"); setTimeout(() => countEl.classList.remove("cart-bounce"), 1000); } else countEl.classList.add("hidden");

    if (currentCart.length === 0) {
        listEl.innerHTML = `
            <div class="text-center text-slate-400 mt-20 flex flex-col items-center gap-4">
                <i data-lucide="shopping-basket" size="48" class="text-slate-200"></i>
                <p>장바구니가 비어있습니다.<br>맛있는 수산물을 담아보세요!</p>
            </div>`;
    } else {
        // 장바구니에 마이너스 버튼 추가
        listEl.innerHTML = currentCart.map(item => `
            <div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-4 last:border-0">
                <div>
                    <div class="font-bold text-slate-800 text-sm md:text-base">${item.name}</div>
                    <div class="text-xs md:text-sm text-slate-500 mt-1">${item.price.toLocaleString()}원</div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="window.addToCart('${item.id}','${item.name}','${item.price}', -1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 font-bold">-</button>
                    <span class="text-sm font-bold w-4 text-center">${item.qty}</span>
                    <button onclick="window.addToCart('${item.id}','${item.name}','${item.price}', 1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-blue-600 hover:bg-blue-100 font-bold">+</button>
                    <button onclick="window.removeFromCart('${item.id}')" class="text-red-400 p-1 ml-2"><i data-lucide="trash-2" size="18"></i></button>
                </div>
            </div>`).join("");
    }
    totalEl.innerText = currentCart.reduce((s, i) => s + (i.price * i.qty), 0).toLocaleString() + "원";
    lucide.createIcons();
}
window.toggleCart = () => {
    const s = document.getElementById("cart-sidebar"), o = document.getElementById("cart-overlay");
    if (s.classList.contains("translate-x-full")) { s.classList.remove("translate-x-full"); o.classList.remove("hidden"); } else { s.classList.add("translate-x-full"); o.classList.add("hidden"); }
};
window.checkout = () => {
    if (currentCart.length === 0) return window.showToast("장바구니가 비어있습니다.", 'error');
    const msg = `${currentCart.map(i => `${i.name} ${i.qty}개`).join(", ")}\n\n[총 결제금액: ${currentCart.reduce((s, i) => s + (i.price * i.qty), 0).toLocaleString()}원]`;
    document.getElementById("order-product").value = msg;
    window.toggleCart();
    window.navigate("order");
};

document.getElementById("orderForm").onsubmit = async (e) => {
    e.preventDefault();
    const phone = document.getElementById("order-phone").value;
    if (!validatePhone(phone)) return window.showToast("연락처 형식을 확인해주세요.", "error");

    const btn = document.getElementById("submitBtn");
    btn.disabled = true; btn.innerText = "전송 중...";
    try {
        await addDoc(getPublicDataRef(COLLECTIONS.ORDERS), {
            name: document.getElementById("order-name").value,
            phone: phone,
            address: document.getElementById("order-address").value,
            product: document.getElementById("order-product").value,
            status: 'new',
            createdAt: Date.now()
        });
        document.getElementById("order-success-modal").classList.remove("hidden");
        btn.disabled = false; btn.innerText = "주문 전송하기";
        currentCart = []; updateCartUI();
    } catch (e) { window.showToast("오류 발생", 'error'); btn.disabled = false; btn.innerText = "주문 전송하기"; }
};

// ---------- 1:1 문의 ----------
document.getElementById("inquiryForm").onsubmit = async (e) => {
    e.preventDefault();
    const phone = document.getElementById("inq-phone").value;
    if (!validatePhone(phone)) return window.showToast("연락처 형식을 확인해주세요.", "error");

    try {
        await addDoc(getPublicDataRef(COLLECTIONS.INQUIRIES), {
            name: document.getElementById("inq-name").value,
            phone: phone,
            content: document.getElementById("inq-content").value,
            answer: null,
            createdAt: Date.now()
        });
        window.showToast("문의가 등록되었습니다.");
        e.target.reset();
    } catch (e) { window.showToast("등록 실패", 'error'); }
};

window.searchInquiries = async () => {
    const name = document.getElementById("search-name").value;
    const phone = document.getElementById("search-phone").value;
    if (!name || !phone) return window.showToast("성함과 연락처를 모두 입력해주세요.", 'error');

    const listArea = document.getElementById("search-result-area");
    const listEl = document.getElementById("inquiry-list");
    listArea.classList.remove("hidden");
    listEl.innerHTML = '<div class="text-center py-4 text-xs text-slate-400">검색중...</div>';

    onSnapshot(getPublicDataRef(COLLECTIONS.INQUIRIES), (snap) => {
        const results = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.name === name && data.phone === phone) results.push({ id: d.id, ...data });
        });
        results.sort((a, b) => b.createdAt - a.createdAt);

        if (results.length === 0) {
            listEl.innerHTML = '<div class="text-center py-4 text-xs text-slate-400">일치하는 문의 내역이 없습니다.</div>';
        } else {
            listEl.innerHTML = results.map(q => `
                    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-blue-50" onclick="window.viewInquiryDetail('${q.id}')">
                        <div class="flex justify-between mb-1">
                            <span class="text-sm font-bold text-slate-700">${new Date(q.createdAt).toLocaleDateString()}</span>
                            <span class="text-xs ${q.answer ? 'text-blue-600 font-bold' : 'text-gray-400'}">${q.answer ? '답변완료' : '답변대기'}</span>
                        </div>
                        <p class="text-xs text-slate-500 truncate">${q.content}</p>
                    </div>
                `).join("");
        }
    });
};

window.viewInquiryDetail = async (id) => {
    const snap = await getDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id));
    if (!snap.exists()) return;
    const d = snap.data();

    document.getElementById("inquiry-detail-content").innerHTML = `
            <h3 class="text-xl font-bold mb-4">문의 내용</h3>
            <div class="bg-slate-50 p-4 rounded-xl mb-6 text-sm whitespace-pre-wrap text-slate-700 border border-slate-100">${d.content}</div>
            
            <h3 class="text-xl font-bold mb-4 text-blue-600">관리자 답변</h3>
            <div id="inquiry-answer-text-${id}" class="bg-blue-50 p-4 rounded-xl text-sm whitespace-pre-wrap border border-blue-100 min-h-[100px] text-slate-800">
                ${d.answer ? d.answer : '<span class="text-slate-400">아직 답변이 등록되지 않았습니다.</span>'}
            </div>
            ${isAdmin ? `<div class="mt-4 flex gap-2">
    <button onclick="window.registerAnswer('${id}')" class="flex-1 bg-blue-600 text-white py-2 rounded text-xs font-bold">답변 등록/수정</button>
    <button onclick="window.deleteInquiry('${id}')" class="flex-1 bg-red-100 text-red-600 py-2 rounded text-xs font-bold">삭제</button>
</div>` : ''}
        `;
    document.getElementById("inquiry-detail-modal").classList.remove("hidden");
};

window.deleteInquiry = async (id) => {
    if (confirm("삭제하시겠습니까?")) {
        await deleteDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id));
        document.getElementById("inquiry-detail-modal").classList.add("hidden");
        window.showToast("삭제되었습니다.");
    }
};

// ---------- Auth & Mode ----------
window.toggleDesignMode = () => {
    isDesignMode = !isDesignMode;
    document.body.classList.toggle("design-mode", isDesignMode);
    window.showToast(isDesignMode ? "디자인 수정 모드 ON" : "디자인 수정 완료");
};

window.openLoginModal = () => isAdmin ? window.openAdminDashboard() : (document.getElementById("login-modal").classList.remove("hidden"));

// 2. 로그인 유지 설정 추가
window.tryLogin = async () => {
    try {
        await setPersistence(auth, browserLocalPersistence); // 로그인 유지 설정
        const u = await signInWithEmailAndPassword(auth, document.getElementById("admin-id").value, document.getElementById("admin-pw").value);
        if (u.user.uid !== ADMIN_UID) { await signOut(auth); throw new Error("권한 없음"); }
        isAdmin = true;
        document.body.classList.add("admin-mode");
        document.getElementById("login-modal").classList.add("hidden");
        window.showToast("관리자 접속 완료");
        window.openAdminDashboard(); // Auto open dashboard
    } catch (e) { window.showToast("로그인 실패: 아이디/비번을 확인하세요", 'error'); }
};

window.exitAdminMode = async () => {
    isAdmin = false;
    document.body.classList.remove("admin-mode");
    try { await signOut(auth); await signInAnonymously(auth); } catch (e) { }
    window.closeAdminDashboard();
    window.showToast("관리자 종료");
};

window.handleEdit = async (f, l) => {
    if (!isDesignMode) return;
    const el = document.getElementById(getFieldId(f));
    const currentVal = el?.innerText ?? "";
    const v = prompt(`${l} 수정:`, currentVal);
    if (v !== null) { await setDoc(getConfDoc(), { [f]: v }, { merge: true }); if (f === "address") updateMap(v); }
};

function getFieldId(f) {
    return {
        storeName: "store-name-display", heroTitle: "hero-title-display", heroSubtitle: "hero-subtitle-display",
        heroDesc: "hero-desc-display", bankInfo: "bank-info-display", bankOwner: "bank-owner-display",
        bankName: "bank-name-display", bankNumber: "bank-number-display",
        address: "address-display", footerDesc: "footer-desc", csPhone: "cs-phone",
        ownerName: "owner-name", bizNum: "biz-num", saleNum: "sale-num", email: "email-addr",
        orderTitle: "order-title-display", orderContent: "order-content-display", bizHours: "biz-hours",
        orderFormTitle: "order-form-title-display"
    }[f] || "store-name-display";
}

// ---------- 초기화 ----------
const init = async () => {
    // History API 초기 페이지 처리
    const hash = window.location.hash.slice(1);
    const initPage = hash || 'main';
    window.navigate(initPage, false);

    setTimeout(() => document.getElementById("app-loader").classList.add("loader-hidden"), 2000);
    lucide.createIcons();
    // 3. 안전장치: localStorage 에러 방지
    try {
        const savedCart = localStorage.getItem('seafoodCart');
        currentCart = savedCart ? JSON.parse(savedCart) : [];
        updateCartUI();
    } catch (e) {
        console.error("Cart load failed", e);
        currentCart = [];
    }

    try { await signInAnonymously(auth); } catch (e) { }
    onAuthStateChanged(auth, (u) => {
        const loader = document.getElementById("app-loader");
        // 로그인 상태 유지 체크
        if (u && u.uid === ADMIN_UID) {
            isAdmin = true;
            document.body.classList.add("admin-mode");
        }

        if (!u) { if (loader) loader.classList.add("loader-hidden"); return; }

        onSnapshot(getConfDoc(), (s) => {
            if (loader) loader.classList.add("loader-hidden");
            if (!s.exists()) return;
            const d = s.data();
            configCategories = d.categories || [];

            const fields = ["storeName", "heroTitle", "heroSubtitle", "heroDesc", "bankInfo", "bankOwner", "bankName", "bankNumber", "address", "footerDesc", "csPhone", "ownerName", "bizNum", "saleNum", "email", "orderTitle", "orderContent", "bizHours", "orderFormTitle"];
            fields.forEach(f => { if (d[f]) { const el = document.getElementById(getFieldId(f)); if (el) el.innerText = d[f]; } });

            if (d.storeName) { document.getElementById("footer-logo-text").innerText = d.storeName; }
            // 테마 컬러는 CSS 변수 대신 Tailwind 클래스로 직접 제어하도록 변경됨 (Deep Ocean)
            if (d.heroImage) document.getElementById("hero-section").style.backgroundImage = `url('${d.heroImage}')`;
            else document.getElementById("hero-section").style.backgroundImage = `url('https://images.unsplash.com/photo-1615141982880-19ed7e669e96?ixlib=rb-1.2.1&auto=format&fit=crop&w=1350&q=80')`;

            if (d.csPhone) {
                document.getElementById("btn-call").href = `tel:${d.csPhone}`;
                document.getElementById("btn-sms").href = `sms:${d.csPhone}`;
                document.getElementById("pc-btn-call").href = `tel:${d.csPhone}`;
                document.getElementById("pc-btn-sms").href = `sms:${d.csPhone}`;
                document.getElementById("footer-call").href = `tel:${d.csPhone}`;
                document.getElementById("footer-sms").href = `sms:${d.csPhone}`;
            }
            if (d.address) updateMap(d.address);

            // 가게 정보를 JSON-LD에 반영
            updateSchemaData(d);

            renderAllMenu();
            renderCategoryTabs();
        });

        onSnapshot(query(getPublicDataRef(COLLECTIONS.NOTICES), orderBy("createdAt", "desc")), (snap) => {
            if (!snap.empty) {
                const n = snap.docs[0].data();
                const contentSummary = n.content.replace(/\n/g, " ").substring(0, 30);
                document.getElementById("latest-notice-title").innerText = `${n.title} - ${contentSummary}${n.content.length > 30 ? '...' : ''}`;
            }
        });

        // 2275번 줄 에러 수정 (Refactoring 실수 수정)
        onSnapshot(getPublicDataRef(COLLECTIONS.PRODUCTS), (snap) => {
            productCache = [];
            snap.forEach(d => productCache.push({ id: d.id, ...d.data() }));
            renderFeatured();
            renderAllMenu();
            renderCategoryTabs();
        });

        renderBlogs();
    });
};

// JSON-LD 업데이트 함수
function updateSchemaData(config) {
    const schemaScript = document.getElementById('structured-data');
    if (!schemaScript) return;

    const data = JSON.parse(schemaScript.textContent);

    if (config.storeName) data.name = config.storeName;
    if (config.csPhone) data.telephone = config.csPhone;
    if (config.address) data.address.streetAddress = config.address;

    schemaScript.textContent = JSON.stringify(data, null, 2);
}

// [추가 1] 주문 상태 변경 (신규 <-> 완료)
window.updateOrderStatus = async (id, newStatus) => {
    try {
        await updateDoc(doc(getPublicDataRef(COLLECTIONS.ORDERS), id), {
            status: newStatus
        });
        window.showToast("주문 상태가 변경되었습니다.");
    } catch (e) {
        console.error(e);
        window.showToast("상태 변경 실패", "error");
    }
};

// [추가 2] 주문 삭제
window.deleteOrder = async (id) => {
    if (!confirm("이 주문 내역을 영구 삭제하시겠습니까?")) return;
    try {
        await deleteDoc(doc(getPublicDataRef(COLLECTIONS.ORDERS), id));
        window.showToast("주문이 삭제되었습니다.");
        // 로드 모어 상태 초기화가 필요할 수 있으나, 실시간 리스너가 처리함
    } catch (e) {
        window.showToast("삭제 실패", "error");
    }
};

// [추가 3] 문의 답변 등록/수정 기능
window.registerAnswer = async (id) => {
    const currentAnswerEl = document.getElementById(`inquiry-answer-text-${id}`);
    const currentText = currentAnswerEl ? currentAnswerEl.innerText : "";
    const newAnswer = prompt("답변 내용을 입력하세요:", currentText === "아직 답변이 등록되지 않았습니다." ? "" : currentText);

    if (newAnswer === null) return; // 취소

    try {
        await updateDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id), {
            answer: newAnswer,
            answeredAt: Date.now()
        });
        window.showToast("답변이 등록되었습니다.");
        window.viewInquiryDetail(id); // 상세창 새로고침
    } catch (e) {
        window.showToast("답변 등록 실패", "error");
    }
};

// [추가 4] 누락된 openInquiryManager (문의 탭으로 이동 기능)
window.openInquiryManager = () => {
    document.getElementById("inquiry-detail-modal").classList.add("hidden");
    window.openAdminDashboard();
    window.showAdminTab('inquiries');
};

init();