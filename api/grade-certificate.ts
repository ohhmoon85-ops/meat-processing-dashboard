/**
 * Vercel 서버리스 함수: 축산물등급판정확인서 발급정보 조회
 *
 * 출처: 축산물품질평가원 (data.ekape.or.kr)
 * 공공데이터포털: https://www.data.go.kr/data/15057101/openapi.do
 *
 * 호출 흐름
 *  1단계: 이력번호(animalNo)  → 확인서발급번호(issueNo) 조회
 *  2단계: 확인서발급번호(issueNo) → 등급판정 상세정보 조회
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { XMLParser } from 'fast-xml-parser';

const EKAPE_BASE = 'http://data.ekape.or.kr/openapi-data/service/user/grade/confirm';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  // 숫자처럼 보이는 값도 문자열로 유지 (이력번호·발급번호 등의 앞자리 0 보존)
  parseTagValue: false,
});

// ── 헬퍼: 이력번호 정규화 (하이픈·공백 제거) ────────────────────────
function normalizeAnimalNo(raw: string): string {
  return raw.replace(/[-\s]/g, '');
}

// ── 헬퍼: 공공데이터 API XML 응답을 파싱 후 items 배열 반환 ─────────
interface EkapeResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: unknown } | null;
      totalCount?: string | number;
    };
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

// ── 메인 핸들러 ──────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS: 동일 Vercel 프로젝트 프론트에서만 호출하므로 같은 origin 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // ── API 키 확인 ────────────────────────────────────────────────────
  const apiKey = process.env.EKAPE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'EKAPE_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    // ── 1단계: 이력번호 → 확인서발급번호(issueNo) 목록 조회 ──────────
    const step1Url =
      `${EKAPE_BASE}/issueNo` +
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

    // ── 2단계: 발급번호별 소도체 상세 조회 (병렬) ───────────────────
    const detailedItems = await Promise.all(
      issueItems.map(async (issueItem) => {
        const issueNo = String(issueItem.issueNo ?? '').trim();
        if (!issueNo) return { ...issueItem, detail: [] };

        const step2Url =
          `${EKAPE_BASE}/cattle` +
          `?issueNo=${encodeURIComponent(issueNo)}` +
          `&serviceKey=${encodeURIComponent(apiKey)}`;

        const step2Res = await fetch(step2Url);
        if (!step2Res.ok) {
          return { ...issueItem, detail: [], detailError: `HTTP ${step2Res.status}` };
        }

        const step2Xml = await step2Res.text();
        let detail: unknown[] = [];
        try {
          detail = extractItems(step2Xml);
        } catch (e) {
          return {
            ...issueItem,
            detail: [],
            detailError: e instanceof Error ? e.message : '상세 조회 실패',
          };
        }

        return { ...issueItem, detail };
      })
    );

    return res.status(200).json({
      animalNo,
      totalCount: detailedItems.length,
      items: detailedItems,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return res.status(500).json({ error: message });
  }
}
