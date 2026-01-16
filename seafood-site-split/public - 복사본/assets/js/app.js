
import { signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, addDoc, deleteDoc, query, orderBy, limit, onSnapshot, setDoc, updateDoc, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, auth, COLLECTIONS, ADMIN_UID, getPublicDataRef, getConfDoc, TELEGRAM_WORKER_URL } from "./config.js";
import { state } from "./state.js";
import { updateMap, normalizeCategory } from "./utils.js";
import "./admin.js"; // 관리자 기능 로드

// ---------- 라우팅 & UI ----------
const PAGE_TITLES = {
    'main': '바다의 먹거리 - 대광수산',
    'menu': '전체 메뉴 | 대광수산',
    'order': '주문하기 | 대광수산',
    'inquiry': '문의하기 | 대광수산',
    'location': '매장 오시는 길 | 대광수산',
    'blog-page': '대광 소식통 | 대광수산'
};

const PAGE_DESCRIPTIONS = {
    'main': '노량진 수산시장 대광수산. 당일 조업한 신선한 활어회...',
    'menu': '대광수산의 신선한 활어회, 해산물 전체 메뉴입니다.',
    'order': '간편하게 주문서를 작성하고 신선한 회를 배송받으세요.',
    'inquiry': '대광수산에 궁금한 점을 남겨주세요.',
    'location': '노량진 수산시장 1층 100호 대광수산 찾아오시는 길.',
    'blog-page': '대광수산의 생생한 현장 소식과 정보.'
};

window.navigate = (page, addToHistory = true) => {
    if (addToHistory) history.pushState({ page }, "", `#${page}`);
    const title = PAGE_TITLES[page] || '대광수산';
    const desc = PAGE_DESCRIPTIONS[page] || PAGE_DESCRIPTIONS['main'];

    document.title = title;
    document.getElementById('og-title').setAttribute('content', title);
    document.getElementById('meta-desc').setAttribute('content', desc);
    document.getElementById('og-desc').setAttribute('content', desc);
    document.querySelectorAll("[data-page]").forEach(s => s.classList.toggle("page-hidden", s.getAttribute("data-page") !== page));
    document.querySelectorAll("[data-page-link]").forEach(l => l.classList.toggle("page-nav-active", l.getAttribute("data-page-link") === page));
    document.querySelectorAll("[data-mobile-nav]").forEach(b => { const a = b.getAttribute("data-mobile-nav") === page; b.classList.toggle("mobile-nav-active", a); b.classList.toggle("text-gray-400", !a); });

    window.scrollTo(0, 0);

    if (page === "menu") {
        state.menuFilterCategory = "all";
        state.visibleMenuCount = 20;
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

    setTimeout(() => document.querySelectorAll('.reveal').forEach(el => new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('active'))).observe(el)), 100);
};

window.onpopstate = (event) => { window.navigate(window.location.hash.slice(1) || 'main', false); };
window.handleLogoClick = (e) => { if (!state.isDesignMode) { e.preventDefault(); window.navigate('main'); } };
window.handleTitleClick = (e) => { if (state.isDesignMode) { e.stopPropagation(); window.handleEdit('storeName', '상호명'); } else { e.preventDefault(); window.navigate('main'); } };

// ---------- 메뉴 & 상품 렌더링 ----------
function renderFeatured() {
    const list = document.getElementById("product-list");
    const menuFeaturedList = document.getElementById("menu-featured-list");
    const featuredItems = state.productCache.filter(p => p.featured).slice(0, 3);
    const html = featuredItems.length === 0 ? `<div class="col-span-full text-center py-20 text-slate-400 bg-slate-50 rounded-xl border border-dashed flex-1">추천 상품 준비 중</div>` : featuredItems.map(p => createProductCard(p, true)).join("");

    if (list) list.innerHTML = html;
    if (menuFeaturedList) {
        menuFeaturedList.innerHTML = html;
        const container = document.getElementById("menu-featured-container");
        if (state.menuFilterCategory === 'all' && featuredItems.length > 0) container.classList.remove("hidden"); else container.classList.add("hidden");
    }
    if(window.lucide) window.lucide.createIcons();
}

function createProductCard(p, isFeaturedSection = false) {
    const safeName = String(p.name ?? "").replace(/'/g, "\\'");
    const originalPrice = Number(p.price || 0);
    const salePrice = p.salePrice ? Number(p.salePrice) : 0;
    const isSale = salePrice > 0 && salePrice < originalPrice;
    const finalPrice = isSale ? salePrice : originalPrice;
    const discountRate = isSale ? Math.round((originalPrice - salePrice) / originalPrice * 100) : 0;
    const imgSrc = p.image || '';
    const imgTag = imgSrc ? `<img src="${imgSrc}" class="w-full h-full object-cover group-hover:scale-110 transition duration-500 cursor-pointer" onclick="event.stopPropagation(); window.openLightbox('${imgSrc}')">` : `<div class="w-full h-full img-fallback"><span>NO IMAGE</span></div>`;

    const priceDisplay = isSale ? `<div class="flex flex-col items-end"><span class="text-xs text-slate-400 line-through">${originalPrice.toLocaleString()}원</span><div class="flex items-center gap-1"><span class="text-red-500 font-bold text-sm">${discountRate}%</span><span class="text-blue-600 font-extrabold text-lg">${finalPrice.toLocaleString()}원</span></div></div>` : `<span class="text-blue-600 font-bold text-lg">${originalPrice.toLocaleString()}원</span>`;

    if (isFeaturedSection) {
        return `<div class="snap-center min-w-[280px] md:min-w-0 bg-white rounded-3xl shadow-sm overflow-hidden border border-slate-100 hover:shadow-xl transition group relative ${p.soldOut ? 'sold-out' : ''}">
            <div class="h-64 overflow-hidden bg-slate-100 img-container img-zoom-container">${imgTag}<div class="absolute top-4 left-4 bg-yellow-400 text-xs font-bold px-3 py-1 rounded-full shadow-sm z-20">BEST</div>${isSale ? `<div class="absolute top-4 right-4 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm z-20">SALE ${discountRate}%</div>` : ''}${p.soldOut ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}</div>
            <div class="p-6"><div class="flex justify-between items-start mb-2"><div class="flex items-center gap-2 flex-1 min-w-0"><h3 class="font-bold text-xl text-slate-900 truncate">${p.name}</h3>${p.unit ? `<span class="text-[10px] text-slate-500 bg-slate-100 px-2 py-1 rounded shrink-0">${p.unit}</span>` : ''}</div></div><p class="text-sm text-slate-500 mb-4 line-clamp-1 h-5">${p.description || ''}</p><div class="flex justify-between items-center mb-6">${priceDisplay}</div><div class="pt-4 border-t border-dashed border-slate-200">${!p.soldOut ? `<div class="flex items-center gap-3"><div class="flex items-center bg-slate-50 rounded-xl p-1 border border-slate-100"><button onclick="window.adjustQty(this, -1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 font-bold text-lg">-</button><span class="text-sm font-bold w-8 text-center qty-display">1</span><button onclick="window.adjustQty(this, 1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 font-bold text-lg">+</button></div><button onclick="window.addToCartWithQty(this, '${p.id}', '${safeName}', '${finalPrice}')" class="flex-1 bg-theme hover:opacity-90 text-white py-2.5 rounded-xl text-sm font-bold transition shadow-md">담기</button></div>` : `<button disabled class="w-full bg-slate-200 text-slate-400 py-2.5 rounded-xl text-sm font-bold cursor-not-allowed">품절</button>`}</div></div></div>`;
    }
    return "";
}

function renderAllMenu() {
    const list = document.getElementById("all-menu-list");
    if (!list) return;
    let filtered = [...state.productCache];
    if (state.menuFilterCategory !== "all") { filtered = filtered.filter(p => normalizeCategory(p.category) === state.menuFilterCategory); filtered.sort((a, b) => (b.featured - a.featured) || a.name.localeCompare(b.name)); } else { filtered = filtered.filter(p => !p.featured); filtered.sort((a, b) => a.name.localeCompare(b.name)); }

    if (filtered.length === 0) { list.innerHTML = '<div class="col-span-full p-16 text-center text-slate-400">등록된 메뉴가 없습니다.</div>'; document.getElementById('infinite-scroll-trigger').classList.add('hidden'); return; }

    const itemsToShow = filtered.slice(0, state.visibleMenuCount);
    document.getElementById('infinite-scroll-trigger').classList.toggle('hidden', filtered.length <= state.visibleMenuCount);

    list.innerHTML = itemsToShow.map(p => {
        const originalPrice = Number(p.price || 0); const salePrice = Number(p.salePrice || 0);
        const isSale = salePrice > 0 && salePrice < originalPrice; const finalPrice = isSale ? salePrice : originalPrice;
        const discountRate = isSale ? Math.round((originalPrice - salePrice) / originalPrice * 100) : 0;
        const imgSrc = p.image || '';
        const imgTag = imgSrc ? `<img src="${imgSrc}" class="w-full h-full object-cover cursor-pointer" onclick="event.stopPropagation(); window.openLightbox('${imgSrc}')">` : `<div class="w-full h-full img-fallback"><span>이미지 없음</span></div>`;
        const priceDisplay = isSale ? `<div class="flex flex-col items-end"><span class="text-[10px] text-slate-400 line-through">${originalPrice.toLocaleString()}원</span><div class="flex items-center gap-1"><span class="text-red-500 font-bold text-xs">${discountRate}%</span><span class="text-blue-600 font-bold text-base">${finalPrice.toLocaleString()}원</span></div></div>` : `<span class="font-bold text-base text-blue-600">${originalPrice.toLocaleString()}원</span>`;

        return `<div class="flex flex-col items-start p-4 gap-3 hover:bg-slate-50 transition bg-white border border-slate-100 rounded-2xl shadow-sm group ${p.soldOut ? 'sold-out' : ''}">
            <div class="w-full h-48 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0 img-container relative img-zoom-container">${imgTag}${p.featured ? '<span class="absolute top-0 left-0 bg-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded-br-lg z-20">BEST</span>' : ''}${isSale ? '<span class="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg z-20">SALE</span>' : ''}${p.soldOut ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}</div>
            <div class="w-full"><div class="flex justify-between items-start"><div class="flex items-center gap-2"><h4 class="font-bold text-lg text-slate-900 leading-tight">${p.name}</h4>${p.unit ? `<span class="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">${p.unit}</span>` : ''}</div></div><div class="text-xs text-slate-500 mt-1 space-y-0.5"><p class="line-clamp-1">${p.description || ''}</p></div><div class="flex justify-between items-center mt-3">${priceDisplay}</div></div>
            <div class="w-full mt-auto pt-3 border-t border-dashed border-slate-100">${!p.soldOut ? `<div class="flex items-center gap-3"><div class="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-100"><button onclick="window.adjustQty(this, -1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">-</button><span class="text-sm font-bold w-6 text-center qty-display">1</span><button onclick="window.adjustQty(this, 1)" class="w-8 h-8 flex items-center justify-center bg-white rounded-md shadow-sm text-slate-600 font-bold hover:bg-slate-100 text-lg">+</button></div><button onclick="window.addToCartWithQty(this, '${p.id}', '${String(p.name).replace(/'/g,"\\'")}', '${finalPrice}')" class="flex-1 bg-theme hover:opacity-90 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition">담기</button></div>` : `<button disabled class="w-full bg-slate-200 text-slate-400 py-2 rounded-lg text-sm font-bold cursor-not-allowed">품절</button>`}</div></div>`;
    }).join('');
    if(window.lucide) window.lucide.createIcons();
}

function handleMenuScroll() {
    const trigger = document.getElementById('infinite-scroll-trigger');
    if (trigger.classList.contains('hidden')) return;
    if (trigger.getBoundingClientRect().top <= window.innerHeight) { state.visibleMenuCount += 20; renderAllMenu(); }
}

function renderCategoryTabs() {
    const tabEl = document.getElementById("menu-category-tabs");
    if (!tabEl) return;
    const activeCats = Array.from(new Set([...state.configCategories, ...state.productCache.map(p => normalizeCategory(p.category)).filter(Boolean)]));
    tabEl.innerHTML = `<button onclick="window.setMenuCategory('all')" class="px-5 py-2 rounded-full text-sm font-bold border transition-all ${state.menuFilterCategory === 'all' ? "bg-theme text-white border-theme shadow-md ring-2 ring-blue-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}">전체보기</button>` + activeCats.map(cat => `<button onclick="window.setMenuCategory('${cat}')" class="px-5 py-2 rounded-full text-sm font-bold border transition-all ${state.menuFilterCategory === cat ? "bg-theme text-white border-theme shadow-md ring-2 ring-blue-100" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}">${cat}</button>`).join("");
}

window.setMenuCategory = (cat) => { state.menuFilterCategory = cat; state.visibleMenuCount = 20; renderCategoryTabs(); renderFeatured(); renderAllMenu(); };
window.adjustQty = (btn, delta) => { const d = btn.parentElement.querySelector('.qty-display'); let c = parseInt(d.innerText) + delta; if (c < 1) c = 1; d.innerText = c; };
window.addToCartWithQty = (btn, id, name, price) => { const qty = parseInt(btn.parentElement.querySelector('.qty-display').innerText); window.addToCart(id, name, price, qty); };

// ---------- 장바구니 ----------
window.addToCart = (id, name, price, qty = 1) => {
    const existing = state.currentCart.find(item => item.id === id);
    if (existing) existing.qty += qty; else state.currentCart.push({ id, name, price: Number(String(price).replace(/[^0-9]/g, "")) || 0, qty: qty });
    updateCartUI(); window.showToast(`${name} ${qty}개 담았습니다.`);
};
window.removeFromCart = (id) => { state.currentCart = state.currentCart.filter(item => item.id !== id); updateCartUI(); };
window.clearCart = () => { if (confirm("장바구니 비우기?")) { state.currentCart = []; updateCartUI(); } };
window.toggleCart = () => { const s = document.getElementById("cart-sidebar"), o = document.getElementById("cart-overlay"); s.classList.toggle("translate-x-full"); o.classList.toggle("hidden"); };

function updateCartUI() {
    localStorage.setItem('seafoodCart', JSON.stringify(state.currentCart));
    const countEl = document.getElementById("cart-count"), listEl = document.getElementById("cart-items"), totalEl = document.getElementById("cart-total");
    const totalQty = state.currentCart.reduce((s, i) => s + i.qty, 0);
    if (totalQty > 0) { countEl.innerText = totalQty; countEl.classList.remove("hidden"); countEl.classList.add("cart-bounce"); setTimeout(() => countEl.classList.remove("cart-bounce"), 1000); } else countEl.classList.add("hidden");

    listEl.innerHTML = state.currentCart.length === 0 ? `<div class="text-center text-slate-400 mt-20 flex flex-col items-center gap-4"><i data-lucide="shopping-basket" size="48" class="text-slate-200"></i><p>장바구니가 비어있습니다.</p></div>` : state.currentCart.map(item => `
        <div class="flex justify-between items-center mb-4 border-b border-slate-100 pb-4 last:border-0"><div><div class="font-bold text-slate-800 text-sm md:text-base">${item.name}</div><div class="text-xs md:text-sm text-slate-500 mt-1">${item.price.toLocaleString()}원</div></div><div class="flex items-center gap-2"><button onclick="window.addToCart('${item.id}','${item.name}','${item.price}', -1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold">-</button><span class="text-sm font-bold w-4 text-center">${item.qty}</span><button onclick="window.addToCart('${item.id}','${item.name}','${item.price}', 1)" class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold">+</button><button onclick="window.removeFromCart('${item.id}')" class="text-red-400 p-1 ml-2"><i data-lucide="trash-2" size="18"></i></button></div></div>`).join("");
    totalEl.innerText = state.currentCart.reduce((s, i) => s + (i.price * i.qty), 0).toLocaleString() + "원";
    if(window.lucide) window.lucide.createIcons();
}

window.checkout = () => {
    if (state.currentCart.length === 0) return window.showToast("장바구니가 비어있습니다.", 'error');
    document.getElementById("order-product").value = `${state.currentCart.map(i => `${i.name} ${i.qty}개`).join(", ")}\n\n[총 결제금액: ${state.currentCart.reduce((s, i) => s + (i.price * i.qty), 0).toLocaleString()}원]`;
    window.toggleCart(); window.navigate("order");
};

// ---------- 블로그 & 문의 ----------
function renderBlogs() {
    const grid = document.getElementById("main-blog-list"); if (!grid) return;
    onSnapshot(query(getPublicDataRef(COLLECTIONS.BLOGS), orderBy("createdAt", "desc")), (snap) => {
        let blogs = []; snap.forEach(d => blogs.push({ id: d.id, ...d.data() }));
        if (!state.isAdmin) blogs = blogs.filter(b => !b.isHidden);
        if (blogs.length === 0) { grid.innerHTML = "<div class='col-span-full py-16 text-center text-slate-400'>게시글이 없습니다.</div>"; return; }
        const latest = blogs[0];
        grid.innerHTML = `<div class="lg:col-span-1 cursor-pointer group" onclick="window.openBlogDetail('${latest.id}')"><div class="aspect-video lg:aspect-square bg-slate-200 rounded-3xl overflow-hidden mb-5 relative shadow-md img-zoom-container"><img src="${latest.image || ''}" class="w-full h-full object-cover"><div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent flex items-end p-8"><div class="text-white"><span class="bg-blue-600 text-xs px-3 py-1 rounded-full font-bold mb-3 inline-block shadow-lg">NEW</span><h3 class="text-2xl font-bold line-clamp-2 drop-shadow-lg leading-tight">${latest.title}</h3></div></div></div><p class="text-slate-600 text-sm line-clamp-3 leading-relaxed px-2">${latest.content}</p></div><div class="lg:col-span-2 flex flex-col gap-4">${blogs.slice(1, 5).map(b => `<div class="flex gap-5 p-4 bg-white border border-slate-100 rounded-2xl hover:shadow-lg transition cursor-pointer items-center group" onclick="window.openBlogDetail('${b.id}')"><div class="w-24 h-24 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0 img-zoom-container"><img src="${b.image || ''}" class="w-full h-full object-cover"></div><div class="flex-1 min-w-0"><h4 class="font-bold text-slate-900 truncate text-lg group-hover:text-theme transition-colors">${b.title}</h4><p class="text-sm text-slate-500 line-clamp-2 mt-1.5 leading-relaxed">${b.content}</p><span class="text-xs text-slate-400 mt-2 block">${new Date(b.createdAt).toLocaleDateString()}</span></div><i data-lucide="chevron-right" class="text-slate-300 group-hover:translate-x-1 transition-transform" size="20"></i></div>`).join('')}</div>`;
        if(window.lucide) window.lucide.createIcons(); observeElements();
    });
}

function renderFullBlogList() {
    const list = document.getElementById("full-blog-list"); if (!list) return;
    onSnapshot(query(getPublicDataRef(COLLECTIONS.BLOGS), orderBy("createdAt", "desc")), (snap) => {
        list.innerHTML = snap.docs.map(d => { const b = d.data(); if (!state.isAdmin && b.isHidden) return ''; return `<div class="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden cursor-pointer hover:shadow-xl transition group" onclick="window.openBlogDetail('${d.id}')"><div class="h-56 bg-slate-100 relative img-zoom-container"><img src="${b.image || ''}" class="w-full h-full object-cover">${b.isHidden ? '<div class="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold backdrop-blur-sm">숨김 처리됨</div>' : ''}</div><div class="p-6"><h4 class="font-bold text-xl truncate mb-3 text-slate-900 group-hover:text-theme transition-colors">${b.title}</h4><p class="text-base text-slate-500 line-clamp-2 leading-relaxed">${b.content}</p><div class="mt-4 text-xs text-slate-400 font-medium">${new Date(b.createdAt).toLocaleDateString()}</div></div></div>`; }).join('');
    });
}

window.openBlogDetail = async (id) => {
    state.currentBlogId = id; const snap = await getDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id)); if (!snap.exists()) return; const b = snap.data();
    document.getElementById("blog-detail-img-container").innerHTML = `<img src="${b.image}" class="w-full h-full object-cover">`;
    document.getElementById("blog-detail-text-content").innerHTML = `<h3 class="text-3xl md:text-4xl font-extrabold mb-6 leading-tight text-slate-900">${b.title} ${b.isHidden ? '<span class="text-red-500 text-lg align-middle">(숨김)</span>' : ''}</h3><div class="text-slate-600 leading-loose whitespace-pre-wrap text-base md:text-lg">${b.content}</div>${state.isAdmin ? `<div class="mt-8 pt-6 border-t border-slate-100 flex gap-3"><button onclick="window.deleteBlog('${id}')" class="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-100">글 삭제</button><button onclick="window.toggleBlogHidden('${id}', ${b.isHidden})" class="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200">${b.isHidden ? '숨김 해제' : '숨기기'}</button></div>` : ''}`;
    renderComments(id); document.getElementById("blog-modal").classList.remove("hidden");
};
window.deleteBlog = async (id) => { if (confirm("삭제?")) { await deleteDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id)); document.getElementById("blog-modal").classList.add("hidden"); window.showToast("삭제됨"); } };
window.toggleBlogHidden = async (id, s) => { await updateDoc(doc(getPublicDataRef(COLLECTIONS.BLOGS), id), { isHidden: !s }); window.openBlogDetail(id); };

function renderComments(id) {
    onSnapshot(query(getPublicDataRef(COLLECTIONS.COMMENTS), orderBy("createdAt", "asc")), (snap) => {
        let cList = []; snap.forEach(d => { if (d.data().blogId === id) cList.push({ id: d.id, ...d.data() }); });
        document.getElementById("blog-comment-count").innerText = cList.length;
        document.getElementById("blog-comments").innerHTML = cList.map(c => `<div class="bg-slate-50 p-4 rounded-2xl text-sm border border-slate-100 flex justify-between items-center"><div><span class="font-bold text-theme mr-2">방문자</span> <span class="text-slate-700">${c.text}</span></div>${state.isAdmin ? `<button onclick="window.deleteComment('${c.id}')" class="text-red-400 text-xs ml-2 hover:bg-red-50 p-1 rounded"><i data-lucide="x" size="14"></i></button>` : ''}</div>`).join("");
        if(window.lucide) window.lucide.createIcons();
    });
}
window.addComment = async () => { const i = document.getElementById("comment-input"); if (!i.value.trim() || !state.currentBlogId) return; await addDoc(getPublicDataRef(COLLECTIONS.COMMENTS), { blogId: state.currentBlogId, text: i.value, createdAt: Date.now() }); i.value = ""; };
window.deleteComment = async (cid) => { if (confirm("삭제?")) await deleteDoc(doc(getPublicDataRef(COLLECTIONS.COMMENTS), cid)); };

// ---------- Forms ----------
document.getElementById("orderForm").onsubmit = async (e) => {
  e.preventDefault();
  const phone = document.getElementById("order-phone").value;
  if (!/^[0-9]{2,3}-?[0-9]{3,4}-?[0-9]{4}$/.test(phone)) return window.showToast("연락처 오류", "error");

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.innerText = "전송 중...";

  // 1) 주문 데이터 준비 (한 번만 만들기)
  const orderPayload = {
    name: document.getElementById("order-name").value,
    phone,
    address: document.getElementById("order-address").value,
    product: document.getElementById("order-product").value,
    status: "new",
    createdAt: Date.now(),
  };

  try {
    // 2) Firestore 저장(기존 로직 유지)
    await addDoc(getPublicDataRef(COLLECTIONS.ORDERS), orderPayload);

    // 3) 텔레그램 알림(실패해도 주문 저장은 유지)
    fetch(TELEGRAM_WORKER_URL, {
  method: "POST",
  body: JSON.stringify({
    type: "order",
    name: document.getElementById("order-name").value,
    phone,
    address: document.getElementById("order-address").value,
    product: document.getElementById("order-product").value,
  }),
}).catch(() => {});

    // 4) 성공 UI(기존 로직 유지)
    document.getElementById("order-success-modal").classList.remove("hidden");
    btn.disabled = false;
    btn.innerText = "주문 전송하기";
    state.currentCart = [];
    updateCartUI();
  } catch (e) {
    window.showToast("오류 발생", "error");
    btn.disabled = false;
  }
};

document.getElementById("inquiryForm").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("inq-name").value;
    const phone = document.getElementById("inq-phone").value;
    const content = document.getElementById("inq-content").value;

    try {
        // Firebase에 문의 등록
        await addDoc(getPublicDataRef(COLLECTIONS.INQUIRIES), {
            name,
            phone,
            content,
            answer: null,
            createdAt: Date.now()
        });

        // 텔레그램 알림 전송
        fetch(TELEGRAM_WORKER_URL, {
            method: "POST",
            body: JSON.stringify({
                type: "inquiry",
                name,
                phone,
                message: content
            })
        }).catch(() => {});

        window.showToast("문의 등록 완료");
        e.target.reset();
    } catch (e) {
        window.showToast("오류", 'error');
    }
};
window.searchInquiries = async () => {
    const name = document.getElementById('search-name').value.trim();
    const phone = document.getElementById('search-phone').value.trim();
    if (!name || !phone) return window.showToast("이름과 연락처를 모두 입력해주세요", "error");

    const q = query(getPublicDataRef(COLLECTIONS.INQUIRIES), where("name", "==", name), where("phone", "==", phone));
    const snap = await getDocs(q);

    if (snap.empty) {
        window.showToast("일치하는 문의를 찾을 수 없습니다", "error");
        return;
    }

    document.getElementById('search-result-area').classList.remove('hidden');
    document.getElementById('inquiry-list').innerHTML = snap.docs.map(d => {
        const data = d.data();
        return `<div class="p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition" onclick="window.viewInquiryDetailUser('${d.id}')">
            <div class="font-bold text-sm">${data.content.substring(0, 50)}${data.content.length > 50 ? '...' : ''}</div>
            <div class="text-xs text-slate-400 mt-1">${new Date(data.createdAt).toLocaleDateString()} · ${data.answer ? '답변완료' : '답변대기'}</div>
        </div>`;
    }).join('');
};
window.openInquirySearch = () => { document.getElementById('search-result-area').classList.add('hidden'); document.getElementById('inquiry-list').innerHTML = ''; document.getElementById('search-name').value = ''; document.getElementById('search-phone').value = ''; document.getElementById('inquiry-search-modal').classList.remove('hidden'); };
// 이용자용 문의 상세보기 (관리자는 admin.js의 viewInquiryDetail 사용)
window.viewInquiryDetailUser = async (id) => {
    const s = await getDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id));
    if (!s.exists()) return;
    const d = s.data();
    document.getElementById("inquiry-detail-content").innerHTML = `
        <h3 class="text-xl font-bold mb-4">문의 내용</h3>
        <div class="bg-slate-50 p-4 rounded-xl mb-6 text-sm whitespace-pre-wrap text-slate-700 border border-slate-100">${d.content}</div>
        <h3 class="text-xl font-bold mb-4 text-blue-600">관리자 답변</h3>
        <div class="bg-blue-50 p-4 rounded-xl text-sm whitespace-pre-wrap border border-blue-100 min-h-[100px]">${d.answer ? d.answer : '<span class="text-slate-400">답변 대기중</span>'}</div>
    `;
    document.getElementById("inquiry-detail-modal").classList.remove("hidden");
};
window.deleteInquiry = async (id) => { if (confirm("삭제?")) { await deleteDoc(doc(getPublicDataRef(COLLECTIONS.INQUIRIES), id)); document.getElementById("inquiry-detail-modal").classList.add("hidden"); window.showToast("삭제됨"); } };

// ---------- 공지사항 ----------
window.openNoticeListModal = () => {
    const modal = document.getElementById('notice-list-modal');
    const list = document.getElementById('notice-full-list');

    if (state.noticeCache.length === 0) {
        list.innerHTML = '<div class="p-12 text-center text-slate-400">등록된 공지가 없습니다.</div>';
    } else {
        list.innerHTML = state.noticeCache.map(n => `
            <div class="p-4 bg-white border border-slate-100 rounded-xl hover:shadow-md transition cursor-pointer" onclick="window.openNoticePopup('${n.id}')">
                <div class="font-bold text-slate-800 mb-1">${n.title}</div>
                <div class="text-xs text-slate-400">${new Date(n.createdAt).toLocaleDateString('ko-KR')}</div>
            </div>
        `).join('');
    }

    modal.classList.remove('hidden');
};

window.openNoticePopup = (id) => {
    const notice = state.noticeCache.find(n => n.id === id);
    if (!notice) return;

    document.getElementById('notice-popup-title').innerText = notice.title;
    document.getElementById('notice-popup-content').innerText = notice.content;
    document.getElementById('notice-list-modal').classList.add('hidden');
    document.getElementById('notice-popup-modal').classList.remove('hidden');
};

// ---------- Settings Tab Switcher ----------
window.switchSettingsTab = (tabName) => {
    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active', 'border-blue-600', 'text-blue-600', 'bg-blue-50');
        btn.classList.add('text-slate-600');
    });

    // 모든 탭 컨텐츠 숨김
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // 선택한 탭 버튼 활성화
    const activeBtn = document.querySelector(`.settings-tab-btn[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'border-blue-600', 'text-blue-600', 'bg-blue-50');
        activeBtn.classList.remove('text-slate-600');
    }

    // 선택한 탭 컨텐츠 표시
    const activeContent = document.getElementById(`settings-tab-${tabName}`);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }

    // 아이콘 재렌더링
    if (window.lucide) window.lucide.createIcons();
};

// ---------- Auth & Init ----------
window.toggleDesignMode = () => { state.isDesignMode = !state.isDesignMode; document.body.classList.toggle("design-mode", state.isDesignMode); window.showToast(state.isDesignMode ? "디자인 모드 ON" : "디자인 모드 OFF"); };
window.handleEdit = async (f, l) => { if (!state.isDesignMode) return; const v = prompt(`${l} 수정:`); if (v) { await setDoc(getConfDoc(), { [f]: v }, { merge: true }); if (f === "address") updateMap(v); } };
window.openLoginModal = () => state.isAdmin ? window.openAdminDashboard() : document.getElementById("login-modal").classList.remove("hidden");
window.tryLogin = async () => {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const email = document.getElementById("admin-id").value;
        const password = document.getElementById("admin-pw").value;
        const autoLogin = document.getElementById("auto-login-check").checked;

        const u = await signInWithEmailAndPassword(auth, email, password);
        if (u.user.uid !== ADMIN_UID) throw new Error();

        // 자동 로그인 체크 시 로컬스토리지에 저장
        if (autoLogin) {
            localStorage.setItem('adminAutoLogin', JSON.stringify({ email, password }));
        } else {
            localStorage.removeItem('adminAutoLogin');
        }

        state.isAdmin = true;
        document.body.classList.add("admin-mode");
        document.getElementById("login-modal").classList.add("hidden");
        window.openAdminDashboard();
    } catch (e) {
        window.showToast("로그인 실패", 'error');
    }
};
window.exitAdminMode = async () => {
    state.isAdmin = false;
    document.body.classList.remove("admin-mode");
    localStorage.removeItem('adminAutoLogin');
    sessionStorage.removeItem('dashboardOpened');
    await signOut(auth);
    await signInAnonymously(auth);
    window.closeAdminDashboard();
    window.showToast("로그아웃 완료");
};

const init = async () => {
    window.navigate(window.location.hash.slice(1) || 'main', false);
    setTimeout(() => document.getElementById("app-loader").classList.add("loader-hidden"), 2000);
    if(window.lucide) window.lucide.createIcons();

    try { state.currentCart = JSON.parse(localStorage.getItem('seafoodCart')) || []; updateCartUI(); } catch (e) { state.currentCart = []; }

    // 자동 로그인 시도
    const autoLoginData = localStorage.getItem('adminAutoLogin');
    if (autoLoginData) {
        try {
            const { email, password } = JSON.parse(autoLoginData);
            await setPersistence(auth, browserLocalPersistence);
            await signInWithEmailAndPassword(auth, email, password);
            // 로그인 성공 시 onAuthStateChanged에서 처리됨
        } catch (e) {
            // 자동 로그인 실패 시 저장된 정보 삭제
            localStorage.removeItem('adminAutoLogin');
            try { await signInAnonymously(auth); } catch (e) {}
        }
    } else {
        try { await signInAnonymously(auth); } catch (e) {}
    }

    onAuthStateChanged(auth, (u) => {
        if (u && u.uid === ADMIN_UID) {
            state.isAdmin = true;
            document.body.classList.add("admin-mode");
            // 페이지 로드 후 자동으로 대시보드 열기 (자동 로그인 시)
            const autoLogin = localStorage.getItem('adminAutoLogin');
            if (autoLogin && !sessionStorage.getItem('dashboardOpened')) {
                sessionStorage.setItem('dashboardOpened', 'true');
                setTimeout(() => {
                    window.openAdminDashboard();
                    window.showToast("자동 로그인 완료", "success");
                }, 1000);
            }
        } else {
            state.isAdmin = false;
            document.body.classList.remove("admin-mode");
        }
        if (!u) return;

        onSnapshot(getConfDoc(), (s) => {
            if (!s.exists()) return;
            const d = s.data();
            state.configCategories = d.categories || [];

            // 1. 로고 이미지 처리 (logoUrl 사용)
            const logoImg = document.getElementById("logo-img-display");
            const logoIcon = document.getElementById("logo-icon-display");
            if (d.logoUrl || d.logo) {
                const logoSrc = d.logoUrl || d.logo;
                if(logoImg) { logoImg.src = logoSrc; logoImg.classList.remove("hidden"); }
                if(logoIcon) logoIcon.classList.add("hidden");
            } else {
                if(logoImg) logoImg.classList.add("hidden");
                if(logoIcon) logoIcon.classList.remove("hidden");
            }

            // 2. 메인 배너 이미지 처리 (mainBannerUrl 사용)
            const heroSection = document.getElementById("hero-section");
            if (d.mainBannerUrl) {
                if (heroSection) heroSection.style.backgroundImage = `url('${d.mainBannerUrl}')`;
            } else if (d.heroImage) {
                // 기존 heroImage 필드도 호환
                if (heroSection) heroSection.style.backgroundImage = `url('${d.heroImage}')`;
            }

            // 3. 메인 캐치프레이즈 처리 (mainTitle, mainSubtitle, mainDesc 우선, 없으면 기존 필드명 호환)
            const heroTitle = document.getElementById("hero-title-display");
            const heroSubtitle = document.getElementById("hero-subtitle-display");
            const heroDesc = document.getElementById("hero-desc-display");
            if (heroTitle) {
                heroTitle.innerText = d.mainTitle || d.heroTitle || heroTitle.innerText;
            }
            if (heroSubtitle) {
                heroSubtitle.innerText = d.mainSubtitle || d.heroSubtitle || heroSubtitle.innerText;
            }
            if (heroDesc) {
                heroDesc.innerText = d.mainDesc || d.heroDesc || heroDesc.innerText;
            }

            // 4. 텍스트 필드 매핑 및 관리자 헤더 동기화
            if (d.storeName) {
                document.getElementById("footer-logo-text").innerText = d.storeName;
                const adminHeader = document.getElementById("admin-header-title");
                if(adminHeader) adminHeader.innerText = d.storeName + " Manager";
            }
            if (d.address) updateMap(d.address);

            const fields = ["storeName", "bankInfo", "bankOwner", "bankName", "bankNumber", "address", "footerDesc", "csPhone", "ownerName", "bizNum", "saleNum", "email", "orderTitle", "orderContent", "bizHours", "orderFormTitle"];
            const getFieldId = (f) => ({ storeName: "store-name-display", bankInfo: "bank-info-display", bankOwner: "bank-owner-display", bankName: "bank-name-display", bankNumber: "bank-number-display", address: "address-display", footerDesc: "footer-desc", csPhone: "cs-phone", ownerName: "owner-name", bizNum: "biz-num", saleNum: "sale-num", email: "email-addr", orderTitle: "order-title-display", orderContent: "order-content-display", bizHours: "biz-hours", orderFormTitle: "order-form-title-display" }[f] || "store-name-display");
            fields.forEach(f => { if (d[f]) { const el = document.getElementById(getFieldId(f)); if (el) el.innerText = d[f]; } });

            renderAllMenu(); renderCategoryTabs();
        });

        onSnapshot(query(getPublicDataRef(COLLECTIONS.NOTICES), orderBy("createdAt", "desc")), (snap) => {
            state.noticeCache = [];
            snap.forEach(d => state.noticeCache.push({ id: d.id, ...d.data() }));
            if (!snap.empty) document.getElementById("latest-notice-title").innerText = `${snap.docs[0].data().title}`;
        });

        onSnapshot(getPublicDataRef(COLLECTIONS.PRODUCTS), (snap) => {
            state.productCache = []; snap.forEach(d => state.productCache.push({ id: d.id, ...d.data() }));
            renderFeatured(); renderAllMenu(); renderCategoryTabs();
        });

        renderBlogs();
    });
};

init();
