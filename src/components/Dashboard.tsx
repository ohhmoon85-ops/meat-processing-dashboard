import React, { useState } from 'react';
import { Download, FileText, CheckSquare } from 'lucide-react';
import { exportToExcel, generateDummyData } from '../utils/excelExport';

// 개체번호 데이터 타입
interface AnimalData {
  id: number;
  animalNumber: string;
  breed: string;
  birthDate: string;
  selected: boolean;
}

const Dashboard: React.FC = () => {
  // 섹션 A: 등급판정서 출력용 더미 데이터
  const [animalList, setAnimalList] = useState<AnimalData[]>([
    { id: 1, animalNumber: '002-1234-5678', breed: '한우', birthDate: '2023-05-10', selected: false },
    { id: 2, animalNumber: '002-1234-5679', breed: '한우', birthDate: '2023-06-15', selected: false },
    { id: 3, animalNumber: '002-1234-5680', breed: '한우', birthDate: '2023-07-20', selected: false },
    { id: 4, animalNumber: '002-1234-5681', breed: '한우', birthDate: '2023-08-25', selected: false },
    { id: 5, animalNumber: '002-1234-5682', breed: '한우', birthDate: '2023-09-30', selected: false },
  ]);

  // 섹션 B: 농림부 보고용 조회 월
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7) // YYYY-MM 형식
  );

  // 전체 선택/해제 토글
  const handleToggleAll = () => {
    const allSelected = animalList.every((item) => item.selected);
    setAnimalList(
      animalList.map((item) => ({ ...item, selected: !allSelected }))
    );
  };

  // 개별 항목 선택/해제
  const handleToggleItem = (id: number) => {
    setAnimalList(
      animalList.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  // 등급판정서 일괄 출력 (섹션 A)
  const handlePrintGradeCertificates = () => {
    const selectedItems = animalList.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      alert('출력할 개체를 선택해 주세요.');
      return;
    }
    alert(
      `선택된 ${selectedItems.length}건의 등급판정서 출력 준비 중...\n(API 연동 후 실제 출력 기능이 활성화됩니다)`
    );
  };

  // 농림부 보고용 엑셀 다운로드 (섹션 B)
  const handleDownloadExcel = () => {
    // 더미 데이터 생성 (실제로는 선택된 월의 데이터를 API로부터 가져와야 함)
    const dummyData = generateDummyData(20);

    // 선택된 월에 해당하는 데이터만 필터링 (데모용)
    const filteredData = dummyData.filter((item) =>
      item.productionDate.startsWith(selectedMonth)
    );

    if (filteredData.length === 0) {
      alert(`${selectedMonth}에 해당하는 생산 데이터가 없습니다.`);
      return;
    }

    // 엑셀 파일명 생성
    const fileName = `농림부_보고_${selectedMonth.replace('-', '')}.xlsx`;

    // 엑셀 다운로드 실행
    exportToExcel(filteredData, fileName);
  };

  const selectedCount = animalList.filter((item) => item.selected).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            육가공 사무 행정 자동화 대시보드
          </h1>
          <p className="text-gray-600">
            축산물 등급판정서 출력 및 농림부 보고 자동화 시스템
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 섹션 A: 서류 일괄 출력 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center mb-4">
              <FileText className="w-6 h-6 text-blue-600 mr-2" />
              <h2 className="text-2xl font-semibold text-gray-800">
                등급판정서 일괄 출력
              </h2>
            </div>

            <div className="mb-4 flex justify-between items-center">
              <div className="text-sm text-gray-600">
                선택된 항목: <span className="font-semibold text-blue-600">{selectedCount}건</span>
              </div>
              <button
                onClick={handleToggleAll}
                className="flex items-center px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                전체 {animalList.every((item) => item.selected) ? '해제' : '선택'}
              </button>
            </div>

            {/* 개체 리스트 테이블 */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left">선택</th>
                    <th className="px-4 py-2 text-left">개체번호</th>
                    <th className="px-4 py-2 text-left">품종</th>
                    <th className="px-4 py-2 text-left">생년월일</th>
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
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => handleToggleItem(item.id)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono">{item.animalNumber}</td>
                      <td className="px-4 py-3">{item.breed}</td>
                      <td className="px-4 py-3">{item.birthDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

          {/* 섹션 B: 농림부 보고 자동화 */}
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
                  <li>• 포함 항목: 연번, 생산일자, 이력번호, 품목명, 부위명, 생산중량, 보고상태, 비고</li>
                </ul>
              </div>

              {/* 엑셀 다운로드 메인 버튼 */}
              <button
                onClick={handleDownloadExcel}
                className="w-full flex items-center justify-center px-6 py-4 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 shadow-md hover:shadow-lg transition-all"
              >
                <Download className="w-5 h-5 mr-2" />
                농림부 보고용 엑셀 다운로드
              </button>
            </div>

            {/* 안내 사항 */}
            <div className="mt-6 p-4 bg-yellow-50 border-l-4 border-yellow-400 rounded">
              <p className="text-sm text-yellow-800">
                <strong>안내:</strong> 다운로드된 엑셀 파일을 확인한 후 농림부 시스템에 업로드하시기 바랍니다.
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
  );
};

export default Dashboard;
