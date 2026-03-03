/**
 * EKAPE API 진단 엔드포인트 (임시)
 * GET /api/debug-ekape?issueNo=XXXX&issueDate=YYYY-MM-DD
 *
 * 실제 EKAPE /confirm/cattle 호출 결과(원문)를 그대로 반환해
 * ACCESS DENIED 사유 등을 확인하기 위한 임시 디버그용 엔드포인트
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'node:http';

function httpGet(url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout_15s')));
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey  = process.env.EKAPE_API_KEY ?? '';
  const issueNo = String(req.query.issueNo ?? '');
  const issueDate = String(req.query.issueDate ?? '');

  const BASE = 'http://data.ekape.or.kr/openapi-data/service/user/grade';

  // 여러 후보 엔드포인트 동시 테스트
  const endpoints = [
    `${BASE}/confirm/cattle`,
    `${BASE}/gradeInfo`,
    `${BASE}/info`,
  ];

  const results: Record<string, unknown> = {
    apiKeyPrefix: apiKey.slice(0, 8) + '...',
    issueNo,
    issueDate,
  };

  for (const ep of endpoints) {
    const params = new URLSearchParams({ serviceKey: apiKey });
    if (issueNo) params.set('issueNo', issueNo);
    if (issueDate) params.set('issueDate', issueDate);
    const url = `${ep}?${params.toString()}`;
    try {
      const r = await httpGet(url);
      results[ep] = { status: r.status, body: r.text.slice(0, 500) };
    } catch (e) {
      results[ep] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return res.status(200).json(results);
}
