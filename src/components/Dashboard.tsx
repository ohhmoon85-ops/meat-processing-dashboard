import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Download, FileText, CheckSquare, Upload, Scan, Plus, Trash2, X, ImageIcon, Settings } from 'lucide-react';
import { exportToExcel, generateDummyData } from '../utils/excelExport';
import { downloadExcelReport } from '../utils/downloadExcelReport';
import GradeCertificatePrintModal from './GradeCertificatePrintModal';
import SettingsModal, { BUSINESS_INFO_KEY, loadBusinessInfo } from './SettingsModal';
import type { BusinessInfo } from './SettingsModal';

// 개체번호 데이터 타입
interface AnimalData {
  id: number;
  animalNumber: string;
  breed: string;
  birthDate: string;
  selected: boolean;
  // 바코드 납품 정보 (txt 파싱 / 전문 바코드 입력 시 추출)
  destination?: string;    // 납품처명: 서울길원초등학교
  cutName?: string;        // 부위명: 설도
  processingType?: string; // 가공형태: 다짐, 슬라이스 등
  weightKg?: string;       // 중량(kg): 14.1
}

type Message = { type: 'success' | 'error' | 'warning'; text: string } | null;

// 엑셀 날짜 직렬 번호 또는 문자열 → YYYY-MM-DD 변환
const formatDateFromExcel = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') {
    // 엑셀 날짜 직렬 번호 (1900-01-00 기준)
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    return t || '-';
  }
  return '-';
};

const Dashboard: React.FC = () => {
  const [animalList, setAnimalList] = useState<AnimalData[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [certModalAnimals, setCertModalAnimals] = useState<AnimalData[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>(loadBusinessInfo);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 업체 설정 저장 ────────────────────────────────────────────────
  const handleSaveSettings = (info: BusinessInfo) => {
    setBusinessInfo(info);
    localStorage.setItem(BUSINESS_INFO_KEY, JSON.stringify(info));
    setShowSettings(false);
  };

  // 섹션 B: 농림부 보고용 조회 월
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );

  // ── 메시지 표시 (3초 후 자동 해제) ─────────────────────────────
  const showMessage = (msg: Message) => {
    setMessage(msg);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    if (msg) {
      messageTimerRef.current = setTimeout(() => setMessage(null), 3000);
    }
  };

  // ── 개체번호 추가 (중복 제거 포함) ────────────────────────────
  const addAnimals = (newItems: Omit<AnimalData, 'id' | 'selected'>[]) => {
    // 중복 판단: 이력번호 + 납품처 + 부위명 + 가공형태 + 중량 조합
    // 같은 이력번호라도 납품처/부위가 다르면 별도 행으로 추가
    const rowKey = (item: Omit<AnimalData, 'id' | 'selected'>) =>
      [
        item.animalNumber,
        item.destination ?? '',
        item.cutName ?? '',
        item.processingType ?? '',
        item.weightKg ?? '',
      ].join('|');

    const existingKeys = new Set(animalList.map(rowKey));
    let nextId = Math.max(0, ...animalList.map((a) => a.id)) + 1;

    const added: AnimalData[] = [];
    let duplicateCount = 0;
    let labelSkipCount = 0; // L-prefix 업체 내부 이력번호 제외 수

    for (const item of newItems) {
      // L로 시작하는 업체 내부 이력번호는 EKAPE 조회 불가 → 제외
      if (/^[A-Za-z]/i.test(item.animalNumber.replace(/[-\s]/g, ''))) {
        labelSkipCount++;
        continue;
      }
      const k = rowKey(item);
      if (existingKeys.has(k)) {
        duplicateCount++;
      } else {
        added.push({ ...item, id: nextId++, selected: false });
        existingKeys.add(k);
      }
    }

    if (added.length > 0) {
      setAnimalList((prev) => [...prev, ...added]);
      let msg = `${added.length}건 추가되었습니다.`;
      if (duplicateCount > 0) msg += ` (중복 ${duplicateCount}건 제외)`;
      if (labelSkipCount > 0) msg += ` (L-prefix ${labelSkipCount}건 제외)`;
      showMessage({ type: 'success', text: msg });
    } else if (duplicateCount > 0 || labelSkipCount > 0) {
      let msg = '';
      if (duplicateCount > 0) msg += `중복 ${duplicateCount}건`;
      if (labelSkipCount > 0) msg += `${msg ? ', ' : ''}L-prefix ${labelSkipCount}건`;
      showMessage({ type: 'warning', text: `${msg}은 추가되지 않았습니다.` });
    }
  };

  // ── 엑셀 파일 파싱 (클릭 업로드 / 드래그 앤 드롭 공용) ─────────
  const processExcelFile = (file: File) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (!allowed.includes(file.type) && !/\.(xlsx|xls|csv)$/i.test(file.name)) {
      showMessage({ type: 'error', text: 'xlsx / xls / csv 파일만 지원합니다.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          defval: '',
        }) as unknown[][];

        if (rows.length === 0) {
          showMessage({ type: 'error', text: '엑셀 파일에 데이터가 없습니다.' });
          return;
        }

        // 헤더 행에서 열 인덱스 찾기
        const headerRow = (rows[0] as unknown[]).map((c) => String(c ?? ''));
        const animalColIdx = headerRow.findIndex((h) =>
          h.includes('개체번호') || h.includes('이력번호') || h.includes('관리번호')
        );
        const breedColIdx = headerRow.findIndex((h) =>
          h.includes('품종') || h.includes('축종') || h.includes('종류')
        );
        const birthDateColIdx = headerRow.findIndex((h) =>
          h.includes('생년월일') || h.includes('출생') || h.includes('생산일')
        );

        const colIdx = animalColIdx === -1 ? 0 : animalColIdx;
        const dataRows = animalColIdx === -1 ? rows : rows.slice(1);

        const items: Omit<AnimalData, 'id' | 'selected'>[] = [];
        for (const row of dataRows) {
          const r = row as unknown[];
          const animalNumber = String(r[colIdx] ?? '').trim();
          if (!animalNumber) continue;
          const breed =
            breedColIdx >= 0 ? String(r[breedColIdx] ?? '').trim() || '-' : '-';
          const birthDate =
            birthDateColIdx >= 0 ? formatDateFromExcel(r[birthDateColIdx]) : '-';
          items.push({ animalNumber, breed, birthDate });
        }

        if (items.length === 0) {
          showMessage({ type: 'error', text: '유효한 개체번호를 찾을 수 없습니다.' });
        } else {
          addAnimals(items);
        }
      } catch {
        showMessage({ type: 'error', text: '엑셀 파일을 읽는 중 오류가 발생했습니다.' });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 이미지 파일에서 바코드 인식 ──────────────────────────────
  const processImageFile = async (file: File) => {
    showMessage({ type: 'warning', text: '바코드 인식 중...' });
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      const value = result.getText().trim();
      if (!value) {
        showMessage({ type: 'error', text: '바코드를 인식하지 못했습니다.' });
        return;
      }
      addAnimals([{ animalNumber: value, breed: '-', birthDate: '-' }]);
    } catch {
      showMessage({ type: 'error', text: '바코드를 인식하지 못했습니다. 이미지가 선명한지 확인해 주세요.' });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // ── .txt 라벨 파일 파싱 (바코드 스캐너 출력 형식) ────────────────
  // 형식: YYYYMMDD|품목명[부위명]|납품처|용도|중량kg|이력번호1  (줄1)
  //       이력번호2|회사명                                     (줄2)
  const processTxtFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // EUC-KR(CP949) 디코딩 — 한국 바코드 장비 출력 파일 표준 인코딩
        const buffer = e.target?.result as ArrayBuffer;
        const text = new TextDecoder('euc-kr').decode(buffer);
        // BOM 제거 및 줄 분리 (CRLF / LF 모두 처리)
        const lines = text
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length === 0) {
          showMessage({ type: 'error', text: 'txt 파일에 데이터가 없습니다.' });
          return;
        }

        const items: Omit<AnimalData, 'id' | 'selected'>[] = [];

        // 2줄씩 묶어 파싱 (홀수 남은 줄은 단독 처리)
        let i = 0;
        while (i < lines.length) {
          const line1 = lines[i];
          const line2 = i + 1 < lines.length ? lines[i + 1] : '';

          const parts1 = line1.split('|');
          const parts2 = line2.split('|');

          // 첫 줄이 날짜(8자리)로 시작하는지 확인
          const isRecord = /^\d{8}$/.test(parts1[0]?.trim());
          if (!isRecord) { i++; continue; }

          // ── 필드 파싱 ────────────────────────────────────────────
          const rawDate        = parts1[0]?.trim() ?? '';
          const productPart    = parts1[1]?.trim() ?? '';
          const rawDestination = parts1[2]?.trim() ?? ''; // 납품처명: 서울길원초등학교(올본)
          const rawProcType    = parts1[3]?.trim() ?? ''; // 가공형태: 다짐, 슬라이스
          const rawWeight      = parts1[4]?.trim() ?? '';
          const traceNo1       = parts1[5]?.trim() ?? '';
          const traceNo2       = parts2[0]?.trim() ?? '';

          // 날짜: YYYYMMDD → YYYY-MM-DD
          const productionDate =
            rawDate.length === 8
              ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
              : rawDate;

          // 품목명[부위명] 분리
          const productMatch = productPart.match(/^(.+?)\[(.+?)\]$/);
          const productName = productMatch ? productMatch[1].trim() : productPart;
          const partName    = productMatch ? productMatch[2].trim() : '-';

          // 중량: "15kg" → "15"
          const weight = rawWeight.replace(/kg$/i, '');

          // 납품처명: 괄호 코드 제거 "서울길원초등학교(올본)" → "서울길원초등학교"
          const destination = rawDestination.replace(/\([^)]*\)$/, '').trim() || undefined;

          // breed 필드에 품목/부위/중량 요약 표시
          const breedLabel = `${productName} / ${partName} (${weight}kg)`;

          const sharedFields = {
            breed: breedLabel,
            birthDate: productionDate,
            destination,
            cutName:        partName !== '-' ? partName : undefined,
            processingType: rawProcType || undefined,
            weightKg:       weight || undefined,
          };

          // 이력번호 1 추가 (L로 시작하는 업체 내부 이력번호 제외)
          if (traceNo1 && !/^[A-Za-z]/i.test(traceNo1)) {
            items.push({ animalNumber: traceNo1, ...sharedFields });
          }
          // 이력번호 2는 L-prefix 형식이므로 추가하지 않음

          // 2줄짜리 레코드면 2칸 전진 (두 번째 줄이 L-prefix 형식일 때), 아니면 1칸
          i += traceNo2 && /^[A-Z]\d{10,}/.test(traceNo2) ? 2 : 1;
        }

        if (items.length === 0) {
          showMessage({ type: 'error', text: 'txt 파일에서 이력번호를 찾을 수 없습니다.' });
        } else {
          addAnimals(items);
        }
      } catch {
        showMessage({ type: 'error', text: 'txt 파일을 읽는 중 오류가 발생했습니다.' });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 드롭된 파일 종류 판별 후 분기 처리 ───────────────────────
  const processDroppedFile = (file: File) => {
    const isImage = /\.(jpe?g|png|bmp|gif|webp|tiff?)$/i.test(file.name) || file.type.startsWith('image/');
    const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name) || [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ].includes(file.type);
    const isTxt = /\.txt$/i.test(file.name) || file.type === 'text/plain';

    if (isImage) {
      void processImageFile(file);
    } else if (isExcel) {
      processExcelFile(file);
    } else if (isTxt) {
      processTxtFile(file);
    } else {
      showMessage({ type: 'error', text: '엑셀(.xlsx/.csv), 이미지, 또는 txt 파일만 지원합니다.' });
    }
  };

  // ── 드래그 앤 드롭 ────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processDroppedFile(file);
  };

  // ── 바코드/직접 입력 추가 ──────────────────────────────────────
  const handleBarcodeAdd = () => {
    const trimmed = barcodeInput.trim();
    if (!trimmed) return;

    // 전문 바코드 형식 (|로 구분된 7필드) 감지 및 파싱
    // 예: "20251210|한우[설도]|서울길원초등학교(올본)|다짐|14.1kg|002192205667|음성농협축산물공판장"
    const parts = trimmed.split('|');
    if (parts.length >= 6 && /^\d{8}$/.test(parts[0]?.trim() ?? '')) {
      const rawDate     = parts[0].trim();
      const productPart = parts[1]?.trim() ?? '';
      const rawDest     = parts[2]?.trim() ?? '';
      const rawProc     = parts[3]?.trim() ?? '';
      const rawWeight   = parts[4]?.trim() ?? '';
      const animalNo    = parts[5]?.trim() ?? '';

      const productionDate =
        rawDate.length === 8
          ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
          : rawDate;

      const productMatch = productPart.match(/^(.+?)\[(.+?)\]$/);
      const productName  = productMatch ? productMatch[1].trim() : productPart;
      const partName     = productMatch ? productMatch[2].trim() : '-';
      const weight       = rawWeight.replace(/kg$/i, '');
      const destination  = rawDest.replace(/\([^)]*\)$/, '').trim() || undefined;

      addAnimals([{
        animalNumber:   animalNo,
        breed:          `${productName} / ${partName} (${weight}kg)`,
        birthDate:      productionDate,
        destination,
        cutName:        partName !== '-' ? partName : undefined,
        processingType: rawProc || undefined,
        weightKg:       weight || undefined,
      }]);
    } else {
      // 이력번호 단독 입력
      addAnimals([{ animalNumber: trimmed, breed: '-', birthDate: '-' }]);
    }

    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleBarcodeAdd();
  };

  // ── 선택 / 삭제 ────────────────────────────────────────────────
  const handleToggleAll = () => {
    const allSelected = animalList.every((item) => item.selected);
    setAnimalList(animalList.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleToggleItem = (id: number) => {
    setAnimalList(
      animalList.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleDeleteSelected = () => {
    setAnimalList(animalList.filter((item) => !item.selected));
    showMessage({ type: 'success', text: '선택 항목을 삭제했습니다.' });
  };

  const handleDeleteItem = (id: number) => {
    setAnimalList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    if (animalList.length === 0) return;
    if (window.confirm('개체 목록 전체를 초기화하겠습니까?')) {
      setAnimalList([]);
      showMessage({ type: 'success', text: '목록을 초기화했습니다.' });
    }
  };

  // ── 등급판정서 일괄 출력 ───────────────────────────────────────
  const handlePrintGradeCertificates = () => {
    const selectedItems = animalList.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      alert('출력할 개체를 선택해 주세요.');
      return;
    }
    setCertModalAnimals(selectedItems);
  };

  // ── 농림부 보고 엑셀 다운로드 ─────────────────────────────────
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadExcel = async () => {
    setIsDownloading(true);
    try {
      // 서버 API를 통한 DB 기반 엑셀 다운로드 시도
      await downloadExcelReport(selectedMonth);
    } catch (err) {
      // API 미연결 시 기존 클라이언트 사이드 더미 데이터 폴백
      console.warn('API 호출 실패, 클라이언트 사이드 폴백 사용:', err);
      const dummyData = generateDummyData(20);
      const filteredData = dummyData.filter((item) =>
        item.productionDate.startsWith(selectedMonth)
      );
      if (filteredData.length === 0) {
        alert(`${selectedMonth}에 해당하는 생산 데이터가 없습니다.`);
        setIsDownloading(false);
        return;
      }
      const fileName = `농림부_보고_${selectedMonth.replace('-', '')}.xlsx`;
      exportToExcel(filteredData, fileName);
    } finally {
      setIsDownloading(false);
    }
  };

  const selectedCount = animalList.filter((item) => item.selected).length;

  const messageBg: Record<string, string> = {
    success: 'bg-green-50 border-green-400 text-green-800',
    error: 'bg-red-50 border-red-400 text-red-800',
    warning: 'bg-yellow-50 border-yellow-400 text-yellow-800',
  };

  return (
    <>
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">
              육가공 사무 행정 자동화 대시보드
            </h1>
            <p className="text-gray-600">
              축산물 등급판정서 출력 및 농림부 보고 자동화 시스템
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-400 shadow-sm transition-all"
          >
            <Settings className="w-4 h-4 text-gray-500" />
            업체 설정
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── 섹션 A: 등급판정서 일괄 출력 ── */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <FileText className="w-6 h-6 text-blue-600 mr-2" />
              <h2 className="text-2xl font-semibold text-gray-800">
                등급판정서 일괄 출력
              </h2>
            </div>

            {/* 개체번호 입력 패널 */}
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                개체번호 추가
              </p>

              <div className="flex flex-col gap-2">
                {/* 엑셀 파일 업로드 — 드래그 앤 드롭 존 */}
                <div
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border-2 border-dashed cursor-pointer transition-all select-none ${
                    isDragOver
                      ? 'border-blue-500 bg-blue-100 scale-[1.01]'
                      : 'border-blue-300 bg-blue-50 hover:bg-blue-100 hover:border-blue-400'
                  }`}
                >
                  <Upload className={`w-5 h-5 ${isDragOver ? 'text-blue-600' : 'text-blue-400'}`} />
                  <span className={`text-sm font-medium ${isDragOver ? 'text-blue-700' : 'text-blue-600'}`}>
                    {isDragOver ? '여기에 놓으세요' : '파일을 드래그하거나 클릭하여 선택'}
                  </span>
                  {/* 지원 파일 유형 안내 */}
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap justify-center">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Upload className="w-3 h-3" />
                      엑셀 .xlsx / .csv
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <ImageIcon className="w-3 h-3" />
                      바코드 이미지 .jpg / .png
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="flex items-center gap-1 text-xs text-blue-500 font-medium">
                      <FileText className="w-3 h-3" />
                      라벨 데이터 .txt
                    </span>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processDroppedFile(file);
                    e.target.value = '';
                  }}
                />

                {/* 구분선 */}
                <div className="flex items-center gap-2 text-xs text-gray-400 select-none">
                  <div className="flex-1 h-px bg-gray-200" />
                  또는
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* 바코드 스캔 / 직접 입력 */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Scan className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={handleBarcodeKeyDown}
                      placeholder="바코드 스캔 또는 직접 입력 후 Enter"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={handleBarcodeAdd}
                    disabled={!barcodeInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    추가
                  </button>
                </div>
              </div>

              {/* 피드백 메시지 */}
              {message && (
                <div
                  className={`mt-2 px-3 py-2 rounded border-l-4 text-xs ${messageBg[message.type]}`}
                >
                  {message.text}
                </div>
              )}
            </div>

            {/* 테이블 상단 컨트롤 */}
            <div className="mb-3 flex justify-between items-center">
              <div className="text-sm text-gray-600">
                총 <span className="font-semibold">{animalList.length}</span>건 &nbsp;|&nbsp;
                선택{' '}
                <span className="font-semibold text-blue-600">{selectedCount}</span>건
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleToggleAll}
                  disabled={animalList.length === 0}
                  className="flex items-center px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-40"
                >
                  <CheckSquare className="w-4 h-4 mr-1" />
                  전체{' '}
                  {animalList.length > 0 && animalList.every((i) => i.selected)
                    ? '해제'
                    : '선택'}
                </button>
                {selectedCount > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center px-3 py-1.5 text-sm bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    선택 삭제
                  </button>
                )}
                {animalList.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors"
                  >
                    초기화
                  </button>
                )}
              </div>
            </div>

            {/* 개체 리스트 테이블 */}
            <div
              className="overflow-auto mb-4 rounded border border-gray-200"
              style={{ maxHeight: '260px' }}
            >
              {animalList.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Scan className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">개체번호를 추가해 주세요.</p>
                  <p className="text-xs mt-1">
                    엑셀 업로드 또는 바코드 스캔으로 입력할 수 있습니다.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left w-10">선택</th>
                      <th className="px-4 py-2 text-left">개체번호</th>
                      <th className="px-4 py-2 text-left">품종</th>
                      <th className="px-4 py-2 text-left">생년월일</th>
                      <th className="px-4 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {animalList.map((item) => (
                      <tr
                        key={item.id}
                        className={`border-b hover:bg-gray-50 transition-colors ${
                          item.selected ? 'bg-blue-50' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => handleToggleItem(item.id)}
                            className="w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {item.animalNumber}
                        </td>
                        <td className="px-4 py-2.5">{item.breed}</td>
                        <td className="px-4 py-2.5">{item.birthDate}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 일괄 출력 버튼 */}
            <div className="flex justify-end">
              <button
                onClick={handlePrintGradeCertificates}
                disabled={selectedCount === 0}
                className={`flex items-center px-6 py-3 rounded-lg font-semibold transition-all ${
                  selectedCount === 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg'
                }`}
              >
                <FileText className="w-5 h-5 mr-2" />
                선택 항목 등급판정서 일괄 출력
              </button>
            </div>
          </div>

          {/* ── 섹션 B: 농림부 보고 자동화 ── */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <Download className="w-6 h-6 text-green-600 mr-2" />
              <h2 className="text-2xl font-semibold text-gray-800">
                농림부 보고 자동화
              </h2>
            </div>

            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-4">
                매월 5일 제출해야 하는 농림부 실적 보고서를 자동으로 생성합니다.
              </p>

              {/* 조회 월 선택 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  조회 월 선택
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              {/* 보고서 정보 */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  생성될 보고서 정보
                </h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• 파일명: 농림부_보고_{selectedMonth.replace('-', '')}.xlsx</li>
                  <li>• 조회 기간: {selectedMonth}</li>
                  <li>
                    • 포함 항목: 연번, 생산일자, 이력번호, 품목명, 부위명, 생산중량,
                    보고상태, 비고
                  </li>
                </ul>
              </div>

              {/* 엑셀 다운로드 버튼 */}
              <button
                onClick={handleDownloadExcel}
                disabled={isDownloading}
                className={`w-full flex items-center justify-center px-6 py-4 text-white rounded-lg font-semibold shadow-md hover:shadow-lg transition-all ${
                  isDownloading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                <Download className="w-5 h-5 mr-2" />
                {isDownloading ? '다운로드 중...' : '농림부 보고용 엑셀 다운로드'}
              </button>
            </div>

            {/* 안내 사항 */}
            <div className="mt-6 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
              <p className="text-sm text-yellow-800">
                <strong>안내:</strong> 다운로드된 엑셀 파일을 확인한 후 농림부 시스템에
                업로드하시기 바랍니다.
              </p>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>육가공 사무 행정 자동화 시스템 v1.0 | 개발: 2026</p>
        </div>
      </div>
    </div>

    {/* 등급판정서 일괄 출력 모달 */}
    {certModalAnimals && (
      <GradeCertificatePrintModal
        animals={certModalAnimals}
        businessInfo={businessInfo}
        onClose={() => setCertModalAnimals(null)}
      />
    )}

    {/* 업체 설정 모달 */}
    {showSettings && (
      <SettingsModal
        initialInfo={businessInfo}
        onSave={handleSaveSettings}
        onClose={() => setShowSettings(false)}
      />
    )}
    </>
  );
};

export default Dashboard;
