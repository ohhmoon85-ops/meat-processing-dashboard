/**
 * 한우 표준부위코드
 * 출처: 농림축산식품부 농수산물 표준코드 (11-1380000-00742-14, 2025.02)
 * 43 국내산육류 > 4301 한우
 *
 * mtrace 전송 시 표준부위명 형식: "한우/부위명"
 */

export interface CutCode {
  code: string;       // 6자리 표준부위코드
  name: string;       // 부위명 (표시용)
  mtraceName: string; // mtrace 전송용 표준부위명 ("한우/부위명")
  category: string;   // 대분할 그룹명
}

export const HANWOO_CUTS: CutCode[] = [
  // ── 안심 ──────────────────────────────────────────────────────
  { code: '430121', name: '안심',       mtraceName: '한우/안심',       category: '안심' },
  { code: '430194', name: '안심살',     mtraceName: '한우/안심살',     category: '안심' },

  // ── 등심 ──────────────────────────────────────────────────────
  { code: '430122', name: '등심',       mtraceName: '한우/등심',       category: '등심' },
  { code: '430123', name: '윗등심살',   mtraceName: '한우/윗등심살',   category: '등심' },
  { code: '430124', name: '아래등심살', mtraceName: '한우/아래등심살', category: '등심' },
  { code: '430125', name: '꽃등심살',   mtraceName: '한우/꽃등심살',   category: '등심' },
  { code: '430126', name: '살치살',     mtraceName: '한우/살치살',     category: '등심' },

  // ── 채끝 ──────────────────────────────────────────────────────
  { code: '430127', name: '채끝',       mtraceName: '한우/채끝',       category: '채끝' },
  { code: '430195', name: '채끝살',     mtraceName: '한우/채끝살',     category: '채끝' },

  // ── 목심 ──────────────────────────────────────────────────────
  { code: '430128', name: '목심',       mtraceName: '한우/목심',       category: '목심' },
  { code: '430196', name: '목심살',     mtraceName: '한우/목심살',     category: '목심' },

  // ── 앞다리 ────────────────────────────────────────────────────
  { code: '430129', name: '앞다리',     mtraceName: '한우/앞다리',     category: '앞다리' },
  { code: '430130', name: '꾸리살',     mtraceName: '한우/꾸리살',     category: '앞다리' },
  { code: '430131', name: '갈비덧살',   mtraceName: '한우/갈비덧살',   category: '앞다리' },
  { code: '430132', name: '부채살',     mtraceName: '한우/부채살',     category: '앞다리' },
  { code: '430133', name: '앞다리살',   mtraceName: '한우/앞다리살',   category: '앞다리' },
  { code: '430197', name: '부채덮개살', mtraceName: '한우/부채덮개살', category: '앞다리' },

  // ── 우둔 ──────────────────────────────────────────────────────
  { code: '4301A0', name: '우둔',       mtraceName: '한우/우둔',       category: '우둔' },
  { code: '430134', name: '우둔살',     mtraceName: '한우/우둔살',     category: '우둔' },
  { code: '430135', name: '홍두께살',   mtraceName: '한우/홍두께살',   category: '우둔' },

  // ── 설도 ──────────────────────────────────────────────────────
  { code: '430136', name: '설도',       mtraceName: '한우/설도',       category: '설도' },
  { code: '430137', name: '보섭살',     mtraceName: '한우/보섭살',     category: '설도' },
  { code: '430138', name: '설깃살',     mtraceName: '한우/설깃살',     category: '설도' },
  { code: '4301A1', name: '설깃머리살', mtraceName: '한우/설깃머리살', category: '설도' },
  { code: '430139', name: '도가니살',   mtraceName: '한우/도가니살',   category: '설도' },
  { code: '4301A2', name: '삼각살',     mtraceName: '한우/삼각살',     category: '설도' },

  // ── 양지 ──────────────────────────────────────────────────────
  { code: '430140', name: '양지',       mtraceName: '한우/양지',       category: '양지' },
  { code: '430141', name: '양지머리',   mtraceName: '한우/양지머리',   category: '양지' },
  { code: '430142', name: '업진살',     mtraceName: '한우/업진살',     category: '양지' },
  { code: '4301A3', name: '업진안살',   mtraceName: '한우/업진안살',   category: '양지' },
  { code: '430143', name: '차돌박이',   mtraceName: '한우/차돌박이',   category: '양지' },
  { code: '4301A4', name: '치마양지',   mtraceName: '한우/치마양지',   category: '양지' },
  { code: '430144', name: '치마살',     mtraceName: '한우/치마살',     category: '양지' },
  { code: '4301A5', name: '앞치마살',   mtraceName: '한우/앞치마살',   category: '양지' },

  // ── 사태 ──────────────────────────────────────────────────────
  { code: '430145', name: '사태',       mtraceName: '한우/사태',       category: '사태' },
  { code: '430146', name: '아롱사태',   mtraceName: '한우/아롱사태',   category: '사태' },
  { code: '430147', name: '뭉치사태',   mtraceName: '한우/뭉치사태',   category: '사태' },
  { code: '430148', name: '앞사태',     mtraceName: '한우/앞사태',     category: '사태' },
  { code: '430149', name: '뒷사태',     mtraceName: '한우/뒷사태',     category: '사태' },
  { code: '4301A6', name: '상박살',     mtraceName: '한우/상박살',     category: '사태' },

  // ── 갈비 ──────────────────────────────────────────────────────
  { code: '430150', name: '갈비',       mtraceName: '한우/갈비',       category: '갈비' },
  { code: '4301A7', name: '본갈비',     mtraceName: '한우/본갈비',     category: '갈비' },
  { code: '4301A8', name: '꽃갈비',     mtraceName: '한우/꽃갈비',     category: '갈비' },
  { code: '4301A9', name: '참갈비',     mtraceName: '한우/참갈비',     category: '갈비' },
  { code: '4301B0', name: '갈비살',     mtraceName: '한우/갈비살',     category: '갈비' },
  { code: '430151', name: '마구리',     mtraceName: '한우/마구리',     category: '갈비' },
  { code: '430152', name: '토시살',     mtraceName: '한우/토시살',     category: '갈비' },
  { code: '430153', name: '안창살',     mtraceName: '한우/안창살',     category: '갈비' },
  { code: '430154', name: '제비추리',   mtraceName: '한우/제비추리',   category: '갈비' },

  // ── 부산물 ────────────────────────────────────────────────────
  { code: '430161', name: '사골',       mtraceName: '한우/사골',       category: '부산물' },
  { code: '430162', name: '꼬리',       mtraceName: '한우/꼬리',       category: '부산물' },
  { code: '430163', name: '도가니',     mtraceName: '한우/도가니',     category: '부산물' },
  { code: '430164', name: '등뼈',       mtraceName: '한우/등뼈',       category: '부산물' },
  { code: '430171', name: '족',         mtraceName: '한우/족',         category: '부산물' },
  { code: '430172', name: '머리',       mtraceName: '한우/머리',       category: '부산물' },
  { code: '430174', name: '간',         mtraceName: '한우/간',         category: '부산물' },
  { code: '430188', name: '혀',         mtraceName: '한우/혀',         category: '부산물' },
  { code: '430189', name: '염통',       mtraceName: '한우/염통',       category: '부산물' },
  { code: '430191', name: '지방',       mtraceName: '한우/지방',       category: '부산물' },
  { code: '430192', name: '대장',       mtraceName: '한우/대장',       category: '부산물' },
  { code: '430193', name: '소장',       mtraceName: '한우/소장',       category: '부산물' },
];

/** 대분할 카테고리 순서 */
export const CUT_CATEGORIES = [
  '안심', '등심', '채끝', '목심', '앞다리',
  '우둔', '설도', '양지', '사태', '갈비', '부산물',
] as const;

/** 코드로 부위 찾기 */
export const findCutByCode = (code: string): CutCode | undefined =>
  HANWOO_CUTS.find((c) => c.code === code);
