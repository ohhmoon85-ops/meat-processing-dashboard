/**
 * Vercel Node.js Serverless Function: EKAPE 소 등급판정 확인서 상세 조회
 * 리전: icn1 (Seoul) — 한국 EKAPE 서버와 낮은 지연
 *
 * Edge Runtime은 EKAPE HTTPS 인증서를 신뢰하지 않아 "internal error" 발생.
 * Node.js + rejectUnauthorized:false 로 TLS 검증 우회.
 *
 * GET /api/grade-cattle?issueNo=XXXX&issueDate=YYYYMMDD&serviceKey=XXXX
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';

const CATTLE_URL =
  'https://data.ekape.or.kr/openapi-data/service/user/grade/confirm/cattle';

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

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout_15s'));
    });
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).setHeader('Access-Control-Allow-Origin', '*').end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { issueNo, issueDate, serviceKey } = req.query as Record<string, string>;
  if (!issueNo || !serviceKey) {
    return res.status(400).json({ error: 'issueNo, serviceKey 파라미터가 필요합니다.' });
  }

  const params = new URLSearchParams({ issueNo, serviceKey });
  if (issueDate) params.set('issueDate', issueDate);
  const url = `${CATTLE_URL}?${params.toString()}`;

  try {
    const xml = await httpsGet(url);
    const items = extractItems(xml);
    return res.status(200).set(CORS).json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).set(CORS).json({ error: msg, url });
  }
}
