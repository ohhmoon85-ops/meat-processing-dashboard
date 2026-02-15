import * as XLSX from 'xlsx';

/**
 * 원본 생산 데이터 타입 정의
 */
export interface ProductionData {
  productionDate: string;      // 생산일자 (YYYY-MM-DD)
  traceabilityNumber: string;  // 이력번호 (13자리)
  productName: string;         // 품목명 (예: 한우, 돼지 등)
  partName: string;            // 부위명 (예: 등심, 안심 등)
  productionWeight: number;    // 생산중량(kg)
  reportStatus: string;        // 보고상태 (예: 미보고, 보고완료 등)
  note?: string;               // 비고 (선택사항)
}

/**
 * 농림부 제출용 엑셀 데이터 타입
 */
interface ExcelRowData {
  연번: number;
  생산일자: string;
  '이력번호(13자리)': string;
  품목명: string;
  부위명: string;
  '생산중량(kg)': number;
  보고상태: string;
  비고: string;
}

/**
 * 농림부 보고용 엑셀 파일 생성 및 다운로드
 * @param data - 원본 생산 데이터 배열
 * @param fileName - 저장할 파일명 (기본값: 농림부_보고_YYYYMMDD.xlsx)
 */
export const exportToExcel = (
  data: ProductionData[],
  fileName?: string
): void => {
  // 데이터가 없을 경우 처리
  if (!data || data.length === 0) {
    alert('엑셀로 내보낼 데이터가 없습니다.');
    return;
  }

  // 원본 데이터를 농림부 양식에 맞게 매핑
  const excelData: ExcelRowData[] = data.map((item, index) => ({
    연번: index + 1,
    생산일자: item.productionDate,
    '이력번호(13자리)': item.traceabilityNumber,
    품목명: item.productName,
    부위명: item.partName,
    '생산중량(kg)': item.productionWeight,
    보고상태: item.reportStatus,
    비고: item.note || '',
  }));

  // 워크시트 생성
  const worksheet = XLSX.utils.json_to_sheet(excelData);

  // 컬럼 너비 자동 조절 (가독성 향상)
  const columnWidths = [
    { wch: 8 },   // 연번
    { wch: 12 },  // 생산일자
    { wch: 16 },  // 이력번호(13자리)
    { wch: 12 },  // 품목명
    { wch: 12 },  // 부위명
    { wch: 14 },  // 생산중량(kg)
    { wch: 12 },  // 보고상태
    { wch: 20 },  // 비고
  ];
  worksheet['!cols'] = columnWidths;

  // 워크북 생성
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '생산실적');

  // 파일명 생성 (기본값: 농림부_보고_YYYYMMDD.xlsx)
  const defaultFileName = `농림부_보고_${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '')}.xlsx`;
  const finalFileName = fileName || defaultFileName;

  // 엑셀 파일 다운로드
  XLSX.writeFile(workbook, finalFileName);
};

/**
 * 더미 데이터 생성 함수 (테스트용)
 * @param count - 생성할 데이터 개수
 * @returns ProductionData 배열
 */
export const generateDummyData = (count: number = 10): ProductionData[] => {
  const productNames = ['한우', '돼지', '닭'];
  const partNames = ['등심', '안심', '목심', '앞다리', '뒷다리'];
  const reportStatuses = ['미보고', '보고완료', '보고중'];

  return Array.from({ length: count }, (_, index) => {
    // 이력번호 13자리 생성 (001 + YYYYMMDD + 일련번호 2자리)
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30)); // 최근 30일 이내
    const dateStr = date.toISOString().slice(0, 10);
    const dateForTrace = dateStr.replace(/-/g, ''); // YYYYMMDD
    const serialNumber = String(index + 1).padStart(2, '0');
    const traceabilityNumber = `001${dateForTrace}${serialNumber}`;

    return {
      productionDate: dateStr,
      traceabilityNumber,
      productName: productNames[Math.floor(Math.random() * productNames.length)],
      partName: partNames[Math.floor(Math.random() * partNames.length)],
      productionWeight: parseFloat((Math.random() * 100 + 10).toFixed(2)), // 10~110kg
      reportStatus: reportStatuses[Math.floor(Math.random() * reportStatuses.length)],
      note: index % 3 === 0 ? '특이사항 있음' : '',
    };
  });
};
