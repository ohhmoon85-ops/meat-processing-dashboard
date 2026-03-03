/**
 * Vercel Node.js Serverless Function: 원패스 전자등록 (매입/가공/출고 신고)
 * Region: icn1 (Seoul)
 *
 * mtrace 전산신고 API (pub.mtrace.go.kr 포장처리업체용)
 * URL: http://api.mtrace.go.kr/rest/dfts/trace/transParam
 * 구분자: | (ASCII 124) 파이프, 사업자번호는 하이픈 없이
 *
 * ────────────────────────────────────────────────────────────────────
 *  필수 환경변수 (Vercel 대시보드 > Settings > Environment Variables)
 * ────────────────────────────────────────────────────────────────────
 *  MTRACE_USER_ID       mtrace 포털 로그인 ID (pub.mtrace.go.kr)
 *  MTRACE_API_KEY       mtrace API 키 (포털 내 계정설정 또는 이력지원실 1577-2633)
 *  MTRACE_REGISTER_TYPE 등록 유형: purchase(매입신고) | production(가공생산) | sales(출고)
 *                       기본값: purchase
 *  MTRACE_SERVICE_KEY   mtrace API 서비스키 (기본값: addCattleIn)
 *                       ※ 정확한 서비스키는 이력지원실(1577-2633)에 문의
 *  MTRACE_ENDPOINT      기본값: http://api.mtrace.go.kr/rest/dfts/trace/transParam
 *
 * ────────────────────────────────────────────────────────────────────
 *  등록 유형별 transParam 필드 순서 (pub.mtrace.go.kr 전송자료형식보기)
 * ────────────────────────────────────────────────────────────────────
 *
 *  [1] 매입신고 (purchase) — 도축장에서 수령 시
 *    01.입고일자(8) | 02.이력번호(15) | 03.표준부위코드(6) | 04.표준부위명(25↓)
 *    05.중량kg(6↓) | 06.입고처사업자번호(10) | 07.입고처상호(100↓)
 *    08.입고처주소(100↓) | 09.입고처유형구분(6)
 *    예: 20260226|002191046216|430110|지육|250.5|1234567890|서울도축장||077001
 *
 *  [2] 가공생산자료 (production) — 부위별 포장처리 시
 *    01.생산일자(8) | 02.이력번호(15) | 03.표준부위코드(6) | 04.표준부위명(25↓)
 *    05.중량kg(6↓) | 06.가공식별번호(25↓) | 07.공란 | 08.매입처사업자번호(10)
 *    09.매입처상호(100↓) | 10.매입처전화번호 | 11.의뢰처사업자번호(10) | 12.의뢰처상호(100↓)
 *    예: 20260226|002191046216|430122|한우/등심|1.4|002191046216-01||1234567890|서울도축장|||
 *
 *  [3] 출고자료 (sales) — 납품처로 판매/반출 시
 *    01.판매일자(8) | 02.이력번호(15) | 03.가공식별번호(25↓) | 04.공란
 *    05.판매처사업자번호(10) | 06.판매처상호(25↓) | 07.표준부위코드(6)
 *    08.표준부위명(25↓) | 09.중량kg(6↓)
 *    예: 20260226|002191046216|002191046216-01||9876543210|축산마트|430122|한우/등심|1.4
 *
 *  표준부위코드 주요 값 (농림부 농수산물 표준코드 11-1380000-00742-14)
 *    430110 지육 (전체 도체)
 *    430120 반도체
 *    430122 한우/등심
 *    입고처유형구분: 077001=도축장, 077010=가공장, 077020=판매장
 * ────────────────────────────────────────────────────────────────────
 *
 *  POST Body (JSON, Content-Type: application/json)
 *  {
 *    animalNo:     string  // 이력번호 12자리
 *    issueNo:      string  // 확인서발급번호
 *    carcassNo:    string  // 도체번호 (Step 2)
 *    breedNm:      string  // 품종명
 *    sexNm:        string  // 성별
 *    weight:       string  // 도체중 (kg) — 매입·가공생산용
 *    qulGrade:     string  // 육질등급
 *    yieldGrade:   string  // 육량등급
 *    judgeDate:    string  // 등급판정일 (YYYYMMDD)
 *    abattNm:      string  // 도축장명
 *    abattBizNo:   string  // 도축장 사업자번호 (하이픈 없이)
 *    abattAddr:    string  // 도축장 주소 (없으면 빈 값)
 *    cutCode:      string  // 표준부위코드 (기본: 430110)
 *    cutNm:        string  // 표준부위명 (기본: 지육)
 *    processingId: string  // 가공식별번호 (없으면 이력번호-01 자동생성)
 *    destBizNo:    string  // 판매처 사업자번호 (출고용)
 *    destNm:       string  // 판매처 상호 (출고용)
 *    destWeight:   string  // 판매 중량 (출고용, 없으면 weight 사용)
 *    compBizNo:    string  // 신청인(우리 회사) 사업자번호
 *    compNm:       string  // 신청인(우리 회사) 상호
 *  }
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
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port:     Number(parsed.port) || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json;charset=UTF-8',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf-8'),
      },
    };

    const transport = isHttps ? https : http;
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

// ── CORS 헤더 ────────────────────────────────────────────────────
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── 메인 핸들러 ──────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── 환경변수 ─────────────────────────────────────────────────
  const endpoint      = process.env.MTRACE_ENDPOINT ?? DEFAULT_ENDPOINT;
  const userId        = process.env.MTRACE_USER_ID;
  const apiKey        = process.env.MTRACE_API_KEY;

  // registerType: 요청 바디 > ENV 변수 > 기본값 순으로 우선순위
  // purchase(매입신고) | production(가공생산) | sales(출고)
  const bodyRegisterType = (req.body as Record<string, string>)?.registerType;
  const registerType  = bodyRegisterType ?? process.env.MTRACE_REGISTER_TYPE ?? 'purchase';

  // 서비스키: ENV 변수 > 등록 유형별 기본값
  // ※ 정확한 서비스키는 이력지원실(1577-2633) 또는 pub.mtrace.go.kr 담당자에게 문의
  const serviceKeyDefaults: Record<string, string> = {
    purchase:   'addCattleIn',
    production: 'addCattlePrc',
    sales:      'addCattleOut',
  };
  const serviceKey = process.env.MTRACE_SERVICE_KEY ?? serviceKeyDefaults[registerType] ?? 'addCattleIn';

  if (!userId || !apiKey) {
    return res.status(503).json({
      success:    false,
      configured: false,
      error:      'MTRACE 자격증명이 설정되지 않았습니다.',
      hint:       'Vercel 환경변수에 MTRACE_USER_ID, MTRACE_API_KEY를 설정하세요. ' +
                  '자격증명은 pub.mtrace.go.kr 로그인 후 계정설정에서 확인하거나 ' +
                  '이력지원실(1577-2633)에 문의하세요.',
    });
  }

  // ── 요청 본문 파싱 ─────────────────────────────────────────────
  const body = req.body as Record<string, string> | null;
  if (!body) {
    return res.status(400).json({ success: false, error: '요청 본문이 없습니다.' });
  }

  const {
    animalNo,
    issueNo       = '',
    weight        = '',
    abattNm       = '',
    abattBizNo    = '',
    abattAddr     = '',
    cutCode       = '430110',  // 기본값: 지육
    cutNm         = '지육',
    processingId  = '',
    destBizNo     = '',
    destNm        = '',
    destWeight    = '',
    compBizNo     = '',
  } = body;

  if (!animalNo || !/^\d{12}$/.test(animalNo.replace(/[-\s]/g, ''))) {
    return res.status(400).json({ success: false, error: '올바른 이력번호(12자리)가 필요합니다.' });
  }

  const cleanAnimalNo  = animalNo.replace(/[-\s]/g, '');
  const cleanBizNo     = compBizNo.replace(/[-\s]/g, '');
  const cleanAbattBiz  = abattBizNo.replace(/[-\s]/g, '');
  const cleanDestBiz   = destBizNo.replace(/[-\s]/g, '');
  const today          = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  // 가공식별번호: 제공되면 사용, 없으면 이력번호-01 자동 생성
  const prcId          = processingId || `${cleanAnimalNo}-01`;

  // ── 등록 유형별 transParam 조립 ───────────────────────────────
  let transParam: string;
  let registLabel: string;

  if (registerType === 'production') {
    // ── 가공단계(가공생산자료) ─────────────────────────────────
    // 생산일자|이력번호|표준부위코드|표준부위명|중량|가공식별번호|공란|
    // 매입처사업자번호|매입처상호|매입처전화번호|의뢰처사업자번호|의뢰처상호
    registLabel = '가공생산자료';
    transParam  = [
      today,           // 01. 생산일자 (8자리)
      cleanAnimalNo,   // 02. 이력번호 (15자리)
      cutCode,         // 03. 표준부위코드 (6자리)
      cutNm,           // 04. 표준부위명 (25자리↓)
      weight,          // 05. 중량(kg) (6자리↓)
      prcId,           // 06. 가공식별번호 (25자리↓)
      '',              // 07. 공란
      cleanAbattBiz,   // 08. 매입처사업자번호 (10자리, 하이픈 없이)
      abattNm,         // 09. 매입처상호 (100자리↓)
      '',              // 10. 매입처전화번호
      cleanBizNo,      // 11. 의뢰처사업자번호 (우리 회사, 10자리)
      '',              // 12. 의뢰처상호
    ].join('|');

  } else if (registerType === 'sales') {
    // ── 가공단계(출고자료) ─────────────────────────────────────
    // 판매일자|이력번호|가공식별번호|공란|판매처사업자번호|판매처상호|
    // 표준부위코드|표준부위명|중량
    registLabel = '출고자료';
    transParam  = [
      today,           // 01. 판매일자 (8자리)
      cleanAnimalNo,   // 02. 이력번호 (15자리)
      prcId,           // 03. 가공식별번호 (25자리↓)
      '',              // 04. 공란
      cleanDestBiz,    // 05. 판매처사업자번호 (10자리)
      destNm,          // 06. 판매처상호 (25자리↓)
      cutCode,         // 07. 표준부위코드 (6자리)
      cutNm,           // 08. 표준부위명 (25자리↓)
      destWeight || weight, // 09. 중량(kg) (6자리↓)
    ].join('|');

  } else {
    // ── 기본: 가공단계(매입신고) ──────────────────────────────
    // 입고일자|이력번호|표준부위코드|표준부위명|중량|입고처사업자번호|
    // 입고처상호|입고처주소|입고처유형구분
    registLabel = '매입신고';
    transParam  = [
      today,           // 01. 입고일자 (8자리)
      cleanAnimalNo,   // 02. 이력번호/묶음번호 (15자리)
      cutCode,         // 03. 표준부위코드 (6자리, 기본 430110=지육)
      cutNm,           // 04. 표준부위명 (25자리↓)
      weight,          // 05. 입고 중량(kg) (6자리↓)
      cleanAbattBiz,   // 06. 입고처 사업자번호 (10자리, 하이픈 없이)
      abattNm,         // 07. 입고처 상호 (100자리↓)
      abattAddr,       // 08. 입고처 주소 (100자리↓, 없으면 공란)
      '077001',        // 09. 입고처 유형구분 (077001=도축장)
    ].join('|');
  }

  const requestBody = {
    userId,
    apiKey,
    serviceKey,
    item: [{ transParam }],
  };

  // ── mtrace POST 전송 ────────────────────────────────────────
  try {
    const result    = await postJson(endpoint, requestBody);
    const isOk      = result.status >= 200 && result.status < 300;

    let parsed: unknown = result.text;
    try { parsed = JSON.parse(result.text); } catch { /* 텍스트 응답 유지 */ }

    const responseObj = parsed as Record<string, unknown> | null;
    const resultCode  = responseObj?.resultCode ?? responseObj?.code ?? null;
    const resultMsg   = String(responseObj?.resultMsg ?? responseObj?.message ?? '');
    const mtraceOk    = isOk && (resultCode === '00' || resultCode === '0' || resultCode === null);

    return res.status(200).json({
      success:      mtraceOk,
      registLabel,
      mtraceStatus: result.status,
      resultCode,
      resultMsg:    resultMsg || (mtraceOk ? `${registLabel} 전자등록 완료` : `${registLabel} 전자등록 실패`),
      response:     parsed,
      sentPayload: {
        registerType,
        serviceKey,
        animalNo:   cleanAnimalNo,
        issueNo,
        transParam,  // 디버그용
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({
      success: false,
      error:   msg,
      hint:    'mtrace 서버 연결 실패. MTRACE_ENDPOINT 환경변수를 확인해 주세요.',
    });
  }
}
