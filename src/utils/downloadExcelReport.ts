/**
 * 농림부 보고용 엑셀 다운로드 API 호출 유틸리티
 *
 * 서버에서 exceljs로 생성된 .xlsx Buffer를 받아
 * Blob → Object URL → 다운로드를 트리거합니다.
 */

/**
 * 서버 API를 호출하여 해당 월의 농림부 보고 엑셀을 다운로드합니다.
 * @param month - 조회 월 (YYYY-MM 형식, 예: '2026-02')
 * @throws 네트워크 오류 또는 서버 에러 발생 시
 */
export async function downloadExcelReport(month: string): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('월 형식이 올바르지 않습니다. (YYYY-MM)');
  }

  const response = await fetch(`/api/report-excel?month=${encodeURIComponent(month)}`);

  if (!response.ok) {
    // JSON 에러 응답 파싱 시도
    let errorMessage = `서버 오류 (HTTP ${response.status})`;
    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // JSON 파싱 실패 시 기본 메시지 사용
    }
    throw new Error(errorMessage);
  }

  // 응답 바이너리를 Blob으로 변환
  const blob = await response.blob();

  // Content-Disposition 헤더에서 파일명 추출 (없으면 기본값 사용)
  const contentDisposition = response.headers.get('Content-Disposition');
  let fileName = `농림부_보고_${month.replace('-', '')}.xlsx`;
  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
    if (utf8Match) {
      fileName = decodeURIComponent(utf8Match[1]);
    }
  }

  // Blob → Object URL → <a> 클릭으로 다운로드 트리거
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();

  // 정리
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
