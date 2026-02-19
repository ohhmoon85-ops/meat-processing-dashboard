/**
 * Vercel 서버리스 함수: 축산물 등급판정 통합 조회
 *
 * 출처: 축산물품질평가원 (data.ekape.or.kr)
 *
 * 호출 흐름
 *  1단계: 이력번호(animalNo) → 확인서발급번호(issueNo) 목록 조회
 *  2단계: issueNo → 소도체 상세 조회 (/confirm/cattle)
 *  3단계: 이력번호(animalNo) → 등급판정정보 직접 조회 (/meatDetail)  ← 신규
 *         (2단계 권한 오류 시 대체 데이터로 활용)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { XMLParser } from 'fast-xml-parser';

const EKAPE_CONFIRM_BASE = 'http://data.ekape.or.kr/openapi-data/service/user/grade/confirm';
const EKAPE_GRADE_BASE   = 'http://data.ekape.or.kr/openapi-data/service/user/animalGrade';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false, // 앞자리 0 보존
});

// ── 헬퍼 ────────────────────────────────────────────────────────────
function normalizeAnimalNo(raw: string): string {
  return raw.replace(/[-\s]/g, '');
}

interface EkapeResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: unknown } | null };
  };
}

function extractItems(xmlText: string): unknown[] {
  const parsed = xmlParser.parse(xmlText) as EkapeResponse;
  const resultCode = parsed?.response?.header?.resultCode;
  if (resultCode !== '00' && resultCode !== '0') {
    const msg = parsed?.response?.header?.resultMsg ?? '알 수 없는 오류';
    throw new Error(`API 오류 [${resultCode}]: ${msg}`);
  }
  const item = parsed?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// ── 메인 핸들러 ─────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 입력 검증 ──────────────────────────────────────────────────────
  const rawAnimalNo = req.query.animalNo;
  if (!rawAnimalNo || typeof rawAnimalNo !== 'string') {
    return res.status(400).json({ error: '이력번호(animalNo) 파라미터가 필요합니다.' });
  }
  const animalNo = normalizeAnimalNo(rawAnimalNo);
  if (!/^\d{12}$/.test(animalNo)) {
    return res.status(400).json({
      error: '이력번호는 하이픈을 제외한 12자리 숫자여야 합니다.',
      received: animalNo,
    });
  }

  const apiKey = process.env.EKAPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'EKAPE_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    // ── 1단계: 이력번호 → 확인서발급번호(issueNo) 조회 ───────────────
    const step1Url =
      `${EKAPE_CONFIRM_BASE}/issueNo` +
      `?animalNo=${encodeURIComponent(animalNo)}` +
      `&serviceKey=${encodeURIComponent(apiKey)}`;

    const step1Res = await fetch(step1Url);
    if (!step1Res.ok) {
      return res.status(502).json({ error: `1단계 API 요청 실패 (HTTP ${step1Res.status})` });
    }
    const step1Xml = await step1Res.text();
    const issueItems = extractItems(step1Xml) as Array<Record<string, string>>;

    if (issueItems.length === 0) {
      return res.status(404).json({
        error: '해당 이력번호의 등급판정 기록이 없습니다.',
        animalNo,
      });
    }

    // ── 2단계 & 3단계 병렬 실행 ──────────────────────────────────────
    // 2단계: 확인서 발급번호별 소도체 상세 조회 (/confirm/cattle)
    // 3단계: 이력번호 직접 등급판정정보 조회 (/animalGrade) — 신규 서비스
    const [detailedItems, animalGradeResult] = await Promise.all([

      // 2단계
      Promise.all(
        issueItems.map(async (issueItem) => {
          const issueNo = String(issueItem.issueNo ?? '').trim();
          if (!issueNo) return { ...issueItem, detail: [] };

          const url =
            `${EKAPE_CONFIRM_BASE}/cattle` +
            `?issueNo=${encodeURIComponent(issueNo)}` +
            `&serviceKey=${encodeURIComponent(apiKey)}`;

          const fetchRes = await fetch(url);
          if (!fetchRes.ok) {
            return { ...issueItem, detail: [], detailError: `HTTP ${fetchRes.status}` };
          }
          const xml = await fetchRes.text();
          try {
            return { ...issueItem, detail: extractItems(xml) };
          } catch (e) {
            return {
              ...issueItem,
              detail: [],
              detailError: e instanceof Error ? e.message : '상세 조회 실패',
            };
          }
        })
      ),

      // 3단계: 축산물등급판정정보 서비스 — animalNo로 직접 조회
      (async (): Promise<{ items: unknown[]; debug?: string }> => {
        const url =
          `${EKAPE_GRADE_BASE}/meatDetail` +
          `?animalNo=${encodeURIComponent(animalNo)}` +
          `&serviceKey=${encodeURIComponent(apiKey)}`;
        try {
          const fetchRes = await fetch(url);
          const xml = await fetchRes.text();
          if (!fetchRes.ok) {
            return { items: [], debug: `HTTP ${fetchRes.status}: ${xml.slice(0, 300)}` };
          }
          try {
            return { items: extractItems(xml) };
          } catch (e) {
            return {
              items: [],
              debug: `parse error: ${e instanceof Error ? e.message : String(e)} | xml: ${xml.slice(0, 300)}`,
            };
          }
        } catch (e) {
          return { items: [], debug: `fetch error: ${e instanceof Error ? e.message : String(e)}` };
        }
      })(),
    ]);

    return res.status(200).json({
      animalNo,
      totalCount: detailedItems.length,
      items: detailedItems,
      // 3단계 등급판정정보 (근내지방도·도체중·등급 등 상세)
      gradeInfo: animalGradeResult.items,
      gradeInfoDebug: animalGradeResult.debug ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return res.status(500).json({ error: message });
  }
}
