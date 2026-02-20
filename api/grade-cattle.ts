/**
 * Vercel Node.js Serverless Function: EKAPE 소 등급판정 확인서 상세 조회
 * 리전: icn1 (Seoul)
 *
 * 시도 순서:
 *  1) HTTP /grade/confirm/cattle  (기존 경로, Edge에서 ACCESS DENIED 반환)
 *  2) HTTP /grade/cattle          (확인서 발급정보 서비스의 대안 경로)
 *
 * EKAPE HTTPS는 외부 서버에서 TCP 타임아웃 → HTTP만 사용
 *
 * GET /api/grade-cattle?issueNo=XXXX&issueDate=YYYYMMDD&serviceKey=XXXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'node:http';
import { XMLParser } from 'fast-xml-parser';

const BASE = 'http://data.ekape.or.kr/openapi-data/service/user/grade';

// 시도할 경로 순서
const CATTLE_PATHS = [
  '/confirm/cattle',  // 기존 경로
  '/cattle',          // 확인서 발급정보 서비스 대안 경로
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
});

interface EkapeResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: unknown } | null };
  };
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('timeout_10s'));
    });
  });
}

function tryExtractItems(xmlText: string): { items: unknown[]; resultCode: string } {
  const parsed = xmlParser.parse(xmlText) as EkapeResponse;
  const resultCode = String(parsed?.response?.header?.resultCode ?? '');
  if (resultCode !== '00' && resultCode !== '0') {
    const msg = parsed?.response?.header?.resultMsg ?? '알 수 없는 오류';
    throw new Error(`API 오류 [${resultCode}]: ${msg}`);
  }
  const item = parsed?.response?.body?.items?.item;
  const items = !item ? [] : Array.isArray(item) ? item : [item];
  return { items, resultCode };
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const issueNo   = String(req.query.issueNo   ?? '');
  const issueDate = String(req.query.issueDate  ?? '');
  const serviceKey = String(req.query.serviceKey ?? '');

  if (!issueNo || !serviceKey) {
    return res.status(400).json({ error: 'issueNo, serviceKey 파라미터가 필요합니다.' });
  }

  const params = new URLSearchParams({ issueNo, serviceKey });
  if (issueDate) params.set('issueDate', issueDate);

  const results: Array<{ path: string; error?: string; rawXml?: string }> = [];

  for (const path of CATTLE_PATHS) {
    const url = `${BASE}${path}?${params.toString()}`;
    try {
      const xml = await httpGet(url);
      try {
        const { items } = tryExtractItems(xml);
        return res.status(200).json({ items, path });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // rawXml 앞 500자 포함 → 어떤 응답인지 진단
        results.push({ path, error: msg, rawXml: xml.slice(0, 500) });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ path, error: msg });
    }
  }

  return res.status(502).json({ results });
}
