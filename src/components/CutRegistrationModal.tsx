/**
 * 가공생산 / 출고 등록 모달
 *
 * - 부위별 중량을 입력하여 mtrace 가공생산 또는 출고 전자등록
 * - 가공식별번호: {이력번호}-{순번(2자리)} 자동 생성
 * - 표준부위코드: 농림부 농수산물 표준코드 43국내산육류/4301한우
 */

import React, { useState } from 'react';
import { X, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Factory, Truck } from 'lucide-react';
import type { BusinessInfo } from './SettingsModal';
import { HANWOO_CUTS, CUT_CATEGORIES } from '../constants/cutCodes';

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AnimalData {
  animalNumber: string;
  breed: string;
}

interface CutRow {
  id: number;
  cutCode: string;
  cutNm: string;
  weight: string;
  processingId: string;
}

interface SubmitResult {
  cutNm: string;
  success: boolean;
  message: string;
}

interface Props {
  animal: AnimalData;
  businessInfo: BusinessInfo;
  onClose: () => void;
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────────
const seq = (n: number) => n.toString().padStart(2, '0');

// ── 컴포넌트 ────────────────────────────────────────────────────────────────
const CutRegistrationModal: React.FC<Props> = ({ animal, businessInfo, onClose }) => {
  const cleanNo = animal.animalNumber.replace(/[-\s]/g, '');

  const [activeTab, setActiveTab] = useState<'production' | 'sales'>('production');

  // 매입처 (도축장) 정보 — 가공생산용
  const [abattBizNo, setAbattBizNo] = useState('');
  const [abattNm,    setAbattNm]    = useState('');

  // 납품처 정보 — 출고용
  const [destBizNo, setDestBizNo] = useState('');
  const [destNm,    setDestNm]    = useState('');

  // 부위 입력 행
  const [cuts, setCuts] = useState<CutRow[]>([
    { id: 1, cutCode: '430122', cutNm: '한우/등심', weight: '', processingId: `${cleanNo}-01` },
  ]);
  const [nextId, setNextId] = useState(2);

  // 제출 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[]>([]);
  const [isDone, setIsDone] = useState(false);

  // ── 행 조작 ──────────────────────────────────────────────────────────────
  const addRow = () => {
    const newSeq = seq(cuts.length + 1);
    setCuts((prev) => [
      ...prev,
      { id: nextId, cutCode: '430122', cutNm: '한우/등심', weight: '', processingId: `${cleanNo}-${newSeq}` },
    ]);
    setNextId((n) => n + 1);
  };

  const removeRow = (id: number) => {
    setCuts((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      // 가공식별번호 재정렬
      return updated.map((r, i) => ({ ...r, processingId: `${cleanNo}-${seq(i + 1)}` }));
    });
  };

  const updateCut = (id: number, field: keyof CutRow, value: string) => {
    setCuts((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === 'cutCode') {
          const found = HANWOO_CUTS.find((c) => c.code === value);
          return { ...r, cutCode: value, cutNm: found ? found.mtraceName : r.cutNm };
        }
        return { ...r, [field]: value };
      }),
    );
  };

  // ── 등록 제출 ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    // 유효성 검사
    const incomplete = cuts.some((r) => !r.weight || isNaN(parseFloat(r.weight)) || parseFloat(r.weight) <= 0);
    if (incomplete) {
      alert('모든 행의 중량(kg)을 올바르게 입력해 주세요.');
      return;
    }
    if (activeTab === 'production' && !abattBizNo.trim()) {
      alert('매입처(도축장) 사업자번호를 입력해 주세요.');
      return;
    }
    if (activeTab === 'sales' && !destBizNo.trim()) {
      alert('납품처 사업자번호를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    const res: SubmitResult[] = [];

    for (const cut of cuts) {
      const payload: Record<string, string> = {
        animalNo:     cleanNo,
        registerType: activeTab,
        cutCode:      cut.cutCode,
        cutNm:        cut.cutNm,
        weight:       cut.weight,
        processingId: cut.processingId,
        compBizNo:    businessInfo.bizNo.replace(/[-\s]/g, ''),
        compNm:       businessInfo.bizName,
      };

      if (activeTab === 'production') {
        payload.abattBizNo = abattBizNo.replace(/[-\s]/g, '');
        payload.abattNm    = abattNm;
      } else {
        payload.destBizNo = destBizNo.replace(/[-\s]/g, '');
        payload.destNm    = destNm;
      }

      try {
        const r = await fetch('/api/grade-shipment', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        const data = (await r.json()) as { success: boolean; resultMsg?: string; error?: string };
        res.push({
          cutNm:   cut.cutNm,
          success: data.success,
          message: data.resultMsg ?? data.error ?? (data.success ? '등록 완료' : '등록 실패'),
        });
      } catch {
        res.push({ cutNm: cut.cutNm, success: false, message: '네트워크 오류' });
      }
    }

    setResults(res);
    setIsDone(true);
    setIsSubmitting(false);
  };

  const totalWeight = cuts.reduce((sum, r) => sum + (parseFloat(r.weight) || 0), 0);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-800">가공생산 / 출고 등록</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              이력번호:&nbsp;
              <span className="font-mono font-semibold text-gray-700">{animal.animalNumber}</span>
              {animal.breed && animal.breed !== '-' && (
                <span className="ml-2 text-gray-400">{animal.breed}</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="overflow-y-auto flex-1 p-6">

          {/* ── 완료 결과 화면 ── */}
          {isDone ? (
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">등록 결과</h3>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                      r.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                    }`}
                  >
                    {r.success
                      ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                      : <AlertCircle  className="w-4 h-4 shrink-0" />
                    }
                    <span className="font-medium">{r.cutNm}</span>
                    <span className="text-xs ml-auto">{r.message}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={onClose}
                className="mt-5 w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
              >
                닫기
              </button>
            </div>

          ) : (
            <>
              {/* ── 탭 ── */}
              <div className="flex gap-1 mb-5 p-1 bg-gray-100 rounded-lg">
                <button
                  onClick={() => setActiveTab('production')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'production'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Factory className="w-4 h-4" />
                  가공생산 등록
                </button>
                <button
                  onClick={() => setActiveTab('sales')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'sales'
                      ? 'bg-white shadow text-orange-500'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  출고 등록
                </button>
              </div>

              {/* ── 매입처 / 납품처 정보 ── */}
              <div className="mb-5 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {activeTab === 'production' ? '매입처 (도축장) 정보' : '납품처 정보'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      사업자번호 <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={activeTab === 'production' ? abattBizNo : destBizNo}
                      onChange={(e) =>
                        activeTab === 'production'
                          ? setAbattBizNo(e.target.value)
                          : setDestBizNo(e.target.value)
                      }
                      placeholder="000-00-00000"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">상호</label>
                    <input
                      type="text"
                      value={activeTab === 'production' ? abattNm : destNm}
                      onChange={(e) =>
                        activeTab === 'production'
                          ? setAbattNm(e.target.value)
                          : setDestNm(e.target.value)
                      }
                      placeholder="업체명"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* ── 부위별 중량 입력 테이블 ── */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  부위별 중량 입력
                </p>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                        <th className="px-3 py-2 text-left font-medium w-[44%]">부위</th>
                        <th className="px-3 py-2 text-left font-medium w-[18%]">중량(kg)</th>
                        <th className="px-3 py-2 text-left font-medium">가공식별번호</th>
                        <th className="px-3 py-2 w-9"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuts.map((cut) => (
                        <tr key={cut.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <select
                              value={cut.cutCode}
                              onChange={(e) => updateCut(cut.id, 'cutCode', e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            >
                              {CUT_CATEGORIES.map((cat) => (
                                <optgroup key={cat} label={cat}>
                                  {HANWOO_CUTS.filter((c) => c.category === cat).map((c) => (
                                    <option key={c.code} value={c.code}>
                                      {c.name} ({c.code})
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              value={cut.weight}
                              onChange={(e) => updateCut(cut.id, 'weight', e.target.value)}
                              placeholder="0.0"
                              step="0.1"
                              min="0"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-gray-400">{cut.processingId}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeRow(cut.id)}
                              disabled={cuts.length === 1}
                              className="text-gray-300 hover:text-red-500 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                              title="행 삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 행 추가 + 합계 */}
                <div className="flex items-center justify-between mt-2 px-1">
                  <button
                    onClick={addRow}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    행 추가
                  </button>
                  <span className="text-sm text-gray-500">
                    합계:&nbsp;
                    <span className="font-semibold text-gray-700">{totalWeight.toFixed(1)} kg</span>
                    &nbsp;/&nbsp;{cuts.length}개 부위
                  </span>
                </div>
              </div>

              {/* 업체 정보 안내 */}
              <div className="mt-4 px-3 py-2.5 bg-blue-50 rounded-lg text-xs text-blue-700 border border-blue-100">
                신청인(우리 회사): <strong>{businessInfo.bizName || '(업체 설정 필요)'}</strong>
                {businessInfo.bizNo && <span className="ml-2 text-blue-500">{businessInfo.bizNo}</span>}
              </div>
            </>
          )}
        </div>

        {/* 푸터 버튼 */}
        {!isDone && (
          <div className="flex gap-3 px-6 py-4 border-t bg-gray-50 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                isSubmitting
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : activeTab === 'production'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  등록 중... ({cuts.length}건)
                </>
              ) : activeTab === 'production' ? (
                <>
                  <Factory className="w-4 h-4" />
                  가공생산 등록 ({cuts.length}건)
                </>
              ) : (
                <>
                  <Truck className="w-4 h-4" />
                  출고 등록 ({cuts.length}건)
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CutRegistrationModal;
