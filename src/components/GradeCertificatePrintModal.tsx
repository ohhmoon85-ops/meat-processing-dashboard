/**
 * 축산물 (소) 등급판정확인서 인쇄 모달
 *
 * - Step 1 (현재 작동): EKAPE issueNo API → 도축장·판정일·성별 등 기본 정보 표시
 * - Step 2 (권한 승인 후): EKAPE cattle API → 도체번호·품종·도체중·육질·육량 등급 표시
 */
import React, { useEffect, useState } from 'react';
import { X, Printer, Loader2, AlertTriangle, FileText } from 'lucide-react';

// ── 타입 ──────────────────────────────────────────────────────────
interface AnimalItem {
  id: number;
  animalNumber: string;
  breed: string;
  birthDate: string;
  // 바코드 납품 정보
  destination?: string;    // 납품처명
  cutName?: string;        // 부위명
  processingType?: string; // 가공형태 (다짐, 슬라이스 등)
  weightKg?: string;       // 중량(kg)
}

interface EkapeDetail {
  [key: string]: string | number | undefined;
}

interface EkapeIssueItem {
  issueNo?: unknown;
  issueDate?: unknown;
  abattCode?: unknown;
  abattDate?: unknown;
  abattNm?: unknown;
  judgeDate?: unknown;
  judgeKindCd?: unknown;
  judgeKindNm?: unknown;
  judgeSexNm?: unknown;
  butchYmd?: unknown;
  butchPlcNm?: unknown;
  sexNm?: unknown;
  [key: string]: unknown;
}

interface EkapeResult {
  animalNo: string;
  totalCount: number;
  items: EkapeIssueItem[];
  gradeInfo?: EkapeDetail[];
  gradeInfoDebug?: string | null;
}

interface CertItem {
  animalNo: string;
  status: 'loading' | 'success' | 'error' | 'skipped';
  errorMsg?: string;
  data?: EkapeResult;
  animal: AnimalItem; // 원본 동물 데이터 (납품 정보 포함)
}

interface Props {
  animals: AnimalItem[];
  onClose: () => void;
}

// ── 헬퍼 ─────────────────────────────────────────────────────────
const isValidEkapeNo = (no: string) => /^\d{12}$/.test(no.replace(/[-\s]/g, ''));

const fmtDate = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!s) return '—';
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
};

const str = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s || '—';
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
const GradeCertificatePrintModal: React.FC<Props> = ({ animals, onClose }) => {
  const [certs, setCerts] = useState<CertItem[]>(() =>
    animals.map((a) => ({
      animalNo: a.animalNumber,
      animal: a,
      status: isValidEkapeNo(a.animalNumber) ? 'loading' : 'skipped',
      errorMsg: isValidEkapeNo(a.animalNumber)
        ? undefined
        : `EKAPE 조회 불가 (12자리 숫자가 아님: ${a.animalNumber})`,
    }))
  );
  const [isPrinting, setIsPrinting] = useState(false);

  // ── 마운트 시 병렬 API 조회 (같은 이력번호는 1회만 호출) ─────────
  useEffect(() => {
    const fetchAll = async () => {
      // 유효한 이력번호만 추출 → 중복 제거 → API 1회 호출 후 결과 공유
      const uniqueNos = [
        ...new Set(
          animals
            .map((a) => a.animalNumber.replace(/[-\s]/g, ''))
            .filter((no) => isValidEkapeNo(no))
        ),
      ];

      // 이력번호 → API 결과 캐시
      const cache = new Map<string, { ok: boolean; json: unknown }>();
      await Promise.all(
        uniqueNos.map(async (cleanNo) => {
          try {
            const res = await fetch(`/api/grade-certificate?animalNo=${encodeURIComponent(cleanNo)}`);
            const json = await res.json();
            cache.set(cleanNo, { ok: res.ok, json });
          } catch (err) {
            cache.set(cleanNo, {
              ok: false,
              json: { error: err instanceof Error ? err.message : '네트워크 오류' },
            });
          }
        })
      );

      // 캐시 결과를 각 cert 항목에 반영
      setCerts((prev) =>
        prev.map((c) => {
          if (c.status === 'skipped') return c;
          const cleanNo = c.animalNo.replace(/[-\s]/g, '');
          const result = cache.get(cleanNo);
          if (!result) return c;
          if (!result.ok) {
            const errJson = result.json as { error?: string };
            return { ...c, status: 'error', errorMsg: errJson.error ?? '조회 실패' };
          }
          return { ...c, status: 'success', data: result.json as EkapeResult };
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

  const total    = certs.length;
  const loaded   = certs.filter((c) => c.status !== 'loading').length;
  const succeeded = certs.filter((c) => c.status === 'success').length;

  return (
    <>
      {/* ── 인쇄 전용 CSS ── */}
      <style>{`
        @media print {
          /* 모달 외 모든 요소 숨김 */
          body > *:not(#cert-print-root) { display: none !important; }

          /* 모달 루트: fixed→static, 오버레이 배경 제거 */
          #cert-print-root {
            position: static !important;
            background: white !important;
            overflow: visible !important;
            display: block !important;
            height: auto !important;
            inset: auto !important;
          }

          /* 스크롤 컨테이너: overflow-y-auto 와 flex-1 높이 제약 해제 */
          #cert-cards-container {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            flex: none !important;
            padding: 0 !important;
            background: white !important;
          }

          /* 확인서 내부 래퍼 */
          #cert-cards-container > div {
            max-width: none !important;
            gap: 0 !important;
          }

          /* 헤더·진행바 숨김 */
          .no-print { display: none !important; }

          /* 확인서 카드: 페이지 나누기 */
          .cert-page {
            break-after: page;
            border: 1px solid #555 !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 24px !important;
          }
          .cert-page:last-child { break-after: auto; }
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
              <h2 className="text-lg font-bold text-gray-800">축산물 (소) 등급판정확인서</h2>
              <p className="text-sm text-gray-500">
                {loaded < total
                  ? `조회 중... ${loaded} / ${total}`
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

        {/* 확인서 목록 */}
        <div id="cert-cards-container" className="flex-1 overflow-y-auto p-6 bg-gray-100 print:p-0 print:bg-white">
          <div className="max-w-5xl mx-auto flex flex-col gap-6 print:gap-0">
            {certs.map((cert, idx) => (
              <CertCard key={idx} cert={cert} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ── 개별 카드 (상태별 분기) ────────────────────────────────────────
const CertCard: React.FC<{ cert: CertItem }> = ({ cert }) => {
  const { animal } = cert;
  if (cert.status === 'loading') {
    return (
      <div className="bg-white rounded-xl shadow p-8 flex items-center gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin shrink-0" />
        <div>
          <p className="text-sm text-gray-500">EKAPE API 조회 중...</p>
          <p className="font-mono text-base font-semibold text-gray-700 mt-1">{cert.animalNo}</p>
        </div>
      </div>
    );
  }

  if (cert.status === 'skipped') {
    return (
      <div className="no-print bg-yellow-50 border border-yellow-200 rounded-xl p-5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-yellow-700">EKAPE 조회 불가</p>
          <p className="font-mono text-sm text-gray-600 mt-0.5">{cert.animalNo}</p>
          <p className="text-xs text-yellow-600 mt-1">
            12자리 숫자 이력번호만 조회 가능합니다. (L-prefix 라벨 번호 제외)
          </p>
        </div>
      </div>
    );
  }

  if (cert.status === 'error') {
    return (
      <div className="no-print bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-700">조회 실패</p>
          <p className="font-mono text-sm text-gray-600 mt-0.5">{cert.animalNo}</p>
          <p className="text-xs text-red-600 mt-1">{cert.errorMsg}</p>
        </div>
      </div>
    );
  }

  // ── 성공: 확인서 문서 형태 출력 ────────────────────────────────
  const result     = cert.data!;
  const issueItems = result.items ?? [];
  const gradeInfo  = result.gradeInfo ?? [];
  const hasGradeError = !!result.gradeInfoDebug;

  if (issueItems.length === 0) {
    return (
      <div className="no-print bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-500 text-center">
        등급판정 기록이 없습니다. ({cert.animalNo})
      </div>
    );
  }

  return (
    <>
      {issueItems.map((issueItem, i) => (
        <CertificateDocument
          key={i}
          animalNo={result.animalNo}
          issueItem={issueItem}
          // 첫 번째 issueItem에만 gradeInfo 표시 (API가 flatten 반환하므로)
          gradeRows={i === 0 ? gradeInfo : []}
          hasGradeError={hasGradeError}
          animal={animal}
        />
      ))}
    </>
  );
};

// ── 공식 확인서 문서 레이아웃 ─────────────────────────────────────
const CertificateDocument: React.FC<{
  animalNo: string;
  issueItem: EkapeIssueItem;
  gradeRows: EkapeDetail[];
  hasGradeError: boolean;
  animal: AnimalItem;
}> = ({ animalNo, issueItem, gradeRows, hasGradeError, animal }) => {
  return (
    <div className="cert-page bg-white border border-gray-500 shadow-md p-6 text-xs">

      {/* ── 문서 헤더 ── */}
      <div className="flex items-start justify-between mb-1">
        <div className="text-gray-500 min-w-[160px]">
          발급번호: <span className="text-gray-800 font-medium">{str(issueItem.issueNo)}</span>
        </div>
        <div className="text-center flex-1 px-2">
          <h1 className="text-base font-bold tracking-widest text-black">
            축산물 (소) 등급판정확인서
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">축산물품질평가원</p>
        </div>
        <div className="text-gray-500 min-w-[160px] text-right">
          발급일: <span className="text-gray-800 font-medium">{fmtDate(issueItem.issueDate)}</span>
        </div>
      </div>

      <hr className="border-gray-400 my-2" />

      {/* ── 기본 정보 (Step 1 데이터) ── */}
      <div className="border border-gray-300 rounded p-3 mb-3 grid grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
        <InfoRow label="이력번호" value={<span className="font-mono font-semibold">{animalNo}</span>} />
        <InfoRow label="도축장명" value={str(issueItem.abattNm ?? issueItem.butchPlcNm)} />
        <InfoRow label="도축일자" value={fmtDate(issueItem.abattDate ?? issueItem.butchYmd)} />
        <InfoRow label="판정종류" value={str(issueItem.judgeKindNm)} />
        <InfoRow label="등급판정일" value={fmtDate(issueItem.judgeDate)} />
        <InfoRow label="성별" value={str(issueItem.judgeSexNm ?? issueItem.sexNm)} />
      </div>

      {/* ── 도체 등급 테이블 ── */}
      <div className="overflow-x-auto mb-3">
        <table className="w-full border-collapse text-center text-xs">
          <thead>
            {/* 1행: 구분 헤더 */}
            <tr>
              <th className="border border-gray-400 px-1 py-1.5 bg-gray-200" rowSpan={2}>도체번호</th>
              <th className="border border-gray-400 px-1 py-1.5 bg-gray-200" rowSpan={2}>품종</th>
              <th className="border border-gray-400 px-1 py-1.5 bg-gray-200" rowSpan={2}>성별</th>
              <th className="border border-gray-400 px-1 py-1.5 bg-gray-200" rowSpan={2}>
                도체중<br />(kg)
              </th>
              <th
                className="border border-gray-400 px-1 py-1"
                colSpan={5}
                style={{ background: '#dbeafe' }}
              >
                육 질 등 급
              </th>
              <th
                className="border border-gray-400 px-1 py-1"
                colSpan={4}
                style={{ background: '#dcfce7' }}
              >
                육 량 등 급
              </th>
            </tr>
            {/* 2행: 세부 컬럼 */}
            <tr>
              <th className="border border-gray-400 px-1 py-1 font-semibold" style={{ background: '#dbeafe' }}>등급</th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dbeafe' }}>
                근내<br />지방도
              </th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dbeafe' }}>육색</th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dbeafe' }}>지방색</th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dbeafe' }}>조직감</th>
              <th className="border border-gray-400 px-1 py-1 font-semibold" style={{ background: '#dcfce7' }}>등급</th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dcfce7' }}>
                등심단면적<br />(㎠)
              </th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dcfce7' }}>
                등지방두께<br />(mm)
              </th>
              <th className="border border-gray-400 px-1 py-1" style={{ background: '#dcfce7' }}>
                육량<br />지수
              </th>
            </tr>
          </thead>
          <tbody>
            {gradeRows.length > 0 ? (
              gradeRows.map((gi, i) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-gray-50' : ''}>
                  <td className="border border-gray-300 px-1 py-1.5">
                    {str(gi.carcassNo ?? gi.inspecNo)}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5">
                    {str(gi.breedNm ?? gi.liveStockNm)}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5">
                    {str(gi.sexNm ?? issueItem.judgeSexNm)}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5">
                    {str(gi.carcassWeight)}
                  </td>
                  {/* 육질등급 */}
                  <td className="border border-gray-300 px-1 py-1.5 font-bold text-blue-800">
                    {str(gi.qulGradeNm ?? gi.gradeNm)}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.marbleScore)}</td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.meatColorScore)}</td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.fatColorScore)}</td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.textureScore)}</td>
                  {/* 육량등급 */}
                  <td className="border border-gray-300 px-1 py-1.5 font-bold text-green-800">
                    {str(gi.yieldGradeNm)}
                  </td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.longissimus)}</td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.backfatThick)}</td>
                  <td className="border border-gray-300 px-1 py-1.5">{str(gi.yieldIndex)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="border border-gray-300 px-2 py-4 text-center"
                  colSpan={13}
                >
                  {hasGradeError ? (
                    <p className="text-orange-600 font-medium">
                      ⚠ 소도체 상세 정보 조회 권한 미승인 —
                      EKAPE API 권한 획득 후 자동으로 표시됩니다
                    </p>
                  ) : (
                    <span className="text-gray-400">등급판정 상세 정보 없음</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 보조 정보 행 (gradeRows 있을 때만) ── */}
      {gradeRows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600 mb-3 px-1">
          {gradeRows[0]?.maturityScore !== undefined && (
            <InfoRow label="성숙도" value={str(gradeRows[0].maturityScore)} />
          )}
          {gradeRows[0]?.surfaceFatScore !== undefined && (
            <InfoRow label="표면지방색" value={str(gradeRows[0].surfaceFatScore)} />
          )}
          {gradeRows[0]?.inspecPlcNm !== undefined && (
            <InfoRow label="판정장" value={str(gradeRows[0].inspecPlcNm)} />
          )}
        </div>
      )}

      {/* ── 납품내역 ── */}
      {(animal.destination || animal.cutName || animal.weightKg) && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-700 mb-1.5 tracking-wide">납 품 내 역</p>
          <table className="w-full border-collapse text-xs text-center">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-400 px-2 py-1.5">업태유형</th>
                <th className="border border-gray-400 px-2 py-1.5">납품처명</th>
                <th className="border border-gray-400 px-2 py-1.5">부위명</th>
                <th className="border border-gray-400 px-2 py-1.5">중량(kg)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 px-2 py-1.5">—</td>
                <td className="border border-gray-300 px-2 py-1.5 font-medium">
                  {animal.destination ?? '—'}
                </td>
                <td className="border border-gray-300 px-2 py-1.5">
                  {[animal.cutName, animal.processingType].filter(Boolean).join(' / ') || '—'}
                </td>
                <td className="border border-gray-300 px-2 py-1.5">
                  {animal.weightKg ?? '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── 하단 확인 문구 ── */}
      <div className="border-t border-gray-300 pt-2 mt-3 text-center text-xs text-gray-500">
        위와 같이 등급판정 결과를 확인합니다.
      </div>
    </div>
  );
};

// ── 인라인 레이블-값 쌍 ───────────────────────────────────────────
const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex gap-1 items-baseline">
    <span className="text-gray-500 shrink-0">{label}:</span>
    <span className="text-gray-800">{value}</span>
  </div>
);

export default GradeCertificatePrintModal;
