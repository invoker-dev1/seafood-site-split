
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { storage, getConfDoc } from "./config.js";

// Toast 메시지
window.showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (container.children.length > 2) container.removeChild(container.firstChild);

    const el = document.createElement('div');
    const color = type === 'error' ? 'bg-red-500' : (type === 'info' ? 'bg-blue-500' : 'bg-slate-800');
    el.className = `${color} text-white px-6 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-bold pointer-events-auto toast-enter backdrop-blur-md`;
    el.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle'}" size="18"></i> ${msg}`;
    container.appendChild(el);
    if(window.lucide) window.lucide.createIcons();
    setTimeout(() => { if (el.parentElement) el.parentElement.removeChild(el); }, 3000);
};

// 텍스트 복사
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

// 지도 업데이트
export function updateMap(address) {
    const iframe = document.getElementById("map-iframe");
    if (!iframe || !address) return;
    iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
}

// 공유하기
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

// 이미지 업로드 로직 (최적화 및 자동 저장)
window.handleImageUpload = (input, targetId) => {
    const file = input.files[0];
    if (!file) return;

    const labelBtn = input.closest('label');
    const originalText = labelBtn ? labelBtn.innerText : "";
    if (labelBtn) labelBtn.innerHTML = "<i class='animate-spin' data-lucide='loader-2'></i> 업로드..";
    if(window.lucide) window.lucide.createIcons();

    window.showToast("이미지 최적화 및 업로드 중...", "info");

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            // 이미지 리사이징 (최대 1024px)
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

                    // 1. 배경 이미지 자동 저장
                    if (targetId === 'heroImage') {
                        setDoc(getConfDoc(), { heroImage: downloadURL }, { merge: true }).then(() => {
                            window.showToast("배경 이미지가 변경되었습니다.");
                            document.getElementById('hero-section').style.backgroundImage = `url('${downloadURL}')`;
                        });
                    } 
                    // 2. [추가] 로고 이미지 자동 저장
                    else if (targetId === 'logoImage') {
                        setDoc(getConfDoc(), { logo: downloadURL }, { merge: true }).then(() => {
                            window.showToast("로고 이미지가 변경되었습니다.");
                            const logoImg = document.getElementById("logo-img-display");
                            if(logoImg) { logoImg.src = downloadURL; logoImg.classList.remove("hidden"); }
                            const logoIcon = document.getElementById("logo-icon-display");
                            if(logoIcon) logoIcon.classList.add("hidden");
                        });
                    }
                    // 3. 일반 에디터용 이미지 (미리보기만 처리, 저장은 '저장' 버튼 클릭 시)
                    else {
                        const el = document.getElementById(targetId);
                        if (el) {
                            el.value = downloadURL;
                            const previewId = targetId.replace('input', 'preview'); // editor-input-image -> editor-preview-image
                            const previewEl = document.getElementById(previewId);
                            if (previewEl) { 
                                previewEl.src = downloadURL; 
                                previewEl.classList.remove('hidden'); 
                            }
                            window.showToast("이미지가 업로드되었습니다.");
                        }
                    }
                } catch (error) {
                    console.error("Upload failed:", error);
                    window.showToast("이미지 업로드 실패 (Storage 설정 확인 필요)", "error");
                } finally {
                    if (labelBtn) {
                        // 버튼 복구
                        if (targetId.includes('editor')) {
                             labelBtn.innerHTML = `🖼️ 파일<input type="file" class="hidden" accept="image/*" onchange="window.handleImageUpload(this,'${targetId}')">`;
                        } else if (targetId === 'heroImage') {
                             labelBtn.innerHTML = `🖼️ 배경 변경<input type="file" accept="image/*" class="hidden" onchange="window.handleImageUpload(this, 'heroImage')">`;
                        } else {
                             labelBtn.innerText = "업로드"; // fallback
                        }
                    }
                }
            }, 'image/jpeg', 0.8);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

export const normalizeCategory = (name) => String(name || "").trim();
