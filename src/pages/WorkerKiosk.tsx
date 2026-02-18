import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Usb,
  FlaskConical,
  Barcode,
  Save,
  CheckCircle,
  Clock,
  Weight,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

// ── 품목 / 부위 데이터 ─────────────────────────────────────────────
const PRODUCTS = ['한우', '돼지', '닭', '오리'] as const;

const PARTS_MAP: Record<string, string[]> = {
  한우: ['등심', '안심', '채끝', '목심', '앞다리', '갈비', '사태', '양지'],
  돼지: ['삼겹살', '목살', '앞다리', '뒷다리', '갈비', '안심', '등심'],
  닭: ['통닭', '가슴살', '다리', '날개', '안심'],
  오리: ['통오리', '가슴살', '다리', '훈제용'],
};

// ── Web Serial API 타입 (Navigator 확장) ──────────────────────────
interface SerialPortInfo {
  readable: ReadableStream<Uint8Array>;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────
const WorkerKiosk: React.FC = () => {
  // 상태
  const [currentTime, setCurrentTime] = useState(new Date());
  const [traceNo, setTraceNo] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedPart, setSelectedPart] = useState('');
  const [weight, setWeight] = useState<number>(0);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recentLogs, setRecentLogs] = useState<
    { traceNo: string; product: string; part: string; weight: number; time: string }[]
  >([]);

  // refs
  const traceInputRef = useRef<HTMLInputElement>(null);
  const serialPortRef = useRef<SerialPortInfo | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // ── 시계 ────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── 토스트 자동 제거 ────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 마운트 시 입력창 포커스 ──────────────────────────────────────
  useEffect(() => {
    traceInputRef.current?.focus();
  }, []);

  // ── 시리얼 데이터 파싱 (저울 프로토콜 예시: "ST,+  1.234kg\r\n") ─
  const parseSerialWeight = useCallback((raw: string): number | null => {
    const cleaned = raw.replace(/[\r\n]/g, '').trim();
    const match = cleaned.match(/([\d.]+)\s*(?:kg)?/i);
    if (match) {
      const val = parseFloat(match[1]);
      return isNaN(val) ? null : val;
    }
    return null;
  }, []);

  // ── Web Serial 연결 ─────────────────────────────────────────────
  const connectSerial = async () => {
    try {
      const nav = navigator as Navigator & { serial?: { requestPort: () => Promise<SerialPortInfo> } };
      if (!nav.serial) {
        showToast('이 브라우저는 Web Serial API를 지원하지 않습니다. Chrome을 사용하세요.', 'error');
        return;
      }

      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      serialPortRef.current = port;
      setIsSerialConnected(true);
      setIsTestMode(false);
      showToast('저울이 연결되었습니다.', 'success');

      // 읽기 루프
      const reader = port.readable.getReader();
      serialReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      const readLoop = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // 줄 단위 파싱
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const w = parseSerialWeight(line);
              if (w !== null) setWeight(w);
            }
          }
        } catch {
          // 포트 닫힘 등
        }
      };
      readLoop();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return; // 사용자가 취소
      showToast('저울 연결 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'), 'error');
    }
  };

  // ── 시리얼 해제 ──────────────────────────────────────────────────
  const disconnectSerial = async () => {
    try {
      serialReaderRef.current?.cancel();
      await serialPortRef.current?.close();
    } catch { /* ignore */ }
    serialPortRef.current = null;
    serialReaderRef.current = null;
    setIsSerialConnected(false);
    setWeight(0);
  };

  // ── 테스트 모드 토글 ────────────────────────────────────────────
  const toggleTestMode = () => {
    if (isSerialConnected) disconnectSerial();
    setIsTestMode((prev) => !prev);
    if (!isTestMode) {
      // 첫 랜덤 무게 표시
      setWeight(randomWeight());
    } else {
      setWeight(0);
    }
  };

  const randomWeight = () => parseFloat((Math.random() * 1.5 + 0.5).toFixed(3));

  const generateTestWeight = () => {
    if (isTestMode) setWeight(randomWeight());
  };

  // ── 토스트 헬퍼 ────────────────────────────────────────────────
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  // ── 바코드 입력 (Enter 시 다음 단계) ────────────────────────────
  const handleTraceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && traceNo.trim().length > 0) {
      e.preventDefault();
      // Enter 입력 → 품목 선택 단계로 안내
      // 이미 품목이 선택되어 있지 않으면 포커스를 안내만 함
    }
  };

  // ── 품목 선택 ──────────────────────────────────────────────────
  const handleProductSelect = (product: string) => {
    setSelectedProduct(product);
    setSelectedPart(''); // 부위 초기화
  };

  // ── 저장 ──────────────────────────────────────────────────────
  const handleSave = async () => {
    // 유효성 검사
    if (!traceNo.trim()) {
      showToast('이력번호를 입력하세요.', 'error');
      traceInputRef.current?.focus();
      return;
    }
    if (!selectedProduct) {
      showToast('품목을 선택하세요.', 'error');
      return;
    }
    if (!selectedPart) {
      showToast('부위를 선택하세요.', 'error');
      return;
    }
    if (weight <= 0) {
      showToast('중량을 확인하세요.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const record = {
        production_date: currentTime.toISOString().slice(0, 10),
        traceability_no: traceNo.trim(),
        product_name: selectedProduct,
        part_name: selectedPart,
        production_weight: weight,
        report_status: 'PENDING',
        note: '',
      };

      const { error } = await supabase.from('production_logs').insert(record);

      if (error) throw error;

      // 최근 로그에 추가 (최대 5건)
      setRecentLogs((prev) =>
        [
          {
            traceNo: traceNo.trim(),
            product: selectedProduct,
            part: selectedPart,
            weight,
            time: currentTime.toLocaleTimeString('ko-KR'),
          },
          ...prev,
        ].slice(0, 5)
      );

      showToast('저장 완료!', 'success');

      // 입력 초기화
      setTraceNo('');
      setSelectedProduct('');
      setSelectedPart('');
      if (isTestMode) setWeight(randomWeight());
      traceInputRef.current?.focus();
    } catch (err) {
      showToast(
        '저장 실패: ' + (err instanceof Error ? err.message : '서버 오류'),
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ── 현재 날짜/시간 포맷 ─────────────────────────────────────────
  const dateStr = currentTime.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const timeStr = currentTime.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // ── 부위 목록 ──────────────────────────────────────────────────
  const availableParts = selectedProduct ? PARTS_MAP[selectedProduct] || [] : [];

  // ── 저장 가능 여부 ──────────────────────────────────────────────
  const canSave = traceNo.trim().length > 0 && selectedProduct && selectedPart && weight > 0;

  return (
    <div className="fixed inset-0 w-screen h-screen bg-gray-900 text-white overflow-hidden flex flex-col select-none">
      {/* ── 토스트 오버레이 ── */}
      {toast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div
            className={`px-12 py-8 rounded-2xl text-4xl font-bold shadow-2xl animate-pulse ${
              toast.type === 'success'
                ? 'bg-green-600/95 text-white'
                : 'bg-red-600/95 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <span className="flex items-center gap-4">
                <CheckCircle className="w-12 h-12" /> {toast.message}
              </span>
            ) : (
              <span className="flex items-center gap-4">
                <AlertTriangle className="w-12 h-12" /> {toast.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── 상단 헤더 ── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
          <span className="text-lg font-semibold text-gray-300">현장 키오스크</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-gray-400">
            <Clock className="w-5 h-5" />
            <span className="text-base font-mono">{dateStr}</span>
          </div>
          <span className="text-2xl font-mono font-bold text-cyan-400">{timeStr}</span>
        </div>
      </header>

      {/* ── 본문 2분할 ── */}
      <div className="flex flex-1 min-h-0">
        {/* ════════ 왼쪽: 입력부 ════════ */}
        <div className="w-1/2 flex flex-col p-5 gap-5 border-r border-gray-700 overflow-y-auto">
          {/* 이력번호 입력 */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              <Barcode className="w-4 h-4" />
              이력번호 (바코드 스캔)
            </label>
            <input
              ref={traceInputRef}
              type="text"
              value={traceNo}
              onChange={(e) => setTraceNo(e.target.value)}
              onKeyDown={handleTraceKeyDown}
              placeholder="바코드를 스캔하거나 이력번호를 입력하세요"
              autoFocus
              className="w-full px-5 py-4 text-2xl font-mono bg-gray-800 border-2 border-gray-600 rounded-xl
                         text-white placeholder-gray-500
                         focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/30 focus:outline-none
                         transition-colors"
            />
          </div>

          {/* 품목 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              품목 선택
            </label>
            <div className="grid grid-cols-4 gap-3">
              {PRODUCTS.map((p) => (
                <button
                  key={p}
                  onClick={() => handleProductSelect(p)}
                  className={`py-4 text-xl font-bold rounded-xl transition-all
                    ${
                      selectedProduct === p
                        ? 'bg-cyan-600 text-white ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/20'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600 active:scale-95'
                    }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 부위 선택 */}
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              부위 선택 {selectedProduct && <span className="text-cyan-400">({selectedProduct})</span>}
            </label>
            {availableParts.length > 0 ? (
              <div className="grid grid-cols-4 gap-3">
                {availableParts.map((part) => (
                  <button
                    key={part}
                    onClick={() => setSelectedPart(part)}
                    className={`py-4 text-lg font-bold rounded-xl transition-all
                      ${
                        selectedPart === part
                          ? 'bg-orange-500 text-white ring-2 ring-orange-400 shadow-lg shadow-orange-500/20'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 active:scale-95'
                      }`}
                  >
                    {part}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-500 text-lg border-2 border-dashed border-gray-700 rounded-xl">
                위에서 품목을 먼저 선택하세요
              </div>
            )}
          </div>

          {/* 최근 저장 로그 */}
          {recentLogs.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                최근 저장 내역
              </label>
              <div className="space-y-1">
                {recentLogs.map((log, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-2 bg-gray-800 rounded-lg text-sm"
                  >
                    <span className="text-gray-400 font-mono">{log.time}</span>
                    <span className="text-gray-300">
                      {log.traceNo} · {log.product} · {log.part}
                    </span>
                    <span className="text-cyan-400 font-bold">{log.weight.toFixed(3)}kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ════════ 오른쪽: 중량 및 저장 ════════ */}
        <div className="w-1/2 flex flex-col p-5 gap-5">
          {/* 저울 연결 컨트롤 */}
          <div className="flex gap-3">
            {!isSerialConnected ? (
              <button
                onClick={connectSerial}
                disabled={isTestMode}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-lg transition-all
                  ${
                    isTestMode
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
                  }`}
              >
                <Usb className="w-5 h-5" />
                저울 연결
              </button>
            ) : (
              <button
                onClick={disconnectSerial}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-xl font-semibold text-lg hover:bg-red-500 active:scale-95 transition-all"
              >
                <Usb className="w-5 h-5" />
                연결 해제
              </button>
            )}
            <button
              onClick={toggleTestMode}
              disabled={isSerialConnected}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-lg transition-all
                ${
                  isTestMode
                    ? 'bg-yellow-600 text-white ring-2 ring-yellow-400'
                    : isSerialConnected
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600 active:scale-95'
                }`}
            >
              <FlaskConical className="w-5 h-5" />
              {isTestMode ? '테스트 모드 ON' : '테스트 모드'}
            </button>
          </div>

          {/* 연결 상태 표시 */}
          <div className="flex items-center gap-2 justify-center text-sm">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isSerialConnected
                  ? 'bg-green-400'
                  : isTestMode
                    ? 'bg-yellow-400'
                    : 'bg-gray-600'
              }`}
            />
            <span className="text-gray-400">
              {isSerialConnected
                ? '저울 연결됨 (Serial)'
                : isTestMode
                  ? '테스트 모드 (시뮬레이션)'
                  : '저울 미연결'}
            </span>
          </div>

          {/* ── 중량 표시기 (핵심 영역) ── */}
          <div
            className="flex-1 flex flex-col items-center justify-center bg-gray-800 rounded-2xl border-2 border-gray-700 cursor-pointer"
            onClick={generateTestWeight}
            title={isTestMode ? '클릭하면 새로운 테스트 무게가 생성됩니다' : ''}
          >
            <div className="flex items-baseline gap-2">
              <Weight className="w-10 h-10 text-gray-500 self-center mr-2" />
              <span
                className={`font-mono font-black tracking-tight leading-none ${
                  weight > 0 ? 'text-cyan-400' : 'text-gray-600'
                }`}
                style={{ fontSize: 'clamp(4rem, 12vw, 10rem)' }}
              >
                {weight > 0 ? weight.toFixed(3) : '0.000'}
              </span>
              <span className="text-3xl text-gray-500 font-bold self-end mb-3">kg</span>
            </div>
            {isTestMode && (
              <p className="mt-4 text-sm text-yellow-400/80">
                화면을 터치하면 새 무게가 생성됩니다
              </p>
            )}
          </div>

          {/* ── 입력 요약 ── */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-800 rounded-xl py-3 px-2">
              <div className="text-xs text-gray-500 mb-1">이력번호</div>
              <div className="text-base font-mono text-gray-300 truncate">
                {traceNo || '-'}
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl py-3 px-2">
              <div className="text-xs text-gray-500 mb-1">품목</div>
              <div className="text-base font-bold text-cyan-400">{selectedProduct || '-'}</div>
            </div>
            <div className="bg-gray-800 rounded-xl py-3 px-2">
              <div className="text-xs text-gray-500 mb-1">부위</div>
              <div className="text-base font-bold text-orange-400">{selectedPart || '-'}</div>
            </div>
          </div>

          {/* ── 저장 버튼 ── */}
          <button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className={`w-full py-6 rounded-2xl text-3xl font-black transition-all flex items-center justify-center gap-3 shrink-0
              ${
                canSave && !isSaving
                  ? 'bg-green-600 text-white hover:bg-green-500 active:scale-[0.98] shadow-lg shadow-green-600/30'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
          >
            <Save className="w-8 h-8" />
            {isSaving ? '저장 중...' : '실적 저장 (Save)'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkerKiosk;
