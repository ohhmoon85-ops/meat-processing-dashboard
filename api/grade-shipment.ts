/**
 * Vercel Node.js Serverless Function: 원패스 전자등록 (출고/포장처리 신고)
 * Region: icn1 (Seoul) — mtrace 서버와 낮은 지연
 *
 * 전송 흐름
 *   POST /api/grade-shipment  →  mtrace.go.kr 전자신고 시스템
 *
 * ────────────────────────────────────────────────────────────────────
 *  필수 환경변수 (Vercel 대시보드 > Settings > Environment Variables)
 * ────────────────────────────────────────────────────────────────────
 *  MTRACE_ENDPOINT    기본값: http://api.mtrace.go.kr/rest/dfts/trace/transParam
 *  MTRACE_USER_ID     mtrace 시스템 사용자 ID (EKAPE / 이력관리시스템에서 발급)
 *  MTRACE_API_KEY     mtrace 시스템 API 키
 *  MTRACE_SERVICE_KEY 서비스키 — 기본값: addCattleOut (소 출고 신고)
 *                      ※ 포장처리 신고의 경우 addCattlePackng 등으로 변경
 *
 * ────────────────────────────────────────────────────────────────────
 *  POST Body (JSON, Content-Type: application/json)
 * ────────────────────────────────────────────────────────────────────
 *  {
 *    animalNo:   string   // 이력번호 12자리 (하이픈 없이)
 *    issueNo:    string   // 확인서발급번호 (Step 1)
 *    carcassNo:  string   // 도체번호 (Step 2)
 *    breedNm:    string   // 품종명 (한우/육우 등)
 *    sexNm:      string   // 성별명
 *    weight:     string   // 도체중 (kg)
 *    qulGrade:   string   // 육질등급명
 *    yieldGrade: string   // 육량등급명
 *    judgeDate:  string   // 등급판정일 (YYYYMMDD)
 *    abattNm:    string   // 도축장명
 *    compBizNo:  string   // 신청인 사업자등록번호 (하이픈 제외)
 *    compNm:     string   // 업소명
 *  }
 *
 * ────────────────────────────────────────────────────────────────────
 *  transParam 문자열 포맷 (파이프 "|" 구분)
 * ────────────────────────────────────────────────────────────────────
 *  ※ 실제 mtrace API 서비스키별 transParam 순서는 EKAPE/농림부 가이드를 참고하세요.
 *    현재 구현은 소 출고 신고(addCattleOut) 기준 추정 포맷입니다.
 *    항목 순서: 이력번호|도체번호|품종|성별|도체중|육질등급|육량등급|판정일|도축장명|사업자번호|업소명|처리일자|확인서발급번호
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_ENDPOINT =
  'http://api.mtrace.go.kr/rest/dfts/trace/transParam';

// ── HTTP(S) POST 헬퍼 ─────────────────────────────────────────────
function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: Number(parsed.port) || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf-8'),
      },
    };

    // EKAPE/mtrace 인증서 문제 우회 (Node.js TLS 설정)
    const transport = isHttps
      ? https
      : http;

    const req = (transport as typeof http).request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') })
      );
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout_15s')));
    req.write(bodyStr, 'utf-8');
    req.end();
  });
}

// ── CORS 헤더 설정 ───────────────────────────────────────────────
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── 메인 핸들러 ──────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── 환경변수 검증 ───────────────────────────────────────────────
  const endpoint   = process.env.MTRACE_ENDPOINT   ?? DEFAULT_ENDPOINT;
  const userId     = process.env.MTRACE_USER_ID;
  const apiKey     = process.env.MTRACE_API_KEY;
  const serviceKey = process.env.MTRACE_SERVICE_KEY ?? 'addCattleOut';

  if (!userId || !apiKey) {
    // 자격증명 미설정 시 → 전자등록 기능 비활성화 (인쇄에는 영향 없음)
    return res.status(503).json({
      success: false,
      error: 'MTRACE 자격증명이 설정되지 않았습니다.',
      hint: 'Vercel 환경변수 MTRACE_USER_ID, MTRACE_API_KEY를 설정해 주세요. ' +
            '자격증명은 농림축산식품부 이력관리시스템(mtrace.go.kr) 또는 EKAPE에서 발급받습니다.',
      configured: false,
    });
  }

  // ── 요청 본문 파싱 ─────────────────────────────────────────────
  const body = req.body as Record<string, string> | null;
  if (!body) {
    return res.status(400).json({ success: false, error: '요청 본문이 없습니다.' });
  }

  const {
    animalNo,
    issueNo    = '',
    carcassNo  = '',
    breedNm    = '',
    sexNm      = '',
    weight     = '',
    qulGrade   = '',
    yieldGrade = '',
    judgeDate  = '',
    abattNm    = '',
    compBizNo  = '',
    compNm     = '',
  } = body;

  if (!animalNo || !/^\d{12}$/.test(animalNo.replace(/[-\s]/g, ''))) {
    return res.status(400).json({ success: false, error: '올바른 이력번호(12자리)가 필요합니다.' });
  }

  const cleanAnimalNo  = animalNo.replace(/[-\s]/g, '');
  const cleanBizNo     = compBizNo.replace(/[-\s]/g, '');
  const today          = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cleanJudgeDate = judgeDate.replace(/-/g, '') || today;

  // ── transParam 조립 ─────────────────────────────────────────────
  // ※ 항목 순서 및 구분자는 mtrace API 공식 가이드에서 확인 필요.
  //    아래는 소 출고 신고(addCattleOut) 추정 포맷입니다.
  const transParam = [
    cleanAnimalNo,  // 01. 이력번호
    carcassNo,      // 02. 도체번호
    breedNm,        // 03. 품종
    sexNm,          // 04. 성별
    weight,         // 05. 도체중(kg)
    qulGrade,       // 06. 육질등급
    yieldGrade,     // 07. 육량등급
    cleanJudgeDate, // 08. 판정일(YYYYMMDD)
    abattNm,        // 09. 도축장명
    cleanBizNo,     // 10. 사업자등록번호
    compNm,         // 11. 업소명
    today,          // 12. 처리일자(YYYYMMDD)
    issueNo,        // 13. 확인서발급번호
  ].join('|');

  const requestBody = {
    userId,
    apiKey,
    serviceKey,
    item: [{ transParam }],
  };

  // ── mtrace POST 전송 ────────────────────────────────────────────
  try {
    const result = await postJson(endpoint, requestBody);
    const isSuccess = result.status >= 200 && result.status < 300;

    // JSON 또는 텍스트 응답 처리
    let parsed: unknown = result.text;
    try { parsed = JSON.parse(result.text); } catch { /* 텍스트 응답 유지 */ }

    // mtrace 응답에서 성공 코드 추출 시도
    const responseObj = parsed as Record<string, unknown> | null;
    const resultCode  = responseObj?.resultCode ?? responseObj?.code ?? null;
    const resultMsg   = responseObj?.resultMsg  ?? responseObj?.message ?? null;
    const mtraceOk    = isSuccess && (resultCode === '00' || resultCode === '0' || resultCode === null);

    return res.status(200).json({
      success:      mtraceOk,
      mtraceStatus: result.status,
      resultCode:   resultCode,
      resultMsg:    resultMsg ?? (mtraceOk ? '전자등록 완료' : '전자등록 실패'),
      response:     parsed,
      sentPayload: {
        serviceKey,
        animalNo:  cleanAnimalNo,
        issueNo,
        carcassNo,
        judgeDate: cleanJudgeDate,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({
      success: false,
      error: msg,
      hint: 'mtrace 서버 연결 실패. MTRACE_ENDPOINT 환경변수를 확인해 주세요.',
    });
  }
}
