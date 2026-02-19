/**
 * Vercel Edge Function: 축산물 등급판정 통합 조회
 * Edge runtime → Cloudflare 한국 엣지 노드를 통해 EKAPE HTTPS 접근 가능
 *
 * 호출 흐름
 *  1단계: 이력번호(animalNo) → 확인서발급번호(issueNo) 목록 조회
 *  2단계: issueNo → 소도체 상세 조회 (/confirm/cattle)
 *  3단계: 이력번호(animalNo) → 등급판정정보 직접 조회 (/meatDetail)
 */

import { XMLParser } from 'fast-xml-parser';

export const config = { runtime: 'edge' };

const EKAPE_CONFIRM_BASE = 'http://data.ekape.or.kr/openapi-data/service/user/grade/confirm';
const EKAPE_GRADE_BASE   = 'https://data.ekape.or.kr/openapi-data/service/user/grade';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

// ── 메인 핸들러 ─────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'GET') return jsonRes({ error: 'Method not allowed' }, 405);

  // ── 입력 검증 ──────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const rawAnimalNo = searchParams.get('animalNo');
  if (!rawAnimalNo) {
    return jsonRes({ error: '이력번호(animalNo) 파라미터가 필요합니다.' }, 400);
  }
  const animalNo = normalizeAnimalNo(rawAnimalNo);
  if (!/^\d{12}$/.test(animalNo)) {
    return jsonRes({ error: '이력번호는 하이픈을 제외한 12자리 숫자여야 합니다.', received: animalNo }, 400);
  }

  const apiKey = process.env.EKAPE_API_KEY;
  if (!apiKey) {
    return jsonRes({ error: 'EKAPE_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  try {
    // ── 1단계: 이력번호 → 확인서발급번호(issueNo) 조회 ───────────────
    const step1Url =
      `${EKAPE_CONFIRM_BASE}/issueNo` +
      `?animalNo=${encodeURIComponent(animalNo)}` +
      `&serviceKey=${encodeURIComponent(apiKey)}`;

    const step1Res = await fetch(step1Url);
    if (!step1Res.ok) {
      return jsonRes({ error: `1단계 API 요청 실패 (HTTP ${step1Res.status})` }, 502);
    }
    const step1Xml = await step1Res.text();
    const issueItems = extractItems(step1Xml) as Array<Record<string, string>>;

    if (issueItems.length === 0) {
      return jsonRes({ error: '해당 이력번호의 등급판정 기록이 없습니다.', animalNo }, 404);
    }

    // ── 2단계 & 3단계 병렬 실행 ──────────────────────────────────────
    const [detailedItems, animalGradeResult] = await Promise.all([

      // 2단계: 확인서 발급번호별 소도체 상세 조회
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

      // 3단계: 축산물등급판정정보 — HTTPS (Edge 한국 노드 경유)
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
            return { items: [], debug: `parse: ${e instanceof Error ? e.message : String(e)} | ${xml.slice(0, 300)}` };
          }
        } catch (e) {
          return { items: [], debug: `fetch: ${e instanceof Error ? e.message : String(e)}` };
        }
      })(),
    ]);

    return jsonRes({
      animalNo,
      totalCount: detailedItems.length,
      items: detailedItems,
      gradeInfo: animalGradeResult.items,
      gradeInfoDebug: animalGradeResult.debug ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return jsonRes({ error: message }, 500);
  }
}
