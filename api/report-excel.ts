/**
 * Vercel 서버리스 함수: 농림부 실적 보고서 엑셀 다운로드
 *
 * GET /api/report-excel?month=2026-02
 *
 * - PostgreSQL에서 해당 월의 production_logs를 조회
 * - exceljs로 메모리 상에서 엑셀 Buffer를 생성
 * - Content-Disposition 헤더로 즉시 다운로드 응답
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';

// ── PostgreSQL 커넥션 풀 (서버리스 환경에서 재사용) ─────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

// ── 보고상태 코드 → 한글 매핑 ─────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  PENDING: '미보고',
  REPORTED: '보고완료',
  REJECTED: '반려',
};

// ── 메인 핸들러 ────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 파라미터 검증 (YYYY-MM) ───────────────────────────────────
  const month = req.query.month;
  if (!month || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({
      error: 'month 파라미터가 필요합니다. (형식: YYYY-MM, 예: 2026-02)',
    });
  }

  // 해당 월의 시작일/종료일 계산
  const [year, mon] = month.split('-').map(Number);
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(mon + 1 > 12 ? 1 : mon + 1).padStart(2, '0')}-01`;
  const endYear = mon + 1 > 12 ? year + 1 : year;
  const endDateFinal = `${endYear}-${String(mon + 1 > 12 ? 1 : mon + 1).padStart(2, '0')}-01`;

  try {
    // ── DB 조회 ─────────────────────────────────────────────────
    const { rows } = await pool.query(
      `SELECT
         production_date,
         traceability_no,
         product_name,
         part_name,
         production_weight,
         report_status,
         note
       FROM production_logs
       WHERE production_date >= $1
         AND production_date <  $2
       ORDER BY production_date ASC, id ASC`,
      [startDate, endDateFinal]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: `${month}에 해당하는 생산 데이터가 없습니다.`,
      });
    }

    // ── exceljs 워크북 생성 (메모리 Buffer) ─────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '육가공 HACCP 시스템';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('생산실적', {
      properties: { defaultColWidth: 15 },
    });

    // 헤더 정의
    sheet.columns = [
      { header: '연번',       key: 'seq',         width: 8  },
      { header: '생산일자',   key: 'date',        width: 14 },
      { header: '이력번호',   key: 'traceNo',     width: 18 },
      { header: '품목명',     key: 'product',     width: 12 },
      { header: '부위명',     key: 'part',        width: 12 },
      { header: '생산중량(kg)', key: 'weight',    width: 14 },
      { header: '보고상태',   key: 'status',      width: 12 },
      { header: '비고',       key: 'note',        width: 24 },
    ];

    // 헤더 스타일
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' },
    };
    headerRow.height = 24;

    // 데이터 행 추가
    rows.forEach((row, idx) => {
      const dateStr =
        row.production_date instanceof Date
          ? row.production_date.toISOString().slice(0, 10)
          : String(row.production_date);

      sheet.addRow({
        seq: idx + 1,
        date: dateStr,
        traceNo: row.traceability_no,
        product: row.product_name,
        part: row.part_name,
        weight: Number(row.production_weight),
        status: STATUS_LABEL[row.report_status] ?? row.report_status,
        note: row.note || '',
      });
    });

    // 데이터 행 중앙 정렬 + 테두리
    for (let r = 2; r <= rows.length + 1; r++) {
      const dataRow = sheet.getRow(r);
      dataRow.alignment = { horizontal: 'center', vertical: 'middle' };
      dataRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    }

    // 헤더에도 테두리 적용
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' },
      };
    });

    // ── Buffer 생성 & 응답 ─────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();

    const fileName = encodeURIComponent(`농림부_보고_${month.replace('-', '')}.xlsx`);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.setHeader('Content-Length', buffer.byteLength.toString());

    return res.status(200).send(buffer);
  } catch (err) {
    console.error('report-excel error:', err);
    const message = err instanceof Error ? err.message : '알 수 없는 서버 오류';
    return res.status(500).json({ error: message });
  }
}
