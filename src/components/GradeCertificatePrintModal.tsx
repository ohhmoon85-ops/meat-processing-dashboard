/**
 * 축산물 (소) 등급판정확인서 인쇄 모달
 *
 * - Step 1 (현재 작동): EKAPE issueNo API → 도축장·판정일·성별 등 기본 정보 표시
 * - Step 2 (권한 승인 후): EKAPE cattle API → 도체번호·품종·도체중·육질·육량 등급 표시
 */
import React, { useEffect, useState } from 'react';
import { X, Printer, Loader2, AlertTriangle, FileText } from 'lucide-react';
import type { BusinessInfo } from './SettingsModal';

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
  businessInfo?: BusinessInfo;
  onClose: () => void;
}

// ── 헬퍼 ─────────────────────────────────────────────────────────
const isValidEkapeNo = (no: string) => /^\d{12}$/.test(no.replace(/[-\s]/g, ''));


const str = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s || '—';
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
const GradeCertificatePrintModal: React.FC<Props> = ({ animals, businessInfo, onClose }) => {
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
          /*
           * visibility 방식: display:none 으로 #root 를 통째로 숨기면
           * 그 안의 모달도 사라지기 때문에 visibility 를 사용한다.
           * body 전체를 hidden 으로 만든 뒤 모달 내부만 visible 로 복원.
           */
          body * { visibility: hidden !important; }

          /* 모달 루트와 그 모든 자식을 visible 로 복원 */
          #cert-print-root,
          #cert-print-root * { visibility: visible !important; }

          /* 헤더·진행바는 다시 숨김 (ID+class 으로 specificity 높임) */
          #cert-print-root .no-print {
            visibility: hidden !important;
            display: none !important;
            height: 0 !important;
          }

          /* 모달 루트: absolute 로 전환해 문서 흐름에 삽입, 배경 흰색 */
          #cert-print-root {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: auto !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            overflow: visible !important;
            display: block !important;
          }

          /* 스크롤 컨테이너: flex-1·overflow-y-auto 높이 제약 해제 */
          #cert-cards-container {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            flex: none !important;
            padding: 0 !important;
            background: white !important;
          }

          #cert-cards-container > div {
            max-width: none !important;
            gap: 0 !important;
          }

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
              <CertCard key={idx} cert={cert} businessInfo={businessInfo} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ── 개별 카드 (상태별 분기) ────────────────────────────────────────
const CertCard: React.FC<{ cert: CertItem; businessInfo?: BusinessInfo }> = ({ cert, businessInfo }) => {
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
          businessInfo={businessInfo}
        />
      ))}
    </>
  );
};

// ── 날짜 포맷: YYYYMMDD 또는 YYYY-MM-DD → YYYY년 MM월 DD일 ────────
const fmtDateKo = (v: unknown): string => {
  const s = String(v ?? '').trim().replace(/-/g, '');
  if (/^\d{8}$/.test(s))
    return `${s.slice(0, 4)}년 ${s.slice(4, 6)}월 ${s.slice(6, 8)}일`;
  return s || '';
};

// ── 공식 서식: 축산법 시행규칙 [별지 제 43호 서식] ────────────────
const CertificateDocument: React.FC<{
  animalNo: string;
  issueItem: EkapeIssueItem;
  gradeRows: EkapeDetail[];
  hasGradeError: boolean;
  animal: AnimalItem;
  businessInfo?: BusinessInfo;
}> = ({ animalNo, issueItem, gradeRows, hasGradeError, animal, businessInfo }) => {

  const gi           = gradeRows[0] ?? {};
  const issueNo      = str(issueItem.issueNo);
  const issueDate    = fmtDateKo(issueItem.issueDate);
  const judgeDate    = fmtDateKo(issueItem.judgeDate);
  const abattNm      = str(issueItem.abattNm ?? issueItem.butchPlcNm);
  const sexNm        = str(issueItem.judgeSexNm ?? issueItem.sexNm);

  // 도체번호, 품종, 중량, 육질, 육량 — step 2 데이터 우선, 없으면 공란
  const breedNm      = gradeRows.length > 0 ? str(gi.breedNm ?? gi.liveStockNm)   : '';
  const carcassWt    = gradeRows.length > 0 ? str(gi.carcassWeight)               : '';
  const qulGrade     = gradeRows.length > 0 ? str(gi.qulGradeNm ?? gi.gradeNm)   : '';
  const marble       = gradeRows.length > 0 ? str(gi.marbleScore)                 : '';
  const yieldGrade   = gradeRows.length > 0 ? str(gi.yieldGradeNm)               : '';
  const backfat      = gradeRows.length > 0 ? str(gi.backfatThick)               : '';
  const sexDisplay   = gradeRows.length > 0 ? str(gi.sexNm ?? issueItem.judgeSexNm) : sexNm;

  // 납품내역
  const hasDelvInfo  = !!(animal.destination || animal.cutName || animal.weightKg);
  const delvPart     = [animal.cutName, animal.processingType].filter(Boolean).join(' / ');

  // step 2 미승인 안내 (인쇄 시에는 작은 회색 텍스트로만 표시)
  const pendingNote  = hasGradeError && gradeRows.length === 0;

  return (
    <div className="cert-page bg-white p-4" style={{ fontSize: '10px', fontFamily: 'sans-serif', lineHeight: '1.4' }}>

      {/* ① 서식 번호 줄 */}
      <div style={{ fontSize: '9px', color: '#555', marginBottom: '3px' }}>
        축산법 시행규칙 [별지 제 43호 서식] (개정 2018. 12. 27.)&nbsp;&nbsp;(열람용)
      </div>

      {/* ② 발급번호 + 제목 + QR 영역 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '3px' }}>
        <tbody>
          <tr>
            <td style={{ width: '60%', padding: '4px 8px', verticalAlign: 'top', borderRight: '1px solid #333' }}>
              <div style={{ fontSize: '9px', color: '#555' }}>발급번호 :&nbsp;
                <span style={{ fontWeight: 'bold', color: '#000', fontSize: '11px' }}>{issueNo}</span>
              </div>
              <div style={{ textAlign: 'center', margin: '6px 0 2px' }}>
                <span style={{ fontSize: '16px', fontWeight: 'bold', letterSpacing: '2px' }}>
                  축산물 (소) 등급판정확인서
                </span>
              </div>
            </td>
            <td style={{ width: '40%', padding: '4px 8px', verticalAlign: 'top' }}>
              {/* QR 코드 자리 (실물 확인서에만 있음) */}
              <div style={{ width: '60px', height: '60px', border: '1px solid #aaa', float: 'right',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#aaa' }}>
                QR
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ③ 법령 인용문 */}
      <div style={{ fontSize: '9px', marginBottom: '3px' }}>
        「축산법」제40조 및 같은 법 시행규칙 제45조제1항에 따라 등급판정 결과를 아래와 같이 확인합니다.
      </div>

      {/* ④ 발급일 + 평가사 서명 (우측 정렬) */}
      <div style={{ textAlign: 'right', marginBottom: '4px', fontSize: '10px' }}>
        <div>{issueDate}</div>
        <div>축산물품질평가사 소속 :&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
        <div>성명 :&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(인)</div>
      </div>

      {/* ⑤ 신청인 정보 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '3px', fontSize: '10px' }}>
        <tbody>
          <tr>
            <td rowSpan={3} style={{ border: '1px solid #333', padding: '3px 5px', textAlign: 'center',
              width: '32px', background: '#f5f5f5', fontWeight: 'bold', writingMode: 'vertical-rl',
              letterSpacing: '4px' }}>신청인</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5', width: '42px' }}>성&nbsp;&nbsp;&nbsp;명</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', width: '120px' }}>{businessInfo?.name || '\u00a0'}</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5', width: '110px' }}>생년월일(사업자등록번호)</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px' }}>{businessInfo?.bizNo || '\u00a0'}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5' }}>업소명</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px' }}>{businessInfo?.bizName || '\u00a0'}</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5' }}>업태유형</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px' }}>{businessInfo?.bizType || '\u00a0'}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5' }}>주&nbsp;&nbsp;&nbsp;소</td>
            <td colSpan={3} style={{ border: '1px solid #333', padding: '3px 6px' }}>{businessInfo?.address || '\u00a0'}</td>
          </tr>
        </tbody>
      </table>

      {/* ⑥ 도축장 정보 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '3px', fontSize: '10px' }}>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ border: '1px solid #333', padding: '3px 5px', textAlign: 'center',
              width: '32px', background: '#f5f5f5', fontWeight: 'bold', writingMode: 'vertical-rl',
              letterSpacing: '4px' }}>도축장</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5', width: '42px' }}>업체명</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px' }}>{abattNm}</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5', width: '70px' }}>등급판정일자</td>
            <td style={{ border: '1px solid #333', padding: '3px 6px', width: '90px' }}>{judgeDate}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #333', padding: '3px 6px', background: '#f5f5f5' }}>소재지</td>
            <td colSpan={3} style={{ border: '1px solid #333', padding: '3px 6px' }}>&nbsp;</td>
          </tr>
        </tbody>
      </table>

      {/* ⑦ 도체 등급 테이블 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '2px',
        fontSize: '10px', textAlign: 'center' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>도체번호</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>이력번호</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>품종</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>성별</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>중량</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>육질(근내지방도)</th>
            <th style={{ border: '1px solid #333', padding: '3px 4px' }}>육량(등지방두께)</th>
          </tr>
        </thead>
        <tbody>
          {gradeRows.length > 0 ? (
            gradeRows.map((row, i) => {
              const rCarcassNo  = str(row.carcassNo ?? row.inspecNo);
              const rBreed      = str(row.breedNm ?? row.liveStockNm);
              const rSex        = str(row.sexNm ?? issueItem.judgeSexNm);
              const rWeight     = str(row.carcassWeight);
              const rQul        = str(row.qulGradeNm ?? row.gradeNm);
              const rMarble     = str(row.marbleScore);
              const rYield      = str(row.yieldGradeNm);
              const rBackfat    = str(row.backfatThick);
              return (
                <tr key={i}>
                  <td style={{ border: '1px solid #333', padding: '6px 4px', fontWeight: 'bold', fontSize: '14px' }}>{rCarcassNo}</td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px', fontFamily: 'monospace' }}>{animalNo}</td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{rBreed}</td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{rSex}</td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{rWeight}</td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px', fontWeight: 'bold' }}>
                    {rQul}{rMarble ? `(${rMarble})` : ''}
                  </td>
                  <td style={{ border: '1px solid #333', padding: '6px 4px', fontWeight: 'bold' }}>
                    {rYield}{rBackfat ? `(${rBackfat})` : ''}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td style={{ border: '1px solid #333', padding: '6px 4px', fontWeight: 'bold', fontSize: '14px' }}>&nbsp;</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px', fontFamily: 'monospace' }}>{animalNo}</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{breedNm || '\u00a0'}</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{sexDisplay || '\u00a0'}</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{carcassWt || '\u00a0'}</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{qulGrade && marble ? `${qulGrade}(${marble})` : '\u00a0'}</td>
              <td style={{ border: '1px solid #333', padding: '6px 4px' }}>{yieldGrade && backfat ? `${yieldGrade}(${backfat})` : '\u00a0'}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f8f8f8' }}>
            <td colSpan={7} style={{ border: '1px solid #333', padding: '3px 8px', textAlign: 'center', fontWeight: 'bold', fontSize: '13px' }}>
              계 : 흑두
            </td>
          </tr>
        </tfoot>
      </table>

      {/* ⑧ 육질등급 주석 */}
      <div style={{ fontSize: '9px', color: '#444', marginBottom: '4px' }}>
        ※ 쇠고기 육질등급은 1++, 1+, 1, 2, 3 등 외 등급(6단계)으로 구분됩니다.
      </div>

      {/* ⑨ step 2 미승인 안내 (인쇄 시 작은 글씨) */}
      {pendingNote && (
        <div style={{ fontSize: '9px', color: '#c05000', marginBottom: '4px' }}>
          ※ 소도체 등급 상세(도체번호·품종·중량·육질·육량)는 EKAPE API 권한 획득 후 자동 표시됩니다.
        </div>
      )}

      {/* ⑩ 납품내역 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', fontSize: '10px' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th rowSpan={2} style={{ border: '1px solid #333', padding: '3px 6px', textAlign: 'center', width: '50px' }}>납품내역</th>
            <th style={{ border: '1px solid #333', padding: '3px 6px', textAlign: 'center' }}>업태유형</th>
            <th style={{ border: '1px solid #333', padding: '3px 6px', textAlign: 'center' }}>납품처명</th>
            <th style={{ border: '1px solid #333', padding: '3px 6px', textAlign: 'center' }}>부위명</th>
            <th style={{ border: '1px solid #333', padding: '3px 6px', textAlign: 'center', width: '55px' }}>중량(kg)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #333', padding: '4px 6px' }}>&nbsp;</td>
            <td style={{ border: '1px solid #333', padding: '4px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? (animal.destination ?? '') : '\u00a0'}
            </td>
            <td style={{ border: '1px solid #333', padding: '4px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? delvPart : '\u00a0'}
            </td>
            <td style={{ border: '1px solid #333', padding: '4px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? (animal.weightKg ?? '') : '\u00a0'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default GradeCertificatePrintModal;
