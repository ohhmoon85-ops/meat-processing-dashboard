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

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const issueNo  = String(req.query.issueNo  ?? '');
  const issueDate = String(req.query.issueDate ?? '');
  const serviceKey = String(req.query.serviceKey ?? '');

  if (!issueNo || !serviceKey) {
    return res.status(400).json({ error: 'issueNo, serviceKey 파라미터가 필요합니다.' });
  }

  const params = new URLSearchParams({ issueNo, serviceKey });
  if (issueDate) params.set('issueDate', issueDate);
  const url = `${CATTLE_URL}?${params.toString()}`;

  try {
    const xml = await httpsGet(url);
    const items = extractItems(xml);
    return res.status(200).json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: msg, url });
  }
}
