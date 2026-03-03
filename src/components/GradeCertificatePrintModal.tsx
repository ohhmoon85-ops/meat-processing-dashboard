/**
 * 축산물 (소) 등급판정확인서 인쇄 모달
 *
 * - Step 1 (현재 작동): EKAPE issueNo API → 도축장·판정일·성별 등 기본 정보 표시
 * - Step 2 (권한 승인됨): EKAPE cattle API → 도체번호·품종·도체중·육질·육량 등급 표시
 * - 전자등록: 인쇄 시 mtrace 원패스 시스템에 출고 데이터 비동기 전송
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { X, Printer, Loader2, AlertTriangle, FileText, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import type { BusinessInfo } from './SettingsModal';

// ── 타입 ──────────────────────────────────────────────────────────
interface AnimalItem {
  id: number;
  animalNumber: string;
  breed: string;
  birthDate: string;
  destination?: string;
  cutName?: string;
  processingType?: string;
  weightKg?: string;
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
  animal: AnimalItem;
}

// ── 원패스 전자등록 상태 타입 ────────────────────────────────────
type ShipmentStatus = 'idle' | 'sending' | 'success' | 'error' | 'unconfigured';
interface ShipmentResult {
  status: ShipmentStatus;
  message?: string;
}

interface Props {
  animals: AnimalItem[];
  businessInfo?: BusinessInfo;
  onClose: () => void;
}

// ── 품종 코드 매핑 (EKAPE lsKindCd) ─────────────────────────────
const LS_KIND_CODE_MAP: Record<string, string> = {
  '01': '한우', '1': '한우',
  '02': '육우', '2': '육우',
  '03': '젖소', '3': '젖소',
  '04': '돼지', '4': '돼지',
  '05': '닭',   '5': '닭',
  '06': '오리', '6': '오리',
  '07': '말',   '7': '말',
};

/**
 * EKAPE Step 2 품종 자동 판별
 * 우선순위: lsKindCd(코드) > lsKindNm(종류명) > breedNm(품종명) 키워드
 */
function resolveBreed(row: EkapeDetail): string {
  // 0. judgeBreedNm: 실제 EKAPE API 품종명 — 최우선 (한우, 육우 등)
  const judgeBreed = String(row.judgeBreedNm ?? '').trim();
  if (judgeBreed) return judgeBreed;

  // 1. lsKindCd / judgeKindCd: 코드 기반 매핑
  const code = String(row.lsKindCd ?? row.judgeKindCd ?? '').trim();
  if (code && LS_KIND_CODE_MAP[code]) return LS_KIND_CODE_MAP[code];

  // 2. lsKindNm / judgeKindNm: 가축종류명 (키워드 정규화)
  const kindNm = String(row.lsKindNm ?? row.judgeKindNm ?? '').trim();
  if (kindNm) {
    if (kindNm.includes('한우')) return '한우';
    if (kindNm.includes('육우')) return '육우';
    if (kindNm.includes('젖소')) return '젖소';
    if (kindNm.includes('교잡')) return '교잡우';
    return kindNm;
  }

  // 3. breedNm / liveStockNm: 품종명 키워드 매칭
  const breedNm = String(row.breedNm ?? row.liveStockNm ?? '').trim();
  if (breedNm.includes('한우')) return '한우';
  if (breedNm.includes('육우')) return '육우';
  if (breedNm.includes('젖소') || breedNm.includes('홀스타인')) return '젖소';
  if (breedNm.includes('교잡')) return '교잡우';
  if (breedNm) return breedNm;

  return '—';
}

// ── 헬퍼 ─────────────────────────────────────────────────────────
const isValidEkapeNo = (no: string) => /^\d{12}$/.test(no.replace(/[-\s]/g, ''));

const str = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s || '—';
};

/** 전자등록 결과 키: animalNo_issueNo */
const shipKey = (animalNo: string, issueNo: unknown): string =>
  `${animalNo.replace(/[-\s]/g, '')}_${String(issueNo ?? '')}`;

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
  const [shipmentResults, setShipmentResults] = useState<Record<string, ShipmentResult>>({});

  // ── 마운트 시 병렬 API 조회 ────────────────────────────────────
  useEffect(() => {
    const fetchAll = async () => {
      const uniqueNos = [
        ...new Set(
          animals
            .map((a) => a.animalNumber.replace(/[-\s]/g, ''))
            .filter((no) => isValidEkapeNo(no))
        ),
      ];

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

  // ── 원패스 전자등록 단건 전송 ─────────────────────────────────
  const callShipmentApi = useCallback(async (
    animalNo: string,
    issueItem: EkapeIssueItem,
    gradeRow: EkapeDetail,
  ) => {
    const key = shipKey(animalNo, issueItem.issueNo);
    setShipmentResults(prev => ({ ...prev, [key]: { status: 'sending' } }));

    try {
      const payload = {
        // ── EKAPE 공통 ────────────────────────────────────────────
        animalNo:     animalNo.replace(/[-\s]/g, ''),
        issueNo:      String(issueItem.issueNo       ?? ''),
        carcassNo:    String(gradeRow.cattleNo ?? gradeRow.carcassNo ?? gradeRow.inspecNo ?? ''),
        breedNm:      resolveBreed(gradeRow),
        sexNm:        String(gradeRow.sexNm          ?? issueItem.judgeSexNm ?? ''),
        weight:       String(gradeRow.weight ?? gradeRow.carcassWeight ?? ''),  // 도체중
        qulGrade:     String(gradeRow.qulGradeNm ?? gradeRow.gradeNm ?? ''),
        yieldGrade:   String(gradeRow.wgrade ?? gradeRow.yieldGradeNm ?? ''),
        judgeDate:    String(issueItem.judgeDate      ?? '').replace(/-/g, ''),
        // ── 매입신고: 도축장 정보 ─────────────────────────────────
        abattNm:      String(issueItem.abattNm       ?? issueItem.butchPlcNm ?? ''),
        abattBizNo:   String(issueItem.abattCode      ?? ''), // 도축장 코드(사업자번호 근사치)
        abattAddr:    String(gradeRow.abattAddr       ?? ''), // 도축장 주소 (EKAPE gradeInfo)
        // ── 표준부위: 지육(전체 도체) 기본값 ─────────────────────
        cutCode:      '430110',  // 지육 (전체 도체) — 부위별 처리 시 변경
        cutNm:        '지육',
        // ── 가공생산·출고: 납품 정보 ─────────────────────────────
        destBizNo:    '',        // 납품처 사업자번호 (향후 거래처 DB에서 조회)
        destNm:       '',        // 납품처 상호
        destWeight:   '',        // 납품 중량
        // ── 신청인(우리 회사) 정보 ───────────────────────────────
        compBizNo:    businessInfo?.bizNo   ?? '',
        compNm:       businessInfo?.bizName ?? '',
      };

      const res = await fetch('/api/grade-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as {
        success?: boolean;
        error?: string;
        resultMsg?: string;
        configured?: boolean;
      };

      if (json.configured === false) {
        // MTRACE 자격증명 미설정 — 기능 비활성화 상태로 표시
        setShipmentResults(prev => ({
          ...prev,
          [key]: { status: 'unconfigured', message: 'MTRACE 자격증명 미설정 (환경변수 확인 필요)' },
        }));
      } else if (json.success) {
        setShipmentResults(prev => ({
          ...prev,
          [key]: { status: 'success', message: json.resultMsg ?? '원패스 전자등록 완료' },
        }));
      } else {
        setShipmentResults(prev => ({
          ...prev,
          [key]: { status: 'error', message: json.error ?? json.resultMsg ?? '전자등록 실패' },
        }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '네트워크 오류';
      setShipmentResults(prev => ({
        ...prev,
        [key]: { status: 'error', message: msg },
      }));
    }
  }, [businessInfo]);

  // ── 인쇄 + 전자등록 병렬 실행 ────────────────────────────────
  const handlePrint = () => {
    setIsPrinting(true);

    // 원패스 전자등록: 인쇄와 병렬 비동기 실행 (인쇄를 차단하지 않음)
    // 등록 실패 시에도 인쇄는 정상 진행됨
    certs
      .filter(c => c.status === 'success' && c.data)
      .forEach(cert => {
        const issueItems = cert.data!.items ?? [];
        const gradeRows  = cert.data!.gradeInfo ?? [];
        issueItems.forEach((issueItem, i) => {
          void callShipmentApi(
            cert.animalNo,
            issueItem,
            i === 0 ? (gradeRows[0] ?? {}) : {},
          );
        });
      });

    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 100);
  };

  const total    = certs.length;
  const loaded   = certs.filter((c) => c.status !== 'loading').length;
  const succeeded = certs.filter((c) => c.status === 'success').length;

  // 전자등록 전체 요약
  const shipValues = Object.values(shipmentResults);
  const shipSending = shipValues.filter(s => s.status === 'sending').length;
  const shipOk      = shipValues.filter(s => s.status === 'success').length;
  const shipErr     = shipValues.filter(s => s.status === 'error').length;

  return (
    <>
      {/* ── 인쇄 전용 CSS ── */}
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }

        @media print {
          body * { visibility: hidden !important; }
          #cert-print-root,
          #cert-print-root * { visibility: visible !important; }
          #cert-print-root .no-print {
            visibility: hidden !important;
            display: none !important;
            height: 0 !important;
          }
          #cert-print-root {
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            right: 0 !important; bottom: auto !important;
            width: 100% !important; height: auto !important;
            background: white !important;
            overflow: visible !important;
            display: block !important;
          }
          #cert-cards-container {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            flex: none !important;
            padding: 0 !important;
            background: white !important;
          }
          #cert-cards-container > div { max-width: none !important; gap: 0 !important; }
          .cert-page {
            break-after: page;
            border: none !important; box-shadow: none !important;
            margin: 0 !important; padding: 0 !important;
            min-height: 277mm !important; box-sizing: border-box !important;
            display: flex !important; flex-direction: column !important;
          }
          .cert-page:last-child { break-after: auto; }
          .cert-grade-section {
            flex: 1 !important; display: flex !important;
            flex-direction: column !important; min-height: 80mm !important;
          }
          .cert-grade-section > table { flex: 1 !important; height: 100% !important; }
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
                {shipValues.length > 0 && (
                  <span className={`ml-3 font-medium ${
                    shipErr   > 0 ? 'text-red-500' :
                    shipSending > 0 ? 'text-blue-500' :
                    shipOk    > 0 ? 'text-green-600' : ''
                  }`}>
                    {shipSending > 0 ? `· 전자등록 전송 중 (${shipSending}건)` : ''}
                    {shipOk > 0 && shipSending === 0 ? `· 전자등록 완료 (${shipOk}건)` : ''}
                    {shipErr > 0 ? `· 전자등록 오류 (${shipErr}건)` : ''}
                  </span>
                )}
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
              {isPrinting ? '인쇄 중...' : '인쇄 + 전자등록'}
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
              <CertCard
                key={idx}
                cert={cert}
                businessInfo={businessInfo}
                shipmentResults={shipmentResults}
                onRetryShipment={callShipmentApi}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

// ── 개별 카드 (상태별 분기) ────────────────────────────────────────
const CertCard: React.FC<{
  cert: CertItem;
  businessInfo?: BusinessInfo;
  shipmentResults: Record<string, ShipmentResult>;
  onRetryShipment: (animalNo: string, issueItem: EkapeIssueItem, gradeRow: EkapeDetail) => void;
}> = ({ cert, businessInfo, shipmentResults, onRetryShipment }) => {
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
      {issueItems.map((issueItem, i) => {
        const gradeRow = i === 0 ? (gradeInfo[0] ?? {}) : {};
        const key = shipKey(cert.animalNo, issueItem.issueNo);
        const sr  = shipmentResults[key];

        return (
          <React.Fragment key={i}>
            <CertificateDocument
              animalNo={result.animalNo}
              issueItem={issueItem}
              gradeRows={i === 0 ? gradeInfo : []}
              hasGradeError={hasGradeError}
              animal={animal}
              businessInfo={businessInfo}
              totalCount={result.totalCount}
            />

            {/* ── 전자등록 상태 배지 (인쇄 시 숨김) ── */}
            {sr && sr.status !== 'idle' && (
              <div className={`no-print flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border mt-1
                ${sr.status === 'success'      ? 'bg-green-50 border-green-200 text-green-700' :
                  sr.status === 'error'        ? 'bg-red-50 border-red-200 text-red-600' :
                  sr.status === 'unconfigured' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                  'bg-blue-50 border-blue-200 text-blue-600'}`}
              >
                {sr.status === 'success'      && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                {sr.status === 'error'        && <AlertTriangle className="w-4 h-4 shrink-0" />}
                {sr.status === 'unconfigured' && <AlertTriangle className="w-4 h-4 shrink-0" />}
                {sr.status === 'sending'      && <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
                <span className="flex-1">원패스 전자등록: {sr.message ?? (sr.status === 'sending' ? '전송 중...' : '')}</span>
                {sr.status === 'error' && (
                  <button
                    onClick={() => onRetryShipment(cert.animalNo, issueItem, gradeRow)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" /> 재전송
                  </button>
                )}
              </div>
            )}
            {/* 전자등록 전에 수동 전송 버튼 (아직 시도 전) */}
            {!sr && (
              <div className="no-print flex justify-end mt-1">
                <button
                  onClick={() => onRetryShipment(cert.animalNo, issueItem, gradeRow)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
                >
                  <Send className="w-3 h-3" /> 원패스 전자등록
                </button>
              </div>
            )}
          </React.Fragment>
        );
      })}
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

// ── 이력번호 포맷: 002191046216 → 002 191 046 216 ─────────────────
const fmtAnimalNo = (no: string): string => {
  const c = no.replace(/\D/g, '');
  if (c.length === 12) return `${c.slice(0,3)} ${c.slice(3,6)} ${c.slice(6,9)} ${c.slice(9,12)}`;
  return no;
};

// ── 현재 일시: YYYY-MM-DD HH:MM:SS ──────────────────────────────
const nowDatetime = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ── QR 코드 (발급번호 인코딩) ─────────────────────────────────────
const QrCodeCell: React.FC<{ text: string; size?: number }> = ({ text, size = 80 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !text || text === '—') return;
    QRCode.toCanvas(canvasRef.current, text, {
      width: size, margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {});
  }, [text, size]);
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
};

// ── 워터마크 배경 ("열람용" 반복 — 공식 서식 일치) ───────────────
const WatermarkBackground: React.FC = () => (
  <div style={{
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    overflow: 'hidden', pointerEvents: 'none', userSelect: 'none',
  }}>
    {Array.from({ length: 20 }, (_, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      return (
        <span key={i} style={{
          position: 'absolute',
          left: `${col * 25 + (row % 2 === 0 ? 2 : 14)}%`,
          top: `${row * 20}%`,
          transform: 'rotate(-25deg)',
          fontSize: '28px',
          fontWeight: 'bold',
          color: 'rgba(80, 130, 220, 0.12)',
          fontFamily: 'serif',
          whiteSpace: 'nowrap',
        }}>
          열람용
        </span>
      );
    })}
  </div>
);

// ── 공식 서식: 축산법 시행규칙 [별지 제 43호 서식] ────────────────
const CertificateDocument: React.FC<{
  animalNo: string;
  issueItem: EkapeIssueItem;
  gradeRows: EkapeDetail[];
  hasGradeError: boolean;
  animal: AnimalItem;
  businessInfo?: BusinessInfo;
  totalCount?: number;
}> = ({ animalNo, issueItem, gradeRows, hasGradeError, animal, businessInfo, totalCount }) => {

  const gi        = gradeRows[0] ?? {};
  const issueNo   = str(issueItem.issueNo);
  const issueDate = fmtDateKo(issueItem.issueDate);
  const judgeDate = fmtDateKo(issueItem.judgeDate);
  const abattNm   = str(issueItem.abattNm ?? issueItem.butchPlcNm);
  const sexNm     = str(issueItem.judgeSexNm ?? issueItem.sexNm);

  // Step 2 데이터 (품종은 resolveBreed 자동 판별)
  const breedNm    = gradeRows.length > 0 ? resolveBreed(gi)                                        : '';
  const carcassWt  = gradeRows.length > 0 ? str(gi.weight ?? gi.carcassWeight)                    : '';
  const qulGrade   = gradeRows.length > 0 ? str(gi.qulGradeNm ?? gi.gradeNm)                     : '';
  const marble     = gradeRows.length > 0 ? str(gi.insfat ?? gi.marbleScore)                      : '';
  const yieldGrade = gradeRows.length > 0 ? str(gi.wgrade ?? gi.yieldGradeNm)                    : '';
  const windex     = gradeRows.length > 0 ? str(gi.windex)                                        : '';
  const sexDisplay = gradeRows.length > 0 ? str(gi.judgeSexNm ?? gi.sexNm ?? issueItem.judgeSexNm) : sexNm;
  const abattAddr  = gradeRows.length > 0 ? str(gi.abattAddr)  : '';
  const abattTelNo = gradeRows.length > 0 ? str(gi.abattTelNo) : '';

  const hasDelvInfo  = !!(animal.destination || animal.cutName || animal.weightKg);
  const pendingNote  = hasGradeError && gradeRows.length === 0;

  const td  = { border: '1px solid #333' } as React.CSSProperties;
  const tdH = { ...td, background: '#f5f5f5' } as React.CSSProperties;

  const barcode = (
    <div style={{ display: 'inline-block', height: '30px', width: '100px',
      background: 'repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 7px,#000 7px,#000 10px,#fff 10px,#fff 12px,#000 12px,#000 13px,#fff 13px,#fff 16px)' }} />
  );

  return (
    <div className="cert-page bg-white" style={{
      fontSize: '10px', fontFamily: 'sans-serif', lineHeight: '1.5',
      padding: '5mm', minHeight: '267mm', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      <WatermarkBackground />

      {/* ① 서식 번호 */}
      <div style={{ fontSize: '9px', color: '#555', marginBottom: '4px' }}>
        축산법 시행규칙 [별지 제 43호 서식] (개정 2018. 12. 27.)&nbsp;&nbsp;(열람용)
      </div>

      {/* ② 발급번호 + 제목 + QR */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '5px' }}>
        <tbody>
          <tr>
            <td style={{ width: '72%', padding: '10px 14px', verticalAlign: 'middle', borderRight: '1px solid #333' }}>
              <div style={{ fontSize: '10px', color: '#444', marginBottom: '8px' }}>
                발급번호 :&nbsp;
                <span style={{ fontWeight: 'bold', color: '#000', fontSize: '22px' }}>{issueNo}</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '4px' }}>
                  축산물 (소) 등급판정확인서
                </span>
              </div>
            </td>
            <td style={{ width: '28%', padding: '10px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
              <QrCodeCell text={issueNo} size={80} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* ③ 법령 인용문 */}
      <div style={{ fontSize: '9px', marginBottom: '6px' }}>
        「축산법」제40조 및 같은 법 시행규칙 제45조제1항에 따라 등급판정 결과를 아래와 같이 확인합니다.
      </div>

      {/* ④ 발급일 + 평가사 서명 */}
      <div style={{ textAlign: 'right', marginBottom: '8px', fontSize: '10px', lineHeight: '1.9' }}>
        <div>{issueDate}</div>
        <div>축산물품질평가사 소속 :&nbsp;{businessInfo?.evaluatorOrg || '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'}</div>
        <div>성명 :&nbsp;{businessInfo?.evaluatorName || '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(인)</div>
      </div>

      {/* ⑤ 신청인 정보 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '4px', fontSize: '10px' }}>
        <tbody>
          <tr>
            <td rowSpan={3} style={{ ...tdH, padding: '4px 5px', textAlign: 'center', width: '28px',
              fontWeight: 'bold', writingMode: 'vertical-rl', letterSpacing: '4px' }}>신청인</td>
            <td style={{ ...tdH, padding: '6px 6px', whiteSpace: 'nowrap' }}>성&nbsp;&nbsp;명</td>
            <td style={{ ...td,  padding: '6px 6px', width: '22%' }}>{businessInfo?.name || '\u00a0'}</td>
            <td style={{ ...tdH, padding: '6px 4px', whiteSpace: 'nowrap', fontSize: '9px' }}>생년월일(사업자등록번호)</td>
            <td style={{ ...td,  padding: '6px 6px' }}>{businessInfo?.bizNo || '\u00a0'}</td>
          </tr>
          <tr>
            <td style={{ ...tdH, padding: '6px 6px', whiteSpace: 'nowrap' }}>업&nbsp;소&nbsp;명</td>
            <td style={{ ...td,  padding: '6px 6px' }}>{businessInfo?.bizName || '\u00a0'}</td>
            <td style={{ ...tdH, padding: '6px 6px', whiteSpace: 'nowrap' }}>업태유형</td>
            <td style={{ ...td,  padding: '6px 6px' }}>{businessInfo?.bizType || '\u00a0'}</td>
          </tr>
          <tr>
            <td style={{ ...tdH, padding: '6px 6px', whiteSpace: 'nowrap' }}>주&nbsp;&nbsp;소</td>
            <td colSpan={3} style={{ ...td, padding: '6px 6px' }}>{businessInfo?.address || '\u00a0'}</td>
          </tr>
        </tbody>
      </table>

      {/* ⑥ 도축장 정보 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', marginBottom: '4px', fontSize: '10px' }}>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ ...tdH, padding: '4px 5px', textAlign: 'center', width: '32px',
              fontWeight: 'bold', writingMode: 'vertical-rl', letterSpacing: '4px' }}>도축장</td>
            <td style={{ ...tdH, padding: '6px 6px', width: '42px' }}>업체명</td>
            <td style={{ ...td,  padding: '6px 6px' }}>{abattNm}</td>
            <td style={{ ...tdH, padding: '6px 6px', width: '70px' }}>등급판정일자</td>
            <td style={{ ...td,  padding: '6px 6px', width: '90px' }}>{judgeDate}</td>
          </tr>
          <tr>
            <td style={{ ...tdH, padding: '6px 6px' }}>소재지</td>
            <td style={{ ...td,  padding: '6px 6px' }}>{abattAddr !== '—' ? abattAddr : '\u00a0'}</td>
            <td style={{ ...tdH, padding: '6px 6px', width: '50px', whiteSpace: 'nowrap' }}>전화번호</td>
            <td style={{ ...td,  padding: '6px 6px', width: '90px' }}>{abattTelNo !== '—' ? abattTelNo : '\u00a0'}</td>
          </tr>
        </tbody>
      </table>

      {/* ⑦ 도체 등급 테이블 */}
      <div className="cert-grade-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '80mm', marginBottom: '4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333',
          fontSize: '10px', textAlign: 'center', flex: 1 }}>
          <thead style={{ background: '#f0f0f0' }}>
            <tr>
              <th rowSpan={2} style={{ ...td, padding: '5px 4px' }}>도체번호</th>
              <th rowSpan={2} style={{ ...td, padding: '5px 4px' }}>이력번호</th>
              <th rowSpan={2} style={{ ...td, padding: '5px 4px' }}>품종</th>
              <th rowSpan={2} style={{ ...td, padding: '5px 4px' }}>성별</th>
              <th rowSpan={2} style={{ ...td, padding: '5px 4px' }}>중량</th>
              <th colSpan={2} style={{ ...td, padding: '4px 4px', fontWeight: 'bold' }}>등&nbsp;급</th>
            </tr>
            <tr>
              <th style={{ ...td, padding: '4px 4px' }}>육질(근내지방도)</th>
              <th style={{ ...td, padding: '4px 4px' }}>육량(육량지수)</th>
            </tr>
          </thead>
          <tbody>
            {gradeRows.length > 0 ? (
              gradeRows.map((row, i) => {
                const rCarcassNo = str(row.cattleNo ?? row.carcassNo ?? row.inspecNo);
                const rBreed     = resolveBreed(row);
                const rSex       = str(row.judgeSexNm ?? row.sexNm ?? issueItem.judgeSexNm);
                const rWeight    = str(row.weight ?? row.carcassWeight);
                const rQul       = str(row.qulGradeNm ?? row.gradeNm);
                const rMarble    = str(row.insfat ?? row.marbleScore);
                const rYield     = str(row.wgrade ?? row.yieldGradeNm);
                const rWindex    = str(row.windex);
                const editStyle: React.CSSProperties = { outline: 'none', minWidth: '20px', display: 'inline-block' };
                return (
                  <tr key={i}>
                    <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '44px', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{rCarcassNo !== '—' ? rCarcassNo : ''}</span>
                    </td>
                    <td style={{ ...td, height: '70mm', verticalAlign: 'middle' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '13px', letterSpacing: '2px', marginBottom: '10px' }}>{fmtAnimalNo(animalNo)}</div>
                      {barcode}
                    </td>
                    <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{rBreed !== '—' ? rBreed : ''}</span>
                    </td>
                    <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{rSex !== '—' ? rSex : ''}</span>
                    </td>
                    <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{rWeight !== '—' ? rWeight : ''}</span>
                    </td>
                    <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '20px', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{(rQul !== '—' ? rQul : '') + (rMarble && rMarble !== '—' ? `(${rMarble})` : '')}</span>
                    </td>
                    <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '17px', verticalAlign: 'middle' }}>
                      <span contentEditable suppressContentEditableWarning style={editStyle}>{(rYield !== '—' ? rYield : '') + (rWindex && rWindex !== '—' ? `(${rWindex})` : '')}</span>
                    </td>
                  </tr>
                );
              })
            ) : (
              // Step 2 데이터 없음 — 수동 입력 모드
              <tr>
                <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '44px', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>&nbsp;</span>
                </td>
                <td style={{ ...td, height: '70mm', verticalAlign: 'middle' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', letterSpacing: '2px', marginBottom: '10px' }}>{fmtAnimalNo(animalNo)}</div>
                  {barcode}
                </td>
                <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>{breedNm !== '—' ? breedNm : ''}</span>
                </td>
                <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>{sexDisplay !== '—' ? sexDisplay : ''}</span>
                </td>
                <td style={{ ...td, height: '70mm', fontSize: '16px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>{carcassWt !== '—' ? carcassWt : ''}</span>
                </td>
                <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '20px', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>{qulGrade && qulGrade !== '—' ? (marble && marble !== '—' ? `${qulGrade}(${marble})` : qulGrade) : ''}</span>
                </td>
                <td style={{ ...td, height: '70mm', fontWeight: 'bold', fontSize: '17px', verticalAlign: 'middle' }}>
                  <span contentEditable suppressContentEditableWarning style={{ outline: 'none', minWidth: '20px', display: 'inline-block' }}>{yieldGrade && yieldGrade !== '—' ? (windex && windex !== '—' ? `${yieldGrade}(${windex})` : yieldGrade) : ''}</span>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f0f0f0' }}>
              <td colSpan={7} style={{ ...td, padding: '10px 8px', textAlign: 'center', fontWeight: 'bold', fontSize: '20px' }}>
                계 : <span style={{ fontFamily: '"Noto Serif KR", "Noto Serif CJK KR", "Malgun Gothic", "맑은 고딕", serif' }}>壹</span>두
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ⑧ 육질등급 주석 */}
      <div style={{ fontSize: '9px', color: '#444', marginBottom: '4px' }}>
        ※ 쇠고기 육질등급은 1++, 1+, 1, 2, 3 등외 등급(6단계)으로 구분됩니다.
      </div>

      {/* ⑨ Step 2 미승인 안내 */}
      {pendingNote && (
        <div style={{ fontSize: '9px', color: '#c05000', marginBottom: '4px' }}>
          ※ 소도체 등급 상세(도체번호·품종·중량·육질·육량)는 EKAPE API 권한 획득 후 자동 표시됩니다.
        </div>
      )}

      {/* ⑩ 납품내역 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #333', fontSize: '10px', marginBottom: '6px' }}>
        <tbody>
          <tr style={{ background: '#f0f0f0' }}>
            <td rowSpan={2} style={{ ...td, padding: '5px 6px', textAlign: 'center', fontWeight: 'bold', width: '50px' }}>납품내역</td>
            <td style={{ ...td, padding: '5px 6px', textAlign: 'center', fontWeight: 'bold' }}>업태유형</td>
            <td style={{ ...td, padding: '5px 6px', textAlign: 'center', fontWeight: 'bold' }}>납품처명</td>
            <td style={{ ...td, padding: '5px 6px', textAlign: 'center', fontWeight: 'bold' }}>부위명</td>
            <td style={{ ...td, padding: '5px 6px', textAlign: 'center', fontWeight: 'bold', width: '55px' }}>중량(kg)</td>
          </tr>
          <tr>
            <td style={{ ...td, padding: '6px 6px' }}>&nbsp;</td>
            <td style={{ ...td, padding: '6px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? (animal.destination ?? '\u00a0') : '\u00a0'}
            </td>
            <td style={{ ...td, padding: '6px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? (animal.cutName ?? '\u00a0') : '\u00a0'}
            </td>
            <td style={{ ...td, padding: '6px 6px', textAlign: 'center' }}>
              {hasDelvInfo ? (animal.weightKg ?? '\u00a0') : '\u00a0'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ⑪ 발급횟수 / 발행일자 */}
      <div style={{ fontSize: '9px', textAlign: 'right', color: '#333', marginBottom: '5px' }}>
        발급횟수 : {totalCount ?? 1}건&nbsp;&nbsp;&nbsp;발행일자 : {nowDatetime()}
      </div>

      {/* ⑫ 법적 고지사항 */}
      <div style={{ fontSize: '9px', color: '#444', lineHeight: '2.0', borderTop: '1px solid #bbb', paddingTop: '4px' }}>
        <div>◎ 이 확인서 내용은 축산물품질평가원 홈페이지(www.ekape.or.kr) &ldquo;축산물등급판정확인서 조회&rdquo; 메뉴를 이용하여 조회할 수 있습니다.</div>
        <div>◎ 「축산법」 제 45조 제 4항에 따라 등급판정신청인 또는 매수인이 해당 축산물을 학교나 음식점 납품 등의 특수목적으로 사용하는 경우에는 이 확인서를 제출하여야 합니다.</div>
        <div>◎ 이 등급판정확인서는 축산물품질평가원의 정식 서식입니다. 단, 수출용의 경우에는 육질 1+등급 이상에 표시됩니다.</div>
        <div>◎ 등급판정 결과에 이의가 있으신 사항은 축산물품질평가원 고객지원(044-410-7000)로 문의해 주시기 바랍니다.</div>
        <div style={{ textAlign: 'right', marginTop: '3px', color: '#666' }}>210mm×297mm [백상지 80 g/㎡ (재활용품)]</div>
      </div>
    </div>
  );
};

export default GradeCertificatePrintModal;
