import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// 관리자 UID (보안 유지를 위해 기존 값 유지)
export const ADMIN_UID = "7OXzH2aIFZYH9jdJF23GuRdXMy63";

// Firebase 설정
const firebaseConfig = { 
    apiKey: "AIzaSyCPGbTBQv0-onTukNdr-KlQheMM1NEFkuA", 
    authDomain: "dgss-58aec.firebaseapp.com", 
    projectId: "dgss-58aec", 
    storageBucket: "dgss-58aec.firebasestorage.app", 
    messagingSenderId: "879356370168", 
    appId: "1:879356370168:web:d5aab39fede28db175ef0d" 
};

// Firebase 초기화
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// 스토어 식별 ID
export const appId = "seafood-store-real";

// 컬렉션 명세
export const COLLECTIONS = {
    CONFIG: 'storeConfig',
    PRODUCTS: 'products',
    ORDERS: 'orders',
    INQUIRIES: 'inquiries',
    NOTICES: 'notices',
    BLOGS: 'blogs',
    COMMENTS: 'blogComments' // [중요] 보내주신 코드대로 'blogComments'로 복구
};

// [핵심] 자주 쓰는 레퍼런스 헬퍼 (보내주신 원본 방식 적용)
// 경로: artifacts -> [appId] -> public -> data -> [컬렉션]
export const getPublicDataRef = (col) => collection(db, "artifacts", appId, "public", "data", col);

// 경로: artifacts -> [appId] -> public -> data -> storeConfig -> main
// 주의: 데이터베이스의 storeConfig 안에 문서 ID가 반드시 "main"이어야 합니다.
export const getConfDoc = () => doc(db, "artifacts", appId, "public", "data", COLLECTIONS.CONFIG, "main");

// Telegram 알림 Worker URL
export const TELEGRAM_WORKER_URL = "https://dg-telegram-bot.dev-jakehan.workers.dev";


