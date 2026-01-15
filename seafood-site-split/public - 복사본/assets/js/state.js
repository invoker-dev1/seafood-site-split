
// 앱 전체에서 공유되는 상태 변수들 (Global State)
export const state = {
    // 1. 관리자/디자인 모드 상태
    isAdmin: false,       // 관리자 로그인 여부
    isDesignMode: false,  // 디자인 수정 모드 (텍스트 클릭 수정) ON/OFF

    // 2. 데이터 캐시 (Firestore 읽기 최소화)
    productCache: [],     // 상품 목록 캐시
    orderCache: [],       // (사용 안 함 - 실시간 리스너 사용)
    configCategories: [], // 카테고리 목록 캐시

    // 3. UI 상태 관리
    currentCart: [],          // 장바구니 내용 (LocalStorage와 동기화)
    menuFilterCategory: "all",// 현재 선택된 메뉴 카테고리
    visibleMenuCount: 20,     // 무한 스크롤용: 현재 보여지는 상품 개수
    
    // 4. 상세 보기용 임시 변수
    currentBlogId: null,      // 현재 보고 있는 블로그 글 ID (댓글 작성 시 사용)

    // 5. 관리자 모드 전용 상태
    isCategoryEditMode: false, // 카테고리 편집(삭제/추가) 모드
    adminListeners: {},        // 관리자 탭 전환 시 기존 리스너 해제용 저장소
    lastOrderDoc: null         // 주문 목록 '더 보기' 기능을 위한 마지막 문서 커서
};
