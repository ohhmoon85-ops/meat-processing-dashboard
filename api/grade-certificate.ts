/**
 * Vercel Edge Function: 축산물 등급판정 통합 조회
 * Edge runtime → Cloudflare 한국 엣지 노드 경유
 *
 * 호출 흐름
 *  1단계: 이력번호(animalNo) → 확인서발급번호(issueNo) 목록 조회
 *  2단계: issueNo + issueDate → 축산물등급판정정보 상세 조회
 *
 * 공공데이터포털 서비스정보
 *  End Point : https://data.ekape.or.kr/openapi-data/service/user/grade
 *  참고문서   : 축산물품질평가원 OpenAPI활용가이드 축산물등급판정정보 20260121.docx
 */

import { XMLParser } from 'fast-xml-parser';

export const config = { runtime: 'edge' };

// ── 엔드포인트 ─────────────────────────────────────────────────────
// 1단계: 확인서발급번호 목록 (기존 작동 확인된 경로)
const ISSUE_NO_URL =
  'http://data.ekape.or.kr/openapi-data/service/user/grade/confirm/issueNo';

// 2단계: /api/grade-cattle 프록시 경유 (Node.js icn1 Seoul → EKAPE HTTPS)
// Edge Runtime은 EKAPE HTTPS 인증서 TLS 오류 → Node.js rejectUnauthorized:false 우회
const CATTLE_PROXY = '/api/grade-cattle';

// ── XML 파서 ───────────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
});

// ── 헬퍼 ──────────────────────────────────────────────────────────
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

// ── 메인 핸들러 ───────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== 'GET') return jsonRes({ error: 'Method not allowed' }, 405);

  // ── 입력 검증 ────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const rawAnimalNo = searchParams.get('animalNo');
  if (!rawAnimalNo) {
    return jsonRes({ error: '이력번호(animalNo) 파라미터가 필요합니다.' }, 400);
  }
  const animalNo = normalizeAnimalNo(rawAnimalNo);
  if (!/^\d{12}$/.test(animalNo)) {
    return jsonRes({
      error: '이력번호는 하이픈을 제외한 12자리 숫자여야 합니다.',
      received: animalNo,
    }, 400);
  }

  const apiKey = process.env.EKAPE_API_KEY;
  if (!apiKey) {
    return jsonRes({ error: 'EKAPE_API_KEY 환경변수가 설정되지 않았습니다.' }, 500);
  }

  // 2단계 프록시 URL: 현재 요청의 origin + /api/grade-cattle
  const origin = new URL(req.url).origin;

  try {
    // ── 1단계: 이력번호 → 확인서발급번호(issueNo) 목록 ───────────────
    const step1Url =
      `${ISSUE_NO_URL}` +
      `?animalNo=${encodeURIComponent(animalNo)}` +
      `&serviceKey=${encodeURIComponent(apiKey)}`;

    const step1Res = await fetch(step1Url);
    if (!step1Res.ok) {
      return jsonRes({ error: `1단계 API 요청 실패 (HTTP ${step1Res.status})` }, 502);
    }
    const step1Xml = await step1Res.text();
    const issueItems = extractItems(step1Xml) as Array<Record<string, unknown>>;

    if (issueItems.length === 0) {
      return jsonRes({ error: '해당 이력번호의 등급판정 기록이 없습니다.', animalNo }, 404);
    }

    // ── 2단계: /api/grade-cattle 프록시 경유 등급판정 상세 조회 ───────
    const gradeResults = await Promise.all(
      issueItems.map(async (issueItem) => {
        const issueNo = String(issueItem.issueNo ?? '').trim();

        if (!issueNo) {
          return { issueNo: '', items: [] as unknown[], debug: 'issueNo 없음' };
        }

        const rawDate = String(issueItem.issueDate ?? '').trim();
        // YYYYMMDD → YYYY-MM-DD 변환 (오퍼레이션 11 샘플 형식: 2013-01-10)
        const issueDate = /^\d{8}$/.test(rawDate)
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : rawDate;
        const params = new URLSearchParams({ issueNo, serviceKey: apiKey });
        if (issueDate) params.set('issueDate', issueDate);
        const proxyUrl = `${origin}${CATTLE_PROXY}?${params.toString()}`;

        try {
          const fetchRes = await Promise.race([
            fetch(proxyUrl),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout_20s')), 20000)
            ),
          ]);
          const json = await fetchRes.json() as { items?: unknown[]; error?: string };

          if (!fetchRes.ok || json.error) {
            return {
              issueNo,
              items: [] as unknown[],
              debug: `proxy ${fetchRes.status}: ${json.error ?? ''}`,
            };
          }

          return { issueNo, items: json.items ?? [], debug: undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { issueNo, items: [] as unknown[], debug: `proxy fetch: ${msg}` };
        }
      })
    );

    const gradeInfo = gradeResults.flatMap((r) => r.items);
    const debugMsgs = gradeResults
      .filter((r) => r.debug)
      .map((r) => `[${r.issueNo}] ${r.debug}`);

    return jsonRes({
      animalNo,
      totalCount: issueItems.length,
      items: issueItems,
      gradeInfo,
      gradeInfoDebug: debugMsgs.length > 0 ? debugMsgs.join(' || ') : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return jsonRes({ error: message }, 500);
  }
}
