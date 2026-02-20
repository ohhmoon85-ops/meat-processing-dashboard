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

// 2단계: 등급판정 상세 (공공데이터포털 ENDPOINT 환경변수 또는 HTTPS 공식 엔드포인트)
//   Vercel 환경변수 ENDPOINT = http://data.ekape.or.kr/.../confirm/cattle 를 우선 사용
//   미설정 시 공식 HTTPS 엔드포인트 사용
const CATTLE_URL =
  'https://data.ekape.or.kr/openapi-data/service/user/grade/confirm/cattle';

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

  // docx 문서 기준: HTTP 사용 (ENDPOINT 환경변수가 있어도 HTTP 강제)
  const cattleEndpoint = CATTLE_URL;  // http://data.ekape.or.kr/.../confirm/cattle

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

    // ── 2단계: 발급번호별 등급판정 상세 조회 ─────────────────────────
    const gradeResults = await Promise.all(
      issueItems.map(async (issueItem) => {
        const issueNo   = String(issueItem.issueNo   ?? '').trim();
        const issueDate = String(issueItem.issueDate ?? '').trim();

        if (!issueNo) {
          return { issueNo: '', items: [] as unknown[], debug: 'issueNo 없음' };
        }

        // 요청 URL 구성 (docx 예시: issueNo 먼저)
        let url =
          `${cattleEndpoint}` +
          `?issueNo=${encodeURIComponent(issueNo)}` +
          `&serviceKey=${encodeURIComponent(apiKey)}`;
        if (issueDate) url += `&issueDate=${encodeURIComponent(issueDate)}`;

        // Promise.race로 8초 타임아웃 (AbortController가 Edge Runtime에서 미지원)
        try {
          const fetchRes = await Promise.race([
            fetch(url),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout_8s')), 8000)
            ),
          ]);
          const xml = await fetchRes.text();

          if (!fetchRes.ok) {
            return {
              issueNo,
              items: [] as unknown[],
              debug: `HTTP ${fetchRes.status}: ${xml.slice(0, 300)}`,
            };
          }

          try {
            return { issueNo, items: extractItems(xml), debug: undefined };
          } catch (e) {
            return {
              issueNo,
              items: [] as unknown[],
              debug: `parse: ${e instanceof Error ? e.message : String(e)} | xml: ${xml.slice(0, 300)}`,
            };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            issueNo,
            items: [] as unknown[],
            debug: `fetch: ${msg} | url: ${url}`,
          };
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
