/**
 * 업체 설정 모달
 *
 * - 신청인 정보(성명·사업자등록번호·업소명·업태유형·주소)를 localStorage에 저장
 * - 축산물 (소) 등급판정확인서 신청인 란에 자동 입력
 */
import React, { useState } from 'react';
import { X, Save, Settings } from 'lucide-react';

// ── 업체 정보 타입 (Dashboard · GradeCertificatePrintModal 공용) ─────────
export interface BusinessInfo {
  name: string;    // 성명
  bizNo: string;   // 사업자등록번호 (생년월일 포함)
  bizName: string; // 업소명
  bizType: string; // 업태유형
  address: string; // 주소
}

export const BUSINESS_INFO_KEY = 'meatDashboard_businessInfo';

export const emptyBusinessInfo = (): BusinessInfo => ({
  name: '', bizNo: '', bizName: '', bizType: '', address: '',
});

export const loadBusinessInfo = (): BusinessInfo => {
  try {
    const raw = localStorage.getItem(BUSINESS_INFO_KEY);
    if (raw) return { ...emptyBusinessInfo(), ...(JSON.parse(raw) as BusinessInfo) };
  } catch { /* ignore */ }
  return emptyBusinessInfo();
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────
interface Props {
  initialInfo: BusinessInfo;
  onSave: (info: BusinessInfo) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<Props> = ({ initialInfo, onSave, onClose }) => {
  const [form, setForm] = useState<BusinessInfo>(initialInfo);

  const field =
    (key: keyof BusinessInfo) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-800">업체 설정</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 안내 */}
        <div className="px-6 pt-4 pb-0">
          <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            아래 정보는 <strong>축산물 (소) 등급판정확인서</strong>의{' '}
            <strong>신청인</strong> 란에 자동으로 입력됩니다.
            입력한 정보는 이 기기(브라우저)에만 저장됩니다.
          </p>
        </div>

        {/* 폼 */}
        <div className="px-6 py-5 space-y-4">

          {/* 성명 / 사업자등록번호 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                성명
              </label>
              <input
                type="text"
                value={form.name}
                onChange={field('name')}
                placeholder="홍길동"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                사업자등록번호
              </label>
              <input
                type="text"
                value={form.bizNo}
                onChange={field('bizNo')}
                placeholder="123-45-67890"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 업소명 / 업태유형 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                업소명
              </label>
              <input
                type="text"
                value={form.bizName}
                onChange={field('bizName')}
                placeholder="○○축산"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                업태유형
              </label>
              <input
                type="text"
                value={form.bizType}
                onChange={field('bizType')}
                placeholder="식육포장처리업"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 주소 */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              주소
            </label>
            <input
              type="text"
              value={form.address}
              onChange={field('address')}
              placeholder="충청북도 음성군 음성읍 ..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => onSave(form)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
          >
            <Save className="w-4 h-4" />
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
