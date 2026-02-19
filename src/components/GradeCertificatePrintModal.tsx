import React, { useEffect, useState } from 'react';
import { X, Printer, Loader2, AlertTriangle, CheckCircle, FileText } from 'lucide-react';

// ── 타입 ──────────────────────────────────────────────────────────
interface AnimalItem {
  id: number;
  animalNumber: string;
  breed: string;
  birthDate: string;
}

interface CertItem {
  animalNo: string;
  status: 'loading' | 'success' | 'error' | 'skipped';
  errorMsg?: string;
  data?: EkapeResult;
}

interface EkapeDetail {
  [key: string]: string | number | undefined;
}

interface EkapeIssueItem {
  issueNo?: string;
  issueDe?: string;
  butchYmd?: string;
  butchPlcNm?: string;
  slauYmd?: string;
  detail?: EkapeDetail[];
  detailError?: string;
  [key: string]: unknown;
}

interface EkapeResult {
  animalNo: string;
  totalCount: number;
  items: EkapeIssueItem[];
  gradeInfo?: EkapeDetail[]; // 3단계: 축산물등급판정정보 서비스 결과
}

interface Props {
  animals: AnimalItem[];
  onClose: () => void;
}

// ── EKAPE 필드 한글 레이블 매핑 ───────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  // ── 1단계 issueNo 조회 실제 응답 필드 ─────────────────────────
  animalNo:           '개체번호(이력번호)',
  issueNo:            '확인서 발급번호',
  issueDate:          '확인서 발급일',
  abattCode:          '도축장 코드',
  abattDate:          '도축일자',
  abattNm:            '도축장명',
  judgeDate:          '등급판정일',
  judgeKindCd:        '판정종류 코드',
  judgeKindNm:        '판정종류',
  judgeSexNm:         '성별',
  // ── 기존/추가 필드 ──────────────────────────────────────────
  issueDe:            '발급일자',
  butchYmd:           '도축일자',
  butchPlcNm:         '도축장명',
  slauYmd:            '도살일자',
  liveStockNm:        '축종',
  sexNm:              '성별',
  birthYmd:           '출생일',
  farmNm:             '농장명',
  farmAddr:           '농장주소',
  // ── 2단계 cattle 상세 필드 ──────────────────────────────────
  gradeYmd:           '등급판정일',
  gradeName:          '최종 등급',
  gradeNm:            '등급',
  qulGradeNm:         '육질등급',
  yieldGradeNm:       '육량등급',
  carcassWeight:      '도체중(kg)',
  backfatThick:       '등지방두께(mm)',
  longissimus:        '배최장근단면적(㎠)',
  marbleScore:        '근내지방도',
  meatColorScore:     '육색',
  fatColorScore:      '지방색',
  textureScore:       '조직감',
  maturityScore:      '성숙도',
  surfaceFatScore:    '표면지방색',
  yieldIndex:         '육량지수',
  inspecPlcNm:        '판정장명',
  inspecNo:           '판정번호',
};

// 표시할 필드 순서 (없는 필드는 자동으로 기타 항목으로 출력)
const PREFERRED_ORDER = [
  'gradeName', 'qulGradeNm', 'yieldGradeNm', 'carcassWeight',
  'backfatThick', 'longissimus', 'marbleScore', 'meatColorScore',
  'fatColorScore', 'textureScore', 'maturityScore', 'yieldIndex',
  'gradeYmd', 'butchYmd', 'butchPlcNm', 'inspecPlcNm',
];

// EKAPE 유효 개체번호: 12자리 숫자
const isValidEkapeNo = (no: string) => /^\d{12}$/.test(no.replace(/[-\s]/g, ''));

// ── 등급 배지 색상 ─────────────────────────────────────────────────
const gradeBadgeColor = (grade: string) => {
  if (grade.includes('1++')) return 'bg-purple-100 text-purple-800 border-purple-300';
  if (grade.includes('1+'))  return 'bg-blue-100 text-blue-800 border-blue-300';
  if (grade.includes('1'))   return 'bg-green-100 text-green-800 border-green-300';
  if (grade.includes('2'))   return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  return 'bg-gray-100 text-gray-700 border-gray-300';
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
const GradeCertificatePrintModal: React.FC<Props> = ({ animals, onClose }) => {
  const [certs, setCerts] = useState<CertItem[]>(() =>
    animals.map((a) => ({
      animalNo: a.animalNumber,
      status: isValidEkapeNo(a.animalNumber) ? 'loading' : 'skipped',
      errorMsg: isValidEkapeNo(a.animalNumber)
        ? undefined
        : `EKAPE 조회 불가 (12자리 숫자가 아님: ${a.animalNumber})`,
    }))
  );
  const [isPrinting, setIsPrinting] = useState(false);

  // ── 마운트 시 병렬 API 조회 ──────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      await Promise.all(
        animals.map(async (animal, idx) => {
          if (!isValidEkapeNo(animal.animalNumber)) return;

          const cleanNo = animal.animalNumber.replace(/[-\s]/g, '');
          try {
            const res = await fetch(`/api/grade-certificate?animalNo=${encodeURIComponent(cleanNo)}`);
            const json = await res.json();

            if (!res.ok) {
              setCerts((prev) =>
                prev.map((c, i) =>
                  i === idx ? { ...c, status: 'error', errorMsg: json.error ?? '조회 실패' } : c
                )
              );
              return;
            }

            setCerts((prev) =>
              prev.map((c, i) =>
                i === idx ? { ...c, status: 'success', data: json as EkapeResult } : c
              )
            );
          } catch (err) {
            setCerts((prev) =>
              prev.map((c, i) =>
                i === idx
                  ? { ...c, status: 'error', errorMsg: err instanceof Error ? err.message : '네트워크 오류' }
                  : c
              )
            );
          }
        })
      );
    };

    void fetchAll();
  }, [animals]);

  // ── 인쇄 ─────────────────────────────────────────────────────────
  const handlePrint = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  };

  // ── 집계 ─────────────────────────────────────────────────────────
  const total = certs.length;
  const loaded = certs.filter((c) => c.status !== 'loading').length;
  const succeeded = certs.filter((c) => c.status === 'success').length;

  return (
    <>
      {/* ── 인쇄 전용 CSS ── */}
      <style>{`
        @media print {
          body > *:not(#cert-print-root) { display: none !important; }
          #cert-print-root { position: static !important; }
          .no-print { display: none !important; }
          .cert-card { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; border: 1px solid #ccc !important; }
          .print-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        }
      `}</style>

      {/* ── 모달 오버레이 ── */}
      <div
        id="cert-print-root"
        className="fixed inset-0 z-50 bg-black/60 flex flex-col overflow-hidden"
      >
        {/* 헤더 */}
        <div className="no-print flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-800">축산물 등급판정 확인서</h2>
              <p className="text-sm text-gray-500">
                {loaded < total
                  ? `조회 중... ${loaded}/${total}`
                  : `${succeeded}건 조회 완료 (전체 ${total}건)`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              disabled={isPrinting || loaded < total}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all
                ${loaded < total || isPrinting
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              <Printer className="w-4 h-4" />
              {isPrinting ? '인쇄 중...' : '인쇄'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 진행 바 */}
        {loaded < total && (
          <div className="no-print h-1 bg-gray-200 shrink-0">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${(loaded / total) * 100}%` }}
            />
          </div>
        )}

        {/* 카드 목록 */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <div className="print-grid grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl mx-auto">
            {certs.map((cert, idx) => (
              <CertCard key={idx} cert={cert} index={idx} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ── 개별 판정서 카드 ──────────────────────────────────────────────
const CertCard: React.FC<{ cert: CertItem; index: number }> = ({ cert, index }) => {
  if (cert.status === 'loading') {
    return (
      <div className="cert-card bg-white rounded-xl shadow p-6 flex items-center gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin shrink-0" />
        <div>
          <p className="text-sm text-gray-500">조회 중...</p>
          <p className="font-mono text-base font-semibold text-gray-700">{cert.animalNo}</p>
        </div>
      </div>
    );
  }

  if (cert.status === 'skipped') {
    return (
      <div className="cert-card no-print bg-yellow-50 border border-yellow-200 rounded-xl p-5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-yellow-700">EKAPE 조회 불가</p>
          <p className="font-mono text-sm text-gray-600 mt-0.5">{cert.animalNo}</p>
          <p className="text-xs text-yellow-600 mt-1">
            라벨 번호(L-prefix)는 EKAPE 등급판정 API 조회 대상이 아닙니다.
            12자리 숫자 개체번호만 조회할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  if (cert.status === 'error') {
    return (
      <div className="cert-card no-print bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-700">조회 실패</p>
          <p className="font-mono text-sm text-gray-600 mt-0.5">{cert.animalNo}</p>
          <p className="text-xs text-red-600 mt-1">{cert.errorMsg}</p>
        </div>
      </div>
    );
  }

  // ── 성공 케이스: 판정서 카드 ─────────────────────────────────────
  const result = cert.data!;
  const issueItems = result.items ?? [];

  return (
    <div className="cert-card bg-white rounded-xl shadow p-6">
      {/* 카드 헤더 */}
      <div className="flex items-start justify-between mb-4 pb-3 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">
              등급판정 확인서
            </span>
          </div>
          <p className="font-mono text-base font-bold text-gray-800">{result.animalNo}</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
          No.{String(index + 1).padStart(2, '0')}
        </span>
      </div>

      {/* 발급 건별 */}
      {issueItems.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">등급판정 정보 없음</p>
      ) : (
        issueItems.map((item, i) => {
          const details = (item.detail ?? []) as EkapeDetail[];
          // 최종 등급 추출 (detail 첫 번째 항목 기준)
          const topDetail = details[0] ?? {};
          const gradeName = String(
            topDetail.gradeName ?? topDetail.qulGradeNm ?? topDetail.gradeNm ?? ''
          );

          // 표시 필드 정렬
          const allKeys = Object.keys(topDetail).filter(
            (k) => topDetail[k] !== undefined && topDetail[k] !== '' && k !== 'gradeName'
          );
          const orderedKeys = [
            ...PREFERRED_ORDER.filter((k) => allKeys.includes(k)),
            ...allKeys.filter((k) => !PREFERRED_ORDER.includes(k)),
          ];

          // issueItem 자체 필드 (detail 제외)
          const issueFields = Object.entries(item).filter(
            ([k, v]) => k !== 'detail' && k !== 'detailError' && v !== undefined && v !== ''
          );

          return (
            <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t' : ''}>
              {/* 등급 배지 */}
              {gradeName && (
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-lg font-black px-3 py-1 rounded-lg border-2 ${gradeBadgeColor(gradeName)}`}>
                    {gradeName}
                  </span>
                  <span className="text-xs text-gray-500">최종 등급</span>
                </div>
              )}

              {/* 발급 정보 */}
              {issueFields.length > 0 && (
                <table className="w-full text-xs mb-3">
                  <tbody>
                    {issueFields.map(([k, v]) => (
                      <tr key={k} className="border-b border-gray-50">
                        <td className="py-1 pr-2 text-gray-400 whitespace-nowrap w-28">
                          {FIELD_LABELS[k] ?? k}
                        </td>
                        <td className="py-1 font-medium text-gray-700">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* 등급 상세 */}
              {orderedKeys.length > 0 && (
                <table className="w-full text-xs">
                  <tbody>
                    {orderedKeys.map((k) => (
                      <tr key={k} className="border-b border-gray-50">
                        <td className="py-1 pr-2 text-gray-400 whitespace-nowrap w-28">
                          {FIELD_LABELS[k] ?? k}
                        </td>
                        <td className="py-1 font-medium text-gray-700">{String(topDetail[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {item.detailError && (
                <div className="mt-3 p-2.5 bg-orange-50 border border-orange-200 rounded-lg text-xs">
                  {item.detailError.includes('99') || item.detailError.includes('ACCESS DENIED') ? (
                    <>
                      <p className="font-semibold text-orange-700 mb-1">
                        ⚠ 소도체 상세 정보 조회 권한 없음
                      </p>
                      <p className="text-orange-600">
                        위 기본 정보(발급번호·도축일·판정일·성별)는 정상 조회되었습니다.
                        소도체 등급 상세(근내지방도·도체중 등)를 보려면
                        공공데이터포털에서 <strong>「축산물 소도체 등급판정 확인서」</strong> 서비스
                        이용 승인이 필요합니다.
                      </p>
                    </>
                  ) : (
                    <p className="text-red-600">상세 조회 오류: {item.detailError}</p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ── 3단계: 축산물등급판정정보 (gradeInfo) ── */}
      {result.gradeInfo && result.gradeInfo.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs font-semibold text-blue-600 mb-2 uppercase tracking-wider">
            등급판정 상세정보
          </p>
          {result.gradeInfo.map((gi, gi_i) => {
            // 등급 추출
            const gradeVal = String(
              gi.gradeName ?? gi.gradeNm ?? gi.qulGradeNm ?? ''
            );
            // 표시 필드 정렬
            const allKeys = Object.keys(gi).filter(
              (k) => gi[k] !== undefined && gi[k] !== ''
            );
            const orderedKeys = [
              ...PREFERRED_ORDER.filter((k) => allKeys.includes(k)),
              ...allKeys.filter((k) => !PREFERRED_ORDER.includes(k)),
            ];
            return (
              <div key={gi_i} className={gi_i > 0 ? 'mt-3 pt-3 border-t border-dashed' : ''}>
                {gradeVal && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-lg font-black px-3 py-1 rounded-lg border-2 ${gradeBadgeColor(gradeVal)}`}>
                      {gradeVal}
                    </span>
                    <span className="text-xs text-gray-500">최종 등급</span>
                  </div>
                )}
                <table className="w-full text-xs">
                  <tbody>
                    {orderedKeys.map((k) => (
                      <tr key={k} className="border-b border-gray-50">
                        <td className="py-1 pr-2 text-gray-400 whitespace-nowrap w-28">
                          {FIELD_LABELS[k] ?? k}
                        </td>
                        <td className="py-1 font-medium text-gray-700">{String(gi[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GradeCertificatePrintModal;
