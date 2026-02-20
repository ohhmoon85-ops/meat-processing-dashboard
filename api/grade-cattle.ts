/**
 * Vercel Node.js Serverless Function: EKAPE 소 등급판정 확인서 상세 조회
 * 리전: icn1 (Seoul) — EKAPE 서버와 낮은 지연
 *
 * 진단 결과:
 *  - EKAPE HTTPS: 외부 서버에서 TCP 타임아웃 → HTTP 사용
 *  - /confirm/cattle: HTTP 연결 성공, 권한 승인 후 동작 예정 (현재 ACCESS DENIED)
 *  - /cattle: 빈 응답 (유효하지 않은 경로)
 *
 * GET /api/grade-cattle?issueNo=XXXX&issueDate=YYYYMMDD&serviceKey=XXXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'node:http';
import { XMLParser } from 'fast-xml-parser';

const CATTLE_URL =
  'http://data.ekape.or.kr/openapi-data/service/user/grade/confirm/cattle';

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

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const issueNo    = String(req.query.issueNo    ?? '');
  const issueDate  = String(req.query.issueDate   ?? '');
  const serviceKey = String(req.query.serviceKey  ?? '');

  if (!issueNo || !serviceKey) {
    return res.status(400).json({ error: 'issueNo, serviceKey 파라미터가 필요합니다.' });
  }

  const params = new URLSearchParams({ issueNo, serviceKey });
  if (issueDate) params.set('issueDate', issueDate);
  const url = `${CATTLE_URL}?${params.toString()}`;

  try {
    const xml = await httpGet(url);
    const items = extractItems(xml);
    return res.status(200).json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: msg });
  }
}
